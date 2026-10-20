import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {invoke,gateTimeout,verifyGatePlan} from './rollout004-context-performance-gate.mjs';
import {failure,configProjection,checkNative,discoverNativeDefinitions} from './rollout004-context-performance.mjs';
import {digest,featureId,targets,currentAuthority,verifyFreeze,helpers,freezePath,sourceProjectionPath,sourceGatePin,sourceAuthorityPin,bridgePin,originalBaselinePin} from './rollout004-context-performance-authority.mjs';
import {assertClosure,futureHelperPaths} from './source-context-performance-authority.mjs';
import {verifySupersessionReport} from './verify-rollout004-context-performance-supersession.mjs';
import {initHarness,planSync} from '../skill/codex-harness/scripts/lib/core.mjs';
import {conditionalArtifacts,reviewedPlan,recoverPolicyOnly,validatePolicyOnlyState} from './rollout004-context-performance.mjs';
import {verifyExecution,verifyRecordedExecution,verifyRecordedAuthority} from './verify-rollout004-context-performance.mjs';

test('retained V9 execution authenticates frozen metadata and the exact recovery prefix',async()=>{
 const A=await import('./rollout004-context-performance-authority.mjs');
 function fixture(change={}){
  const documents=new Map(),put=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value)),ref={path:name,bytes:bytes.length,sha256:A.sha(bytes)};documents.set(A.digest(ref),bytes);return ref;};
  const events=Buffer.from('authenticated historical events\ncurrent events\n'),terminal={id:'recorded-worker',generation:108},later={id:'current-worker',generation:117};
  const common={version:1,kind:'rollout004-v9-recovery-and-worker-transfer-proof',root:A.sourceRoot,predecessor:{pin:'predecessor'},sealedContinuity:{pin:'sealed'},recovery:{to:{id:'initial-worker',generation:90}}};
  const transition={from:common.recovery.to,to:terminal},proof={...common,transitions:[transition],terminal,eventsPrefix:{bytes:31,sha256:A.sha(events.subarray(0,31))}},verified={...common,transitions:[transition,{from:terminal,to:later}],terminal:later,eventsPrefix:{bytes:events.length,sha256:A.sha(events)}};
  change.proof?.(proof);const proofRef=put('historical-proof',proof),currentHelpers=Array.from({length:4},(_,i)=>({path:`fixed-helper-${i}`,bytes:1,sha256:'1'.repeat(64)})),helperRefs=A.helpers.map(p=>({path:p,bytes:1,sha256:'2'.repeat(64)}));
  const bridge={version:1,kind:'successor',predecessor:{pin:'old'},archiveManifest:{pin:'archive'},prepared:{pin:'prepared'},progressArchive:{pin:'progress'},currentHelpers,completedReceipt:{pin:'receipt'},failureCapsule:{pin:'failure'},nativePreservation:A.nativePreservationPin,helpers:helperRefs,worker:'codex:'+terminal.id,workerRecovery:proofRef},currentBridge={...bridge,worker:'codex:'+later.id,workerRecovery:A.v9WorkerRecoveryPin};
  change.bridge?.(bridge);const bridgeRef=put('historical-bridge',bridge),currentBridgeRef=put('current-bridge',currentBridge);
  const freeze={version:1,kind:'independent-context-performance-successor-helper-freeze',outcome:'clean',independentActualCode:true,findings:[],worker:'codex:'+terminal.id,reviewer:'independent-reviewer',sourceGate:A.sourceGatePin,sourceAuthority:A.sourceAuthorityPin,historicalBridge:A.bridgePin,successorBridge:bridgeRef,currentHelpers,helpers:helperRefs};
  const projection={...freeze,helpers:[...helperRefs,...currentHelpers]};change.projection?.(projection);const projectionRef=put('historical-projection',projection);freeze.sourceProjection=projectionRef;change.freeze?.(freeze);const freezeRef=put('historical-freeze',freeze);
  const authority={version:1,bridge:A.bridgePin,sourceAuthority:A.sourceAuthorityPin,sourceGate:A.sourceGatePin,proof:{pass:true},node:{version:20},nativePreservation:A.nativePreservationPin,successorBridge:bridgeRef,helperFreeze:freezeRef,sourceProjection:projectionRef},current={...authority,successorBridge:currentBridgeRef,helperFreeze:{path:'current-freeze'},sourceProjection:{path:'current-projection'}};
  change.authority?.(authority);const receipt={executionAuthority:put('historical-execution',authority),successorBridge:bridgeRef};
  const deps={json:async ref=>{const bytes=documents.get(A.digest(ref));assert(bytes,'Authenticated fixture ref required');assert.equal(bytes.length,ref.bytes);assert.equal(A.sha(bytes),ref.sha256);return JSON.parse(bytes);},recoveryProof:async ref=>A.digest(ref)===A.digest(A.v9WorkerRecoveryPin)?verified:JSON.parse(documents.get(A.digest(ref))),verifyRecovery:async(ref,worker)=>{assert.deepEqual(ref,A.v9WorkerRecoveryPin);assert.equal(worker,'codex:'+later.id);return verified;},readEvents:async()=>events};
  return {authority,current,receipt,deps,owner:terminal};
 }
 const saved=fixture();assert.deepEqual((await verifyRecordedExecution(saved.receipt,saved.current,saved.deps,{owner:saved.owner})).proof.terminal,saved.owner);await verifyRecordedAuthority(saved.authority,saved.current,saved.deps);
 for(const change of [
  {bridge:b=>{b.worker='codex:foreign-worker';}},
  {proof:p=>{p.recovery={to:{id:'foreign-worker',generation:90}};}},
  {proof:p=>{p.transitions[0]={...p.transitions[0],from:{id:'foreign-worker',generation:90}};}},
  {proof:p=>{p.eventsPrefix.sha256='0'.repeat(64);}},
  {freeze:f=>{f.successorBridge={path:'foreign-bridge'};}},
  {projection:p=>{p.helpers=[];}},
  {authority:a=>{a.nativePreservation={path:'foreign-preservation'};}}
 ]){const bad=fixture(change);await assert.rejects(verifyRecordedExecution(bad.receipt,bad.current,bad.deps,{owner:bad.owner}));}
 await assert.rejects(verifyRecordedExecution(saved.receipt,saved.current,saved.deps,{owner:{id:'foreign-worker',generation:108}}));
 await assert.rejects(verifyRecordedExecution({...saved.receipt,successorBridge:{path:'foreign-bridge'}},saved.current,saved.deps));
 const currentReceipt={executionAuthority:{path:A.executionAuthorityPath},successorBridge:saved.current.successorBridge};await verifyRecordedExecution(currentReceipt,saved.current,{json:async()=>saved.current});await assert.rejects(verifyRecordedExecution({...currentReceipt,executionAuthority:{path:'copied-current-authority'}},saved.current,{json:async()=>saved.current}));
});

async function conditionalFixture(t){
 const root=await mkdtemp(path.join(process.cwd(),'.rollout004-conditional-'));assert.equal(path.dirname(root),process.cwd());t.after(()=>rm(root,{recursive:true,force:true}));
 await initHarness(root,{name:'Custom Conditional Project',agents:'codex,claude,github-copilot'});
 const originals={'.harness/docs-map.md':'# Custom project documentation\n','.harness/loops/checker.md':'# Custom checker\n','.harness/loops/goal.md':'# Custom goal\n','.harness/loops/maker.md':'# Custom maker\n','AGENTS.md':'# Custom Codex guidance\n','CLAUDE.md':'# Custom Claude guidance\n','.github/copilot-instructions.md':'# Custom Copilot guidance\n','.codex/hooks.json':'{"hooks":{"Custom":[]}}\n','.claude/settings.json':'{"hooks":{"Custom":[]}}\n','.codex/config.toml':'features = { hooks = true }\n'};
 for(const [file,bytes] of Object.entries(originals))await writeFile(path.join(root,file),bytes);
 for(const file of conditionalArtifacts)await rm(path.join(root,file),{force:true});
 const config=JSON.parse(await readFile(path.join(root,'.harness/config.json')));
 const plan=await planSync(root,{enrollHooks:true,deferHostConfig:false});return {root,originals,config,plan};
}
test('canonical conditional family admits all ten exact generated sidecars and preserves customized originals',async t=>{
 const f=await conditionalFixture(t);assert.deepEqual(f.plan.operations.filter(o=>conditionalArtifacts.includes(o.path)&&o.action==='write').map(o=>o.path).sort(),conditionalArtifacts.slice().sort());
 await reviewedPlan(f.plan,f.config);for(const [file,bytes] of Object.entries(f.originals))assert.equal(await readFile(path.join(f.root,file),'utf8'),bytes);
});
test('conditional review rejects noncanonical bytes, source changes, original replacement, deletion, and existing additions',async t=>{
 const f=await conditionalFixture(t),hash=b=>createHash('sha256').update(b).digest('hex');
 for(const mutation of ['bytes','source','original','delete','existing'])await t.test(mutation,async()=>{
  const plan={...f.plan,operations:f.plan.operations.map(o=>({...o,bytes:o.bytes&&Buffer.from(o.bytes)})),sourceSet:f.plan.sourceSet.map(r=>({...r})),readSet:f.plan.readSet.map(r=>({...r}))},sidecar=plan.operations.find(o=>o.path==='.harness/docs-map.v6.addition.md');
  if(mutation==='bytes'){sidecar.bytes=Buffer.from(sidecar.bytes.toString().replace('Custom Conditional Project','Forged Project'));sidecar.afterHash=hash(sidecar.bytes);}
  if(mutation==='source')plan.sourceSet.find(r=>r.path==='docs-map.md.template').hash='f'.repeat(64);
  if(mutation==='original'){const original=plan.operations.find(o=>o.path==='.harness/docs-map.md');original.action='write';original.bytes=Buffer.from('replacement');original.afterHash=hash(original.bytes);}
  if(mutation==='delete')sidecar.action='remove';
  if(mutation==='existing'){sidecar.beforeHash=hash(Buffer.from('custom addition'));}
  await assert.rejects(reviewedPlan(plan,f.config));
 });
});
test('existing customized conditional additions remain preserved without creating overwrite authority',async t=>{
 const f=await conditionalFixture(t);for(const file of conditionalArtifacts)await writeFile(path.join(f.root,file),'custom sidecar '+file+'\n');
 const plan=await planSync(f.root,{enrollHooks:true,deferHostConfig:false});assert(plan.operations.filter(o=>conditionalArtifacts.includes(o.path)).every(o=>o.action==='preserve'));
 await reviewedPlan(plan,f.config);
});
test('fabricated canonical sidecars reject already routed instruction and hook originals and disabled platforms',async t=>{
 const f=await conditionalFixture(t),hash=b=>createHash('sha256').update(b).digest('hex');
 for(const [original,addition] of [['AGENTS.md','.harness/AGENTS.addition.md'],['CLAUDE.md','.harness/CLAUDE.addition.md'],['.github/copilot-instructions.md','.harness/copilot-instructions.addition.md'],['.codex/hooks.json','.harness/codex-hooks.addition.json'],['.claude/settings.json','.harness/claude-hooks.addition.json']])await t.test(original,async()=>{
  const operation=f.plan.operations.find(o=>o.path===addition),content=original.endsWith('.json')?operation.bytes.toString():'## Development-Harness Boundary\nORCHESTRATED_WORKER_CONTINUITY_V1\n@AGENTS.md\n.harness/config.json\n.harness/features.json\n.harness/continuity.json\n.harness/run.mjs resume\n';
  await writeFile(path.join(f.root,original),content);const plan={...f.plan,readSet:f.plan.readSet.map(r=>r.path===original?{...r,hash:hash(Buffer.from(content))}:r),operations:f.plan.operations.map(o=>o.path===original?{...o,beforeHash:hash(Buffer.from(content)),afterHash:hash(Buffer.from(content))}:o)};
  await assert.rejects(reviewedPlan(plan,f.config),/Already routed/);await writeFile(path.join(f.root,original),f.originals[original]);
 });
 for(const platform of ['claude','github-copilot','codex'])await t.test('disabled '+platform,async()=>{const config=structuredClone(f.config);config.agents.enabled=config.agents.enabled.filter(value=>value!==platform);await assert.rejects(reviewedPlan(f.plan,config));});
});

