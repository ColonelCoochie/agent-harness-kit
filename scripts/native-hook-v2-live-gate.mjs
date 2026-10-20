import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticate, relativeFile, sha, sourceRoot, stable} from './source-budget-compat-authority.mjs';
import {futureAuthorizationPin, normalizedContract, reference, sourceGatePath, transitionPin, verifyCompatibilityGate} from './verify-source-budget-compat.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';
import {snapshot} from './native-hook-auto-update-e2e.mjs';
import {auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';

export const featureId = 'native-hook-v2-live-002';
export const selectedReport = '.harness/native-hook-v2-live-002-e2e-report.json';
export const gateDirectory = '.harness/native-hook-v2-live-002-gate';
export const beforePath = `${gateDirectory}/before.json`;
export const gatePath = `${gateDirectory}/receipt.json`;
export const helperPath = 'scripts/native-hook-v2-live-gate.mjs';
export const acceptanceCommand = `node scripts/verify-native-hook-v2-live-e2e.mjs --report ${selectedReport}`;
const sourceDigest = '97d64567ecede9787105a0fd9c6535cc15b1a5eab15d0e8ba8d4b42c10ca82e9';
const reportPin = {path:selectedReport,bytes:22172,sha256:'35c225f98417b19c8e8eb58285f8f89868e12b75df70415df1cc09e294a93939'};
const compatibilityHash = 'f56c453055a5dd33eed757683c3d1fd5755037c88e2e0843ca2211a8e9e7dfb9';
const contractPin = 'a2434d089350981b3b31a43e7cf5816ce4d8720f3cb9bd0e01ec7b8b2e7ed14a';
const invocationArgs = ['.harness/run.mjs','verify',featureId];
const json = async relative => JSON.parse(await readFile(relativeFile(relative),'utf8'));
const hash = value => sha(stable(value));
const now = () => new Date().toISOString();
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort());

// The native verifier captures report selection at import time. Every caller
// must establish the exact explicit argv selection before this dynamic import.
async function nativeVerifier() {
  const positions = process.argv.flatMap((arg,index) => arg === '--report' ? [index] : []);
  assert.equal(positions.length,1,'Exactly one explicit report selection is required');
  assert.equal(process.argv[positions[0]+1],selectedReport);
  assert(!process.argv.some(arg => arg.startsWith('--report=')));
  return (await import('./verify-native-hook-v2-live-e2e.mjs')).verifyNativeReport;
}

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

function nestedReferences(value, output) {
  if (!value || typeof value !== 'object') return;
  // Original source identities reconstructed from archives are not references
  // to today's file bytes. Their actual archive references remain traversed.
  if (typeof value.path === 'string' && Number.isSafeInteger(value.bytes) && /^[a-f0-9]{64}$/.test(value.sha256)
      && !value.archive && value.kind !== 'original-prefix') output.push({path:value.path,bytes:value.bytes,sha256:value.sha256});
  for (const child of Object.values(value)) nestedReferences(child,output);
}

async function closure(roots) {
  const pending = roots.map(({path,bytes,sha256}) => ({path,bytes,sha256})), found = new Map();
  while (pending.length) {
    const ref = pending.shift(), previous = found.get(ref.path);
    if (previous) { assert.deepEqual(previous,ref,'Conflicting authority references'); continue; }
    assert.deepEqual(await regularReference(ref.path),ref);
    const bytes = await authenticate(ref);
    found.set(ref.path,ref);
    // Authority containers declare repository references. Report artifacts and
    // archived feature state are authenticated leaf data: their internal paths
    // can belong to a historical fixture repository rather than SOURCE.
    const container = [selectedReport,sourceGatePath,transitionPin.path,futureAuthorizationPin.path,
      '.harness/source-budget-compat-v1/predecessor.json',
      '.harness/source-budget-compat-v1/aggregate-test-reconstruction-v2.json',
      '.harness/native-hook-v2-live-e2e-report.json',
      '.harness/native-hook-rollout-v2/original-baseline.json'].includes(ref.path);
    if (container) {
      const next = []; nestedReferences(JSON.parse(bytes),next); pending.push(...next);
    }
  }
  return [...found.values()].sort((a,b) => a.path.localeCompare(b.path));
}

function featureBinding(feature) {
  const shape = normalizedContract(feature);
  assert.equal(feature.contract?.version,2); assert.equal(feature.contract.hash,contractPin);
  assert.deepEqual(feature.contract.snapshot,shape);
  assert.equal(hash({contract:shape,scopeBaselineHash:feature.contract.scopeBaselineHash}),contractPin);
  assert(!Object.hasOwn(feature,'verificationBudget'),'The reviewed contract has no feature budget');
  assert.deepEqual(feature.acceptance.map(item => item.command),[acceptanceCommand]);
  return {shape,contract:feature.contract,baseline:feature.scopeBaselineRef};
}

async function bindings(feature, config) {
  assert.deepEqual(await json('.harness/config.json'),config,'Configuration changed');
  const authority = await verifyCompatibilityGate();
  assert.equal(authority.sourceDigest,sourceDigest);
  assert.deepEqual(authority.transition,transitionPin);
  assert.equal(authority.gate.sha256,compatibilityHash);
  const report = JSON.parse(await authenticate(reportPin));
  assert.equal(report.artifacts.length,37);
  await inspectReportLocation(sourceRoot,selectedReport);
  const result = await (await nativeVerifier())(report);
  const binding = featureBinding(feature);
  const baseline = JSON.parse(await authenticate(binding.baseline));
  assert.equal(baseline.baselineHash,binding.contract.scopeBaselineHash);
  const roots = [reportPin,authority.gate,transitionPin,futureAuthorizationPin,binding.baseline,
    await regularReference('.harness/config.json'),await regularReference(helperPath),
    ...await Promise.all(feature.evidence.map(regularReference))];
  const references = await closure(roots);
  const source = await snapshot(sourceRoot); assert.equal(hash(source),sourceDigest);
  assert.equal(config.policies.maxAttempts,5); assert.equal(config.policies.maxRepeatedFailures,2);
  return {report:reportPin,authority,feature:binding,config:await regularReference('.harness/config.json'),
    configHash:hash(config),helper:await regularReference(helperPath),sourceDigest,references,result};
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
  assert.equal(commands.length,1); assert.equal(commands[0].command,acceptanceCommand);
  assert.equal(commands[0].truncated,false); assert.equal(commands[0].stderr,'');
  assert.equal(commands[0].originalBytes,Buffer.byteLength(commands[0].stdout));
  assert.deepEqual(JSON.parse(commands[0].stdout.trim()),before.bindings.result,'Acceptance booleans differ from strict native verification');
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
  assert.equal(reportSelection,selectedReport,'Explicit selected live002 report is required');
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
  const evidence = JSON.parse(await authenticateGateReference(receipt.evidence));
  assertGateEvidence(before,feature,evidence); assertReceiptOrder(before,receipt,evidence);
  const prefixFeature = {...feature,evidence:before.evidencePrefix.map(item => item.path)};
  assert.deepEqual(await bindings(prefixFeature,before.config),before.bindings,'Authenticated inputs changed after gate');
  await healthyAudit();
  return {pass:true,version:1,actualConfiguredGate:true,allReferencesAuthenticated:true,latestPassingEvidence:true,
    cooperativeBytePreservation:true,strictNativeResult:true};
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
