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
- Runtime-owned scope exemptions are narrow: feature state, events, evidence, handoff output, and the transient lock. Configuration, the runtime itself, docs, progress, quality, and loop prompts require explicit feature scope.
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

## Session start

1. Confirm the repository root.
2. Read `AGENTS.md` and the small harness state files.
3. Run `node .harness/run.mjs doctor`.
4. Run `node .harness/run.mjs status`.
5. Run `node .harness/run.mjs next`.
6. Read only docs relevant to the active feature and confirm applicable product, security, rights, provider, and deployment gates.
7. If baseline checks are already failing, record that state before changing feature code.

## Session end

1. Run the required verification or record why it could not run.
2. Update `progress.md` with current facts, not narrative history.
3. Run `handoff --summary` with the next executable action. Clean handoff fails when non-harness project changes remain; if committing is not authorized, record the blocker instead of weakening policy or committing implicitly.
4. Record blockers, risks, and changed files.
5. Leave the standard startup path working.

## Loop use

Use `.harness/loops/goal.md` for one durable objective with acceptance and stop conditions. Use separate maker and checker prompts when the loop may modify code autonomously. Store each round in external state; do not rely on conversation memory.

Stop when acceptance passes, max attempts are reached, the same failure repeats, or a human decision is required. Read the append-only trace before resuming blocked work. Scheduling and parallel worktrees are optional layers above this harness, not prerequisites.
