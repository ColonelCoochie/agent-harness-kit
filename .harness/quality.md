# Quality Ledger

Update this document when verification or review reveals a durable quality signal.

| Area | Grade | Evidence | Risk | Next improvement |
|---|---|---|---|---|
| Self-hosted harness | A | Prior passing evidence: `.harness/evidence/2026-08-01T20-14-58-729Z-harness-self-host.json`; current runtime v6 source suite passes 46/46 tests and managed runtime/hook hashes match | Host-native subagent dispatch remains an instruction-layer integration | Add a host-level smoke trial for worker delegation |
| Worker continuity | A | Compact session routing, `worker_yield`, `needs_input`, ID-bound transfer, drift, hook, and v5 migration regressions pass | A misconfigured host can still launch more than one filesystem-writing worker | Keep WIP=1 and one mutating worker per worktree |
| Agent surfaces | A | Codex, Claude Code, and GitHub Copilot route to the canonical boundary; no merge additions remain | Project-local hooks still require user trust review | Review `.codex/hooks.json` with Codex `/hooks` |
| Local tooling | B | Node 22 and Git are healthy; Codex doctor reports zero warnings/failures | The user-level npm shim points to a missing `npm-cli.js` | Repair npm separately; keep the portable direct-Node full gate |

## Simplification candidates

- Align `doctor` and `audit` so both reject every generated project-purpose placeholder, including `TODO:` values.
- Extend managed-asset drift checks beyond the runtime and hook where project-owned customization does not need preservation.
- Preserve the host's scoped Git safe-directory configuration when harness commands spawn nested Git-aware checks under a Codex sandbox.
- Add release-only smoke coverage for both published CLI shims and the packed tarball without expanding the ordinary fast loop.

## Promoted review feedback

- Keep the reusable source under `skill/codex-harness/` authoritative and refresh generated runtime artifacts through `sync`.
- Use `node --test tests/harness.test.mjs` as this checkout's full gate until the machine-local npm installation is repaired.
- Allowlist the host-provided `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, and `GIT_CONFIG_VALUE_0` so nested verification retains Codex's repository trust boundary.