async function policyOnlyFixture(){
 const A=await import('./rollout004-context-performance-authority.mjs'),store=new Map(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const put=(file,value)=>{assert(!store.has(file));const bytes=Buffer.from(JSON.stringify(value)),ref={path:file,bytes:bytes.length,sha256:hash(bytes)};store.set(file,{bytes,ref});return ref;};
 const authority=put('authority',{}),baselineRef=put('baseline',{}),failureRef=put('failure',{}),policyRef=put('policy',{}),patchRef=put('policy-patch',{afterSha256:'c'.repeat(64)}),firstwaveRef=put('firstwave',{}),continuationRef=put('continuation',{}),beforeRef=put('before',{config:{policies:{maxAttempts:3,maxRepeatedFailures:2}}});
 const original={authority,baseline:baselineRef,policyRef,pending:{operation:'apply',index:1,startedAt:'2026-10-16T21:00:00Z',configBeforeSha256:'d'.repeat(64),failure:failureRef},artifacts:[],targets:A.targets.map((root,index)=>({root,index,status:[0,4].includes(index)?'audited':'pending',applies:[0,4].includes(index)?[put('old-apply-'+index,{})]:[],audits:[0,4].includes(index)?[put('old-audit-'+index,{})]:[],runtime:{before:'runtime'}}))};
 const failedRef=put('failed-progress',original),capsuleRef=put('capsule',{}),bridgeHash='b'.repeat(64),bridgeRef={path:A.successorBridgePath,bytes:1,sha256:bridgeHash},current={successorBridge:bridgeRef},execution={successorBridge:bridgeRef,executionAuthority:put('execution',current)},owner={id:'fixture-worker',generation:90,phase:'working',handoffId:null};
 const verified={failedProgress:structuredClone(original),capsule:{refs:{failedProgress:failedRef,failure:failureRef,policyPatch:patchRef,firstwave:firstwaveRef,continuation:continuationRef,targetBefore:beforeRef}},policyPatch:{afterSha256:'c'.repeat(64)},bridge:{prepared:{baseline:baselineRef},failureCapsule:capsuleRef}},baseline={authority};
 const definitions=Array.from({length:6},(_,i)=>({key:'key-'+i,source:'project',sourcePath:path.join(A.targets[1],'.codex/hooks.json'),currentHash:'sha256:'+'e'.repeat(64),trustStatus:'trusted'}));
 const receipts=['config/read','hooks/list'].flatMap((method,i)=>[{stage:'request',id:i+1,method,...(i?{cwds:[A.targets[1]]}:{includeLayers:true})},{stage:'response',id:i+1,method,resultSha256:'e'.repeat(64),...(i?{definitions,discoveryScopes:[{cwd:A.targets[1],errors:[]}]}:{layer:{version:'fixture'}})},{stage:'raw-boundary',id:i+1,method,readStable:true,beforeSha256:'e'.repeat(64),afterSha256:'e'.repeat(64)}]);
 let persisted=structuredClone(original),progressHash=failedRef.sha256,syncs=0,plans=0,interrupt=null,drift=null,completed=false,locked=false;
 const targetInputs={preserved:{unchanged:true},runtime:{before:'runtime'},configSha256:'c'.repeat(64)},nativeInputs={value:{definitions,trust:Object.fromEntries(definitions.map(d=>[d.key,d.currentHash]))},receipts};
 const deps={owner:async()=>({...owner,generation:drift==='owner'?91:90}),loadBaseline:async()=>({progress:structuredClone(persisted),baseline}),currentAuthority:async()=>drift==='authority'?{...current,bad:true}:current,verifySuccessorBridge:async()=>verified,executionBinding:async()=>execution,checkPolicy:async()=>{},withLock:async fn=>{assert(!locked);locked=true;try{return await fn();}finally{locked=false;}},absolute:p=>p,hashOptional:async p=>p===A.progressPath?(drift==='cas'?'f'.repeat(64):progressHash):(store.get(p)?.ref.sha256??null),reference:async p=>store.get(p).ref,authenticate:async ref=>{const saved=store.get(ref.path);assert(saved);assert.deepEqual(ref,saved.ref);assert.equal(hash(saved.bytes),ref.sha256);return saved.bytes;},exclusive:async(p,v)=>{const ref=put(p,v);if(interrupt==='intent'&&p.includes('policy-only-intent'))throw Error('interrupted after intent');if(interrupt==='audit'&&p.includes('target-1-audit'))throw Error('interrupted after audit');return ref;},atomicCAS:async(p,expected,bytes)=>{assert.equal(expected,progressHash);if(interrupt==='commit')throw Error('interrupted before commit');persisted=JSON.parse(bytes);progressHash=hash(bytes);},policyOnlyTarget:async(_state,_verified,options={})=>{if(drift==='runtime')throw Error('runtime changed');if(drift==='policy')throw Error('policy changed');assert.equal(!!options.completed,completed);return options.completed?{...targetInputs,runtime:{after:'runtime'}}:targetInputs;},policyOnlyNativeInputs:async()=>{if(drift==='native')throw Error('native changed');return nativeInputs;},prepareApplyContinuation:async(index,state)=>{plans++;assert.equal(index,1);assert.equal(state.configBeforeSha256,original.pending.configBeforeSha256);assert.deepEqual(state.policyPatch,patchRef);const review={planHash:'a'.repeat(64),configMigration:null,operations:[],readSet:[],sourceSet:[]};return {state,index,planRef:put(A.directory+'/target-1-plan.json',review)};},continueApply:async(index,prepared,options)=>{await options.beforeSync();if(interrupt==='before-sync')throw Error('interrupted before sync');syncs++;completed=true;if(interrupt==='after-sync')throw Error('interrupted after sync');const receipt=put(A.directory+'/target-1-apply.json',{index,root:A.targets[index],recoveryIntent:prepared.recoveryIntent,authority, ...execution,policy:policyRef,policyPatch:patchRef,plan:prepared.planRef,startedAt:original.pending.startedAt,completedAt:'2026-10-16T21:01:00Z',configBeforeSha256:original.pending.configBeforeSha256,configAfterSha256:'c'.repeat(64),migration:null,runtime:{after:'runtime'},native:{approval:{status:'trusted',approved:0,planHash:'a'.repeat(64)}},receipts});if(interrupt==='receipt')throw Error('interrupted after receipt');return {receipt};},collectAudit:async(index,state)=>({index,root:A.targets[index],runtime:{after:'runtime'},native:{definitions,trust:nativeInputs.value.trust},apply:state.progress.targets[index].applies[0],authority,receipts}),now:()=> '2026-10-16T21:00:01Z'};
 return {A,deps,store,original,verified,current,execution,expected:failedRef.sha256,bridgeHash,get progress(){return persisted;},get syncs(){return syncs;},get plans(){return plans;},set interrupt(v){interrupt=v;},set drift(v){drift=v;},run:()=>recoverPolicyOnly(1,failedRef.sha256,bridgeHash,deps)};
}
test('policy-only recovery continues exactly once from existing policy receipt and reconciles duplicate invocation',async()=>{
 const f=await policyOnlyFixture(),result=await f.run();assert.equal(f.syncs,1);assert.equal(f.plans,1);assert.equal(f.progress.pending,null);assert.equal(f.progress.targets[1].status,'audited');assert.equal(f.progress.targets[1].applies.length,1);assert.equal(f.progress.targets[1].audits.length,1);assert(f.store.has(result.intent.path));assert.deepEqual(f.store.get('failed-progress').bytes,Buffer.from(JSON.stringify(f.original)));assert.equal((await f.run()).reconciled,true);assert.equal(f.syncs,1);assert.equal(f.plans,1);
});
test('policy-only recovery never starts a second sync after intent or unknown external outcome',async t=>{
 for(const boundary of ['intent','before-sync','after-sync'])await t.test(boundary,async()=>{const f=await policyOnlyFixture();f.interrupt=boundary;await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);const count=f.syncs;f.interrupt=null;await assert.rejects(f.run(),/no completed receipt/);assert.equal(f.syncs,count);assert.equal(f.plans,1);});
});
test('policy-only recovery reconciles durable apply and audit receipt boundaries without replay',async t=>{
 for(const boundary of ['receipt','commit','audit'])await t.test(boundary,async()=>{const f=await policyOnlyFixture();f.interrupt=boundary;await assert.rejects(f.run());if(boundary!=='audit')assert.deepEqual(f.progress,f.original);const receipts=[...f.store.entries()].filter(([p])=>p.includes('target-1-')).map(([p,v])=>[p,v.ref]);f.interrupt=null;await f.run();for(const [p,r] of receipts)assert.deepEqual(f.store.get(p).ref,r);assert.equal(f.syncs,1);assert.equal(f.progress.targets[1].status,'audited');});
});
test('policy-only recovery blocks policy, runtime, native, owner, and progress drift with original failure intact',async t=>{
 for(const drift of ['policy','runtime','native','owner','cas'])await t.test(drift,async()=>{const f=await policyOnlyFixture();if(drift==='owner'){let count=0;f.deps.owner=async()=>({id:'fixture-worker',phase:'working',handoffId:null,generation:count++?91:90});}else f.drift=drift;await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);assert.equal(f.syncs,0);});
});
test('policy-only recovery rejects altered sealed pending, failure, or receipt cardinality',async t=>{
 for(const mutate of [s=>s.progress.pending.failure.sha256='f'.repeat(64),s=>s.progress.pending.index=2,s=>s.progress.targets[1].applies.push({forged:true}),s=>s.baseline.authority={forged:true}])await t.test('sealed guard',async()=>{const f=await policyOnlyFixture(),state={progress:structuredClone(f.original),baseline:{authority:f.original.authority}};mutate(state);assert.throws(()=>validatePolicyOnlyState(state,f.verified,1));});
});
test('V7 execution accepts only exact capsule historical V6 refs and requires V7 for new receipts',async()=>{
 const A=await import('./rollout004-context-performance-authority.mjs'),old={path:'old-receipt',bytes:12,sha256:'a'.repeat(64)},predecessorExecution={sealed:true},current={successorBridge:{path:A.successorBridgePath,bytes:1,sha256:'b'.repeat(64)}},succession={failedProgress:{targets:[{applies:[old],audits:[]}]},predecessorExecution},receipt={successorBridge:A.v6PredecessorPins.successorBridge,executionAuthority:A.v6PredecessorPins.executionAuthority},deps={json:async()=>predecessorExecution};
 await verifyExecution(receipt,current,deps,old,succession);await assert.rejects(verifyExecution(receipt,current,deps,{...old,sha256:'c'.repeat(64)},succession));await assert.rejects(verifyExecution({...receipt,executionAuthority:{...receipt.executionAuthority,sha256:'d'.repeat(64)}},current,deps,old,succession));await verifyExecution({successorBridge:current.successorBridge,executionAuthority:{path:A.executionAuthorityPath}},current,{json:async()=>current},{path:'new'},succession);
});
test('V7 SOURCE apply accepts only the original prepared receipt, rejecting a copied path or substituted digest',async()=>{
 const ref={path:'sealed-source-apply',bytes:123,sha256:'a'.repeat(64)},succession={bridge:{prepared:{apply:ref}}};await verifyExecution({index:0},{},{},ref,succession,{apply:true});
 for(const forged of [{...ref,path:'copy-of-source-apply'},{...ref,sha256:'b'.repeat(64)},{...ref,bytes:124}])await assert.rejects(verifyExecution({index:0},{},{},forged,succession,{apply:true}),/exact prepared receipt/);
});
test('V7 SOURCE audits retain exact historical V6 authentication and new audit receipts require V7',async()=>{
 const A=await import('./rollout004-context-performance-authority.mjs'),ref={path:'sealed-source-audit',bytes:123,sha256:'a'.repeat(64)},predecessor={version:6},current={successorBridge:{path:'v7-bridge'}},succession={bridge:{prepared:{apply:{path:'source-apply'}}},failedProgress:{targets:[{applies:[],audits:[ref]}]},predecessorExecution:predecessor};
 const receipt={index:0,successorBridge:A.v6PredecessorPins.successorBridge,executionAuthority:A.v6PredecessorPins.executionAuthority};
 await verifyExecution(receipt,current,{json:async()=>predecessor},ref,succession);
 await assert.rejects(verifyExecution(receipt,current,{json:async()=>predecessor},{...ref,path:'copied-source-audit'},succession));
 await verifyExecution({index:0,successorBridge:current.successorBridge,executionAuthority:{path:A.executionAuthorityPath}},current,{json:async()=>current},{path:'new-source-audit'},succession);
});
async function pinnedPolicyFailureFixture(){
 const A=await import('./rollout004-context-performance-authority.mjs'),manifest=JSON.parse(await A.authenticate(A.v6ArchiveManifestPin)),mapped=new Map([...manifest.mappings,...manifest.evidence].map(m=>[A.digest(m.original),m.archive]));
 const authenticate=ref=>A.authenticate(mapped.get(A.digest(ref))??ref),prior=await A.verifyV6SuccessorBridge(A.v6PredecessorPins.successorBridge,{authenticate});
 return {A,prior,authenticate,run:deps=>A.verifyPolicyFailureCapsule(A.policyFailureCapsulePin,prior.baseline,{authenticate,...deps})};
}
test('actual pinned policy-only capsule authenticates the V6 predecessor chain and preserves exact historical receipt counts',async()=>{
 const f=await pinnedPolicyFailureFixture(),verified=await f.run();assert.equal(verified.failedProgress.targets[0].applies.length,1);assert.equal(verified.failedProgress.targets[0].audits.length,2);assert.equal(verified.failedProgress.targets[4].applies.length,1);assert.equal(verified.failedProgress.targets[4].audits.length,3);
});
test('actual capsule rejects altered failure, policy, runtime reconciliation, owner, and historical cardinalities',async t=>{
 const f=await pinnedPolicyFailureFixture(),capsule=JSON.parse(await f.authenticate(f.A.policyFailureCapsulePin));
 for(const name of ['failure','policy','runtime','owner','source-audits','target4-audits'])await t.test(name,async()=>{
  const key=name==='failure'?'failure':name==='policy'?'policyPatch':['runtime','owner'].includes(name)?'reconciliation':'failedProgress';
  const authenticate=async ref=>{const bytes=await f.authenticate(ref);if(ref.path!==capsule.refs[key].path)return bytes;const value=JSON.parse(bytes);
   if(name==='failure')value.pending.index=4;if(name==='policy')value.after.maxAttempts=6;if(name==='runtime')value.runtime.changed=['.harness/run.mjs'];if(name==='owner')value.targetSession.owner={id:'unreviewed-worker'};if(name==='source-audits')value.targets[0].audits.pop();if(name==='target4-audits')value.targets[4].audits.pop();return Buffer.from(JSON.stringify(value));};
  await assert.rejects(f.run({authenticate}));
 });
});

