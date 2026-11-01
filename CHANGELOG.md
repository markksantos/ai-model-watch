# Changelog

## 1.2.0 (2026-10-31)

- A response that isn't the provider's list shape is now an error, not an empty catalog. Before this, an HTTP 200 with the wrong JSON (say `{ "unexpected": ... }`) was read as zero models, reported every saved model as removed and overwrote the saved list. Each provider's shape is checked: the list field, every entry, every model ID (a non-empty string with no control characters), Gemini's `models/` prefix, Anthropic's `has_more`/`last_id`, and an unread `has_more` on single-page lists. A non-JSON body is an error too.
- Pagination that can't finish (more than 20 pages, a missing or repeating cursor) is an error instead of a silently partial list.
- On any of these errors the provider keeps its last good list, as it already did for HTTP and network errors.
- Redirects are never followed. Node's fetch drops `Authorization` on a cross-origin redirect but forwarded `x-api-key` (Anthropic) and `x-goog-api-key` (Gemini).
- Versions line up: the package, plugin, skill, Desktop extension and registry entry are all 1.2.0, and a test keeps them in step.

## 1.1.0 (2026-10-18)

- `--mcp`: run as a Model Context Protocol server on stdio with two tools, `check_new_models` and `list_models`. Still no dependencies.

## 1.0.0 (2026-10-17)

- First release: OpenRouter (no key), OpenAI, Anthropic, Google Gemini, Mistral, xAI and DeepSeek model lists.
- Baseline on first run, then new (and with `--removed`, removed) model IDs per provider.
- `--watch`, `--json`, `--exit-code`, `--quiet`; state file in `~/.cache/ai-model-watch/`.
- A provider that errors keeps its last good list.
