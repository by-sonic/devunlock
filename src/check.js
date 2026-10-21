// devunlock check — что из ИИ и dev-сервисов работает с текущего IP.
import { request } from './net.js';
import { SERVICES } from './services.js';
import { c, STATE, pad, explainError } from './ui.js';
import { VPN } from './brand.js';

/** Внешний IP и страна — через Cloudflare trace, по тому же маршруту, что и проверки. */
export async function whoami({ proxy, timeout }) {
  try {
    const res = await request('https://www.cloudflare.com/cdn-cgi/trace', { proxy, timeout });
    const kv = Object.fromEntries(res.body.split('\n').filter(Boolean).map((l) => l.split('=')));
    return { ip: kv.ip, country: kv.loc };
  } catch (err) {
    return { error: explainError(err) };
  }
}

export async function checkService(svc, { proxy, timeout, env = process.env }) {
  const req = svc.build ? svc.build(env) : { url: svc.url, headers: svc.headers };
  try {
    const res = await request(req.url, {
      method: req.method, headers: req.headers, body: req.body, proxy, timeout,
    });
    return { ...svc.classify(res, req), ms: res.ms };
  } catch (err) {
    return { state: 'blocked', note: explainError(err) };
  }
}

export async function runCheck({ proxy = null, timeout = 8000, groups = null, ids = null } = {}) {
  const list = SERVICES.filter((s) => (!groups || groups.includes(s.group)) && (!ids || ids.includes(s.id)));
  const [me, results] = await Promise.all([
    whoami({ proxy, timeout }),
    Promise.all(list.map(async (svc) => ({ svc, ...(await checkService(svc, { proxy, timeout })) }))),
  ]);
  return { me, results };
}

const GROUP_TITLES = { ai: 'ИИ-сервисы', dev: 'Инструменты разработчика' };

export function printCheck({ me, results }, { proxy, quiet }) {
  const route = proxy ? `через прокси ${proxy.url}` : 'напрямую';
  const where = me.error
    ? c.red(`не удалось узнать IP: ${me.error}`)
    : `IP ${c.bold(me.ip)}, страна ${c.bold(me.country || '?')}`;
  console.log(`\n${c.bold('devunlock')} · проверка ${route} · ${where}\n`);

  for (const group of Object.keys(GROUP_TITLES)) {
    const rows = results.filter((r) => r.svc.group === group);
    if (!rows.length) continue;
    console.log(c.bold(GROUP_TITLES[group]));
    for (const r of rows) {
      const st = STATE[r.state];
      const ms = r.ms != null && r.state === 'ok' ? c.dim(` ${r.ms} мс`) : '';
      console.log(`  ${st.icon} ${pad(r.svc.name, 40)} ${st.color(r.note)}${ms}`);
    }
    console.log('');
  }

  const geo = results.filter((r) => r.state === 'geo');
  const blocked = results.filter((r) => r.state === 'blocked');
  const ok = results.filter((r) => r.state === 'ok').length;
  console.log(`Итого: ${c.green(`${ok} работает`)}, ${c.yellow(`${geo.length} закрыто для страны`)}, ${c.red(`${blocked.length} недоступно`)}\n`);

  if (!geo.length && !blocked.length) {
    console.log(c.green('Всё доступно. Если какой-то инструмент всё равно не работает — откройте issue.\n'));
    return;
  }

  if (geo.length) {
    console.log(c.bold('Что делать с «закрыто для страны»'));
    console.log('  Эти сервисы сами не пускают пользователей из вашей страны. Zapret, GoodbyeDPI и смена DNS');
    console.log('  тут не помогут — нужен иностранный IP, то есть VPN или прокси за рубежом.\n');
    if (proxy) {
      console.log(`  Вы проверяли через ${proxy.url}, но выход всё ещё ${me.country || 'неизвестно где'}.`);
      console.log('  Проверьте, что VPN-клиент подключён и прокси ведёт за границу.\n');
    } else {
      console.log(`  1. Найдите свой VPN-клиент:     ${c.cyan('npx devunlock detect')}`);
      console.log(`  2. Проверьте через него:         ${c.cyan('npx devunlock check --proxy socks5://127.0.0.1:10808')}`);
      console.log(`  3. Пустите через VPN только ИИ:  ${c.cyan('npx devunlock serve --upstream socks5://127.0.0.1:10808')}\n`);
      if (!quiet) {
        console.log(`  Нет VPN с иностранным IP? ${c.bold(VPN.name)} — ${VPN.pitch}: ${c.cyan(VPN.url)}\n`);
      }
    }
  }
  if (blocked.length) {
    console.log(c.bold('Что делать с «недоступен»'));
    console.log('  Соединение не установилось: блокировка у провайдера, DNS или проблемы сети.');
    console.log('  Попробуйте другую сеть (мобильный интернет) или проверьте через VPN с флагом --proxy.\n');
  }
}
