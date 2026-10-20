import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const authorityDirectory = '.harness/source-budget-compat-v1';
export const predecessorPath = `${authorityDirectory}/predecessor.json`;
export const transitionPath = `${authorityDirectory}/transition-v2.json`;
export const originalSourceDigest = '3369d759d025a98e4fa5606036ec7b376b25064ca69a779d875526ac92088f98';
export const originalReportPath = '.harness/native-hook-v2-live-e2e-report.json';
export const originalReportHash = 'adc5e78109d1c6bc33f1f82342a633b2dc3d159a68996692742c879fd2c4c9b6';
export const originalBaselinePath = '.harness/native-hook-rollout-v2/original-baseline.json';
export const originalBaselineHash = 'c2dfe6805937aca2fd4b1180ee4ea1c92d0c16c002142066eb01b28d7b8401d5';
export const aggregateTestPath = 'tests/harness.test.mjs';
export const focusedTestImport = "\nimport './harness-budget-compat.test.mjs';\n";
export const reconstructionPath = `${authorityDirectory}/aggregate-test-reconstruction-v2.json`;
export const reconstructionHash = '1c96abf91e3c61d71d00d55304a8f57eeec67b9587660a5515916f1cf477e63b';
export const correctionAuthority = {
  previousReconstruction: {path:`${authorityDirectory}/aggregate-test-reconstruction.json`,bytes:1294,sha256:'5f9b8fe25a89f745f0bd9e88763df171b1b5aedb8696aca6b8d368579ccd4a8a'},
  previousTransition: {path:`${authorityDirectory}/transition.json`,bytes:15495,sha256:'b9eb923ebfd65c02080f7c804fbd3609962507ce0a81c93a3a9449e37a523c87'},
  failedGateEvidence: {path:'.harness/evidence/2026-10-16T07-50-00-223Z-native-budget-contract-compat-001.json',bytes:732604,sha256:'098ab2eb11f9e4d4638542e9f28fa5f1525fe59cd88ee4e5e24120d71941836b'}
};
export const archivedPaths = [
  'skill/codex-harness/assets/project-runtime.mjs',
  'skill/codex-harness/scripts/lib/core.mjs',
  'tests/harness.test.mjs',
  'skill/codex-harness/references/operations.md',
  'README.md'
];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function relativeFile(relative) {
  assert.equal(typeof relative, 'string');
  assert(relative && !relative.includes('\\') && !relative.includes('\0') && !relative.split('/').includes('..') && !path.isAbsolute(relative));
  const file = path.resolve(sourceRoot, relative);
  assert(file.startsWith(sourceRoot + path.sep));
  return file;
}
export async function authenticate(reference) {
  assert(Number.isSafeInteger(reference?.bytes) && reference.bytes >= 0);
  assert(/^[a-f0-9]{64}$/.test(reference?.sha256));
  const file = relativeFile(reference.path);
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink(), 'Authority files must be regular files');
  const bytes = await readFile(file);
  assert.equal(bytes.length, reference.bytes, 'Authority byte count changed');
  assert.equal(sha(bytes), reference.sha256, 'Authority digest changed');
  return bytes;
}
export function safeArchive(bytes) {
  const contents = bytes.toString('utf8');
  const values = Object.entries(process.env).filter(([key, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value?.length >= 8).map(([,value]) => value);
  assert(!values.some(value => contents.includes(value)), 'Credential value cannot enter a source archive');
  assert(!/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/.test(contents), 'Secret-shaped source values require original digest references');
}
export async function reconstructAggregate(reference) {
  const receiptBytes = await readFile(relativeFile(reconstructionPath));
  assert.equal(sha(receiptBytes), reconstructionHash, 'Supplemental test reconstruction authority changed');
  const receipt = JSON.parse(receiptBytes);
  assert.deepEqual(Object.keys(receipt).sort(), ['version','path','predecessorSha256','sourceIndex','original','changes','suffix','current','correctionAuthority'].sort());
  assert.equal(receipt.version, 2); assert.equal(receipt.path, aggregateTestPath);
  assert.deepEqual(receipt.correctionAuthority, correctionAuthority);
  for (const reference of Object.values(correctionAuthority)) await authenticate(reference);
  assert.equal(receipt.predecessorSha256, '81a16a4ad1c79732210be34ca37ea94b1a72f9b75beaf47089f89331f0aae6f2');
  assert.equal(receipt.sourceIndex, reference.sourceIndex);
  assert.deepEqual(receipt.original, {bytes:reference.bytes,sha256:reference.sha256});
  assert.deepEqual(receipt.suffix, {text:focusedTestImport,bytes:Buffer.byteLength(focusedTestImport),sha256:sha(focusedTestImport)});
  const current = await readFile(relativeFile(aggregateTestPath));
  assert.deepEqual(receipt.current, {bytes:current.length,sha256:sha(current)}, 'Current aggregate test bytes changed');
  assert.equal(current.length, reference.bytes + Buffer.byteLength(focusedTestImport));
  assert(current.subarray(reference.bytes).equals(Buffer.from(focusedTestImport)));
  const approved = [
    {offset:57010,before:'assert.equal(evidence.schemaVersion, 4);',after:'assert.equal(evidence.schemaVersion, 5);'},
    {offset:57053,before:'assert.equal(plan.schemaVersion, 1);',after:'assert.equal(plan.schemaVersion, 2);'},
    {offset:62674,before:'mutate: (record) => { record.schemaVersion = 5; }',after:'mutate: (record) => { record.schemaVersion = 6; }'},
    {offset:62731,before:'pattern: /unsupported evidence schema version 5/',after:'pattern: /unsupported evidence schema version 6/'},
    {offset:62854,before:'mutate: (record) => { record.verificationPlan.schemaVersion = 2; }',after:'mutate: (record) => { record.verificationPlan.schemaVersion = 3; }'},
    {offset:62928,before:'pattern: /unsupported verification-plan schema version 2/',after:'pattern: /unsupported verification-plan schema version 3/'}
  ];
  assert.equal(receipt.changes.length, approved.length);
  const reconstructed = Buffer.from(current.subarray(0,reference.bytes));
  for (const [index, change] of receipt.changes.entries()) {
    const expected = approved[index];
    assert.deepEqual(change, {...expected,bytes:Buffer.byteLength(expected.before),sha256:sha(expected.before),afterSha256:sha(expected.after)});
    assert.equal(Buffer.byteLength(change.before),Buffer.byteLength(change.after));
    assert(reconstructed.subarray(change.offset,change.offset+change.bytes).equals(Buffer.from(change.after)));
    Buffer.from(change.before).copy(reconstructed,change.offset);
  }
  assert.equal(reconstructed.length,reference.bytes);assert.equal(sha(reconstructed),reference.sha256);
  return reconstructed;
}
export async function verifyPredecessor(expectedHash) {
  const bytes = await readFile(relativeFile(predecessorPath));
  assert.equal(sha(bytes), expectedHash, 'Pinned predecessor authority changed');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.sourceRoot, sourceRoot);
  assert.equal(manifest.sourceDigest, originalSourceDigest);
  assert.equal(manifest.baseline.path, originalBaselinePath);
  assert.equal(manifest.baseline.sha256, originalBaselineHash);
  await authenticate(manifest.baseline);
  assert.equal(manifest.report.path, originalReportPath);
  assert.equal(manifest.report.sha256, originalReportHash);
  const report = JSON.parse(await authenticate(manifest.report));
  assert.equal(report.sourceDigest, originalSourceDigest);
  assert.equal(report.artifacts.length, 37);
  assert.deepEqual(manifest.artifacts, report.artifacts);
  for (const reference of [...manifest.artifacts, ...manifest.bindings]) await authenticate(reference);
  assert.equal(new Set(manifest.sourceFiles.map(item => item.path)).size, manifest.sourceFiles.length);
  const sourceSnapshot = {};
  for (const [sourceIndex, reference] of manifest.sourceFiles.entries()) {
    assert.equal(reference.sourceIndex, sourceIndex);
    assert(/^(?:package\.json|bin\/|skill\/codex-harness\/|tests\/)/.test(reference.path));
    let original;
    if (reference.kind === 'original-prefix') {
      assert.equal(reference.path, aggregateTestPath);
      assert.deepEqual(reference.extension, {bytes: Buffer.byteLength(focusedTestImport), sha256: sha(focusedTestImport)});
      original = await reconstructAggregate(reference);
    } else original = reference.archive ? await authenticate(reference.archive) : await authenticate(reference);
    assert.equal(original.length, reference.bytes);
    assert.equal(sha(original), reference.sha256);
    if (reference.archive) assert(archivedPaths.includes(reference.path) && reference.archive.path === `${authorityDirectory}/original-bytes/${reference.sha256}.bin`);
    sourceSnapshot[reference.path] = reference.sha256;
  }
  assert.equal(sha(stable(sourceSnapshot)), originalSourceDigest);
  const artifact = manifest.artifacts.find(item => item.path.endsWith('/source-snapshot.json'));
  assert(artifact);
  assert.deepEqual(JSON.parse(await authenticate(artifact)), sourceSnapshot);
  for (const reference of manifest.extraArchives) {
    assert(archivedPaths.includes(reference.path));
    assert.equal(sha(await authenticate(reference.archive)), reference.sha256);
  }
  return {manifest, sourceSnapshot, report, sha256: expectedHash};
}
