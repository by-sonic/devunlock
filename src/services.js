// Какие сервисы проверяем и как по ответу понять, что доступ закрыт по стране.

const GEO_SIGNATURES = [
  'unsupported_country', 'country, region, or territory', 'not available in your',
  'location is not supported', 'not currently available in your region', 'unsupported region',
  'request not allowed', 'not supported in your region', 'region is not supported',
];

const hasGeoSignature = (body) => {
  const text = body.toLowerCase();
  return GEO_SIGNATURES.some((s) => text.includes(s));
};

/**
 * Общий разбор ответа: ok — статусы «сервер ответил, страна не мешает»,
 * 403/451 или текст про регион — закрыто по стране.
 */
function classify(res, okStatuses) {
  if (hasGeoSignature(res.body)) return { state: 'geo', note: `закрыто для вашей страны (HTTP ${res.status})` };
  if (okStatuses.includes(res.status)) return { state: 'ok', note: `HTTP ${res.status}` };
  if (res.status === 451) return { state: 'geo', note: 'HTTP 451: недоступно по юридическим причинам' };
  if (res.status === 403) return { state: 'geo', note: 'HTTP 403: доступ запрещён, похоже на блок по стране' };
  return { state: 'unknown', note: `неожиданный ответ HTTP ${res.status}` };
}

const reachable = (res) => ({ state: 'ok', note: `сервер отвечает (HTTP ${res.status})` });

export const SERVICES = [
  // ── ИИ ────────────────────────────────────────────────────────────────
  {
    id: 'openai', name: 'OpenAI API / ChatGPT', group: 'ai',
    url: 'https://api.openai.com/v1/models',
    classify: (res) => classify(res, [200, 401]),
  },
  {
    id: 'anthropic', name: 'Anthropic API / Claude', group: 'ai',
    url: 'https://api.anthropic.com/v1/models',
    headers: { 'anthropic-version': '2023-06-01' },
    classify: (res) => classify(res, [200, 401]),
  },
  {
    id: 'gemini', name: 'Google Gemini API', group: 'ai',
    // Без ключа Google не говорит, разрешена ли страна, — только с GEMINI_API_KEY.
    build: (env) => {
      const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
      if (!key) return { url: 'https://generativelanguage.googleapis.com/v1beta/models', keyless: true };
      const model = env.DEVUNLOCK_GEMINI_MODEL || 'gemini-2.5-flash';
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: { contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } },
      };
    },
    classify: (res, req) => {
      if (req.keyless) {
        if (hasGeoSignature(res.body)) return { state: 'geo', note: 'закрыто для вашей страны' };
        return { state: 'partial', note: 'сервер отвечает; страну без ключа не проверить — задайте GEMINI_API_KEY' };
      }
      if (res.status === 404) return { state: 'unknown', note: 'модель не найдена — задайте DEVUNLOCK_GEMINI_MODEL' };
      return classify(res, [200]);
    },
  },
  {
    id: 'xai', name: 'xAI Grok API', group: 'ai',
    url: 'https://api.x.ai/v1/models',
    classify: (res) => classify(res, [200, 400, 401]),
  },
  {
    id: 'mistral', name: 'Mistral API', group: 'ai',
    url: 'https://api.mistral.ai/v1/models',
    classify: (res) => classify(res, [200, 401]),
  },
  {
    id: 'cursor', name: 'Cursor', group: 'ai',
    url: 'https://api2.cursor.sh/',
    note: 'проверяется доступность сервера; запрет отдельных моделей виден только в редакторе',
    classify: (res) => (hasGeoSignature(res.body) ? classify(res, []) : reachable(res)),
  },
  {
    id: 'copilot', name: 'GitHub Copilot', group: 'ai',
    url: 'https://api.githubcopilot.com/',
    classify: (res) => (hasGeoSignature(res.body) ? classify(res, []) : reachable(res)),
  },
  {
    id: 'huggingface', name: 'Hugging Face', group: 'ai',
    url: 'https://huggingface.co/api/models?limit=1',
    classify: (res) => classify(res, [200]),
  },

  // ── Инструменты разработчика ──────────────────────────────────────────
  {
    id: 'github', name: 'GitHub', group: 'dev',
    url: 'https://api.github.com/',
    classify: (res) => (res.status === 403 && /rate limit/i.test(res.body)
      ? { state: 'ok', note: 'работает (упёрлись в лимит запросов)' }
      : classify(res, [200])),
  },
  {
    id: 'npm', name: 'npm registry', group: 'dev',
    url: 'https://registry.npmjs.org/-/ping',
    classify: (res) => classify(res, [200]),
  },
  {
    id: 'pypi', name: 'PyPI', group: 'dev',
    url: 'https://pypi.org/simple/pip/',
    classify: (res) => classify(res, [200]),
  },
  {
    id: 'goproxy', name: 'Go modules (proxy.golang.org)', group: 'dev',
    url: 'https://proxy.golang.org/golang.org/x/net/@v/list',
    classify: (res) => classify(res, [200]),
  },
  {
    id: 'docker', name: 'Docker Hub', group: 'dev',
    url: 'https://registry-1.docker.io/v2/',
    classify: (res) => classify(res, [200, 401]),
  },
  {
    id: 'hashicorp', name: 'HashiCorp releases (Terraform, Vault)', group: 'dev',
    url: 'https://releases.hashicorp.com/terraform/',
    classify: (res) => (res.status === 405 ? { state: 'geo', note: 'закрыто для вашей страны (HTTP 405)' } : classify(res, [200])),
  },
  {
    id: 'terraform-registry', name: 'Terraform Registry', group: 'dev',
    url: 'https://registry.terraform.io/v1/providers/hashicorp/aws',
    classify: (res) => (res.status === 405 ? { state: 'geo', note: 'закрыто для вашей страны (HTTP 405)' } : classify(res, [200])),
  },
];

/**
 * Домены, которые умный прокси (`devunlock serve`) отправляет через VPN.
 * Всё остальное идёт напрямую.
 */
export const ROUTE_GROUPS = {
  ai: [
    'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'sora.com',
    'anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com',
    'generativelanguage.googleapis.com', 'gemini.google.com', 'aistudio.google.com',
    'ai.google.dev', 'notebooklm.google.com', 'labs.google',
    'x.ai', 'grok.com', 'mistral.ai', 'perplexity.ai',
    'cursor.sh', 'cursor.com', 'cursorapi.com',
    'githubcopilot.com', 'copilot.microsoft.com',
    'codeium.com', 'windsurf.com', 'v0.dev', 'bolt.new', 'replit.com', 'lovable.dev',
  ],
  hashicorp: ['hashicorp.com', 'terraform.io', 'vaultproject.io', 'consul.io'],
  docker: ['docker.io', 'docker.com'],
};

export const DEFAULT_ROUTE_GROUPS = ['ai', 'hashicorp'];

export function routeDomains(groups, extra = []) {
  const out = new Set(extra.map((d) => d.toLowerCase().replace(/^\*?\./, '')));
  for (const g of groups) {
    if (!ROUTE_GROUPS[g]) throw new Error(`Нет такой группы доменов: ${g}. Есть: ${Object.keys(ROUTE_GROUPS).join(', ')}`);
    for (const d of ROUTE_GROUPS[g]) out.add(d);
  }
  return [...out];
}

/** true, если host — один из доменов списка или его поддомен. */
export function matchesDomain(host, domains) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}
