import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticate, relativeFile, sha, sourceRoot, stable, snapshot, normalizedContract, reference, gatePath as sourceGatePath, transitionPin, predecessorPin, futureShapes, verifyWindowsContainmentGate} from './source-windows-containment-authority.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';

import {auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';

export const featureId = 'native-hook-v2-live-003';
export const originalReport = '.harness/native-hook-v2-live-003-e2e-report.json';
export const selectedReport = '.harness/native-hook-v2-live-003-e2e-report-v3.json';
export const gateDirectory = '.harness/native-hook-v2-live-003-gate';
export const beforePath = `${gateDirectory}/before.json`;
export const gatePath = `${gateDirectory}/receipt.json`;
export const helperPath = 'scripts/live003-windows-containment-gate.mjs';
export const acceptanceCommand = `node scripts/verify-live003-windows-containment-e2e.mjs --report ${originalReport}`;
const sourceDigest = 'c2a5be3544cb1b7da9444c589f05b6e9dfe22103349e25e1ae223a2eb9278877';
const sourceGatePin = {path:sourceGatePath,bytes:10574,sha256:'db161bc9d7e3658d828368195954cdb21d82130a11e58e4bf9dc0783d0329693'};
const contractPin = '1674cd5f2f4c51d5ea7976203e6bc55be6e9c56f0e2fc44ce17f9edb2a7aebf1';
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
  assert([originalReport,selectedReport].includes(process.argv[positions[0]+1]));
  assert(!process.argv.some(arg => arg.startsWith('--report=')));
  return (await import('./verify-live003-windows-containment-e2e.mjs')).verifyNativeReport;
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

export const helperReviewPath = '.harness/native-hook-v2-live-003-helper-review-v3.json';
export const helperFreezePath = '.harness/native-hook-v2-live-003-helper-freeze-v3.json';
export const selectionPath = '.harness/native-hook-v2-live-003-successor-selection-v3.json';
export const recoveryPath = '.harness/native-hook-v2-live-003-blocked-cleaned-v3.json';
export const predecessorArchivePin = {path:'.harness/native-hook-v2-live-003-repair-v2/predecessor-archive.json',bytes:16696,sha256:'4f2f245a82fcb79435e1ade885de6135db714c5e6c79c26e95bc9084bc4747dd'};
export const archivePin = {path:'.harness/native-hook-v2-live-003-repair-v3/predecessor-archive.json',bytes:86898,sha256:'736487dbf37933b45b1f5ccf30e9574c26acdd7fca62044476427b0b970fe6dc'};
const predecessorReviewPath = '.harness/native-hook-v2-live-003-helper-review-v2.json';
const predecessorReport = '.harness/native-hook-v2-live-003-e2e-report-v2.json';
const originalReviewPath = '.harness/native-hook-v2-live-003-helper-review.json';
export const helperPaths = [
  'scripts/live003-windows-containment-e2e.mjs',
  'scripts/verify-live003-windows-containment-e2e.mjs',
  'scripts/live003-windows-containment-gate.mjs',
  'scripts/live003-windows-containment-gate.test.mjs',
  'scripts/source-windows-containment-authority.mjs',
  'scripts/verify-source-windows-containment.mjs',
  'scripts/native-hook-report-selection.mjs',
  'scripts/live-host-e2e/native-client.mjs'
];

export function assertHelperReview(review,freeze,observedAt = now()) {
  keys(freeze,['version','featureId','createdAt','actor','review','helpers',...(freeze.version>=2?['predecessorArchive','reportSelection','originalReport']:[])]);
  assert([1,2,3].includes(freeze.version)); assert.equal(freeze.featureId,featureId);
  if(freeze.version>=2){assert.deepEqual(freeze.predecessorArchive,freeze.version===2?predecessorArchivePin:archivePin);assert.equal(freeze.reportSelection,freeze.version===2?predecessorReport:selectedReport);assert.equal(freeze.originalReport,originalReport);}
  keys(freeze.actor,['source','id']);
  assert.equal(freeze.actor.source,'CODEX_THREAD_ID');
  const identity = value => assert(typeof value === 'string' && value.trim() === value && value.length > 0);
  identity(freeze.actor.id);
  const timestamp = value => {
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)));
    assert.equal(new Date(value).toISOString(),value); return Date.parse(value);
  };
  assert(timestamp(freeze.createdAt) <= timestamp(observedAt));
  assert([helperReviewPath,predecessorReviewPath,originalReviewPath].includes(freeze.review.path));
  if(freeze.version>=2)assert.equal(freeze.review.path,freeze.version===2?predecessorReviewPath:helperReviewPath);
  keys(freeze.review,['path','bytes','sha256']);
  assert(Number.isSafeInteger(freeze.review.bytes) && freeze.review.bytes > 0 && /^[a-f0-9]{64}$/.test(freeze.review.sha256));
  assert.deepEqual(freeze.helpers.map(item => item.path),helperPaths);
  for (const helper of freeze.helpers) {
    keys(helper,['path','bytes','sha256']);
    assert(Number.isSafeInteger(helper.bytes) && helper.bytes > 0 && /^[a-f0-9]{64}$/.test(helper.sha256));
  }
  keys(review,['version','featureId','reviewedAt','reviewer','outcome','findings','helpers']);
  assert.equal(review.version,1); assert.equal(review.featureId,featureId);
  keys(review.reviewer,['source','id','readOnly']);
  assert.equal(review.reviewer.source,'CODEX_THREAD_ID'); identity(review.reviewer.id);
  assert.notEqual(review.reviewer.id,freeze.actor.id,'Independent fresh reviewer required');
  assert.equal(review.reviewer.readOnly,true);
  assert.equal(review.outcome,'clean'); assert.deepEqual(review.findings,[]);
  assert.deepEqual(review.helpers,freeze.helpers,'Review must bind the final helper bytes');
  assert(timestamp(review.reviewedAt) <= timestamp(freeze.createdAt));
}

