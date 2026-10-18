'use strict';

// A minimal Model Context Protocol server (stdio transport, newline-delimited
// JSON-RPC 2.0) exposing the library as two tools. No dependencies.

const { PROVIDERS, fetchProvider, check, defaultStatePath } = require('./index.js');
const { version } = require('./package.json');

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PROVIDER_IDS = Object.keys(PROVIDERS);

const TOOLS = [
  {
    name: 'check_new_models',
    title: 'Check for new AI models',
    description:
      "Fetch each provider's model list and report the model IDs that weren't there at the last check, " +
      'then save the new lists (the same state file the CLI uses). The first check records a baseline. ' +
      `Providers without an API key in the server's environment are skipped; OpenRouter needs none.`,
    inputSchema: {
      type: 'object',
      properties: {
        providers: {
          type: 'array',
          items: { type: 'string', enum: PROVIDER_IDS },
          description: 'Providers to check (default: all).',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'list_models',
    title: "List a provider's models",
    description:
      "List the model IDs one provider's API serves right now, optionally filtered by a substring. " +
      'Read-only: it does not touch the saved state.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: PROVIDER_IDS },
        search: { type: 'string', description: 'Case-insensitive substring to match in the model ID or name.' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum models to return (default 200).' },
      },
      required: ['provider'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

class ToolError extends Error {}

function day(created) {
  return created ? new Date(created * 1000).toISOString().slice(0, 10) : null;
}

function summarizeCheck(report) {
  const lines = [`Checked at ${report.checkedAt}. New models: ${report.newCount}.`];
  for (const e of report.providers) {
    if (e.status !== 'ok') lines.push(`${e.label}: ${e.status} (${e.error})`);
    else if (e.baseline) lines.push(`${e.label}: baseline recorded (${e.total} models); new ones show up from the next check.`);
    else if (!e.added.length) lines.push(`${e.label}: no new models (${e.total} listed).`);
    else {
      lines.push(`${e.label}: ${e.added.length} new`);
      for (const m of e.added) lines.push(`  + ${m.id}${m.name && m.name !== m.id ? ` (${m.name})` : ''}${m.created ? `, created ${day(m.created)}` : ''}`);
    }
  }
  return lines.join('\n');
}

function createServer({ env = process.env, fetch, statePath = defaultStatePath(env) } = {}) {
  const tools = {
    async check_new_models(args) {
      const providers = args.providers === undefined ? undefined : args.providers;
      if (providers !== undefined && (!Array.isArray(providers) || providers.some((p) => !PROVIDERS[p]))) {
        throw new ToolError(`providers must be a list drawn from: ${PROVIDER_IDS.join(', ')}`);
      }
      const report = await check({ providers, statePath, env, fetch });
      return { text: summarizeCheck(report), structured: report };
    },
    async list_models(args) {
      if (!PROVIDERS[args.provider]) throw new ToolError(`provider must be one of: ${PROVIDER_IDS.join(', ')}`);
      const limit = args.limit === undefined ? 200 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ToolError('limit must be an integer from 1 to 1000');
      const r = await fetchProvider(args.provider, { env, fetch });
      if (r.status !== 'ok') throw new ToolError(`${PROVIDERS[args.provider].label}: ${r.status} (${r.error})`);
      const q = typeof args.search === 'string' ? args.search.toLowerCase() : '';
      const matched = q ? r.models.filter((m) => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)) : r.models;
      const models = matched.slice(0, limit);
      const head = `${PROVIDERS[args.provider].label}: ${matched.length} model${matched.length === 1 ? '' : 's'}${q ? ` matching "${args.search}"` : ''}${models.length < matched.length ? `, showing ${models.length}` : ''}.`;
      return {
        text: [head, ...models.map((m) => m.id)].join('\n'),
        structured: { provider: args.provider, total: r.models.length, matched: matched.length, models },
      };
    },
  };

  // Returns the response object for a request, or null for a notification.
  async function handle(msg) {
    const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: isRequest ? msg.id : null, error: { code, message } });

    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return isRequest ? error(-32600, 'Invalid request') : null;
    }
    if (!isRequest) return null; // notifications (initialized, cancelled, ...) need no reply

    const params = msg.params || {};
    switch (msg.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ai-model-watch', title: 'AI Model Watch', version, websiteUrl: 'https://artificialwatch.com' },
          instructions:
            'Use check_new_models to see which AI models providers started serving since the last check, ' +
            'and list_models to look up what one provider serves now.',
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const tool = tools[params.name];
        if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
        try {
          const out = await tool(params.arguments || {});
          return reply({ content: [{ type: 'text', text: out.text }], structuredContent: out.structured, isError: false });
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          return reply({ content: [{ type: 'text', text: err.message }], isError: true });
        }
      }
      default:
        return error(-32601, `Method not found: ${msg.method}`);
    }
  }

  return { handle };
}

// Serve on stdio until stdin closes. Logs go to stderr; stdout carries only protocol messages.
function serve({ input = process.stdin, output = process.stdout, ...opts } = {}) {
  const server = createServer(opts);
  let buf = '';
  let pending = Promise.resolve();
  const send = (obj) => output.write(JSON.stringify(obj) + '\n');

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        pending = pending.then(() => send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        continue;
      }
      // Answer in arrival order.
      pending = pending.then(async () => {
        try {
          const res = await server.handle(msg);
          if (res) send(res);
        } catch (err) {
          process.stderr.write(`ai-model-watch mcp: ${err.stack || err}\n`);
          if (msg && msg.id !== undefined && msg.id !== null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Internal error' } });
        }
      });
    }
  });
  return new Promise((resolve) => input.on('end', () => pending.then(resolve)));
}

module.exports = { createServer, serve, TOOLS, PROTOCOL_VERSIONS };
