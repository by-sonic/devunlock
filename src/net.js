// Сетевое ядро: TCP-соединение напрямую или через прокси (SOCKS5 / HTTP CONNECT),
// TLS поверх него и минимальный HTTP/1.1-запрос. Без зависимостей.
import net from 'node:net';
import tls from 'node:tls';

export class NetError extends Error {
  constructor(stage, code, message) {
    super(message);
    this.stage = stage; // dns | tcp | proxy | tls | http
    this.code = code;   // ENOTFOUND, ECONNRESET, TIMEOUT, ...
  }
}

/** Разбирает адрес прокси: socks5://user:pass@host:port, socks5h://..., http://host:port */
export function parseProxy(url) {
  if (!url) return null;
  const withScheme = /^[a-z0-9]+:\/\//i.test(url) ? url : `socks5://${url}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new Error(`Не понимаю адрес прокси: ${url}`); }
  const type = u.protocol.replace(':', '').toLowerCase();
  if (!['socks5', 'socks5h', 'socks', 'http', 'https'].includes(type)) {
    throw new Error(`Тип прокси «${type}» не поддерживается. Используйте socks5:// или http://`);
  }
  if (type === 'https') throw new Error('Прокси по https:// не поддерживается, используйте http:// или socks5://');
  const port = Number(u.port) || (type === 'http' ? 8080 : 1080);
  return {
    type: type.startsWith('socks') ? 'socks5' : 'http',
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port,
    username: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    url: `${type.startsWith('socks') ? 'socks5' : 'http'}://${u.host}`,
  };
}

function tcpConnect(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new NetError('tcp', 'TIMEOUT', `таймаут подключения к ${host}:${port}`));
    }, timeout);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (err) => {
      clearTimeout(timer);
      const stage = err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ? 'dns' : 'tcp';
      reject(new NetError(stage, err.code || 'ERROR', err.message));
    });
  });
}

/** Читает из сокета ровно столько байт, сколько попросили; лишнее возвращает в сокет. */
class Reader {
  constructor(socket, timeout) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.timeout = timeout;
    this.onData = (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); this.flush(); };
    this.onEnd = () => this.fail(new NetError('proxy', 'ECONNRESET', 'прокси закрыл соединение'));
    this.onError = (err) => this.fail(new NetError('proxy', err.code || 'ERROR', err.message));
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('error', this.onError);
  }
  flush() {
    while (this.waiters.length) {
      const w = this.waiters[0];
      const n = w.until ? this.buf.indexOf(w.until) : -1;
      const size = w.until ? (n >= 0 ? n + w.until.length : -1) : (this.buf.length >= w.n ? w.n : -1);
      if (size < 0) return;
      this.waiters.shift();
      clearTimeout(w.timer);
      const out = this.buf.subarray(0, size);
      this.buf = this.buf.subarray(size);
      w.resolve(out);
    }
  }
  fail(err) {
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(err); }
  }
  wait(spec) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new NetError('proxy', 'TIMEOUT', 'прокси не ответил вовремя'));
      }, this.timeout);
      this.waiters.push({ ...spec, resolve, reject, timer });
      this.flush();
    });
  }
  read(n) { return this.wait({ n }); }
  readUntil(marker) { return this.wait({ until: Buffer.from(marker) }); }
  release() {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('error', this.onError);
    if (this.buf.length) this.socket.unshift(this.buf);
  }
}

const SOCKS_ERRORS = {
  1: 'общая ошибка SOCKS-сервера', 2: 'соединение запрещено правилами', 3: 'сеть недоступна',
  4: 'хост недоступен', 5: 'соединение отклонено', 6: 'истёк TTL', 7: 'команда не поддерживается',
  8: 'тип адреса не поддерживается',
};

async function socks5Handshake(socket, proxy, host, port, timeout) {
  const r = new Reader(socket, timeout);
  try {
    const auth = proxy.username ? [0x00, 0x02] : [0x00];
    socket.write(Buffer.from([0x05, auth.length, ...auth]));
    const [ver, method] = await r.read(2);
    if (ver !== 0x05) throw new NetError('proxy', 'EPROTO', 'это не SOCKS5-прокси');
    if (method === 0xff) throw new NetError('proxy', 'EAUTH', 'SOCKS5-прокси требует другой способ авторизации');
    if (method === 0x02) {
      const u = Buffer.from(proxy.username), p = Buffer.from(proxy.password);
      socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
      const [, status] = await r.read(2);
      if (status !== 0x00) throw new NetError('proxy', 'EAUTH', 'неверный логин или пароль прокси');
    }
    const h = Buffer.from(host);
    const req = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]);
    socket.write(req);
    const head = await r.read(4);
    if (head[1] !== 0x00) {
      throw new NetError('proxy', 'ESOCKS', `SOCKS5: ${SOCKS_ERRORS[head[1]] || `код ${head[1]}`}`);
    }
    const atyp = head[3];
    const addrLen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : (await r.read(1))[0];
    await r.read(addrLen + 2);
  } finally {
    r.release();
  }
}

