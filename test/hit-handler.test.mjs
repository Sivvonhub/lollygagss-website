import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBotUA, buildHitKeys, createHandler } from '../api/_hit-handler.js';

// Minimal fake matching just the surface _hit-handler.js calls on a
// @upstash/redis client: pipeline().incr().expire().sadd().exec().
function makeFakeRedis() {
  const incrCalls = [];
  return {
    incrCalls,
    pipeline() {
      const commands = [];
      return {
        incr(key) { commands.push(key); incrCalls.push(key); return this; },
        expire() { return this; },
        sadd() { return this; },
        async exec() { return commands.map(() => 1); },
      };
    },
  };
}

function makeReq(query, ua) {
  return { query, headers: ua === undefined ? {} : { 'user-agent': ua } };
}

function makeRes() {
  const res = {
    statusCode: undefined,
    ended: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

describe('isBotUA', () => {
  test('flags curl', () => {
    assert.equal(isBotUA('curl/8.5.0'), true);
  });

  test('flags common bot/tooling substrings', () => {
    for (const ua of [
      'Googlebot/2.1',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'python-requests/2.31',
      'HeadlessChrome/120.0',
      'Pingdom.com_bot_version_1.4',
      'UptimeRobot/2.0',
    ]) {
      assert.equal(isBotUA(ua), true, `expected bot for UA: ${ua}`);
    }
  });

  test('treats missing or empty UA as bot', () => {
    assert.equal(isBotUA(''), true);
    assert.equal(isBotUA(undefined), true);
  });

  test('does not flag a real browser UA', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    assert.equal(isBotUA(ua), false);
  });
});

describe('buildHitKeys (test/paid/bot classification)', () => {
  test('non-test hit with paid and bot both set increments both', () => {
    const keys = buildHitKeys({ day: '2026-08-01', bucket: '/', paid: true, bot: true, test: false, ectBucket: null });
    assert.deepEqual(keys, [
      'hitm:2026-08-01:/',
      'hitm:2026-08-01:/:paid',
      'hitm:2026-08-01:/:bot',
    ]);
  });

  test('plain human hit only increments the total', () => {
    const keys = buildHitKeys({ day: '2026-08-01', bucket: '/', paid: false, bot: false, test: false, ectBucket: null });
    assert.deepEqual(keys, ['hitm:2026-08-01:/']);
  });

  // Regression coverage for the production defect: a t=1 hit with g=1 (paid)
  // and a bot UA must land ONLY in total + :test, never :paid or :bot.
  test('t=1 hit excludes paid and bot even when both flags are set', () => {
    const keys = buildHitKeys({ day: '2026-08-01', bucket: '/services', paid: true, bot: true, test: true, ectBucket: null });
    assert.deepEqual(keys, [
      'hitm:2026-08-01:/services',
      'hitm:2026-08-01:/services:test',
    ]);
  });

  test('ect key is included alongside a test hit', () => {
    const keys = buildHitKeys({ day: '2026-08-01', bucket: '/services', paid: true, bot: true, test: true, ectBucket: '4g' });
    assert.deepEqual(keys, [
      'hitm:2026-08-01:/services',
      'hitm:2026-08-01:/services:test',
      'hitm:2026-08-01:ect:4g',
    ]);
  });

  test('no ect key when ectBucket is null', () => {
    const keys = buildHitKeys({ day: '2026-08-01', bucket: '/', paid: false, bot: false, test: false, ectBucket: null });
    assert.ok(!keys.some((k) => k.includes(':ect:')));
  });
});

describe('createHandler (alias parity + write completion)', () => {
  test('always responds 204, even without a configured redis client', async () => {
    const handler = createHandler(null);
    const req = makeReq({ p: '/', g: '0', ect: '', vw: '390' }, 'curl/8.5.0');
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
  });

  test('by the time the handler resolves, the Redis write has already completed', async () => {
    const redis = makeFakeRedis();
    const handler = createHandler(redis);
    const req = makeReq({ p: '/', g: '0', ect: '', vw: '390' }, 'curl/8.5.0');
    const res = makeRes();
    await handler(req, res);
    // No setTimeout/flush needed: awaiting handler() must guarantee the
    // pipeline already executed. This is the fix for the production bug
    // where a fire-and-forget write could be dropped when Vercel's runtime
    // froze the function right after the 204 response was sent.
    assert.deepEqual(redis.incrCalls, ['hitm:2026-08-01:/', 'hitm:2026-08-01:/:bot']);
  });

  test('api/a and api/hit run the identical handler and produce identical writes for identical input', async () => {
    // api/a.js and api/hit.js both do `export { default } from './_hit-handler.js'`,
    // so they share this exact handler — this test pins that the alias can
    // never silently diverge (e.g. from someone editing one file but not
    // the other) by exercising it twice, once per "route", the way the
    // production acceptance test did.
    const redisForA = makeFakeRedis();
    const redisForHitAlias = makeFakeRedis();
    const handlerForA = createHandler(redisForA);
    const handlerForHitAlias = createHandler(redisForHitAlias);

    const query = { p: '/', g: '0', ect: '', vw: '390' };
    await handlerForA(makeReq(query, 'curl/8.5.0'), makeRes());
    await handlerForHitAlias(makeReq(query, 'curl/8.5.0'), makeRes());

    assert.deepEqual(redisForA.incrCalls, redisForHitAlias.incrCalls);
    assert.deepEqual(redisForHitAlias.incrCalls, ['hitm:2026-08-01:/', 'hitm:2026-08-01:/:bot']);
  });

  test('reproduces the exact production acceptance-test sequence correctly', async () => {
    const redis = makeFakeRedis();
    const handler = createHandler(redis);

    // Request 1: POST /api/a?p=%2F&g=0&ect=&vw=390 (curl)
    await handler(makeReq({ p: '/', g: '0', ect: '', vw: '390' }, 'curl/8.5.0'), makeRes());
    assert.deepEqual(redis.incrCalls, ['hitm:2026-08-01:/', 'hitm:2026-08-01:/:bot']);

    // Request 2: POST /api/hit?p=%2F&g=0&ect=&vw=390 (curl, via the alias)
    redis.incrCalls.length = 0;
    await handler(makeReq({ p: '/', g: '0', ect: '', vw: '390' }, 'curl/8.5.0'), makeRes());
    assert.deepEqual(redis.incrCalls, ['hitm:2026-08-01:/', 'hitm:2026-08-01:/:bot']);

    // Request 3: POST /api/a?p=%2Fservices&g=1&ect=4g&vw=390&t=1 (curl)
    redis.incrCalls.length = 0;
    await handler(makeReq({ p: '/services', g: '1', ect: '4g', vw: '390', t: '1' }, 'curl/8.5.0'), makeRes());
    assert.deepEqual(redis.incrCalls, [
      'hitm:2026-08-01:/services',
      'hitm:2026-08-01:/services:test',
      'hitm:2026-08-01:ect:4g',
    ]);
  });
});