async function sourceTransferPreservationFixture(t){
 const A=await import('./rollout004-context-performance-authority.mjs'),root=await mkdtemp(path.join(tmpdir(),'rollout004-transfer-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const put=async(file,value)=>{const target=path.join(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,value);};
 for(const [file,value] of Object.entries({'.harness/config.json':{policies:{maxAttempts:3,maxRepeatedFailures:1}},'.harness/features.json':{revision:1,features:[]},'.harness/continuity.json':{generation:1,phase:'working'}}))await put(file,JSON.stringify(value));
 await put('.harness/events.jsonl','');await put('.harness/history/progress/original.md','immutable predecessor');
 const before=await A.preservation(root),proof={transitions:A.continuityHistoryPins.map(history=>({history}))};
 for(const pin of A.continuityHistoryPins)await put(pin.path,await A.authenticate(pin));
 const deps={sourceRoot:root,verifyContinuity:async()=>({before,proof})},run=()=>A.assertProductionPreserved(before,{allowOwnFeature:false},deps);
 return {A,root,before,proof,deps,put,run};
}
test('SOURCE transfer preservation accepts exactly two reviewed archives while generic preservation rejects them',async t=>{
 const f=await sourceTransferPreservationFixture(t);await assert.rejects(()=>f.A.assertPreserved(f.before,{allowOwnFeature:false}),/Historical file added/);await f.run();
});
test('SOURCE transfer preservation rejects each missing or tampered reviewed archive',async t=>{
 for(let i=0;i<2;i++)for(const kind of ['missing','tampered'])await t.test(`${kind} transfer ${i+1}`,async t=>{const f=await sourceTransferPreservationFixture(t),pin=f.A.continuityHistoryPins[i];if(kind==='missing')await rm(path.join(f.root,pin.path));else await f.put(pin.path,'tampered reviewed archive');await assert.rejects(f.run);});
});
test('SOURCE transfer preservation rejects unrelated additions and changed original history',async t=>{
 for(const [file,bytes] of [['.harness/history/progress/third-handoff.md','unreviewed'],['.harness/history/progress/original.md','changed predecessor']])await t.test(file,async t=>{const f=await sourceTransferPreservationFixture(t);await f.put(file,bytes);await assert.rejects(f.run);});
});
test('non-SOURCE preservation rejects identical archive filenames without consulting SOURCE authority',async t=>{
 const f=await sourceTransferPreservationFixture(t);let consulted=false;await assert.rejects(()=>f.A.assertProductionPreserved(f.before,{allowOwnFeature:false},{sourceRoot:'different SOURCE',verifyContinuity:async()=>{consulted=true;throw Error('unexpected SOURCE proof');}}),/Historical file added/);assert.equal(consulted,false);
});
async function reviewedSourceProofFixture(){
 const A=await import('./rollout004-context-performance-authority.mjs'),ref=await A.reference(A.directory+'/source-continuity-proof-v6.json'),proof=JSON.parse(await A.authenticate(ref)),events=await readFile(A.absolute('.harness/events.jsonl')),raw=new Map();
 const seal=()=>{const bytes=Buffer.from(JSON.stringify(proof)),sealed={path:ref.path,bytes:bytes.length,sha256:A.sha(bytes)};raw.set(sealed.path,{ref:sealed,bytes});return sealed;};
 const deps={authenticate:async ref=>{const value=raw.get(ref.path);if(!value)return A.authenticate(ref);assert.deepEqual(ref,value.ref);assert.equal(A.sha(value.bytes),ref.sha256);return value.bytes;},readEvents:async()=>events};
 return {A,proof,events,raw,deps,seal,run:()=>A.verifySourceContinuityProof(seal(),'codex:'+proof.transitions[1].to.id,deps)};
}
test('production SOURCE transfer proof authenticates both predecessor-bound transitions',async()=>{const f=await reviewedSourceProofFixture();await f.run();});
test('production SOURCE transfer proof rejects replay before exact matching resume',async t=>{
 for(let i=0;i<2;i++)await t.test(`transfer ${i+1}`,async()=>{const f=await reviewedSourceProofFixture(),id=f.proof.transitions[i].id,events=Buffer.from(f.events.toString('utf8').trim().split('\n').map(JSON.parse).filter(e=>!(e.type==='worker.resumed'&&e.handoffId===id)).map(e=>JSON.stringify(e)).join('\n')+'\n');f.proof.eventsPrefix={bytes:events.length,sha256:f.A.sha(events)};f.deps.readEvents=async()=>events;await assert.rejects(f.run);});
});
test('production SOURCE transfer proof rejects actor, generation, event, archive and predecessor substitutions',async t=>{
 const changes=[f=>f.proof.transitions[0].from.id='other actor',f=>f.proof.transitions[1].to.generation++,f=>f.proof.transitions[1].resumed.at='2026-10-16T20:55:54.000Z',f=>f.proof.transitions[0].history.sha256='f'.repeat(64),f=>f.proof.predecessor.helperFreeze.sha256='f'.repeat(64),f=>f.proof.transitions.push(f.proof.transitions[1])];
 for(let i=0;i<changes.length;i++)await t.test(`substitution ${i+1}`,async()=>{const f=await reviewedSourceProofFixture();changes[i](f);await assert.rejects(f.run);});
});

function nativeDiscoveryFixture(){return targets.map((cwd,index)=>({cwd,errors:[],hooks:Array.from({length:6},(_,slot)=>({key:`project-${index}-${slot}`,source:'project',sourcePath:path.join(cwd,'.codex/hooks.json'),currentHash:'sha256:'+'a'.repeat(64),trustStatus:'trusted'}))}));}

test('production native discovery explicitly requests all eleven roots and accepts exactly sixty-six project hooks',async()=>{
 const calls=[];
 const defs=await discoverNativeDefinitions(async(method,params)=>{calls.push({method,params});return {data:nativeDiscoveryFixture()};});
 assert.deepEqual(calls,[{method:'hooks/list',params:{cwds:targets}}]);
 assert.equal(defs.length,66);
 assert.equal(new Set(defs.map(h=>h.key)).size,66);
 for(const root of targets)assert.equal(defs.filter(h=>h.sourcePath===path.join(root,'.codex/hooks.json')).length,6);
});

test('production native discovery rejects incomplete, duplicate, unrequested, errored and malformed results',async t=>{
 const cases={
  'SOURCE-only result':data=>data.splice(1),
  'duplicate root':data=>{data[1]=structuredClone(data[0]);},
  'unrequested root':data=>{data[1].cwd=path.join(targets[0],'unrequested');},
  'root error':data=>{data[4].errors.push({message:'fixture failure'});},
  'missing hook':data=>data[4].hooks.pop(),
  'wrong project source':data=>{data[4].hooks[0].sourcePath=data[0].hooks[0].sourcePath;},
  'duplicate hook key':data=>{data[4].hooks[0].key=data[0].hooks[0].key;},
  'malformed errors':data=>{delete data[4].errors;},
  'malformed hooks':data=>{delete data[4].hooks;}
 };
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async()=>{const data=nativeDiscoveryFixture();mutate(data);await assert.rejects(discoverNativeDefinitions(async()=>({data})));});
 await assert.rejects(discoverNativeDefinitions(async()=>({data:null})));
});

test('native baseline comparison preserves locale ordering and immutable pins while authority digests keep UTF-16 ordering',async()=>{
 const config={Model:'fixture',_defaults:{Z:1,a:2},hooks:{state:{managed:{trusted_hash:'sha256:'+'a'.repeat(64)},custom:{trusted_hash:'sha256:'+'b'.repeat(64),enabled:true}}}};
 const unrelated=structuredClone(config);delete unrelated.hooks.state.managed;
 const legacy='27c90b5c69effa99d09a82a51f260b93f34b385dcbc672e1c2cb72a5fb4cdbf5';
 assert.equal(digest(unrelated),'5b45be93172843b8a56743aa25a7ab66961910e26cb3213c966c646c598ddf8e');
 const baseline={unrelatedSha256:legacy},projection=configProjection(config,['managed']);
 assert.equal(projection.unrelatedSha256,legacy);assert.notEqual(projection.unrelatedSha256,digest(unrelated));checkNative(projection,baseline);
 const trustOnly=structuredClone(config);trustOnly.hooks.state.managed.trusted_hash='sha256:'+'c'.repeat(64);checkNative(configProjection(trustOnly,['managed']),baseline);
 const drift=structuredClone(config);drift.Model='changed';assert.throws(()=>checkNative(configProjection(drift,['managed']),baseline),/Unrelated native configuration drift/);
 assert.deepEqual(originalBaselinePin,{path:'.harness/native-hook-rollout-v2/original-baseline.json',bytes:509223,sha256:'c2dfe6805937aca2fd4b1180ee4ea1c92d0c16c002142066eb01b28d7b8401d5'});
 const pinned=await readFile(new URL('../'+originalBaselinePin.path,import.meta.url));assert.equal(pinned.length,originalBaselinePin.bytes);assert.equal(createHash('sha256').update(pinned).digest('hex'),originalBaselinePin.sha256);
 assert.equal(JSON.parse(pinned).native.unrelatedSha256,'1284e0dec54334edaa6de9516151d358d84bb928c1dfcd27cc715f9e5a0c550e');
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const success={confirmed:true,exitCode:0,timedOut:false};

async function fixture(t,run){
 const cwd=await mkdtemp(path.join(tmpdir(),'rollout004-gate-test-'));
 assert(path.resolve(cwd).startsWith(path.resolve(tmpdir())+path.sep));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 const calls=[],references=[];let cancels=0;
 const command=(...args)=>{
  calls.push(args);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  let complete;const done=new Promise(resolve=>{complete=resolve;});
  queueMicrotask(()=>run({child,complete,close:(code=0,signal=null)=>child.emit('close',code,signal)}));
  return {child,done,cancel(){cancels++;}};
 };
 const ref=async relative=>{
  const bytes=await readFile(path.join(cwd,relative));references.push(relative);
  return {path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 };
 const options={cwd,logDirectory:'capture',args:['fixture.mjs','with space'],command,env:{FIXTURE:'yes'},ref,invokedActor:'test-worker'};
 return {cwd,options,calls,references,get cancels(){return cancels;}};
}

test('gate rejects invalid deadlines before launching or opening capture files',async t=>{
 const f=await fixture(t,()=>assert.fail('must not launch'));
 for(const deadline of [0,-1,NaN,Infinity,1.5,2147473648])await assert.rejects(invoke(deadline,f.options),/Finite gate deadline/);
 assert.equal(f.calls.length,0);assert.equal(f.references.length,0);
});

function freezeComposition(change=()=>{}){
 const raw=new Map(),authenticated=[],gateCalls=[],live=futureHelperPaths.filter(file=>!helpers.includes(file));
 const seal=(file,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));const ref={path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};raw.set(file,bytes);return ref;};
 const rollout=helpers.map(file=>seal(file,`reviewed ${file}`)),current=live.map(file=>seal(file,`sealed ${file}`));
 const metadata={version:1,kind:'independent-context-performance-successor-helper-freeze',outcome:'clean',independentActualCode:true,findings:[],reviewer:'independent-reviewer',worker:'bounded-worker',sourceGate:sourceGatePin,sourceAuthority:sourceAuthorityPin,historicalBridge:bridgePin,currentHelpers:current};
 const projection={...metadata,helpers:[...rollout,...current]},freeze={...metadata,helpers:rollout},bridge={currentHelpers:current,futureGrant:{closureBaseline:Object.fromEntries(current.map(ref=>[ref.path,ref]))}};
 const actual=Object.fromEntries([...rollout,...current].map(ref=>[ref.path,ref]));
 change({freeze,projection,bridge,actual,current,rollout});
 freeze.sourceProjection=seal(sourceProjectionPath,projection);
 const successor=seal(freezePath,freeze);
 const authenticate=async ref=>{assert(ref&&raw.has(ref.path),'Missing authenticated projection');const bytes=raw.get(ref.path);assert.deepEqual({path:ref.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},ref,'Reference changed');authenticated.push(ref.path);return bytes;};
 const deps={verifySuccessorBridge:async()=>({bridge:{worker:freeze.worker,helpers:rollout,currentHelpers:current}}),reference:async file=>{assert.equal(file,freezePath);return successor;},authenticate,verifyBridge:async()=>bridge,closedInputs:async()=>actual,nodeIdentity:async()=>({sealed:true}),verifyGate:async options=>{gateCalls.push(options);assert.equal(options.allowSuccessors,true);assert.notEqual(options.helperFreeze.path,successor.path);const source=JSON.parse(await authenticate(options.helperFreeze));for(const ref of source.helpers)await authenticate(ref);assertClosure(actual,{}, {grant:futureHelperPaths,reviewed:source.helpers});return {pass:true};}};
 return {deps,successor,freeze,projection,authenticated,gateCalls,raw,current,rollout,seal};
}
test('successor authority composes its eight-ref closure with a distinct authenticated twelve-ref SOURCE projection',async()=>{
 const f=freezeComposition(),result=await currentAuthority(f.deps);
 assert.deepEqual(result.helperFreeze,f.successor);assert.deepEqual(result.sourceProjection,f.freeze.sourceProjection);assert.equal(result.proof.pass,true);assert.equal(f.gateCalls.length,1);
 assert.deepEqual(f.freeze.currentHelpers,f.current);assert.equal(f.freeze.helpers.length,8);
 for(const ref of [...f.rollout,...f.current])assert(f.authenticated.includes(ref.path));
 // The old same-ref composition must fail SOURCE's real closure check.
 await assert.rejects(()=>f.deps.verifyGate({allowSuccessors:true,helperFreeze:f.successor}));
});
for(const [name,change] of [
 ['missing SOURCE helper',({projection})=>projection.helpers.pop()],
 ['duplicate SOURCE helper',({projection})=>projection.helpers[11]=projection.helpers[0]],
 ['changed SOURCE helper',({projection})=>projection.helpers[0]={...projection.helpers[0],sha256:'0'.repeat(64)}],
 ['changed SOURCE current helper',({projection})=>projection.currentHelpers=[{...projection.currentHelpers[0],sha256:'0'.repeat(64)},...projection.currentHelpers.slice(1)]],
 ['changed successor LIVE helper',({freeze})=>freeze.currentHelpers=[{...freeze.currentHelpers[0],sha256:'0'.repeat(64)},...freeze.currentHelpers.slice(1)]],
 ['all twelve refs in successor closure',({freeze})=>freeze.helpers=[...freeze.helpers,...freeze.currentHelpers]],
 ['changed trusted SOURCE gate',({projection})=>projection.sourceGate={...sourceGatePin,sha256:'0'.repeat(64)}],
 ['changed trusted bridge',({projection})=>projection.historicalBridge={...bridgePin,sha256:'0'.repeat(64)}],
 ['changed projection reviewer',({projection})=>projection.reviewer='other-reviewer'],
]){
 test(`successor authority rejects ${name} before SOURCE gate`,async()=>{const f=freezeComposition(change);await assert.rejects(()=>currentAuthority(f.deps));assert.equal(f.gateCalls.length,0);});
}
for(const mode of ['missing','tampered','wrong path']){
 test(`successor authority rejects ${mode} SOURCE projection reference`,async()=>{
  const f=freezeComposition();
  if(mode==='missing')delete f.freeze.sourceProjection;
  else if(mode==='tampered')f.freeze.sourceProjection.sha256='0'.repeat(64);
  else f.freeze.sourceProjection.path=freezePath;
  const ref=f.seal(freezePath,f.freeze);await assert.rejects(()=>verifyFreeze(ref,f.deps));assert.equal(f.gateCalls.length,0);
 });
}
test('successor authority rejects raw SOURCE projection tampering after review',async()=>{
 const f=freezeComposition();f.raw.set(sourceProjectionPath,Buffer.from(JSON.stringify({...f.projection,helpers:f.rollout})));
 await assert.rejects(()=>currentAuthority(f.deps),/Reference changed/);assert.equal(f.gateCalls.length,0);
});

test('gate forwards one deadline and authenticates captured output after confirmed close',async t=>{
 const f=await fixture(t,({child,complete,close})=>{
  child.stdout.emit('data',Buffer.from('first\n'));child.stdout.emit('data',Buffer.from('second\n'));
  child.stderr.emit('data',Buffer.from('diagnostic\n'));complete(success);close();
 });
 const result=await invoke(257,f.options);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],f.cwd);assert.deepEqual(f.calls[0][2],{FIXTURE:'yes'});assert.equal(f.calls[0][3],257);
 assert(f.calls[0][0].includes('"with space"'));assert.deepEqual(result.args,f.options.args);assert.equal(result.actor,'test-worker');
 assert.equal(await readFile(path.join(f.cwd,'capture/stdout.log'),'utf8'),'first\nsecond\n');
 assert.equal(result.logs.stdout.bytes,13);assert.equal(result.logs.stderr.bytes,11);assert.equal(result.outcome.controllerExitCode,0);
 assert.deepEqual(f.references,['capture/stdout.log','capture/stderr.log']);
});