async function httpConnectHandshake(socket, proxy, host, port, timeout) {
  const r = new Reader(socket, timeout);
  try {
    const lines = [`CONNECT ${host}:${port} HTTP/1.1`, `Host: ${host}:${port}`];
    if (proxy.username) {
      const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      lines.push(`Proxy-Authorization: Basic ${token}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    const head = (await r.readUntil('\r\n\r\n')).toString('latin1');
    const status = Number(head.split(' ')[1]);
    if (status !== 200) {
      throw new NetError('proxy', status === 407 ? 'EAUTH' : 'ECONNECT',
        `HTTP-прокси ответил ${head.split('\r\n')[0]}`);
    }
  } finally {
    r.release();
  }
}

/** TCP-соединение с host:port — напрямую или через прокси. */
export async function dial(host, port, { proxy = null, timeout = 8000 } = {}) {
  if (!proxy) return tcpConnect(host, port, timeout);
  let socket;
  try {
    socket = await tcpConnect(proxy.host, proxy.port, timeout);
  } catch (err) {
    throw new NetError('proxy', err.code, `не удалось подключиться к прокси ${proxy.host}:${proxy.port} (${err.code})`);
  }
  try {
    if (proxy.type === 'socks5') await socks5Handshake(socket, proxy, host, port, timeout);
    else await httpConnectHandshake(socket, proxy, host, port, timeout);
    return socket;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

function tlsWrap(socket, servername, timeout) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername, ALPNProtocols: ['http/1.1'] });
    const timer = setTimeout(() => {
      t.destroy();
      reject(new NetError('tls', 'TIMEOUT', 'TLS-рукопожатие зависло'));
    }, timeout);
    t.once('secureConnect', () => { clearTimeout(timer); resolve(t); });
    t.once('error', (err) => {
      clearTimeout(timer);
      reject(new NetError('tls', err.code || 'ERROR', err.message));
    });
  });
}

/**
 * HTTPS-запрос. Возвращает { status, headers, body } — body ограничен maxBody байтами,
 * этого хватает, чтобы узнать сервис по тексту ошибки.
 */
export async function request(url, {
  method = 'GET', headers = {}, body = null, proxy = null, timeout = 8000, maxBody = 64 * 1024,
} = {}) {
  const u = new URL(url);
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const started = Date.now();
  const raw = await dial(u.hostname, port, { proxy, timeout });
  const left = () => Math.max(1000, timeout - (Date.now() - started));
  const socket = u.protocol === 'https:' ? await tlsWrap(raw, u.hostname, left()) : raw;

  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const head = [
    `${method} ${u.pathname}${u.search} HTTP/1.1`,
    `Host: ${u.host}`,
    'User-Agent: devunlock (+https://github.com/by-sonic/devunlock)',
    'Accept: */*',
    'Connection: close',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ];
  if (payload) head.push(`Content-Length: ${payload.length}`);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      const data = Buffer.concat(chunks);
      const split = data.indexOf('\r\n\r\n');
      if (split < 0) {
        reject(err || new NetError('http', 'EEMPTY', 'сервер закрыл соединение без ответа'));
        return;
      }
      const lines = data.subarray(0, split).toString('latin1').split('\r\n');
      const status = Number(lines[0].split(' ')[1]);
      const hdrs = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status, headers: hdrs, body: data.subarray(split + 4).toString('utf8'), ms: Date.now() - started });
    };
    const timer = setTimeout(() => finish(new NetError('http', 'TIMEOUT', 'сервер не ответил вовремя')), left());
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBody) finish();
    });
    socket.on('end', () => finish());
    socket.on('close', () => finish());
    socket.on('error', (err) => finish(new NetError('http', err.code || 'ERROR', err.message)));
    socket.write(head.join('\r\n') + '\r\n\r\n');
    if (payload) socket.write(payload);
  });
}
