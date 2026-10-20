import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {reportPath,selectedReport,selectedArtifactDirectory,sourceRoot,sha,authenticateReport,authenticateRecoveryHistory,assertInstalledInventory,assertConfigReceiptBindings,assertConfirmedTermination,authenticateHelperFreeze,nativeReportPin} from './live004-context-performance-e2e.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';
import {sourceSnapshot,stable,authenticate} from './source-context-performance-authority.mjs';
import {canonicalCodexHooks,reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
export function assertHeaderPublication(worker,stream){
 const turnId=worker.turns?.[0]?.id??worker.turn?.id;
 const requestIndex=stream.findIndex(e=>e.kind==='request'&&e.method==='turn/start'&&e.threadId===worker.threadId);
 const completionIndex=stream.findIndex(e=>e.method==='turn/completed'&&e.threadId===worker.threadId&&e.turn?.id===turnId&&e.turn.status==='completed');
 const proofs=stream.filter(e=>e.kind==='transcriptHeaderProof'&&e.threadId===worker.threadId);assert.equal(proofs.length,1,'Exactly one native header observation');
 const proof=proofs[0],proofIndex=stream.indexOf(proof);assert(requestIndex>=0&&completionIndex>requestIndex&&proofIndex>completionIndex,'First native turn completes before header observation');
 const completed=stream[completionIndex];assert.equal(proof.turnId,turnId);assert.equal(proof.afterTurnCompletedEventIndex,completed.eventIndex);assert.deepEqual(proof.header,worker.header);
 assert.equal(worker.header.publishedAfterTurnId,turnId);assert.equal(worker.header.turnCompletedEventIndex,completed.eventIndex);assert.equal(worker.header.headerOnlyRead,true);
 const metadata=stream.find(e=>e.kind==='threadMetadata'&&e.id===worker.threadId);assert.equal(worker.header.path,metadata?.path,'Header uses the actual native transcript path');
 assert.equal(worker.header.type,'session_meta');assert.equal(worker.header.id,worker.threadId);assert.equal(worker.header.idMatchesExpected,true);assert.equal(worker.header.parentThreadId,null);
}
export function nativeCommandPayload(command){
 assert.equal(typeof command,'string');
 const wrapped=/^"([A-Za-z]:\\\\(?:[^"\\\r\n]+\\\\)*pwsh\.exe)"[ \t]+-Command[ \t]+'((?:[^']|'')*)'$/i.exec(command);
 if(wrapped)return wrapped[2].replace(/''/g,"'");
 // Unknown wrappers stay literal: they cannot match an exact delegated command,
 // and their complete text remains available to the earlier-mutation check.
 return command;
}
// The normalized stream omits subagent metadata. Account for this one observed
// child only after authenticating its raw host lineage and complete read scope.
export function assertReadonlyChildLineage(report,stream,lineage,parentRows,childRows){
 assert.equal(lineage.version,1);assert.equal(lineage.kind,'authenticated-native-readonly-child-lineage');assert.deepEqual(lineage.nativeReport,nativeReportPin);
 assert.deepEqual(lineage.normalizedParent,report.artifacts.find(a=>a.path.endsWith('/worker-b-events.jsonl')));
 assert.equal(lineage.parentThreadId,report.workerB.threadId);assert.equal(lineage.parentTurnId,report.workerB.turn.id);
 assert.equal(lineage.role,'explorer');assert.equal(lineage.forkTurns,'none');assert.equal(lineage.agentPath,'/root/review_cents');assert.equal(lineage.scope,'observed-two-readonly-commands');assert.equal(lineage.encryptedTaskRequest,'not-decrypted');
 const parent=parentRows[0].payload,child=childRows[0].payload;assert.equal(parentRows[0].type,'session_meta');assert.equal(childRows[0].type,'session_meta');
 assert.equal(parent.id,lineage.parentThreadId);assert.equal(child.id,lineage.childThreadId);assert.notEqual(child.id,parent.id);assert.equal(parent.cwd,report.fixture);assert.equal(child.cwd,report.fixture);
 assert.equal(child.parent_thread_id,parent.id);assert.equal(child.thread_source,'subagent');assert.equal(child.agent_role,lineage.role);assert.equal(child.agent_path,lineage.agentPath);
 assert.deepEqual(child.source.subagent.thread_spawn,{parent_thread_id:parent.id,depth:1,agent_path:lineage.agentPath,agent_nickname:child.agent_nickname,agent_role:lineage.role});
 const spawn=parentRows.filter(r=>r.type==='response_item'&&r.payload.name==='spawn_agent'&&r.payload.call_id===lineage.spawnCallId);assert.equal(spawn.length,1);assert.equal(spawn[0].payload.namespace,'collaboration');
 const request=JSON.parse(spawn[0].payload.arguments);assert.equal(request.task_name,'review_cents');assert.equal(request.agent_type,lineage.role);assert.equal(request.fork_turns,lineage.forkTurns);assert.equal(typeof request.message,'string');assert(request.message.startsWith('gAAAAA'),'Encrypted task request remains opaque');
 const activities=parentRows.filter(r=>r.type==='event_msg'&&r.payload.type==='item_completed'&&r.payload.item?.type==='SubAgentActivity'&&r.payload.item.agent_thread_id===child.id);
 assert.equal(activities.length,2);for(const r of activities){assert.equal(r.payload.thread_id,parent.id);assert.equal(r.payload.turn_id,lineage.parentTurnId);assert.equal(r.payload.item.agent_path,lineage.agentPath);}
 assert.equal(activities[0].payload.item.kind,'started');assert.equal(activities[0].payload.item.id,lineage.spawnCallId);assert.equal(activities[1].payload.item.kind,'completed');assert.equal(activities[1].payload.item.id,lineage.completionItemId);assert.equal(lineage.completionItemId,'subagent-completed-'+lineage.childTurnId);
 const tasks=childRows.filter(r=>r.type==='event_msg'&&['task_started','task_complete'].includes(r.payload.type));assert.deepEqual(tasks.map(r=>r.payload.type),['task_started','task_complete']);for(const r of tasks){assert.equal(r.payload.turn_id,lineage.childTurnId);assert.equal(r.payload.root_turn_id,lineage.parentTurnId);}
 const calls=childRows.filter(r=>r.type==='response_item'&&['function_call','custom_tool_call'].includes(r.payload.type));assert.equal(calls.length,1);assert.equal(calls[0].payload.type,'custom_tool_call');assert.equal(calls[0].payload.name,'exec');
 const cwdLiteral=JSON.stringify(report.fixture);
 const expectedInput=`const results = await Promise.allSettled([\n  tools.exec_command({cmd:"Get-Content -LiteralPath acceptance.test.mjs",workdir:${cwdLiteral},max_output_tokens:3000}),\n  tools.exec_command({cmd:"Get-Content -LiteralPath product.mjs",workdir:${cwdLiteral},max_output_tokens:3000})\n]);\nfor (let i=0;i<results.length;i++) text({file:i===0?"acceptance.test.mjs":"product.mjs",result:results[i]});\n`;
 assert.equal(calls[0].payload.input,expectedInput,'Entire child tool input consists of exactly two file reads');
 assert.deepEqual(lineage.commands.map(c=>c.command),['Get-Content -LiteralPath product.mjs','Get-Content -LiteralPath acceptance.test.mjs']);assert.equal(new Set(lineage.commands.map(c=>c.id)).size,2);
 const rawCommands=childRows.filter(r=>r.type==='event_msg'&&r.payload.item?.type==='CommandExecution');assert.equal(rawCommands.length,2);
 for(let i=0;i<2;i++){const p=rawCommands[i].payload,item=p.item;assert.equal(p.type,'item_completed');assert.equal(p.thread_id,child.id);assert.equal(p.turn_id,lineage.childTurnId);assert.equal(item.id,lineage.commands[i].id);assert.deepEqual(item.command.slice(1),['-Command',lineage.commands[i].command]);assert.match(item.command[0],/\\pwsh\.exe$/i);assert.equal(item.source,'unified_exec_startup');assert.equal(item.status,'completed');assert.equal(item.exit_code,0);assert.equal(item.cwd,'file:///'+report.fixture.replaceAll('\\','/'));assert.deepEqual(item.parsed_cmd,[{type:'read',cmd:lineage.commands[i].command,name:i?'acceptance.test.mjs':'product.mjs',path:i?'acceptance.test.mjs':'product.mjs'}]);}
 const activity=(id,method)=>{const matches=stream.filter(e=>e.method===method&&e.item?.id===id&&e.item.type==='subAgentActivity');assert.equal(matches.length,1);assert.equal(matches[0].threadId,parent.id);assert.equal(matches[0].turnId,lineage.parentTurnId);return matches[0];};
 const start=activity(lineage.spawnCallId,'item/completed'),end=activity(lineage.completionItemId,'item/completed');assert(start.eventIndex<end.eventIndex);
 const commands=stream.filter(e=>e.item?.type==='commandExecution'&&e.threadId===child.id);assert.equal(commands.length,4);
 const hooks=stream.filter(e=>['hook/started','hook/completed'].includes(e.method)&&e.threadId!==parent.id);assert.equal(hooks.length,8);
 for(const event of hooks){assert.equal(event.threadId,child.id);assert.equal(event.turnId,lineage.childTurnId);assert(['preToolUse','postToolUse'].includes(event.run?.eventName));assert(event.eventIndex>start.eventIndex&&event.eventIndex<end.eventIndex);}
 for(const expected of lineage.commands){const begun=commands.filter(e=>e.method==='item/started'&&e.item.id===expected.id),done=commands.filter(e=>e.method==='item/completed'&&e.item.id===expected.id);assert.equal(begun.length,1);assert.equal(done.length,1);for(const e of [...begun,...done]){assert.equal(e.turnId,lineage.childTurnId);assert.equal(nativeCommandPayload(e.item.command),expected.command);assert(e.eventIndex>start.eventIndex&&e.eventIndex<end.eventIndex);}assert.equal(done[0].item.exitCode,0);assert(begun[0].eventIndex<done[0].eventIndex);
  for(const name of ['preToolUse','postToolUse']){const pair=hooks.filter(e=>e.run.eventName===name&&e.run.id.endsWith(':'+expected.id));assert.equal(pair.length,2);assert.equal(pair[0].method,'hook/started');assert.equal(pair[1].method,'hook/completed');assert(pair[0].eventIndex<pair[1].eventIndex);assert(['completed','success'].includes(pair[1].run.status));assert(!pair[1].run.errors);assert(name==='preToolUse'?pair[1].eventIndex<begun[0].eventIndex:pair[0].eventIndex>done[0].eventIndex);}
 }
 return new Set(hooks);
}
async function authenticateReadonlyChild(report,stream){
 const freeze=JSON.parse(await authenticate(await authenticateHelperFreeze()));assert(freeze.childLineage,'Reviewed successor must pin the raw host supplement');const lineage=JSON.parse(await authenticate(freeze.childLineage));
 const load=async(ref,expectedLines)=>{assert.deepEqual(ref.lines.map(r=>r.line),expectedLines);assert(path.isAbsolute(ref.path));assert(!(await lstat(ref.path)).isSymbolicLink());assert.equal(path.normalize(await realpath(ref.path)),path.normalize(ref.path));const bytes=await readFile(ref.path);assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);const lines=bytes.toString('utf8').trimEnd().split('\n');for(const pin of ref.lines)assert.equal(sha(lines[pin.line-1]),pin.sha256);return lines.map(JSON.parse);};
 assert.equal(path.normalize(lineage.rawParent.path),path.normalize(report.workerB.header.path));assert.equal(path.dirname(lineage.rawChild.path),path.dirname(lineage.rawParent.path));assert(path.basename(lineage.rawChild.path).endsWith('-'+lineage.childThreadId+'.jsonl'));
 const parent=await load(lineage.rawParent,[1,76,78,92]),child=await load(lineage.rawChild,[1,2,15,17,18,27]);return assertReadonlyChildLineage(report,stream,lineage,parent,child);
}
export function assertNativeHookPairs(worker,stream,definitions,fixture,childHooks=new Set()){
 const fixtureHooks=path.join(fixture,'.codex/hooks.json');
 const turns=worker.turns??[worker.turn];assert(turns.length>0);
 assert.equal(new Set(turns.map(turn=>turn.id)).size,turns.length);
 const events=stream.filter(event=>event.kind==='notification'||Object.hasOwn(event,'eventIndex')||['hook/started','hook/completed','turn/completed'].includes(event.method));
 assert(events.every(event=>Number.isSafeInteger(event.eventIndex)&&event.eventIndex>=0),'Every native notification needs a nonnegative safe integer index');
 assert(events.every((event,index)=>index===0||event.eventIndex>events[index-1].eventIndex),'Native notification indices must be unique and ordered');
 const groups=new Map();
 for(const event of stream.filter(event=>['hook/started','hook/completed'].includes(event.method))){
  if(event.threadId===worker.threadId)assert(turns.some(turn=>turn.id===event.turnId));else assert(childHooks.has(event),'Every foreign hook must be accounted for by authenticated child lineage');
  const definitionsForEvent=definitions.filter(definition=>definition.eventName===event.run?.eventName);assert.equal(definitionsForEvent.length,1);
  const definition=definitionsForEvent[0],name=definition.eventName.replace(/[A-Z]/g,char=>'-'+char.toLowerCase());
  const prefix=`${name}:${definition.displayOrder}:${fixtureHooks}`;
  assert.equal(event.run.sourcePath,fixtureHooks);assert(typeof event.run.id==='string'&&(event.run.id===prefix||event.run.id.startsWith(prefix+':')),'Native hook ID must bind its reviewed canonical definition');
  const key=JSON.stringify([event.threadId,event.turnId,event.run.id]);const pair=groups.get(key)??{};
  const stage=event.method==='hook/started'?'started':'completed';assert(!pair[stage],'Duplicate native hook stage');pair[stage]=event;groups.set(key,pair);
 }
 const pairs=[...groups.values()];
 for(const pair of pairs){assert(pair.started&&pair.completed,'Every native hook needs a complete pair');assert(pair.started.eventIndex<pair.completed.eventIndex);assert.equal(pair.started.run.eventName,pair.completed.run.eventName);}
 const success=pair=>['completed','success'].includes(pair.completed.run.status);
 for(const turn of turns){
  assert.equal(turn.status,'completed');assert.equal(stream.filter(event=>event.method==='turn/completed'&&event.threadId===worker.threadId&&event.turn?.id===turn.id&&event.turn.status==='completed').length,1);
  for(const eventName of ['userPromptSubmit','stop'])assert(pairs.some(pair=>success(pair)&&pair.completed.turnId===turn.id&&pair.completed.run.eventName===eventName),'Paired native '+eventName+' for each completed turn');
 }
 for(const eventName of ['preToolUse','postToolUse'])assert(pairs.some(pair=>success(pair)&&pair.completed.threadId===worker.threadId&&pair.completed.run.eventName===eventName),'Paired parent native '+eventName);
 return pairs;
}
export {assertConfirmedTermination} from './live004-context-performance-e2e.mjs';
export function assertConfigPhaseBindings(report,records){
 const labels=['before-enrollment','scoped-enrollment','reviewed-readback','cleanup-readback'];assert.deepEqual(Object.keys(records),labels);assert.equal(report.projectKey,report.fixture.toLowerCase());assert.equal(report.definitions.length,6);assert.equal(new Set(report.definitions.map(item=>item.key)).size,6);
 const hooks=Object.fromEntries(report.definitions.map(item=>[item.key,item.currentHash])),removed=Object.fromEntries(report.definitions.map(item=>[item.key,null]));
 const reads=label=>records[label].receipts.filter(item=>item.stage==='response'&&item.method==='config/read').map(item=>item.userLayers[0]);const requests=label=>records[label].receipts.filter(item=>item.stage==='request');
 for(const label of labels)assertConfigReceiptBindings(records[label]);assert.deepEqual(requests(labels[0]).map(item=>item.method),['config/read','config/batchWrite','config/read']);assert.deepEqual(requests(labels[1]).map(item=>item.method),['config/read','config/read','config/batchWrite','config/read']);assert.deepEqual(requests(labels[1])[2].edits.map(item=>item.keyPath),['hooks.state']);assert.deepEqual(requests(labels[2]).map(item=>item.method),['config/read']);assert.deepEqual(requests(labels[3]).map(item=>item.method),['config/read','config/batchWrite','config/read']);assert.deepEqual(requests(labels[3])[1].edits.map(item=>item.keyPath),['hooks.state','projects']);
 // The producer snapshots owned hashes, then approval reads the same native
 // layer again for its version-checked write. Both baseline reads must agree.
 assert.deepEqual(reads(labels[1])[0],reads(labels[1])[1],'Scoped enrollment snapshot and approval baseline must match');
 assert.equal(reads(labels[0])[0].owned.projectTrust,null);assert.equal(reads(labels[0])[1].owned.projectTrust,'trusted');assert.deepEqual(reads(labels[1])[0].owned,{projectTrust:'trusted',hooks:removed});assert.deepEqual(reads(labels[1])[2].owned,{projectTrust:'trusted',hooks});assert.deepEqual(reads(labels[2])[0].owned,{projectTrust:'trusted',hooks});assert.deepEqual(reads(labels[3]).map(item=>item.owned),[{projectTrust:'trusted',hooks},{projectTrust:null,hooks:removed}]);
 for(const label of labels)for(const read of reads(label))assert.equal(read.unrelatedSha256,report.unrelatedBeforeHash);assert.equal(reads(labels[0])[0].semanticSha256,report.nativeConfigBeforeHash);assert.equal(report.unrelatedEnrolledHash,report.unrelatedBeforeHash);assert.equal(reads(labels[3])[1].semanticSha256,report.cleanup.finalConfigHash);assert.equal(report.cleanup.unrelatedBeforeHash,report.cleanup.unrelatedAfterHash);assert.deepEqual(report.scopedEnrollment,{actualNativeRpc:true,sourceAuthenticatedBeforeAfterWrites:true,status:'trusted',approved:6});
}
export function assertLifecycleBindings(report,a,b,continuity,session,childHooks=new Set()){
 const fixtureHooks=path.join(report.fixture,'.codex/hooks.json');
 const success=e=>e.method==='hook/completed'&&['success','completed'].includes(e.run?.status)&&e.run.sourcePath===fixtureHooks;
 for(const [stream,worker] of [[a,report.workerA],[b,report.workerB]]){
  assertHeaderPublication(worker,stream);
  const invocation=stream.find(e=>e.kind==='invocation');assert.equal(invocation?.cwd,report.fixture);
  assertNativeHookPairs(worker,stream,report.definitions,report.fixture,worker===report.workerB?childHooks:new Set());
 }
 const start=a.find(e=>e.method==='item/started'&&e.item?.type==='contextCompaction'&&e.item.id===report.transfer.compactionItemId&&e.threadId===report.workerA.threadId&&e.turnId===report.transfer.turnId);assert(start);
 const end=a.find(e=>e.method==='item/completed'&&e.item?.id===start.item.id&&e.item.type==='contextCompaction'&&e.threadId===start.threadId&&e.turnId===start.turnId);assert(end);assert(end.eventIndex>start.eventIndex);
 assert.equal(report.transfer.threadId,report.workerA.threadId);assert.equal(report.transfer.compactionStartedIndex,start.eventIndex);
 assert(report.workerA.turns.some(t=>t.id===start.turnId&&t.status==='completed'));
 const hookPair=(eventName,predicate)=>{
  const completed=a.find(e=>success(e)&&e.threadId===start.threadId&&e.turnId===start.turnId&&e.run.eventName===eventName&&predicate(e));assert(completed,'Bound completed '+eventName);
  assert.equal(typeof completed.run.id,'string');assert(completed.run.id.length>0);
  const started=a.find(e=>e.method==='hook/started'&&e.threadId===completed.threadId&&e.turnId===completed.turnId&&e.run?.id===completed.run.id&&e.run.eventName===eventName&&e.run.sourcePath===fixtureHooks);assert(started,'Bound started '+eventName);
  assert(started.eventIndex<completed.eventIndex&&a.indexOf(started)<a.indexOf(completed),'Ordered hook pair '+eventName);
  return {started,completed};
 };
 // Native PreCompact runs before the compaction item; SessionStart(compact) follows it.
 const compact=hookPair('preCompact',e=>e.eventIndex<start.eventIndex);
 const routing=hookPair('sessionStart',e=>e.eventIndex>end.eventIndex&&e.structuredEntries?.some(x=>x.kind==='context'&&x.text?.includes(report.transfer.handoffId)&&x.text.includes(report.transfer.resumeCommand)));
 const lifecycle=[compact.started,compact.completed,start,end,routing.started,routing.completed];
 assert(lifecycle.every((e,i)=>i===0||(lifecycle[i-1].eventIndex<e.eventIndex&&a.indexOf(lifecycle[i-1])<a.indexOf(e))),'PreCompact, compaction, SessionStart lifecycle ordering');
 assert.equal(report.transfer.resumeCommand,`node .harness/run.mjs resume ${report.transfer.handoffId}`);
 assert.equal(session.phase,'awaiting_resume');assert.equal(session.handoffId,report.transfer.handoffId);assert.equal(session.resumeCommand,report.transfer.resumeCommand);assert.equal(session.owner?.id,report.workerA.threadId);
 const commands=b.filter(e=>e.method==='item/completed'&&e.threadId===report.workerB.threadId&&e.turnId===report.workerB.turn.id&&e.item?.type==='commandExecution'&&e.item.exitCode===0).sort((x,y)=>x.eventIndex-y.eventIndex);
 const payloads=commands.map(e=>nativeCommandPayload(e.item.command??'').trim());
 const resume=payloads.indexOf(report.transfer.resumeCommand);assert(resume>=0,'Fresh B executed exact delegated resume');
 assert.equal(payloads.filter(command=>command===report.transfer.resumeCommand).length,1,'Exactly one delegated resume');
 const bootstrap=payloads.findIndex((command,i)=>i>resume&&command==='node .harness/run.mjs bootstrap --validate --json');
 const verify=payloads.findIndex((command,i)=>i>bootstrap&&command==='node .harness/run.mjs verify fixture-cents-001');
 const yielded=payloads.findIndex((command,i)=>i>verify&&/^node \.harness\/run\.mjs checkpoint --reason worker_yield(?:$|[ \t]+--)/.test(command));
 assert(bootstrap>resume&&verify>bootstrap&&yielded>verify,'Fresh B resume, bootstrap, verify, yield ordering');
 assert(!/node\s+\.harness[\\/]run\.mjs\s+(?:claim|resume|verify|start|feature|checkpoint|handoff|recover)\b/.test(payloads.slice(0,resume).join('\n')),'No B harness mutation before exact resume');
 const resumeItemStart=b.findIndex(e=>e.method==='item/started'&&e.item?.id===commands[resume].item.id);
 assert(resumeItemStart>=0);assert(!b.slice(0,resumeItemStart).some(e=>e.method==='item/started'&&e.item?.type==='commandExecution'&&/node\s+\.harness[\\/]run\.mjs\s+(?:claim|resume|verify|start|feature|checkpoint|handoff|recover)\b/.test(nativeCommandPayload(e.item.command??''))),'No attempted B mutation before exact resume');
 // Unrelated reads may be blocked by the native output guard. Require successful
 // command-bound hooks for the four exact lifecycle commands authenticated above.
 for(const index of [resume,bootstrap,verify,yielded]){
  const item=commands[index];
  const itemStart=b.find(e=>e.method==='item/started'&&e.threadId===item.threadId&&e.turnId===item.turnId&&e.item?.id===item.item.id);assert(itemStart,'Started lifecycle command '+payloads[index]);
  for(const event of ['preToolUse','postToolUse']){
   const completed=b.find(e=>success(e)&&e.threadId===report.workerB.threadId&&e.turnId===item.turnId&&e.run.eventName===event&&typeof e.run.id==='string'&&e.run.id.endsWith(':'+item.item.id));assert(completed,'Bound lifecycle '+event+' '+payloads[index]);
   const started=b.find(e=>e.method==='hook/started'&&e.threadId===item.threadId&&e.turnId===item.turnId&&e.run?.id===completed.run.id&&e.run.eventName===event&&e.run.sourcePath===fixtureHooks);assert(started,'Started lifecycle '+event+' '+payloads[index]);
   assert(started.eventIndex<completed.eventIndex&&b.indexOf(started)<b.indexOf(completed),'Ordered lifecycle hook pair '+event);
   assert(event==='preToolUse'?completed.eventIndex<itemStart.eventIndex:started.eventIndex>item.eventIndex,'Lifecycle hook command ordering '+event);
  }
 }
 assert.equal(continuity.phase,'working');assert.equal(continuity.owner,null);assert.equal(continuity.handoff,null);assert.equal(continuity.lastHandoff?.id,report.transfer.handoffId);assert.equal(continuity.lastHandoff?.owner?.id,report.workerA.threadId);assert.equal(continuity.lastHandoff.reason,'context_limit');assert.equal(continuity.lastHandoff.automatic,true);assert(continuity.lastHandoff.resumedAt);
 assert.equal(continuity.checkpoint?.reason,'worker_yield');assert(continuity.retiredWorkerIds.includes(report.workerA.threadId));assert(continuity.retiredWorkerIds.includes(report.workerB.threadId));
}
export async function verifyNativeReport(report){
await authenticateReport(report);await inspectReportLocation(sourceRoot,selectedReport);assert.deepEqual(JSON.parse(await readFile(reportPath,'utf8')),report,'Exactly the selected regular report is required');assert.equal(report.status,'passed');
const artifactDirectory=selectedArtifactDirectory(report);const recoveryHistory=report.recovery?await authenticateRecoveryHistory(report.recovery):null;
assert.equal(new Set(report.artifacts.map(a=>a.path)).size,report.artifacts.length);assert.equal(report.sourceRoot,sourceRoot);assert(path.basename(report.fixture).startsWith('agent-harness-v2-live-'));assert.equal(path.dirname(report.fixture),os.tmpdir());
await inspectReportLocation(sourceRoot,artifactDirectory,{kind:'directory'});
for(const a of report.artifacts){assert(a.path.startsWith(artifactDirectory+'/'));assert.equal(path.posix.dirname(a.path),artifactDirectory);assert(!a.path.split(/[\\/]/).includes('..'));await inspectReportLocation(sourceRoot,a.path,{kind:'file'});const bytes=await readFile(path.join(sourceRoot,a.path));assert.equal(bytes.length,a.bytes);assert.equal(sha(bytes),a.sha256,a.path);}
const bound=name=>{const matches=report.artifacts.filter(a=>a.path.endsWith('/'+name));assert.equal(matches.length,1,'Unique authenticated artifact '+name);return path.join(sourceRoot,matches[0].path);};
const json=async name=>JSON.parse(await readFile(bound(name),'utf8'));
const rows=async name=>(await readFile(bound(name),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
assert.equal(report.pending,null);assert.notEqual(report.unknownOutcome,true);assert.equal(report.gitControllers.length,5);
const gitLabels=['git-init','git-name','git-email','git-add','git-commit'];
for(let index=0;index<gitLabels.length;index++){const label=gitLabels[index],ref=report.gitControllers[index];assert.equal(ref.path,`${artifactDirectory}/${label}-controller.json`);const proof=await json(`${label}-controller.json`);assert.equal(proof.label,label);assert.equal(proof.cwd,report.fixture);assert.equal(proof.confirmed,true);assert.equal(proof.timedOut,false);assert.equal(proof.exitCode,0);assert.equal(proof.overflow,false);assert(Number.isSafeInteger(proof.pid)&&proof.pid>0);assert(Number.isFinite(proof.elapsedMs)&&proof.elapsedMs>=0);assert.equal(sha(proof.stdout),proof.stdoutSha256);assert.equal(sha(proof.stderr),proof.stderrSha256);}
await assertInstalledInventory(report.installedInventory,report.artifacts);
const paths=new Set(report.artifacts.map(item=>item.path));const visit=value=>{if(typeof value==='string'&&value.startsWith(artifactDirectory+'/'))assert(paths.has(value));else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);};visit(report);
const configLabels=['before-enrollment','scoped-enrollment','reviewed-readback','cleanup-readback'];
assert.deepEqual(report.configReceiptPaths,configLabels.map(label=>`${artifactDirectory}/${label}-config-receipts.json`));
const configRecords={};
for(const label of configLabels){const record=await json(`${label}-config-receipts.json`),stream=await rows(`${label}-events.jsonl`);assert.equal(record.version,1);assert.equal(record.label,label);assert.equal(record.observedDirectRpc,true);assertConfigReceiptBindings(record,stream);assertConfirmedTermination(report,label,stream);configRecords[label]=record;}
assertConfigPhaseBindings(report,configRecords);
const canonical=await canonicalCodexHooks(sourceRoot);assert.deepEqual(await json('canonical-rendered.json'),canonical);assert.deepEqual(await json('installed-hooks.json'),canonical);assert.deepEqual(await json('source-installed-hooks.json'),canonical);
for(const groups of Object.values(canonical.hooks))assert.equal(groups.length,1);
const sourceSnapshot=await json('source-snapshot.json');assert.equal(sha(stable(sourceSnapshot)),report.sourceDigest);
assert.equal(sha(await readFile(bound('fixture-runtime.mjs'))),sourceSnapshot['skill/codex-harness/assets/project-runtime.mjs']);
assert.deepEqual((await json('fixture-config.json')).verification,{quick:['node --check product.mjs'],full:['node --test acceptance.test.mjs'],e2e:[],architecture:[],clean:[]});
const init=await json('fixture-init-controller.json');assert.equal(init.exitCode,0);assert.equal(init.cwd,sourceRoot);assert.deepEqual(init.args,[path.join(sourceRoot,'bin/agent-harness.mjs'),'init',report.fixture]);
assert.equal(sha(await readFile(bound('canonical-template.txt'))),sourceSnapshot['skill/codex-harness/assets/codex-hooks.json.template']);
assert.equal(sha(await readFile(bound('canonical-bootstrap.json'))),sourceSnapshot['skill/codex-harness/assets/native-hook-bootstrap-v2.json']);
assert.equal(report.definitions.length,6);const nativeDiscovery=await json('reviewed-native-discovery.json');assert.equal(nativeDiscovery.data?.length,1);const reviewed=reviewNativeDefinitions(nativeDiscovery,report.fixture,canonical,canonical);assert.equal(reviewed.length,6);const discovery=nativeDiscovery.data[0].hooks;assert.equal(discovery?.length,6);
assert.deepEqual(report.definitions,reviewed.map(({command,...definition})=>({...definition,commandSha256:sha(command)})),'Exact unique reviewed canonical definitions required');
for(const d of report.definitions){const h=discovery.find(h=>h.key===d.key);assert(h&&h.enabled&&h.trustStatus==='trusted');assert.equal(h.currentHash,d.currentHash);assert.equal(sha(h.command),d.commandSha256);assert(Object.values(canonical.hooks).flat().some(g=>g.hooks.some(c=>(c.commandWindows??c.command)===h.command)));assert.equal(h.sourcePath,path.join(report.fixture,'.codex/hooks.json'));}
assert.equal(report.trustBypass,false);assert.equal(report.projectTrustOverride,false);assert.equal(report.manualCompaction,false);
const a=await rows('worker-a-events.jsonl'),b=await rows('worker-b-events.jsonl'),streams=[a,b];
assertConfirmedTermination(report,'worker-a',a);assertConfirmedTermination(report,'worker-b',b);
assertLifecycleBindings(report,a,b,await json('fixture-continuity.json'),await json('fixture-transfer-session.json'),await authenticateReadonlyChild(report,b));
for(const stream of streams){assert(stream.some(e=>e.kind==='invocation'));assert(stream.some(e=>e.kind==='confirmedTermination'&&e.treeAbsent));for(const e of stream.filter(e=>e.kind==='invocation')){assert.equal(e.trustBypass,false);assert.equal(e.projectTrust,false);assert(!e.args.some(x=>/dangerously-bypass|trust_level=/.test(x)));}assert(!stream.some(e=>e.kind==='request'&&/compact/i.test(e.method)));}
const completed=streams.flat().filter(e=>e.method==='hook/completed'&&['completed','success'].includes(e.run?.status));
for(const event of ['preCompact','sessionStart','preToolUse','postToolUse','userPromptSubmit','stop'])assert(completed.some(e=>e.run.eventName===event),'Actual successful native '+event);
// assertLifecycleBindings above is the authoritative paired, identity-bound
// PreCompact -> actual compaction -> SessionStart(compact) ordering check.
assert.equal(report.workerA.autoCompactTokenLimit,5000);assert.equal(report.workerA.scope,'body_after_prefix');assert.notEqual(report.workerA.threadId,report.workerB.threadId);
for(const worker of [report.workerA,report.workerB]){assert.equal(worker.header.type,'session_meta');assert.equal(worker.header.id,worker.threadId);assert.equal(worker.header.idMatchesExpected,true);assert.equal(worker.header.parentThreadId,null);}
assert.equal(report.workerB.predecessorTranscriptProvided,false);assert.equal(report.workerB.freshThread,true);assert.equal(report.workerB.delegatedResumeCommand,report.transfer.resumeCommand);
// Exact lifecycle commands and their paired hooks are authenticated by
// assertLifecycleBindings; unrelated reads retain their native guard outcomes.
assert.equal(report.finalSession.phase,'working');assert.equal(report.finalSession.owner,null);const features=await json('fixture-features.json');assert.equal(features.features.find(f=>f.id==='fixture-cents-001')?.status,'passing');
const events=await rows('fixture-events.jsonl');assert(events.some(e=>e.type==='handoff.ready'&&e.handoffId===report.transfer.handoffId));assert(events.some(e=>e.type==='worker.resumed'&&e.handoffId===report.transfer.handoffId));
const fixtureFeature=features.features.find(f=>f.id==='fixture-cents-001');assert(fixtureFeature.evidence.length>0);assert.equal(report.fixturePassingEvidence.length,fixtureFeature.evidence.length);
for(const [i,reference] of report.fixturePassingEvidence.entries()){assert.equal(reference.fixturePath,fixtureFeature.evidence[i]);assert(report.artifacts.some(a=>a.path===reference.artifact.path&&a.sha256===reference.artifact.sha256));if(i===report.fixturePassingEvidence.length-1){const proof=JSON.parse(await readFile(path.join(sourceRoot,reference.artifact.path),'utf8'));assert.equal(proof.featureId,fixtureFeature.id);assert.equal(proof.pass,true);assert.deepEqual(proof.scopeViolations,[]);assert(proof.contractHash&&proof.configHash&&proof.verificationHash);assert(proof.commands.length>0&&proof.commands.every(c=>c.exitCode===0));assert(proof.commands.some(c=>c.command==='node --test acceptance.test.mjs'));}}
assert.equal(sha(await readFile(bound('final-acceptance.test.mjs'))),sha(await readFile(bound('original-acceptance.test.mjs'))));
assert(!(await readFile(bound('final-product.mjs'),'utf8')).includes('.harness'));
assert(report.terminations.filter(t=>/^worker-/.test(t.label)).every(t=>t.treeAbsent));assert(report.terminations.some(t=>t.label==='worker-a'));assert(report.terminations.some(t=>t.label==='worker-b'));
assert.equal(report.cleanup.nativeOwnedChangesRemoved,true);assert.equal(report.cleanup.freshReadback,true);assert.equal(report.cleanup.unrelatedBeforeHash,report.cleanup.unrelatedAfterHash);assert.equal(report.cleanup.policyBaselineAbsenceRestored,true);assert.equal(report.cleanup.noFixtureInFinalPolicy,true);
assert.equal(report.policy.baselineAbsent,true);assert.deepEqual(report.policy.projects.slice().sort(),[sourceRoot,report.fixture].sort());
assert.deepEqual(await json('policy-baseline.json'),{absent:true,sha256:null});
assert.equal(report.policy.transitions.length,4);assert.equal(report.policy.currentHash,null);let previous=null;
for(const [index,t] of report.policy.transitions.entries()){assert.equal(t.beforeHash,previous);assert(t.guard?.startsWith('checked-immediately-before-'));if(index<3){const bytes=await readFile(bound(`${t.label}-policy.json`));assert.equal(sha(bytes),t.afterHash);assert.deepEqual(JSON.parse(bytes),t.expected);}else{assert.equal(t.afterHash,null);assert.equal(t.expected,null);}previous=t.afterHash;}
assert.deepEqual(report.policy.transitions.map(t=>t.label),['temporary-policy-source-enable','temporary-policy-enable','temporary-policy-disable','temporary-policy-remove']);
assert.deepEqual(report.policy.transitions[0].expected.projects,[sourceRoot]);assert.deepEqual(report.policy.transitions[1].expected.projects,[sourceRoot,report.fixture].sort());assert.deepEqual(report.policy.transitions[2].expected,{version:1,enabled:false});
assert.equal(report.policy.expectedEnabledHash,report.policy.transitions[1].afterHash);assert.equal(report.policy.expectedDisabledHash,report.policy.transitions[2].afterHash);
return {pass:true,version:2,actualHost:true,canonicalSourceEquality:true,sixNativeEvents:true,automaticCompaction:true,freshResume:true,confirmedTreeTermination:true,guardedCleanup:true,contextPerformanceSourceAuthority:true,completeInstalledClosure:true,rootHelperFreeze:true,configReceipts:true,recovery:recoveryHistory?{history:report.recovery.history,intent:report.recovery.intent,outcome:report.recovery.outcome,historicalNativeSuccess:false,currentNativeSuccess:true}:null};
}
async function main(){try{assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--report');assert.equal(process.argv[3],selectedReport);console.log(JSON.stringify(await verifyNativeReport(JSON.parse(await readFile(reportPath,'utf8')))));}catch(error){console.error(JSON.stringify({status:'stopped-safely',errorSha256:sha(String(error))}));process.exitCode=1;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
