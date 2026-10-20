import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connect } from './client.mjs';
const state=JSON.parse(await readFile('scratch/live-host-e2e/parent-native-thread.json','utf8'));
const cwd=path.resolve(state.cwd);
const client=await connect({cwd,logName:'parent-auto5000-events.jsonl',limit:5000});
try{
  const config=await client.rpc('config/read',{cwd,includeLayers:false});
  await client.rpc('thread/resume',{threadId:state.threadId,cwd,approvalPolicy:'never',sandbox:'workspace-write',config:{model_auto_compact_token_limit:5000,model_auto_compact_token_limit_scope:'body_after_prefix'}});
  const turn=await client.turn(state.threadId,'Continue the same inspected ledger task as its read-only orchestrator. Preserve the established continuity marker and exact feature ID. Confirm the CLI milestone and acceptance command using one bounded local tool; then return the marker, objective, next worker milestone and any blockers. This test session now uses an accelerated 5000-token body budget; proceed normally through automatic compaction and do not invoke compaction manually. Do not edit or claim.');
  const summary={threadId:state.threadId,status:turn.status,effectiveConfig:{limit:config.config?.model_auto_compact_token_limit,scope:config.config?.model_auto_compact_token_limit_scope},compactionEvents:client.events.filter(e=>/compact/i.test(e.method??'')||/contextCompaction/.test(JSON.stringify(e.params?.item??{}))),hookEvents:client.events.filter(e=>/^hook\//.test(e.method??'')),tokenEvents:client.events.filter(e=>/tokenUsage/.test(e.method??'')),finalMessages:client.events.filter(e=>e.method==='item/completed'&&e.params?.item?.type==='agentMessage').map(e=>e.params.item.text)};
  await writeFile('scratch/live-host-e2e/parent-auto5000-result.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify({threadId:state.threadId,status:turn.status,config:summary.effectiveConfig,compactions:summary.compactionEvents.length,hooks:summary.hookEvents.length,lastMessage:summary.finalMessages.at(-1)?.slice(-500)}));
}finally{await client.close();}
