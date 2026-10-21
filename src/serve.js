// devunlock serve — локальный HTTP-прокси с раздельной маршрутизацией:
// домены из списка идут через VPN (upstream), всё остальное — напрямую.
import http from 'node:http';
import { dial } from './net.js';
import { matchesDomain } from './services.js';
import { c, explainError, plural } from './ui.js';

function splitHostPort(target, defaultPort) {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(target);
  return { host: m[1], port: Number(m[2]) || defaultPort };
}

export function createRouter({ upstream, domains, all = false }) {
  return (host) => (all || matchesDomain(host, domains) ? upstream : null);
}

export function createServer({ upstream, domains, all = false, timeout = 10000, log = () => {} }) {
  const route = createRouter({ upstream, domains, all });
  const server = http.createServer();

  // HTTPS и всё остальное через CONNECT
  server.on('connect', async (req, client, head) => {
    const { host, port } = splitHostPort(req.url, 443);
    const via = route(host);
    client.on('error', () => {});
    try {
      const remote = await dial(host, port, { proxy: via, timeout });
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) remote.write(head);
      remote.pipe(client);
      client.pipe(remote);
      remote.on('error', () => client.destroy());
      client.on('close', () => remote.destroy());
      log(host, port, via, null);
    } catch (err) {
      log(host, port, via, err);
      client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'
        + `devunlock: ${explainError(err)}\n`);
    }
  });

  // Обычный HTTP: запрос с абсолютным URL
  server.on('request', async (req, res) => {
    let url;
    try { url = new URL(req.url); } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('devunlock: это прокси-сервер. Укажите его в настройках прокси, а не открывайте в браузере.\n');
      return;
    }
    const host = url.hostname;
    const port = Number(url.port) || 80;
    const via = route(host);
    try {
      const remote = await dial(host, port, { proxy: via, timeout });
      const headers = Object.entries(req.headers)
        .filter(([k]) => !/^proxy-|^connection$|^keep-alive$/i.test(k))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      remote.write(`${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headers.join('\r\n')}\r\nConnection: close\r\n\r\n`);
      // end: false — не полузакрываем соединение: часть SOCKS-серверов в ответ рвёт его
      // целиком, не дождавшись ответа сайта. Закрываем, когда сайт ответил.
      req.pipe(remote, { end: false });
      const sock = req.socket;
      remote.pipe(sock);
      remote.on('end', () => sock.end());
      remote.on('error', () => sock.destroy());
      log(host, port, via, null);
    } catch (err) {
      log(host, port, via, err);
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`devunlock: ${explainError(err)}\n`);
    }
  });

  return server;
}

export function startServe({ upstream, domains, all, host = '127.0.0.1', port = 8899, verbose = false }) {
  const log = (h, p, via, err) => {
    if (err) {
      console.log(`${c.red('✗')} ${h}:${p} ${via ? c.yellow('→ VPN') : c.dim('→ напрямую')} ${c.red(explainError(err))}`);
    } else if (verbose || via) {
      console.log(`${via ? c.yellow('⇄ VPN') : c.dim('→ прямо')}  ${h}:${p}`);
    }
  };
  const server = createServer({ upstream, domains, all, log });
  server.listen(port, host, () => {
    const addr = `http://${host}:${port}`;
    console.log(`\n${c.bold('devunlock serve')} · умный прокси запущен на ${c.cyan(addr)}`);
    console.log(`Через VPN (${upstream.url}): ${all ? c.yellow('весь трафик') : `${plural(domains.length, 'домен', 'домена', 'доменов')} ИИ и dev-сервисов`}`);
    console.log('Всё остальное — напрямую: банки, Госуслуги и российские сайты не заметят VPN.\n');
    console.log('Подключите инструменты:');
    console.log(`  терминал:  ${c.cyan(`npx devunlock env --proxy ${addr}`)}`);
    console.log(`  Cursor / VS Code, git, docker:  ${c.cyan(`npx devunlock setup --proxy ${addr}`)}\n`);
    console.log(c.dim('Ctrl+C — остановить. В журнале ниже видно, что пошло через VPN.\n'));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(c.red(`Порт ${port} занят. Укажите другой: --port 8898`));
    else console.error(c.red(err.message));
    process.exit(1);
  });
  return server;
}
