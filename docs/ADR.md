# ADR: ai-model-watch — read the providers' model lists, diff locally, serve over MCP

**Author:** Mark Santos
**Date:** 2026-10-18
**Status:** Accepted

## Context

The PRD asks for "is X out yet?" answers that come from the providers themselves, cost nothing, and run anywhere Claude Code runs. Every major provider exposes a free `/models` endpoint, but each one differs in auth, pagination and response shape, and none of them reports what changed. Without a tool, an assistant falls back to training data or web search, which lag the APIs by days.

## Decision

We read each provider's `/models` endpoint, diff it against a local state file, and expose that through a dependency-free MCP server (`--mcp`) with two tools, `check_new_models` and `list_models`. A skill tells the agent which tool fits which question.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Scrape announcement pages and changelogs | Later than the APIs, and breaks whenever a page changes |
| Call each model with a test prompt | Costs tokens, needs every key, and only tests IDs you already know |
| Build on the official MCP SDK | Adds a dependency tree for a protocol subset small enough to implement directly (`mcp.js`, under 200 lines) |

## Consequences

**Positive:**

- Free and fast: listing models spends no tokens on any provider.
- Nothing to install beyond Node 18; `npx` runs it straight from GitHub.

**Negative / accepted tradeoffs:**

- A listed ID doesn't prove the model answers requests. The skill and the README both say so.
- The state file is per machine, so two machines see "new" models independently.
- The hand-written protocol layer has to track MCP spec revisions; it currently negotiates four protocol versions.

## Tool-permission scope

| Tool | Why it's needed |
| --- | --- |
| `mcp__plugin_ai-model-watch_ai-model-watch__list_models` | Read-only GET of one provider's model list (plugin install) |
| `mcp__plugin_ai-model-watch_ai-model-watch__check_new_models` | GET of the model lists, then writes the state file under `~/.cache/ai-model-watch/` (plugin install) |
| `mcp__ai-model-watch__list_models`, `mcp__ai-model-watch__check_new_models` | The same two tools when the server was added with `claude mcp add` |

No `Bash`, `Read` or `Write` permission is declared. The CLI fallback in the skill runs only if the user approves the command.