test('confirmed completion waits for process close before releasing capture and publishing receipts',async t=>{
 let ready,close;const started=new Promise(resolve=>{ready=resolve;});
 const f=await fixture(t,controller=>{close=controller.close;controller.complete(success);ready();});
 let settled=false;const pending=invoke(257,f.options).finally(()=>{settled=true;});
 await started;await tick();assert.equal(settled,false);assert.deepEqual(f.references,[]);
 close();await pending;assert.equal(settled,true);assert.equal(f.references.length,2);
});

test('unknown termination rejects without waiting for an unconfirmed close or retrying',async t=>{
 const f=await fixture(t,({child,complete})=>{child.stderr.emit('data',Buffer.from('unconfirmed'));complete({...success,confirmed:false});});
 await assert.rejects(invoke(257,f.options),/termination is unconfirmed/);
 assert.equal(f.calls.length,1);assert.equal(f.references.length,2);
 assert.equal(await readFile(path.join(f.cwd,'capture/stderr.log'),'utf8'),'unconfirmed');
});

test('gate rotation preserves exit 75 and invocation evidence without a retry',async t=>{
 const f=await fixture(t,({complete,close})=>{complete({...success,exitCode:75});close(75);});
 await assert.rejects(invoke(257,f.options),error=>{
  assert.equal(error.exitCode,75);assert.equal(error.invocation.outcome.controllerExitCode,75);
  assert.deepEqual(error.invocation.args,f.options.args);assert.equal(error.invocation.logs.stdout.bytes,0);return true;
 });
 assert.equal(f.calls.length,1);assert.equal(f.references.length,2);
});

test('timeout, termination signal and controller disagreement cannot become successful gates',async t=>{
 for(const [name,outcome,code,signal] of [
  ['timeout',{...success,timedOut:true},0,null],['signal',success,0,'SIGTERM'],['controller',success,1,null]
 ])await t.test(name,async childTest=>{
  const f=await fixture(childTest,({complete,close})=>{complete(outcome);close(code,signal);});
  await assert.rejects(invoke(257,f.options));assert.equal(f.calls.length,1);assert.equal(f.references.length,2);
 });
});

test('capture overflow cancels the controller and rejects even after successful process close',async t=>{
 const f=await fixture(t,({child,complete,close})=>{
  child.stdout.emit('data',Buffer.alloc(16000001));complete(success);close();
 });
 await assert.rejects(invoke(257,f.options),/capture bound exceeded/);
 assert.equal(f.cancels,1);assert.equal(f.calls.length,1);assert.equal(f.references.length,2);
});

function gatePlanFixture(){
 const config={policies:{commandTimeoutMs:257}},feature={id:'test-feature'};
 const expected={entries:[{layer:'quick',command:'node --check fixture.mjs'},{layer:'acceptance',command:'node fixture.mjs'}]};
 const before={expected:structuredClone(expected),configHash:digest(config)};
 const invocation={executionCount:2,timeoutMs:771};
 return {config,feature,expected,before,invocation};
}

test('gate receipt requires the exact configured execution count and recomputed deadline',()=>{
 const {config,feature,expected,before,invocation}=gatePlanFixture();
 const planBuilder=(actualConfig,actualFeature)=>{
  assert.strictEqual(actualConfig,config);assert.strictEqual(actualFeature,feature);return expected;
 };
 assert.equal(verifyGatePlan(config,feature,before,invocation,{planBuilder}),true);
 for(const executionCount of [0,1,3,NaN,Infinity]){
  assert.throws(()=>verifyGatePlan(config,feature,before,{...invocation,executionCount},{planBuilder}));
 }
 for(const timeoutMs of [0,-1,NaN,Infinity,770,772]){
  assert.throws(()=>verifyGatePlan(config,feature,before,{...invocation,timeoutMs},{planBuilder}));
 }
});