export async function authenticateHelperFreeze() {
  const ref = await regularReference(helperFreezePath);
  const freeze = JSON.parse(await authenticate(ref));
  for (const helper of freeze.helpers) await authenticateGateReference(helper);
  const review = JSON.parse(await authenticateGateReference(freeze.review));
  assertHelperReview(review,freeze);
  assert.equal(freeze.version,3,'Repaired helpers require the renewed freeze');
  await authenticatePredecessorArchive();
  return ref;
}

export async function createHelperFreeze() {
  assert(process.env.CODEX_THREAD_ID);
  await inspectReportLocation(sourceRoot,helperFreezePath,{absent:true});
  await authenticatePredecessorArchive();
  const freeze = {version:3,featureId,createdAt:now(),actor:{source:'CODEX_THREAD_ID',id:process.env.CODEX_THREAD_ID},predecessorArchive:archivePin,reportSelection:selectedReport,originalReport,
    review:await regularReference(helperReviewPath),helpers:await Promise.all(helperPaths.map(regularReference))};
  // Validate the reviewer and all byte bindings before the exclusive write.
  const review = JSON.parse(await authenticate(freeze.review));
  assertHelperReview(review,freeze);
  await writeFile(relativeFile(helperFreezePath),JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});
  return authenticateHelperFreeze();
}

async function authenticateArchivedHelpers(archive,version,freezeVersion) {
  assert.equal(archive.version,version);assert.equal(archive.featureId,featureId);
  assert.equal(archive.report.path,originalReport);
  const changed=new Set(helperPaths.slice(0,4));
  assert(Array.isArray(archive.archived));
  for(const entry of archive.archived){
    const bytes=await authenticateGateReference(entry.archive);
    assert.equal(entry.archive.bytes,entry.original.bytes);assert.equal(entry.archive.sha256,entry.original.sha256);
    if(!changed.has(entry.original.path))await authenticateGateReference(entry.original);
    assert.equal(sha(bytes),entry.original.sha256);
  }
  assert.equal(new Set(archive.archived.map(entry=>entry.original.path)).size,archive.archived.length);
  const frozen=JSON.parse(await authenticateGateReference(archive.freeze));
  const reviewed=JSON.parse(await authenticateGateReference(archive.review));
  assertHelperReview(reviewed,frozen);assert.equal(frozen.version,freezeVersion);
  assert.equal(frozen.review.path,freezeVersion===1?originalReviewPath:predecessorReviewPath);
  for(const ref of frozen.helpers)assert(archive.archived.some(entry=>stable(entry.original)===stable(ref)));
  assert.deepEqual(archive.sourceAuthority,await verifyWindowsContainmentGate());
}

