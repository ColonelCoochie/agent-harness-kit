import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateRef as authenticate,reference,regularFile,sha,sourceRoot,stable,sourceDigest,currentAuthority,snapshot,artifactRoot,isolatedReport} from './native-hook-rollout-v2-authority.mjs';
import {authenticateRef as authenticateOriginal} from './native-hook-rollout-v2.mjs';
const relativeFile=relative=>path.join(sourceRoot,relative);
import {normalizedContract} from './verify-source-budget-compat.mjs';
import {verifySelectedReport} from './verify-native-hook-rollout-v2.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';
import {auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';

export const featureId = 'native-hook-v2-rollout-002';
export const selectedReport = '.harness/native-hook-v2-rollout-002-report.json';
export const gateDirectory = '.harness/native-hook-v2-rollout-002-gate';
export const beforePath = `${gateDirectory}/before.json`;
export const gatePath = `${gateDirectory}/receipt.json`;
export const helperPath = 'scripts/native-hook-v2-rollout-gate.mjs';
export const acceptanceCommands = [`node scripts/verify-native-hook-rollout-v2.mjs --report ${selectedReport}`,`node scripts/verify-native-hook-rollout.mjs --superseding-report ${selectedReport}`];
const contractPin = '9a149a651ee4465140276a9827c48b01e6a473eba05891ae83145ef12b56bd09';
const invocationArgs = ['.harness/run.mjs','verify',featureId];
const json = async relative => JSON.parse(await readFile(relativeFile(relative),'utf8'));
const hash = value => sha(stable(value));
const now = () => new Date().toISOString();
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort());

async function regularReference(relative) {
  assert(relative.split('/').every(part => part && part !== '.' && part !== '..'));
  const file = relativeFile(relative);
  let parent = sourceRoot;
  for (const part of relative.split('/')) {
    parent = path.join(parent,part);
    const info = await lstat(parent);
    assert(!info.isSymbolicLink(),'Bindings reject symlinks in all path components');
    assert(parent === file ? info.isFile() : info.isDirectory());
  }
  const ref = await reference(relative);
  await authenticate(ref);
  return ref;
}

export async function authenticateGateReference(ref) {
  assert.deepEqual(await regularReference(ref.path),ref,'Gate reference bytes changed');
  return authenticate(ref);
}

export function declaredReferences(value,output=[]) {
  if(!value||typeof value!=='object')return output;
  if(value.kind==='digest-only-original'){output.push(value);return output;}
  if(typeof value.path==='string'&&Number.isSafeInteger(value.bytes)&&/^[a-f0-9]{64}$/.test(value.sha256)&&!value.archive&&value.kind!=='original-prefix'){
    assert(value.path.startsWith('.harness/')||value.path.startsWith('scripts/'),'Declared production references must be repository paths');output.push({path:value.path,bytes:value.bytes,sha256:value.sha256});return output;
  }
  for(const child of Object.values(value))declaredReferences(child,output);return output;
}
const referenceKey=ref=>ref.kind==='digest-only-original'?ref.root+':'+ref.file:ref.path;
export async function isolatedReferences(value,normalize=regularReference){
  const result=[];
  // The sealed runner retains historical SHA-only refs. Authenticate their
  // bytes here before binding them in the configured gate's complete closure.
  for(const name of ['sourceGate','transitionGate']){
    const pin=value[name];assert(pin&&typeof pin.path==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256),'Both isolated gate references are required');
    const ref=await normalize(pin.path);assert.equal(ref.sha256,pin.sha256,'Isolated gate reference hash changed');
    if(Object.hasOwn(pin,'bytes'))assert.equal(ref.bytes,pin.bytes,'Isolated gate reference size changed');
    result.push(ref);
  }
  return [...result,...declaredReferences(value.artifacts)];
}
async function closure(roots){
  const pending=[...roots],found=new Map();
  while(pending.length){const ref=pending.shift(),key=referenceKey(ref);if(found.has(key)){assert.deepEqual(found.get(key),ref,'Conflicting graph references');continue;}
    if(ref.kind==='digest-only-original'){await authenticateOriginal(ref);found.set(key,ref);continue;}
    const bytes=await authenticateGateReference(ref);found.set(key,ref);
    // Only declared production containers and reviewed authority containers are expanded.
    // Native raw bindings, archived original bytes and isolated fixture artifacts are leaves.
    const production=ref.path.startsWith(artifactRoot+'/')&&!ref.path.includes('/original-bytes/')&&!ref.path.endsWith('/isolated-native-binding.json');
    const reviewed=['.harness/source-budget-compat-v1/predecessor.json','.harness/source-budget-compat-v1/aggregate-test-reconstruction-v2.json','.harness/native-hook-v2-live-002-gate/receipt.json','.harness/native-hook-v2-live-002-gate/before.json'];
    if(ref.path===selectedReport||production||reviewed.includes(ref.path))pending.push(...declaredReferences(JSON.parse(bytes)));
    else if(ref.path===isolatedReport)pending.push(...await isolatedReferences(JSON.parse(bytes)));
  }
  return [...found.values()].sort((a,b)=>referenceKey(a).localeCompare(referenceKey(b)));
}

