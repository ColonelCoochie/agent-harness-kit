#!/usr/bin/env node
// Read-only: SubagentStart delivers the native identity before the child prompt.
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw || '{}');
  if (input.hook_event_name !== 'SubagentStart' || typeof input.agent_id !== 'string' || !/^[a-zA-Z0-9_./:-]{1,180}$/.test(input.agent_id)) console.log('{}');
  else {
    const id = 'claude-agent:' + input.agent_id;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `Your repository harness worker identity is ${id}. Only this child may use it. If delegated mutation work, append --worker-id ${id} to claim or the exact delegated resume command and every harness mutation, including checkpoint and handoff. This hook has not claimed ownership. Never use session_id as worker identity; never inherit the implementation transcript. Run bootstrap --json after claiming or resuming.` } }));
  }
} catch { console.log('{}'); }
