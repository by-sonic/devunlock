#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseProxy } from './net.js';
import { runCheck, printCheck, whoami } from './check.js';
import { runDetect, printDetect } from './detect.js';
import { startServe } from './serve.js';
import { renderEnv, runWithProxy, printSetup } from './setup.js';
import { routeDomains, DEFAULT_ROUTE_GROUPS, ROUTE_GROUPS } from './services.js';
import { c } from './ui.js';
import { parseArgs } from './args.js';
import { AUTHOR } from './brand.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const DEFAULT_LOCAL = 'http://127.0.0.1:8899';

const HELP = `
${c.bold('devunlock')} ${VERSION} — ИИ и dev-сервисы из России: проверка и раздельная маршрутизация

${c.bold('Команды')}
  check              что из ИИ и dev-сервисов работает с вашего IP и почему нет
    --proxy URL        проверить через прокси (socks5://127.0.0.1:10808, http://…)
    --only ai|dev      только одна группа
    --json             вывод в JSON
  detect             найти локальные прокси VPN-клиентов (v2rayN, Hiddify, Clash, NekoRay…)
  serve              умный прокси: ИИ через VPN, всё остальное напрямую
    --upstream URL     прокси VPN-клиента (без флага — найдётся автоматически)
    --port 8899        локальный порт   --host 127.0.0.1
    --groups ai,hashicorp,docker   какие группы доменов вести через VPN (по умолчанию ${DEFAULT_ROUTE_GROUPS.join(',')})
    --domain example.com   добавить свой домен (можно несколько раз)
    --all              весь трафик через VPN
    --verbose          писать в журнал и прямые соединения
  env                переменные прокси для терминала   --shell bash|fish|powershell|cmd
  run -- <команда>   запустить команду через прокси: npx devunlock run -- claude
  setup              как подключить Cursor, VS Code, JetBrains, Docker, браузер

${c.bold('Общие флаги')}
  --timeout 8        таймаут в секундах   --quiet   без рекламных ссылок

${c.bold('Быстрый старт')}
  npx devunlock check
  npx devunlock serve
  npx devunlock run -- claude

Исходники: ${AUTHOR.repo} · автор: ${AUTHOR.telegram}
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] || (opts.version ? 'version' : 'help');
  const timeout = Math.round(Number(opts.timeout || 8) * 1000);
  const quiet = opts.quiet || process.env.DEVUNLOCK_QUIET === '1';

  switch (cmd) {
    case 'check': {
      const proxy = parseProxy(opts.proxy);
      const groups = opts.only ? opts.only.split(',') : null;
      const report = await runCheck({ proxy, timeout, groups });
      if (opts.json) {
        console.log(JSON.stringify({
          ip: report.me.ip, country: report.me.country, via: proxy ? proxy.url : 'direct',
          services: report.results.map((r) => ({ id: r.svc.id, name: r.svc.name, group: r.svc.group, state: r.state, note: r.note, ms: r.ms })),
        }, null, 2));
      } else {
        printCheck(report, { proxy, quiet });
      }
      process.exitCode = report.results.some((r) => r.state === 'geo' || r.state === 'blocked') ? 2 : 0;
      break;
    }
    case 'detect': {
      const [found, direct] = await Promise.all([runDetect({ timeout }), whoami({ proxy: null, timeout })]);
      printDetect(found, direct);
      break;
    }
    case 'serve': {
      let upstream = parseProxy(opts.upstream);
      if (!upstream) {
        console.log(c.dim('Флаг --upstream не задан, ищу VPN-клиент…'));
        const [found, direct] = await Promise.all([runDetect({ timeout }), whoami({ proxy: null, timeout })]);
        const abroad = found.find((f) => f.result && f.result.country && f.result.country !== direct.country);
        if (!abroad) {
          printDetect(found, direct);
          console.error(c.red('Не нашёл прокси с выходом за границу. Укажите его явно: --upstream socks5://127.0.0.1:<порт>'));
          process.exit(1);
        }
        upstream = abroad.result.proxy;
        console.log(`Нашёл ${c.bold(upstream.url)} (${abroad.apps}), выход: ${abroad.result.country}`);
      }
      const groups = (opts.groups || DEFAULT_ROUTE_GROUPS.join(',')).split(',').filter(Boolean);
      const domains = routeDomains(groups, opts.domain);
      startServe({
        upstream, domains, all: opts.all, host: opts.host || '127.0.0.1',
        port: Number(opts.port || 8899), verbose: opts.verbose,
      });
      break;
    }
    case 'env':
      console.log(renderEnv(opts.proxy || DEFAULT_LOCAL, opts.shell));
      break;
    case 'run':
      runWithProxy(opts.proxy || DEFAULT_LOCAL, opts.rest);
      break;
    case 'setup':
      printSetup(opts.proxy || DEFAULT_LOCAL);
      break;
    case 'groups':
      for (const [g, list] of Object.entries(ROUTE_GROUPS)) console.log(`${c.bold(g)}: ${list.join(', ')}`);
      break;
    case 'version':
      console.log(VERSION);
      break;
    case 'help':
      console.log(HELP);
      break;
    default:
      console.error(c.red(`Неизвестная команда: ${cmd}`));
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(c.red(err.message));
  process.exit(1);
});
