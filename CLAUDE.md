@AGENTS.md

Inherit and enforce the canonical `## Development-Harness Boundary` from `AGENTS.md`. Claude Code uses `.harness/` only for repository-development work; product-runtime agents and orchestration remain application-owned and independent.

## Claude Code

Keep project-wide workflow in `AGENTS.md` and add only Claude-specific guidance here.

## Orchestrated-Worker Protocol

Protocol marker: `ORCHESTRATED_WORKER_CONTINUITY_V1`.

The persistent development orchestrator keeps the user-facing session open and delegates bounded repository work to fresh workers. Normal completion or a user-input pause uses a reasoned checkpoint and yields back to the orchestrator. Reserve `handoff` for a true worker transfer; the orchestrator delegates its exact resume command to a fresh worker without loading the implementation packet. Use a fresh Claude Code session only when subagents are unavailable.

Delegate through a fresh non-fork Agent invocation with a self-contained bounded prompt; never inherit an implementation transcript. Review the generated `.claude/settings.json` hooks (or merge `.harness/claude-hooks.addition.json` into existing settings, preserving user hooks). `SubagentStart` delivers the native `claude-agent:<agent_id>` identity to that child without claiming ownership. Only that child may append its identity to `claim`, the delegated `resume HANDOFF_ID`, and every mutation, including `checkpoint --reason worker_yield` and `handoff`. Never derive identity from shared `session_id` or borrow a parent's ID.

```bash
node .harness/run.mjs session --json
node .harness/run.mjs claim --worker-id claude-agent:<child-id>
node .harness/run.mjs bootstrap --json
node .harness/run.mjs verify FEATURE_ID --worker-id claude-agent:<child-id>
node .harness/run.mjs checkpoint --reason worker_yield --summary "Verified result" --next "Route next task" --worker-id claude-agent:<child-id>
```

When parked, replace `claim` with the exact delegated `resume HANDOFF_ID --worker-id claude-agent:<new-child-id>` command. If native identity delivery is unavailable, choose a fresh unique manual worker ID per child and pass `--worker-id` on every mutation; automatic hooks cannot infer that identity. A manually invoked PreCompact adapter may receive the matching `--worker-id` after review. Automatic PreCompact binds only `agent_id`, forwards the matching attestation, and blocks on unknown identity with an active owner or persistence failure. Claude main-session events lack `agent_id`; main compaction is deliberately inhibited until the owning child yields or persists a parked handoff. Missing identity never proves a trusted parent. SessionStart(compact) emits bounded `additionalContext` routing without loading or consuming the worker packet. These adapters have fixture coverage; live native hook delivery still needs host smoke validation. See the [Claude hooks reference](https://code.claude.com/docs/en/hooks#subagentstart).

<!-- agent-harness-context-v1 -->
## Proactive context management

Before each bounded work batch and delegation, run `node .harness/run.mjs context --observe --json`. This records the current actor's boundary without claiming a child owner; read-only inspection omits `--observe`. On hosts without native hooks, include estimated calls and returned characters since the previous observation through `--tool-calls N --output-chars N`, and use `--transcript PATH` when host telemetry is available. Keep tool responses concise: select only needed lines, set output limits, and inspect redacted `.harness/logs/` files through narrow queries. Never dump full transcripts, feature arrays, baseline blobs, or large command logs into conversation.

Workers target one implementation milestone per batch and check pressure at least every ten tool calls or five minutes. At pressure, persist `handoff --summary ... --next ...`, return only its exact resume command and a compact result, then stop. The orchestrator immediately delegates that command to a fresh worker (`fork_turns="none"` on Codex); it never runs the resume or absorbs the packet. Automatic mutation gates and reviewed native context hooks provide earlier boundaries when available. Exit 75 means rotation occurred and the requested mutation did not run.

The orchestrator keeps only user intent, decisions, compact worker results and routing. At its own pressure, use supported host compaction with the project auto-compaction defaults and reconstruct from `session --json`; never transfer or recover a live child to free parent context. Repeated interrupted internal goal turns without tool progress trip a circuit breaker: stop that continuation and reconcile host goal state before another run. Never request continuation from a Stop hook to repair pressure.

Hooks require local host review/trust. Native dispatch and identity delivery must be validated on the actual host; tools or goal schedulers that skip hooks cannot be intercepted by this CLI. Missing token telemetry uses conservative byte growth and work budgets, not assumed headroom. Product runtime remains independent of `.harness/`.
<!-- /agent-harness-context-v1 -->
