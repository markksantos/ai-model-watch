# Changelog

## 1.0.0 (2026-10-17)

- First release: OpenRouter (no key), OpenAI, Anthropic, Google Gemini, Mistral, xAI and DeepSeek model lists.
- Baseline on first run, then new (and with `--removed`, removed) model IDs per provider.
- `--watch`, `--json`, `--exit-code`, `--quiet`; state file in `~/.cache/ai-model-watch/`.
- A provider that errors keeps its last good list.
