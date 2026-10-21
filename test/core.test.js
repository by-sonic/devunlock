import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseProxy, request } from '../src/net.js';
import { SERVICES, matchesDomain, routeDomains } from '../src/services.js';
import { createServer } from '../src/serve.js';
import { parseArgs } from '../src/args.js';
import { renderEnv } from '../src/setup.js';
import { targetServer, socksServer, connectProxy, listen, close } from './helpers.js';

const svc = (id) => SERVICES.find((s) => s.id === id);
const res = (status, body = '') => ({ status, body, headers: {} });

test('parseProxy понимает socks5, http, логин и адрес без схемы', () => {
  assert.deepEqual(
    { ...parseProxy('socks5://u:p%40ss@127.0.0.1:10808') },
    { type: 'socks5', host: '127.0.0.1', port: 10808, username: 'u', password: 'p@ss', url: 'socks5://127.0.0.1:10808' },
  );
  assert.equal(parseProxy('http://127.0.0.1:10809').type, 'http');
  assert.equal(parseProxy('127.0.0.1:1080').type, 'socks5');
  assert.equal(parseProxy(undefined), null);
  assert.throws(() => parseProxy('ftp://x:1'), /не поддерживается/);
});

test('OpenAI: 401 — работает, 403 unsupported_country — геоблок', () => {
  assert.equal(svc('openai').classify(res(401, '{"error":{"code":"invalid_api_key"}}')).state, 'ok');
  assert.equal(svc('openai').classify(res(403, '{"error":{"code":"unsupported_country_region_territory"}}')).state, 'geo');
});

test('Anthropic: 403 Request not allowed — геоблок', () => {
  assert.equal(svc('anthropic').classify(res(403, '{"error":{"type":"forbidden","message":"Request not allowed"}}')).state, 'geo');
  assert.equal(svc('anthropic').classify(res(401, '{"type":"error"}')).state, 'ok');
});

test('Gemini: без ключа — частично, с ключом и «location is not supported» — геоблок', () => {
  const g = svc('gemini');
  assert.equal(g.build({}).keyless, true);
  assert.equal(g.classify(res(403, 'unregistered callers'), { keyless: true }).state, 'partial');
  const req = g.build({ GEMINI_API_KEY: 'k' });
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['x-goog-api-key'], 'k');
  assert.ok(!req.url.includes('k'), 'ключ не должен попадать в URL');
  assert.equal(g.classify(res(400, 'User location is not supported for the API use.'), req).state, 'geo');
  assert.equal(g.classify(res(200, '{}'), req).state, 'ok');
});

test('HashiCorp: 405 — геоблок; GitHub: 403 rate limit — работает', () => {
  assert.equal(svc('hashicorp').classify(res(405, 'This content is not currently available in your region.')).state, 'geo');
  assert.equal(svc('github').classify(res(403, 'API rate limit exceeded')).state, 'ok');
  assert.equal(svc('npm').classify(res(500, 'oops')).state, 'unknown');
});

test('matchesDomain: домен и поддомены, но не похожие имена', () => {
  const d = routeDomains(['ai']);
  assert.ok(matchesDomain('api.openai.com', d));
  assert.ok(matchesDomain('claude.ai', d));
  assert.ok(matchesDomain('API.Anthropic.com.', d));
  assert.ok(!matchesDomain('notopenai.com', d));
  assert.ok(!matchesDomain('yandex.ru', d));
  assert.throws(() => routeDomains(['nope']), /Нет такой группы/);
  assert.ok(routeDomains([], ['*.example.com']).includes('example.com'));
});

test('parseArgs: флаги, значения через = и пробел, команда после --', () => {
  const o = parseArgs(['serve', '--port=9000', '--upstream', 'socks5://x:1', '--domain', 'a.com', '--domain', 'b.com', '--all']);
  assert.deepEqual(o._, ['serve']);
  assert.equal(o.port, '9000');
  assert.equal(o.upstream, 'socks5://x:1');
  assert.deepEqual(o.domain, ['a.com', 'b.com']);
  assert.equal(o.all, true);
  assert.deepEqual(parseArgs(['run', '--', 'claude', '--help']).rest, ['claude', '--help']);
});

