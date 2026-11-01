'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('package, plugin, skill, Desktop extension and registry entry carry one version', () => {
  const { version } = JSON.parse(read('package.json'));
  for (const f of ['manifest.json', '.claude-plugin/plugin.json', 'server.json']) {
    assert.equal(JSON.parse(read(f)).version, version, f);
  }
  assert.match(read('skills/ai-model-watch/SKILL.md'), new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm'));
  const bundle = JSON.parse(read('server.json')).packages[0].identifier;
  assert.ok(bundle.endsWith(`/releases/download/v${version}/ai-model-watch-${version}.mcpb`), bundle);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${version.replace(/\./g, '\\.')} `, 'm'));
});
