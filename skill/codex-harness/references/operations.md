# Operations

## Verified native hook updates

Review the canonical kit source and initial native/local hook trust before running `agent-harness hook-policy enable ABSOLUTE_KIT_ROOT --project ABSOLUTE_PROJECT_ROOT`. The policy records explicit authority over future exact canonical kit definitions for enrolled projects. `hook-policy status --json` reports it; `hook-policy disable` prevents future automatic approvals without revoking existing native approvals. Add projects with `init ABSOLUTE_PROJECT_ROOT --enroll-hooks` or `sync ABSOLUTE_PROJECT_ROOT --enroll-hooks` from the same trusted kit. Canonical content and exact installed native definitions must verify before automatic approval. Existing custom hook definitions, project trust and native hook dispatch review remain separate.

For a canonical definition release, preserve each verified predecessor's complete group digest in `assets/migrations/native-hooks-v3/group-identities.json` and update its source pin in `scripts/lib/core.mjs`. Keep the released v1/v2 bootstrap assets and earlier migration manifests immutable. The digest includes literal launcher commands and every hook/group option. Sync accepts exactly one known old/current group per event and replaces an exact predecessor at its existing index. Custom fields and duplicate predecessors or old/current pairs require review. Preserved v1/v2 groups retain their original repair grammar and need an explicitly reviewed update to gain v3 repair admission. The manifest is part of source verification and sync drift checks; project metadata and installed helper bytes are never predecessor authority. Run the actual full source tests for each approval.

Stable versioned v3 native launchers check project code without depending on an installed runtime or adapter and admit reviewed repair of every managed executable and bootstrap manifest. If code is missing or changed, invoke the independent approved source: `node ABSOLUTE_KIT_ROOT/bin/agent-harness.mjs repair ABSOLUTE_PROJECT_ROOT --preview`. Review the deterministic plan and, for unknown executable bytes, supply repeatable `--replace-reviewed PATH=SHA256`; apply with the same reviewed replacements and `--expect-plan SHA256`. This restores generated control plane code without native approval and preserves pending transfer state byte for byte. The operation requires enabled canonical source authority and project enrollment. A different live owner or a retired actor is denied. Non-Codex workers append their own `--worker-id ID`; this never overrides native `CODEX_THREAD_ID` and shared session IDs confer no ownership. Automatic native hooks do not infer a manual worker ID.

The kit remains zero-dependency Node.js 20+ software, with `agent-harness` and `codex-harness` CLI names. `.harness/` is repository-development state only.

## Repository prerequisites

The controller has zero npm dependencies and requires Node.js 20+. Git and a repository with an existing commit (`HEAD`) are required for feature scope: `start` freezes that commit as the baseline. Initialization can run earlier, but it does not create a repository or commit. Check `git rev-parse --verify HEAD` before starting a feature.

Create the initial commit through normal project setup under the project's commit authorization. An explicitly authorized optional empty local commit is possible only with an empty index: require `git diff --cached --quiet` to succeed and confirm `git diff --cached --name-only` is empty before `git commit --allow-empty -m "Initialize repository history"`. Never stage unknown files to satisfy the prerequisite. The harness never commits automatically.

## Feature state machine

```text
not_started -> active -> passing
                  |
                  +-> blocked -> active
```

