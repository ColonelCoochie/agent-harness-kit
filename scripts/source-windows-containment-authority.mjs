import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const featureId = 'windows-command-containment-001';
export const directory = `.harness/${featureId}`;
export const gatePath = `${directory}/source-gate.json`;
export const reviewPath = `${directory}/source-authority-review.json`;
export const invocationPath = `${directory}/source-gate-invocation.json`;
export const predecessorPin = {path:`${directory}/predecessor.json`,bytes:21872,sha256:'596e8bbbf7625aefe339b7a2db95cd66f06b310b50942585ddcf8ef41af33e78'};
export const predecessorDigest = '97d64567ecede9787105a0fd9c6535cc15b1a5eab15d0e8ba8d4b42c10ca82e9';
export const contractPin = '6ca18c2f286fc76069a2ee8b4b228c5335cfc7abaf10c9facd29b7e54ea29837';
export const transitionPin = {path:'.harness/windows-command-containment-001/source-transition.json',bytes:37805,sha256:'af4233f59ba7e2b586b865f494474d398e8901c9eae93fc6434d690f3f44754e'};
export const helperPaths = ['scripts/source-windows-containment-authority.mjs','scripts/verify-source-windows-containment.mjs'];
export const changedPaths = ['skill/codex-harness/assets/project-runtime.mjs','skill/codex-harness/assets/repair.mjs','skill/codex-harness/assets/windows-command-supervisor.ps1','skill/codex-harness/assets/windows-command.mjs','skill/codex-harness/scripts/lib/core.mjs','tests/harness-hardening.test.mjs'];
export const sealedHelperPaths = ['scripts/native-hook-report-selection.mjs','scripts/native-hook-v2-live-e2e.mjs','scripts/prepare-budget-compat-source.mjs','scripts/source-budget-compat-authority.mjs','scripts/verify-native-hook-v2-live-e2e.mjs','scripts/verify-source-budget-compat.mjs','scripts/native-hook-v2-live-gate.mjs'];
export const futureHelperPaths = ['scripts/live003-windows-containment-e2e.mjs','scripts/verify-live003-windows-containment-e2e.mjs','scripts/live003-windows-containment-gate.mjs','scripts/live003-windows-containment-gate.test.mjs','scripts/rollout003-windows-containment-authority.mjs','scripts/rollout003-windows-containment.mjs','scripts/verify-rollout003-windows-containment.mjs','scripts/rollout003-windows-containment-isolated.mjs','scripts/rollout003-windows-containment-gate.mjs','scripts/verify-rollout003-windows-containment-supersession.mjs','scripts/rollout003-windows-containment-gate.test.mjs','scripts/rollout003-windows-containment-isolated.test.mjs'];
const deny = ['.git/**','.env','.env.*','**/node_modules/**','**/dist/**','**/build/**'];
export const futureShapes = {
  'native-hook-v2-live-003': {id:'native-hook-v2-live-003',title:'Fresh Windows containment native lifecycle proof',description:'Authenticate the sealed Windows SOURCE authority and genuine complete native lifecycle in a fresh exclusive selected report.',dependencies:[featureId],scope:{allow:['scripts/*windows-containment*','.harness/**'],deny},acceptance:[{id:'ac-1',description:'Fresh selected native lifecycle report authenticates the sealed Windows SOURCE gate and all native lifecycle assertions.',command:'node scripts/verify-live003-windows-containment-e2e.mjs --report .harness/native-hook-v2-live-003-e2e-report.json'}],requiredLayers:['full','architecture','quick']},
  'native-hook-v2-rollout-003': {id:'native-hook-v2-rollout-003',title:'Guarded Windows containment rollout of all eleven managed roots',description:'Deploy the authenticated Windows SOURCE runtime to all eleven exact roots, preserve historical contracts and evidence, and prove fresh isolated three-phase behavior before sealing production evidence.',dependencies:['native-hook-v2-live-003'],scope:{allow:['scripts/*windows-containment*','.harness/**','skill/codex-harness/**'],deny},acceptance:[{id:'ac-1',description:'Fresh production evidence authenticates all eleven complete installed runtimes plus historical preservation and canonical definition trust with the policy budget and isolated three-phase proof.',command:'node scripts/verify-rollout003-windows-containment.mjs --report .harness/native-hook-v2-rollout-003-report.json'},{id:'ac-2',description:'Supersession evidence authenticates preserved historical rollout contracts and all predecessor failure roles against the fresh production proof.',command:'node scripts/verify-rollout003-windows-containment-supersession.mjs --report .harness/native-hook-v2-rollout-003-report.json'}],requiredLayers:['full','architecture','quick']}
};

