// Локальные фейковые серверы для тестов: обычный HTTP, SOCKS5 и HTTP CONNECT-прокси.
import http from 'node:http';
import net from 'node:net';

export function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export async function targetServer(body = 'hello from target') {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${body} ${req.method} ${req.url}`);
  });
  return { server, port: await listen(server) };
}

/** Минимальный SOCKS5-сервер; считает соединения, опционально требует логин/пароль. */
export async function socksServer({ username, password } = {}) {
  const stats = { connects: [] };
  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let step = 'greeting';
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (step === 'greeting' && buf.length >= 2 && buf.length >= 2 + buf[1]) {
        const methods = [...buf.subarray(2, 2 + buf[1])];
        buf = buf.subarray(2 + buf[1]);
        if (username) {
          if (!methods.includes(2)) { client.end(Buffer.from([5, 0xff])); return; }
          client.write(Buffer.from([5, 2]));
          step = 'auth';
        } else {
          client.write(Buffer.from([5, 0]));
          step = 'request';
        }
      }
      if (step === 'auth' && buf.length >= 2) {
        const ul = buf[1];
        if (buf.length < 3 + ul) return;
        const pl = buf[2 + ul];
        if (buf.length < 3 + ul + pl) return;
        const u = buf.subarray(2, 2 + ul).toString();
        const p = buf.subarray(3 + ul, 3 + ul + pl).toString();
        buf = buf.subarray(3 + ul + pl);
        const ok = u === username && p === password;
        client.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) { client.end(); return; }
        step = 'request';
      }
      if (step === 'request' && buf.length >= 5) {
        const len = buf[4];
        if (buf.length < 5 + len + 2) return;
        const host = buf.subarray(5, 5 + len).toString();
        const port = buf.readUInt16BE(5 + len);
        const rest = buf.subarray(7 + len);
        step = 'piping';
        client.off('data', onData);
        stats.connects.push(`${host}:${port}`);
        const remote = net.connect(port, host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) remote.write(rest);
          remote.pipe(client);
          client.pipe(remote);
        });
        remote.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        client.on('error', () => remote.destroy());
      }
    };
    client.on('data', onData);
    client.on('error', () => {});
  });
  return { server, stats, port: await listen(server) };
}

/** HTTP-прокси, понимающий только CONNECT. */
export async function connectProxy() {
  const stats = { connects: [] };
  const server = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  server.on('connect', (req, client, head) => {
    stats.connects.push(req.url);
    const [host, port] = req.url.split(':');
    const remote = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      remote.pipe(client);
      client.pipe(remote);
    });
    remote.on('error', () => client.destroy());
    client.on('error', () => remote.destroy());
  });
  return { server, stats, port: await listen(server) };
}

export const close = (...servers) => Promise.all(servers.map((s) => new Promise((r) => {
  s.closeAllConnections?.();
  s.close(() => r());
})));
