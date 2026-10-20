import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { targets, sourceRoot, sha, verifyInstallation } from './verify-context-rollout.mjs';
import {fileURLToPath} from 'node:url';

export async function verifyLegacyReport() {
const { discovery, assertApprovedDefinitions, nativeTrustedHash, validateTrustArtifact } = await import('./native-hook-rollout.mjs');
const report = JSON.parse(await readFile(path.join(sourceRoot, '.harness/native-hook-rollout-report.json'), 'utf8'));
assert.equal(report.version, 1);
assert.deepEqual(report.targets.map(r => r.root), targets);
assert.equal(sha(await readFile(path.join(sourceRoot, report.sourceEvidence))), report.sourceEvidenceHash);
assert.equal(JSON.parse(await readFile(path.join(sourceRoot, report.sourceEvidence), 'utf8')).pass, true);
assert.equal(sha(await readFile(path.join(sourceRoot, '.codex/hooks.json'))), report.sourceHooksHash);
const trust = validateTrustArtifact(report, await readFile(path.join(sourceRoot, '.harness/native-hook-rollout/reviewed-native-trust.json')), targets);
for (const root of targets) assert.equal(sha(await readFile(path.join(root, '.codex/hooks.json'))), trust.rootHooksHashes[root], `${root}: reviewed hook file changed`);
// All intended installations are required. A skipped live owner remains a real blocker.
for (const record of report.targets) {
  assert.equal(record.status, 'trusted', `${record.root}: rollout remains ${record.status}`);
  assert(record.idempotent && record.preservedState);
  const artifact = await readFile(path.join(sourceRoot, record.reviewArtifact));
  assert.equal(sha(artifact), record.reviewArtifactHash);
  const baseline = JSON.parse(artifact).baseline;
  for (const [file, hash] of Object.entries(baseline.evidence)) assert.equal(sha(await readFile(path.join(record.root, file))), hash);
  // Source feature/continuity legitimately changes at verify and worker boundaries.
  if (record.root !== sourceRoot) for (const [file, hash] of Object.entries(baseline.hashes)) assert.equal(sha(await readFile(path.join(record.root, file))), hash, `${record.root}: preserved ${file}`);
  await verifyInstallation(record.root, { preexistingDoctorFailures: record.preexistingDoctorFailures, preservedEvidence: baseline.evidence });
}
const { reviewed } = await discovery('native-acceptance');
assert.equal(reviewed.length, targets.length * 6);
assertApprovedDefinitions(reviewed, trust.definitions);
const globalConfig = await readFile(path.join(process.env.USERPROFILE, '.codex/config.toml'), 'utf8');
for (const d of reviewed) {
  assert.equal(d.trustStatus, 'trusted');
  assert.equal(nativeTrustedHash(globalConfig, d.key), d.currentHash, `${d.root}: actual global trusted_hash`);
}
assertApprovedDefinitions(reviewed, report.targets.flatMap(record => record.nativeTrust ?? []));
console.log(`PASS native hook rollout: all ${targets.length} installations and ${reviewed.length} exact trusted definitions authenticated.`);

}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length===0)await verifyLegacyReport();
 else{assert.equal(args.length,2);assert.equal(args[0],'--superseding-report');assert.equal(args[1],'.harness/native-hook-v2-rollout-002-report.json');const {verifySelectedReport}=await import('./verify-native-hook-rollout-v2.mjs');console.log(JSON.stringify(await verifySelectedReport(args[1])));}
}
