// Вывод в терминал: цвета (выключаются через NO_COLOR или при выводе не в терминал) и подписи.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'),
  yellow: paint('33'), blue: paint('34'), cyan: paint('36'),
};

export const STATE = {
  ok: { icon: '✅', label: 'работает', color: c.green },
  partial: { icon: '🟡', label: 'частично', color: c.yellow },
  geo: { icon: '🌍', label: 'закрыт для страны', color: c.yellow },
  blocked: { icon: '🚫', label: 'недоступен', color: c.red },
  unknown: { icon: '❔', label: 'непонятно', color: c.dim },
};

/** Строка с выравниванием по видимой ширине (без учёта ANSI-кодов). */
export function pad(s, width) {
  const visible = String(s).replace(/\x1b\[[0-9;]*m/g, '');
  return s + ' '.repeat(Math.max(0, width - [...visible].length));
}

/** Человеческое описание сетевой ошибки. */
export function explainError(err) {
  const code = err.code || '';
  if (err.stage === 'proxy') return `ошибка прокси: ${err.message}`;
  if (err.stage === 'dns') return 'DNS не находит адрес (блокировка или проблемы с DNS)';
  if (err.stage === 'tls' && code === 'TIMEOUT') return 'TLS-рукопожатие зависло — типичный признак блокировки или замедления провайдером';
  if (code === 'ECONNRESET') return 'соединение сброшено — похоже на блокировку провайдером (DPI)';
  if (code === 'ECONNREFUSED') return 'соединение отклонено';
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT') return 'нет ответа (таймаут) — адрес может быть заблокирован';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'сеть недоступна';
  return `${code || 'ошибка'}: ${err.message}`;
}

/** Склонение: plural(34, 'домен', 'домена', 'доменов') → «34 домена». */
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}
