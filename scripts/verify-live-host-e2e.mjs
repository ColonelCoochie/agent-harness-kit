import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base='scratch/live-host-e2e',root=`${base}/project-native`;
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const rows=async p=>(await readFile(p,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha=data=>createHash('sha256').update(data).digest('hex');
const report=await json('.harness/live-host-e2e-report.json');
assert.equal(report.status,'passed');assert.equal(report.featureId,'live-host-e2e-001');
for(const required of [`${base}/worker-native-events.jsonl`,`${base}/workers-native-result.json`,`${base}/reviewed-native-trust.json`,`${base}/fixture-proof.json`,`${base}/final-native-commands.json`,`${base}/parent-auto5000-events.jsonl`,`${base}/parent-auto5000-result.json`,`${root}/.harness/features.json`,`${root}/.harness/events.jsonl`])assert(report.artifacts.some(a=>a.path===required),`Missing authenticated artifact ${required}`);
for(const a of report.artifacts){assert(a.path.startsWith(`${base}/`),'artifact scope');const data=await readFile(a.path);assert.equal(data.length,a.bytes,a.path);assert.equal(sha(data),a.sha256,a.path);}
const workers=await json(`${base}/workers-native-result.json`),proof=await json(`${base}/fixture-proof.json`);
assert.equal(workers.status,'passed');assert.equal(workers.trustBypass,false);assert.equal(workers.projectTrustOverride,false);
assert(workers.workers.length>=2);assert.equal(new Set(workers.workers.map(w=>w.threadId)).size,workers.workers.length);
const stream=await rows(`${base}/worker-native-events.jsonl`);
assert(stream.some(e=>e.kind==='invocation'),'Native app-server invocation evidence');
for(const invocation of stream.filter(e=>e.kind==='invocation')){assert.equal(invocation.trustBypass,false);assert.equal(invocation.projectTrust,false);assert(!invocation.args.some(a=>/dangerously-bypass|trust_level=/.test(a)));}
const reviewed=await json(`${base}/reviewed-native-trust.json`);
assert.equal(reviewed.sourceAuthenticated,true);
// This proof authenticates the installation reviewed at capture time. Current
// canonical source may evolve; it is not an archived input to this V1 report.
const installed=await json(`${root}/.codex/hooks.json`);
const initialDiscovery=await json(`${base}/hooks-discovery.json`);
assert(report.artifacts.some(a=>a.path===`${base}/hooks-discovery.json`),'Authenticated original discovery');
assert.equal(reviewed.definitions.length,6);
for(const definition of reviewed.definitions){
 const group=installed.hooks[definition.event];assert.equal(group?.length,1);
 assert.equal(group[0].hooks.length,1);
 const command=group[0].hooks[0].commandWindows??group[0].hooks[0].command;
 assert.equal(sha(command),definition.commandSha256,'Historical reviewed command binding');
 const discovered=initialDiscovery.data.find(d=>path.resolve(d.cwd)===path.resolve(root))?.hooks.find(h=>h.key===definition.key);
 assert(discovered);assert.equal(discovered.command,command);assert.equal(discovered.currentHash,definition.currentHash);
}
const definitions=workers.discovery.data[0].hooks;assert.equal(definitions.length,6);
for(const h of definitions){assert.equal(h.trustStatus,'trusted');assert(h.enabled);assert(h.currentHash.startsWith('sha256:'));assert.equal(h.sourcePath,path.resolve(root,'.codex/hooks.json'));assert(Object.values(installed.hooks).flat().some(group=>(group.hooks||[]).some(c=>c.command===h.command)));assert(reviewed.definitions.find(d=>d.key===h.key&&d.currentHash===h.currentHash));}
const events=await rows(`${root}/.harness/events.jsonl`);
const executed=(threadId,pattern)=>stream.some(e=>e.method==='item/completed'&&e.threadId===threadId&&e.item?.type==='commandExecution'&&e.item.exitCode===0&&pattern.test(e.item.command||'')&&['preToolUse','postToolUse'].every(event=>stream.some(h=>h.method==='hook/completed'&&h.threadId===threadId&&h.run.eventName===event&&h.run.status==='completed'&&h.run.id.endsWith(`:${e.item.id}`))));
for(const [i,w] of workers.workers.entries()){
 assert.equal(w.turnStatus,'completed');assert.equal(w.header.type,'session_meta');assert.equal(w.header.id,w.threadId);assert.equal(w.header.idMatchesExpected,true);assert(w.header.firstLineBytes>16384);
 const metadata=stream.find(e=>e.kind==='threadMetadata'&&e.id===w.threadId);assert(metadata);assert.equal(metadata.sessionId,w.threadId);
 assert(w.hooks.some(h=>h.event==='userPromptSubmit'&&['success','completed'].includes(h.status)));
 for(const h of w.hooks)assert(stream.some(e=>e.method==='hook/completed'&&e.threadId===w.threadId&&e.run.id===h.id&&e.run.eventName===h.event&&e.run.status===h.status&&JSON.stringify(e.run.entries)===JSON.stringify(h.entries)),`Native hook binding ${w.threadId} ${h.id}`);
 for(const h of w.observedOtherThreadHooks||[]){assert.equal(h.reportedWorkerThreadId,w.threadId);assert.notEqual(h.sourceThreadId,w.threadId);assert(stream.some(e=>e.method==='hook/completed'&&e.threadId===h.sourceThreadId&&e.run.id===h.id&&e.run.eventName===h.event&&e.run.status===h.status&&JSON.stringify(e.run.entries)===JSON.stringify(h.entries)),'Preserved other-thread hook observation');}
 if(i===0){assert(events.some(e=>e.type==='worker.claimed'&&e.workerId===w.threadId));assert(executed(w.threadId,/run\.mjs claim/),'Native first worker claim');}
 if(i>0){const t=workers.transfers[i-1];assert(t);assert.equal(t.packet.reason,'context_pressure');assert.equal(t.packet.automatic,true);assert.equal(t.owner.id,workers.workers[i-1].threadId);
  assert(workers.workers[i-1].hooks.some(h=>h.event==='preToolUse'&&h.status==='blocked'&&JSON.stringify(h.entries).includes(t.handoffId)));
  assert(stream.some(e=>e.kind==='request'&&e.method==='turn/start'&&e.threadId===w.threadId&&JSON.stringify(e.input).includes(t.resumeCommand)));
  assert(events.some(e=>e.type==='handoff.ready'&&e.handoffId===t.handoffId));
  assert(events.some(e=>e.type==='worker.resumed'&&e.handoffId===t.handoffId&&e.generation===t.generation+1));
  assert(proof.continuity.retiredWorkerIds.includes(workers.workers[i-1].threadId));
  assert(executed(w.threadId,new RegExp(t.resumeCommand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))),`Native exact resume execution ${w.threadId}`);
 }
}
assert.equal(proof.feature.status,'passing');assert.equal(proof.continuity.owner,null);assert.equal(proof.continuity.checkpoint.reason,'worker_yield');
const finalWorker=workers.reconciliationWorker,featureId=finalWorker.featureId;
assert.equal(featureId,'ledger-verification-002');assert.equal(proof.feature.id,featureId);assert.equal(report.nativeWorkers.verifiedFeature,featureId);
const stored=await json(`${root}/.harness/features.json`);assert.deepEqual(stored.features.find(f=>f.id===featureId),proof.feature);assert.deepEqual(stored.features.find(f=>f.id==='ledger-001'),proof.originalFeature);
assert.equal(proof.originalFeature.status,'blocked');assert.equal(workers.originalFailure.featureId,'ledger-001');assert.deepEqual(workers.originalFailure.evidence,proof.originalFeature.evidence);
const failed=proof.evidence.find(e=>e.path===`${root}/${proof.originalFeature.evidence.at(-1)}`);assert(failed&&failed.pass===false&&failed.scopeViolations.length>0);assert.deepEqual(failed.executedLayers,['scope']);assert(failed.commands.length>0&&failed.commands.every(c=>c.layer==='scope'&&c.pass===false&&c.exitCode===1));
assert.equal(proof.latestEvidencePath,`${root}/${proof.feature.evidence.at(-1)}`);
assert(report.artifacts.some(a=>a.path===proof.latestEvidencePath),'Latest feature evidence must be authenticated');
const latest=proof.evidence.find(e=>e.path===proof.latestEvidencePath);assert(latest);const {path:evidencePath,...evidenceData}=latest;assert.deepEqual(evidenceData,await json(evidencePath));
assert.equal(latest.featureId,featureId);assert.equal(latest.pass,true);assert.equal(latest.contractHash,proof.feature.contract.hash);
assert(latest.executedLayers.includes('full')&&latest.commands.length>0&&latest.commands.some(c=>c.command==='node --test acceptance.test.mjs'&&c.pass&&c.exitCode===0)&&latest.commands.every(c=>c.pass&&c.exitCode===0&&!c.timedOut));
const verification=events.findLast(e=>e.type==='feature.verified'&&e.featureId===featureId);assert(verification);assert.equal(verification.pass,true);assert.equal(verification.evidence,proof.feature.evidence.at(-1));
assert.equal(finalWorker.turnStatus,'completed');assert.equal(finalWorker.header.id,finalWorker.threadId);assert.equal(finalWorker.header.idMatchesExpected,true);assert.equal(finalWorker.header.type,'session_meta');assert(finalWorker.header.firstLineBytes>16384);
assert(!workers.workers.some(w=>w.threadId===finalWorker.threadId));assert(events.some(e=>e.type==='worker.claimed'&&e.workerId===finalWorker.threadId));
assert(stream.some(e=>e.kind==='threadMetadata'&&e.id===finalWorker.threadId&&e.sessionId===finalWorker.threadId));
for(const h of finalWorker.hooks)assert(stream.some(e=>e.method==='hook/completed'&&e.threadId===finalWorker.threadId&&e.run.id===h.id&&e.run.eventName===h.event&&e.run.status===h.status&&JSON.stringify(e.run.entries)===JSON.stringify(h.entries)));
assert(finalWorker.hooks.some(h=>h.event==='userPromptSubmit'&&h.status==='completed'));
assert.deepEqual(finalWorker.discovery,workers.discovery);
const nativeCommands=await json(`${base}/final-native-commands.json`);assert.equal(nativeCommands.threadId,finalWorker.threadId);assert.equal(nativeCommands.sessionMeta.id,finalWorker.threadId);assert.equal(nativeCommands.sourcePath,finalWorker.header.path);
for(const c of nativeCommands.commands){assert.equal(c.threadId,finalWorker.threadId);assert.equal(path.resolve(c.cwd.startsWith('file:')?fileURLToPath(c.cwd):c.cwd),path.resolve(root));assert.equal(c.status,'completed');assert.equal(c.exitCode,0);const observed=stream.find(e=>e.method==='item/completed'&&e.threadId===c.threadId&&e.item?.id===c.itemId&&e.item.type==='commandExecution');assert(observed);assert.equal(observed.item.exitCode,c.exitCode);for(const event of ['preToolUse','postToolUse'])assert(stream.some(h=>h.method==='hook/completed'&&h.threadId===c.threadId&&h.run.eventName===event&&h.run.status==='completed'&&h.run.id.endsWith(`:${c.itemId}`)));}
const finalExecuted=pattern=>nativeCommands.commands.some(c=>pattern.test(c.command.join(' ')));
assert(finalExecuted(/run\.mjs claim/),'Native final worker claim');assert(finalExecuted(/run\.mjs verify ledger-verification-002/),'Native final verification');assert(finalExecuted(/checkpoint --reason worker_yield/),'Native final owner yield');
const preview=await readFile(`${root}/.native-core-quick.tmp.txt`,'utf8');assert(preview.includes('ledger-output-suppression-7419'));assert(preview.includes('OUTPUT TRUNCATED'));assert(preview.length<7000);
const output=await readFile(`${root}/.harness/logs/1bf3b970-fa4b-45d4-a120-27d0a1bd3c63.stdout.log`);assert.equal(output.length,20031);assert.equal(sha(output),'e5fc872beea59d3ea54cea052bd8263a9c5b5d2da039340069581a328081ce32');
assert(stream.some(e=>e.method==='item/completed'&&e.item?.type==='commandExecution'&&/check quick/.test(e.item.command||'')&&e.item.exitCode===0));
const parent=await rows(`${base}/parent-auto5000-events.jsonl`);
assert(!parent.some(e=>e.kind==='request'&&/compact/i.test(e.method)));
const start=parent.find(e=>e.method==='item/started'&&e.params?.item?.type==='contextCompaction');assert(start);
const end=parent.find(e=>e.method==='item/completed'&&e.params?.item?.id===start.params.item.id&&e.params?.threadId===start.params.threadId);assert(end);
const completed=parent.filter(e=>e.method==='hook/completed'&&e.params.threadId===start.params.threadId);
assert(completed.some(e=>e.params.run.eventName==='preCompact'&&['success','completed'].includes(e.params.run.status)));
assert(completed.some(e=>e.params.run.eventName==='sessionStart'&&['success','completed'].includes(e.params.run.status)&&e.params.run.entries.some(x=>x.kind==='context'&&/routing|delegate|worker/i.test(x.text))));
assert(parent.some(e=>e.method==='item/completed'&&e.params?.item?.type==='agentMessage'&&e.params.threadId===start.params.threadId&&/ledger-routing-7419/.test(e.params.item.text)&&/ledger-001/.test(e.params.item.text)&&parent.indexOf(e)>parent.indexOf(end)));
for(const file of ['money-validation.mjs','ledger-core.mjs','ledger.mjs'])assert(!(await readFile(`${root}/${file}`,'utf8')).includes('.harness'),'Product runtime independence');
assert.equal(sha(await readFile(`${root}/acceptance.test.mjs`)),'c0a61500b4ab0ed5c845f9606029ac3d3c09a982288fcaa72a00655de60f0e7a','Original prepared five-case acceptance scaffold');
const acceptance=execFileSync(process.execPath,['--test','acceptance.test.mjs'],{cwd:path.resolve(root),encoding:'utf8'});assert(/# tests 5/.test(acceptance));assert(/# pass 5/.test(acceptance));assert(/# fail 0/.test(acceptance));
console.log(JSON.stringify({pass:true,historicalSourceReview:'authenticated-attestation-only',nativeWorkers:workers.workers.length,pressureTransfers:workers.transfers.length,persistedTrust:true,bypasses:false,automaticCompaction:true,acceptanceCases:5,productIndependent:true}));
