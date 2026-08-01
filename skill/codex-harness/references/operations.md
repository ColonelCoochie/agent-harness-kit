# Operations

## Feature state machine

```text
not_started -> active -> passing
                  |
                  +-> blocked -> active
```

- `start` requires all dependencies to be `passing` and an available WIP slot.
- `start` snapshots Git state and freezes a hash of the feature contract.
- `verify` checks new changes against feature allow/deny rules before and after commands while exempting runtime-owned state files.
- Runtime-owned scope exemptions are narrow: feature state, events, evidence, the credential cursor, continuity state, generated progress/handoff projections, archived progress projections, and the transient lock. Configuration, the runtime itself, project docs, quality, and loop prompts require explicit feature scope.
- `verify` runs cumulative required layers plus every behavior-specific acceptance command. It writes provenance-bound evidence whether the run passes or fails.
- A command receives provider credentials only when its entry declares `credentials`. `round_robin` advances a non-secret cursor before execution; `first_available` uses the first populated source.
- Credential failures are recorded as command failures. The runtime never retries an executed command with another key because it cannot assume the command is idempotent.
- Successful verification is the only route to `passing`.
- `passing` is terminal. Add a regression feature instead of rewriting history.
- `block` requires a reason. `unblock` rechecks WIP and dependencies.
- Mutations use a recoverable lock. Repeated identical failures or the attempt ceiling automatically block work and direct the operator to `trace`.
- `next` reports dependency-ready work without changing state.

## Verification hierarchy

Use the smallest fast loop while coding. Completion is cumulative, not a choice among alternatives:

1. `quick`: focused static checks or unit tests.
2. `full`: repository test/build gate.
3. `e2e`: user-visible pipeline behavior.
4. `architecture`: executable boundary rules.
5. `clean`: stale-artifact and restartability checks.

`full` is always required. Configured `quick` and `architecture` layers also run by default; a feature may additionally require `e2e` or `clean`. Every acceptance criterion always runs.

## Continuity lifecycle

`.harness/continuity.json` is the machine-readable lifecycle authority. `.harness/progress.md` and `.harness/handoff.md` are bounded human-readable projections, not independent state and not conversation transcripts.

```text
working generation N
  +-- checkpoint ----------> working generation N
  +-- terminal handoff ----> awaiting_resume
                                |
                                +-- fresh-task resume HANDOFF_ID --> working generation N+1
```

- `session [--json]` is the first startup check. It reports the phase, generation, latest checkpoint, pending handoff ID, and exact resume command without changing state.
- `checkpoint --summary TEXT [--next TEXT]` persists current facts while work continues. It updates progress and continuity and appends an event. A summary is limited to 4,000 characters, the next action to 2,000, each repeated decision/blocker/evidence list to 20 entries, and detailed changed-file records to 100 paths. The total changed-file count and worktree hash still represent the complete project change set.
- Keep checkpoint prose compact and current. Git history, `.harness/events.jsonl`, `.harness/history/progress/`, and `.harness/evidence/` carry older history.
- `handoff --summary TEXT --next TEXT` writes a capsule, archives the previous progress projection, renders the bootstrap, and sets the phase to `awaiting_resume`. It succeeds on a dirty worktree, records exact state, and neither cleans nor commits files. Dirty-safe continuity does not waive feature scope: a later `verify` still rejects out-of-scope changes.
- `handoff` is terminal for the current conversation. After `STOP_CURRENT_CHAT`, do not implement, call `resume`, continue the transcript, or substitute context compaction. Start a genuinely new chat or coding-agent task in the same worktree.
- Codex gets a defense-in-depth `.codex/hooks.json` automatic `PreCompact` guard that invokes the shared handoff script with `--platform codex`. After the project-local hook is reviewed and trusted, impending automatic compaction writes a dirty-safe handoff and returns `continue: false`, causing Codex to stop before compaction. Claude Code can optionally register `node "${CLAUDE_PROJECT_DIR}/.harness/hooks/precompact-handoff.mjs" --platform claude` for automatic `PreCompact` after review. Do not assume another host supports this hook.
- While awaiting resume, the runtime rejects `add`, `start`, `block`, `unblock`, `check`, `verify`, and `checkpoint`. Read-only inspection remains available. This mutation barrier covers the harness command surface; it cannot prevent direct filesystem edits or arbitrary shell commands, so agent instructions must enforce the stop boundary too.
- The fresh task runs the exact `resume HANDOFF_ID` command. Resume validates the ID, feature revision, configuration hash, commit, branch, and worktree hash before advancing the generation. Drift fails closed; use `--accept-drift` only after reviewing every reported change and deciding that it is intentional.
- The runtime and hook can park repository state and print a bootstrap prompt. They cannot universally create a new Codex, Claude Code, or GitHub Copilot task, terminate every host task, or prove that the operator used a fresh task. Platform UI or orchestration performs that boundary.

## Session start

1. Confirm the repository root.
2. Read `AGENTS.md`, then run `node .harness/run.mjs session` before changing files.
3. If continuity is `awaiting_resume`, confirm this is a genuinely fresh task and run the exact printed `node .harness/run.mjs resume HANDOFF_ID` command. If it is not a fresh task, stop and open one. Do not use `--accept-drift` without reviewing the drift.
4. Read `.harness/config.json`, `.harness/features.json`, `.harness/continuity.json`, `.harness/progress.md`, and `.harness/handoff.md`.
5. Run `node .harness/run.mjs doctor`, `status`, and `next` after any required resume.
6. Read only docs relevant to the active feature and confirm applicable product, security, rights, provider, and deployment gates.
7. If baseline checks are already failing, record that state with a bounded checkpoint before changing feature code.

## Session end

1. Run the required verification or record why it could not run.
2. Leave the standard startup path working and make the next action directly executable.
3. Run `checkpoint --summary ... --next ...` first only when another meaningful in-task milestone needs persistence. A terminal handoff creates its own final capsule.
4. Run `handoff --summary ... --next ...`, adding bounded `--blocker`, `--decision`, and `--evidence` entries when useful. Dirty project files are recorded automatically and do not require an implicit commit.
5. Treat `HANDOFF_READY` and `STOP_CURRENT_CHAT` as the end of this task. Do not resume in the same conversation; give the printed bootstrap to a genuinely fresh task.

## Loop use

These loops coordinate coding-agent repository development only. They are never product-runtime agents, schedulers, or orchestration and must not own application state or operations.

Use `.harness/loops/goal.md` for one durable development objective with acceptance and stop conditions. Use separate development maker and checker prompts when the loop may modify code autonomously. Persist each completed round with a bounded `checkpoint`; do not rely on conversation memory. Use terminal `handoff` and fresh-task `resume` when the coding conversation must change.

Stop when acceptance passes, max attempts are reached, the same failure repeats, or a human decision is required. Read the append-only trace before resuming blocked work. Coding-agent scheduling and parallel development worktrees are optional layers above this harness, not prerequisites; application scheduling belongs to product runtime.