- `start` requires all dependencies to be `passing` and an available WIP slot.
- `start` freezes the feature contract and a v2 Git baseline containing the starting HEAD, tree, branch, complete dirty project paths, and content hashes. Runtime-owned state is excluded before scope capture. A digest of that full identity, including any explicit artifact capture policy, is bound into the versioned contract so paired baseline edits cannot move the feature's starting point.
- `verify` checks new changes against feature allow/deny rules before and after commands. It unions the committed diff from the starting HEAD with complete current staged, unstaged, renamed, deleted, and untracked state, then subtracts pre-existing dirty content whose hash did not change.
- Repository capture is byte-bounded and NUL-delimited. Overflow, malformed status or diff records, unavailable Git, a missing legacy baseline identity, a missing starting commit, or a starting HEAD that is no longer an ancestor fails scope closed. Preserve the historical feature and start a successor; never backfill or waive its baseline.
- Runtime-owned scope exemptions are narrow: feature state, events, evidence, credential cursor, continuity state, generated progress/transfer projections, archived progress projections, and the transient lock. Configuration, runtime, project docs, quality, and loop prompts require explicit feature scope.
- Checkpoint and handoff drift exclude only continuity files those commands rewrite: events, continuity, progress/transfer projections, archived progress projections, and the transient lock. Feature state, evidence, credential cursor, configuration, runtime, documentation, quality, and loop files remain authenticated instead of disappearing behind a blanket `.harness/` exclusion.
- `verify` runs cumulative required layers plus every behavior-specific acceptance command. It writes provenance-bound evidence whether the run passes or fails.
- Every configured provider source and target environment name, including custom-provider names, is reserved from `security.environmentAllow`. `doctor` and reusable audit fail with names-only remediation when an overlap exists, and execution defensively removes the complete reserved set from the ordinary child environment.
- A command receives provider credentials only when its entry declares `credentials`; after ordinary-environment filtering, only explicitly requested providers add their selected values under their target names. `round_robin` advances a non-secret cursor before execution; `first_available` uses the first populated source.
- Credential failures are command failures. The runtime never retries an executed command with another key because it cannot assume idempotence.
- Successful verification is the only route to `passing`; `passing` is terminal. Add a regression feature instead of rewriting history.
- `block` requires a reason. `unblock` rechecks WIP and dependencies.
- Runtime mutations and reusable `sync` acquire the same atomic `.harness/state.lock`. Each owner has a unique token-named record, release removes only that exact token, and the fixed lock directory is never recursively deleted by normal cleanup. Contention fails fast rather than overlapping state reads or writes.
- A lock whose owner PID is confirmed live or cannot be checked safely is never stolen because of age. A definitively dead owner can be recovered immediately; ownerless or malformed locks recover only after five minutes when the directory contains no unknown files. Before manual cleanup, inspect the owner record and confirm its PID is not running.
- Repeated identical failures or the attempt ceiling block work and direct the operator to `trace`.
- `next` reports dependency-ready work without changing state.
- Top-level help and `COMMAND --help` or `COMMAND -h` are pure preflight paths. They select stable command-specific usage before configuration, continuity, locks, or other project state is inspected. Every mutating command rejects options outside its declared schema before acquiring a lock or performing work and points the operator to that command help.
- Reusable `sync` upgrades `.harness/docs-map.md` plus the goal, maker, and checker loop files only when they exactly match the explicitly bundled runtime-v5 predecessor rendered for that project; CRLF-to-LF normalization is the sole accepted normalization. Current runtime-v6 copies remain byte-preserved. Customized or unknown copies remain untouched and receive generated `.v6.addition.md` siblings with canonical v6 content and merge instructions.
- Generated canonical-asset additions are stable and auditable while unresolved. Sync removes an exact generated addition after its destination reaches canonical v6, but preserves a manually modified addition for explicit cleanup.
- Sync rejects unsupported config, feature-state, and continuity schemas before writing project files. It preserves customized review additions across repeated syncs.
- `sync --preview --json` is read-only even with a stale state lock. It returns ordered operations, before/after raw hashes, target/source read sets, blockers and a deterministic `planHash`. `sync --expect-plan HASH` rejects a changed plan; apply also authenticates its complete read set under the shared state lock before durable writes. Atomic writes are per file; an I/O failure after preflight can still leave a partial apply, so rerun preview after fixing it.
- Sync upgrades an enabled runtime or adapter only when it is missing, already canonical, matches a bundled exact predecessor digest, or matches its previously installed digest in `.harness/managed-files.json`. Unknown/customized executables block the whole apply without being adopted into that inventory. Repeatable `--replace-reviewed PATH=RAW_SHA256` permits complete replacement only for enabled `.harness/run.mjs` and the three known `.harness/hooks/*.mjs` paths; review the resulting plan and bind it with `--expect-plan`. Disabled surfaces, project instructions, evidence, baselines and edited review additions remain preserved.
- Repository capture adds directory membership fingerprints plus descendant rows and streams regular files through a reused 1 MiB buffer. Historical mode-plus-bytes file and mode-plus-link symlink hashes remain unchanged. Shared collectors bound current, committed and missing-baseline captures to 32,768 entries, 16 MiB of manifest accounting, depth 64, 16 GiB of file bytes and five minutes. Elapsed limits are cooperative around I/O and do not cancel a stalled filesystem call. Identity/membership seals detect observed drift; pathname-based access does not establish an atomic snapshot or proven handle-relative safety against adversarial ancestor swaps.

