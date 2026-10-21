// devunlock env / run / setup — подключение терминала, CLI-агентов и редакторов к прокси.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { c } from './ui.js';

export function proxyEnv(proxyUrl) {
  const noProxy = 'localhost,127.0.0.1,::1';
  return {
    HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl,
    NO_PROXY: noProxy, no_proxy: noProxy,
    // Node.js 22.21+/24+: встроенные fetch и http начинают учитывать переменные выше
    NODE_USE_ENV_PROXY: '1',
  };
}

export function defaultShell() {
  if (process.platform === 'win32') return process.env.PSModulePath ? 'powershell' : 'cmd';
  return (process.env.SHELL || '').includes('fish') ? 'fish' : 'bash';
}

export function renderEnv(proxyUrl, shell = defaultShell()) {
  const env = proxyEnv(proxyUrl);
  const line = {
    bash: (k, v) => `export ${k}="${v}"`,
    fish: (k, v) => `set -gx ${k} "${v}"`,
    powershell: (k, v) => `$env:${k}="${v}"`,
    cmd: (k, v) => `set ${k}=${v}`,
  }[shell];
  if (!line) throw new Error(`Неизвестная оболочка ${shell}. Есть: bash, fish, powershell, cmd`);
  return Object.entries(env).map(([k, v]) => line(k, v)).join('\n');
}

/** Запускает команду с переменными прокси — только для неё, остальная система не трогается. */
export function runWithProxy(proxyUrl, argv) {
  if (!argv.length) throw new Error('Укажите команду после --, например: npx devunlock run -- claude');
  const child = spawn(argv[0], argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...proxyEnv(proxyUrl) },
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
  child.on('error', (err) => {
    console.error(c.red(`Не удалось запустить ${argv[0]}: ${err.message}`));
    process.exit(127);
  });
}

function editorSettingsPath(app) {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), app, 'User', 'settings.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', app, 'User', 'settings.json');
  return path.join(home, '.config', app, 'User', 'settings.json');
}

export function printSetup(proxyUrl) {
  const u = new URL(proxyUrl);
  const shell = defaultShell();
  const h = (s) => console.log(`\n${c.bold(s)}`);

  console.log(`\n${c.bold('devunlock setup')} · как подключить инструменты к ${c.cyan(proxyUrl)}`);

  h('Cursor');
  console.log(`  Файл: ${c.dim(editorSettingsPath('Cursor'))}  (Ctrl/Cmd+Shift+P → «Open User Settings (JSON)»)`);
  console.log(c.cyan(`  "http.proxy": "${proxyUrl}",\n  "http.proxySupport": "override",\n  "cursor.general.disableHttp2": true,`));
  console.log(c.dim('  disableHttp2 нужен, потому что многие прокси плохо переносят HTTP/2 стримы Cursor.'));

  h('VS Code (Copilot и расширения)');
  console.log(`  Файл: ${c.dim(editorSettingsPath('Code'))}`);
  console.log(c.cyan(`  "http.proxy": "${proxyUrl}",\n  "http.proxySupport": "override",`));

  h('JetBrains (IDEA, PyCharm, WebStorm…) — для JetBrains AI');
  console.log(`  Settings → Appearance & Behavior → System Settings → HTTP Proxy → Manual proxy configuration`);
  console.log(`  HTTP, хост ${c.cyan(u.hostname)}, порт ${c.cyan(u.port || '80')}`);

  h('Claude Code, Codex CLI, Gemini CLI, aider и любые консольные инструменты');
  console.log(`  Только для одной команды:   ${c.cyan('npx devunlock run -- claude')}`);
  console.log(`  Для всего окна терминала:   ${c.cyan(`npx devunlock env --shell ${shell}`)} и выполнить вывод`);
  if (shell === 'powershell') console.log(`  Одной строкой (PowerShell): ${c.cyan(`npx devunlock env --shell powershell | Out-String | Invoke-Expression`)}`);
  if (shell === 'bash') console.log(`  Одной строкой (bash/zsh):   ${c.cyan(`eval "$(npx devunlock env --shell bash)"`)}`);

  h('Docker (pull образов)');
  console.log('  Docker Desktop: Settings → Resources → Proxies → Manual, оба поля:');
  console.log(`    ${c.cyan(proxyUrl)}`);
  console.log('  Linux (dockerd): /etc/systemd/system/docker.service.d/http-proxy.conf');
  console.log(c.cyan(`    [Service]\n    Environment="HTTP_PROXY=${proxyUrl}" "HTTPS_PROXY=${proxyUrl}" "NO_PROXY=localhost,127.0.0.1"`));
  console.log(c.dim('    затем: sudo systemctl daemon-reload && sudo systemctl restart docker'));
  console.log(c.dim('    Docker Hub по умолчанию идёт напрямую. Чтобы пустить его через VPN: serve --groups ai,hashicorp,docker'));

  h('Браузер');
  console.log(`  Firefox: Настройки → Сеть → Ручная настройка → HTTP-прокси ${c.cyan(u.hostname)}:${c.cyan(u.port || '80')}, «Также использовать для HTTPS».`);
  console.log('  Через devunlock serve ChatGPT и Claude откроются через VPN, остальные сайты — напрямую.\n');
}
