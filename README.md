# Agent Harness Kit

A zero-dependency, evidence-gated repository-development harness for OpenAI Codex, Anthropic Claude Code, and GitHub Copilot.

The kit installs one checked-in development control plane for feature state, bounded scope, verification, evidence, and fresh-task continuity. It never becomes application runtime. Any in-product agent, loop, scheduler, or orchestrator remains product-owned, with state, configuration, telemetry, and operations separate from `.harness/`; product runtime must never depend on, read, or write `.harness/`. The harness may build and test that code as ordinary feature-scoped code. Each enabled coding agent receives a native instruction entry point, but `AGENTS.md` remains the canonical workflow and boundary router.

## What gets installed

```text
AGENTS.md                         Canonical project workflow for Codex and other agents
CLAUDE.md                         Claude Code adapter that imports AGENTS.md
.github/copilot-instructions.md   GitHub Copilot adapter
.codex/hooks.json                 Codex PreCompact stop guard (review/trust locally)
.harness/
  config.json                    Project policy, providers, and verification profile
  features.json                  WIP-limited feature state machine
  continuity.json                Working/awaiting-resume lifecycle state and bounded capsules
  run.mjs                        Cross-platform local controller
  credentials-state.json         Non-secret round-robin cursors
  progress.md                    Bounded projection of the latest checkpoint
  handoff.md                     Terminal fresh-task bootstrap
  history/progress/              Archived progress projections at handoff boundaries
  quality.md                     Module quality ledger
  docs-map.md                    Repository knowledge map
  loops/                         Development goal, maker, and checker templates
  evidence/                      Write-once verification records
  events.jsonl                   Append-only lifecycle trace
  hooks/precompact-handoff.mjs   Shared automatic terminal-handoff hook
```

Existing instruction and Codex hook files are never overwritten. When an enabled surface does not route to the harness or inherit the canonical development boundary, initialization writes a reviewable addition under `.harness/` for manual merging. Disabled surfaces are preserved and never created by `sync`; this prevents product SDKs from accidentally loading an unwanted coding-agent adapter.

## Quick start

Node.js 20 or newer is the only runtime dependency.

```bash
node bin/agent-harness.mjs init /path/to/project \
  --name "My Project" \
  --purpose "What the project does" \
  --agents "codex,github-copilot"

node /path/to/project/.harness/run.mjs session
node /path/to/project/.harness/run.mjs doctor
node /path/to/project/.harness/run.mjs status
node /path/to/project/.harness/run.mjs next
```

Omit `--agents` to scaffold all three coding-agent surfaces. Select only the surfaces safe for the repository; for example, omit a root Claude adapter when an in-product Claude SDK could load it as product prompt context.

The generic scaffold deliberately leaves `verification.full` unconfigured. Set it to the project's real completion command before expecting `doctor` to pass; the failure is a setup gate, not a broken installation.

Install the package locally or globally to use `agent-harness`. The previous `codex-harness` command remains as a compatibility alias.

Day-to-day development work uses the checked-in harness controller:

```bash
node .harness/run.mjs add feat-001 \
  --title "First feature" \
  --description "Observable behavior" \
  --criterion "The behavior works" \
  --command "npm test -- --runInBand" \
  --allow "src/**"
node .harness/run.mjs start feat-001
node .harness/run.mjs verify feat-001
node .harness/run.mjs trace feat-001
node .harness/run.mjs checkpoint \
  --summary "What is true now" \
  --next "Run the focused regression test"
node .harness/run.mjs handoff \
  --summary "What changed and what remains" \
  --next "Run the full verification gate"
```

## Agent compatibility

| Agent | Native project instruction | Harness behavior |
|---|---|---|
| OpenAI Codex | `AGENTS.md` plus `.codex/hooks.json` | Reads the canonical workflow; a reviewed project-local `PreCompact` hook parks state before compaction |
| Anthropic Claude Code | `CLAUDE.md` | Imports `@AGENTS.md`, with room for Claude-only guidance and an optional shared `PreCompact` adapter |
| GitHub Copilot | `.github/copilot-instructions.md` plus `AGENTS.md` | Routes Copilot surfaces to the same workflow |