export const sha = value => createHash('sha256').update(value).digest('hex');
export function stable(value) { return JSON.stringify(value,(_key,item)=>item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item); }
export const digest = value => sha(stable(value));
export function relativeFile(relative) {
  assert.equal(typeof relative,'string');
  assert(relative && !/[\\\0:]/.test(relative) && !path.isAbsolute(relative));
  assert(relative.split('/').every(part=>part && part!=='.' && part!=='..'));
  const resolved = path.resolve(sourceRoot,relative);
  assert(resolved.startsWith(`${sourceRoot}${path.sep}`));
  return resolved;
}
async function referenceBytes(relative) {
  const resolved=relativeFile(relative); let cursor=sourceRoot;
  for(const part of relative.split('/')) {
    cursor=path.join(cursor,part); const info=await lstat(cursor);
    assert(!info.isSymbolicLink(),`Symlink authority: ${relative}`);
    assert(cursor===resolved?info.isFile():info.isDirectory(),`Not a regular authority file: ${relative}`);
  }
  return readFile(resolved);
}
export async function reference(relative) {const bytes=await referenceBytes(relative);return {path:relative,bytes:bytes.length,sha256:sha(bytes)};}
export async function authenticate(ref) {
  assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
  assert(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0); assert(/^[a-f0-9]{64}$/.test(ref.sha256));
  const bytes=await referenceBytes(ref.path);assert.deepEqual({path:ref.path,bytes:bytes.length,sha256:sha(bytes)},ref,`Authority bytes changed: ${ref.path}`);
  return bytes;
}
export const json = async relative=>JSON.parse(await readFile(relativeFile(relative),'utf8'));
export async function exclusive(relative,value) {
  const target=relativeFile(relative); await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'}); return reference(relative);
}
export async function snapshot() {
  const files={};
  async function visit(relative) {
    const target=relativeFile(relative),info=await lstat(target); assert(!info.isSymbolicLink());
    if(info.isDirectory()) for(const name of (await readdir(target)).sort()) await visit(`${relative}/${name}`);
    else {assert(info.isFile());files[relative]=sha(await readFile(target));}
  }
  for(const root of ['package.json','bin','skill/codex-harness','tests']) await visit(root);
  return files;
}
export function normalizedContract(feature) {
  return {id:feature.id,title:feature.title,description:feature.description,dependencies:feature.dependencies,scope:feature.scope,acceptance:feature.acceptance,requiredLayers:feature.requiredLayers??['full'],...(Object.hasOwn(feature,'verificationBudget')?{verificationBudget:feature.verificationBudget}:{})};
}
async function frozenFeature(feature, expected) {
  assert.deepEqual(normalizedContract(feature),expected.shape);
  assert.equal(feature.contract?.version,2); assert.equal(feature.contract.hash,expected.hash);
  assert.deepEqual(feature.contract.snapshot,expected.shape);
  assert.equal(digest({contract:expected.shape,scopeBaselineHash:feature.contract.scopeBaselineHash}),expected.hash);
  assert.equal(feature.contract.scopeBaselineHash,expected.scopeBaselineHash);
  assert.deepEqual(feature.scopeBaselineRef,expected.baseline);
  const baseline=JSON.parse(await authenticate({path:expected.baseline.path,bytes:expected.baseline.bytes,sha256:expected.baseline.sha256}));
  const value={version:baseline.version,head:baseline.head,tree:baseline.tree,branch:baseline.branch,files:baseline.files,worktreeHash:baseline.worktreeHash,...(Object.hasOwn(baseline,'capturePolicy')?{capturePolicy:baseline.capturePolicy}:{})};
  assert.equal(digest(value),expected.scopeBaselineHash); assert.equal(baseline.baselineHash,expected.scopeBaselineHash);
}

