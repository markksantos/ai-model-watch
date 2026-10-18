#!/usr/bin/env node
'use strict';

const { PROVIDERS, check, defaultStatePath } = require('../index.js');

const HELP = `ai-model-watch: list the models each AI provider's API serves and show what's new since the last run.

Usage:
  ai-model-watch [options]

Options:
  -p, --providers <list>  comma-separated: ${Object.keys(PROVIDERS).join(',')}
                          (default: all; providers without a key are skipped)
  -s, --state <file>      where the last-seen lists live (default: ${defaultStatePath().replace(require('os').homedir(), '~')})
  -w, --watch <seconds>   keep running and check every N seconds (minimum 60)
      --removed           also print models that disappeared
      --json              JSON output
      --exit-code         exit 1 when anything new appears (for cron and CI)
  -q, --quiet             print only new models
      --mcp               run as an MCP server on stdio (Claude, Cursor, VS Code, ...)
  -h, --help              this help

Keys are read from the environment: ${Object.values(PROVIDERS).filter((p) => p.key).map((p) => p.key).join(', ')}.
OpenRouter needs no key. The first run records a baseline; later runs report the difference.
Hosted version with email, push, SMS and phone alerts: https://artificialwatch.com
`;

function parse(argv) {
  const o = { providers: null, state: null, watch: 0, removed: false, json: false, exitCode: false, quiet: false, mcp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0); }
    else if (a === '-p' || a === '--providers') o.providers = val().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '-s' || a === '--state') o.state = val();
    else if (a === '-w' || a === '--watch') o.watch = Number(val());
    else if (a === '--removed') o.removed = true;
    else if (a === '--json') o.json = true;
    else if (a === '--exit-code') o.exitCode = true;
    else if (a === '-q' || a === '--quiet') o.quiet = true;
    else if (a === '--mcp') o.mcp = true;
    else fail(`Unknown option ${a}`);
  }
  if (o.providers) {
    const bad = o.providers.filter((p) => !PROVIDERS[p]);
    if (bad.length) fail(`Unknown provider: ${bad.join(', ')}. Known: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  if (o.watch && (!Number.isFinite(o.watch) || o.watch < 60)) fail('--watch needs a number of seconds, 60 or more');
  return o;
}

function fail(msg) {
  process.stderr.write(`ai-model-watch: ${msg}\n`);
  process.exit(2);
}

function when(created) {
  return created ? ` (listed as created ${new Date(created * 1000).toISOString().slice(0, 10)})` : '';
}

function print(report, o) {
  if (o.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  const lines = [];
  for (const e of report.providers) {
    if (e.status !== 'ok') {
      if (!o.quiet) lines.push(`${e.label}: ${e.status === 'skipped' ? 'skipped' : 'error'} (${e.error})`);
      continue;
    }
    if (e.baseline) {
      if (!o.quiet) lines.push(`${e.label}: ${e.total} models recorded as the baseline`);
      continue;
    }
    if (e.added.length) {
      lines.push(`${e.label}: ${e.added.length} new`);
      for (const m of e.added) lines.push(`  + ${m.id}${m.name && m.name !== m.id ? `  ${m.name}` : ''}${when(m.created)}`);
    } else if (!o.quiet) {
      lines.push(`${e.label}: no new models (${e.total} listed)`);
    }
    if (o.removed && e.removed.length) {
      for (const id of e.removed) lines.push(`  - ${id}`);
    }
  }
  if (lines.length) process.stdout.write(`${o.quiet ? '' : `${report.checkedAt}\n`}${lines.join('\n')}\n`);
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.mcp) return require('../mcp.js').serve({ statePath: o.state || undefined });
  const opts = { providers: o.providers || undefined, statePath: o.state || undefined };
  let report = await check(opts);
  print(report, o);
  if (!o.watch) {
    process.exit(o.exitCode && report.newCount > 0 ? 1 : 0);
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, o.watch * 1000));
    report = await check(opts);
    print(report, { ...o, quiet: true });
  }
}

main().catch((err) => fail(err.message));
