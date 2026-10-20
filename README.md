# Agent Harness Kit

A zero-dependency repository-development harness for long-running coding goals with OpenAI Codex, Claude Code and GitHub Copilot.

It gives coding agents a small, checked-in control plane: a WIP-limited feature state machine with frozen contracts, cumulative verification with evidence, Git-backed scope checks, and worker checkpoints/handoffs so a persistent orchestrator chat can drive many fresh workers without losing state. `.harness/` is development tooling only; product code never imports, reads, or writes it.

Design rationale: [ANALYSIS.md](ANALYSIS.md) (derived from the learn-harness-engineering course). v7 removes the v6 hook and attestation machinery that made every tool call slower; see [CHANGELOG.md](CHANGELOG.md).

## What gets installed

```text
AGENTS.md                        Project facts + the harness workflow block (canonical instructions)
CLAUDE.md                        Imports @AGENTS.md; Claude worker-ID note
.github/copilot-instructions.md  Short adapter to AGENTS.md
.codex/hooks.json                One fail-open PreCompact hook (Codex)
.claude/settings.json            Same PreCompact hook (Claude Code)
.harness/
  run.mjs                        The controller (single file, Node 20+)
  config.json                    Commands, scope defaults, policies, credentials, agents
  features.json                  Feature state machine (authoritative)
  continuity.json                Orchestrator/worker phase, owner, checkpoint, handoff
  events.jsonl                   Append-only lifecycle log
  evidence/                      One JSON record per verify attempt (committed)
  logs/                          Full command output (git-ignored, pruned to 200)
  progress.md, handoff.md        Generated current-state snapshots
  docs-map.md, quality.md        Where workers read; quality ledger
  loops/goal.md, maker.md, checker.md
  hooks/precompact.mjs
```

## Quick start

```bash
node bin/agent-harness.mjs init /path/to/project --name "My App" --purpose "What it does" --agents codex,claude
cd /path/to/project
git add -A && git commit -m "Add development harness"   # features need a HEAD commit
node .harness/run.mjs doctor
```

Set `verification.full` (and optionally `quick`, `architecture`, `e2e`, `clean`) in `.harness/config.json` to the project's real commands. `init` detects common stacks (npm/pnpm/yarn/bun scripts, pytest, go, cargo, maven, gradle, dotnet).

## The workflow

```text
user <-> orchestrator chat (intent, decisions, compact results, routing)
              |
              +-- fresh worker: session -> claim -> bootstrap -> start/implement/verify -> checkpoint
              +-- optional read-only explorers / checker
```

```bash
node .harness/run.mjs session                 # where are we, what's next
node .harness/run.mjs claim                   # fresh worker takes ownership (or: resume HANDOFF_ID)
node .harness/run.mjs bootstrap --validate --json
node .harness/run.mjs add feat-001 --title "Login" --description "Users can log in" \
  --criterion "login test passes" --command "npm test -- login" --allow "src/auth/**" --allow "test/auth/**"
node .harness/run.mjs start feat-001          # freezes contract, records Git baseline
node .harness/run.mjs check quick             # fast feedback while working
node .harness/run.mjs verify feat-001         # layers + acceptance + scope; pass => passing + git commit
node .harness/run.mjs checkpoint --reason worker_yield --summary "feat-001 passing" --next "start feat-002"
```

- `verify` runs `completion.alwaysRunWhenConfigured` + `completion.baseLayers` + the feature's `--layer`s in order (quick, full, architecture, e2e, clean), then each acceptance command, failing fast. It prints one line per passing command and the tail of a failing one; full output is in `.harness/logs/`.
- Scope: everything changed since `start` (commits plus working tree, excluding pre-existing dirt that is unchanged) must match the feature's `--allow` and not its `--deny`. Harness state files are exempt; `config.json` is not, so a feature can't quietly weaken its own checks.
- On pass the feature becomes `passing` (terminal) and the runtime commits its scoped changes plus harness state. Set `completion.commitOnPass: false` to opt out. It never pushes.
- Failures count against `policies.maxAttempts` (default 5); the same failure `maxRepeatedFailures` times in a row (default 2) blocks the feature so a worker stops instead of looping.
- `checkpoint --reason needs_input` pauses for a user decision. `handoff` parks mutations for a true transfer; only a fresh worker runs the printed `resume HANDOFF_ID` (drift in commit, branch, feature revision or config requires `--accept-drift`).
- Ownership is cooperative: Codex workers are identified by `CODEX_THREAD_ID`; other hosts pass `--worker-id ID`. `claim --force` takes over from a worker that has stopped.

## Credentials

`config.security.credentials.providers` lists environment-variable names (never values) for key pools, e.g. `OPENAI_API_KEY`, `OPENAI_API_KEY_2`. A verification entry receives a key only if it asks:

```json
{ "verification": { "full": ["npm test", { "command": "node scripts/check-openai.mjs", "credentials": ["openai"] }] } }
```

Selection is `round_robin` (default) or `first_available`. Commands run with an allowlisted environment (`security.environmentAllow`) minus every provider variable. Output is redacted before it is logged or stored. Executed commands are never retried with another key.

## Upgrading projects

```bash
node bin/agent-harness.mjs sync /path/to/project --preview
node bin/agent-harness.mjs sync /path/to/project [--prune]
node bin/agent-harness.mjs audit /path/to/project
```

`sync` installs the current runtime and loop templates, migrates v6 state in place (features, evidence and continuity keep working), removes v6 per-tool hooks while preserving your own hooks, deletes v6 runtime leftovers, drops the forced 80k-token Codex auto-compaction default, and replaces only the harness sections of `AGENTS.md`/`CLAUDE.md`/Copilot instructions. `--prune` also deletes ad-hoc files in `.harness/` outside the v7 layout; archive them first if you want them.

Codex asks you to review/trust the new PreCompact hook the first time it sees it. The hook only appends a progress note and always exits successfully, so leaving it untrusted is harmless.

## Development

```bash
npm test     # about 20 seconds
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