function featureBinding(feature) {
  const shape = normalizedContract(feature);
  assert.equal(feature.contract?.version,2); assert.equal(feature.contract.hash,contractPin);
  assert.deepEqual(feature.contract.snapshot,shape);
  assert.equal(hash({contract:shape,scopeBaselineHash:feature.contract.scopeBaselineHash}),contractPin);
  assert(!Object.hasOwn(feature,'verificationBudget'),'The reviewed contract has no feature budget');
  assert.deepEqual(feature.acceptance.map(item => item.command),acceptanceCommands);
  return {shape,contract:feature.contract,baseline:feature.scopeBaselineRef};
}

async function bindings(feature,config){
  assert.deepEqual(await json('.harness/config.json'),config,'Configuration changed');
  const authority=await currentAuthority();assert.equal(authority.sourceDigest,sourceDigest);
  const reportPin=await regularReference(selectedReport);const report=JSON.parse(await authenticate(reportPin));
  const result=await verifySelectedReport(selectedReport);const binding=featureBinding(feature);
  const baseline=JSON.parse(await authenticate(binding.baseline));assert.equal(baseline.baselineHash,binding.contract.scopeBaselineHash);
  const roots=[reportPin,binding.baseline,await regularReference('.harness/config.json'),await regularReference(helperPath),...await Promise.all(feature.evidence.map(regularReference))];
  const references=await closure(roots);assert.equal(hash(await snapshot(sourceRoot)),sourceDigest);assert.equal(config.policies.maxAttempts,5);assert.equal(config.policies.maxRepeatedFailures,2);
  return {report:reportPin,authority,feature:binding,config:await regularReference('.harness/config.json'),configHash:hash(config),helper:await regularReference(helperPath),sourceDigest,references,result};
}

export async function inspectSourceGateInputs() {
  const feature = (await json('.harness/features.json')).features.find(item => item.id === featureId);
  return bindings(feature,await json('.harness/config.json'));
}

export function expectedPlan(before) {
  const {config,feature} = before;
  const layers = [...new Set([
    ...config.completion.alwaysRunWhenConfigured.filter(layer => config.verification[layer]?.length),
    ...config.completion.baseLayers,...feature.shape.requiredLayers])];
  const entries = layers.flatMap(layer => config.verification[layer].map(command => ({command,layer,criterionId:null})));
  entries.push(...feature.shape.acceptance.map(item => ({...item,layer:'acceptance',criterionId:item.id})));
  const occurrences = new Map();
  const executions = entries.map((entry,order) => {
    assert.equal(typeof entry.command,'string');
    const kind = entry.layer === 'acceptance' ? 'acceptance' : 'layer';
    const group = `${kind}:${kind === 'acceptance' ? entry.criterionId : entry.layer}`;
    const count = (occurrences.get(group) ?? 0)+1; occurrences.set(group,count);
    return {id:`${kind}:${encodeURIComponent(kind === 'acceptance' ? entry.criterionId : entry.layer)}:${count}`,
      order,kind,layer:entry.layer,criterionId:entry.criterionId,command:entry.command,commandHash:hash(entry.command),
      commandRedacted:false,credentials:[],expected:{pass:true,exitCode:0,timedOut:false}};
  });
  assert.deepEqual(layers,['quick','architecture','full']);assert.equal(executions.length,12);assert.deepEqual(executions.filter(item=>item.kind==='acceptance').map(item=>item.command),acceptanceCommands);
  const acceptance = executions.filter(item => item.kind === 'acceptance');
  return {schemaVersion:2,evidenceSchemaVersion:5,harnessVersion:6,feature:{id:featureId,contractHash:contractPin},
    config:{hash:before.bindings.configHash},requiredLayers:layers.map((id,order) => ({id,order})),executions,
    acceptanceCriteria:feature.shape.acceptance.map((item,order) => ({id:item.id,order,description:item.description,
      executionId:acceptance[order].id,command:acceptance[order].command,commandHash:acceptance[order].commandHash,
      commandRedacted:false,credentials:[]})),
    scope:{enforcement:config.scope.enforcement,allow:feature.shape.scope.allow,deny:feature.shape.scope.deny,
      baselineHash:feature.contract.scopeBaselineHash,expectedViolations:[]},
    executionPolicy:{commandTimeoutMs:config.policies.commandTimeoutMs,
      attemptBudget:{version:1,globalMaxAttempts:5,featureMaxAttempts:null,effectiveMaxAttempts:5,attemptsBefore:before.attempts}},
    evidencePolicy:{redactOutput:config.security.redactOutput,environmentAllow:config.security.environmentAllow}};
}