Generated Codex and Claude `PreCompact` hooks use 600 seconds to accommodate the repository collector's five-minute bound with room for packet persistence. Routing and identity hooks keep 30 seconds. [Codex](https://learn.chatgpt.com/docs/hooks) and [Claude](https://code.claude.com/docs/en/hooks#common-fields) define command-hook timeouts in seconds and ordinarily default to 600. Initialization and sync replace only exact generated PreCompact entries with numeric `30` and the generated matcher, plus whole canonical pending additions with the old timeout. Custom timeouts, wrappers, matcher policies, hook options, and edited additions stay byte-preserved when no legacy command itself needs migration.

## Verification hierarchy

Use the smallest fast loop while coding. Completion is cumulative:

1. `quick`: focused static checks or unit tests.
2. `full`: repository test/build gate.
3. `e2e`: user-visible pipeline behavior.
4. `architecture`: executable boundary rules.
5. `clean`: stale-artifact and restartability checks.

`full` is always required. Configured `quick` and `architecture` layers also run by default; a feature may additionally require `e2e` or `clean`. Every acceptance criterion always runs.

Schema-v4 passing evidence embeds the canonical historical plan used for that run. The manifest records supported schema metadata, frozen feature/contract identity, the captured configuration hash, ordered required layers, ordered executions with stable IDs and expected success, ordered acceptance criteria mapped to executions, the feature scope contract and empty-violation expectation, plus relevant timeout and redaction policy. Results carry the matching execution ID and order.

`doctor` and reusable `audit` recompute `verificationHash` from the embedded manifest and require exact one-to-one result coverage: no missing, extra, or duplicate planned executions; no omitted layer or acceptance criterion; exact command/layer/criterion linkage; successful result flags and exit codes; and empty scope violations. The plan must agree with the evidence's feature, frozen contract, and captured config fields. Validation deliberately uses that historical snapshot instead of current mutable configuration, so later legitimate configuration evolution remains valid.

Evidence before schema v4 lacks the embedded manifest. Its historical pass remains usable when its older provenance checks succeed, but status and audit output warn clearly that it is legacy and was not independently plan-verified. Unknown future evidence or plan schemas fail closed until explicitly supported. Repository-local hashes and cross-checks provide structural consistency only; a malicious writer able to rewrite evidence, feature state, and hashes together is outside this trust model unless an external trust anchor such as signed attestations or immutable storage is added.

## Orchestrated worker continuity

`.harness/continuity.json` is the machine-readable lifecycle authority. `.harness/progress.md` and `.harness/handoff.md` are bounded projections, not independent state or conversation transcripts. Configuration uses `continuity.mode: "orchestrated_worker"`.

```text
persistent development orchestrator
  |
  +-- delegate fresh bounded worker --> working generation N
          +-- checkpoint(worker_yield) --> concise result; worker yields
          +-- checkpoint(needs_input) --> concise question; worker yields
          +-- handoff(true transfer) --> awaiting_resume + ID-bound packet
                                             |
                                             +-- orchestrator delegates exact resume
                                                 to a fresh worker --> generation N+1
```

The development orchestrator remains in the user-facing chat and keeps only user intent, decisions, concise status, and routing. It does not implement repository changes, absorb implementation transcripts, or consume transfer packets. Delegate one mutating worker at a time; independent read-only explorers may run in parallel. Product-runtime orchestration remains wholly independent of `.harness/`.

