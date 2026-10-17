'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchProvider, diffModels, check } = require('../index.js');

// A fake fetch that serves canned JSON by URL prefix and records the headers it saw.
function fakeFetch(routes, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url, headers: init.headers || {} });
    const hit = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const body = typeof routes[hit] === 'function' ? routes[hit](url) : routes[hit];
    if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

function tmpState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'amw-')), 'state.json');
}

test('openrouter needs no key and keeps id, name, created', async () => {
  const fetch = fakeFetch({ 'https://openrouter.ai/api/v1/models': { data: [{ id: 'b/two', name: 'B: Two', created: 1700000000 }, { id: 'a/one', name: 'A: One', created: 1690000000 }] } });
  const r = await fetchProvider('openrouter', { env: {}, fetch });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.models.map((m) => m.id), ['a/one', 'b/two']);
  assert.equal(r.models[1].created, 1700000000);
});

test('a provider without its key is skipped, not an error', async () => {
  const r = await fetchProvider('openai', { env: {}, fetch: fakeFetch({}) });
  assert.equal(r.status, 'skipped');
  assert.match(r.error, /OPENAI_API_KEY/);
});

test('openai sends a bearer token and parses data[]', async () => {
  const seen = [];
  const fetch = fakeFetch({ 'https://api.openai.com/v1/models': { object: 'list', data: [{ id: 'gpt-x', object: 'model', created: 1750000000, owned_by: 'openai' }] } }, seen);
  const r = await fetchProvider('openai', { env: { OPENAI_API_KEY: 'sk-test' }, fetch });
  assert.deepEqual(r.models, [{ id: 'gpt-x', name: null, created: 1750000000 }]);
  assert.equal(seen[0].headers.authorization, 'Bearer sk-test');
});

test('anthropic follows has_more pagination and converts created_at', async () => {
  const seen = [];
  const fetch = fakeFetch({
    'https://api.anthropic.com/v1/models': (url) =>
      url.includes('after_id=m2')
        ? { data: [{ id: 'm3', display_name: 'Model 3', created_at: '2026-01-02T00:00:00Z' }], has_more: false, last_id: 'm3' }
        : { data: [{ id: 'm1', display_name: 'Model 1', created_at: '2025-01-01T00:00:00Z' }, { id: 'm2', display_name: 'Model 2', created_at: '2025-06-01T00:00:00Z' }], has_more: true, last_id: 'm2' },
  }, seen);
  const r = await fetchProvider('anthropic', { env: { ANTHROPIC_API_KEY: 'k' }, fetch });
  assert.deepEqual(r.models.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(r.models[2].created, Date.parse('2026-01-02T00:00:00Z') / 1000);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].headers['x-api-key'], 'k');
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
});

test('gemini strips the models/ prefix, follows nextPageToken, accepts GOOGLE_API_KEY', async () => {
  const fetch = fakeFetch({
    'https://generativelanguage.googleapis.com/v1beta/models': (url) =>
      url.includes('pageToken=p2')
        ? { models: [{ name: 'models/gemini-b', displayName: 'Gemini B' }] }
        : { models: [{ name: 'models/gemini-a', displayName: 'Gemini A' }], nextPageToken: 'p2' },
  });
  const r = await fetchProvider('gemini', { env: { GOOGLE_API_KEY: 'g' }, fetch });
  assert.deepEqual(r.models.map((m) => m.id), ['gemini-a', 'gemini-b']);
});

test('an HTTP error is reported without the URL', async () => {
  const fetch = fakeFetch({ 'https://api.mistral.ai/v1/models': { __status: 401 } });
  const r = await fetchProvider('mistral', { env: { MISTRAL_API_KEY: 'bad' }, fetch });
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'HTTP 401');
});

test('diffModels: first run is a baseline, later runs report added and removed', () => {
  assert.deepEqual(diffModels(undefined, [{ id: 'a' }]), { baseline: true, added: [], removed: [] });
  const d = diffModels(['a', 'b'], [{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(d.added.map((m) => m.id), ['c']);
  assert.deepEqual(d.removed, ['b']);
});

test('check: baseline, then a new model, and an errored provider keeps its old list', async () => {
  const statePath = tmpState();
  let list = [{ id: 'x/old', name: 'Old', created: 1 }];
  let fail = false;
  const routes = { 'https://openrouter.ai/api/v1/models': () => (fail ? { __status: 503 } : { data: list }) };

  const r1 = await check({ providers: ['openrouter'], statePath, env: {}, fetch: fakeFetch(routes) });
  assert.equal(r1.providers[0].baseline, true);
  assert.equal(r1.newCount, 0);

  list = [...list, { id: 'x/new', name: 'New', created: 2 }];
  const r2 = await check({ providers: ['openrouter'], statePath, env: {}, fetch: fakeFetch(routes) });
  assert.deepEqual(r2.providers[0].added.map((m) => m.id), ['x/new']);
  assert.equal(r2.newCount, 1);

  fail = true;
  const r3 = await check({ providers: ['openrouter'], statePath, env: {}, fetch: fakeFetch(routes) });
  assert.equal(r3.providers[0].status, 'error');

  fail = false;
  const r4 = await check({ providers: ['openrouter'], statePath, env: {}, fetch: fakeFetch(routes) });
  assert.equal(r4.newCount, 0, 'a failed sweep must not make the next one report everything as new');
});
