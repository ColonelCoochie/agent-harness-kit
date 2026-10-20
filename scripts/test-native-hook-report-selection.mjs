import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { defaultAutoUpdateReport, selectReport, reportArtifactDirectory, inspectReportLocation } from './native-hook-report-selection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fresh = '.harness/native-hook-auto-update-v2-post-rollout-e2e-report.json';

test('actual V2 preparation rejects an occupied report or artifact namespace before authority or native work', async () => {
  const selected = `.harness/v2-selection-test-${randomUUID()}-report.json`;
  const artifacts = path.join(root, reportArtifactDirectory(selected));
  const run = () => spawnSync(process.execPath, ['scripts/native-hook-v2-live-e2e.mjs', '--phase', 'prepare', '--report', selected], { cwd: root, encoding: 'utf8', windowsHide: true });
  const bytes = '{"sentinel":"preserve exactly"}\n';
  await writeFile(path.join(root, selected), bytes, { flag:'wx' });
  try {
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /target already exists/);
    assert.equal(await readFile(path.join(root, selected), 'utf8'), bytes); await assert.rejects(access(artifacts), {code:'ENOENT'});
  } finally { await unlink(path.join(root, selected)); }
  await mkdir(artifacts);
  try {
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /target already exists/);
    await assert.rejects(access(path.join(root, selected)), {code:'ENOENT'});
  } finally { await rmdir(artifacts); }
});

test('actual V2 driver requires an explicit fresh selection and verifier never falls back', () => {
  for (const phase of ['prepare','native','cleanup']) {
    const result = spawnSync(process.execPath, ['scripts/native-hook-v2-live-e2e.mjs', '--phase', phase], {cwd:root,encoding:'utf8',windowsHide:true});
    assert.notEqual(result.status,0); assert.match(result.stderr,/explicit fresh --report/);
  }
  const selected = `.harness/v2-selection-missing-${randomUUID()}-report.json`;
  const result = spawnSync(process.execPath, ['scripts/verify-native-hook-v2-live-e2e.mjs','--report',selected], {cwd:root,encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0); assert.match(result.stderr,/ENOENT|location is missing/);
});

test('artifact inspection accepts regular non-JSON evidence while rejecting escaping paths', async () => {
  const selected = `.harness/artifact-location-${randomUUID()}.txt`;
  await writeFile(path.join(root, selected),'evidence\n',{flag:'wx'});
  try { assert.equal(await inspectReportLocation(root,selected),path.join(root,selected)); }
  finally { await unlink(path.join(root,selected)); }
  for (const relative of ['.harness/../escape.txt','.harness\\escape.txt','.harness/./escape.txt']) await assert.rejects(inspectReportLocation(root,relative));
});

test('V1 default and explicit fresh reports have distinct artifact bases', () => {
  assert.equal(selectReport([]), defaultAutoUpdateReport);
  assert.equal(reportArtifactDirectory(selectReport([])), '.harness/native-hook-auto-update-e2e');
  assert.equal(selectReport(['--phase', 'initial', '--report', fresh]), fresh);
  assert.equal(reportArtifactDirectory(fresh), '.harness/native-hook-auto-update-v2-post-rollout-e2e');
  assert.equal(selectReport(['--superseding-report', fresh], defaultAutoUpdateReport, '--superseding-report'), fresh);
});

test('ambiguous or escaping report paths fail closed', () => {
  for (const argv of [
    ['--report'], ['--report', '--phase'], ['--report', fresh, '--report', fresh],
    [`--report=${fresh}`], ['--report', '../outside.json'], ['--report', '/tmp/outside.json'],
    ['--report', 'C:/outside.json'], ['--report', '.harness/../outside.json'],
    ['--report', '.harness//proof.json'], ['--report', '.harness/./proof.json'],
    ['--report', '.harness\\proof.json'], ['--report', '.harness/proof.txt'],
    ['--report', '.harness/proof\0.json']
  ]) assert.throws(() => selectReport(argv), argv.join(' '));
});

test('initial phase refuses an existing selected report before native or artifact work', async () => {
  const selected = `.harness/report-selection-test-${randomUUID()}-report.json`;
  const bytes = '{"sentinel":"preserve exactly"}\n';
  await writeFile(path.join(root, selected), bytes, { flag: 'wx' });
  const artifacts = path.join(root, reportArtifactDirectory(selected));
  try {
    await assert.rejects(access(artifacts), { code: 'ENOENT' });
    const result = spawnSync(process.execPath, ['scripts/native-hook-auto-update-e2e.mjs', '--phase', 'initial', '--report', selected], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing report must be continued or reconciled/);
    assert.equal(await readFile(path.join(root, selected), 'utf8'), bytes);
    await assert.rejects(access(artifacts), { code: 'ENOENT' });
  } finally { await unlink(path.join(root, selected)); }
});

test('verifier reads the explicit selection and never falls back to V1', () => {
  const missing = '.harness/nonexistent-selected-proof-guard.json';
  const result = spawnSync(process.execPath, ['scripts/verify-native-hook-auto-update-e2e.mjs', '--report', missing], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert(result.stderr.includes('nonexistent-selected-proof-guard.json'));
});
