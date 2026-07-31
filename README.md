# Agent Harness Kit

A zero-dependency, evidence-gated project harness for OpenAI Codex, Anthropic Claude Code, and GitHub Copilot.

The kit installs one checked-in control plane for feature state, bounded scope, verification, evidence, and handoff. Each coding agent receives a native instruction entry point, but `AGENTS.md` remains the canonical workflow so the agents do not drift.

## What gets installed

```text
AGENTS.md                         Canonical project workflow for Codex and other agents
CLAUDE.md                         Claude Code adapter that imports AGENTS.md
.github/copilot-instructions.md   GitHub Copilot adapter
.harness/
  config.json                    Project policy, providers, and verification profile
  features.json                  WIP-limited feature state machine
  run.mjs                        Cross-platform local controller
  credentials-state.json         Non-secret round-robin cursors
  progress.md                    Durable session state
  handoff.md                     Restart instructions
  quality.md                     Module quality ledger
  docs-map.md                    Repository knowledge map
  loops/                         Goal, maker, and checker templates
  evidence/                      Write-once verification records
  events.jsonl                   Append-only lifecycle trace
```

Existing instruction files are never overwritten. When one does not route to the harness, initialization writes a reviewable addition under `.harness/` for manual merging.

## Quick start

Node.js 20 or newer is the only runtime dependency.

```bash
node bin/agent-harness.mjs init /path/to/project \
  --name "My Project" \
  --purpose "What the project does"

node /path/to/project/.harness/run.mjs doctor
node /path/to/project/.harness/run.mjs status
node /path/to/project/.harness/run.mjs next
```

Install the package locally or globally to use `agent-harness`. The previous `codex-harness` command remains as a compatibility alias.

Day-to-day work uses the checked-in project runtime:

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
node .harness/run.mjs handoff --summary "What changed and what remains"
```

## Agent compatibility

| Agent | Native project instruction | Harness behavior |
|---|---|---|
| OpenAI Codex | `AGENTS.md` | Reads the canonical startup, scope, and verification workflow |
| Anthropic Claude Code | `CLAUDE.md` | Imports `@AGENTS.md`, with room for Claude-only guidance |
| GitHub Copilot | `.github/copilot-instructions.md` plus `AGENTS.md` | Routes Copilot surfaces to the same workflow |

The adapters follow the current official conventions for [Codex `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md/), [Claude Code project memory](https://code.claude.com/docs/en/memory), and [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).

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
- `docs.required`: knowledge a fresh agent must be able to find.
- `policies.wipLimit`: defaults to one; raise only with isolated ownership.
- `policies.maxAttempts` and `maxRepeatedFailures`: bounded stop conditions.
- `execution`: setup, start, health, shutdown, and runtime declarations.
- `security.environmentAllow`: ordinary non-secret environment passed to commands.
- `security.credentials.providers`: explicit, opt-in key pools.
- `agents`: enabled instruction surfaces and their checked-in paths.

Feature-specific acceptance commands and scope live in `.harness/features.json`. Only successful cumulative verification can transition an active feature to `passing`.

## Upgrade an existing harness

```bash
node bin/agent-harness.mjs sync /path/to/project
```

`sync` is idempotent. Runtime v3 migrates legacy configuration, installs the credential cursor without secret material, adds missing agent adapters non-destructively, and preserves project facts and historical evidence.

## Design guarantees

- Initialization detects commands but does not install dependencies or run project scripts.
- Git-backed scope is checked before and after verification and fails closed when unavailable.
- Evidence is write-once JSON bound to the frozen feature contract and exact verification plan.
- Command environments are allowlisted; provider keys are injected only by explicit request.
- Secret-bearing environment values and common token formats are redacted before persistence.
- State mutations and credential rotation are serialized with a recoverable lock.
- `passing` is terminal; regressions become new features.
- The project runtime is checked in and works on Windows, macOS, and Linux.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [ANALYSIS.md](ANALYSIS.md), and [REVIEW-2026-07-20.md](REVIEW-2026-07-20.md).