test('env для разных оболочек', () => {
  assert.match(renderEnv('http://127.0.0.1:8899', 'bash'), /^export HTTPS_PROXY="http:\/\/127\.0\.0\.1:8899"$/m);
  assert.match(renderEnv('http://127.0.0.1:8899', 'powershell'), /^\$env:HTTPS_PROXY="http:\/\/127\.0\.0\.1:8899"$/m);
  assert.match(renderEnv('http://127.0.0.1:8899', 'cmd'), /^set NO_PROXY=localhost,127\.0\.0\.1,::1$/m);
  assert.throws(() => renderEnv('x', 'tcsh'), /Неизвестная оболочка/);
});

test('запрос напрямую, через SOCKS5 (с паролем) и через HTTP CONNECT', async () => {
  const target = await targetServer();
  const socks = await socksServer({ username: 'user', password: 'secret' });
  const httpProxy = await connectProxy();
  const url = `http://127.0.0.1:${target.port}/ping?x=1`;
  try {
    const direct = await request(url);
    assert.equal(direct.status, 200);
    assert.match(direct.body, /hello from target GET \/ping\?x=1/);

    const viaSocks = await request(url, { proxy: parseProxy(`socks5://user:secret@127.0.0.1:${socks.port}`) });
    assert.equal(viaSocks.status, 200);
    assert.deepEqual(socks.stats.connects, [`127.0.0.1:${target.port}`]);

    await assert.rejects(
      request(url, { proxy: parseProxy(`socks5://user:wrong@127.0.0.1:${socks.port}`) }),
      (err) => err.stage === 'proxy' && err.code === 'EAUTH',
    );

    const viaHttp = await request(url, { proxy: parseProxy(`http://127.0.0.1:${httpProxy.port}`) });
    assert.equal(viaHttp.status, 200);
    assert.deepEqual(httpProxy.stats.connects, [`127.0.0.1:${target.port}`]);
  } finally {
    await close(target.server, socks.server, httpProxy.server);
  }
});

test('недоступный порт — понятная сетевая ошибка', async () => {
  const s = http.createServer();
  const port = await listen(s);
  await close(s);
  await assert.rejects(request(`http://127.0.0.1:${port}/`, { timeout: 2000 }), (err) => err.code === 'ECONNREFUSED');
});

test('serve: домены из списка идут через VPN, остальные — напрямую', async () => {
  const target = await targetServer('routed');
  const socks = await socksServer();
  const upstream = parseProxy(`socks5://127.0.0.1:${socks.port}`);
  const viaVpn = createServer({ upstream, domains: ['127.0.0.1'] });
  const direct = createServer({ upstream, domains: ['openai.com'] });
  const vpnPort = await listen(viaVpn);
  const directPort = await listen(direct);
  const url = `http://127.0.0.1:${target.port}/x`;
  try {
    // CONNECT через serve → домен в списке → через SOCKS
    const a = await request(url, { proxy: parseProxy(`http://127.0.0.1:${vpnPort}`) });
    assert.equal(a.status, 200);
    assert.equal(socks.stats.connects.length, 1);

    // домена нет в списке → напрямую, SOCKS не трогается
    const b = await request(url, { proxy: parseProxy(`http://127.0.0.1:${directPort}`) });
    assert.equal(b.status, 200);
    assert.equal(socks.stats.connects.length, 1);

    // обычный HTTP-запрос с абсолютным URL через serve
    const body = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: vpnPort, path: url, method: 'GET', headers: { Host: `127.0.0.1:${target.port}` } }, (resp) => {
        let data = '';
        resp.on('data', (d) => { data += d; });
        resp.on('end', () => resolve(data));
      });
      r.on('error', reject);
      r.end();
    });
    assert.match(body, /routed GET \/x/);
    assert.equal(socks.stats.connects.length, 2);
  } finally {
    await close(viaVpn, direct, target.server, socks.server);
  }
});

test('serve: если VPN недоступен — 502 с объяснением', async () => {
  const dead = http.createServer();
  const deadPort = await listen(dead);
  await close(dead);
  const srv = createServer({ upstream: parseProxy(`socks5://127.0.0.1:${deadPort}`), domains: ['example.com'], timeout: 2000 });
  const port = await listen(srv);
  try {
    await assert.rejects(
      request('http://example.com:80/', { proxy: parseProxy(`http://127.0.0.1:${port}`), timeout: 3000 }),
      (err) => err.stage === 'proxy' && /502/.test(err.message),
    );
  } finally {
    await close(srv);
  }
});