export function assertGateEvidence(before, feature, evidence) {
  assert.equal(feature.status,'passing'); assert.equal(feature.attempts,before.attempts+1);
  assert(feature.attempts <= 5); assert.deepEqual(featureBinding(feature),before.feature);
  assert.equal(feature.evidence.length,before.evidencePrefix.length+1);
  assert.deepEqual(feature.evidence.slice(0,-1),before.evidencePrefix.map(item => item.path),'Prior evidence prefix changed');
  assert.equal(evidence.featureId,featureId); assert.equal(evidence.schemaVersion,5); assert.equal(evidence.harnessVersion,6);
  assert.equal(evidence.pass,true); assert.equal(evidence.attempt,before.attempts+1); assert.deepEqual(evidence.scopeViolations,[]);
  assert.equal(evidence.contractHash,contractPin); assert.equal(evidence.configHash,before.bindings.configHash);
  const plan = expectedPlan(before); assert.deepEqual(evidence.verificationPlan,plan,'Configured ordered plan changed');
  assert.equal(evidence.verificationHash,hash(plan));
  assert.deepEqual(evidence.requiredLayers,plan.requiredLayers.map(item => item.id));
  assert.deepEqual(evidence.executedLayers,[...evidence.requiredLayers,'acceptance']);
  assert.equal(evidence.commands.length,plan.executions.length);
  for (const [index, command] of evidence.commands.entries()) {
    const execution = plan.executions[index];
    assert.equal(command.executionId,execution.id); assert.equal(command.executionOrder,index);
    assert.equal(command.command,execution.command); assert.equal(command.layer,execution.layer);
    assert.equal(command.criterionId,execution.criterionId); assert.deepEqual(command.credentials,[]);
    assert.equal(command.pass,true); assert.equal(command.exitCode,0); assert.equal(command.timedOut,false);
  }
  const commands = evidence.commands.filter(item => item.layer === 'acceptance');
  assert.equal(commands.length,2);assert.deepEqual(commands.map(item=>item.command),acceptanceCommands);
  for(const command of commands){assert.equal(command.truncated,false);assert.equal(command.stderr,'');assert.equal(command.originalBytes,Buffer.byteLength(command.stdout));assert.deepEqual(JSON.parse(command.stdout.trim()),before.bindings.result,'Acceptance differs from strict rollout verification');}
  assert.equal(feature.lastVerification.pass,true); assert.equal(feature.lastVerification.at,evidence.finishedAt);
  assert(evidence.repository.before?.statusHash && evidence.repository.after?.statusHash);
}

