# Worker Transfer

Generated: not yet generated

- Status: no pending worker transfer

## Worker transfer boundary

When generated, this file contains an exact handoff ID, resume command, and bounded repository context packet. `handoff` is only for a true context or ownership transfer. It preserves dirty state, parks harness mutations, and tells the handing-off worker to yield.

The persistent development orchestrator delegates the exact resume command to a fresh worker without consuming the implementation packet. A fresh user chat/task is required only when the host has no subagent capability.

## Summary

Harness initialized; no worker transfer is pending.

## Next action

Delegate a bounded worker to run `node .harness/run.mjs session`, then `doctor`, `status`, and `next` before defining the first feature.