export async function authenticatePredecessorArchive() {
  const predecessor=JSON.parse(await authenticateGateReference(predecessorArchivePin));
  await authenticateArchivedHelpers(predecessor,1,1);
  const archive=JSON.parse(await authenticateGateReference(archivePin));
  assert.deepEqual(archive.predecessorArchive,predecessorArchivePin);
  await authenticateArchivedHelpers(archive,2,2);
  assert.deepEqual(archive.sourceAuthority,predecessor.sourceAuthority);
  assert.deepEqual(archive.report,predecessor.report);
  assert(Array.isArray(archive.authorityClosure)&&archive.authorityClosure.length>0);
  assert.equal(new Set(archive.authorityClosure.map(ref=>ref.path)).size,archive.authorityClosure.length);
  for(const ref of archive.authorityClosure)await authenticateGateReference(ref);
  for(const ref of [archive.freeze,archive.review,archive.selection,archive.predecessorArchive,...archive.blockers])
    assert(archive.archived.some(entry=>stable(entry.original)===stable(ref)));
  return archive;
}

export function assertSuccessorSelection(selection,freeze) {
  keys(selection,['version','featureId','createdAt','originalReport','originalAcceptanceCommand','reportSelection','helperFreeze','predecessorArchive']);
  assert.equal(selection.version,1);assert.equal(selection.featureId,featureId);
  assert.equal(selection.originalReport,originalReport);assert.equal(selection.originalAcceptanceCommand,acceptanceCommand);
  assert.equal(selection.reportSelection,selectedReport);assert.deepEqual(selection.helperFreeze,freeze);
  assert.equal(freeze.path,helperFreezePath);assert.deepEqual(selection.predecessorArchive,archivePin);
  assert.equal(new Date(selection.createdAt).toISOString(),selection.createdAt);
}

export async function authenticateSuccessorSelection() {
  const ref=await regularReference(selectionPath),selection=JSON.parse(await authenticate(ref));
  assertSuccessorSelection(selection,await authenticateHelperFreeze());
  return ref;
}

export async function createSuccessorSelection() {
  await inspectReportLocation(sourceRoot,selectionPath,{absent:true});
  const freeze=await authenticateHelperFreeze();
  const selection={version:1,featureId,createdAt:now(),originalReport,originalAcceptanceCommand:acceptanceCommand,reportSelection:selectedReport,helperFreeze:freeze,predecessorArchive:archivePin};
  assertSuccessorSelection(selection,freeze);
  await writeFile(relativeFile(selectionPath),JSON.stringify(selection,null,2)+'\n',{flag:'wx'});
  return authenticateSuccessorSelection();
}

export function assertSelectedReportBindings(report,{selection,freeze,recovery}) {
  assert.equal(report.reportSelection,selectedReport);
  assert.equal(selection.path,selectionPath);assert.equal(freeze.path,helperFreezePath);assert.equal(recovery.path,recoveryPath);
  assert.deepEqual(report.successorSelection,selection,'Selected manifest bytes must match the report binding');
  assert.deepEqual(report.helperFreeze,freeze);assert.deepEqual(report.predecessorRecovery,recovery);
}

const managedExecutables = [
  ['project-runtime.mjs','.harness/run.mjs','always'],
  ['windows-command.mjs','.harness/windows-command.mjs','always'],
  ['windows-command-supervisor.ps1','.harness/windows-command-supervisor.ps1','always'],
  ['context-budget.mjs','.harness/context-budget.mjs','always'],
  ['repair.mjs','.harness/repair.mjs','always'],
  ['hook-recovery.mjs','.harness/hooks/hook-recovery.mjs','shared'],
  ['native-hook-dispatch.mjs','.harness/hooks/native-hook-dispatch.mjs','shared'],
  ['native-hook-bootstrap-v1.json','.harness/hooks/native-hook-bootstrap-v1.json','shared'],
  ['native-hook-bootstrap-v2.json','.harness/hooks/native-hook-bootstrap-v2.json','shared'],
  ['context-guard.mjs','.harness/hooks/context-guard.mjs','shared'],
  ['native-hook-identity.mjs','.harness/hooks/native-hook-identity.mjs','shared'],
  ['precompact-handoff.mjs','.harness/hooks/precompact-handoff.mjs','shared'],
  ['sessionstart-routing.mjs','.harness/hooks/sessionstart-routing.mjs','shared'],
  ['claude-worker-identity.mjs','.harness/hooks/claude-worker-identity.mjs','claude']
];

export function managedExecutableSelection(enabled) {
  assert(Array.isArray(enabled) && enabled.length > 0);
  assert.equal(new Set(enabled).size,enabled.length);
  assert(enabled.every(agent => ['codex','claude','github-copilot'].includes(agent)));
  return managedExecutables.filter(([, ,kind]) => kind === 'always'
    || kind === 'shared' && enabled.some(agent => ['codex','claude'].includes(agent))
    || kind === 'claude' && enabled.includes('claude'));
}