export function assertReceiptOrder(before, receipt, evidence) {
  const sequence = [before.completedAt,receipt.invocation.startedAt,evidence.startedAt,evidence.finishedAt,
    receipt.invocation.finishedAt,receipt.after.completedAt,receipt.sealedAt].map(value => Date.parse(value));
  assert(sequence.every(Number.isFinite));
  assert(sequence.every((value,index) => index === 0 || value >= sequence[index-1]),'Gate order is not BEFORE -> invocation -> evidence -> AFTER -> receipt');
  assert.equal(receipt.runId,before.runId); assert.deepEqual(receipt.actor,before.actor);
  assert.equal(receipt.invocation.executable,process.execPath);
  assert.deepEqual(receipt.invocation.argv,invocationArgs); assert.equal(receipt.invocation.cwd,sourceRoot);
  assert.equal(receipt.invocation.actor,before.actor.id); assert.equal(receipt.invocation.exitCode,0);
  assert.equal(receipt.invocation.signal,null); assert(Number.isSafeInteger(receipt.invocation.pid) && receipt.invocation.pid > 0);
  assert.equal(receipt.after.bindingsHash,hash(before.bindings));
  assert.deepEqual(receipt.after.result,before.bindings.result);
  assert.equal(receipt.assurance,'cooperative sole-worker byte preservation across the genuine configured gate');
  assert.equal(receipt.repositoryBinding,'statusHash is scope metadata; report bytes are bound by authenticated BEFORE and AFTER references');
}

async function healthyAudit() {
  const audit = await auditHarness(sourceRoot); assert.equal(audit.criticalFailures,0); assert(audit.overall >= 95);
  assert(audit.subsystems.state.checks.some(item => item.message === 'Passing evidence chains are valid' && item.pass));
}

// Consumers must pass the selected report explicitly and establish --report in
// argv before importing this helper; native report selection is captured once.
export async function verifySourceGate(relative = gatePath, reportSelection) {
  assert.equal(reportSelection,selectedReport,'Explicit selected rollout002 report is required');
  assert.equal(relative,gatePath,'Only the exclusive selected live002 receipt is authorized');
  const receipt = JSON.parse(await authenticate(await regularReference(relative)));
  keys(receipt,['version','featureId','reportSelection','runId','actor','before','evidence','invocation','after','sealedAt','assurance','repositoryBinding']);
  assert.equal(receipt.version,1); assert.equal(receipt.featureId,featureId); assert.equal(receipt.reportSelection,selectedReport);
  assert.equal(receipt.before.path,beforePath); assert.equal(receipt.before.path === receipt.evidence.path,false);
  const before = JSON.parse(await authenticateGateReference(receipt.before));
  assert.equal(before.version,1); assert.equal(before.featureId,featureId); assert.equal(before.reportSelection,selectedReport);
  assert.equal(before.actor.source,'CODEX_THREAD_ID'); assert.equal(typeof before.actor.id,'string'); assert(before.actor.id);
  assert(Number.isSafeInteger(before.attempts) && before.attempts >= 0 && before.attempts < 5);
  assert.equal(before.config.policies.maxAttempts,5); assert.equal(before.config.policies.maxRepeatedFailures,2);
  assert.equal(hash(before.config),before.bindings.configHash);
  assert.deepEqual(before.feature,before.bindings.feature);
  assert.equal(receipt.evidence.path.startsWith('.harness/evidence/'),true);
  const feature = (await json('.harness/features.json')).features.find(item => item.id === featureId);
  assert.equal(receipt.evidence.path,feature.evidence.at(-1),'Receipt must bind the latest passing live002 evidence');
  for (const ref of before.evidencePrefix) await authenticateGateReference(ref);
  for(const ref of before.bindings.references){if(ref.kind==='digest-only-original')await authenticateOriginal(ref);else await authenticateGateReference(ref);}
  const evidence = JSON.parse(await authenticateGateReference(receipt.evidence));
  assertGateEvidence(before,feature,evidence); assertReceiptOrder(before,receipt,evidence);
  const prefixFeature = {...feature,evidence:before.evidencePrefix.map(item => item.path)};
  assert.deepEqual(await bindings(prefixFeature,before.config),before.bindings,'Authenticated inputs changed after gate');
  await healthyAudit();
  return {pass:true,version:1,actualConfiguredGate:true,allReferencesAuthenticated:true,latestPassingEvidence:true,
    cooperativeBytePreservation:true,strictRolloutResult:true};
}

function childEnvironment(config) {
  const reserved = new Set(Object.values(config.security.credentials.providers).flatMap(item => [item.targetEnvironment,...item.sources]).map(key => key.toUpperCase()));
  const allowed = new Set(config.security.environmentAllow.map(key => key.toUpperCase()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())
    && !reserved.has(key.toUpperCase()) && !/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key)));
  assert(process.env.CODEX_THREAD_ID); env.CODEX_THREAD_ID = process.env.CODEX_THREAD_ID;
  return env;
}

