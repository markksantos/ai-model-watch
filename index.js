'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Each provider: the env var holding its key (null = public), and a fetcher that
// returns [{ id, name, created }] for every model the API lists. `created` is a
// unix-seconds number when the API gives one, else null. A fetcher throws on a body
// that isn't the provider's list shape, on a bad model ID and on a page sequence it
// can't finish, so check() keeps the saved list instead of storing an empty or
// partial one.
const MAX_PAGES = 20;

const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    key: null,
    async list(get) {
      return singlePage(await get('https://openrouter.ai/api/v1/models'), (m) => str(m.name));
    },
  },
  openai: {
    label: 'OpenAI',
    key: 'OPENAI_API_KEY',
    async list(get, key) {
      return singlePage(await get('https://api.openai.com/v1/models', { authorization: `Bearer ${key}` }));
    },
  },
  anthropic: {
    label: 'Anthropic',
    key: 'ANTHROPIC_API_KEY',
    async list(get, key) {
      const out = [];
      let after = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = 'https://api.anthropic.com/v1/models?limit=1000' + (after ? `&after_id=${encodeURIComponent(after)}` : '');
        const body = await get(url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
        listField(body, 'data').forEach((m, i) => {
          const e = modelEntry(m, `data[${i}]`);
          const created = typeof e.created_at === 'string' ? Math.floor(Date.parse(e.created_at) / 1000) : null;
          out.push({ id: modelId(e.id, `data[${i}].id`), name: str(e.display_name), created: num(created) });
        });
        if (typeof body.has_more !== 'boolean') malformed('has_more is missing');
        if (!body.has_more) return out;
        if (typeof body.last_id !== 'string' || !body.last_id || body.last_id === after) malformed('has_more is set without a new last_id');
        after = body.last_id;
      }
      malformed(`more than ${MAX_PAGES} pages`);
    },
  },
  gemini: {
    label: 'Google Gemini',
    key: 'GEMINI_API_KEY',
    altKeys: ['GOOGLE_API_KEY'],
    async list(get, key) {
      const out = [];
      let token = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
        const body = await get(url, { 'x-goog-api-key': key });
        listField(body, 'models').forEach((m, i) => {
          const e = modelEntry(m, `models[${i}]`);
          if (typeof e.name !== 'string' || !e.name.startsWith('models/')) malformed(`models[${i}].name is not "models/<id>"`);
          out.push({ id: modelId(e.name.slice('models/'.length), `models[${i}].name`), name: str(e.displayName), created: null });
        });
        if (body.nextPageToken === undefined || body.nextPageToken === '') return out;
        if (typeof body.nextPageToken !== 'string' || body.nextPageToken === token) malformed('nextPageToken is not a new token');
        token = body.nextPageToken;
      }
      malformed(`more than ${MAX_PAGES} pages`);
    },
  },
  mistral: {
    label: 'Mistral',
    key: 'MISTRAL_API_KEY',
    async list(get, key) {
      return singlePage(await get('https://api.mistral.ai/v1/models', { authorization: `Bearer ${key}` }), (m) => str(m.name));
    },
  },
  xai: {
    label: 'xAI',
    key: 'XAI_API_KEY',
    async list(get, key) {
      return singlePage(await get('https://api.x.ai/v1/models', { authorization: `Bearer ${key}` }));
    },
  },
  deepseek: {
    label: 'DeepSeek',
    key: 'DEEPSEEK_API_KEY',
    async list(get, key) {
      return singlePage(await get('https://api.deepseek.com/models', { authorization: `Bearer ${key}` }));
    },
  },
};

// The OpenAI-style list ({ object: 'list', data: [{ id, created }] }) that OpenRouter,
// OpenAI, Mistral, xAI and DeepSeek return in one page.
function singlePage(body, name = () => null) {
  const data = listField(body, 'data');
  if (body.object !== undefined && body.object !== 'list') malformed('"object" is not "list"');
  if (body.has_more === true) malformed('has_more is set on a list that is read as one page');
  return data.map((m, i) => {
    const e = modelEntry(m, `data[${i}]`);
    return { id: modelId(e.id, `data[${i}].id`), name: name(e), created: num(e.created) };
  });
}

