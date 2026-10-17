'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Each provider: the env var holding its key (null = public), and a fetcher that
// returns [{ id, name, created }] for every model the API lists. `created` is a
// unix-seconds number when the API gives one, else null.
const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    key: null,
    async list(get) {
      const body = await get('https://openrouter.ai/api/v1/models');
      return (body.data || []).map((m) => ({ id: m.id, name: m.name || null, created: num(m.created) }));
    },
  },
  openai: {
    label: 'OpenAI',
    key: 'OPENAI_API_KEY',
    async list(get, key) {
      const body = await get('https://api.openai.com/v1/models', { authorization: `Bearer ${key}` });
      return (body.data || []).map((m) => ({ id: m.id, name: null, created: num(m.created) }));
    },
  },
  anthropic: {
    label: 'Anthropic',
    key: 'ANTHROPIC_API_KEY',
    async list(get, key) {
      const out = [];
      let after = null;
      for (let page = 0; page < 20; page++) {
        const url = 'https://api.anthropic.com/v1/models?limit=1000' + (after ? `&after_id=${encodeURIComponent(after)}` : '');
        const body = await get(url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
        for (const m of body.data || []) {
          out.push({ id: m.id, name: m.display_name || null, created: m.created_at ? Math.floor(Date.parse(m.created_at) / 1000) : null });
        }
        if (!body.has_more || !body.last_id) break;
        after = body.last_id;
      }
      return out;
    },
  },
  gemini: {
    label: 'Google Gemini',
    key: 'GEMINI_API_KEY',
    altKeys: ['GOOGLE_API_KEY'],
    async list(get, key) {
      const out = [];
      let token = null;
      for (let page = 0; page < 20; page++) {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
        const body = await get(url, { 'x-goog-api-key': key });
        for (const m of body.models || []) {
          out.push({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || null, created: null });
        }
        if (!body.nextPageToken) break;
        token = body.nextPageToken;
      }
      return out;
    },
  },
  mistral: {
    label: 'Mistral',
    key: 'MISTRAL_API_KEY',
    async list(get, key) {
      const body = await get('https://api.mistral.ai/v1/models', { authorization: `Bearer ${key}` });
      return (body.data || []).map((m) => ({ id: m.id, name: m.name || null, created: num(m.created) }));
    },
  },
  xai: {
    label: 'xAI',
    key: 'XAI_API_KEY',
    async list(get, key) {
      const body = await get('https://api.x.ai/v1/models', { authorization: `Bearer ${key}` });
      return (body.data || []).map((m) => ({ id: m.id, name: null, created: num(m.created) }));
    },
  },
  deepseek: {
    label: 'DeepSeek',
    key: 'DEEPSEEK_API_KEY',
    async list(get, key) {
      const body = await get('https://api.deepseek.com/models', { authorization: `Bearer ${key}` });
      return (body.data || []).map((m) => ({ id: m.id, name: null, created: num(m.created) }));
    },
  },
};

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
      const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
      if (!res.ok) {
        // Never echo the URL: Gemini-style keys can ride in query strings on other setups.
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
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
// A provider that errors or is skipped keeps its old saved list, so a blip never
// reports the whole catalog as new on the next run.
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
