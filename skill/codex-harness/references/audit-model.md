# Audit model

`agent-harness audit` scores structure, weighted by importance:

- instructions: `AGENTS.md` exists, carries the v7 harness block, stays under 16 KiB, has no v6 boilerplate; other enabled surfaces route to it
- tools: config parses, `.harness/run.mjs` matches the kit runtime, no v6 per-tool hooks
- feedback: `verification.full` configured
- environment: Git `HEAD` exists, no v6 runtime leftovers
- state: `run.mjs doctor` reports no errors (statuses, evidence for passing features, dependency graph, WIP, continuity)

A structural score says the harness is wired correctly, not that agents will succeed. Track behavior separately:

- time from fresh worker start to first useful command
- verified completion rate (passing / started features)
- blocked features and repeated-failure count before escalation
- handoffs per completed feature (high numbers mean features are too big)
- orchestrator context growth per completed worker round

Periodically delete rules that no longer prevent observed failures, promote recurring review findings into executable checks, and keep `AGENTS.md` short.
