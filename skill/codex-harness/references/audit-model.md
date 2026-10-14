# Audit model

The audit scores instructions, tools, environment, state, feedback, scope, and lifecycle from structural facts. The first five are the course's core model; scope and lifecycle are cross-cutting enforcement planes. A structural score does not claim that an agent will succeed on representative work.

For schema-v4 passing evidence, the state score recomputes the embedded historical verification-plan hash and validates exact ordered command-result coverage, required layers, acceptance criteria, successful pass/exit flags, empty scope violations, and feature/contract/captured-config relationships. Pre-v4 passes remain usable but produce a legacy non-plan-verified warning; unknown future schemas are critical until supported. This is repository-internal structural consistency, not cryptographic tamper-proofing against a malicious repository writer without an external trust anchor.

## Interpretation

- 90-100: structurally ready for a behavioral trial.
- 75-89: usable; repair the lowest subsystem before autonomous loops.
- 50-74: incomplete; expect context or completion failures.
- Below 50: scaffold or rebuild the harness before relying on it.

Treat the lowest score as a candidate bottleneck. Confirm causality with command failures, evidence records, session rebuild time, premature completion rate, or representative before/after runs.

## Behavioral metrics

Track these outside the structural score:

- Time from fresh worker delegation to first useful command.
- Time from initialization to first passing feature.
- Verified completion rate: passing features divided by activated features.
- Worker reconstruction time and failure rate from repository state.
- Repeated-failure count before escalation.
- Orchestrator context growth per completed worker round.
- Successful `worker_yield` and `needs_input` checkpoint rate.
- Successful worker-transfer/ID-bound-resume rate.
- Automatic compactions with a persisted worker packet, plus fail-closed persistence failures.
- Fresh user chats/tasks required because subagents were unavailable.
- Before/after success on the same representative task.

Audit the harness periodically. Remove rules that no longer prevent observed failures, promote recurring review feedback into executable checks, and keep the root instruction file short.