test('gate receipt rejects altered configured or recorded plans despite matching forged counts',()=>{
 const {config,feature,expected,before,invocation}=gatePlanFixture();
 for(const entries of [expected.entries.slice(0,1),[...expected.entries,{layer:'full',command:'node extra.mjs'}],[{...expected.entries[0],command:'node changed.mjs'},expected.entries[1]]]){
  const altered={...expected,entries};
  assert.throws(()=>verifyGatePlan(config,feature,before,invocation,{planBuilder:()=>altered}),/Gate plan must match/);
  assert.throws(()=>verifyGatePlan(config,feature,{...before,expected:altered},{executionCount:entries.length,timeoutMs:257*(entries.length+1)},{planBuilder:()=>expected}),/Gate plan must match/);
 }
 assert.throws(()=>verifyGatePlan({...config,policies:{commandTimeoutMs:300}},feature,before,invocation,{planBuilder:()=>expected}));
});

test('aggregate gate deadline stays positive, finite and within the timer limit',()=>{
 const expected={entries:[{},{}]};
 assert.equal(gateTimeout({policies:{commandTimeoutMs:257}},expected),771);
 assert.equal(gateTimeout({policies:{commandTimeoutMs:715824549}},expected),2147473647);
 for(const commandTimeoutMs of [0,-1,NaN,Infinity,1.5,715824550,Number.MAX_SAFE_INTEGER]){
  assert.throws(()=>gateTimeout({policies:{commandTimeoutMs}},expected),/Invalid outer gate deadline/);
 }
});

test('post-apply audit failure preserves its original error and receipts after pending is cleared',async()=>{
 const apply={path:'capture/apply.json',sha256:'a'.repeat(64),bytes:23};
 const prior={path:'capture/prior.json',sha256:'b'.repeat(64),bytes:17};
 const progress={pending:null,artifacts:[prior],targets:[{status:'applied',applies:[apply]}]};
 const error=new Error('original post-apply audit failed');error.safeReceipts=[{method:'config/write',completed:true}];
 const failureRef={path:'capture/failure.json',sha256:'c'.repeat(64),bytes:41};
 const writes=[],persisted=[];
 await assert.rejects(failure(progress,error,{
  write:async(file,value)=>{writes.push({file,value:structuredClone(value)});return failureRef;},
  persist:async value=>{persisted.push(structuredClone(value));}
 }),actual=>{assert.equal(actual.message,error.message);assert.deepEqual(actual.safeReceipts,error.safeReceipts);return true;});
 assert.equal(writes.length,1);assert.match(writes[0].file,/\/failure-\d+\.json$/);
 assert.equal(writes[0].value.pending,null);
 assert.equal(writes[0].value.errorSha256,createHash('sha256').update(error.message).digest('hex'));
 assert.deepEqual(writes[0].value.receipts,error.safeReceipts);
 assert.equal(persisted.length,1);assert.deepEqual(persisted[0],progress);
 assert.deepEqual(progress.pending,{stage:'post_apply_audit',completedApply:true,failure:failureRef});
 assert.deepEqual(progress.artifacts,[prior,failureRef]);assert.deepEqual(progress.targets,[{status:'applied',applies:[apply]}]);
});

test('failure with an existing pending operation records its receipt without replacing operation state',async()=>{
 const progress={pending:{operation:'apply',index:4},artifacts:[]},receipt={path:'capture/failure.json'};
 let writes=0,persists=0;
 await assert.rejects(failure(progress,new Error('audit failed'),{
  write:async(_file,value)=>{writes++;assert.deepEqual(value.pending,{operation:'apply',index:4});return receipt;},
  persist:async value=>{persists++;assert.strictEqual(value,progress);}
 }),/audit failed/);
 assert.deepEqual(progress.pending,{operation:'apply',index:4,failure:receipt});
 assert.deepEqual(progress.artifacts,[receipt]);assert.equal(writes,1);assert.equal(persists,1);
});

function supersessionFixture(changeReport=value=>value,changeArchive=value=>value){
 const documents=new Map(),referenced=[],authenticated=[],preserved=[];let authorities=0;
 const seal=(file,value)=>{
  const bytes=Buffer.from(JSON.stringify(value)),ref={path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  documents.set(file,{ref,bytes});return ref;
 };
 const sourceYield=seal('capture/source-yield.json',{reason:'worker_yield',createdAt:'2026-10-16T10:00:00.000Z',generation:82});
 const preservation=seal('capture/preservation.json',{root:targets[4],preserved:'fixture'});
 const firstwave=seal('capture/firstwave.json',{kind:'rollout004-firstwave',sealedAt:'2026-10-16T11:00:00.000Z',reverse:{preservation}});
 const archive=seal('capture/continuation.json',changeArchive({version:1,kind:'reverse-firstwave-continuity-archive',firstwave,preservation,release:{kind:'authorized-reverse-continuation',releasedAt:'2026-10-16T12:00:00.000Z',sourceYield,ownerAfterYield:null,handoffAfterYield:null,sourceGeneration:82,firstwaveSha256:firstwave.sha256}}));
 const report=seal('capture/sealed-report.json',changeReport({version:1,featureId,status:'passed',pending:null,sealedAt:'2026-10-16T13:00:00.000Z',continuation:archive}));
 const deps={
  reference:async file=>{referenced.push(file);assert(documents.has(file),'Unknown authenticated file');return documents.get(file).ref;},
  authenticate:async ref=>{assert(ref&&documents.has(ref.path),'Unknown authenticated reference');authenticated.push(ref.path);const selected=documents.get(ref.path);assert.deepEqual(ref,selected.ref,'Changed sealed bytes');return selected.bytes;},
  currentAuthority:async()=>{authorities++;},
  assertPreserved:async(value,options)=>{preserved.push({value,options});}
 };
 return {report,archive,sourceYield,deps,referenced,authenticated,preserved,get authorities(){return authorities;}};
}

test('supersession report entry consumes its authenticated sealed continuation and source yield',async()=>{
 const f=supersessionFixture(),result=await verifySupersessionReport(f.report.path,f.deps);
 assert.equal(result.pass,true);assert.deepEqual(result.report,f.report);assert.deepEqual(result.archive,f.archive);
 assert.deepEqual(result.result.sourceYield,f.sourceYield);assert.deepEqual(f.referenced,[f.report.path,f.archive.path]);
 assert(f.authenticated.includes(f.report.path));assert(f.authenticated.includes(f.archive.path));assert(f.authenticated.includes(f.sourceYield.path));
 assert.equal(f.authorities,1);assert.deepEqual(f.preserved,[{value:{root:targets[4],preserved:'fixture'},options:{continuation:true,allowOwnFeature:false}}]);
});

test('supersession report entry rejects other artifact kinds and unsealed report identities',async()=>{
 for(const change of [
  value=>({version:value.version,kind:'reverse-firstwave-continuity-archive',continuation:value.continuation}),
  value=>({...value,featureId:'other-feature'}),value=>({...value,status:'pending'}),value=>({...value,pending:{operation:'apply'}})
 ]){
  const f=supersessionFixture(change);await assert.rejects(verifySupersessionReport(f.report.path,f.deps));
  assert.deepEqual(f.referenced,[f.report.path]);assert.equal(f.authorities,0);assert.deepEqual(f.preserved,[]);
 }
});

test('supersession report entry rejects malformed versions and continuation references before authority work',async()=>{
 for(const change of [
  ...[undefined,null,0,2,'1'].map(version=>value=>({...value,version})),
  ...[undefined,null,{},42,{path:42}].map(continuation=>value=>({...value,continuation})),
  value=>({...value,continuation:{...value.continuation,bytes:value.continuation.bytes+1}}),
  value=>({...value,continuation:{...value.continuation,sha256:'0'.repeat(64)}})
 ]){
  const f=supersessionFixture(change);await assert.rejects(verifySupersessionReport(f.report.path,f.deps));
  assert.deepEqual(f.referenced,[f.report.path]);assert.equal(f.authorities,0);assert.deepEqual(f.preserved,[]);
 }
});

test('supersession report entry rejects an authenticated archive of the wrong kind or invalid release',async()=>{
 for(const change of [value=>({...value,kind:'rollout004-firstwave'}),value=>({...value,release:{...value.release,sourceGeneration:81}})]){
  const f=supersessionFixture(value=>value,change);await assert.rejects(verifySupersessionReport(f.report.path,f.deps));
  assert.equal(f.authorities,1);assert.deepEqual(f.preserved,[]);
 }
});


// Execute the recovery command and shared native collector with an in-memory receipt store.
async function recoveryFixture(){
 const M=await import('./rollout004-context-performance.mjs'),A=await import('./rollout004-context-performance-authority.mjs');
 const expected='a'.repeat(64),bridgeHash='b'.repeat(64),store=new Map(),calls=[],owner={id:'fixture-worker',generation:87,phase:'working',handoffId:null};
 const ref=path=>({path,bytes:1,sha256:createHash('sha256').update(path).digest('hex')});
 const original={authority:ref('prepared-authority'),baseline:ref('prepared-baseline'),pending:{stage:'post_apply_audit',completedApply:true,failure:ref('original-failure')},firstwave:null,all11:null,artifacts:[],targets:A.targets.map((root,index)=>({root,index,status:index===0?'applied':'pending',applies:index===0?[ref('original-apply')]:[],audits:[],runtime:{fixture:'runtime'}}))};
 const verified={progress:structuredClone(original),bridge:{prepared:{authority:original.authority,baseline:original.baseline,apply:original.targets[0].applies[0],failure:original.pending.failure}}},baseline={authority:original.authority,native:{keys:Array.from({length:6},(_,i)=>'key-'+i),unrelatedSha256:'fixture'}};
 let persisted=structuredClone(original),currentHash=expected,failRpc=false,ownerDrift=false,casDrift=false,interrupt=null,authorityDrift=false,authorityDriftAfterReceipt=false;
 const successorBridge={path:A.successorBridgePath,bytes:1,sha256:bridgeHash},current={successorBridge},execution={successorBridge,executionAuthority:ref('execution-authority')};
 const definitions=root=>Array.from({length:6},(_,i)=>({key:'key-'+i,source:'project',sourcePath:path.join(root,'.codex/hooks.json'),currentHash:'sha256:'+'c'.repeat(64),trustStatus:'trusted'}));
 const collect=async(index,state)=>M.collectAudit(index,state,{auditState:async()=>({runtime:state.progress.targets[index].runtime,preserved:{pass:true}}),readFile:async()=>Buffer.from('{}'),canonicalCodexHooks:()=>({}),reviewNativeDefinitions:discovery=>discovery.data[0].hooks,now:()=> '2026-10-16T21:00:00Z',nativeSession:async(keys,operation,native,options)=>{assert.equal(options.readOnly,true);const root=A.targets[index],hooks=definitions(root),config={hooks:{state:Object.fromEntries(hooks.map(h=>[h.key,{trusted_hash:h.currentHash}]))}};const rpc=async(method,params)=>{calls.push({method,params});assert(['config/read','hooks/list'].includes(method));if(failRpc)throw Error('read failed');if(method==='config/read')return {config,layers:[{name:{type:'user',file:path.join(process.env.USERPROFILE,'.codex/config.toml')},version:'fixture',config}]};return {data:[{cwd:root,errors:[],hooks}]};};const value=await operation(rpc),receipts=['config/read','hooks/list'].flatMap((method,i)=>[{stage:'request',id:i+1,method,...(i===0?{includeLayers:true}:{cwds:[root]})},{stage:'response',id:i+1,method,resultSha256:'c'.repeat(64),...(i===0?{layer:{version:'fixture'}}:{definitions:value.definitions,discoveryScopes:[{cwd:root,errors:[]}]})},{stage:'raw-boundary',id:i+1,method,readStable:true,beforeSha256:'c'.repeat(64),afterSha256:'c'.repeat(64)}]);return {value,receipts};}});
 const deps={loadBaseline:async()=>({progress:structuredClone(persisted),baseline}),currentAuthority:async()=>authorityDrift?{...current,drift:true}:structuredClone(current),executionBinding:async()=>execution,verifySuccessorBridge:async()=>verified,reference:async path=>{assert(store.has(path));return store.get(path).ref;},authenticate:async r=>{const value=store.get(r.path);assert(value);assert.deepEqual(value.ref,r);return value.bytes;},exclusive:async(path,value)=>{assert(!store.has(path));const bytes=Buffer.from(JSON.stringify(value)),r={path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};store.set(path,{ref:r,bytes});if(authorityDriftAfterReceipt)authorityDrift=true;if(interrupt==='audit'&&path.includes('target-0-audit-recovery')){interrupt=null;throw Error('interrupted after audit receipt');}return r;},hashOptional:async path=>path===A.progressPath?(casDrift?'d'.repeat(64):currentHash):(store.get(path)?.ref.sha256??null),atomicCAS:async(path,expectedHash,bytes)=>{assert.equal(expectedHash,currentHash);if(interrupt==='commit'){interrupt=null;throw Error('interrupted before commit');}persisted=JSON.parse(bytes);currentHash=createHash('sha256').update(bytes).digest('hex');},owner:async()=>({...owner,generation:ownerDrift&&calls.length?88:87}),withLock:async operation=>operation(),collectAudit:collect,checkPolicy:async value=>{assert(value);assert.deepEqual(value.authority,original.authority);},now:()=> '2026-10-16T21:00:00Z',absolute:path=>path};
 return {M,A,deps,expected,bridgeHash,store,calls,original,owner,get progress(){return persisted;},set failRpc(v){failRpc=v;},set ownerDrift(v){ownerDrift=v;},set casDrift(v){casDrift=v;},set interrupt(v){interrupt=v;},set authorityDriftAfterReceipt(v){authorityDriftAfterReceipt=v;},run:()=>M.recoverAudit(0,expected,bridgeHash,deps),collect};
}
test('production audit collector requests exactly SOURCE and root 4 with read-only RPCs',async()=>{const f=await recoveryFixture();for(const index of [0,4]){const state={progress:structuredClone(f.original),baseline:{native:{keys:Array.from({length:6},(_,i)=>'key-'+i)}}};state.progress.targets[index].applies=[{fixture:true}];const result=await f.collect(index,state);assert.equal(result.root,targets[index]);assert.equal(result.native.definitions.length,6);}assert.deepEqual(f.calls.filter(c=>c.method==='hooks/list').map(c=>c.params.cwds),[[targets[0]],[targets[4]]]);assert(f.calls.every(c=>['config/read','hooks/list'].includes(c.method)));});
test('production recovery commits authenticated readback without replaying apply',async()=>{const f=await recoveryFixture();const result=await f.run();assert.equal(f.progress.pending,null);assert.equal(f.progress.targets[0].status,'audited');assert.equal(f.progress.targets[0].applies.length,1);assert(f.store.has(result.recovery.path));assert(f.calls.every(c=>['config/read','hooks/list'].includes(c.method)));assert.equal((await f.run()).reconciled,true);});
test('production recovery preserves original pending and apply on audit failure',async()=>{const f=await recoveryFixture();f.failRpc=true;await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);assert([...f.store.keys()].some(p=>p.includes('audit-recovery-failure')));});
test('production recovery rejects owner generation and progress CAS drift',async t=>{for(const flag of ['ownerDrift','casDrift'])await t.test(flag,async()=>{const f=await recoveryFixture();f[flag]=true;await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);});});
test('production recovery reconciles either interrupted receipt boundary without overwrites',async t=>{for(const boundary of ['audit','commit'])await t.test(boundary,async()=>{const f=await recoveryFixture();f.interrupt=boundary;await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);const receipts=[...f.store.entries()].filter(([p])=>p.includes('target-0-audit-recovery')).map(([p,v])=>[p,v.ref]);await f.run();for(const [p,r] of receipts)assert.deepEqual(f.store.get(p).ref,r);assert.equal(f.progress.pending,null);});});
test('production recovery rejects wrong bridge and altered apply or pending guards',async t=>{for(const change of [f=>f.deps.currentAuthority=async()=>({successorBridge:{sha256:'f'.repeat(64)}}),f=>f.original.pending.completedApply=false,f=>f.original.targets[0].applies.push({bad:true})])await t.test('guard',async()=>{const f=await recoveryFixture();change(f);if(f.original.pending.completedApply===false||f.original.targets[0].applies.length!==1)f.deps.loadBaseline=async()=>({progress:f.original,baseline:{authority:f.original.authority}});await assert.rejects(f.run());assert(f.progress.pending);});});

