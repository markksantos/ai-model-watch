# Changelog

## 1.1.0 (2026-10-18)

- `--mcp`: run as a Model Context Protocol server on stdio with two tools, `check_new_models` and `list_models`. Still no dependencies.

## 1.0.0 (2026-10-17)

- First release: OpenRouter (no key), OpenAI, Anthropic, Google Gemini, Mistral, xAI and DeepSeek model lists.
- Baseline on first run, then new (and with `--removed`, removed) model IDs per provider.
- `--watch`, `--json`, `--exit-code`, `--quiet`; state file in `~/.cache/ai-model-watch/`.
- A provider that errors keeps its last good list.
