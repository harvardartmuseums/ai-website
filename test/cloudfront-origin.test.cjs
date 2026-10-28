const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { cloudfrontOrigin } = require('../lib/cloudfront-origin');

const secret = 'test-only-origin-secret-0123456789abcdef';

function request(app, { path = '/', headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = path;
    req.headers = { host: 'test.local', 'user-agent': 'test browser', 'x-forwarded-proto': 'https', ...headers };
    const res = new http.ServerResponse(req);
    res.end = body => {
      res.finished = true;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: String(body || '') });
      return res;
    };
    res.on('error', reject);
    app.handle(req, res);
  });
}

function application(mode, { log = () => {}, now, limited = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cloudfrontOrigin({ mode, secret, log, now }));
  if (limited) {
    app.use(rateLimit({
      windowMs: 60000, max: 2,
      keyGenerator: req => rateLimit.ipKeyGenerator(req.clientIp || req.ip),
    }));
  }
  app.use((req, res) => res.json({ verified: req.cloudfrontVerified, clientIp: req.clientIp }));
  return app;
}

test('enabled protection rejects missing secrets and invalid modes at startup', () => {
  for (const mode of ['monitor', 'enforce']) {
    assert.throws(() => cloudfrontOrigin({ mode, secret: '' }), /at least 32/);
    assert.throws(() => cloudfrontOrigin({ mode, secret: 'short' }), /at least 32/);
  }
  assert.throws(() => cloudfrontOrigin({ mode: 'enfroce', secret }), /must be off, monitor, or enforce/);
});

test('off mode preserves direct traffic and ignores even a matching header', async () => {
  const app = application('off');
  const result = await request(app, { headers: {
    'x-origin-verify': secret, 'x-forwarded-for': '192.0.2.1, 203.0.113.1',
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { verified: false, clientIp: '203.0.113.1' });
});

test('monitor mode allows direct traffic without trusting its spoofed prefix', async () => {
  const app = application('monitor');
  for (const value of [undefined, 'incorrect', secret + ', ' + secret]) {
    const headers = { 'x-forwarded-for': '192.0.2.1, 203.0.113.1' };
    if (value !== undefined) headers['x-origin-verify'] = value;
    const result = await request(app, { headers });
    assert.deepEqual(JSON.parse(result.body), { verified: false, clientIp: '203.0.113.1' });
  }
});

test('verified CloudFront traffic uses the viewer IP and ignores attacker-supplied addresses', async () => {
  const app = application('monitor');
  for (const viewer of ['198.51.100.8', '2001:db8:1234::8']) {
    const result = await request(app, { headers: {
      'x-origin-verify': secret,
      'x-forwarded-for': `192.0.2.99, ${viewer}, 203.0.113.1`,
    } });
    assert.deepEqual(JSON.parse(result.body), { verified: true, clientIp: viewer });
  }
});

test('incomplete or malformed verified chains fall back to the existing proxy handling', async () => {
  const app = application('monitor');
  for (const forwarded of [undefined, '203.0.113.1', 'invalid, 203.0.113.1']) {
    const headers = { 'x-origin-verify': secret };
    if (forwarded) headers['x-forwarded-for'] = forwarded;
    const result = await request(app, { headers });
    assert.equal(JSON.parse(result.body).clientIp, forwarded ? '203.0.113.1' : '127.0.0.1');
  }
});

test('enforce mode rejects missing, incorrect, and duplicate secrets without caching or echoing them', async () => {
  const app = application('enforce');
  for (const value of [undefined, 'incorrect', secret + ', ' + secret]) {
    const headers = value ? { 'x-origin-verify': value } : {};
    const result = await request(app, { headers });
    assert.equal(result.status, 403);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.body, 'Forbidden');
  }
  assert.equal((await request(app, { headers: { 'x-origin-verify': secret } })).status, 200);
});

test('monitor logging is bounded under abuse and never includes the secret', async () => {
  const messages = [];
  let time = 1000;
  const app = application('monitor', { log: message => messages.push(message), now: () => time });
  for (let i = 0; i < 10; i++) {
    await request(app);
    await request(app, { headers: { 'x-origin-verify': secret } });
  }
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => !message.includes(secret)));
  time += 60000;
  await request(app);
  assert.equal(messages.length, 3);
});

test('rate limits separate viewers sharing a CloudFront edge and ignore spoofed prefixes', async () => {
  const app = application('monitor', { limited: true });
  const headers = (viewer, spoof = '192.0.2.99') => ({
    'x-origin-verify': secret,
    'x-forwarded-for': `${spoof}, ${viewer}, 203.0.113.1`,
  });
  assert.equal((await request(app, { headers: headers('198.51.100.8') })).status, 200);
  assert.equal((await request(app, { headers: headers('198.51.100.8') })).status, 200);
  assert.equal((await request(app, { headers: headers('198.51.100.8', '192.0.2.100') })).status, 429);
  assert.equal((await request(app, { headers: headers('198.51.100.9') })).status, 200);
});

test('IPv6 viewers cannot evade rate limits by rotating addresses within a /56', async () => {
  const app = application('monitor', { limited: true });
  const headers = viewer => ({ 'x-origin-verify': secret, 'x-forwarded-for': `${viewer}, 203.0.113.1` });
  for (const viewer of ['2001:db8:1234::1', '2001:db8:1234::2']) {
    assert.equal((await request(app, { headers: headers(viewer) })).status, 200);
  }
  assert.equal((await request(app, { headers: headers('2001:db8:1234::3') })).status, 429);
});

test('real app enforces the guard before static assets, redirects, body parsing, and API work', async () => {
  const oldMode = process.env.CLOUDFRONT_ORIGIN_MODE;
  const oldSecret = process.env.CLOUDFRONT_ORIGIN_SECRET;
  const originalFetch = global.fetch;
  const originalInterval = global.setInterval;
  process.env.CLOUDFRONT_ORIGIN_MODE = 'enforce';
  process.env.CLOUDFRONT_ORIGIN_SECRET = secret;
  global.fetch = async () => ({ ok: true, json: async () => ({
    info: { totalrecords: 1 },
    aggregations: { image_count: { value: 1 }, by_source: { buckets: [] } },
  }) });
  global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer; };
  try {
    const app = require('../app');
    await new Promise(resolve => setImmediate(resolve));
    global.fetch = () => { throw new Error('rejected requests must not call the API'); };
    for (const path of ['/', '/stylesheets/style.css', '/object/1', '/api/compare']) {
      const result = await request(app, { path, method: path.startsWith('/api/') ? 'POST' : 'GET', headers: {
        'content-type': 'application/json', 'content-length': '999999999', 'x-forwarded-proto': 'http',
      } });
      assert.equal(result.status, 403);
      assert.equal(result.body, 'Forbidden');
      assert.equal(result.headers.location, undefined);
    }
    const result = await request(app, { path: '/search', headers: { 'x-origin-verify': secret } });
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, '/explore');
  } finally {
    global.fetch = originalFetch;
    global.setInterval = originalInterval;
    if (oldMode === undefined) delete process.env.CLOUDFRONT_ORIGIN_MODE;
    else process.env.CLOUDFRONT_ORIGIN_MODE = oldMode;
    if (oldSecret === undefined) delete process.env.CLOUDFRONT_ORIGIN_SECRET;
    else process.env.CLOUDFRONT_ORIGIN_SECRET = oldSecret;
  }
});
