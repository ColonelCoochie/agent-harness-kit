# Agent Harness Kit

A zero-dependency, evidence-gated repository-development harness for OpenAI Codex, Anthropic Claude Code, and GitHub Copilot.

The kit installs one checked-in development control plane for feature state, bounded scope, verification, evidence, and orchestrated worker continuity. A persistent user-facing development orchestrator keeps user intent, decisions, concise status, and routing while fresh bounded workers reconstruct repository context on demand. It never becomes application runtime. Any in-product agent, loop, scheduler, or orchestrator remains product-owned, with state, configuration, telemetry, and operations separate from `.harness/`; product runtime must never depend on, read, or write `.harness/`.

## What gets installed

```text
AGENTS.md                         Canonical project workflow for Codex and other agents
CLAUDE.md                         Claude Code adapter that imports AGENTS.md
.github/copilot-instructions.md   GitHub Copilot adapter
.codex/hooks.json                 Codex PreCompact worker-packet persistence (review/trust locally)
.claude/settings.json            Claude SubagentStart identity and compaction routing (review/trust locally)
.harness/
  config.json                    Project policy, providers, and verification profile
  features.json                  WIP-limited feature state machine
  continuity.json                Worker continuity phase and bounded checkpoints/packets
  run.mjs                        Cross-platform local controller
  hooks/claude-worker-identity.mjs Read-only native Claude child identity delivery
  credentials-state.json         Non-secret round-robin cursors
  progress.md                    Bounded projection of the latest checkpoint
  handoff.md                     Pending worker-transfer bootstrap
  history/progress/              Archived progress projections at transfer boundaries
  quality.md                     Module quality ledger
  docs-map.md                    Repository knowledge map
  loops/                         Development goal, maker, and checker templates
  evidence/                      Write-once verification records
  events.jsonl                   Append-only lifecycle trace
  hooks/precompact-handoff.mjs   Shared automatic worker-packet hook
```

Existing instruction and Codex hook files are never overwritten. When an enabled surface does not route to the harness or inherit the canonical development boundary, initialization writes a reviewable addition under `.harness/` for manual merging. Disabled surfaces are preserved and never created by `sync`; this prevents product SDKs from accidentally loading an unwanted coding-agent adapter.

Preview an upgrade with `node bin/agent-harness.mjs sync /path/to/project --preview --json`. Preview reads the target and reusable sources without creating directories, taking a lock, recovering stale locks, or changing files. Its deterministic `planHash` binds ordered actions and the input hashes. Apply can require that reviewed plan with `--expect-plan SHA256`; all inputs are checked again under the shared state lock before file writes.

Sync records installed canonical runtime and enabled hook adapter hashes in `.harness/managed-files.json`. Exact bundled predecessors and inventory entries matching the actual bytes can upgrade automatically. An unknown or customized enabled executable blocks the entire apply. After reviewing a particular replacement, use repeatable `--replace-reviewed .harness/run.mjs=RAW_SHA256` (or one of the three enabled `.harness/hooks/*.mjs` adapter paths), together with the replacement preview's `--expect-plan` hash. This replaces that complete file with the reusable source; custom changes require a deliberate merge before that review. Stale hashes fail without durable writes. Instructions, modified review additions, evidence and baseline blobs are never eligible for this override.

## Quick start

