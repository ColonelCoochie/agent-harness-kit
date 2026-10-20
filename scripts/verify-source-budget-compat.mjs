import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot } from './native-hook-auto-update-e2e.mjs';
import { authenticate, originalSourceDigest, predecessorPath, reconstructionPath, reconstructionHash, correctionAuthority, relativeFile, sha, sourceRoot, stable, transitionPath, verifyPredecessor } from './source-budget-compat-authority.mjs';
import { auditHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

export const predecessorHash = '81a16a4ad1c79732210be34ca37ea94b1a72f9b75beaf47089f89331f0aae6f2';
export const compatibilityId = 'native-budget-contract-compat-001';
export const compatibilityContract = '53f2d20dd84705bb0b40925bd3af48d22843f33dc0d7b6fc90e87e6d56b13f7d';
export const compatibilityChanged = ['skill/codex-harness/assets/project-runtime.mjs', 'skill/codex-harness/scripts/lib/core.mjs', 'tests/harness-budget-compat.test.mjs', 'tests/harness.test.mjs'];
export const sourceGatePath = '.harness/source-budget-compat-v1/source-gate.json';
// Set once, after exclusive freeze and independent review; never infer authority from a report.
export const transitionPin = {path:'.harness/source-budget-compat-v1/transition-v2.json',bytes:16203,sha256:'0fd58690339de1404ad0da29a7ae9de6ebf70b7cd1b1ee2997d83252daa05217'};
// Later feature additions require a separately reviewed, exact-byte authorization pin.
export const futureAuthorizationPin = {path:'.harness/source-budget-compat-v1/future-feature-authorization.json',bytes:3166,sha256:'6c141f34b7d9aecfebfbf2e14e507666cbc6d386230738b3f6c9d1a0145af1a7'};

export async function reference(relative) {
  const bytes = await readFile(relativeFile(relative));
  return {path: relative, bytes: bytes.length, sha256: sha(bytes)};
}
export function normalizedContract(feature) {
  const contract = Object.fromEntries(['id','title','description','dependencies','scope','acceptance'].map(key => [key, feature[key]]));
  contract.requiredLayers = feature.requiredLayers ?? ['full'];
  if (Object.hasOwn(feature, 'verificationBudget')) contract.verificationBudget = feature.verificationBudget;
  return contract;
}
function contractHash(feature) {
  const contract = normalizedContract(feature);
  return sha(stable(feature.contract?.version === 2 ? {contract, scopeBaselineHash: feature.contract.scopeBaselineHash} : contract));
}
async function authenticateFutureContract(feature, approved) {
  assert.deepEqual(normalizedContract(feature),approved.shape,'Unapproved added feature contract shape');
  assert.equal(sha(stable(approved.shape)),approved.sha256);
  if (!feature.contract) { assert.equal(feature.status,'not_started');assert.equal(feature.attempts,0);assert.deepEqual(feature.evidence,[]);return; }
  assert.equal(feature.contract.version,2);assert.deepEqual(feature.contract.snapshot,approved.shape);assert.equal(feature.contract.hash,contractHash(feature));
  const ref=feature.scopeBaselineRef;assert(!feature.scopeBaseline);assert.equal(ref.version,1);assert.equal(ref.path,`.harness/baselines/${ref.sha256}.json`);
  const baseline=JSON.parse(await authenticate(ref));
  const shape=Object.fromEntries(['version','head','tree','branch','files','worktreeHash'].map(key=>[key,baseline[key]]));
  if (baseline.capturePolicy) shape.capturePolicy=baseline.capturePolicy;
  assert.equal(sha(stable(shape)),feature.contract.scopeBaselineHash);assert.equal(baseline.baselineHash,ref.baselineHash);assert.equal(ref.baselineHash,feature.contract.scopeBaselineHash);
}
export async function sourceState(predecessor) {
  const baseline = JSON.parse(await authenticate(predecessor.manifest.baseline));
  const target = baseline.targets.find(item => path.resolve(item.root) === sourceRoot);
  assert(target, 'Original SOURCE baseline is required');
  const originalFeatures = target.files['.harness/features.json'];
  const original = JSON.parse(await authenticate(originalFeatures));
  const current = JSON.parse(await readFile(relativeFile('.harness/features.json')));
  assert.equal(new Set(current.features.map(item => item.id)).size, current.features.length);
  const addedContracts = {[compatibilityId]: compatibilityContract};
  assert(futureAuthorizationPin,'Future normalized contracts require an explicit reviewed grant pin');
  const grant = JSON.parse(await authenticate(futureAuthorizationPin));
  assert.equal(grant.version, 1); assert.equal(grant.predecessorHash, predecessorHash);
  assert.deepEqual(Object.keys(grant.contracts).sort(), ['native-hook-v2-live-002', 'native-hook-v2-rollout-002']);
  for (const [id, approved] of Object.entries(grant.contracts)) { assert.equal(approved.shape.id,id);assert(/^[a-f0-9]{64}$/.test(approved.sha256));addedContracts[id]=approved.sha256; }
  const added = current.features.filter(item => !original.features.some(old => old.id === item.id));
  assert.deepEqual(added.map(item => item.id).sort(), Object.keys(addedContracts).sort());
  for (const item of added) {
    if (item.id===compatibilityId) assert.equal(contractHash(item),compatibilityContract,'Compatibility contract changed');
    else await authenticateFutureContract(item,grant.contracts[item.id]);
  }
  for (const old of original.features) {
    const item = current.features.find(candidate => candidate.id === old.id); assert(item, 'Original feature removed');
    if (old.id === 'native-hook-v2-rollout-001') {
      const omitState = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['status','blocker','updatedAt'].includes(key)));
      assert.deepEqual(omitState(item), omitState(old), 'Original active rollout contract/history changed');
      assert.equal(item.status, 'blocked'); assert.equal(typeof item.blocker, 'string'); assert(item.blocker.length > 0);
      assert.equal(contractHash(item), 'ec9fef500da4945cca37d24228447ed770a0a6864ddfd7eee70133dee920a0ae');
    } else assert.deepEqual(item, old, 'Original SOURCE feature changed');
  }
  return {originalFeatures, oldActiveContract:'ec9fef500da4945cca37d24228447ed770a0a6864ddfd7eee70133dee920a0ae', addedContracts, futureAuthorization:futureAuthorizationPin};
}

