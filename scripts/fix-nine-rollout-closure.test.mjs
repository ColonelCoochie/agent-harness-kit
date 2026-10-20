import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSourceClosure, validatePrerequisite, authenticateSourceClosure, closurePath} from './fix-nine-rollout-closure.mjs';
const json = async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
const [candidate, preflight, native, evidence] = await Promise.all([
  json(closurePath), json('.harness/fix-nine-rollout-001/preflight.json'),
  json('.harness/fix-nine-rollout-001/native-preservation.json'),
  json('.harness/evidence/2026-10-17T20-21-48-251Z-source-historical-budget-compat-002.json')
]);
const fixtures = {preflight, native, evidence};
test('fresh composed candidate authenticates current source without target writes', async () => {
  assert.equal(validateSourceClosure(candidate, fixtures), true);
  assert.match((await authenticateSourceClosure()).sha256, /^[a-f0-9]{64}$/);
});
const negatives = {
  'target reordering': value => value.targetRoots.reverse(),
  'dropped native case-sensitive trust key': value => delete value.native.baseline.trust[Object.keys(value.native.baseline.trust)[0]],
  'retained trust mutation': value => value.native.baseline.retainedOtherTrust[Object.keys(value.native.baseline.retainedOtherTrust)[0]] = 'sha256:' + '0'.repeat(64),
  'unreviewed native transition': value => value.native.authorizedTransitions.push({key: 'unknown', after: '0'.repeat(64)}),
  'rewritten original failed query': value => value.native.originalFailure.status = 'successful',
  'missing managed asset': value => value.source.managed.pop(),
  'source substitution outside compatibility pair': value => value.source.files[0].sha256 = '0'.repeat(64),
  'old runtime substituted for compatibility runtime': value => value.source.files.find(row => row.path.endsWith('/project-runtime.mjs')).sha256 = preflight.source.files.find(row => row.path.endsWith('/project-runtime.mjs')).sha256,
  'frozen bootstrap modification': value => value.source.frozen[0].sha256 = '0'.repeat(64),
  'stale plan presented as execution plan': value => value.originalPlansRequireRefresh = false,
  'missing preservation baseline': value => value.originalPreflightPlans[4].preservation.sha256 = '0'.repeat(64),
  'execution authorization smuggled into source closure': value => value.executionAuthorized = true,
  'premature product HOLD clearance': value => value.exo.holdCleared = true,
  'rewritten historical attempt limit': value => value.exo.historicalMaxAttempts = 5,
  'evidence from another prerequisite': value => value.prerequisite.evidence.sha256 = '0'.repeat(64),
  'missing command log': value => delete value.prerequisite.commands[0].logs.stdout
};
for (const [name, mutate] of Object.entries(negatives)) test('rejects ' + name, () => {
  const value = structuredClone(candidate); mutate(value);
  assert.throws(() => validateSourceClosure(value, fixtures));
});
for (const [name, mutate] of Object.entries({
  'credential request': value => value.commands[0].credentials = ['OPENAI_API_KEY'],
  'unconfirmed process termination': value => value.commands[0].terminationConfirmed = false,
  'failed command': value => value.commands[0].exitCode = 1,
  'missing configured command': value => value.commands.pop(),
  'evidence order substitution': value => value.commands.reverse(),
  'schema downgrade': value => value.schemaVersion = 3,
  'attempt substitution': value => value.attempt = 2
})) test('rejects prerequisite ' + name, () => {
  const value = structuredClone(evidence); mutate(value);
  assert.throws(() => validatePrerequisite(value));
});
