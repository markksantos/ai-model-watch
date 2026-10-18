'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('../mcp.js');

function fakeFetch(routes) {
  return async (url) => {
    const hit = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const body = typeof routes[hit] === 'function' ? routes[hit](url) : routes[hit];
    return { ok: true, status: 200, json: async () => body };
  };
}

function tmpState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'amw-mcp-')), 'state.json');
}

const OR = 'https://openrouter.ai/api/v1/models';
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('initialize echoes a supported protocol version and advertises tools', async () => {
  const s = createServer({ env: {}, fetch: fakeFetch({}), statePath: tmpState() });
  const r = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, 'ai-model-watch');
  const r2 = await s.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(r2.result.protocolVersion, '2025-11-25');
});

test('notifications get no reply; unknown methods get -32601', async () => {
  const s = createServer({ env: {}, fetch: fakeFetch({}), statePath: tmpState() });
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const r = await s.handle({ jsonrpc: '2.0', id: 'x', method: 'resources/list' });
  assert.equal(r.error.code, -32601);
  assert.deepEqual((await s.handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
});

test('tools/list returns both tools with object input schemas', async () => {
  const s = createServer({ env: {}, fetch: fakeFetch({}), statePath: tmpState() });
  const { result } = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(result.tools.map((t) => t.name), ['check_new_models', 'list_models']);
  for (const t of result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('check_new_models records a baseline, then reports only the new ids', async () => {
  let data = [{ id: 'a/one', name: 'A: One' }];
  const s = createServer({ env: {}, fetch: fakeFetch({ [OR]: () => ({ data }) }), statePath: tmpState() });
  const first = await s.handle(call(1, 'check_new_models', { providers: ['openrouter'] }));
  assert.equal(first.result.isError, false);
  assert.match(first.result.content[0].text, /baseline recorded \(1 models\)/);
  data = [...data, { id: 'b/two', name: 'B: Two', created: 1760000000 }];
  const second = await s.handle(call(2, 'check_new_models', { providers: ['openrouter'] }));
  assert.equal(second.result.structuredContent.newCount, 1);
  assert.match(second.result.content[0].text, /\+ b\/two \(B: Two\), created 2025-10-09/);
});

test('list_models filters by substring and caps with limit, without saving state', async () => {
  const statePath = tmpState();
  const data = [{ id: 'x/alpha' }, { id: 'x/beta', name: 'Alpha Beta' }, { id: 'y/gamma' }];
  const s = createServer({ env: {}, fetch: fakeFetch({ [OR]: { data } }), statePath });
  const r = await s.handle(call(1, 'list_models', { provider: 'openrouter', search: 'ALPHA', limit: 1 }));
  assert.equal(r.result.structuredContent.matched, 2);
  assert.deepEqual(r.result.structuredContent.models.map((m) => m.id), ['x/alpha']);
  assert.match(r.result.content[0].text, /2 models matching "ALPHA", showing 1/);
  assert.equal(fs.existsSync(statePath), false);
});

test('bad arguments and skipped providers come back as tool errors, unknown tools as -32602', async () => {
  const s = createServer({ env: {}, fetch: fakeFetch({}), statePath: tmpState() });
  const bad = await s.handle(call(1, 'list_models', { provider: 'nope' }));
  assert.equal(bad.result.isError, true);
  const skipped = await s.handle(call(2, 'list_models', { provider: 'openai' }));
  assert.equal(skipped.result.isError, true);
  assert.match(skipped.result.content[0].text, /OPENAI_API_KEY/);
  const unknown = await s.handle(call(3, 'nope', {}));
  assert.equal(unknown.error.code, -32602);
});

test('the CLI speaks MCP over stdio with --mcp', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'ai-model-watch.js'), '--mcp', '--state', tmpState()], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write('not json\n');
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].result.serverInfo.name, 'ai-model-watch');
  assert.equal(msgs[1].error.code, -32700);
  assert.equal(msgs[2].result.tools.length, 2);
});