async function fixtureBytes(root,relative) {
  assert(relative && !relative.includes('\\') && !relative.includes(':')
    && relative.split('/').every(part => part && part !== '.' && part !== '..'));
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current,part); const info = await lstat(current);
    assert(!info.isSymbolicLink(),'Installed inventory rejects symlink components');
    assert(current === path.join(root,relative) ? info.isFile() : info.isDirectory());
  }
  return readFile(current);
}

export async function captureInstalledInventory(root,archive) {
  const configBytes = await fixtureBytes(root,'.harness/config.json');
  const config = JSON.parse(configBytes), enabled = config.agents.enabled;
  const inventoryBytes = await fixtureBytes(root,'.harness/managed-files.json');
  const inventory = JSON.parse(inventoryBytes), selected = managedExecutableSelection(enabled);
  assert.equal(inventory.version,1);
  assert.deepEqual(Object.keys(inventory.files).sort(),selected.map(([,installed]) => installed).sort(),'Installed inventory must be complete and exclusive');
  const entries = [];
  for (const [index,[asset,installed]] of selected.entries()) {
    const source = `skill/codex-harness/assets/${asset}`;
    const bytes = await fixtureBytes(root,installed), canonical = await readFile(relativeFile(source));
    assert.equal(sha(bytes),inventory.files[installed],'Installed inventory hash is stale');
    assert.deepEqual(bytes,canonical,'Installed managed executable differs from sealed SOURCE');
    entries.push({source,installed,sourceReference:await regularReference(source),
      installedArchive:await archive(`installed-executable-${index}${path.extname(asset)}`,bytes),
      sourceArchive:await archive(`source-executable-${index}${path.extname(asset)}`,canonical)});
  }
  return {version:1,enabled:[...enabled],config:await archive('installed-inventory-config.json',configBytes),
    inventory:await archive('installed-managed-files.json',inventoryBytes),entries};
}

export async function assertInstalledInventory(proof,artifacts) {
  assert.equal(proof.version,1);
  const unique = new Map(artifacts.map(item => [item.path,item]));
  assert.equal(unique.size,artifacts.length);
  const load = async ref => {
    assert.deepEqual(unique.get(ref.path),ref,'Inventory archive must uniquely bind an authenticated report artifact');
    return authenticateGateReference(ref);
  };
  const config = JSON.parse(await load(proof.config)), inventory = JSON.parse(await load(proof.inventory));
  assert.deepEqual(proof.enabled,config.agents.enabled);
  const selected = managedExecutableSelection(proof.enabled);
  assert.equal(inventory.version,1);
  assert.deepEqual(Object.keys(inventory.files).sort(),selected.map(([,installed]) => installed).sort());
  assert.equal(proof.entries.length,selected.length);
  for (const [index,[asset,installed]] of selected.entries()) {
    const entry = proof.entries[index];
    assert.equal(entry.source,`skill/codex-harness/assets/${asset}`); assert.equal(entry.installed,installed);
    assert.equal(entry.sourceReference.path,entry.source);
    const source = await authenticateGateReference(entry.sourceReference);
    const archivedSource = await load(entry.sourceArchive), archivedInstalled = await load(entry.installedArchive);
    assert.deepEqual(archivedSource,source); assert.deepEqual(archivedInstalled,source);
    assert.equal(sha(archivedInstalled),inventory.files[installed]);
  }
  return true;
}

export function nestedReferences(value,output = []) {
  if (!value || typeof value !== 'object') return output;
  if (typeof value.path === 'string' && Number.isSafeInteger(value.bytes) && /^[a-f0-9]{64}$/.test(value.sha256)
      && value.kind !== 'original-prefix') {
    // Historical source identity binds its immutable archive, never today's source.
    output.push({path:typeof value.archive === 'string' ? value.archive : value.path,bytes:value.bytes,sha256:value.sha256});
  }
  for (const child of Object.values(value)) nestedReferences(child,output);
  return output;
}

