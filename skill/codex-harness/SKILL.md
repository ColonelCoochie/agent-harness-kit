---
name: codex-harness
description: Initialize, audit, operate, repair, or simplify zero-dependency repository-development harnesses for Codex, Claude Code, and GitHub Copilot. Use for native instruction files, verification profiles, opt-in credential pools, WIP-limited features, executable evidence, bounded checkpoints, persistent development-orchestrator routing, fresh worker reconstruction, and ID-bound worker transfers. Never use it as application runtime or as state or orchestration for in-product agents.
---

# Repository Development Harness

Build a small repository-development control plane shared by enabled coding agents. `.harness/` is never application runtime. Product agents, loops, schedulers, and orchestrators keep application-owned state, configuration, telemetry, and operations and never depend on, read, or write `.harness/`; the harness only builds or tests them as feature-scoped product code.

The controller has zero npm dependencies and requires Node.js 20+. Git and a repository with an existing commit are required before starting feature scope. The harness does not create commits; initial commit setup belongs to the project. Read [repository prerequisites](references/operations.md#repository-prerequisites) when `HEAD` is absent.

## Orchestrated-Worker Protocol

Protocol marker: `ORCHESTRATED_WORKER_CONTINUITY_V1`.

Keep the user-facing development orchestrator chat open for user intent, decisions, concise status, and routing only. Delegate implementation to fresh bounded workers so repository detail does not accumulate in the orchestrator. Permit one mutating worker at a time; independent read-only explorers may run in parallel.

Normal completion and user-input boundaries use reasoned checkpoints and return compactly to the same orchestrator chat. Use `handoff` only for true worker context or ownership transfer. Product-runtime orchestration remains wholly independent of this development protocol.

## Workflow

1. Inspect the target before writing: existing `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, agent configuration, bounded harness views, docs and decision records, manifests, scripts, tests, and Git state. Identify product, security, data-rights, external-provider, and deployment gates.
2. Initialize only when `.harness/config.json` is absent. Select only coding-agent surfaces the repository should expose:

   ```bash
   node <skill-dir>/scripts/harness.mjs init <project-dir> --name "Project name" --purpose "One-sentence purpose" --agents "codex,github-copilot"
   ```

3. Review `.harness/config.json` and identify the project's real quick, full, E2E, architecture, and cleanup commands. Plan configuration changes for an owned, explicitly scoped feature. Keep `continuity.mode` as `orchestrated_worker`.
4. Preserve existing instructions. Review `.harness/*.addition.md` for conflicts and plan any merges within owned feature scope. Require `## Development-Harness Boundary`, `## Orchestrated-Worker Protocol`, and `ORCHESTRATED_WORKER_CONTINUITY_V1`; disabled adapters remain absent across `sync`.
5. Keep the persistent orchestrator compact. It delegates repository work, carries user decisions between workers, and does not run an ID-bound resume or absorb implementation packets.
6. At worker start, inspect lifecycle before edits:

   ```bash
   node <project-dir>/.harness/run.mjs session --json
   ```

   A fresh worker claims unowned working state with `claim`, or runs the exact delegated `resume HANDOFF_ID` when parked; otherwise return the pending ID to the orchestrator without loading its packet. Codex uses its own `CODEX_THREAD_ID`; other hosts append their own unique `--worker-id ID` to claim/resume and every mutation. Then run `bootstrap --json` (optionally with a selected feature ID). Do not read full feature arrays, continuity packets, progress history, or baseline blobs at startup. A fresh user chat/task is the fallback only when the host cannot delegate subagents. If the old controller lacks claim/bootstrap, use the [conditional legacy upgrade](references/operations.md#legacy-controller-upgrade).
7. Read `.harness/config.json` and task-relevant routes in `.harness/docs-map.md`, then run startup and structural checks:

   ```bash
   node <project-dir>/.harness/run.mjs doctor
   node <project-dir>/.harness/run.mjs status
   node <project-dir>/.harness/run.mjs next
   node <skill-dir>/scripts/harness.mjs audit <project-dir>
   ```

8. Add concrete features whose behavior fits a bounded worker. Pair every observable `--criterion` with a `--command`, and declare scope with `--allow`, including any configuration or instruction merges. Start the feature before making those changes.
9. Operate state only through `.harness/run.mjs`: `session`, `claim`, `bootstrap`, `resume`, `migrate`, `recover`, `add`, `start`, `block`, `unblock`, `check`, `verify`, `trace`, `status`, `next`, `checkpoint`, and `handoff`. Never hand-edit passing state or continuity phases.
10. At normal completion, verify or block as appropriate, then use `checkpoint --reason worker_yield --summary ... --next ...`; return a concise result and yield. When user input is required, use `--reason needs_input`, return one concise question, and yield. Neither case needs a global handoff or new chat.
11. Use dirty-safe `handoff --summary ... --next ...` only for a true context or ownership transfer. It writes an ID-bound packet and parks mutations. The worker yields; the orchestrator delegates the exact resume command to a fresh worker without consuming the packet.
12. Review and trust project-local hooks. On successful Codex `PreCompact`, the shared adapter persists a worker packet so the persistent chat may compact and continue routing; persistence failure remains fail-closed. Claude Code may opt into the same reviewed script.
    For Claude, review generated `.claude/settings.json` or merge `.harness/claude-hooks.addition.json` while preserving user settings. Read-only SubagentStart supplies `claude-agent:<agent_id>` to the child, which appends its own `--worker-id` to claim/resume and every mutation. PreCompact binds/forwards that native ID; compact SessionStart emits bounded additionalContext routing. Native dispatch still needs host smoke validation. Other hosts choose unique manual IDs per worker; shared session IDs never authorize mutation.
13. Configure provider pools only when project commands need API keys. Command entries opt in with `credentials`; key values never enter project files.
14. Use `sync` to upgrade runtimes and fill legacy defaults without replacing project facts, product runtime, user instructions, or disabled agent surfaces. For controllers without claim/bootstrap or with active legacy baselines, read [legacy controller upgrade](references/operations.md#legacy-controller-upgrade) first. Canonical runtime-v5 docs-map and loop assets upgrade only by explicit predecessor identity; customized copies receive reviewable runtime-v6 additions instead of automatic merges.
15. Preview upgrades with `sync PROJECT --preview --json`. Bind apply with `--expect-plan HASH`; customized enabled runtime/hooks block all writes unless a reviewed `--replace-reviewed PATH=RAW_SHA256` explicitly selects a known executable path. Preserve custom changes through deliberate merge review before whole-file replacement. Never authorize replacement of evidence, baseline blobs, instructions or disabled adapters.
16. Before reporting completion, require passing evidence, a reproducible fresh-worker reconstruction path, and compact orchestrator routing.

## Commands

Use the reusable CLI for repository-level setup:

```bash
node <skill-dir>/scripts/harness.mjs init <project>
node <skill-dir>/scripts/harness.mjs audit <project> --json
node <skill-dir>/scripts/harness.mjs sync <project>
```

Use the checked-in controller for day-to-day work:

```bash
node .harness/run.mjs session --json
# Fresh worker: claim unowned working state, or use the exact delegated resume instead.
node .harness/run.mjs claim
node .harness/run.mjs bootstrap --json
# Read config.json and task-relevant routes in docs-map.md before these checks.
node .harness/run.mjs doctor
node .harness/run.mjs status
node .harness/run.mjs next
node .harness/run.mjs add feat-001 --title "Behavior" --description "Observable outcome" --criterion "The behavior works" --command "npm test" --allow "src/**"
node .harness/run.mjs start feat-001
node .harness/run.mjs check quick
node .harness/run.mjs credentials
node .harness/run.mjs verify feat-001
node .harness/run.mjs trace feat-001
```

Choose one worker boundary. For normal completion:

```bash
node .harness/run.mjs checkpoint --reason worker_yield --summary "Current facts" --next "Route the next bounded task"
```

For required user input:

```bash
node .harness/run.mjs checkpoint --reason needs_input --summary "Decision required" --next "Ask one concise question"
```

For a true context or ownership transfer:

```bash
node .harness/run.mjs handoff --summary "Transfer packet" --next "Continue the bounded implementation"
```

Each boundary ends that worker's mutations. After `worker_yield` or a resolved `needs_input`, the next fresh worker uses `claim`. Only `handoff` prints a pending resume: the orchestrator delegates that exact command to a fresh replacement worker, which uses it in place of `claim` in the startup sequence:

```bash
node .harness/run.mjs resume HANDOFF_ID
```

## Invariants

- Default to WIP=1. Raise it only for isolated ownership; never allow multiple mutating workers on one worktree.
- Keep root `AGENTS.md` a concise router and all enabled instruction surfaces on the same protocol marker.
- Keep the development/product-runtime boundary stable.
- Treat `.harness/features.json` as the scope authority and `.harness/continuity.json` as the worker-continuity authority.
- Permit `active -> passing` only through successful cumulative verification.
- Freeze the feature contract at start; fail closed when Git-backed scope cannot be evaluated and check scope before and after commands.
- Exempt only runtime-owned state from feature scope. Configuration, runtime, docs, quality, and loop prompts need explicit scope.
- Keep `passing` irreversible; represent regressions as new features.
- Record provenance hashes, a canonical historical verification-plan manifest, stable ordered execution IDs, layers, commands, pass flags, exit codes, duration, separate output streams, truncation, scope results, and repository identity in write-once evidence.
- Recompute the manifest hash and validate exact result, layer, acceptance, scope, feature, contract, and captured-config relationships without consulting later mutable configuration. Keep pre-manifest passes usable with an explicit non-plan-verified legacy warning and reject unknown future schemas.
- Treat repository-local evidence validation as structural consistency, not cryptographic tamper-proofing against a malicious writer without an external trust anchor.
- Redact common secret formats and secret-bearing allowlisted environment values before persistence.
- Expose provider credentials only to explicit command entries; never retry an executed command automatically with another key.
- Serialize state mutations and append correlated lifecycle events.
- Keep checkpoints bounded and current; use Git history, events, archives, and evidence for older detail.
- Use reason `worker_yield` for normal completion and `needs_input` for a user decision. Neither parks global work.
- Treat `handoff` as a worker transfer boundary. It records dirty state and parks mutations until an ID-bound fresh-worker resume.
- The orchestrator routes the exact resume command but does not consume implementation context. Use a fresh user chat/task only when subagents are unavailable.
- Treat reviewed `PreCompact` persistence as defense in depth: success permits compaction and continued orchestrator routing; failure remains fail-closed.
- Stop after repeated identical failures or when a decision requires the user.
- Keep initialization non-destructive and preserve existing user files unless overwrite is explicit.
- Treat post-pass configuration evolution as normal history; validate captured commands instead of retroactively invalidating evidence.
- Separate development maker and checker workers for autonomous or high-risk loops; neither is a product-runtime agent.

## References

- Read [architecture.md](references/architecture.md) for global versus per-project boundaries and orchestration topology.
- Read [operations.md](references/operations.md) for feature, verification, worker yield, transfer, and loop workflows.
- Read [audit-model.md](references/audit-model.md) for scores and behavioral metrics.
- Read [lecture-map.md](references/lecture-map.md) for rule traceability.

## Completion

Do not call a harness ready until:

- `audit` has no critical structural failure and `.harness/run.mjs doctor` passes.
- The verification profile contains real commands.
- A fresh worker can reconstruct purpose, architecture, state, active scope, continuity, any exact pending resume, and verification from repository files.
- The persistent orchestrator can route from user intent, decisions, compact status, and worker results without retaining implementation history.
- Every enabled instruction surface exists, agrees, and exposes the protocol marker.
- At least one representative feature has run through `start -> verify -> passing`, or the user knows behavioral validation remains pending.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.

An abandoned working owner can be released only after host/operator confirmation of termination: `node .harness/run.mjs recover --expected-owner OLD_ID --reason "Confirmed worker termination" --confirmed-terminated` (non-Codex actors append their own `--worker-id`). This explicit attestation preserves packets, retires OLD_ID, logs recovery, and leaves a fresh worker to claim. Never recover a live owner or clear a pending handoff.