export async function verifySourceCompatibility() {
  const predecessor = await verifyPredecessor(predecessorHash);
  assert(transitionPin, 'Compatibility transition must have an explicit reviewed byte/hash pin');
  assert.equal(transitionPin.path, transitionPath);
  const bytes = await authenticate(transitionPin);
  const transition = JSON.parse(bytes);
  assert.equal(transition.version, 2);
  assert.equal(transition.featureId, 'native-budget-contract-compat-001');
  assert.equal(transition.sourceRoot, sourceRoot);
  assert.equal(transition.previousSourceDigest, originalSourceDigest);
  assert.equal(transition.predecessor.path, predecessorPath);
  assert.equal(transition.predecessor.sha256, predecessorHash);
  await authenticate(transition.predecessor);
  assert.equal(transition.reconstruction.path, reconstructionPath); assert.equal(transition.reconstruction.sha256, reconstructionHash);
  await authenticate(transition.reconstruction);
  assert.deepEqual(transition.correctionAuthority, correctionAuthority);
  for (const reference of Object.values(correctionAuthority)) await authenticate(reference);
  assert.deepEqual(transition.sourceState, await sourceState(predecessor));
  const current = await snapshot(sourceRoot);
  assert.equal(sha(stable(current)), transition.sourceDigest, 'Current source differs from frozen compatibility transition');
  assert.notEqual(transition.sourceDigest, originalSourceDigest);
  assert.equal(new Set(transition.sourceFiles.map(item => item.path)).size, transition.sourceFiles.length);
  assert.deepEqual(transition.sourceFiles.map(item => item.path), Object.keys(current).sort(), 'Source authority requires complete sorted paths');
  const authenticated = {};
  for (const [sourceIndex, reference] of transition.sourceFiles.entries()) {
    assert.equal(reference.sourceIndex, sourceIndex);
    await authenticate(reference);
    authenticated[reference.path] = reference.sha256;
  }
  assert.deepEqual(authenticated, current);
  const changed = [...new Set([...Object.keys(predecessor.sourceSnapshot), ...Object.keys(current)])]
    .filter(relative => predecessor.sourceSnapshot[relative] !== current[relative]).sort();
  assert.deepEqual(transition.changed, changed);
  assert.deepEqual(changed, compatibilityChanged, 'Compatibility transition requires the exact approved change set');
  return { status: 'passed', sourceDigest: transition.sourceDigest, predecessorHash, transition:transitionPin, reconstruction:transition.reconstruction, historicalArtifacts: predecessor.report.artifacts.length };
}

