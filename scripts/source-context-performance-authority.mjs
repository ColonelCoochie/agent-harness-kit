import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const featureId = 'context-performance-001';
export const directory = `.harness/${featureId}`;
export const transitionPath = `${directory}/source-transition.json`;
export const gatePath = `${directory}/source-gate.json`;
export const reviewPath = `${directory}/source-authority-review.json`;
export const invocationPath = `${directory}/source-gate-invocation.json`;
export const predecessorPin = {path:`${directory}/predecessor.json`,bytes:647841,sha256:'572749329518e49192d1334c3b323ed2d425a1010271569de9f5e16efd4667ff'};
export const predecessorDigest = 'c2a5be3544cb1b7da9444c589f05b6e9dfe22103349e25e1ae223a2eb9278877';
export const oldGatePin = {path:'.harness/windows-command-containment-001/source-gate.json',bytes:10574,sha256:'db161bc9d7e3658d828368195954cdb21d82130a11e58e4bf9dc0783d0329693'};
export const contractPin = 'af7f15e817b600f64c5534368d50e74a700822831693135da82f216b6a12dc71';
export const helperPaths = ['scripts/source-context-performance-authority.mjs','scripts/verify-source-context-performance.mjs','scripts/prepare-context-performance-source.mjs','scripts/context-performance-source-gate.mjs','scripts/host-context-performance-probe.mjs'];
export const futureHelperPaths = ['scripts/live004-context-performance-e2e.mjs','scripts/verify-live004-context-performance-e2e.mjs','scripts/live004-context-performance-gate.mjs','scripts/live004-context-performance-gate.test.mjs','scripts/rollout004-context-performance-authority.mjs','scripts/rollout004-context-performance.mjs','scripts/verify-rollout004-context-performance.mjs','scripts/rollout004-context-performance-isolated.mjs','scripts/rollout004-context-performance-gate.mjs','scripts/verify-rollout004-context-performance-supersession.mjs','scripts/rollout004-context-performance-gate.test.mjs','scripts/rollout004-context-performance-isolated.test.mjs'];
const deny = ['.git/**','.env','.env.*','**/node_modules/**','**/dist/**','**/build/**'];
export const futureShapes = {
  'native-hook-v2-live-004': {id:'native-hook-v2-live-004',title:'Fresh context performance native lifecycle proof',description:'Authenticate the sealed context performance SOURCE and genuine complete native lifecycle in a fresh exclusive selected report.',dependencies:[featureId],scope:{allow:['scripts/*context-performance*','.harness/**'],deny},acceptance:[{id:'ac-1',description:'Fresh selected native lifecycle report authenticates the sealed context performance SOURCE gate and all native lifecycle assertions.',command:'node scripts/verify-live004-context-performance-e2e.mjs --report .harness/native-hook-v2-live-004-e2e-report.json'}],requiredLayers:['full','architecture','quick']},
  'native-hook-v2-rollout-004': {id:'native-hook-v2-rollout-004',title:'Guarded context performance rollout of all eleven managed roots',description:'Deploy the authenticated context performance SOURCE runtime to all eleven exact roots and preserve historical contracts and evidence with fresh isolated three-phase behavior.',dependencies:['native-hook-v2-live-004'],scope:{allow:['scripts/*context-performance*','.harness/**','skill/codex-harness/**'],deny},acceptance:[{id:'ac-1',description:'Fresh production evidence authenticates all eleven complete installed runtimes with preserved history and canonical definition trust and isolated three-phase proof.',command:'node scripts/verify-rollout004-context-performance.mjs --report .harness/native-hook-v2-rollout-004-report.json'},{id:'ac-2',description:'Supersession evidence authenticates historical rollout contracts and predecessor failure roles against the fresh production proof.',command:'node scripts/verify-rollout004-context-performance-supersession.mjs --report .harness/native-hook-v2-rollout-004-report.json'}],requiredLayers:['full','architecture','quick']}
};
export const sha = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
export const digest = value => sha(stable(value));
export function file(relative) {
  assert(typeof relative==='string' && relative && !/[\\\0:]/.test(relative) && !path.isAbsolute(relative));
  assert(relative.split('/').every(part=>part && part!=='.' && part!=='..'));
  return path.join(root,...relative.split('/'));
}
async function referenceBytes(relative) {
  let cursor=root;
  for(const part of relative.split('/')) {cursor=path.join(cursor,part);const info=await lstat(cursor);assert(!info.isSymbolicLink(),`Symlink: ${relative}`);}
  assert((await lstat(file(relative))).isFile());return readFile(file(relative));
}
export async function reference(relative) {const bytes=await referenceBytes(relative);return {path:relative,bytes:bytes.length,sha256:sha(bytes)};}
export async function authenticate(ref) {
  assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);assert(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);assert(/^[a-f0-9]{64}$/.test(ref.sha256));
  const bytes=await referenceBytes(ref.path);assert.deepEqual({path:ref.path,bytes:bytes.length,sha256:sha(bytes)},ref,`Authority changed: ${ref.path}`);return bytes;
}
export const json = async relative => JSON.parse(await readFile(file(relative),'utf8'));
export async function exclusive(relative,value) {await mkdir(path.dirname(file(relative)),{recursive:true});await writeFile(file(relative),`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});return reference(relative);}
async function walk(relative,files) {
  const info=await lstat(file(relative));assert(!info.isSymbolicLink());
  if(info.isDirectory()) for(const name of (await readdir(file(relative))).sort()) await walk(`${relative}/${name}`,files);
  else {assert(info.isFile());files[relative]=await reference(relative);}
}
export async function sourceSnapshot() {const files={};for(const relative of ['package.json','bin','skill/codex-harness','tests']) await walk(relative,files);return Object.fromEntries(Object.entries(files).map(([name,ref])=>[name,ref.sha256]));}
// This closed membership includes all test imports, authority helpers, generated
// execution adapters and the configuration/instruction inputs consumed by audit.
// Only explicitly enumerated mutable control-plane outputs are outside it.
export async function closedInputs() {
  const files={};
  for(const relative of ['package.json','bin','skill/codex-harness','tests','scripts','.github','.codex','.claude','.harness/loops','.harness/hooks']) await walk(relative,files);
  for(const relative of ['AGENTS.md','README.md','CLAUDE.md','CONTRIBUTING.md','SECURITY.md','ANALYSIS.md','CHANGELOG.md','REVIEW-2026-07-20.md','.harness/config.json','.harness/managed-files.json','.harness/docs-map.md','.harness/quality.md','.harness/repair-source.json','.harness/run.mjs','.harness/context-budget.mjs','.harness/repair.mjs','.harness/windows-command.mjs','.harness/windows-command-supervisor.ps1']) files[relative]=await reference(relative);
  for(const relative of ['.harness/AGENTS.addition.md','.harness/CLAUDE.addition.md','.harness/copilot-instructions.addition.md','.harness/codex-hooks.addition.json','.harness/claude-hooks.addition.json','.harness/docs-map.v6.addition.md']) {
    try {files[relative]=await reference(relative);} catch(error) {if(error.code!=='ENOENT') throw error;files[relative]={path:relative,absent:true};}
  }
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export async function nodeIdentity() {
  const executable=await realpath(process.execPath);const bytes=await readFile(executable);
  const extensions=process.platform==='win32' ? (process.env.PATHEXT??'.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const cwdCandidates=process.platform==='win32' ? assertNoNodeShadow(await readdir(root),extensions) : [];
  let resolved;
  for(const directory of (process.env.PATH??process.env.Path??'').split(path.delimiter)) {
    for(const extension of extensions) {
      const candidate=path.join(directory,`node${extension.toLowerCase()}`);
      try {if((await lstat(candidate)).isFile()) {resolved=await realpath(candidate);break;}} catch(error) {if(error.code!=='ENOENT'&&error.code!=='ENOTDIR') throw error;}
    }
    if(resolved) break;
  }
  assert(resolved,'PATH node is unavailable');assert.equal(process.platform==='win32'?resolved.toLowerCase():resolved,process.platform==='win32'?executable.toLowerCase():executable,'PATH node differs from gate executable');
  return {version:process.version,platform:process.platform,arch:process.arch,executable,executableBytes:bytes.length,executableSha256:sha(bytes),pathExecutable:resolved,commandExtensions:extensions,cwdCandidates:cwdCandidates.map(name=>({name,absent:true}))};
}
export function assertNoNodeShadow(names,extensions) {
  const candidates=[...new Set(['node',...extensions.map(extension=>`node${extension.toLowerCase()}`)])].sort();
  for(const candidate of candidates) assert(!names.some(name=>name.toLowerCase()===candidate),`Cwd shadows gate Node: ${candidate}`);
  return candidates;
}
export function normalizedContract(feature) {return {id:feature.id,title:feature.title,description:feature.description,dependencies:feature.dependencies,scope:feature.scope,acceptance:feature.acceptance,requiredLayers:feature.requiredLayers??['full'],...(Object.hasOwn(feature,'verificationBudget')?{verificationBudget:feature.verificationBudget}:{})};}
export function historicalLeaves(features) {
  const names=new Set();
  const visit=value=>{if(typeof value==='string' && /^\.harness\/(?:blobs|evidence)\/[^\0]+$/.test(value)) names.add(value);else if(Array.isArray(value)) value.forEach(visit);else if(value&&typeof value==='object') Object.values(value).forEach(visit);};
  features.forEach(visit);return [...names].sort();
}
export async function authenticatePredecessor() {
  const predecessor=JSON.parse(await authenticate(predecessorPin));assert.equal(predecessor.sourceDigest,predecessorDigest);assert.equal(digest(predecessor.source),predecessorDigest);assert.equal(Object.keys(predecessor.source).length,68);
  const records=new Map();
  for(const record of predecessor.records) {assert(!records.has(record.path));records.set(record.path,record);await authenticate({path:record.archive,bytes:record.bytes,sha256:record.sha256});}
  const stateRef=records.get('.harness/features.json');assert(stateRef);const history=JSON.parse(await readFile(file(stateRef.archive),'utf8'));
  const oldGate=records.get(oldGatePin.path);assert.deepEqual({path:oldGate.path,bytes:oldGate.bytes,sha256:oldGate.sha256},oldGatePin);await authenticate(oldGatePin);
  for(const name of historicalLeaves(history.features)) {const record=records.get(name);assert(record,`Unarchived historical leaf ${name}`);await authenticate({path:name,bytes:record.bytes,sha256:record.sha256});}
  return {predecessor,history};
}
export function assertClosure(actual,expected,{grant=[],reviewed=[]}={}) {
  const additions=Object.keys(actual).filter(name=>!Object.hasOwn(expected,name));
  assert(additions.every(name=>grant.includes(name)),`Unreviewed input addition: ${additions.join(', ')}`);
  assert.deepEqual(additions.sort(),reviewed.map(ref=>ref.path).sort(),'Every granted addition must be frozen');
  for(const [name,ref] of Object.entries(expected)) assert.deepEqual(actual[name],ref,`Gate input changed: ${name}`);
  for(const ref of reviewed) assert.deepEqual(actual[ref.path],ref);
}
export async function verifyCandidate({allowSuccessors=false,helperFreeze=null}={}) {
  const transition=await json(transitionPath);assert.equal(transition.version,1);assert.equal(transition.featureId,featureId);assert.deepEqual(transition.predecessor,predecessorPin);
  const {predecessor,history}=await authenticatePredecessor();
  const state=await json('.harness/features.json');
  for(const old of history.features) {
    const current=state.features.find(item=>item.id===old.id);assert(current,`Historical feature missing: ${old.id}`);const preserved={...current};
    if(old.id==='native-hook-v2-live-003') {assert.deepEqual({status:current.status,blocker:current.blocker,updatedAt:current.updatedAt},transition.authorizedHistoricalBlock);for(const name of ['status','blocker','updatedAt']) preserved[name]=old[name];}
    assert.deepEqual(preserved,old,`Historical feature changed: ${old.id}`);
  }
  const feature=state.features.find(item=>item.id===featureId);assert(feature);assert.equal(feature.contract?.version,2);assert.equal(feature.contract.hash,contractPin);
  assert.deepEqual(normalizedContract(feature),transition.frozenContract.shape);assert.deepEqual(feature.contract.snapshot,transition.frozenContract.shape);
  assert.equal(digest({contract:transition.frozenContract.shape,scopeBaselineHash:feature.contract.scopeBaselineHash}),contractPin);
  assert.deepEqual(feature.scopeBaselineRef,transition.frozenContract.baseline);
  const baseline=JSON.parse(await authenticate({path:feature.scopeBaselineRef.path,bytes:feature.scopeBaselineRef.bytes,sha256:feature.scopeBaselineRef.sha256}));
  const baselineValue={version:baseline.version,head:baseline.head,tree:baseline.tree,branch:baseline.branch,files:baseline.files,worktreeHash:baseline.worktreeHash,...(Object.hasOwn(baseline,'capturePolicy')?{capturePolicy:baseline.capturePolicy}:{})};
  assert.equal(digest(baselineValue),feature.contract.scopeBaselineHash);assert.equal(baseline.baselineHash,feature.contract.scopeBaselineHash);
  const source=await sourceSnapshot();assert.equal(digest(source),transition.sourceDigest);assert.deepEqual(source,transition.source);
  const changed=[...new Set([...Object.keys(predecessor.source),...Object.keys(source)])].filter(name=>predecessor.source[name]!==source[name]).sort();assert.deepEqual(changed,transition.changedPaths);
  assert.deepEqual(transition.reviewedDelta,changed.map(name=>({path:name,before:predecessor.source[name]??null,after:source[name]??null})));
  const grant=JSON.parse(await authenticate(transition.futureGrant));assert.deepEqual(grant.contracts,Object.fromEntries(Object.entries(futureShapes).map(([id,shape])=>[id,{shape,sha256:digest(shape)}])));assert.deepEqual(grant.helperCreation,futureHelperPaths);assert.deepEqual(grant.predecessor,predecessorPin);
  const normalization=JSON.parse(await authenticate(grant.normalizationProof));assert.equal(normalization.kind,'actual-ordinary-cli-contract-normalization');assert.equal(normalization.exitCode,0);assert.deepEqual(normalization.shapes,futureShapes);
  const allowedIds=new Set([...history.features.map(item=>item.id),featureId,...(allowSuccessors?Object.keys(futureShapes):[])]);
  assert(state.features.every(item=>allowedIds.has(item.id)),'Undeclared feature added');
  for(const [id,shape] of Object.entries(futureShapes)) {const future=state.features.find(item=>item.id===id);if(future) {assert(allowSuccessors);assert.deepEqual(normalizedContract(future),shape);if(future.contract) {assert.equal(future.contract.version,2);assert.deepEqual(future.contract.snapshot,shape);assert.equal(future.contract.hash,digest({contract:shape,scopeBaselineHash:future.contract.scopeBaselineHash}));}}}
  let additions=[];
  if(helperFreeze) {
    const freeze=JSON.parse(await authenticate(helperFreeze));assert.equal(freeze.kind,'independent-context-performance-successor-helper-freeze');assert.equal(freeze.outcome,'clean');assert.equal(freeze.independentActualCode,true);assert.deepEqual(freeze.findings,[]);assert(freeze.reviewer && freeze.reviewer!==freeze.worker);assert.deepEqual(freeze.sourceGate,await reference(gatePath));
    additions=freeze.helpers;assert(Array.isArray(additions));for(const ref of additions) {assert(futureHelperPaths.includes(ref.path));await authenticate(ref);}
  }
  assertClosure(await closedInputs(),transition.closedInputs,{grant:allowSuccessors?futureHelperPaths:[],reviewed:additions});
  assert.deepEqual(await nodeIdentity(),transition.node);
  const config=JSON.parse(await authenticate(transition.config));assert.equal(config.policies.maxAttempts,5);assert.equal(config.policies.maxRepeatedFailures,2);assert.equal(config.context.worker.maxAgeMs,3600000);assert.equal(config.context.codexCodeModeResultSuppressionConfirmed,true);
  const capability=JSON.parse(await authenticate(transition.hostCapability));assert.equal(capability.pass,true);assert.equal(capability.kind,'actual-native-codex-delivered-result-probe');assert.equal(capability.delta,capability.expected);assert.equal(capability.toolCallsDelta,1);assert(capability.rawChars>config.context.perResultChars);await authenticate(capability.before);await authenticate(capability.log);assert.equal(capability.deliveredRaw,false);
  await authenticate(transition.cleanup);const cleanup=JSON.parse(await authenticate(transition.cleanup));assert.equal(cleanup.status,'blocked-cleaned');assert.equal(cleanup.nativeSuccess,false);
  const age=JSON.parse(await authenticate(transition.agePolicy));assert.equal(age.after,3600000);
  const ageDecision=JSON.parse(await authenticate(transition.agePolicyDecision));assert.equal(ageDecision.decision,'retain-through-source-live004-rollout004');assert.equal(ageDecision.maxAgeMs,3600000);assert.equal(ageDecision.restorationRequiresRenewedConfigProof,true);
  for(const [sourceName,generated] of [['skill/codex-harness/assets/project-runtime.mjs','.harness/run.mjs'],['skill/codex-harness/assets/context-budget.mjs','.harness/context-budget.mjs']]) assert.equal((await reference(sourceName)).sha256,(await reference(generated)).sha256);
  return {version:1,pass:true,featureId,sourceDigest:transition.sourceDigest,inputDigest:digest(transition.closedInputs),node:transition.node,contractHash:contractPin,historicalFeatures:history.features.length,changedPaths:changed,closedInputCount:Object.keys(transition.closedInputs).length,predecessor:predecessorPin,futureGrant:transition.futureGrant,hostCapability:transition.hostCapability};
}
export async function acceptance() {return {version:1,authority:await verifyCandidate(),authorityScripts:await Promise.all(helperPaths.map(reference))};}
export function expectedPlan(config,feature) {
  const layers=[...new Set([...config.completion.alwaysRunWhenConfigured.filter(layer=>config.verification[layer]?.length),...config.completion.baseLayers,...feature.requiredLayers])];
  return {layers,entries:[...layers.flatMap(layer=>config.verification[layer].map(command=>({command:typeof command==='string'?command:command.command,layer,criterionId:null}))),...feature.acceptance.map(item=>({command:item.command,layer:'acceptance',criterionId:item.id}))]};
}
async function gateInputs(options={}) {
  const authority=await verifyCandidate(options),transitionRef=await reference(transitionPath),transition=JSON.parse(await authenticate(transitionRef));
  const state=await json('.harness/features.json'),feature=state.features.find(item=>item.id===featureId);assert.equal(feature.status,'passing');assert(feature.evidence.length);
  const evidenceRef=await reference(feature.evidence.at(-1)),evidence=JSON.parse(await authenticate(evidenceRef));const config=JSON.parse(await authenticate(transition.config)),expected=expectedPlan(config,feature);
  assert.equal(evidence.schemaVersion,5);assert.equal(evidence.harnessVersion,6);assert.equal(evidence.pass,true);assert.equal(evidence.featureId,featureId);assert.equal(evidence.contractHash,contractPin);assert.equal(evidence.configHash,digest(config));assert.deepEqual(evidence.scopeViolations,[]);
  const plan=evidence.verificationPlan;assert.equal(evidence.verificationHash,digest(plan));assert.deepEqual(plan.feature,{id:featureId,contractHash:contractPin});assert.deepEqual(plan.config,{hash:digest(config)});assert.equal(plan.schemaVersion,2);
  assert.deepEqual(evidence.requiredLayers,expected.layers);assert.deepEqual(plan.requiredLayers,expected.layers.map((id,order)=>({id,order})));assert.equal(plan.executions.length,expected.entries.length);assert.equal(evidence.commands.length,expected.entries.length);
  assert.equal(expected.entries.filter(item=>item.command==='node --test tests/harness.test.mjs' && item.layer==='full').length,1,'Exactly one complete suite is required');
  const logs=[];
  for(let order=0;order<expected.entries.length;order++) {
    const entry=expected.entries[order],execution=plan.executions[order],result=evidence.commands[order];assert.equal(execution.order,order);assert.equal(execution.command,entry.command);assert.equal(execution.commandHash,digest(entry.command));assert.equal(execution.commandRedacted,false);assert.deepEqual(execution.credentials,[]);assert.deepEqual(execution.expected,{pass:true,exitCode:0,timedOut:false});assert.equal(execution.layer,entry.layer);assert.equal(execution.criterionId,entry.criterionId);
    assert.equal(result.executionId,execution.id);assert.equal(result.executionOrder,order);assert.equal(result.command,entry.command);assert.equal(result.layer,entry.layer);assert.equal(result.criterionId,entry.criterionId);assert.deepEqual(result.credentials,[]);assert.equal(result.pass,true);assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);assert.equal(result.signal,null);if(process.platform==='win32') assert.equal(result.terminationConfirmed,true);
    for(const stream of ['stdout','stderr']) {assert(result.logs[stream].startsWith('.harness/logs/'));logs.push({executionId:execution.id,stream,reference:await reference(result.logs[stream])});}
  }
  const accepted=JSON.parse((await readFile(file(evidence.commands.at(-1).logs.stdout),'utf8')).trim());assert.deepEqual(accepted.authority,authority);assert.deepEqual(accepted.authorityScripts,await Promise.all(helperPaths.map(reference)));
  const reviewRef=await reference(reviewPath),review=JSON.parse(await authenticate(reviewRef));assert.equal(review.kind,'independent-actual-source-authority-review');assert.equal(review.outcome,'clean');assert.equal(review.independentActualCode,true);assert.deepEqual(review.findings,[]);assert.deepEqual(review.helpers,accepted.authorityScripts);assert.deepEqual(review.transition,transitionRef);assert.equal(review.sourceDigest,authority.sourceDigest);assert(review.reviewer && review.reviewer!==review.worker);assert(Date.parse(review.createdAt)<=Date.parse(evidence.startedAt));
  const invocationRef=await reference(invocationPath),invocation=JSON.parse(await authenticate(invocationRef));assert.equal(invocation.featureId,featureId);assert.deepEqual(invocation.argv,['.harness/run.mjs','verify',featureId]);assert.equal(invocation.cwd,root);assert.equal(invocation.exitCode,0);assert.equal(invocation.signal,null);assert.equal(invocation.timedOut,false);assert.equal(invocation.providerFree,true);assert.deepEqual(invocation.inputsBefore,transition.closedInputs);assert.deepEqual(invocation.inputsAfter,transition.closedInputs);assert.deepEqual(invocation.nodeBefore,transition.node);assert.deepEqual(invocation.nodeAfter,transition.node);assert.deepEqual(invocation.review,reviewRef);assert(Date.parse(invocation.startedAt)<=Date.parse(evidence.startedAt));assert(Date.parse(invocation.finishedAt)>=Date.parse(evidence.finishedAt));
  assert.deepEqual(invocation.launchProfile.allowedNames,[...config.security.environmentAllow,'CODEX_THREAD_ID'].sort());assert.deepEqual(invocation.launchProfile.credentialNames,[]);
  for(const ref of invocation.logs) await authenticate(ref);
  return {authority,transition:transitionRef,evidence:evidenceRef,review:reviewRef,invocation:invocationRef,authorityScripts:accepted.authorityScripts,logs};
}
export async function sealGate() {const inputs=await gateInputs();await exclusive(gatePath,{version:1,kind:'actual-configured-context-performance-source-gate',featureId,contractHash:contractPin,sealedAt:new Date().toISOString(),...inputs});return verifyGate();}
export async function verifyGate(options={}) {
  const gateRef=await reference(gatePath),gate=JSON.parse(await authenticate(gateRef)),inputs=await gateInputs(options);assert.equal(gate.kind,'actual-configured-context-performance-source-gate');assert.equal(gate.featureId,featureId);assert.equal(gate.contractHash,contractPin);for(const [key,value] of Object.entries(inputs)) assert.deepEqual(gate[key],value);
  assert(Date.parse(gate.sealedAt)>=Date.parse((await json(invocationPath)).finishedAt));return {version:1,pass:true,featureId,sourceDigest:inputs.authority.sourceDigest,inputDigest:inputs.authority.inputDigest,contractHash:contractPin,gate:gateRef,evidence:inputs.evidence,transition:inputs.transition,futureGrant:inputs.authority.futureGrant,node:inputs.authority.node};
}
// Explicit adapter for reviewed 004 helpers only. The production API retains its
// installed-byte, path, canonical-definition, policy and CAS/readback checks.
// A supplied RPC is mandatory so inputs outside sourceSnapshot are checked at
// the actual trust-write boundary as well as before and after source validation.
export async function verifiedHookApproval({rpc,helperFreeze}) {
  assert.equal(typeof rpc,'function');assert(helperFreeze,'A reviewed successor helper freeze is required');
  const proof=await verifyGate({allowSuccessors:true,helperFreeze});
  const guarded=guardAuthorityRpc(rpc,async()=>assert.deepEqual(await verifyGate({allowSuccessors:true,helperFreeze}),proof));
  return {runningSource:root,rpc:guarded.rpc,verifySource:async runningSource=>{assert.equal(path.resolve(runningSource),root);await guarded.validate();await guarded.validate();return {verified:true,sourceGate:proof.gate,evidence:proof.evidence};}};
}
export function guardAuthorityRpc(rpc,check) {
  let authorityFailure;
  const validate=async()=>{if(authorityFailure) throw authorityFailure;try {await check();} catch(error) {authorityFailure=error;throw error;}};
  return {validate,rpc:async(method,params)=>{if(authorityFailure) throw authorityFailure;if(method==='config/batchWrite') await validate();try {return await rpc(method,params);} finally {if(method==='config/batchWrite') await validate();}}};
}