export async function verifyWindowsContainmentCandidate() {
  assert(transitionPin,'SOURCE transition must be pinned before acceptance');
  const transition=JSON.parse(await authenticate(transitionPin)); assert.equal(transition.version,1); assert.equal(transition.featureId,featureId);
  assert.deepEqual(transition.predecessor,predecessorPin);
  const predecessor=JSON.parse(await authenticate(predecessorPin)); assert.equal(predecessor.version,1);
  assert.equal(predecessor.sourceDigest,predecessorDigest); assert.equal(predecessor.sourceFiles.length,66);
  const original={};
  for(const item of predecessor.sourceFiles) {
    assert(!Object.hasOwn(original,item.path)); assert(/^(package\.json$|bin\/|skill\/codex-harness\/|tests\/)/.test(item.path)); relativeFile(item.path);
    assert.equal(item.archive,`${directory}/original-bytes/${item.sha256}.bin`);
    await authenticate({path:item.archive,bytes:item.bytes,sha256:item.sha256}); original[item.path]=item.sha256;
  }
  assert.deepEqual(predecessor.sourceFiles.map(item=>item.path),Object.keys(original).sort());
  assert.equal(digest(original),predecessorDigest);
  const historical=JSON.parse(await authenticate(predecessor.featureState));
  const currentState=await json('.harness/features.json');
  for(const old of historical.features) {
    const current=currentState.features.find(item=>item.id===old.id); assert(current,`Missing historical feature ${old.id}`);
    const preserved={...current};
    if(old.id==='native-hook-v2-rollout-002') {
      assert.deepEqual({status:current.status,blocker:current.blocker,updatedAt:current.updatedAt},transition.authorizedHistoricalBlock);
      for(const key of ['status','blocker','updatedAt']) preserved[key]=old[key];
    }
    assert.deepEqual(preserved,old,`Historical definition/evidence changed: ${old.id}`);
  }
  for(const ref of transition.historicalLeaves) await authenticate(ref);
  assert.deepEqual(transition.sealedHelpers.map(ref=>ref.path),sealedHelperPaths);
  for(const ref of transition.sealedHelpers) await authenticate(ref);
  const actual=await snapshot(); assert.equal(Object.keys(actual).length,68); assert.equal(digest(actual),transition.sourceDigest);
  assert.equal(transition.sourceFiles.length,68);
  const declared={};
  for(const ref of transition.sourceFiles) {await authenticate(ref);assert(!Object.hasOwn(declared,ref.path));declared[ref.path]=ref.sha256;}
  assert.deepEqual(actual,declared);
  const changed=[...new Set([...Object.keys(original),...Object.keys(actual)])].filter(key=>original[key]!==actual[key]).sort((a,b)=>a.localeCompare(b));
  assert.deepEqual(changed,changedPaths); assert.deepEqual(transition.changedPaths,changedPaths);
  assert.deepEqual(transition.reviewedDelta,changedPaths.map(relative=>({path:relative,before:original[relative]??null,after:actual[relative]})));
  const feature=currentState.features.find(item=>item.id===featureId); assert.equal(transition.frozenContract.hash,contractPin);
  await frozenFeature(feature,transition.frozenContract);
  assert.deepEqual(await reference('.harness/config.json'),transition.config);
  const config=await json('.harness/config.json'); assert.equal(config.policies.maxAttempts,5); assert.equal(config.policies.maxRepeatedFailures,2);
  const grant=JSON.parse(await authenticate(transition.futureGrant)); assert.equal(grant.version,1); assert.deepEqual(grant.predecessor,predecessorPin);
  assert.deepEqual(grant.helperCreation,futureHelperPaths);
  assert.deepEqual(Object.keys(grant.contracts),Object.keys(futureShapes));
  for(const [id,shape] of Object.entries(futureShapes)) {
    assert.deepEqual(grant.contracts[id],{shape,sha256:digest(shape)});
    const future=currentState.features.find(item=>item.id===id);
    if(future) {
      assert.deepEqual(normalizedContract(future),shape);
      if(future.contract) {assert.equal(future.contract.version,2);assert.deepEqual(future.contract.snapshot,shape);assert.equal(future.contract.hash,digest({contract:shape,scopeBaselineHash:future.contract.scopeBaselineHash}));}
      else {assert.equal(future.status,'not_started');assert.equal(future.attempts,0);assert.deepEqual(future.evidence,[]);}
    }
  }
  const normalization=JSON.parse(await authenticate(grant.normalizationProof)); assert.equal(normalization.kind,'actual-ordinary-cli-contract-normalization'); assert.deepEqual(normalization.shapes,futureShapes); assert.equal(normalization.exitCode,0);
  const repair=JSON.parse(await authenticate(transition.repair.result));
  const repairReview=JSON.parse(await authenticate(transition.repair.review)); assert.equal(repairReview.outcome,'clean'); assert.deepEqual(repairReview.findings,[]);
  for(const item of repairReview.reviewedFiles) assert.equal(actual[item.path],item.sha256);
  assert.equal(repair.validation.regressionBeforeFix.exitCode,1); assert.equal(repair.validation.regressionAfterFix.exitCode,0); assert.equal(repair.validation.focused.passed,21);
  for(const ref of transition.repair.logs) await authenticate(ref);
  for(const [relative,generated] of [['skill/codex-harness/assets/project-runtime.mjs','.harness/run.mjs'],['skill/codex-harness/assets/repair.mjs','.harness/repair.mjs'],['skill/codex-harness/assets/windows-command.mjs','.harness/windows-command.mjs'],['skill/codex-harness/assets/windows-command-supervisor.ps1','.harness/windows-command-supervisor.ps1']]) assert.equal((await reference(relative)).sha256,(await reference(generated)).sha256);
  return {version:1,pass:true,featureId,sourceDigest:transition.sourceDigest,predecessor:predecessorPin,transition:transitionPin,futureGrant:transition.futureGrant,contractHash:contractPin,sourceFiles:68,changedPaths,historicalFeatures:historical.features.length,sealedHelpers:7,repairReview:transition.repair.review};
}