async function successionFixture(){
 const A=await import('./rollout004-context-performance-authority.mjs'),manifest=JSON.parse(await A.authenticate(A.archiveManifestPin)),freeze=JSON.parse(await A.authenticate(A.predecessorFreezePin)),raw=new Map();
 const progressArchive={...manifest.progress,path:A.directory+'/v4-prepared-progress.json'},progressBytes=await readFile(A.absolute(progressArchive.path)).catch(()=>readFile(A.absolute(manifest.progress.path)));raw.set(progressArchive.path,{ref:progressArchive,bytes:progressBytes});
 const bridge={version:1,kind:'rollout004-v4-v5-audit-recovery-succession',predecessor:manifest.predecessor,archiveManifest:A.archiveManifestPin,prepared:manifest.prepared,progressArchive,helpers:await Promise.all(A.helpers.map(file=>A.reference(file))),currentHelpers:freeze.currentHelpers};
 const seal=()=>{const bytes=Buffer.from(JSON.stringify(bridge)),ref={path:A.v5PredecessorPins.successorBridge.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};raw.set(ref.path,{ref,bytes});return ref;};
 const deps={authenticate:async ref=>{const value=raw.get(ref.path);if(value){assert.deepEqual(ref,value.ref);assert.equal(createHash('sha256').update(value.bytes).digest('hex'),ref.sha256);return value.bytes;}return A.authenticate(ref);},verifyBridge:async()=>({currentHelpers:freeze.currentHelpers})};
 return {A,bridge,manifest,raw,deps,seal,run:()=>A.verifyV5SuccessorBridge(seal(),deps)};
}
test('production successor bridge authenticates only the exact archived V4 predecessors and direct LIVE pins',async()=>{const f=await successionFixture();const verified=await f.run();assert.equal(verified.progress.targets[0].audits.length,0);assert.equal(verified.manifest.mappings.length,8);for(const mapping of f.manifest.mappings){const current=await f.A.reference(mapping.original.path);if(current.sha256!==mapping.original.sha256)await assert.rejects(()=>f.A.authenticate(mapping.original));else await f.A.authenticate(mapping.original);}});
test('production successor bridge rejects prepared-authority/apply/failure substitutions and unauthorized helper paths',async t=>{for(const change of [f=>f.bridge.prepared={...f.bridge.prepared,authority:{bad:true}},f=>f.bridge.prepared={...f.bridge.prepared,apply:{bad:true}},f=>f.bridge.prepared={...f.bridge.prepared,failure:{bad:true}},f=>f.bridge.helpers[0]={...f.bridge.helpers[0],path:'scripts/ninth-helper.mjs'},f=>f.bridge.currentHelpers[0]={...f.bridge.currentHelpers[0],sha256:'f'.repeat(64)}])await t.test('exact binding',async()=>{const f=await successionFixture();change(f);await assert.rejects(f.run());});});
test('production successor bridge rejects tampered archive bytes and stale bridge references',async t=>{await t.test('archive',async()=>{const f=await successionFixture(),archive=f.manifest.mappings[0].archive;f.raw.set(archive.path,{ref:archive,bytes:Buffer.from('tampered')});await assert.rejects(f.run());});await t.test('stale bridge',async()=>{const f=await successionFixture(),stale=f.seal();f.bridge.kind='stale';f.seal();await assert.rejects(()=>f.A.verifyV5SuccessorBridge(stale,f.deps));});});
test('production successor bridge rejects unauthorized historical mapping and changed prepared progress',async t=>{for(const guard of ['mapping','progress'])await t.test(guard,async()=>{const f=await successionFixture(),auth=f.deps.authenticate;f.deps.authenticate=async ref=>{const bytes=await auth(ref);if(guard==='mapping'&&ref.path===f.A.archiveManifestPin.path){const value=JSON.parse(bytes);value.mappings[0].archive.path='unauthorized-copy';return Buffer.from(JSON.stringify(value));}if(guard==='progress'&&ref.path===f.bridge.progressArchive.path){const value=JSON.parse(bytes);value.pending.completedApply=false;return Buffer.from(JSON.stringify(value));}return bytes;};await assert.rejects(f.run());});});

test('production recovery rejects execution authority drift during receipt creation',async()=>{const f=await recoveryFixture();f.authorityDriftAfterReceipt=true;await assert.rejects(f.run(),/authority changed before commit/);assert.deepEqual(f.progress,f.original);});
test('production recovery rejects incomplete or write-bearing interrupted native receipts',async t=>{for(const change of [audit=>audit.receipts.pop(),audit=>{for(const item of audit.receipts.slice(0,3))item.method='config/batchWrite';}])await t.test('receipt guard',async()=>{const f=await recoveryFixture();f.interrupt='audit';await assert.rejects(f.run());const [file,value]=[...f.store.entries()].find(([p])=>p.includes('target-0-audit-recovery')),audit=JSON.parse(value.bytes);change(audit);value.bytes=Buffer.from(JSON.stringify(audit));value.ref={path:file,bytes:value.bytes.length,sha256:createHash('sha256').update(value.bytes).digest('hex')};await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);});});
test('production native session rejects all write RPCs before dispatch and closes the client',async t=>{const M=await import('./rollout004-context-performance.mjs');for(const method of ['config/batchWrite','hooks/approve','sync/enroll'])await t.test(method,async()=>{let dispatched=0,closed=0;await assert.rejects(()=>M.nativeSession([],rpc=>rpc(method,{}),null,{readOnly:true,connect:async()=>({rpc:async()=>{dispatched++;},close:async()=>{closed++;}}),approval:async({rpc})=>({rpc}),hash:async()=>'a'.repeat(64)}),/read-only/);assert.equal(dispatched,0);assert.equal(closed,1);});});
test('production native session fails if raw user config changes across scoped hooks read',async()=>{const M=await import('./rollout004-context-performance.mjs');let reads=0,closed=false;await assert.rejects(()=>M.nativeSession([],rpc=>rpc('hooks/list',{cwds:[targets[0]]}),null,{readOnly:true,connect:async()=>({rpc:async()=>({data:[]}),close:async()=>{closed=true;}}),approval:async({rpc})=>({rpc}),hash:async()=> (++reads===1?'a':'b').repeat(64)}));assert(closed);});

test('production interrupted audit authenticates exact scoped read-only native receipts',async t=>{
 const cases={
  requestedRoot:(audit,A)=>audit.receipts[3].cwds=[A.targets[4]],
  responseRoot:(audit,A)=>audit.receipts[4].discoveryScopes[0].cwd=A.targets[4],
  extraRoot:(audit,A)=>audit.receipts[4].discoveryScopes.push({cwd:A.targets[4],errors:[]}),
  discoveryError:audit=>audit.receipts[4].discoveryScopes[0].errors=['fixture error'],
  unstableList:audit=>audit.receipts[5].readStable=false,
  changedListBoundary:audit=>audit.receipts[5].afterSha256='d'.repeat(64),
  unstableConfig:audit=>audit.receipts[2].readStable=false,
  changedConfigBoundary:audit=>audit.receipts[2].afterSha256='d'.repeat(64),
  unapprovedRpc:audit=>{for(const receipt of audit.receipts.slice(3))receipt.method='hooks/approve';},
  definitionRoot:(audit,A)=>audit.receipts[4].definitions[0].sourcePath=path.join(A.targets[4],'.codex/hooks.json'),
  untrustedDefinition:audit=>audit.receipts[4].definitions[0].trustStatus='untrusted',
  duplicateDefinition:audit=>audit.receipts[4].definitions[1]=structuredClone(audit.receipts[4].definitions[0]),
  mixedDefinitions:audit=>audit.receipts[4].definitions[0].currentHash='sha256:'+'d'.repeat(64)
 };
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async()=>{
  const f=await recoveryFixture();f.interrupt='audit';await assert.rejects(f.run(),/interrupted after audit receipt/);assert.deepEqual(f.progress,f.original);
  const [savedPath,saved]=[...f.store].find(([file])=>file.includes('target-0-audit-recovery'));
  const audit=JSON.parse(saved.bytes);mutate(audit,f.A);const bytes=Buffer.from(JSON.stringify(audit));f.store.set(savedPath,{ref:{path:savedPath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},bytes});
  await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);assert(f.calls.every(c=>['config/read','hooks/list'].includes(c.method)));
 });
});

