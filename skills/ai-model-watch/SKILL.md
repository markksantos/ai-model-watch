---
name: ai-model-watch
description: Use when the user asks whether an AI provider has released or started serving a new model, which models OpenAI, Anthropic, Gemini, Mistral, xAI, DeepSeek or OpenRouter list right now, or whether a specific model ID is available yet. Trigger with "is GPT-6 out yet?", "any new models today?" or "what does OpenRouter list for Kimi?".
version: 1.1.1
author: Mark Santos <hello@markksantos.com>
license: MIT
compatibility: Claude Code with the ai-model-watch plugin or MCP server; any agent that can run Node 18+ for the CLI fallback. Network access to the provider APIs.
allowed-tools: mcp__plugin_ai-model-watch_ai-model-watch__list_models, mcp__plugin_ai-model-watch_ai-model-watch__check_new_models, mcp__ai-model-watch__list_models, mcp__ai-model-watch__check_new_models
tags: [ai-models, llm, model-releases, openrouter, monitoring, mcp]
---

# Checking which AI models a provider serves

## Overview

This skill answers "is that model out yet?" from each provider's own `/models` endpoint, the best record of what its API serves. New model IDs often show up there before any announcement.

It uses the two tools of the ai-model-watch MCP server, which ships with the plugin. Listing models is free on every provider: nothing is generated and no tokens are spent.

## Prerequisites

- The ai-model-watch MCP server (installed with the plugin, or `claude mcp add ai-model-watch -- npx -y github:markksantos/ai-model-watch --mcp`). Without it, use the CLI in the Examples section, which needs Node 18+.
- Network access to the provider APIs.

### Authentication

OpenRouter needs no key and lists models from most labs. Every other provider is checked only when its key is set in the environment Claude Code started from: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `MISTRAL_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`. Keys go only to their own provider and are never printed. Never ask the user to paste a key into the chat.

## Instructions

1. **"Is X out yet?" or "Does Anthropic list claude-…?"**: call `list_models` with `provider` and a `search` fragment of the name. It is read-only.
2. **"What's new?" or "Anything released since last time?"**: call `check_new_models`, optionally with `providers`. It compares against the lists saved at the last check, then saves the new ones, so a second call straight after reports nothing new.
3. If the provider the user named has no key, run the same `list_models` search against `openrouter`, and say that the answer comes from OpenRouter's catalog rather than the provider's own API.

## Output

- `list_models` returns a count line, then the matching model IDs, one per line.
- `check_new_models` returns one line per provider: the new IDs with their reported `created` date, "no new models", "baseline recorded" on the first check, or "skipped" when there's no key.
- Quote model IDs exactly as returned. On a first check, say a baseline was recorded rather than "no new models".

## Error Handling

- **Skipped provider**: no key in the environment. This is not an error; fall back to OpenRouter as in step 3.
- **Provider error** (network, rate limit, bad key): report it for that provider only. `check_new_models` keeps that provider's last good list, so the next check won't report its whole catalog as new.
- **Limits of a list**: a listed ID means the provider lists it. It doesn't prove the model answers requests yet, and some providers list models days before general availability. `created` is whatever date the provider reports, not the day the model appeared. Don't infer release dates or capabilities from a name.

## Examples

"Is DeepSeek V4.1 Flash on OpenRouter yet?" → `list_models` with `provider: "openrouter"`, `search: "deepseek-v4.1"`.

"Any new models since yesterday?" → `check_new_models` with no arguments. A new model comes back like this:

```text
OpenRouter: 2 new
  + deepseek/deepseek-v4.1-flash-1017 (DeepSeek: DeepSeek V4.1 Flash 1017), created 2026-10-17
  + reflection/beam-1.0-501b-a23b (Reflection: Beam 1.0 501B A23B), created 2026-10-16
```

Without the MCP server, the same checks run from a shell:

```bash
npx -y github:markksantos/ai-model-watch -p openrouter          # new since the last run
npx -y github:markksantos/ai-model-watch -p anthropic --json
```

## Resources

- Source, CLI flags and the GitHub Actions example: https://github.com/markksantos/ai-model-watch
- MCP setup for Claude Desktop, Cursor and other clients: https://artificialwatch.com/mcp
- [ArtificialWatch](https://artificialwatch.com) runs this check continuously: it polls the provider APIs and public catalogs every 60 seconds, confirms each detection on a second sweep, and sends an email or Chrome push alert. Its [record](https://artificialwatch.com/record) lists when each model was first seen.
