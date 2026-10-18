# PRD: ai-model-watch

**Author:** Mark Santos
**Date:** 2026-10-18
**Status:** Active

## Problem

New models often appear in a provider's `/models` list before any announcement. Finding out by hand means polling seven APIs, each with its own auth and pagination, and remembering what was there last time. An assistant asked "is X out yet?" otherwise answers from training data or a web search, both of which lag the APIs.

## Target users

| User | Context | Primary need |
| --- | --- | --- |
| Developers building on LLM APIs | A provider ships a model their app should switch to | Know the day the API serves it |
| AI news writers and researchers | Reporting on releases | First-seen evidence from the provider's own list |
| Claude Code users | Mid-session, "is that model out yet?" | An answer from the API, not from memory |

## Success criteria

1. `list_models` answers "does this provider list X?" from the provider's own API in one call, spending no tokens.
2. `check_new_models` reports only IDs added since the previous check, and a provider that errors keeps its last good list, so it never reports a whole catalog as new (covered by the test suite).
3. Works with no keys at all, through OpenRouter.
4. No runtime dependencies; Node 18+; `npm test` passes.

## Functional requirements

- **FR-1:** Fetch (and paginate where needed) the model lists of OpenRouter, OpenAI, Anthropic, Google Gemini, Mistral, xAI and DeepSeek.
- **FR-2:** Diff each list against a local state file and save the new lists.
- **FR-3:** Expose both operations as an MCP server on stdio (`--mcp`), and as a CLI and library.
- **FR-4:** Read keys only from the environment, send each only to its own provider, never print them.
- **FR-5:** Ship a skill that routes "is X out?" and "what's new?" to the right tool, and falls back to OpenRouter when a provider has no key.

## Out of scope

- Checking whether a model actually answers requests (that needs generation calls, which cost money).
- Continuous monitoring and alerts; the hosted [ArtificialWatch](https://artificialwatch.com) does that.
- Sources other than the providers' own APIs and OpenRouter.