export async function windowsContainmentAcceptance() {
  const authority=await verifyWindowsContainmentCandidate();
  return {version:1,authority,authorityScripts:await Promise.all(helperPaths.map(reference))};
}

function expectedPlan(config,feature) {
  const layers=[...new Set([...config.completion.alwaysRunWhenConfigured.filter(layer=>config.verification[layer]?.length),...config.completion.baseLayers,...feature.requiredLayers])];
  return {layers,entries:[...layers.flatMap(layer=>config.verification[layer].map(command=>({command:typeof command==='string'?command:command.command,layer,criterionId:null}))),...feature.acceptance.map(item=>({command:item.command,layer:'acceptance',criterionId:item.id}))]};
}
async function gateInputs() {
  const authority=await verifyWindowsContainmentCandidate();
  const state=await json('.harness/features.json'),feature=state.features.find(item=>item.id===featureId);
  assert.equal(feature.status,'passing'); assert(feature.evidence.length);
  const evidenceRef=await reference(feature.evidence.at(-1)); const evidence=JSON.parse(await authenticate(evidenceRef));
  const transition=JSON.parse(await authenticate(transitionPin)),config=JSON.parse(await authenticate(transition.config));
  assert.equal(evidence.schemaVersion,5);assert.equal(evidence.harnessVersion,6);assert.equal(evidence.featureId,featureId);assert.equal(evidence.pass,true);assert.equal(evidence.contractHash,contractPin);assert.equal(evidence.configHash,digest(config));
  assert.deepEqual(evidence.scopeViolations,[]);
  const plan=evidence.verificationPlan,expected=expectedPlan(config,feature);
  assert.equal(plan.schemaVersion,2);assert.equal(plan.evidenceSchemaVersion,5);assert.equal(plan.harnessVersion,6);assert.equal(evidence.verificationHash,digest(plan));assert.deepEqual(plan.feature,{id:featureId,contractHash:contractPin});assert.deepEqual(plan.config,{hash:digest(config)});
  assert.deepEqual(evidence.requiredLayers,expected.layers);assert.deepEqual(evidence.executedLayers,[...new Set(expected.entries.map(item=>item.layer))]);assert.deepEqual(plan.requiredLayers,expected.layers.map((id,order)=>({id,order})));assert.equal(expected.entries.length,12);assert.equal(plan.executions.length,12);assert.equal(evidence.commands.length,12);
  const logs=[];
  for(let order=0;order<expected.entries.length;order++) {
    const entry=expected.entries[order],execution=plan.executions[order],result=evidence.commands[order];
    assert.equal(execution.order,order);assert.equal(execution.kind,entry.layer==='acceptance'?'acceptance':'layer');assert.equal(execution.command,entry.command);assert.equal(execution.commandHash,digest(entry.command));assert.equal(execution.commandRedacted,false);assert.equal(execution.layer,entry.layer);assert.equal(execution.criterionId,entry.criterionId);assert.deepEqual(execution.credentials,[]);assert.deepEqual(execution.expected,{pass:true,exitCode:0,timedOut:false});
    assert.equal(result.executionId,execution.id);assert.equal(result.executionOrder,order);assert.equal(result.command,entry.command);assert.equal(result.layer,entry.layer);assert.equal(result.criterionId,entry.criterionId);assert.deepEqual(result.credentials,[]);assert.equal(result.pass,true);assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);
    for(const stream of ['stdout','stderr']) {assert(result.logs?.[stream]?.startsWith('.harness/logs/'));logs.push({executionId:execution.id,stream,reference:await reference(result.logs[stream])});}
  }
  const acceptanceResult=evidence.commands.at(-1),stdout=await readFile(relativeFile(acceptanceResult.logs.stdout),'utf8');
  const acceptance=JSON.parse(stdout.trim()); assert.deepEqual(acceptance,await windowsContainmentAcceptance());
  const reviewRef=await reference(reviewPath),review=JSON.parse(await authenticate(reviewRef));
  assert.equal(review.version,1);assert.equal(review.kind,'independent-actual-source-authority-review');assert.equal(review.outcome,'clean');assert.equal(review.independentActualCode,true);assert.deepEqual(review.findings,[]);assert.deepEqual(review.helpers,acceptance.authorityScripts);assert.deepEqual(review.transition,transitionPin);assert.equal(review.sourceDigest,authority.sourceDigest);assert(review.reviewer && review.reviewer!==review.worker);assert(Date.parse(review.createdAt)<=Date.parse(evidence.startedAt));
  const invocationRef=await reference(invocationPath),invocation=JSON.parse(await authenticate(invocationRef));
  assert.equal(invocation.version,1);assert.equal(invocation.featureId,featureId);assert.deepEqual(invocation.argv,['.harness/run.mjs','verify',featureId]);assert.equal(invocation.exitCode,0);assert.equal(invocation.signal,null);assert.equal(invocation.timedOut,false);assert.equal(invocation.truncated,false);assert.equal(invocation.providerFree,true);assert.equal(invocation.sourceBefore,authority.sourceDigest);assert.equal(invocation.sourceAfter,authority.sourceDigest);assert(Date.parse(invocation.startedAt)<=Date.parse(evidence.startedAt));assert(Date.parse(invocation.finishedAt)>=Date.parse(evidence.finishedAt));assert.equal(invocation.stdoutBytes,Buffer.byteLength(invocation.stdout));assert.equal(invocation.stderrBytes,Buffer.byteLength(invocation.stderr));
  return {authority,evidence:evidenceRef,review:reviewRef,invocation:invocationRef,authorityScripts:acceptance.authorityScripts,logs};
}

