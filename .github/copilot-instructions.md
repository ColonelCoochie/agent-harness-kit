# GitHub Copilot Instructions

Follow the canonical repository workflow in `AGENTS.md`. Keep credential values environment-only, preserve the zero-dependency runtime, and use the configured harness verification gate before completion.

## Orchestrated-Worker Protocol

Protocol marker: `ORCHESTRATED_WORKER_CONTINUITY_V1`.

The persistent development orchestrator keeps the user-facing chat open and delegates bounded repository work to fresh workers when the host supports them. A normal result or user-input pause uses a reasoned checkpoint; reserve `handoff` for a true worker transfer, then delegate its exact resume command to a fresh worker. Open a fresh Copilot chat or task only when subagent delegation is unavailable.

## Development-Harness Boundary

Inherit and enforce the canonical boundary from `AGENTS.md`. GitHub Copilot uses `.harness/` only for repository-development state, verification, checkpoints, and orchestrated worker continuity; product-runtime agents and orchestration remain application-owned and independent. Each mutating worker runs `node .harness/run.mjs session` before edits.
