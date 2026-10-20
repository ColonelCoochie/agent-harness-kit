import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { connect, headerProof, binary } from './native-client.mjs';

const cwd=path.resolve('scratch/live-host-e2e/project-native');
const base=path.resolve('scratch/live-host-e2e');
const state=()=>JSON.parse(execFileSync(process.execPath,['.harness/run.mjs','session','--json'],{cwd,encoding:'utf8'}));
const initial=state();
const continuing=process.argv.includes('--resume-pending');
if(continuing)assert.equal(initial.phase,'awaiting_resume');
else{assert.equal(initial.owner,null);assert.equal(initial.phase,'working');}
const configPath=path.join(cwd,'.harness/config.json');
const config=JSON.parse(await readFile(configPath,'utf8'));
config.verification.quick=[{id:'bounded-output',command:'node -e "process.stdout.write(\'ledger-output-suppression-7419\\n\'+\'x\'.repeat(20000))"'}];
await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
const client=await connect({cwd,log:path.join(base,'worker-native-events.jsonl'),trustBypass:false,projectTrust:false,limit:80000});
const report=continuing?JSON.parse(await readFile(path.join(base,'workers-native-result.json'),'utf8')):{version:1,recordedAt:new Date().toISOString(),status:'in_progress',binary,cwd,trustBypass:false,projectTrustOverride:false,workers:[]};
 if(continuing){report.driverCorrections=[...(report.driverCorrections||[]),report.error].filter(Boolean);report.status='in_progress';delete report.error;}