The controller has zero npm dependencies and requires Node.js 20 or newer. Feature scope also requires Git and a repository with an existing commit (`HEAD`) before `start`; initialization can scaffold a project before that commit exists. The harness never creates Git commits. Create the initial commit as normal project setup; see [repository prerequisites](skill/codex-harness/references/operations.md#repository-prerequisites) for the optional empty local commit case.

```bash
node bin/agent-harness.mjs init /path/to/project \
  --name "My Project" \
  --purpose "What the project does" \
  --agents "codex,github-copilot"

node /path/to/project/.harness/run.mjs session --json
# Fresh worker: claim unowned working state, or run the exact delegated resume instead.
node /path/to/project/.harness/run.mjs claim
node /path/to/project/.harness/run.mjs bootstrap --json
# Read config.json and task-relevant routes in docs-map.md before these checks.
node /path/to/project/.harness/run.mjs doctor
node /path/to/project/.harness/run.mjs status
node /path/to/project/.harness/run.mjs next
```

Omit `--agents` to scaffold all three coding-agent surfaces. Select only the surfaces safe for the repository; for example, omit a root Claude adapter when an in-product Claude SDK could load it as product prompt context.

The generic scaffold deliberately leaves `verification.full` unconfigured. Set it to the project's real completion command before expecting `doctor` to pass; the failure is a setup gate, not a broken installation.

The startup example uses Codex's own `CODEX_THREAD_ID`. Workers on other hosts append their own unique `--worker-id ID` to `claim` or the delegated `resume` and every later mutation. An older installed controller without `claim` or `bootstrap` needs the [conditional legacy upgrade](skill/codex-harness/references/operations.md#legacy-controller-upgrade) before using these commands.

Install the package locally or globally to use `agent-harness`. The previous `codex-harness` command remains as a compatibility alias.

Both CLI surfaces provide top-level and command-specific help through `help COMMAND`, `COMMAND --help`, and `COMMAND -h`. Help is resolved before target discovery, configuration or state reads, lock checks, scaffolding, synchronization, command execution, or continuity changes, so it remains safe in an uninitialized or damaged project. Mutating commands validate an explicit per-command option schema before any of those effects and report misspelled flags with the matching help command.

Day-to-day development work uses the checked-in harness controller:

```bash
node .harness/run.mjs add feat-001 \
  --title "First feature" \
  --description "Observable behavior" \
  --criterion "The behavior works" \
  --command "npm test" \
  --allow "src/**"
node .harness/run.mjs start feat-001
node .harness/run.mjs verify feat-001
node .harness/run.mjs trace feat-001
node .harness/run.mjs checkpoint \
  --reason worker_yield \
  --summary "What is true now" \
  --next "Run the focused regression test"
```

Only a true worker context or ownership transfer uses:

```bash
node .harness/run.mjs handoff \
  --summary "What changed and what remains" \
  --next "Run the full verification gate"
```

## Agent compatibility

| Agent | Native project instruction | Harness behavior |
|---|---|---|
| OpenAI Codex | `AGENTS.md` plus `.codex/hooks.json` | Reads the canonical workflow; a reviewed project-local `PreCompact` hook persists a worker packet before compaction |
| Anthropic Claude Code | `CLAUDE.md` | Imports `@AGENTS.md`, with room for Claude-only guidance and an optional packet-persistence `PreCompact` adapter |
| GitHub Copilot | `.github/copilot-instructions.md` plus `AGENTS.md` | Routes Copilot surfaces to the same workflow |

The adapters follow the current official conventions for [Codex `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md/), [Codex hooks](https://developers.openai.com/codex/hooks), [Claude Code project memory](https://code.claude.com/docs/en/memory), [Claude Code hooks](https://code.claude.com/docs/en/hooks), [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), and [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).

## Orchestrated worker continuity

Runtime v6 uses the `Orchestrated-Worker Protocol` (`ORCHESTRATED_WORKER_CONTINUITY_V1`). The user stays in one development orchestrator chat; repository context lives in bounded workers and checked-in state:

```text
user <-> persistent development orchestrator
                    |
                    +-- fresh bounded worker --> working generation N
                           | checkpoint(worker_yield) --> concise result; yield
                           | checkpoint(needs_input) --> concise question; yield
                           | handoff(true transfer) --> awaiting_resume + packet
                                                          |
                                  orchestrator delegates exact resume to
                                  a fresh worker --> working generation N+1
```

The orchestrator holds user intent, decisions, concise status, and routing only. It delegates implementation, does not accumulate worker transcripts, and never consumes an ID-bound transfer packet. One worker may mutate at a time; independent read-only explorers can run in parallel. A new user chat/task is the fallback only when the host cannot delegate subagents.

Every mutating worker inspects continuity before changing files:

```bash
node .harness/run.mjs session --json
# Claim only unowned working state; a parked transfer uses its exact delegated resume.
node .harness/run.mjs claim
node .harness/run.mjs bootstrap --json
# Read config.json and task-relevant routes in docs-map.md.
node .harness/run.mjs doctor
node .harness/run.mjs status
node .harness/run.mjs next
```

If the phase is `awaiting_resume`, the orchestrator delegates the exact command printed by `session` to a fresh worker. That worker runs it in place of `claim`, then runs bounded `bootstrap --json`, reads config and task-relevant docs, and completes `doctor`, `status`, and `next`:

```bash
node .harness/run.mjs resume HANDOFF_ID
```

`resume` checks the transfer ID, feature revision, configuration hash, commit, branch, and worktree checkpoint. Drift fails closed. Use `--accept-drift` only after reviewing and intentionally accepting every difference. A successful resume advances the continuity generation and is idempotent for that ID.

Normal completion is a worker yield, not a global handoff. After verification or an appropriate block, the worker records compact current facts and returns a concise result:

```bash
node .harness/run.mjs checkpoint \
  --reason worker_yield \
  --summary "What is true now" \
  --next "Route the next bounded task"
```

When a user decision is required, use `--reason needs_input`, return one concise question, and yield. Both reasons keep continuity `working`; neither requires `handoff`, `resume`, or a new chat.

Checkpoints rewrite `.harness/progress.md`, update `.harness/continuity.json`, and append an event without parking work. UTF-8 byte limits cap summaries at 4,000, next actions at 2,000, and repeated decision/blocker/evidence entries at 1,024 each with at most 20 entries. Packets are limited to 24 KiB, startup checkpoint projections to 12 KiB, and the final bootstrap to 32 KiB. Oversize input, active descriptions, and inferred next actions are checked before writes. Detailed changed-file records cover at most 100 paths; total count and worktree hash still cover the complete change set. Git history, events, archives, and evidence carry older detail.

Reserve `handoff` for a true implementation context or ownership transfer. It records a bounded ID-bound packet, archives the prior projection, preserves dirty paths and hashes without cleaning or committing them, and changes the phase to `awaiting_resume`. The handing-off worker yields. The orchestrator routes the exact resume command to a fresh worker without loading the packet itself.

For Codex, the reviewed project-local `.codex/hooks.json` PreCompact adapter invokes the shared packet writer. Successful persistence allows the persistent orchestrator chat to compact and continue routing through a fresh worker; failure denies compaction. Portable launchers resolve the nearest harness from the native payload's `cwd` or the invocation directory, including nested monorepo projects, without Git-root assumptions or interpolated filesystem paths. Sync safely upgrades exact old generated hook commands while preserving unrelated user settings, hooks and wrappers; customized routes receive a review addition. Review/trust the commands locally.

For Claude Code, review `.claude/settings.json` or merge `.harness/claude-hooks.addition.json` into existing settings while preserving user hooks. The read-only SubagentStart hook supplies `claude-agent:<agent_id>` to the child before its initial prompt; it never claims ownership. Delegate through a fresh non-fork Agent invocation without inherited implementation history. Only that child appends its native identity to `claim`, the exact delegated `resume HANDOFF_ID`, and every mutation, including verify/checkpoint/handoff. PreCompact binds and forwards the same `agent_id`, never shared `session_id`; compact SessionStart emits bounded additionalContext routing without consuming the transfer packet. [Claude's SubagentStart reference](https://code.claude.com/docs/en/hooks#subagentstart) documents this identity injection.

On hosts without native identity delivery, choose a fresh unique manual worker ID per child and append `--worker-id ID` to every mutation. For example, use `claim --worker-id claude-worker-unique-001`, `verify FEATURE_ID --worker-id claude-worker-unique-001`, and `checkpoint --reason worker_yield --summary "Result" --next "Next task" --worker-id claude-worker-unique-001`. A replacement worker uses a different ID on the exact delegated resume command and all later mutations. Automatic hooks cannot infer a manual ID; manual PreCompact invocation must receive the matching ID. Claude main-session PreCompact lacks `agent_id` and deliberately blocks while a child owns working state; wait for the child to checkpoint/yield or persist a parked handoff. Missing identity never proves a trusted routing parent.

The optional installed-host check `node tests/claude-native-smoke.mjs` passed on Windows with Claude Code 2.1.198. It observes native Setup, startup SessionStart and SubagentStart payloads, the production worker identity in a fresh child's Messages request, absent parent-only history, and unchanged harness ownership. It uses an isolated temporary profile, empty MCP configuration, no inherited provider credentials, and a local mock model. Use `--cli /absolute/path/to/claude` for another installation. This check does not validate native PreCompact, compact SessionStart, Codex hook dispatch, or confinement of all CLI network traffic; those remain separate host checks.

If a worker disappears without yielding, confirm its termination through the host or operator first. A distinct actor can run `node .harness/run.mjs recover --expected-owner OLD_ID --reason "Host confirmed termination" --confirmed-terminated` with its own non-Codex `--worker-id` if applicable. Recovery preserves packets/features, retires OLD_ID, logs the attestation, and releases ownership for a fresh claim. It does not automatically take over live ownership or clear a pending handoff.

While a transfer is parked, the runtime rejects feature and verification mutations. Read-only inspection remains available. This barrier governs the harness command surface; agent instructions still prevent direct edits by the parked worker.

This is development orchestration only. Any in-product agent, scheduler, loop, or orchestrator remains wholly application-owned and independent of `.harness/`.

Generated Codex and Claude `PreCompact` command hooks have a 600-second timeout so the bounded repository capture can finish; `SessionStart` and `SubagentStart` keep 30 seconds. Both hosts measure these timeouts in seconds ([Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hook fields](https://code.claude.com/docs/en/hooks#common-fields)). Initialization and sync upgrade only exact generated 30-second entries and canonical pending additions. Custom timeouts, wrappers, matching policies, added options, unrelated hooks, and edited additions remain preserved for review.

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

`security.environmentAllow` must exclude every configured provider source and target environment name, including names from custom providers. `doctor` and the reusable audit reject overlaps with names-only remediation. Command setup also subtracts the complete provider-name set from its ordinary base environment before adding the selected target for each explicitly requested provider, so an invalid overlapping configuration cannot make unrequested provider variables ambient.

This feature routes API keys for project commands; it does not convert ChatGPT, Claude, or Copilot consumer subscriptions into API access. Claude Code gives `ANTHROPIC_API_KEY` precedence over subscription login, and Anthropic requires API-key authentication for third-party products. Keep subscription login and project API-key automation conceptually separate.

Commands are never retried automatically with another key after execution begins because doing so could duplicate side effects. Round-robin selection advances before each requested command, so the next command or run uses the next available slot.

## Configuration

Edit `.harness/config.json` for project facts:

- `verification.quick`, `full`, `e2e`, `architecture`, and `clean`: cumulative executable gates.
- `scope.defaultAllow` and `defaultDeny`: change boundaries.
- `continuity`: fixed `orchestrated_worker` mode, dirty-worktree recording, reasoned worker checkpoints, and the post-transfer mutation barrier.
- `docs.required`: knowledge a fresh bounded worker must be able to reconstruct.
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

`sync` is idempotent. Runtime v6 migrates legacy continuity to `orchestrated_worker`, creates or repairs `.harness/continuity.json`, emits merge additions for restrictive legacy instructions, repairs only enabled coding-agent adapters, and preserves product code, project facts, historical evidence, and any pending ID-bound transfer.

For `.harness/docs-map.md` and the goal, maker, and checker loop files, `sync` recognizes the exact assets shipped by runtime v5 from the explicit bundled predecessor set. It upgrades only a byte-exact rendered match or the same content with CRLF normalized to LF. A current runtime-v6 copy is left byte-for-byte as found. Any customized or unknown copy is preserved and gets a generated `.v6.addition.md` sibling containing the rendered canonical v6 content and merge instructions.

Pending additions remain stable across repeated syncs and are reported by `audit`. After the destination matches canonical v6, a later sync removes the exact generated addition. If that addition was manually modified, sync preserves it and requests manual cleanup instead of deleting it.

## Design guarantees

- Initialization detects commands but does not install dependencies or run project scripts.
- `.harness/` governs repository development only; product-runtime agents and orchestration remain application-owned and independent.
- On Windows, relative executable paths in initializer command overrides are normalized for `cmd.exe` (for example, `.venv/Scripts/python.exe` becomes `.\.venv\Scripts\python.exe`); generated runtimes apply the same compatibility rule to existing configuration. POSIX command text is unchanged.
- Feature start records a v2 Git baseline with HEAD, tree, branch, and hashes for pre-existing dirty paths, then binds its full digest into the frozen feature contract. Verification uses complete bounded NUL-delimited status capture and unions commits since that HEAD with current staged, unstaged, renamed, deleted, and untracked paths without attributing unchanged baseline dirt.
- Git-backed scope fails closed when exact output exceeds its bound, status or history is malformed or unavailable, a legacy baseline lacks repository identity, or the starting commit is no longer an ancestor. Start a successor feature instead of backfilling or waiving an old baseline.
- New passing evidence uses schema v4 and embeds its canonical historical verification-plan manifest: schema metadata, frozen feature and contract identity, captured configuration hash, ordered required layers and executions, acceptance criteria, scope expectations, and relevant execution/evidence policy. Every command result carries the manifest's stable execution ID and order.
- `doctor` and reusable `audit` recompute `verificationHash` from that embedded manifest and validate exact result coverage, commands, layers, criteria, pass flags, exit codes, empty scope violations, and feature/contract/config relationships against the captured plan. They do not consult later mutable configuration, so legitimate post-pass configuration evolution does not invalidate history.
- Evidence schemas before v4 remain usable historical passes with an explicit warning that they lack an embedded manifest and were not independently plan-verified. Unknown future evidence or plan schemas fail closed until the runtime explicitly supports them.
- These checks establish structural consistency inside the repository. They are not cryptographic tamper-proofing against a malicious repository writer who can rewrite the evidence, feature state, and hashes together; that guarantee requires an external trust anchor such as signed attestations or immutable storage.
- Command environments are allowlisted; provider keys are injected only by explicit request.
- Secret-bearing environment values and common token formats are redacted before persistence.
- State mutations, continuity transitions, and credential rotation are serialized with a recoverable lock.
- Reasoned checkpoints keep normal results and user-input pauses in the persistent chat; worker transfers preserve dirty work and park harness mutations until an ID-bound fresh-worker resume. Their drift hashes exclude only continuity files those commands rewrite, so durable feature state, evidence, credential state, configuration, runtime, docs, quality, and loop files remain authenticated.
- A reviewed Codex `PreCompact` hook persists a worker packet and permits compaction on success; persistence failure remains fail-closed. Claude Code can opt into the same adapter.
- `passing` is terminal; regressions become new features.
- The development-harness controller is checked in and works on Windows, macOS, and Linux.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [ANALYSIS.md](ANALYSIS.md), and [REVIEW-2026-07-20.md](REVIEW-2026-07-20.md).


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim` (non-Codex workers append their own unique `--worker-id`), or runs the exact delegated pending resume command with its own identity. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.