export async function verifyCompatibilityGate() {
  const authority = await verifySourceCompatibility();
  const receipt = JSON.parse(await readFile(relativeFile(sourceGatePath)));
  assert.equal(receipt.version,1); assert.equal(receipt.featureId,compatibilityId); assert.equal(receipt.contractHash,compatibilityContract);
  assert.equal(receipt.sourceDigest,authority.sourceDigest); assert.deepEqual(receipt.transition,authority.transition); assert.deepEqual(receipt.reconstruction,authority.reconstruction);
  const features = JSON.parse(await readFile(relativeFile('.harness/features.json')));
  const feature = features.features.find(item => item.id === compatibilityId);
  assert.equal(feature.status,'passing'); assert.equal(contractHash(feature),compatibilityContract);
  assert.equal(receipt.evidence.path,feature.evidence.at(-1));
  const evidence = JSON.parse(await authenticate(receipt.evidence));
  assert.equal(evidence.featureId,compatibilityId); assert.equal(evidence.contractHash,compatibilityContract); assert.equal(evidence.pass,true);
  assert.equal(evidence.schemaVersion,5); assert.equal(evidence.verificationPlan.schemaVersion,2);
  assert(evidence.executedLayers.includes('full') && evidence.executedLayers.includes('architecture') && evidence.executedLayers.includes('quick'));
  const required = ['node --test tests/harness.test.mjs','node bin/agent-harness.mjs audit . --min-score 95',...feature.acceptance.map(item => item.command)];
  for (const command of required) assert(evidence.commands.some(item => item.command === command && item.pass && item.exitCode === 0 && !item.timedOut), 'Missing genuine configured gate command');
  assert(evidence.commands.every(item => item.pass && item.exitCode === 0 && !item.timedOut));
  const audit = await auditHarness(sourceRoot); assert.equal(audit.criticalFailures,0); assert(audit.overall >= 95);
  const testedScripts = await testedAuthorityScripts(evidence,authority);
  assert.deepEqual(receipt.authorityScripts,testedScripts);
  return {...authority, gate:await reference(sourceGatePath), evidence:receipt.evidence};
}
const authorityScriptPaths = ['scripts/native-hook-report-selection.mjs','scripts/native-hook-v2-live-e2e.mjs','scripts/prepare-budget-compat-source.mjs','scripts/source-budget-compat-authority.mjs','scripts/verify-native-hook-v2-live-e2e.mjs','scripts/verify-source-budget-compat.mjs'];
export async function compatibilityAcceptance() {
  return {version:1,authority:await verifySourceCompatibility(),authorityScripts:await Promise.all(authorityScriptPaths.map(reference))};
}
async function testedAuthorityScripts(evidence,authority) {
  const commands = evidence.commands.filter(item => item.command === 'node scripts/verify-source-budget-compat.mjs');
  assert.equal(commands.length,1,'Exactly one source compatibility acceptance must bind authority scripts');
  const command = commands[0];
  assert.equal(command.layer,'acceptance'); assert.equal(command.pass,true); assert.equal(command.exitCode,0); assert.equal(command.timedOut,false); assert.equal(command.truncated,false);
  const measured = JSON.parse(command.stdout.trim());
  assert.equal(measured.version,1); assert.deepEqual(measured.authority,authority);
  assert.deepEqual(measured.authorityScripts.map(item => item.path),authorityScriptPaths);
  for (const item of measured.authorityScripts) await authenticate(item);
  return measured.authorityScripts;
}
export async function sealCompatibilityGate() {
  const authority = await verifySourceCompatibility();
  const feature = JSON.parse(await readFile(relativeFile('.harness/features.json'))).features.find(item => item.id === compatibilityId);
  assert.equal(feature.status,'passing');
  const evidenceRef = await reference(feature.evidence.at(-1));
  const evidence = JSON.parse(await authenticate(evidenceRef));
  const authorityScripts = await testedAuthorityScripts(evidence,authority);
  const receipt = {version:1,featureId:compatibilityId,contractHash:compatibilityContract,sourceDigest:authority.sourceDigest,transition:authority.transition,reconstruction:authority.reconstruction,evidence:evidenceRef,authorityScripts};
  await writeFile(relativeFile(sourceGatePath),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return verifyCompatibilityGate();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert(process.argv.length <= 3); const operation=process.argv[2]; assert(operation === undefined || operation === 'seal-gate'); console.log(JSON.stringify(await (operation === 'seal-gate' ? sealCompatibilityGate() : compatibilityAcceptance()))); }
  catch (error) { console.error(JSON.stringify({ status: 'stopped-safely', errorSha256: sha(String(error)) })); process.exitCode = 1; }
}