export async function authorityClosure(roots,{containers = new Set(),readReference = authenticateGateReference} = {}) {
  const pending = [...roots], found = new Map();
  while (pending.length) {
    const {path:relative,bytes,sha256} = pending.shift(), ref = {path:relative,bytes,sha256};
    const previous = found.get(relative);
    if (previous) { assert.deepEqual(previous,ref,'Conflicting authority references'); continue; }
    const data = await readReference(ref); found.set(relative,ref);
    if (containers.has(relative)) {
      const body=JSON.parse(data);
      if([archivePin.path,predecessorArchivePin.path].includes(relative)){
        assert.deepEqual(ref,relative===archivePin.path?archivePin:predecessorArchivePin,'Only the finite pinned archives may supply historical references');
        // Original helper references describe frozen predecessor bytes. Follow their
        // immutable copies; current helper bytes are bound separately by the V3 freeze.
        const {archived,...metadata}=body;assert(Array.isArray(archived));
        pending.push(...nestedReferences(metadata),...archived.flatMap(entry=>nestedReferences(entry.archive)));
      }else pending.push(...nestedReferences(body));
    }
  }
  return [...found.values()].sort((a,b) => a.path.localeCompare(b.path));
}

export async function sourceAuthorityContainers(authority,{readReference = authenticateGateReference} = {}) {
  const transition = JSON.parse(await readReference(authority.transition));
  const grant = JSON.parse(await readReference(authority.futureGrant));
  const predecessor = JSON.parse(await readReference(predecessorPin));
  const dynamic = [transition.repair.result,transition.repair.review,grant.normalizationProof,predecessor.featureState];
  assert(dynamic.every(ref => ref && typeof ref.path === 'string'));
  return new Set([selectedReport,sourceGatePath,authority.transition.path,authority.futureGrant.path,predecessorPin.path,
    helperFreezePath,helperReviewPath,selectionPath,archivePin.path,predecessorArchivePin.path,...dynamic.map(ref => ref.path)]);
}

export function assertArtifactStringReferences(value,artifacts,directory) {
  const paths = new Set(artifacts.map(item => item.path)); assert.equal(paths.size,artifacts.length);
  const visit = item => {
    if (typeof item === 'string' && item.startsWith(directory+'/')) assert(paths.has(item),'String artifact reference must resolve uniquely');
    else if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child);
  };
  visit(value);
}

export function assertRawLogPreview(command,stdout,stderr,limit = 6000) {
  assert.equal(command.stdout,stdout.slice(-limit),'stdout preview differs from authenticated complete log');
  assert.equal(command.stderr,stderr.slice(-limit),'stderr preview differs from authenticated complete log');
  const omitted = '\n[OUTPUT OMITTED: oversized uninterrupted span]\n';
  const truncated = stdout.includes(omitted) || stderr.includes(omitted) || stdout.length > limit || stderr.length > limit || (stdout.slice(-limit)+stderr.slice(-limit)).length > limit;
  assert.equal(command.truncated,truncated,'Truncation metadata must describe complete logs truthfully');
  // Original bytes precede sanitization: redaction can expand a short secret and
  // oversized-span suppression can shrink it. The redacted logs cannot recover
  // that count; evidence authenticates it while this check validates its domain.
  assert(Number.isSafeInteger(command.originalBytes) && command.originalBytes >= 0,'Original output byte count must be a nonnegative integer');
}

export async function assertRawCommandLogs(evidence,{getReference = regularReference,readReference = authenticate,sealedLogs} = {}) {
  const references = [];
  assert.equal(new Set(evidence.commands.map(command => command.executionId)).size,evidence.commands.length);
  for (const command of evidence.commands) {
    assert(command.logs && command.logs.stdout !== command.logs.stderr);
    const streams = [];
    for (const stream of ['stdout','stderr']) {
      assert(command.logs[stream].startsWith('.harness/logs/'));
      const ref = await getReference(command.logs[stream]);
      references.push({executionId:command.executionId,stream,reference:ref});
      streams.push((await readReference(ref)).toString('utf8'));
    }
    assertRawLogPreview(command,...streams);
  }
  assert.equal(new Set(references.map(item => item.reference.path)).size,references.length,'Every execution stream needs a distinct complete log');
  if (sealedLogs !== undefined) assert.deepEqual(references,sealedLogs,'Complete gate log bytes changed after sealing');
  return references;
}

function featureBinding(feature) {
  const shape = normalizedContract(feature);
  assert.equal(feature.contract?.version,2); assert.equal(feature.contract.hash,contractPin);
  assert.deepEqual(feature.contract.snapshot,shape);
  assert.equal(hash({contract:shape,scopeBaselineHash:feature.contract.scopeBaselineHash}),contractPin);
  assert.deepEqual(shape,futureShapes[featureId],'Pinned authorized future shape changed');
  assert.deepEqual(feature.acceptance.map(item => item.command),[acceptanceCommand]);
  return {shape,contract:feature.contract,baseline:feature.scopeBaselineRef};
}