function malformed(what) {
  throw new Error(`malformed response: ${what}`);
}

function listField(body, field) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) malformed('not a JSON object');
  if (!Array.isArray(body[field])) malformed(`no "${field}" list`);
  return body[field];
}

function modelEntry(m, where) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) malformed(`${where} is not an object`);
  return m;
}

// IDs end up in terminals and state files: non-empty strings with no control characters.
function modelId(v, where) {
  if (typeof v !== 'string' || !v.trim() || v.length > 256 || /[\u0000-\u001f\u007f]/.test(v)) malformed(`${where} is not a valid model ID`);
  return v;
}

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function keyFor(provider, env) {
  const p = PROVIDERS[provider];
  if (!p.key) return '';
  for (const name of [p.key, ...(p.altKeys || [])]) {
    if (env[name]) return env[name];
  }
  return null;
}

function makeGetter(fetchImpl, timeoutMs) {
  return async function get(url, headers = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Redirects are never followed: fetch drops Authorization on a cross-origin
      // redirect but forwards x-api-key and x-goog-api-key, so a 3xx fails below.
      const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, redirect: 'manual', signal: ctrl.signal });
      if (!res.ok) {
        // Never echo the URL: Gemini-style keys can ride in query strings on other setups.
        throw new Error(`HTTP ${res.status}`);
      }
      try {
        return await res.json();
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error('response was not JSON'); // the parser's own message quotes the body
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// Fetch one provider. Returns { provider, status: 'ok' | 'skipped' | 'error', models?, error? }.
async function fetchProvider(provider, { env = process.env, fetch: fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider "${provider}". Known: ${Object.keys(PROVIDERS).join(', ')}`);
  const key = keyFor(provider, env);
  if (key === null) return { provider, status: 'skipped', error: `set ${p.key} to include ${p.label}` };
  try {
    const models = await p.list(makeGetter(fetchImpl, timeoutMs), key);
    const seen = new Map();
    for (const m of models) if (m.id && !seen.has(m.id)) seen.set(m.id, m);
    return { provider, status: 'ok', models: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  } catch (err) {
    return { provider, status: 'error', error: err.name === 'AbortError' ? 'timed out' : err.message };
  }
}

// prevIds: array of ids from the last run (or undefined on a first run).
function diffModels(prevIds, models) {
  if (!Array.isArray(prevIds)) return { baseline: true, added: [], removed: [] };
  const prev = new Set(prevIds);
  const next = new Set(models.map((m) => m.id));
  return {
    baseline: false,
    added: models.filter((m) => !prev.has(m.id)),
    removed: prevIds.filter((id) => !next.has(id)).sort(),
  };
}

function defaultStatePath(env = process.env) {
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'ai-model-watch', 'state.json');
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && s.providers ? s : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// One sweep: fetch every provider, diff against the saved state, save the new state.
// A provider that errors (HTTP, network, a malformed or cut-off response) or is
// skipped keeps its old saved list, so a blip never empties it and never reports
// the whole catalog as new on the next run.
async function check({ providers = Object.keys(PROVIDERS), statePath = defaultStatePath(), env = process.env, fetch: fetchImpl, now = new Date(), save = true } = {}) {
  const state = loadState(statePath);
  const results = await Promise.all(providers.map((p) => fetchProvider(p, { env, fetch: fetchImpl })));
  const report = { checkedAt: now.toISOString(), providers: [] };
  for (const r of results) {
    const entry = { provider: r.provider, label: PROVIDERS[r.provider].label, status: r.status };
    if (r.status === 'ok') {
      const prev = state.providers[r.provider];
      const d = diffModels(prev && prev.ids, r.models);
      Object.assign(entry, { total: r.models.length, baseline: d.baseline, added: d.added, removed: d.removed });
      state.providers[r.provider] = { checkedAt: report.checkedAt, ids: r.models.map((m) => m.id) };
    } else {
      entry.error = r.error;
    }
    report.providers.push(entry);
  }
  if (save) saveState(statePath, state);
  report.newCount = report.providers.reduce((n, e) => n + (e.added ? e.added.length : 0), 0);
  return report;
}

module.exports = { PROVIDERS, fetchProvider, diffModels, check, loadState, saveState, defaultStatePath };
