// devunlock detect — ищет локальные прокси VPN-клиентов и показывает, куда они выводят.
import net from 'node:net';
import { parseProxy } from './net.js';
import { whoami } from './check.js';
import { c } from './ui.js';

export const KNOWN_PORTS = [
  { port: 10808, apps: 'v2rayN (SOCKS)' },
  { port: 10809, apps: 'v2rayN (HTTP)' },
  { port: 2080, apps: 'NekoRay / NekoBox / sing-box' },
  { port: 7890, apps: 'Clash / Mihomo' },
  { port: 7891, apps: 'Clash (SOCKS)' },
  { port: 7897, apps: 'Clash Verge Rev' },
  { port: 12334, apps: 'Hiddify' },
  { port: 20170, apps: 'v2rayA (SOCKS)' },
  { port: 20171, apps: 'v2rayA (HTTP)' },
  { port: 1080, apps: 'SOCKS-прокси (стандартный порт)' },
];

function isOpen(port, host = '127.0.0.1', timeout = 600) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Для открытого порта пробуем SOCKS5, потом HTTP — и узнаём страну выхода. */
async function probe(port, timeout) {
  for (const scheme of ['socks5', 'http']) {
    const proxy = parseProxy(`${scheme}://127.0.0.1:${port}`);
    const me = await whoami({ proxy, timeout });
    if (!me.error) return { proxy, ...me };
  }
  return null;
}

export async function runDetect({ timeout = 6000, ports = KNOWN_PORTS } = {}) {
  const open = (await Promise.all(ports.map(async (p) => ((await isOpen(p.port)) ? p : null)))).filter(Boolean);
  const found = await Promise.all(open.map(async (p) => ({ ...p, result: await probe(p.port, timeout) })));
  return found;
}

export function printDetect(found, direct) {
  console.log(`\n${c.bold('devunlock')} · поиск локальных прокси\n`);
  if (direct && !direct.error) console.log(`Без прокси: IP ${c.bold(direct.ip)}, страна ${c.bold(direct.country)}\n`);
  const working = found.filter((f) => f.result);
  if (!found.length) {
    console.log(c.yellow('Локальных прокси на стандартных портах не нашлось.'));
    console.log('Включите в VPN-клиенте режим «прокси» / «системный прокси» и посмотрите порт в его настройках.');
    console.log(`Потом: ${c.cyan('npx devunlock check --proxy socks5://127.0.0.1:<порт>')}\n`);
    return null;
  }
  for (const f of found) {
    if (!f.result) {
      console.log(`  ❔ 127.0.0.1:${f.port}  ${c.dim(f.apps)}  ${c.dim('порт открыт, но это не прокси или он не выходит в интернет')}`);
      continue;
    }
    const abroad = direct && f.result.country && f.result.country !== direct.country;
    const icon = abroad ? '✅' : '🟡';
    const note = abroad ? c.green(`выход: ${f.result.country}, ${f.result.ip}`) : c.yellow(`выход: ${f.result.country || '?'} — та же страна, что и без прокси`);
    console.log(`  ${icon} ${c.bold(f.result.proxy.url)}  ${c.dim(f.apps)}  ${note}`);
  }
  const best = working.find((f) => direct && f.result.country !== direct.country) || working[0];
  if (best) {
    console.log(`\nДальше:`);
    console.log(`  ${c.cyan(`npx devunlock check --proxy ${best.result.proxy.url}`)}`);
    console.log(`  ${c.cyan(`npx devunlock serve --upstream ${best.result.proxy.url}`)}\n`);
  }
  return best ? best.result.proxy : null;
}
