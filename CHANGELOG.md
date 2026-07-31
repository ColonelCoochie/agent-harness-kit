# Changelog

## 0.3.0

- Scaffold compatible instruction surfaces for Codex, Claude Code, and GitHub Copilot.
- Add opt-in, environment-backed credential pools with `first_available` and persistent `round_robin` selection.
- Add built-in OpenAI and Anthropic provider definitions without storing key values.
- Record only provider names and selected slot numbers in command evidence.
- Preserve existing agent instruction files and emit explicit merge additions when routing is missing.
- Keep the `codex-harness` executable as a compatibility alias for `agent-harness`.

## 0.2.0

- Harden Git scope parsing, evidence provenance, secret redaction, lock recovery, and schema migration.