async function bindings(feature, config) {
  assert.deepEqual(await json('.harness/config.json'),config,'Configuration changed');
  const authority = await verifyWindowsContainmentGate();
  assert.equal(authority.sourceDigest,sourceDigest);
  assert.deepEqual(authority.transition,transitionPin);
  assert.deepEqual(authority.gate,sourceGatePin);
  const helperFreeze = await authenticateHelperFreeze();
  const successorSelection = await authenticateSuccessorSelection();
  const reportPin = await regularReference(selectedReport);
  const report = JSON.parse(await authenticate(reportPin));
  await inspectReportLocation(sourceRoot,selectedReport);
  const result = await (await nativeVerifier())(report);
  const binding = featureBinding(feature);
  const baseline = JSON.parse(await authenticate(binding.baseline));
  assert.equal(baseline.baselineHash,binding.contract.scopeBaselineHash);
  const roots = [reportPin,authority.gate,transitionPin,authority.futureGrant,predecessorPin,helperFreeze,successorSelection,binding.baseline,
    await regularReference('.harness/config.json'),await regularReference(helperPath),
    ...await Promise.all(feature.evidence.map(regularReference))];
  const containers = await sourceAuthorityContainers(authority);
  assertArtifactStringReferences(report,report.artifacts,report.artifactDirectory);
  const references = await authorityClosure(roots,{containers});
  const source = await snapshot(sourceRoot); assert.equal(hash(source),sourceDigest);
  assert.equal(config.policies.maxAttempts,5); assert.equal(config.policies.maxRepeatedFailures,2);
  return {report:reportPin,authority,feature:binding,config:await regularReference('.harness/config.json'),
    configHash:hash(config),helper:await regularReference(helperPath),helperFreeze,sourceDigest,references,result};
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
  assert.equal(reportSelection,selectedReport,'Explicit selected LIVE003 report is required');
  assert.equal(relative,gatePath,'Only the exclusive selected LIVE003 receipt is authorized');
  const receipt = JSON.parse(await authenticate(await regularReference(relative)));
  keys(receipt,['version','featureId','reportSelection','runId','actor','before','evidence','logs','invocation','after','sealedAt','assurance','repositoryBinding']);
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
  assert.equal(receipt.evidence.path,feature.evidence.at(-1),'Receipt must bind the latest passing LIVE003 evidence');
  for (const ref of before.evidencePrefix) await authenticateGateReference(ref);
  const evidence = JSON.parse(await authenticateGateReference(receipt.evidence));
  assertGateEvidence(before,feature,evidence); await assertRawCommandLogs(evidence,{sealedLogs:receipt.logs}); assertReceiptOrder(before,receipt,evidence);
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
  const evidence = JSON.parse(await authenticate(evidenceRef)); assertGateEvidence(before,afterFeature,evidence); const logs = await assertRawCommandLogs(evidence);
  const afterBindings = await bindings({...afterFeature,evidence:feature.evidence},config);
  assert.deepEqual(afterBindings,frozen,'Authenticated inputs changed during gate'); await healthyAudit();
  const receipt = {version:1,featureId,reportSelection:selectedReport,runId:before.runId,actor:before.actor,before:beforeRef,evidence:evidenceRef,
    logs,invocation,after:{completedAt:now(),bindingsHash:hash(afterBindings),result:afterBindings.result},sealedAt:now(),
    assurance:'cooperative sole-worker byte preservation across the genuine configured gate',
    repositoryBinding:'statusHash is scope metadata; report bytes are bound by authenticated BEFORE and AFTER references'};
  assertReceiptOrder(before,receipt,evidence);
  await writeFile(relativeFile(gatePath),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return verifySourceGate(gatePath,selectedReport);
}

async function runCli() {
try {
    assert.equal(process.argv.length,5); assert(['run','authenticate'].includes(process.argv[2]));
    assert.equal(process.argv[3],'--report'); assert.equal(process.argv[4],selectedReport);
    console.log(JSON.stringify(await (process.argv[2] === 'run' ? runSourceGate() : verifySourceGate(gatePath,selectedReport))));
  } catch (error) { console.error(JSON.stringify({status:'stopped-safely',errorSha256:sha(String(error))}));process.exitCode=1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli();
}
