import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connect } from './client.mjs';

const cwd=path.resolve('scratch/live-host-e2e/project-native');
const client=await connect({cwd,logName:'parent-native-reviewed-events.jsonl',limit:16000});
try{
  const hooks=await client.rpc('hooks/list',{cwds:[cwd]});
  const thread=await client.rpc('thread/start',{cwd,model:'gpt-6.1-sol',approvalPolicy:'never',sandbox:'workspace-write',experimentalRawEvents:true,developerInstructions:'You are the read-only persistent orchestrator for this controlled live harness test. Do not claim or mutate the project, and do not create subagents yet. Your task is task planning, concise routing, and continuity. Use only local command tools; do not call external apps or inspect credentials. Keep each tool result below 4000 characters. The driver will create fresh worker sessions after your plan.'});
  const threadId=thread.thread.id;
  await writeFile('scratch/live-host-e2e/parent-native-thread.json',JSON.stringify({threadId,cwd,hooks,autoCompactTokenLimit:16000,scope:'body_after_prefix'},null,2));
  const first=await client.turn(threadId,'Inspect SPEC.md and acceptance.test.mjs in bounded chunks using real tools, and read node .harness/run.mjs session --json. Plan how two fresh workers will implement and verify ledger-001. Preserve continuity marker ledger-routing-7419 in your concise route summary. Do not implement code.');
  const second=await client.turn(threadId,'Continue the same ledger-routing-7419 objective. Inspect the input data shape and the harness context policy using concise real tools. Identify the most difficult money/refund correctness cases and an ordered worker routing plan. No implementation yet. Automatic host compaction is enabled in this controlled session; continue normally through any compaction event and preserve the exact objective.');
  const third=await client.turn(threadId,'Summarize the next exact worker milestone for ledger-routing-7419 and the acceptance risks from inspected files. Run one bounded local tool to reconfirm the project session is unowned. Return the continuity marker and task name. No code edits or worker claims.');
  const summary={threadId,turnStatuses:[first.status,second.status,third.status],compactionEvents:client.events.filter(e=>/compact/i.test(e.method??'')||/contextCompaction/.test(JSON.stringify(e.params?.item??{}))).map(e=>({method:e.method,item:e.params?.item?.type})),hookEvents:client.events.filter(e=>/^hook\//.test(e.method??'')).map(e=>({method:e.method,run:e.params?.run})),tokenEvents:client.events.filter(e=>/tokenUsage/.test(e.method??'')).map(e=>e.params),finalMessages:client.events.filter(e=>e.method==='item/completed'&&e.params?.item?.type==='agentMessage').map(e=>e.params.item.text).slice(-3)};
  await writeFile('scratch/live-host-e2e/parent-native-result.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify({threadId,statuses:summary.turnStatuses,compactions:summary.compactionEvents.length,hooks:summary.hookEvents.length,tokenEvents:summary.tokenEvents.length}));
}finally{await client.close();}
