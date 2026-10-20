import test from 'node:test';
import assert from 'node:assert/strict';
import {installationIndices, validateOtherInstallations, validatePilotTransfer} from './fix-nine-rollout-pilot-clearance.mjs';
import {targets} from './fix-nine-rollout-preflight.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const row = index => ({index, root:targets[index], sha256:String(index).repeat(64).slice(0,64)});

test('clearance preserves every consumer installation exactly while source ownership advances', () => {
  const before = [0,...installationIndices].map(row), after = clone(before);
  const current = installationIndices.map(row);
  validateOtherInstallations({before,after,unchanged:true}, current);
  for (const index of installationIndices) {
    const changed = clone(current); changed.find(item => item.index === index).sha256 = 'f'.repeat(64);
    assert.throws(() => validateOtherInstallations({before,after,unchanged:true}, changed));
  }
  for (const invalid of [current.slice(1), [...current,current[0]], [row(0),...current], [...current].reverse()])
    assert.throws(() => validateOtherInstallations({before,after,unchanged:true}, invalid));
  const changedBefore = clone(before); changedBefore[0].sha256 = 'f'.repeat(64);
  assert.throws(() => validateOtherInstallations({before:changedBefore,after,unchanged:true}, current));
});

function transferFixture() {
  const previous = {id:'deployment-owner',generation:160};
  const handoff = {id:'handoff-real',kind:'handoff',owner:previous,featureRevision:155,
    createdAt:'2026-10-18T05:39:45Z',resumedAt:'2026-10-18T05:41:45Z',drift:[],driftAccepted:false};
  return {receipt:{actor:previous.id,finishedAt:'2026-10-18T05:36:00Z'},
    reservation:{actor:previous.id,generation:160,startedAt:'2026-10-18T05:35:56Z'},
    state:{features:{revision:155},continuity:{phase:'working',generation:161,handoff:null,lastHandoff:handoff,
      checkpoint:{id:handoff.id,owner:previous},resumedAt:handoff.resumedAt,
      owner:{id:'current-owner',generation:161,claimedAt:handoff.resumedAt}},events:[
      {type:'handoff.ready',handoffId:handoff.id,generation:160,revision:155,at:'2026-10-18T05:40:25Z'},
      {type:'worker.resumed',handoffId:handoff.id,generation:161,at:'2026-10-18T05:41:46Z',drift:[],driftAccepted:false}]}};
}

test('only an authentic immediate drift-free transfer from the receipt actor passes', () => {
  const fixture = transferFixture();
  assert.equal(validatePilotTransfer(fixture.state,fixture.receipt,fixture.reservation,'current-owner').toGeneration,161);
  const mutations = [
    f => f.reservation.actor = 'impostor',
    f => f.state.continuity.owner.id = 'impostor',
    f => f.state.continuity.lastHandoff.owner.id = 'impostor',
    f => f.state.continuity.generation++,
    f => f.state.continuity.lastHandoff.drift = ['changed-source'],
    f => f.state.continuity.lastHandoff.driftAccepted = true,
    f => f.state.continuity.checkpoint.id = 'another-handoff',
    f => f.state.features.revision++,
    f => f.state.events.reverse(),
    f => f.state.events[0].handoffId = 'forged',
    f => f.state.events[1].generation++,
    f => f.state.events[1].drift = ['changed-source'],
    f => f.state.events[1].driftAccepted = true,
    f => f.state.events.push({...f.state.events[1],type:'feature.changed'}),
    f => f.state.continuity.owner.claimedAt = '2026-10-18T05:42:00Z',
    f => f.receipt.finishedAt = '2026-10-18T05:40:00Z',
  ];
  for (const mutate of mutations) {
    const changed = clone(fixture); mutate(changed);
    assert.throws(() => validatePilotTransfer(changed.state,changed.receipt,changed.reservation,'current-owner'));
  }
});