- `session [--json]` is the first worker startup check. It reports phase, generation, latest checkpoint, pending transfer ID, and exact resume command without changing state.
- `checkpoint --reason worker_yield --summary TEXT [--next TEXT]` records normal completion or a bounded milestone. `checkpoint --reason needs_input ...` records a user-input boundary. Both keep continuity `working`, update progress, append an event, and return control to the persistent orchestrator without a global handoff or new chat.
- Detailed changed-file records cover at most 100 paths. Total changed-file count and worktree hash still cover the full change set. Keep prose current; Git history, events, archives, and evidence carry older detail.
- Checkpoint text limits use UTF-8 bytes: summary 4,000, next action 2,000, repeated entries 1,024 each and at most 20 entries. The packet has a 24 KiB aggregate budget and its startup projection a 12 KiB budget. Active descriptions, inferred next actions, and the final 32 KiB bootstrap are validated before any state/projection writes; oversize input leaves the prior state intact.
- `handoff --summary TEXT --next TEXT` is only for a true context or ownership transfer. It writes a bounded ID-bound packet, archives the prior projection, records dirty state without cleaning or committing it, parks harness mutations, and sets `awaiting_resume`. Dirty-safe continuity does not waive later feature scope.
- The handing-off worker yields. The orchestrator delegates the exact `resume HANDOFF_ID` command to a fresh worker without loading the packet. A new user chat/task is the fallback only when the host cannot delegate subagents.
- While awaiting resume, the runtime rejects feature and verification mutations. Read-only inspection remains available. The barrier covers harness commands, so agent instructions must also prevent direct edits by the parked worker.
- `resume HANDOFF_ID` validates the ID, feature revision, configuration hash, commit, branch, and worktree hash before advancing the generation. Drift fails closed; use `--accept-drift` only after a fresh worker reports every difference for deliberate review.
- A reviewed Codex `.codex/hooks.json` `PreCompact` adapter invokes the shared packet writer. On success, it persists the worker transfer and allows the persistent chat to compact and continue routing through a fresh worker. On persistence failure it denies compaction and remains fail-closed. Claude Code may opt into the same script after review. Do not assume another host supports this hook.
- The runtime can persist state, park its mutations, and print an exact resume bootstrap. Host orchestration delegates the worker; the harness does not create subagents itself.

## Worker startup

