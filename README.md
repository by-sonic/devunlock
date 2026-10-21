<!-- ROSEVPN-BANNER-START -->
<p align="center">
  <a href="https://t.me/rosevpnru_bot">
    <img alt="RoseVPN — VPN с иностранными IP" src="https://img.shields.io/badge/%F0%9F%8C%B9%20RoseVPN-%D0%98%D0%BD%D0%BE%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%BD%D1%8B%D0%B9%20IP%20%D0%B4%D0%BB%D1%8F%20%D0%98%D0%98-E63946?style=for-the-badge&logo=telegram&logoColor=white&labelColor=1a1a1a" height="40"/>
  </a>
</p>
<p align="center">
  <sub>Нужен иностранный IP для ChatGPT, Claude и Cursor? <b>RoseVPN</b> · бесплатный пробный период · подключение за 30 секунд: <a href="https://t.me/rosevpnru_bot">@rosevpnru_bot</a></sub>
</p>
<!-- ROSEVPN-BANNER-END -->

---

# 🔓 devunlock

### ChatGPT, Claude, Gemini, Cursor и Copilot из России — без VPN на всю систему

**Одна команда покажет, что у вас закрыто и почему. Вторая — пустит через VPN только ИИ, а банки, Госуслуги и российские сайты оставит напрямую.**

```bash
npx devunlock check
```

Без установки, без зависимостей — только Node.js 18+. Весь код — восемь небольших файлов в [`src/`](src), его можно прочитать за 10 минут.

---

## 🤔 Зачем

OpenAI, Anthropic, Google Gemini, xAI и ряд dev-сервисов (Terraform, Vault) **сами не пускают пользователей из России** по IP. Это не блокировка провайдера — поэтому Zapret, GoodbyeDPI и смена DNS тут не помогают. Нужен иностранный IP.

Обычный VPN на всю систему решает это, но ломает остальное: банк ругается на заграничный вход, Госуслуги и маркетплейсы тормозят или требуют капчу, локальные сервисы отваливаются. Включать и выключать VPN по десять раз в день — так себе разработка.

**devunlock** делает три вещи:

1. 🔎 **Диагностика** — проверяет 15 ИИ и dev-сервисов и объясняет каждую проблему: «закрыто для страны», «сброс соединения провайдером», «DNS не находит адрес».
2. 🔀 **Раздельная маршрутизация** — локальный прокси, который отправляет через ваш VPN только домены ИИ, а всё остальное — напрямую.
3. ⚙️ **Настройка** — готовые настройки для Cursor, VS Code, JetBrains, Claude Code, Codex CLI, Docker и браузера.

---

## 🚀 Быстрый старт

### 1. Что у меня работает?

```bash
npx devunlock check
```

```
devunlock · проверка напрямую · IP 95.xx.xx.xx, страна RU

ИИ-сервисы
  🌍 OpenAI API / ChatGPT                     закрыто для вашей страны (HTTP 403)
  🌍 Anthropic API / Claude                   HTTP 403: доступ запрещён, похоже на блок по стране
  🟡 Google Gemini API                        сервер отвечает; страну без ключа не проверить — задайте GEMINI_API_KEY
  ✅ Cursor                                   сервер отвечает (HTTP 200) 212 мс
  ✅ Hugging Face                             HTTP 200 340 мс

Инструменты разработчика
  ✅ GitHub                                   HTTP 200 180 мс
  ✅ Docker Hub                               HTTP 401 410 мс
  🌍 HashiCorp releases (Terraform, Vault)    закрыто для вашей страны (HTTP 405)
  ...
```

> Пример вывода условный: что именно закрыто, зависит от вашего провайдера и от решений самих сервисов на сегодняшний день.

### 2. Найти свой VPN-клиент

Большинство VPN-клиентов (v2rayN, NekoRay, Hiddify, Clash, v2rayA) поднимают локальный прокси. devunlock найдёт его сам и покажет, в какую страну он выводит:

```bash
npx devunlock detect
```

```
  ✅ socks5://127.0.0.1:10808  v2rayN (SOCKS)  выход: NL, 45.xx.xx.xx
```

### 3. Пустить через VPN только ИИ

```bash
npx devunlock serve
```

На `http://127.0.0.1:8899` запускается прокси: OpenAI, Anthropic, Gemini, Cursor, Copilot, xAI, Mistral, Perplexity и HashiCorp идут через VPN, остальное — напрямую. В журнале видно каждое соединение через VPN.

Свой VPN-клиент можно указать явно: `--upstream socks5://127.0.0.1:10808` или `--upstream http://127.0.0.1:10809`.

### 4. Подключить инструменты

