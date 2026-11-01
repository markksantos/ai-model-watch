'use strict';

// A response only replaces a saved list when it has the provider's real shape and
// the full page sequence. Anything else is an error, and the old list is kept.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PROVIDERS, fetchProvider, check } = require('../index.js');

const API = {
  openrouter: { url: 'https://openrouter.ai/api/v1/models', env: {} },
  openai: { url: 'https://api.openai.com/v1/models', env: { OPENAI_API_KEY: 'k' } },
  anthropic: { url: 'https://api.anthropic.com/v1/models', env: { ANTHROPIC_API_KEY: 'k' } },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models', env: { GEMINI_API_KEY: 'k' } },
  mistral: { url: 'https://api.mistral.ai/v1/models', env: { MISTRAL_API_KEY: 'k' } },
  xai: { url: 'https://api.x.ai/v1/models', env: { XAI_API_KEY: 'k' } },
  deepseek: { url: 'https://api.deepseek.com/models', env: { DEEPSEEK_API_KEY: 'k' } },
};

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
}

// Serves `respond(url)` for every request (a body, or { __status }) and records each request.
function fakeFetch(respond, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url, init });
    const body = respond(url);
    if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({}) };
    if (body && body.__notJson) {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token '<', "${body.__notJson}" is not valid JSON`); } };
    }
    return { ok: true, status: 200, json: async () => body };
  };
}

// A valid one-page response listing `ids`, in each provider's own shape.
function page(provider, ids) {
  if (provider === 'gemini') return { models: ids.map((id) => ({ name: `models/${id}` })) };
  if (provider === 'anthropic') return { data: ids.map((id) => ({ id })), has_more: false, first_id: ids[0] || null, last_id: ids[ids.length - 1] || null };
  return { object: 'list', data: ids.map((id) => ({ id })) };
}

// A valid response whose model list holds `entries` as given.
function withEntries(provider, entries) {
  const body = page(provider, []);
  body[provider === 'gemini' ? 'models' : 'data'] = entries;
  return body;
}

function tmpState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'amw-')), 'state.json');
}

test('fixtures in each provider\'s real response shape parse to their model IDs', async () => {
  const want = {
    openrouter: ['anthropic/claude-sonnet-4', 'openai/gpt-4o'],
    openai: ['gpt-4o', 'text-embedding-3-small'],
    anthropic: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514'],
    gemini: ['gemini-2.5-pro', 'text-embedding-004'],
    mistral: ['mistral-large-latest'],
    xai: ['grok-4'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  };
  const serve = {
    anthropic: (url) => fixture(url.includes('after_id=') ? 'anthropic-page-2' : 'anthropic-page-1'),
    gemini: (url) => fixture(url.includes('pageToken=') ? 'gemini-page-2' : 'gemini-page-1'),
  };
  assert.deepEqual(Object.keys(want).sort(), Object.keys(PROVIDERS).sort());
  for (const provider of Object.keys(want)) {
    const r = await fetchProvider(provider, { env: API[provider].env, fetch: fakeFetch(serve[provider] || (() => fixture(provider))) });
    assert.equal(r.status, 'ok', `${provider}: ${r.error}`);
    assert.deepEqual(r.models.map((m) => m.id), want[provider], provider);
  }
});

test('a genuinely empty list in the right shape is a valid empty result', async () => {
  for (const provider of Object.keys(API)) {
    const r = await fetchProvider(provider, { env: API[provider].env, fetch: fakeFetch(() => page(provider, [])) });
    assert.equal(r.status, 'ok', provider);
    assert.deepEqual(r.models, [], provider);
  }
});

// Bodies every provider must reject: wrong shape, bad entries, bad model IDs.
function malformed(provider) {
  const gemini = provider === 'gemini';
  const entry = (id) => (gemini ? { name: typeof id === 'string' ? `models/${id}` : id } : { id });
  return {
    'the review\'s HTTP-200 wrong-shape body': { unexpected: 'not a model-list response' },
    'a null body': null,
    'an array body': [],
    'a string body': 'ok',
    'a list field that is not an array': withEntries(provider, {}),
    'a list field that is null': withEntries(provider, null),
    'an entry that is not an object': withEntries(provider, ['model-a']),
    'an entry without an ID': withEntries(provider, [entry('model-a'), gemini ? { displayName: 'x' } : { name: 'x' }]),
    'a numeric ID': withEntries(provider, [entry(42)]),
    'an empty ID': withEntries(provider, [entry('')]),
    'an ID with control characters': withEntries(provider, [entry('model\u001b[2J')]),
  };
}

for (const provider of Object.keys(API)) {
  test(`${provider}: malformed responses are errors, never an empty or partial list`, async () => {
    for (const [what, body] of Object.entries(malformed(provider))) {
      const r = await fetchProvider(provider, { env: API[provider].env, fetch: fakeFetch(() => body) });
      assert.equal(r.status, 'error', `${provider}, ${what}: got ${r.status}`);
      assert.equal(r.models, undefined, `${provider}, ${what}`);
    }
  });
}

test('single-page providers reject an "object" other than "list" and an unread has_more', async () => {
  for (const provider of ['openai', 'mistral', 'xai', 'deepseek']) {
    for (const body of [{ ...page(provider, ['m']), object: 'error' }, { ...page(provider, ['m']), has_more: true }]) {
      const r = await fetchProvider(provider, { env: API[provider].env, fetch: fakeFetch(() => body) });
      assert.equal(r.status, 'error', `${provider}: ${JSON.stringify(body)}`);
    }
  }
});

test('anthropic: missing has_more, has_more without a new last_id, and endless pages are errors', async () => {
  const cases = {
    'no has_more': () => ({ data: [{ id: 'm1' }] }),
    'has_more without last_id': () => ({ data: [{ id: 'm1' }], has_more: true }),
    'last_id that never advances': () => ({ data: [{ id: 'm1' }], has_more: true, last_id: 'm1' }),
    'more pages than the cap': (url) => {
      const n = Number((url.match(/after_id=m(\d+)/) || [0, 0])[1]) + 1;
      return { data: [{ id: `m${n}` }], has_more: true, last_id: `m${n}` };
    },
  };
  for (const [what, respond] of Object.entries(cases)) {
    const r = await fetchProvider('anthropic', { env: API.anthropic.env, fetch: fakeFetch(respond) });
    assert.equal(r.status, 'error', what);
  }
});

test('gemini: a name without "models/", a bad page token, and endless pages are errors', async () => {
  const cases = {
    'name without models/': () => ({ models: [{ name: 'gemini-x' }] }),
    'numeric nextPageToken': () => ({ models: [{ name: 'models/a' }], nextPageToken: 7 }),
    'nextPageToken that never advances': () => ({ models: [{ name: 'models/a' }], nextPageToken: 't' }),
    'more pages than the cap': (url) => {
      const n = Number((url.match(/pageToken=t(\d+)/) || [0, 0])[1]) + 1;
      return { models: [{ name: `models/m${n}` }], nextPageToken: `t${n}` };
    },
  };
  for (const [what, respond] of Object.entries(cases)) {
    const r = await fetchProvider('gemini', { env: API.gemini.env, fetch: fakeFetch(respond) });
    assert.equal(r.status, 'error', what);
  }
});

test('a 200 that is not JSON is an error that does not echo the body', async () => {
  const r = await fetchProvider('openrouter', { env: {}, fetch: fakeFetch(() => ({ __notJson: '<html>gateway</html>' })) });
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'response was not JSON');
});

for (const provider of Object.keys(API)) {
  test(`${provider}: check() keeps the last good list when a response is malformed or truncated`, async () => {
    const statePath = tmpState();
    const bad = [
      { unexpected: 'not a model-list response' },
      withEntries(provider, [provider === 'gemini' ? { name: 'models/synthetic-existing-model' } : { id: 'synthetic-existing-model' }, {}]),
    ];
    let serve = () => page(provider, ['synthetic-existing-model']);
    const run = () => check({ providers: [provider], statePath, env: API[provider].env, fetch: fakeFetch((url) => serve(url)) });

    const first = await run();
    assert.equal(first.providers[0].baseline, true);
    const saved = fs.readFileSync(statePath, 'utf8');

    for (const body of bad) {
      serve = () => body;
      const r = await run();
      assert.equal(r.providers[0].status, 'error', provider);
      assert.equal(r.providers[0].removed, undefined, 'a bad response must not report the saved models as removed');
      assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), JSON.parse(saved), 'the saved list must be untouched');
    }

    serve = () => page(provider, ['synthetic-existing-model', 'new-model']);
    const after = await run();
    assert.deepEqual(after.providers[0].added.map((m) => m.id), ['new-model']);
    assert.deepEqual(after.providers[0].removed, []);
  });
}

test('every request refuses redirects', async () => {
  for (const provider of Object.keys(API)) {
    const seen = [];
    await fetchProvider(provider, { env: API[provider].env, fetch: fakeFetch(() => page(provider, ['m']), seen) });
    assert.ok(seen.length > 0, provider);
    for (const s of seen) assert.equal(s.init.redirect, 'manual', provider);
  }
});

test('a redirect to another host is not followed, so x-api-key and x-goog-api-key stay home', async () => {
  const listen = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const leaked = [];
  const other = await listen((req, res) => {
    leaked.push(req.headers);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [], has_more: false, models: [] }));
  });
  const origin = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${other.address().port}${req.url}` });
    res.end();
  });
  try {
    for (const provider of ['anthropic', 'gemini']) {
      // The real fetch, sent to the local server instead of the provider's host.
      const fetch = (url, init) => globalThis.fetch(url.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${origin.address().port}`), init);
      const r = await fetchProvider(provider, { env: { ANTHROPIC_API_KEY: 'secret-a', GEMINI_API_KEY: 'secret-g' }, fetch });
      assert.equal(r.status, 'error', provider);
      assert.match(r.error, /^HTTP 302/, provider);
    }
    assert.equal(leaked.length, 0, 'the redirect target must never be contacted');
  } finally {
    for (const s of [origin, other]) {
      s.closeAllConnections();
      s.close();
    }
  }
});
