<!-- agent-harness-context-v1 -->
## Proactive context management

Before each bounded work batch and delegation, run `node .harness/run.mjs context --observe --json`. This records the current actor's boundary without claiming a child owner; read-only inspection omits `--observe`. On hosts without native hooks, include estimated calls and returned characters since the previous observation through `--tool-calls N --output-chars N`, and use `--transcript PATH` when host telemetry is available. Keep tool responses concise: select only needed lines, set output limits, and inspect redacted `.harness/logs/` files through narrow queries. Never dump full transcripts, feature arrays, baseline blobs, or large command logs into conversation.

Workers target one implementation milestone per batch and check pressure at least every ten tool calls or five minutes. At pressure, persist `handoff --summary ... --next ...`, return only its exact resume command and a compact result, then stop. The orchestrator immediately delegates that command to a fresh worker (`fork_turns="none"` on Codex); it never runs the resume or absorbs the packet. Automatic mutation gates and reviewed native context hooks provide earlier boundaries when available. Exit 75 means rotation occurred and the requested mutation did not run.

The orchestrator keeps only user intent, decisions, compact worker results and routing. At its own pressure, use supported host compaction with the project auto-compaction defaults and reconstruct from `session --json`; never transfer or recover a live child to free parent context. Repeated interrupted internal goal turns without tool progress trip a circuit breaker: stop that continuation and reconcile host goal state before another run. Never request continuation from a Stop hook to repair pressure.

Hooks require local host review/trust. Native dispatch and identity delivery must be validated on the actual host; tools or goal schedulers that skip hooks cannot be intercepted by this CLI. Missing token telemetry uses conservative byte growth and work budgets, not assumed headroom. Product runtime remains independent of `.harness/`.
<!-- /agent-harness-context-v1 -->