```bash
# одну команду
npx devunlock run -- claude
npx devunlock run -- codex
npx devunlock run -- gemini

# весь терминал (bash / zsh)
eval "$(npx devunlock env --shell bash)"

# весь терминал (PowerShell)
npx devunlock env --shell powershell | Out-String | Invoke-Expression

# Cursor, VS Code, JetBrains, Docker, браузер — пошаговые настройки
npx devunlock setup
```

Для Cursor, например, это три строки в `settings.json`:

```json
"http.proxy": "http://127.0.0.1:8899",
"http.proxySupport": "override",
"cursor.general.disableHttp2": true
```

---

## 📖 Все команды

| Команда | Что делает |
|---|---|
| `check` | Проверяет ИИ и dev-сервисы. `--proxy URL` — через прокси, `--only ai` / `--only dev`, `--json` для скриптов и CI |
| `detect` | Ищет локальные прокси VPN-клиентов и показывает страну выхода |
| `serve` | Умный прокси. `--upstream URL`, `--port`, `--groups ai,hashicorp,docker`, `--domain свой.домен`, `--all`, `--verbose` |
| `env` | Переменные `HTTPS_PROXY` и компания для `bash`, `fish`, `powershell`, `cmd` |
| `run -- <cmd>` | Запускает одну команду через прокси, остальная система не трогается |
| `setup` | Как подключить Cursor, VS Code, JetBrains, Claude Code, Docker, браузер |
| `groups` | Какие домены идут через VPN в каждой группе |

Общие флаги: `--timeout 8` (секунды), `--quiet` (без ссылок на VPN). Код возврата `check`: `0` — всё доступно, `2` — что-то закрыто.

### Gemini

Google без ключа не сообщает, разрешена ли ваша страна. Чтобы проверить точно, задайте ключ — он уходит только в Google, в заголовке `x-goog-api-key`:

```bash
GEMINI_API_KEY=... npx devunlock check --only ai
```

### Docker Hub

По умолчанию Docker Hub идёт напрямую: образы тяжёлые, и гонять их через VPN без нужды не стоит. Если у вас он закрыт — `npx devunlock serve --groups ai,hashicorp,docker`.

---

## 🔐 Безопасность и приватность

- **Без зависимостей.** Только стандартная библиотека Node.js — нечего подменять в цепочке поставок.
- **Ничего не отправляет автору.** Никакой телеметрии и аналитики. Запросы идут только к проверяемым сервисам и к `cloudflare.com/cdn-cgi/trace` — чтобы узнать ваш IP и страну.
- **Прокси слушает только `127.0.0.1`.** Снаружи к нему не подключиться, пока вы сами не укажете `--host`.
- **Ключи не нужны.** Проверка идёт по ответам API без авторизации. Исключение — необязательный `GEMINI_API_KEY`.
- **Ссылки на VPN** показываются только когда сервис закрыт для страны, а прокси не указан. Отключаются `--quiet` или `DEVUNLOCK_QUIET=1`.

---

## ❓ FAQ

**Это обход блокировок РКН?**
Нет. Речь о сервисах, которые сами закрыли доступ для российских IP. devunlock не взламывает и не маскирует трафик — он лишь показывает, что закрыто, и аккуратно направляет нужные домены через ваш собственный VPN или прокси.

**У меня нет VPN. devunlock даст иностранный IP?**
Нет, он работает поверх вашего VPN или прокси. Подойдёт любой клиент с локальным SOCKS5 или HTTP-прокси. Если подходящего нет — [RoseVPN](https://t.me/rosevpnru_bot) с бесплатным пробным периодом.

**Почему Node.js, а не готовый .exe?**
Разработчику проще выполнить `npx`, чем доверять неизвестному бинарнику. Код открыт и короткий.

**Cursor пишет «model not available in your region», хотя проверка зелёная.**
Проверка Cursor смотрит доступность сервера. Запрет отдельных моделей зависит от IP, с которого идут запросы редактора: подключите Cursor к `devunlock serve` (`npx devunlock setup`) и перезапустите его.

---

## 🛠 Разработка

```bash
git clone https://github.com/by-sonic/devunlock
cd devunlock
npm test
node src/cli.js check
```

Нашли сервис, который стоит проверять, или ложное срабатывание? Откройте issue или PR — список сервисов и доменов лежит в [`src/services.js`](src/services.js).

---

## 📬 Автор

Делаю инструменты для разработчиков в России: [TGLock](https://github.com/by-sonic/tglock), [UnblockPro](https://github.com/by-sonic/unblock-pro), [SonicBoost](https://github.com/by-sonic/SonicBoost).

Вопросы, идеи, заказная разработка — Telegram **[@sonic_h1](https://t.me/sonic_h1)**.

Лицензия — [MIT](LICENSE).
