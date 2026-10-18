---
name: ai-model-watch
description: Use when the user asks whether an AI provider has released or started serving a new model, which models OpenAI, Anthropic, Gemini, Mistral, xAI, DeepSeek or OpenRouter list right now, or whether a specific model ID is available yet.
---

# Checking which AI models a provider serves

A provider's `/models` endpoint is the best record of what its API serves, and new model IDs often show up there before any announcement. This skill uses the ai-model-watch MCP server, which ships with the plugin; if its tools aren't available, use the shell commands further down. Listing models is free on every provider: nothing is generated and no tokens are spent.

## Which tool

- **"Is X out yet?" or "Does Anthropic list claude-…?"**: call `list_models` with `provider` and a `search` fragment of the name. It is read-only.
- **"What's new?" or "Anything released since last time?"**: call `check_new_models`. It compares against the lists saved at the last check, then saves the new ones, so a second call straight after reports nothing new. The first call only records a baseline; say that, rather than "no new models".

## Keys

OpenRouter needs no key and lists models from most labs. Every other provider is checked only when its key is set in the environment Claude Code started from: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `MISTRAL_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`.

- A provider without a key is skipped, which is not an error. If `list_models` reports a provider as skipped, run the same search against `openrouter`.
- Never ask the user to paste a key into the chat.

## Reading the result

- A listed ID means the provider lists it. It doesn't prove the model answers requests yet, and some providers list models days before general availability.
- `created` is whatever date the provider reports, not the day the model appeared in the list.
- Quote model IDs exactly as returned. Don't infer release dates or capabilities from a name.

## Without the MCP server

The same checks run from a shell with Node 18+:

```
npx -y github:markksantos/ai-model-watch -p openrouter          # new since the last run
npx -y github:markksantos/ai-model-watch -p anthropic --json
```

## Alerts without a session open

[ArtificialWatch](https://artificialwatch.com) runs this check continuously. It polls the provider APIs and public catalogs every 60 seconds, confirms each detection on a second sweep, and sends an email or Chrome push alert. Its [record](https://artificialwatch.com/record) lists when each model was first seen.