test('completed readSet uses canonical kind and fingerprint, including directories',async()=>{
 const {completedSyncInput,assertCompletedReadSet}=await import('./rollout004-context-performance.mjs'),F=await import('node:fs/promises'),os=await import('node:os'),root=await F.mkdtemp(path.join(os.tmpdir(),'rollout004-readset-'));
 try{await F.mkdir(path.join(root,'unchanged-directory'));await F.writeFile(path.join(root,'file'),'original');const rows=await Promise.all(['unchanged-directory','file','absent'].map(async p=>({path:p,...await completedSyncInput(path.join(root,p))}))),review={operations:[],readSet:rows};await assertCompletedReadSet(root,review);
 await F.writeFile(path.join(root,'file'),'changed');await assert.rejects(assertCompletedReadSet(root,review));await F.writeFile(path.join(root,'file'),'original');await F.writeFile(path.join(root,'absent'),'appeared');await assert.rejects(assertCompletedReadSet(root,review));await F.unlink(path.join(root,'absent'));
 await F.mkdir(path.join(root,'replacement'));await assert.rejects(assertCompletedReadSet(root,{operations:[],readSet:[{...rows[0],path:'replacement'}]}));await F.writeFile(path.join(root,'type-change'),'type changed');await assert.rejects(assertCompletedReadSet(root,{operations:[],readSet:[{...rows[0],path:'type-change'}]}));await F.symlink(path.join(root,'unchanged-directory'),path.join(root,'substitution'),'junction');await assert.rejects(assertCompletedReadSet(root,{operations:[],readSet:[{...rows[0],path:'substitution'}]}));
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'rollout004-readset-'));await F.rm(root,{recursive:true,force:true});}
});
test('V8 pinned completed receipt reuses V7 intent and never plans or syncs again',async()=>{
 const f=await policyOnlyFixture();f.interrupt='commit';await assert.rejects(f.run());const intent=[...f.store.values()].find(x=>x.ref.path.includes('policy-only-intent')).ref,apply=f.store.get(f.A.directory+'/target-1-apply.json').ref,plan=JSON.parse(f.store.get(intent.path).bytes).plan,oldExecution=structuredClone(f.execution),failure=f.store.get('failure').ref;
 f.verified.completedReceipt={intent,apply,plan,failedProgress:f.verified.capsule.refs.failedProgress,failure};f.verified.completedReceiptAuthority=oldExecution;f.verified.completedReceiptFailureCapsule=f.verified.bridge.failureCapsule;
 f.current.successorBridge={path:'new-v8-bridge',bytes:1,sha256:f.bridgeHash};f.execution.successorBridge=f.current.successorBridge;const bytes=Buffer.from(JSON.stringify(f.current)),ref={path:'new-v8-execution',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};f.store.set(ref.path,{bytes,ref});f.execution.executionAuthority=ref;f.interrupt=null;const syncs=f.syncs,plans=f.plans,result=await f.run();assert.equal(f.syncs,syncs);assert.equal(f.plans,plans);assert.deepEqual(result.intent,intent);assert.deepEqual(result.apply,apply);assert.equal(f.progress.targets[1].status,'audited');const audit=JSON.parse(f.store.get(result.audit.path).bytes);assert.deepEqual(audit.executionAuthority,ref);assert(audit.completedReceiptRecovery);
});
test('V8 receipt-only recovery rejects a substituted pin before progress or another sync',async()=>{
 const f=await policyOnlyFixture();f.verified.completedReceipt={intent:{path:'wrong-intent',bytes:1,sha256:'f'.repeat(64)},apply:{path:'wrong-apply'},plan:{path:'wrong-plan'},failure:f.store.get('failure').ref,failedProgress:f.verified.capsule.refs.failedProgress};await assert.rejects(f.run());assert.deepEqual(f.progress,f.original);assert.equal(f.syncs,0);assert.equal(f.plans,0);
});