1. Confirm the repository root and read `AGENTS.md`.
2. Run `node .harness/run.mjs session --json` for bounded routing before changing files. For an older controller without claim/bootstrap, follow [legacy controller upgrade](#legacy-controller-upgrade).
3. Claim unowned working state with `node .harness/run.mjs claim`. If continuity is `awaiting_resume`, only a fresh worker delegated that transfer runs the exact printed resume instead; otherwise return its ID without loading the packet. An existing working owner must yield or follow the confirmed-termination recovery procedure; do not take it over.
4. Run `node .harness/run.mjs bootstrap --validate --json` (optionally with a selected feature ID). Codex uses its own `CODEX_THREAD_ID`; other hosts append their own unique `--worker-id ID` to claim/resume and every mutation.
5. Read `.harness/config.json` and task-relevant routes in `.harness/docs-map.md`; confirm applicable product, security, rights, provider, and deployment gates. Do not dump full feature arrays, continuity packets, historical progress, or baseline blobs at startup.
6. Use the combined validation and status/next projection; standalone `doctor`, `status`, and `next` remain available.

`bootstrap --validate --json` loads state once and validates all historical contracts, baseline blobs, evidence, budgets, instruction routes and native configuration checks through the same collector as `doctor`. It includes bounded status and next projections. Diagnostic totals and omission counts remain present when messages exceed the 32 KiB emitted-output limit; validation errors still produce a nonzero exit. Add `--integrity` for repository content integrity instead of the ordinary listing-only structural check. Plain `bootstrap --json` retains its original projection.
7. If baseline checks are already failing, checkpoint that fact before changing feature code.

## Context and output budgets

Use `context --observe --json` before each bounded batch and delegation. It persists metadata for the current actor; omitting `--observe` only inspects it. Manual hosts report `--tool-calls N --output-chars N` since the previous observation and can provide `--transcript PATH`. Identity remains the actual Codex thread or the worker's explicit non-Codex `--worker-id`; shared session IDs partition unidentified hook telemetry but never authorize ownership. Accounting uses a separate per-actor lock and never changes a live child's owner when the parent observes pressure.

`config.context` defaults to worker limits of `maxAgeMs: 1200000`, `maxMutations: 48`, `maxToolCalls: 80`, and `maxOutputChars: 120000`. Orchestrator limits are 7200000 ms, 48 mutations, 160 calls, and 160000 characters. Default pressure is 65% of a known window with 24000 reserved tokens; without a window, estimated pressure is 120000 tokens. Unmeasured growth trips at 240000 bytes; usage older than five minutes trips after 48000 new bytes. Estimates conservatively add one token per three new transcript bytes. These are work boundaries and estimates, not an exact remaining-context guarantee.

`context.codexCodeModeResultSuppressionConfirmed` defaults to `false` and accepts only a boolean. Enable it only after observing actual native Codex tool-result suppression on the enrolled host. With this attestation, an oversized Codex result charges the exact emitted replacement JSON only after its redacted log is persisted. A later adapter failure restores the raw charge. Unconfirmed hosts, Claude, ordinary results and failed log persistence retain conservative raw accounting. Token, transcript, ownership, age and interrupted-goal gates remain independent.

The incremental scanner reads at most 1 MiB and bounds each parsed line to 256 KiB. It retains offsets, usage samples, classifications, and counters only; prompt bodies and tool contents never enter context state. Recognized compaction metadata resets parent age, call, and output budgets; other transcript epochs reset telemetry only. A real user record or tool progress clears the interrupted-goal sequence. Six interrupted internal goal turns without progress trigger the circuit, including when old token usage stopped advancing. Unknown or missing transcript formats fall back to work and byte budgets.

At worker pressure, the mutation gate persists an owned automatic handoff and exits 75 before the requested mutation. Native hooks can do the same earlier and deny ordinary tools while allowing exact harness management and routing. Config/accounting and identity import failures remain closed to ordinary work. A genuine user prompt remains available with a warning; failed automatic goal continuation remains stopped. The independent `node .harness/repair.mjs health --json` command reports installed hashes without loading the runtime, identity parser or context telemetry. Run `node .harness/repair.mjs sync --preview --json`, review any unknown executable bytes, then preview with `--replace-reviewed PATH=RAW_SHA256` and apply with that preview's `--expect-plan SHA256`. The install-recorded reusable CLI performs guarded sync while preserving ownership, handoffs, features and evidence. Repair PostToolUse feedback remains available so health, preview and apply can finish without another prompt; a completed command must never be replayed. The native launcher keeps only these exact local repair commands available even when an adapter has a syntax error; runtime ownership checks still apply. If reusable source is itself faulty, repair the trusted source checkout through an external terminal or a separately reviewed installer before syncing; sync cannot correct its own source bytes. A damaged host hook configuration itself needs external terminal repair and local hook review; sync preserves malformed/customized host configuration with a review addition instead of overwriting it. Check pressure every ten calls or five minutes and transfer at a bounded milestone. The orchestrator delegates the exact resume to a fresh worker; it never absorbs the packet. Parent age or output pressure gives compaction guidance rather than denying ordinary tools, so idle waits do not require a user to manually unblock routing.

`perResultChars: 6000` and `perRunChars: 16000` cap feedback from `check`/`verify`; redacted stdout/stderr logs are referenced by each result and evidence retains bounded excerpts and truncation metadata. With redaction enabled, an unsafe oversized span writes an explicit omission marker and suppresses the rest of the affected stream from display, logs, and evidence excerpts, including later lines. Stdout and stderr are independent, and original byte counts remain available. Runtime-owned context/log files are excluded before scope capture. These development artifacts do not become product runtime.

Review/trust updated native hook commands locally. PreToolUse uses an explicit deny response; Stop uses `continue: false` and never `decision: block`, which would request another continuation. Oversized Codex PostToolUse feedback can be substituted after completion; Claude receives a notice and may still expose the original result. Fixture tests establish adapter behavior, not live host interception or trust. The circuit does not cancel a native goal, and a scheduler that skips hooks remains outside interception. Reconcile host state before restarting a stopped continuation.

Safe Codex configuration adds an 80000-token auto-compaction threshold and `"total"` scope below the fallback 120000-token pressure limit, preserving custom values and hooks flags. Unsupported quoted/inline/multiline TOML forms receive `.harness/codex-context-config.addition.toml` for review. `sync --defer-host-config` upgrades the harness while postponing `.codex/config.toml` to separately authorized scope. The CLI advises supported compaction; it does not invoke a private host API.

## Generated output capture

Ordinary `doctor` validates the complete Git status listing, authenticates referenced baseline blobs, and validates passing evidence against its historical plan. It does not hash the current dirty worktree. `doctor --integrity` additionally streams every current dirty project file through full content capture and prints a `content-v1` snapshot digest and byte count. That digest describes this capture, not a comparison with the baseline or a release authorization. Ignored files are outside Git scope; release tooling must still authenticate every exact deployment input.

Scope capture hashes source, scripts, configuration, JSON manifests, and unknown file types every time. Large generated outputs can opt into explicit metadata fingerprints:

```json
"scope": {
  "capture": {
    "version": 1,
    "metadataRoots": ["generated/previews", "builds"],
    "metadataExtensions": [".png", ".rbxlx", ".zip"]
  }
}
```

Roots must be exact canonical repository-relative directories, with no wildcards or traversal. Development control and conventional source roots are protected. Only approved output extensions are accepted: images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`), `.pdf`, media (`.mp4`, `.webm`, `.mov`, `.mp3`, `.wav`, `.ogg`), archives (`.zip`, `.gz`), `.fbx`, Roblox outputs (`.rbxl`, `.rbxlx`, `.rbxm`, `.rbxmx`), and `.log`. JSON, Luau, JavaScript, shell scripts, text prompts, HTML, configuration and unknown types continue using content hashes even inside selected roots. Editable authoring originals belong outside these roots.

New features freeze this policy in their baseline. Start reads selected output bytes once and retains their original `contentHash` beside a labelled `metadata-v1` fingerprint. Routine pre/post scope checks then enumerate and stat every selected output without reopening its contents. Fingerprints include device, inode, mode, size, modification time and change time. Directory membership, file type, symlink link bytes, and ancestor seals remain checked; output changes still require feature scope. This is a deliberate reduction in routine output-byte assurance, not a content-hash cache or proof of unchanged bytes. Captures report `artifact-metadata-v1` in evidence; later config edits do not change an active feature's frozen policy. Legacy baselines keep their original strict capture semantics.

Touching or recreating an identical output counts as a change under metadata capture. Include intended generated-output writes in the feature's scope, or retain full content capture when unchanged-byte rewrite tolerance matters. The runtime does not silently waive metadata drift.

Normal checkpoints use the configured policy and exclude runtime-owned evidence/state from project scope capture. True `handoff` and `resume` retain full content fingerprints. Baseline/evidence authentication and release planners' exact input digests remain full-content checks. Use explicit integrity checks or feature acceptance commands whenever artifact bytes matter to acceptance, and always retain exact content verification at deployment.

## Proportionate verification and correction

Owned bounded-worker startup, explicit feature scope, the configured verification gate, and reasoned worker yield are required. Extra plans, multiple independent reviews, process accounting and maker/checker rounds are optional unless project policy or a specific risk requires them. One focused review is sufficient for a bounded correction when its findings and required checks are resolved.

The same owned worker may correct a local quoting error, a deterministic test failure, or another reversible in-scope mistake and rerun the affected check. A new worker is needed for ownership/context transfer, not every shell error. Respect configured attempt/repeated-failure budgets. Stop for missing authority, a required user decision, or repeated identical failure without new evidence. An external command with an unknown outcome must be reconciled through read-only state inspection before any authorized retry; never automatically retry an executed command with another credential or repeat a deployment.

Keep `full` as the meaningful completion suite, and use feature `--level e2e` or `--level clean` when those layers apply. `completion.baseLayers` and `alwaysRunWhenConfigured` are universal requirements; put a costly layer there only when every feature needs it. Historical feature requirements and evidence remain frozen. Run the configured gate once after the final change and repeat only affected checks after a new change or failure.

## Legacy controller upgrade

Use this procedure only when the installed controller lacks claim/bootstrap or its active frozen baseline predates V2 Git identity. Current controllers use ordinary owned startup and reviewed sync.

1. A fresh worker reads the installed controller's `session --json`. If old JSON includes a full packet, parse it internally and expose only bounded routing fields; the orchestrator never reads the packet. For a parked transfer, delegate and run the exact installed resume command before proceeding. If claim/bootstrap are already supported, complete normal owned startup before any state mutation. Do not automatically accept drift or clear ownership.
2. Finish active legacy frozen work with the installed controller and its original gates before replacing it. If it cannot finish, use `block` to record the actual blocker and free the WIP slot while preserving the historical contract, baseline and evidence; use a scoped successor rather than backfilling identity or waiving scope. Determine whether Git `HEAD` exists; feature start requires it, while the narrow unborn maintenance path below does not create a commit.
3. When the old controller cannot claim/bootstrap, stage the reviewed reusable `assets/context-budget.mjs` at the target's `.harness/context-budget.mjs`, then copy `assets/project-runtime.mjs` byte-for-byte to `.harness/upgrade-bootstrap.mjs`. Compare raw SHA256 values with both reviewed sources. If the dependency already exists, authenticate it first and preserve a customized copy for deliberate review rather than overwriting it. These exact two files are the narrow exception needed to establish owned V2 maintenance scope before canonical replacement; copy no unrelated assets. Never execute the source runtime directly: its project root is derived from its installed location. The dependency remains part of the canonical installation after helper cleanup.
4. When the helper was needed, run `node .harness/upgrade-bootstrap.mjs claim`, then `bootstrap --validate --json`, read target config/docs, and run doctor/status/next through it. Otherwise keep using the owned installed controller. Use only the worker's own Codex identity or unique non-Codex `--worker-id` on every mutation. With existing Git `HEAD`, add and start a bounded maintenance feature through that controller before replacing `.harness/run.mjs`; its V2 baseline must explicitly scope the reviewed runtime, enabled adapters, instructions/configuration and exact helper cleanup. If Git is unborn and no feature is active, the owned worker may apply only the explicitly authorized harness maintenance upgrade and migrate preserved state; record source verification plus installed syntax, doctor and hash checks in its checkpoint. Never create an initial commit or invent a feature pass to enable deployment. Preserve unrelated dirty work in either path.
5. Review `sync TARGET --preview --json` through the reusable CLI. For each unknown enabled executable selected for whole-file replacement, supply its reviewed current raw SHA256 with `--replace-reviewed PATH=RAW_SHA256`, review that replacement preview, then apply those same selections with its `--expect-plan HASH`. Preserve/archive project configuration, historical contracts, evidence, custom settings and disabled surfaces. Do not infer permission for unrelated replacement, Git commits or automatic takeover.
6. Run canonical `node .harness/run.mjs migrate` once to change only legacy baseline representation; it must preserve historical contracts and evidence. Remove only the exact temporary helper, complete authorized instruction merges, then run canonical doctor and the maintenance feature's verify gate when Git `HEAD` permits feature scope. For an unborn repository, verify the installed runtime/dependency hashes and syntax and retain source-gate evidence without changing product feature status. Finish with `checkpoint --reason worker_yield` and a concise result. A blocker is recorded without manufacturing a pass.

## Worker yield and transfer

For ordinary completion:

1. Run required verification or record why it could not run.
2. Leave the standard startup path working and make the next action executable.
3. Run `checkpoint --reason worker_yield --summary ... --next ...`.
4. Return a compact result, evidence, risk, and next routing decision; then yield.

For required user input, use `--reason needs_input`, ask one concise question, and yield. For a true context or ownership transfer, run `handoff --summary ... --next ...`, return the transfer ID and exact resume command, and yield. The persistent orchestrator continues in the same user chat in all cases.

## Loop use

These loops coordinate coding-agent repository development only. They are never product-runtime agents, schedulers, or orchestration and must not own application state or operations.

Use `.harness/loops/goal.md` for one durable objective. Use separate maker and checker workers when the loop may modify code autonomously. A maker is the sole mutating worker; independent read-only checkers or explorers may run in parallel. Persist normal rounds with reasoned checkpoints and reserve handoff/resume for worker ownership or context transfer.

Stop when acceptance passes, max attempts are reached, the same failure repeats, or a human decision is required. Read the append-only trace before resuming blocked work. Product scheduling and orchestration stay in application runtime.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --validate --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.

Claude workers use fresh non-fork Agent invocations. Review `.claude/settings.json` (merge `.harness/claude-hooks.addition.json` when preserving existing settings). SubagentStart injects `claude-agent:<agent_id>` into that child without claiming ownership; only the child passes it as `--worker-id` on claim/resume and every mutation. PreCompact matches `agent_id`, forwards the same ID, and never infers identity from shared `session_id`. For manual hosts, choose a unique ID per worker and append it to every mutation; a manual PreCompact invocation must receive the same ID. The kit's optional `node tests/claude-native-smoke.mjs [--cli /absolute/claude]` check passed on Windows with Claude Code 2.1.198: it observes native startup and child payloads, production identity context in a fresh child model request, absent parent-only history, and unchanged ownership. The child and parent use local mock Messages responses and an isolated configuration without live credentials. Native PreCompact, compact SessionStart and Codex hook dispatch still need separate live host validation; the mock test also does not establish network confinement. See [Claude SubagentStart documentation](https://code.claude.com/docs/en/hooks#subagentstart).

After the host/operator confirms a former worker terminated, a distinct actor can run `node .harness/run.mjs recover --expected-owner OLD_ID --reason "Host confirmed termination" --confirmed-terminated` with its own non-Codex `--worker-id` if applicable. Recovery preserves existing packets/features, retires the old ID, records the reason and actor, then releases ownership for a fresh claim. It never automatically takes over, checks native host liveness itself, or clears an awaiting-resume barrier.