export async function runSourceGate() {
  assert.equal(path.resolve(process.cwd()),sourceRoot);
  await inspectReportLocation(sourceRoot,gateDirectory,{kind:'directory',absent:true});
  const continuity = await json('.harness/continuity.json');
  assert.equal(continuity.phase,'working'); assert.equal(continuity.handoff,null);
  assert.equal(continuity.owner?.source,'CODEX_THREAD_ID'); assert.equal(continuity.owner?.id,process.env.CODEX_THREAD_ID);
  const feature = (await json('.harness/features.json')).features.find(item => item.id === featureId);
  assert.equal(feature.status,'active'); assert(Number.isSafeInteger(feature.attempts) && feature.attempts < 5);
  const config = await json('.harness/config.json');
  const frozen = await bindings(feature,config); await healthyAudit();
  const before = {version:1,featureId,reportSelection:selectedReport,runId:randomUUID(),actor:continuity.owner,
    feature:frozen.feature,config,attempts:feature.attempts,evidencePrefix:await Promise.all(feature.evidence.map(regularReference)),
    bindings:frozen,completedAt:now()};
  await mkdir(relativeFile(gateDirectory));
  await writeFile(relativeFile(beforePath),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
  const beforeRef = await regularReference(beforePath);
  const startedAt = now();
  const child = spawn(process.execPath,invocationArgs,{cwd:sourceRoot,env:childEnvironment(config),stdio:['ignore','ignore','pipe'],windowsHide:true});
  // The harness owns command logs; this wrapper retains no credential-bearing
  // child output and never retries a failure or a rotation (exit 75).
  child.stderr.resume();
  const outcome = await new Promise((resolve,reject) => {child.once('error',reject);child.once('close',(exitCode,signal) => resolve({exitCode,signal}));});
  const invocation = {executable:process.execPath,argv:invocationArgs,cwd:sourceRoot,actor:before.actor.id,pid:child.pid,
    startedAt,finishedAt:now(),...outcome};
  assert.equal(outcome.exitCode,0,'Configured gate failed or rotated; no receipt and no automatic retry'); assert.equal(outcome.signal,null);
  assert.deepEqual(await regularReference(beforePath),beforeRef,'BEFORE artifact changed during gate');
  const afterFeature = (await json('.harness/features.json')).features.find(item => item.id === featureId);
  const afterContinuity = await json('.harness/continuity.json');
  assert.equal(afterContinuity.phase,'working'); assert.equal(afterContinuity.handoff,null);
  assert.deepEqual(afterContinuity.owner,before.actor,'Gate worker ownership changed');
  const evidenceRef = await regularReference(afterFeature.evidence.at(-1));
  const evidence = JSON.parse(await authenticate(evidenceRef)); assertGateEvidence(before,afterFeature,evidence);
  const afterBindings = await bindings({...afterFeature,evidence:feature.evidence},config);
  assert.deepEqual(afterBindings,frozen,'Authenticated inputs changed during gate'); await healthyAudit();
  const receipt = {version:1,featureId,reportSelection:selectedReport,runId:before.runId,actor:before.actor,before:beforeRef,evidence:evidenceRef,
    invocation,after:{completedAt:now(),bindingsHash:hash(afterBindings),result:afterBindings.result},sealedAt:now(),
    assurance:'cooperative sole-worker byte preservation across the genuine configured gate',
    repositoryBinding:'statusHash is scope metadata; report bytes are bound by authenticated BEFORE and AFTER references'};
  assertReceiptOrder(before,receipt,evidence);
  await writeFile(relativeFile(gatePath),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return verifySourceGate(gatePath,selectedReport);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length,5); assert(['run','authenticate'].includes(process.argv[2]));
    assert.equal(process.argv[3],'--report'); assert.equal(process.argv[4],selectedReport);
    console.log(JSON.stringify(await (process.argv[2] === 'run' ? runSourceGate() : verifySourceGate(gatePath,selectedReport))));
  } catch (error) { console.error(JSON.stringify({status:'stopped-safely',errorSha256:sha(String(error))}));process.exitCode=1; }
}