const save=()=>writeFile(path.join(base,'workers-native-result.json'),JSON.stringify(report,null,2)+'\n');
try{
 report.discovery=await client.rpc('hooks/list',{cwds:[cwd]});
 assert.equal(report.discovery.data[0].hooks.length,6);
 assert(report.discovery.data[0].hooks.every(h=>h.enabled&&h.trustStatus==='trusted'));
 const parent=JSON.parse(await readFile(path.join(base,'parent-native-thread.json'),'utf8'));
 report.driverParentThreadId=parent.threadId;
 const common=`You are a fresh bounded native implementation worker for the isolated deterministic ledger E2E. Work only in ${cwd}. You are not alone in the repository; preserve others' changes. Read the local AGENTS.md workflow and obey native ownership. Never read credentials, use external apps, or edit acceptance.test.mjs. Keep each tool result below 2500 characters, use narrow reads. Product ledger must remain independent of .harness. Native reviewed hooks are enabled with persisted trust and no bypass. Use actual tools to implement the assigned milestone. If native pressure creates awaiting_resume or exit 75, the mutation did not execute: return only the exact printed resume command plus concise milestone result, then stop immediately. Do not resume your own transfer or recover anyone. Do not create a goal or use any Stop continuation.`;
 let first;
 if(!continuing){
 first=await client.start(common+' You own money/validation and ledger-core.mjs only. Implement core before the pressure boundary; the successor owns streaming CLI and final verification.');
 report.workers.push({role:'core',threadId:first.thread.id,parentRoutingThreadId:parent.threadId});await save();
 console.log(JSON.stringify({stage:'native_core_started',threadId:first.thread.id,persistedTrustedHooks:6}));
 const result=await client.turn(first.thread.id,`Finish core for ledger-routing-7419. First execute session --json, claim, bootstrap ledger-001 --json, doctor/status/next in one bounded local command (write bootstrap to a temporary local JSON if necessary to avoid large output); read config, relevant docs-map routes, package/README and SPEC/acceptance in narrow reads before implementation. Run migrate once for the updated runtime. Implement money/validation and buildLedger in ledger-core.mjs, adding focused core tests if useful. Exercise the configured output-suppression check using node .harness/run.mjs check quick and inspect only its metadata, not its full log. Run meaningful core acceptance patterns separately for reconciliation, precision, rejection and calendar cases, and inspect bounded context between steps. This fixture has a 12-tool worker budget with pressure at 65%. Continue real core validation until native pressure rotates the worker. Do not fake calls or output counters and do not manually handoff before pressure. If context --observe reports pressure, use handoff --summary "Core implementation and focused validation complete" --next "Fresh successor resumes exact packet, integrates ledger.mjs CLI, runs full acceptance and verify ledger-001". Return the exact resume command and stop; never checkpoint worker_yield before this true transfer.`,600000);
 report.workers[0].turnStatus=result.turn.status;
 report.workers[0].header=await headerProof(first.thread.path,first.thread.id);
 report.workers[0].hooks=result.events.filter(e=>e.method==='hook/completed'&&e.threadId===first.thread.id).map(e=>({id:e.run?.id,event:e.run?.eventName,status:e.run?.status,entries:e.run?.entries}));
 report.afterCore=state();await save();
 assert.equal(report.afterCore.phase,'awaiting_resume','Core native worker must transfer at actual pressure');
 assert(report.afterCore.resumeCommand);
 assert.equal(report.afterCore.owner.id,first.thread.id);
 }else{
  first={thread:{id:report.workers.at(-1).threadId}};
  assert.equal(initial.owner.id,first.thread.id);
 }
 const pending=continuing?initial:report.afterCore;
 report.handoffId=pending.handoffId;report.exactResumeCommand=pending.resumeCommand;
 report.transfers=report.transfers||[report.afterCore];
 if(!report.transfers.some(t=>t.handoffId===pending.handoffId))report.transfers.push(pending);
 console.log(JSON.stringify({stage:'native_transfer',handoffId:report.handoffId,resumeCommand:report.exactResumeCommand}));
 while(true){
 const second=await client.start(common+' You own streaming/CLI integration and final verification. Resume the delegated exact handoff; complete any unfinished core checks within the same feature.');
 const workerIndex=report.workers.length;
 report.workers.push({role:'cli',threadId:second.thread.id,parentRoutingThreadId:parent.threadId});await save();
 assert.notEqual(second.thread.id,first.thread.id);
 const completed=await client.turn(second.thread.id,`Resume ledger-routing-7419 using exactly: ${report.exactResumeCommand}. Do not claim before resume. Batch the REQUIRED startup to fit the 12-call budget: first shell call executes exact resume THEN bootstrap ledger-001 --json (write large bootstrap to local temp and print only selected status), doctor/status/next, and narrow reads of config/docs-map/package/README/AGENTS/SPEC/acceptance/reusable skill route. One call may run each explicitly in dependency order; never dump large files. The core already passes four acceptance cases. Within the next two actual tool calls implement ledger.mjs streaming CLI (file/stdin NDJSON, line-numbered errors, no partial output) and run all five cases. If ledger-001 is planned, start it within the same command before editing. Preserve acceptance.test.mjs. After acceptance passes, ONE shell call runs verify ledger-001 with bounded output redirected to local temp; inspect its exit and evidence metadata, and checkpoint --reason worker_yield --summary "Deterministic ledger passed real native successor verification" --next "Parent records live native E2E acceptance proof" ONLY if verify exits zero. Do not spend separate tool calls on each startup read; this preserves the real small budget. Fix reversible errors within feature scope, keep each result below 2500 chars. At checkpoint stop. If native pressure unexpectedly transfers you, return exact resume command and stop.`,600000);
 report.workers[workerIndex].turnStatus=completed.turn.status;
 report.workers[workerIndex].header=await headerProof(second.thread.path,second.thread.id);
 report.workers[workerIndex].hooks=completed.events.filter(e=>e.method==='hook/completed'&&e.threadId===second.thread.id).map(e=>({id:e.run?.id,event:e.run?.eventName,status:e.run?.status,entries:e.run?.entries}));
 report.afterSuccessor=state();await save();
 if(report.afterSuccessor.phase==='awaiting_resume'){
  assert.equal(report.afterSuccessor.packet.reason,'context_pressure');assert.equal(report.afterSuccessor.packet.automatic,true);
  report.transfers.push(report.afterSuccessor);report.exactResumeCommand=report.afterSuccessor.resumeCommand;await save();
  console.log(JSON.stringify({stage:'native_additional_transfer',handoffId:report.afterSuccessor.handoffId}));continue;
 }
 const features=JSON.parse(await readFile(path.join(cwd,'.harness/features.json'),'utf8'));
 const feature=(Array.isArray(features)?features:features.features).find(f=>f.id==='ledger-001');
 report.ledgerFeature={status:feature.status,evidence:feature.evidence,contractHash:feature.contractHash};
 assert.equal(feature.status,'passing');assert.equal(report.afterSuccessor.owner,null);assert.equal(report.afterSuccessor.packet.reason,'worker_yield');
 report.acceptance=execFileSync(process.execPath,['--test','acceptance.test.mjs'],{cwd,encoding:'utf8'});
 report.status='passed';await save();
 console.log(JSON.stringify({stage:'native_workers_passed',workers:report.workers.map(w=>w.threadId),feature:report.ledgerFeature.status,acceptanceCases:5,output:path.join(base,'workers-native-result.json')}));break;
 }
}catch(error){report.status='failed';report.error=error.stack;await save();throw error;}finally{await client.close();}
