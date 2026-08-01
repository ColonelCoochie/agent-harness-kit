# Fresh-task Handoff

Generated: not yet generated

- Status: no terminal handoff is pending

## Terminal boundary

When generated, this file contains an exact handoff ID, resume command, bounded repository capsule, and bootstrap prompt. `handoff` is terminal for the current conversation even when the worktree is dirty. Stop after `STOP_CURRENT_CHAT`; do not call `resume` in the same transcript or substitute context compaction.

The runtime can park harness mutations and print a bootstrap, but it cannot universally create a new platform chat, terminate the current one, or prove task freshness.

## Summary

Harness initialized; no working task has been handed off yet.

## Next action

Run `node .harness/run.mjs session`, then `doctor`, `status`, and `next` before defining the first feature.