export async function sealWindowsContainmentGate() {
  const inputs=await gateInputs();
  await exclusive(gatePath,{version:1,kind:'actual-configured-windows-source-gate',featureId,contractHash:contractPin,predecessor:predecessorPin,transition:transitionPin,futureGrant:inputs.authority.futureGrant,sourceDigest:inputs.authority.sourceDigest,sealedAt:new Date().toISOString(),...inputs});
  return verifyWindowsContainmentGate();
}
export async function verifyWindowsContainmentGate() {
  const receiptRef=await reference(gatePath),receipt=JSON.parse(await authenticate(receiptRef));
  const inputs=await gateInputs();assert.equal(receipt.version,1);assert.equal(receipt.kind,'actual-configured-windows-source-gate');assert.equal(receipt.featureId,featureId);assert.equal(receipt.contractHash,contractPin);assert.deepEqual(receipt.predecessor,predecessorPin);assert.deepEqual(receipt.transition,transitionPin);assert.deepEqual(receipt.futureGrant,inputs.authority.futureGrant);assert.equal(receipt.sourceDigest,inputs.authority.sourceDigest);
  for(const key of Object.keys(inputs)) assert.deepEqual(receipt[key],inputs[key]);
  const invocation=JSON.parse(await authenticate(inputs.invocation));assert(Date.parse(receipt.sealedAt)>=Date.parse(invocation.finishedAt));
  return {version:1,pass:true,featureId,sourceDigest:receipt.sourceDigest,contractHash:contractPin,gate:receiptRef,predecessor:predecessorPin,transition:transitionPin,futureGrant:receipt.futureGrant,evidence:inputs.evidence,review:inputs.review,authorityScripts:inputs.authorityScripts};
}