async function v8CompletedReceiptFixture(){
 const f=await policyOnlyFixture();f.interrupt='commit';await assert.rejects(f.run());
 const intent=[...f.store.values()].find(x=>x.ref.path.includes('policy-only-intent')).ref,apply=f.store.get(f.A.directory+'/target-1-apply.json').ref,plan=JSON.parse(f.store.get(intent.path).bytes).plan;
 f.verified.completedReceipt={intent,apply,plan,failedProgress:f.verified.capsule.refs.failedProgress,failure:f.store.get('failure').ref};
 f.verified.completedReceiptAuthority=structuredClone(f.execution);f.verified.completedReceiptFailureCapsule=f.verified.bridge.failureCapsule;
 f.current.successorBridge={path:'new-v8-bridge',bytes:1,sha256:f.bridgeHash};f.execution.successorBridge=f.current.successorBridge;
 const bytes=Buffer.from(JSON.stringify(f.current)),ref={path:'new-v8-execution',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 f.store.set(ref.path,{bytes,ref});f.execution.executionAuthority=ref;f.interrupt=null;return f;
}
for(const stage of ['interrupted-audit','audited'])for(const substitution of ['missing','substituted'])test('V8 recovery rejects '+substitution+' completion link in '+stage,async()=>{
 const f=await v8CompletedReceiptFixture();
 if(stage==='interrupted-audit'){f.interrupt='audit';await assert.rejects(f.run(),/interrupted after audit/);}else await f.run();
 const entry=[...f.store.values()].find(x=>x.ref.path.includes('target-1-audit')),audit=JSON.parse(entry.bytes);
 if(substitution==='missing')delete audit.completedReceiptRecovery;else audit.completedReceiptRecovery={...audit.completedReceiptRecovery,sha256:'0'.repeat(64)};
 const bytes=Buffer.from(JSON.stringify(audit)),ref={...entry.ref,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 f.store.set(ref.path,{bytes,ref});
 if(stage==='audited'){f.progress.targets[1].audits[0]=ref;f.progress.artifacts=f.progress.artifacts.map(r=>r.path===ref.path?ref:r);}
 const before=structuredClone(f.progress),syncs=f.syncs,plans=f.plans;f.interrupt=null;
 await assert.rejects(f.run());assert.deepEqual(f.progress,before);assert.equal(f.syncs,syncs);assert.equal(f.plans,plans);
});
test('Retained V8 report execution requires exact authenticated predecessor bindings',async()=>{
 const A=await import('./rollout004-context-performance-authority.mjs'),{verifyExecution}=await import('./verify-rollout004-context-performance.mjs');
 const executionAuthority=A.v8PredecessorPins.executionAuthority,successorBridge=A.v8PredecessorPins.successorBridge,v8Execution={version:1,successorBridge},succession={v8Execution,failedProgress:{targets:[]}},receipt={index:2,executionAuthority,successorBridge};
 const deps={json:async ref=>{assert.deepEqual(ref,executionAuthority);return structuredClone(v8Execution);}};
 await verifyExecution(receipt,{},deps,{},succession,{apply:true});await verifyExecution(receipt,{},deps,{},succession);
 await assert.rejects(verifyExecution({...receipt,successorBridge:{...successorBridge,sha256:'0'.repeat(64)}},{},deps,{},succession),/Retained V8 bridge changed/);
 await assert.rejects(verifyExecution(receipt,{}, {...deps,json:async()=>({...v8Execution,version:2})},{},succession),/Retained V8 authority changed/);
 await assert.rejects(verifyExecution({...receipt,executionAuthority:{...executionAuthority,sha256:'0'.repeat(64)}},{},deps,{},succession));
 await assert.rejects(verifyExecution(receipt,{},deps,{}, {...succession,v8Execution:undefined}));
});
test('V8 report verification authenticates and binds the completed receipt recovery',async()=>{
 const A=await import('./rollout004-context-performance-authority.mjs'),{verifyExecution}=await import('./verify-rollout004-context-performance.mjs');
 const store=new Map(),put=(path,value)=>{const bytes=Buffer.from(JSON.stringify(value)),ref={path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};store.set(path,{bytes,ref});return ref;};
 const current={successorBridge:A.v8PredecessorPins.successorBridge},executionAuthority=A.v8PredecessorPins.executionAuthority,completedReceipt={apply:{path:'v7-apply',bytes:1,sha256:'a'.repeat(64)}};
 const completion={kind:'rollout004-v8-completed-receipt-recovery',originalReceipt:completedReceipt,originalExecution:{executionAuthority:A.v7PredecessorPins.executionAuthority,successorBridge:A.v7PredecessorPins.successorBridge},executionAuthority,successorBridge:current.successorBridge};
 const completedReceiptRecovery=put(A.directory+'/policy-only-completion-v8.json',completion),receipt={index:1,executionAuthority,successorBridge:current.successorBridge,completedReceiptRecovery},succession={completedReceipt,v8Execution:current,failedProgress:{targets:[]}};
 const deps={json:async ref=>{if(ref.path===executionAuthority.path){assert.deepEqual(ref,executionAuthority);return structuredClone(current);}const entry=store.get(ref.path);assert(entry);assert.deepEqual(ref,entry.ref);assert.equal(createHash('sha256').update(entry.bytes).digest('hex'),ref.sha256);return JSON.parse(entry.bytes);}};
 await verifyExecution(receipt,current,deps,{},succession);
 const missing={...receipt};delete missing.completedReceiptRecovery;await assert.rejects(verifyExecution(missing,current,deps,{},succession),/requires its completed receipt/);
 const wrong=put(A.directory+'/policy-only-completion-v8.json',{...completion,originalReceipt:{}});await assert.rejects(verifyExecution({...receipt,completedReceiptRecovery:wrong},current,deps,{},succession),/Completed receipt recovery changed/);
 await verifyExecution({index:1,executionAuthority:{path:A.executionAuthorityPath},successorBridge:current.successorBridge},current,{json:async()=>current},{},succession);
});

import * as TransferAuthority from './rollout004-context-performance-authority.mjs';
test('V9 historical session mapping authenticates only the exact archived prefix',async()=>{
 const A=TransferAuthority,result=await A.verifyLiveSessionPrefixSuccession();assert.deepEqual(result.original,A.liveSessionOriginalPin);assert.equal(result.archive.path,A.directory+'/live-session-original-prefix.jsonl');assert.equal(result.archive.sha256,result.original.sha256);assert.equal(result.archive.bytes,result.original.bytes);
});
test('V9 historical session mapping rejects substituted proof or archived bytes',async()=>{
 const A=TransferAuthority;
 for(const target of [A.liveSessionPrefixPin.path,A.directory+'/live-session-original-prefix.jsonl',A.directory+'/live-session-observed-append.jsonl'])await assert.rejects(A.verifyLiveSessionPrefixSuccession({authenticate:async ref=>{const bytes=Buffer.from(await A.authenticate(ref));if(ref.path===target)bytes[0]^=1;return bytes;}}),/Session prefix bytes changed/);
});
test('V9 historical session mapping does not relax generic authentication',async()=>{
 const A=TransferAuthority;await assert.rejects(A.authenticate({...A.liveSessionOriginalPin,path:A.directory+'/live-session-observed-append.jsonl'}),/Reference changed/);
});
function v8TransferFixture(){
 const A=TransferAuthority,hash=b=>createHash('sha256').update(b).digest('hex'),oldWorker='01a146c2-9743-7fc0-a9df-282602c757c7',newWorker='01a146d0-dcbb-7050-aebd-864485ae7f3b',id='handoff-20261016222012023-3de5c7c2',prior={id:'sealed',type:'worker.resumed',at:'2026-10-16T22:00:00.000Z'},ready={id:'ready',type:'handoff.ready',at:'2026-10-16T22:22:51.624Z',handoffId:id,generation:89},resumed={id:'resumed',type:'worker.resumed',at:'2026-10-16T22:25:49.313Z',handoffId:id,generation:90,drift:[],driftAccepted:false},history=Buffer.from('exact worker transfer archive'),prefix=Buffer.from(JSON.stringify(prior)+'\n'),sealed={eventsPrefix:{bytes:prefix.length,sha256:hash(prefix)},transitions:[{resumed:prior}]},sealedBytes=Buffer.from(JSON.stringify(sealed)),sealedRef={path:A.directory+'/source-continuity-proof-v6.json',bytes:sealedBytes.length,sha256:hash(sealedBytes)},events=Buffer.from([prior,ready,resumed].map(JSON.stringify).join('\n')+'\n'),proof={version:1,kind:'rollout004-v8-worker-transfer-proof',root:A.sourceRoot,predecessor:A.v7PredecessorPins.successorBridge,sealedContinuity:sealedRef,eventsPrefix:{bytes:events.length,sha256:hash(events)},transition:{id,history:{path:'.harness/history/progress/'+id+'.md',bytes:history.length,sha256:hash(history)},from:{id:oldWorker,generation:89},to:{id:newWorker,generation:90},ready,resumed}};
 const f={proof,events,history,newWorker,hash,prior,ready,resumed};f.deps={authenticate:async ref=>{if(ref.path===A.v8WorkerTransferPin.path)return Buffer.from(JSON.stringify(f.proof));if(ref.path===A.v6PredecessorPins.successorBridge.path)return Buffer.from(JSON.stringify({continuityProof:sealedRef}));if(ref.path===A.v7PredecessorPins.successorBridge.path)return Buffer.from(JSON.stringify({worker:'codex:'+oldWorker}));if(ref.path===sealedRef.path)return sealedBytes;if(ref.path===proof.transition.history.path)return f.history;throw new Error('Unexpected transfer ref');},readEvents:async()=>f.events};f.verify=()=>A.verifyV8WorkerTransfer(A.v8WorkerTransferPin,'codex:'+newWorker,f.deps);return f;
}
test('V8 worker transfer accepts the exact gen89 to gen90 archive and event prefix',async()=>{const f=v8TransferFixture();assert.deepEqual(await f.verify(),f.proof);});
test('V8 worker transfer rejects a substituted proof or changed archive',async()=>{const f=v8TransferFixture();await assert.rejects(TransferAuthority.verifyV8WorkerTransfer({...TransferAuthority.v8WorkerTransferPin,sha256:'0'.repeat(64)},'codex:'+f.newWorker,f.deps),/pin changed/);f.history=Buffer.from('changed transfer archive');await assert.rejects(f.verify());});
test('V8 worker transfer rejects event prefix changes and repeated transfer events',async()=>{const f=v8TransferFixture();f.events=Buffer.from(f.events);f.events[0]^=1;await assert.rejects(f.verify(),/prefix changed/);const g=v8TransferFixture();g.events=Buffer.from([g.prior,g.ready,g.resumed,g.resumed].map(JSON.stringify).join('\n')+'\n');g.proof.eventsPrefix={bytes:g.events.length,sha256:g.hash(g.events)};await assert.rejects(g.verify(),/events changed or repeated/);});

async function v9RecoveryFixture(){
 const A=TransferAuthority,proof=JSON.parse(await A.authenticate(A.v9WorkerRecoveryPin)),events=await readFile(A.absolute('.harness/events.jsonl'));
 const f={proof,events,archiveOverride:null};
 f.deps={authenticate:async ref=>ref.path===A.v9WorkerRecoveryPin.path?Buffer.from(JSON.stringify(f.proof)):f.archiveOverride&&ref.path===proof.transitions[0].history.path?f.archiveOverride:A.authenticate(ref),readEvents:async()=>f.events};
 f.verify=(owner=proof.terminal.id)=>A.verifyV9WorkerRecovery(A.v9WorkerRecoveryPin,'codex:'+owner,f.deps);return f;
}
test('V9 recovery authenticates the recovered old owner and every recorded worker transfer',async()=>{
 const f=await v9RecoveryFixture();assert.deepEqual(await f.verify(),f.proof);assert.deepEqual(f.proof.transitions.map(t=>t.to.generation),Array.from({length:f.proof.terminal.generation-90},(_,i)=>91+i));assert.equal(f.proof.recovery.from.generation,f.proof.recovery.to.generation);
});
test('V9 recovery rejects substituted proof refs, unknown fields, reordered or omitted transitions',async()=>{
 const f=await v9RecoveryFixture();await assert.rejects(TransferAuthority.verifyV9WorkerRecovery({...TransferAuthority.v9WorkerRecoveryPin,sha256:'0'.repeat(64)},'codex:'+f.proof.terminal.id,f.deps),/pin changed/);
 f.proof.extra=true;await assert.rejects(f.verify(),/unexpected keys/);delete f.proof.extra;f.proof.recovery.recovered.extra=true;await assert.rejects(f.verify(),/unexpected keys/);delete f.proof.recovery.recovered.extra;
 [f.proof.transitions[0],f.proof.transitions[1]]=[f.proof.transitions[1],f.proof.transitions[0]];await assert.rejects(f.verify());f.proof.transitions.pop();await assert.rejects(f.verify());
});
test('V9 recovery rejects a forged recovery owner, terminal worker, generation or transfer archive',async()=>{
 const f=await v9RecoveryFixture();await assert.rejects(f.verify('different-worker'),/terminal worker changed/);f.proof.recovery.recovered.formerOwner.id='different-worker';await assert.rejects(f.verify());
 const g=await v9RecoveryFixture();g.proof.transitions[1].to.generation++;await assert.rejects(g.verify());const h=await v9RecoveryFixture();h.archiveOverride=Buffer.from('changed archive');await assert.rejects(h.verify());
});
test('V9 recovery rejects changed event prefixes, repeated ownership events and accepted drift',async()=>{
 const f=await v9RecoveryFixture();f.events=Buffer.from(f.events);f.events[0]^=1;await assert.rejects(f.verify(),/prefix changed/);
 const g=await v9RecoveryFixture();g.proof.transitions[0].resumed.drift=['drift'];await assert.rejects(g.verify());
 const h=await v9RecoveryFixture();h.events=Buffer.concat([h.events.subarray(0,h.proof.eventsPrefix.bytes),Buffer.from(JSON.stringify(h.proof.recovery.claimed)+'\n')]);h.proof.eventsPrefix={bytes:h.events.length,sha256:h.proof.eventsPrefix.sha256};h.proof.eventsPrefix.sha256=h.events.length?TransferAuthority.sha(h.events):'';await assert.rejects(h.verify(),/events changed, repeated or unreviewed/);
});
test('V9 successor preserves exact V8 pins, archived helpers, historical prepared authority and receipt bindings',async()=>{
 const A=TransferAuthority,old=JSON.parse(await A.authenticate(A.v8PredecessorPins.successorBridge)),proof=JSON.parse(await A.authenticate(A.v9WorkerRecoveryPin)),candidate={version:1,kind:'rollout004-v8-v9-recovery-succession',worker:'codex:'+proof.terminal.id,predecessor:structuredClone(A.v8PredecessorPins),archiveManifest:A.v8ArchiveManifestPin,prepared:old.prepared,progressArchive:old.progressArchive,helpers:await Promise.all(A.helpers.map(A.reference)),currentHelpers:old.currentHelpers,completedReceipt:old.completedReceipt,failureCapsule:old.failureCapsule,workerRecovery:A.v9WorkerRecoveryPin,nativePreservation:A.nativePreservationPin};
 const deps={authenticate:async ref=>ref.path===A.successorBridgePath?Buffer.from(JSON.stringify(candidate)):A.authenticate(ref)},result=await A.verifySuccessorBridge({path:A.successorBridgePath},deps);
 assert.deepEqual(result.completedReceipt,old.completedReceipt);assert.deepEqual(result.completedReceiptAuthority,{executionAuthority:A.v7PredecessorPins.executionAuthority,successorBridge:A.v7PredecessorPins.successorBridge});assert.deepEqual(result.bridge.prepared,old.prepared);assert.deepEqual(result.continuity.workerRecovery.terminal,proof.terminal);
 candidate.predecessor.executionAuthority={...candidate.predecessor.executionAuthority,sha256:'0'.repeat(64)};await assert.rejects(A.verifySuccessorBridge({path:A.successorBridgePath},deps));
});
test('V8 worker transfer rejects foreign actors, generations, and accepted drift',async()=>{for(const change of [f=>f.proof.transition.from.id='foreign',f=>f.proof.transition.to.generation=91,f=>f.proof.transition.resumed.driftAccepted=true]){const f=v8TransferFixture();change(f);await assert.rejects(f.verify());}});
test('SOURCE execution guard rejects parked, retired, stale and different actors before writes',async t=>{
 const A=TransferAuthority,M=await import('./rollout004-context-performance.mjs'),terminal={id:'reviewed-worker',generation:94};
 const cases={parked:s=>s.phase='awaiting_resume',pending:s=>s.handoffId='unreviewed-transfer',retired:s=>s.owner.id='other-worker',stale:s=>s.generation++,ownerGeneration:s=>s.owner.generation++,differentActor:()=>{}};
 const dir=await mkdtemp(path.join(tmpdir(),'source-owner-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const [name,change] of Object.entries(cases))await t.test(name,async()=>{
  const state={phase:'working',generation:94,handoffId:null,owner:{id:terminal.id,generation:94}};change(state);
  const guard=()=>A.assertSourceExecutionOwner({worker:()=>name==='differentActor'?'foreign-worker':terminal.id,verifyRecovery:async()=>({terminal}),session:async()=>state});
  await assert.rejects(guard());await assert.rejects(A.exclusive('unused',{}, {guard}));await assert.rejects(A.atomicCAS(path.join(dir,'absent'),'0'.repeat(64),Buffer.from('x'),{guard}));await assert.rejects(M.save({}, {guard}));
  let targetChecks=0;await assert.rejects(M.continueApply(1,{}, {assertSourceExecutionOwner:guard,assertOwner:async()=>{targetChecks++;}}));assert.equal(targetChecks,0);
 });
 assert.deepEqual(await A.assertSourceExecutionOwner({worker:()=>terminal.id,verifyRecovery:async()=>({terminal}),session:async()=>({phase:'working',generation:94,handoffId:null,owner:{id:terminal.id,generation:94}})}),{id:terminal.id,generation:94,phase:'working',handoffId:null});
});
test('production native write checks SOURCE execution ownership immediately before dispatch',async()=>{
 const M=await import('./rollout004-context-performance.mjs'),file=path.join(process.env.USERPROFILE,'.codex/config.toml'),methods=[];let closed=0,guards=0;
 await assert.rejects(M.nativeSession([],async rpc=>{await rpc('config/read',{includeLayers:true});await rpc('config/batchWrite',{filePath:file,expectedVersion:'fixture',reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:{}}]});},null,{connect:async()=>({rpc:async method=>{methods.push(method);return {layers:[{name:{type:'user',file},version:'fixture',config:{hooks:{state:{}}}}]};},close:async()=>{closed++;}}),approval:async({rpc})=>({rpc}),hash:async()=>'a'.repeat(64),sourceGuard:async()=>{guards++;throw Error('SOURCE owner changed');}}));
 assert.deepEqual(methods,['config/read']);assert.equal(guards,1);assert.equal(closed,1);
});
test('SOURCE preservation admits only the separately verified V8 transfer history',async()=>{const A=TransferAuthority,f=v8TransferFixture(),workerTransfer=await f.verify(),before={root:A.sourceRoot,histories:{}},histories=Object.fromEntries([...A.continuityHistoryPins,workerTransfer.transition.history].map(p=>[p.path,p.sha256]));let adjusted;const deps={verifyContinuity:async()=>({before,proof:{transitions:A.continuityHistoryPins.map(history=>({history}))},workerTransfer}),preservation:async()=>({histories}),assertPreserved:async b=>{adjusted=b;return true;}};assert.equal(await A.assertProductionPreserved(before,{},deps),true);assert.deepEqual(adjusted.histories,histories);histories['.harness/history/progress/unreviewed.md']='0'.repeat(64);await assert.rejects(A.assertProductionPreserved(before,{},deps),/Unreviewed SOURCE history delta/);});