The adapters follow the current official conventions for [Codex `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md/), [Codex hooks](https://developers.openai.com/codex/hooks), [Claude Code project memory](https://code.claude.com/docs/en/memory), [Claude Code hooks](https://code.claude.com/docs/en/hooks), [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), and [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).

## Fresh-task continuity

Runtime v5 makes the coding-task boundary explicit and repository-backed:

```text
working generation N
  | checkpoint (stay in this task)
  v
working generation N
  | handoff (terminal for this task)
  v
awaiting_resume
  | resume HANDOFF_ID (from a genuinely fresh task)
  v
working generation N+1
```

At the start of every task, inspect continuity before changing files:

```bash
node .harness/run.mjs session
```

If the phase is `working`, continue with `doctor`, `status`, and `next`. If it is `awaiting_resume`, the current task must be a genuinely fresh chat or coding-agent task. Run the exact command printed by `session`, then repeat the startup checks:

```bash
node .harness/run.mjs resume HANDOFF_ID
node .harness/run.mjs doctor
node .harness/run.mjs status
node .harness/run.mjs next
```

`resume` checks the handoff ID, feature revision, configuration hash, commit, branch, and worktree checkpoint. Drift fails closed. Use `--accept-drift` only after reviewing and intentionally accepting every reported difference. A successful resume advances the continuity generation and is idempotent for that handoff ID.

Use `checkpoint` for a durable, bounded snapshot while the same task continues. It rewrites `.harness/progress.md`, updates `.harness/continuity.json`, and appends an event without parking work. Summaries are capped at 4,000 characters, next actions at 2,000 characters, repeated decision/blocker/evidence entries at 20 each, and recorded changed-file details at 100 paths; the total count and worktree hash still cover the complete project change set. Use Git history, events, and evidence for older detail instead of turning `progress.md` into a transcript.

`handoff` uses the same bounded capsule, archives the prior progress projection, records dirty project paths and hashes, writes the fresh-task bootstrap, and changes the phase to `awaiting_resume`. A dirty worktree is a recorded risk, not a reason to lose continuity; `handoff` does not clean, stage, or commit anything. After it prints `STOP_CURRENT_CHAT`, stop. Do not call `resume` from the same conversation, resume the old transcript, or use context compaction as a substitute for a fresh task.

For Codex, v4 also installs a project-local `.codex/hooks.json` automatic `PreCompact` guard that invokes the shared handoff script with `--platform codex`. When Codex is about to compact automatically, the hook writes an automatic dirty-safe terminal handoff and returns `continue: false`, so Codex stops before compaction. Review and trust project-local hooks before enabling them. Claude Code users may optionally register `node "${CLAUDE_PROJECT_DIR}/.harness/hooks/precompact-handoff.mjs" --platform claude` for automatic `PreCompact` after the same review; the kit does not replace user-owned Claude hook settings. The hook converts compaction pressure into a parked handoff—it does not make compacted context an acceptable continuation. Copilot's current `preCompact` event is notification-only, so the kit relies on the terminal runtime barrier and fresh-task instructions there instead of claiming that Copilot compaction can be blocked.

While parked, the runtime rejects feature and verification mutations such as `add`, `start`, `block`, `unblock`, `check`, `verify`, and `checkpoint`. Read-only inspection remains available. This barrier governs the harness command surface; it cannot prevent an editor or arbitrary shell command from changing files.

The runtime and hook can persist the capsule, park harness mutations, print an exact bootstrap prompt, and emit a Codex deep link in `.harness/handoff.md`. They cannot universally create a chat in every supported platform, terminate every host conversation, or prove that the operator opened a fresh task. Codex, Claude Code, and GitHub Copilot must use their platform-specific new-task controls and follow the checked-in terminal instruction.

## Multiple API keys and Anthropic

The generated configuration contains opt-in OpenAI and Anthropic key pools. It stores environment-variable names, never key values:

```json
{
  "security": {
    "environmentAllow": ["PATH", "SystemRoot", "HOME"],
    "redactOutput": true,
    "credentials": {
      "stateFile": ".harness/credentials-state.json",
      "providers": {
        "openai": {
          "targetEnvironment": "OPENAI_API_KEY",
          "sources": ["OPENAI_API_KEY", "OPENAI_API_KEY_2"],
          "selection": "round_robin"
        },
        "anthropic": {
          "targetEnvironment": "ANTHROPIC_API_KEY",
          "sources": ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_2"],
          "selection": "round_robin"
        }
      }
    }
  }
}
```

A verification command receives no provider key unless it explicitly requests one:

```json
{
  "verification": {
    "full": [
      "npm test",
      {
        "command": "node scripts/check-openai.mjs",
        "credentials": ["openai"]
      },
      {
        "command": "node scripts/check-anthropic.mjs",
        "credentials": ["anthropic"]
      }
    ]
  }
}
```

For an acceptance command added from the CLI, use `--credential openai` or `--credential anthropic`. Custom providers use the same schema. `selection` can be `round_robin` or `first_available`.

```bash
node .harness/run.mjs credentials
node .harness/run.mjs credentials --json
```

The status command reports only configured and available slot counts. Durable evidence records only the provider name, non-secret slot number, and selection policy. Output redaction covers every configured source value, including keys that were not selected.

This feature routes API keys for project commands; it does not convert ChatGPT, Claude, or Copilot consumer subscriptions into API access. Claude Code gives `ANTHROPIC_API_KEY` precedence over subscription login, and Anthropic requires API-key authentication for third-party products. Keep subscription login and project API-key automation conceptually separate.

Commands are never retried automatically with another key after execution begins because doing so could duplicate side effects. Round-robin selection advances before each requested command, so the next command or run uses the next available slot.

## Configuration

Edit `.harness/config.json` for project facts:

- `verification.quick`, `full`, `e2e`, `architecture`, and `clean`: cumulative executable gates.
- `scope.defaultAllow` and `defaultDeny`: change boundaries.
- `continuity`: fixed fresh-task mode, dirty-worktree recording, and the post-handoff mutation barrier.
- `docs.required`: knowledge a fresh agent must be able to find.
- `policies.wipLimit`: defaults to one; raise only with isolated ownership.
- `policies.maxAttempts` and `maxRepeatedFailures`: bounded stop conditions.
- `execution`: development/test setup, start, health, shutdown, and harness-runtime declarations; these do not become the deployed product's operational control plane.
- `security.environmentAllow`: ordinary non-secret environment passed to commands.
- `security.credentials.providers`: explicit, opt-in key pools.
- `agents`: enabled coding-agent instruction surfaces and their checked-in paths. Disabled adapters remain absent across `sync`.

Feature-specific acceptance commands and scope live in `.harness/features.json`. Only successful cumulative verification can transition an active feature to `passing`.

## Upgrade an existing harness

```bash
node bin/agent-harness.mjs sync /path/to/project
```

`sync` is idempotent. Runtime v5 migrates legacy configuration, creates or repairs `.harness/continuity.json`, installs the canonical development-only boundary through non-destructive merge additions, repairs only enabled coding-agent adapters, and preserves product code, project facts, and historical evidence.

## Design guarantees

- Initialization detects commands but does not install dependencies or run project scripts.
- `.harness/` governs repository development only; product-runtime agents and orchestration remain application-owned and independent.
- On Windows, relative executable paths in initializer command overrides are normalized for `cmd.exe` (for example, `.venv/Scripts/python.exe` becomes `.\.venv\Scripts\python.exe`); generated runtimes apply the same compatibility rule to existing configuration. POSIX command text is unchanged.
- Git-backed scope is checked before and after verification and fails closed when unavailable.
- Evidence is write-once JSON bound to the frozen feature contract and exact verification plan.
- Command environments are allowlisted; provider keys are injected only by explicit request.
- Secret-bearing environment values and common token formats are redacted before persistence.
- State mutations, continuity transitions, and credential rotation are serialized with a recoverable lock.
- Checkpoints remain bounded; terminal handoffs preserve dirty work and block harness mutations until an ID-bound fresh-task resume.
- The reviewed Codex `PreCompact` hook turns automatic compaction into a terminal handoff and stop; Claude Code can opt into the same guard.
- `passing` is terminal; regressions become new features.
- The development-harness controller is checked in and works on Windows, macOS, and Linux.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [ANALYSIS.md](ANALYSIS.md), and [REVIEW-2026-07-20.md](REVIEW-2026-07-20.md).
