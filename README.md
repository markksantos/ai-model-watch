# ai-model-watch

List the models each AI provider's API serves, and see what's new since the last time you looked. One command, no dependencies, Node 18+.

New models often show up in a provider's `/models` list before any announcement. `ai-model-watch` saves each provider's list, and on the next run prints only the model IDs that weren't there before. Run it by hand, from cron, or in CI with `--exit-code`.

```
$ ai-model-watch -p openrouter
2026-10-17T09:26:01.231Z
OpenRouter: 2 new
  + deepseek/deepseek-v4.1-flash-1017  DeepSeek: DeepSeek V4.1 Flash 1017 (listed as created 2026-10-17)
  + reflection/beam-1.0-501b-a23b  Reflection: Beam 1.0 501B A23B (listed as created 2026-10-16)
```

The first run records a baseline (`OpenRouter: 470 models recorded as the baseline`), so you only hear about changes after that.

## Providers

| Provider | Endpoint | Key |
|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | none, works out of the box |
| OpenAI | `GET https://api.openai.com/v1/models` | `OPENAI_API_KEY` |
| Anthropic | `GET https://api.anthropic.com/v1/models` (paginated) | `ANTHROPIC_API_KEY` |
| Google Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` (paginated) | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Mistral | `GET https://api.mistral.ai/v1/models` | `MISTRAL_API_KEY` |
| xAI | `GET https://api.x.ai/v1/models` | `XAI_API_KEY` |
| DeepSeek | `GET https://api.deepseek.com/models` | `DEEPSEEK_API_KEY` |

Listing models is free on every one of these APIs. Nothing is generated and no tokens are spent. A provider whose key isn't set is skipped. Keys are sent only to that provider and never printed.

## Install and run

```
npx github:markksantos/ai-model-watch
# or
git clone https://github.com/markksantos/ai-model-watch && node ai-model-watch/bin/ai-model-watch.js
```

```
ai-model-watch [options]
  -p, --providers <list>  openrouter,openai,anthropic,gemini,mistral,xai,deepseek (default: all with a key)
  -s, --state <file>      where the last-seen lists live (default: ~/.cache/ai-model-watch/state.json)
  -w, --watch <seconds>   keep running and check every N seconds (minimum 60)
      --removed           also print models that disappeared
      --json              JSON output
      --exit-code         exit 1 when anything new appears (for cron and CI)
  -q, --quiet             print only new models
```

### Cron

```
*/15 * * * * OPENAI_API_KEY=... ANTHROPIC_API_KEY=... ai-model-watch -q >> ~/model-drops.log
```

### GitHub Actions

[`examples/github-action.yml`](examples/github-action.yml) runs the check on a schedule, caches the state file between runs, and fails the job (so GitHub emails you) when a new model appears.

## Library

`npm install github:markksantos/ai-model-watch`, then:

```js
const { check, fetchProvider } = require('ai-model-watch');

const report = await check({ providers: ['openrouter', 'anthropic'] });
for (const p of report.providers) {
  for (const m of p.added || []) console.log(p.label, m.id);
}
```

`fetchProvider(id, { env, fetch })` returns `{ status: 'ok' | 'skipped' | 'error', models: [{ id, name, created }] }`. `check()` diffs against the state file and saves the new lists. A provider that errors keeps its last good list, so a failed request never makes the next run report the whole catalog as new.

## What a list can't tell you

A model ID in a `/models` list means the provider lists it. It doesn't prove the model answers requests yet, and some providers list models days before they are generally available. `created` is whatever date the provider reports, not when the model appeared.

The hosted version, **[ArtificialWatch](https://artificialwatch.com)**, polls these APIs plus the public catalogs every 60 seconds and confirms a detection on a second sweep before anything fires. Then it alerts you by email and Chrome push (free), or by text or phone call. Use it if you'd rather not keep a cron job running.

## License

MIT
