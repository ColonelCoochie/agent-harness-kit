// Finite source-inventory admission. These observations confer no execution authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authenticateFile, readJson, referencePath} from './fix-nine-rollout-files.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const diagnostic = {path:'.harness/fix-nine-rollout-001/rejected-inventory-g140.json',bytes:61027,sha256:'fa73030c9b8e92840cabe437277f06b47a3cd88bf6206ec73ba6bb870d6a7bb2'};
const lifecycleAdmission = {path:'.harness/fix-nine-rollout-001/inventory-lifecycle-admission-g142.json',bytes:9984,sha256:'958089cf0815ec3197f93e11b17ac9890e3abe8f8dcd7bb6f168169855c9aa7d'};
const supplement = {path:'.harness/fix-nine-rollout-001/inventory-admission-supplement-g140.json',bytes:17406,sha256:'1af3efa13201efca9cc0eac87cbcb7bb8d1267c440b33a2829f91a0bf842390e'};
const frozenActor = '0d35bf860a6c608273372618da9182777e72ef637e30d2986703573dee0b39cd';
const contextPattern = /^\.harness\/context\/([a-f0-9]{64})\.json$/;
const keys = (value, allowed) => {
  assert(value && typeof value==='object' && !Array.isArray(value),'Expected an object');
  assert(Object.keys(value).every(key=>allowed.includes(key)),'Unexpected telemetry field');
};
const count = value => assert(Number.isSafeInteger(value) && value>=0,'Invalid telemetry counter');
const timestamp = value => assert(typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value,'Invalid telemetry timestamp');

export function validateContextState(value, actorHash) {
  keys(value,['version','actorHash','role','startedAt','updatedAt','mutations','toolCalls','outputChars','telemetry','lastNotice']);
  assert.equal(value.version,1); assert.equal(value.actorHash,actorHash);
  assert(['worker','orchestrator'].includes(value.role));
  timestamp(value.startedAt); timestamp(value.updatedAt);
  assert(Date.parse(value.updatedAt)>=Date.parse(value.startedAt));
  for(const key of ['mutations','toolCalls','outputChars']) count(value[key]);
  assert(value.lastNotice===null || typeof value.lastNotice==='string');
  const telemetry=value.telemetry;
  keys(telemetry,['status','bytesSinceUsage','interruptedGoals','goalPrompts','interruptions','identity','epoch','usageOffset','usage','offset','observedSize','lastUserGoal','lastGoalOffset']);
  assert(['unavailable','uncertain','estimated','unrecognized'].includes(telemetry.status));
  for(const key of ['bytesSinceUsage','interruptedGoals','goalPrompts','interruptions']) count(telemetry[key]);
  for(const key of ['epoch','usageOffset','offset','observedSize','lastGoalOffset']) if(key in telemetry) count(telemetry[key]);
  if('identity' in telemetry) assert(typeof telemetry.identity==='string' && /^[a-f0-9]{64}$/.test(telemetry.identity));
  if('lastUserGoal' in telemetry) assert.equal(typeof telemetry.lastUserGoal,'boolean');
  if('usage' in telemetry) {
    keys(telemetry.usage,['tokens','limit','at']);
    assert(Number.isFinite(telemetry.usage.tokens) && telemetry.usage.tokens>=0);
    assert(telemetry.usage.limit===null || (Number.isFinite(telemetry.usage.limit) && telemetry.usage.limit>0));
    if(telemetry.usage.at!==null) timestamp(telemetry.usage.at);
  }
  return value;
}

export function validateManagedInventory(value,candidate) {
  const entries=candidate.source.managed.map(row=>[row.installed.path,row.installed.sha256]);
  assert.equal(entries.length,15); assert.equal(new Set(entries.map(([name])=>name)).size,15);
  assert.deepEqual(value,{version:1,files:Object.fromEntries(entries)});
}

// Exact archive pins are review observations with a physical lifecycle witness.
// They establish provenance for this rollout, never historical gate equivalence.
export function validateArchiveProvenance(archive,events) {
  assert.match(archive.handoffId,/^handoff-\d{17}-[a-f0-9]{8}$/);
  assert.equal(archive.ref.path,`.harness/history/progress/${archive.handoffId}.md`);
  const pair=['handoff.ready','worker.resumed'].map(type=>events.filter(event=>event.type===type&&event.handoffId===archive.handoffId));
  assert(pair.every(rows=>rows.length===1),'Archive requires unique ready/resumed lifecycle records');
  const [ready,resumed]=pair.map(rows=>rows[0]);
  for(const [event,pin] of [[ready,archive.ready],[resumed,archive.resumed]]) {
    assert.equal(event.id,pin.id);assert.equal(digest(JSON.stringify(event)),pin.sha256);
  }
  assert(Number.isSafeInteger(ready.generation)&&ready.generation>=0);
  assert.equal(resumed.generation,ready.generation+1);
  timestamp(ready.at);timestamp(resumed.at);assert(Date.parse(ready.at)<=Date.parse(resumed.at));
  assert(events.indexOf(ready)<events.indexOf(resumed),'Reversed lifecycle events');
}

const exactKeys = (value, fields) => {
  keys(value,fields);assert.deepEqual(Object.keys(value).sort(),fields.slice().sort(),'Incomplete lifecycle proposal');
};
function lifecycleReference(ref) {
  exactKeys(ref,['path','bytes','sha256']);referencePath(ref.path);
  assert(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);assert.match(ref.sha256,/^[a-f0-9]{64}$/);
}
async function lifecycleEvents(ref,io) {
  lifecycleReference(ref);assert.equal(ref.path,'.harness/events.jsonl');
  const raw=(await io.prefix(ref)).subarray(0,ref.bytes);
  assert.equal(raw.length,ref.bytes);assert.equal(digest(raw),ref.sha256);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  assert(text.endsWith('\n'),'Lifecycle event prefix must end at a complete line');
  const lines=text.slice(0,-1).split('\n');assert(lines.every(line=>line.length>0),'Blank lifecycle event row');
  const events=lines.map(line=>JSON.parse(line)),ids=new Set();
  for(const event of events) {
    assert(event&&typeof event==='object'&&!Array.isArray(event));
    assert.equal(typeof event.id,'string');assert(event.id.length>0&&!ids.has(event.id),'Duplicate lifecycle event id');ids.add(event.id);
  }
  return events;
}

// This finite observation becomes authoritative only inside a signed target
// lifecycle. Existing immutable pins are never replaced by proposal entries.
export async function extendLifecycleAdmission(admission,proposal,lifecycle,io,{previous=null}={}) {
  if(proposal===undefined){assert(!previous,'Prior lifecycle admission disappeared');return admission;}
  exactKeys(proposal,['version','kind','executionAuthorized','contextWriter','eventPrefix','logs','archives']);
  assert.equal(proposal.version,1);assert.equal(proposal.kind,'fix-nine-rollout-finite-lifecycle-additions');assert.equal(proposal.executionAuthorized,false);
  lifecycleReference(proposal.contextWriter);assert.deepEqual(proposal.contextWriter,admission.contextWriter);await io.authenticate(proposal.contextWriter);
  const eventRefs=lifecycle.refs.filter(ref=>ref.path==='.harness/events.jsonl');assert.equal(eventRefs.length,1,'Exactly one target event prefix required');
  assert.deepEqual(proposal.eventPrefix,eventRefs[0],'Lifecycle proposal must bind the exact target event prefix');
  const events=await lifecycleEvents(proposal.eventPrefix,io);
  assert(Array.isArray(proposal.logs)&&Array.isArray(proposal.archives));
  if(previous) {
    assert.deepEqual(proposal.contextWriter,previous.contextWriter);
    assert(proposal.eventPrefix.bytes>=previous.eventPrefix.bytes,'Lifecycle event prefix shrank');await lifecycleEvents(previous.eventPrefix,io);
    for(const field of ['logs','archives']) assert.deepEqual(proposal[field].slice(0,previous[field].length),previous[field],`Prior lifecycle ${field} changed or disappeared`);
  }
  const pins=new Map(admission.pins??[]),seen=new Set(),aliases=new Map([...pins.keys()].map(name=>[name.toLowerCase(),name])),eventIds=new Set();
  let priorReady=-1,priorResumed=-1;
  const add=async ref=>{
    lifecycleReference(ref);assert(!seen.has(ref.path),'Duplicate lifecycle reference');seen.add(ref.path);
    const alias=aliases.get(ref.path.toLowerCase());assert(!alias||alias===ref.path,'Lifecycle reference case alias');aliases.set(ref.path.toLowerCase(),ref.path);
    const prior=previous&&[...previous.logs,...previous.archives.map(row=>row.ref)].find(row=>row.path===ref.path);
    assert(!pins.has(ref.path)||prior,'Lifecycle proposal cannot replace an existing pin');
    if(pins.has(ref.path))assert.deepEqual(pins.get(ref.path),ref,'Lifecycle pin changed');
    await io.authenticate(ref);pins.set(ref.path,structuredClone(ref));
  };
  for(const ref of proposal.logs){assert(/^\.harness\/logs\/[^/]+$/.test(ref.path),'Only exact lifecycle log files are admitted');await add(ref);}
  for(const archive of proposal.archives) {
    exactKeys(archive,['ref','handoffId','ready','resumed']);
    for(const event of [archive.ready,archive.resumed]){exactKeys(event,['id','sha256']);assert.equal(typeof event.id,'string');assert(event.id.length>0&&!eventIds.has(event.id),'Duplicate archive event');eventIds.add(event.id);assert.match(event.sha256,/^[a-f0-9]{64}$/);}
    validateArchiveProvenance(archive,events);
    const ready=events.findIndex(event=>event.id===archive.ready.id),resumed=events.findIndex(event=>event.id===archive.resumed.id);
    assert(ready>priorReady&&ready>priorResumed&&resumed>priorResumed,'Archive lifecycle rows must retain event order');priorReady=ready;priorResumed=resumed;
    assert(Number.isSafeInteger(lifecycle.continuity.generation)&&events[resumed].generation<=lifecycle.continuity.generation,'Archive resume exceeds target generation');
    await add(archive.ref);
  }
  return {...admission,pins};
}

export async function loadInventoryAdmission(candidate,io) {
  const observed=JSON.parse((await io.authenticate(diagnostic)).toString('utf8'));
  const admitted=JSON.parse((await io.authenticate(supplement)).toString('utf8'));
  assert.deepEqual(admitted.diagnostic,diagnostic);
  assert.equal(admitted.candidate.sha256,'5524e5c29c78a0f5774f4e30390b247cffa11f96f75ba6a6127f4d7d610c34ff');
  const authenticatedCandidate=JSON.parse((await io.authenticate(admitted.candidate)).toString('utf8'));
  if(candidate!==undefined) assert.deepEqual(candidate,authenticatedCandidate,'Supplied inventory candidate differs from the pinned candidate');
  candidate=authenticatedCandidate;
  assert.deepEqual(admitted.contextWriter,candidate.source.managed.find(row=>row.installed.path==='.harness/context-budget.mjs')?.installed);
  await io.authenticate(admitted.contextWriter);
  assert.equal(admitted.contexts.length,26); assert.equal(admitted.prerequisiteArtifacts.length,8);
  const extension=JSON.parse((await io.authenticate(lifecycleAdmission)).toString('utf8'));
  assert.equal(extension.version,1);assert.equal(extension.kind,'fix-nine-rollout-finite-lifecycle-admission');
  assert.equal(extension.executionAuthorized,false);assert.deepEqual(extension.contextWriter,admitted.contextWriter);
  assert.equal(extension.archives.length,14);assert.equal(extension.contexts.length,2);
  const eventBytes=(await io.prefix(extension.eventPrefix)).subarray(0,extension.eventPrefix.bytes);
  const events=eventBytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const archives=new Map();
  for(const archive of extension.archives) {
    validateArchiveProvenance(archive,events);assert(!archives.has(archive.ref.path));
    archives.set(archive.ref.path,archive.ref);
  }
  const pins=new Map();
  for(const change of observed.rows[0].changes) if(change.category==='existing_addition_rule') {
    assert.equal(change.before,null); assert(/^\.harness\/(?:evidence|logs|history)\//.test(change.path));
    assert.equal(change.path,change.after.path);assert(!pins.has(change.path));
    if(change.path.startsWith('.harness/history/')) assert.deepEqual(archives.get(change.path),change.after,'Observed archive lacks lifecycle provenance');
    pins.set(change.path,change.after);
  }
  // These eight immutable prerequisite artifacts are a separate class. They
  // neither widen the lifecycle namespace nor become proposed lifecycle logs.
  const prerequisiteArtifacts=new Map();
  for(const {ref} of admitted.prerequisiteArtifacts) {
    lifecycleReference(ref);
    assert(!pins.has(ref.path)&&!archives.has(ref.path)&&!prerequisiteArtifacts.has(ref.path),'Prerequisite inventory class collision');
    const changes=observed.rows[0].changes.filter(change=>change.path===ref.path);
    assert.equal(changes.length,1,'Exactly one prerequisite observation required');
    assert.equal(changes[0].category,'rejected_other');assert.equal(changes[0].before,null);
    assert.deepEqual(changes[0].after,ref);await io.authenticate(ref);
    prerequisiteArtifacts.set(ref.path,ref);
  }
  const contexts=new Map(admitted.contexts.map(row=>[row.path,row.captured]));
  assert.equal(contexts.size,26);
  assert(contexts.has(`.harness/context/${frozenActor}.json`));
  for(const [relative,ref] of archives) {
    if(pins.has(relative)) assert.deepEqual(pins.get(relative),ref);else pins.set(relative,ref);
  }
  for(const row of extension.contexts) {
    assert.equal(row.path,`.harness/context/${digest(row.actor)}.json`);assert.equal(row.captured.path,row.path);
    assert(!contexts.has(row.path));contexts.set(row.path,row.captured);
  }
  return {pins,contexts,prerequisiteArtifacts,candidate,contextWriter:admitted.contextWriter};
}

// Proposals are finite observations, not authority. The caller must authenticate
// the enclosing authority/refresh signature before using them during execution.
// Snapshots retain the reviewed bytes while the live counters continue to move.
const nativeActor = value => typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const readOnlyScope = 'exact-native-read-only-context-observation-only';
function readOnlyContext(context,actor) {
  exactKeys(context,['path','captured','snapshot']);
  assert(nativeActor(actor));assert.equal(context.path,`.harness/context/${digest(actor)}.json`);
  lifecycleReference(context.captured);assert.equal(context.captured.path,context.path);
  assert.equal(typeof context.snapshot,'string');assert.equal(Buffer.byteLength(context.snapshot),context.captured.bytes);
  assert.equal(digest(context.snapshot),context.captured.sha256);
  const state=validateContextState(JSON.parse(context.snapshot),digest(actor));
  assert.equal(state.mutations,0,'Read-only observation cannot contain mutations');
  return state;
}

// Identity and read-only provenance come from the distinct review, never from
// telemetry or a claimed owner. This capture is inert finite proposal input.
export async function captureReadOnlyContextObservation(admission,actor,io,observedAt=new Date().toISOString()) {
  assert(nativeActor(actor));timestamp(observedAt);await io.authenticate(admission.contextWriter);
  const relative=`.harness/context/${digest(actor)}.json`,captured=await io.pin(relative);
  const context={path:relative,captured,snapshot:(await io.authenticate(captured)).toString('utf8')};
  const state=readOnlyContext(context,actor);assert(Date.parse(state.updatedAt)<=Date.parse(observedAt));
  return {version:1,kind:'fix-nine-rollout-readonly-context-observation',executionAuthorized:false,scope:readOnlyScope,actor,observedAt,contextWriter:structuredClone(admission.contextWriter),context};
}

async function reviewedReadOnlyContext(bundle,admission,io) {
  exactKeys(bundle,['record','review']);const {record:ref,review}=bundle;
  assert.match(ref.path,/^\.harness\/fix-nine-rollout-001\/readonly-context-observation-[a-f0-9]{64}\.json$/);
  const raw=await io.authenticate(ref),record=JSON.parse(raw.toString('utf8'));
  assert.equal(ref.path,`.harness/fix-nine-rollout-001/readonly-context-observation-${digest(raw)}.json`);
  exactKeys(record,['version','kind','executionAuthorized','scope','actor','observedAt','contextWriter','context']);
  assert.equal(record.version,1);assert.equal(record.kind,'fix-nine-rollout-readonly-context-observation');
  assert.equal(record.executionAuthorized,false);assert.equal(record.scope,readOnlyScope);timestamp(record.observedAt);
  assert.deepEqual(record.contextWriter,admission.contextWriter);await io.authenticate(record.contextWriter);
  const state=readOnlyContext(record.context,record.actor);assert(Date.parse(state.updatedAt)<=Date.parse(record.observedAt));
  const seal=JSON.parse((await io.authenticate(review)).toString('utf8'));
  exactKeys(seal,['version','kind','body','verdict','signature']);
  assert(nativeActor(seal.body?.reviewerId) && seal.body.reviewerId!==record.actor,'Distinct native read-only observation reviewer required');
  assert.equal(typeof io.reviewReadOnlyContextObservation,'function');
  await io.reviewReadOnlyContextObservation(seal,{observation:ref,actor:record.actor,reviewerId:seal.body.reviewerId,scope:readOnlyScope});
  return {path:record.context.path,actor:record.actor,captured:record.context.captured,snapshot:record.context.snapshot,witness:{readOnlyObservation:structuredClone(bundle)}};
}

export async function captureContextWitness(admission,lifecycle,io) {
  const owner=lifecycle.continuity.owner;
  assert.equal(owner?.source,'CODEX_THREAD_ID');assert(nativeActor(owner.id));
  const ref=lifecycle.refs.find(row=>row.path==='.harness/continuity.json');
  const snapshot=(await io.authenticate(ref)).toString('utf8');
  assert.deepEqual(JSON.parse(snapshot),lifecycle.continuity);
  const eventPrefix=lifecycle.refs.find(row=>row.path==='.harness/events.jsonl');await io.prefix(eventPrefix);
  const proposal=await proposeContextAdmission(admission,lifecycle,io);
  const context=proposal.contexts.find(row=>row.actor===owner.id);
  assert(context,'The owned context is already historically admitted');
  return {version:1,kind:'fix-nine-rollout-context-witness',executionAuthorized:false,continuity:{ref,snapshot},eventPrefix,contextWriter:admission.contextWriter,context};
}

async function historicalContextWitness(bundle,admission,lifecycle,io) {
  keys(bundle,['record','review']);const {record:ref,review}=bundle;
  assert(/^\.harness\/fix-nine-rollout-001\/context-witness-[a-f0-9]{64}\.json$/.test(ref.path));
  const raw=await io.authenticate(ref),record=JSON.parse(raw.toString('utf8'));
  assert.equal(ref.path,`.harness/fix-nine-rollout-001/context-witness-${digest(raw)}.json`);
  keys(record,['version','kind','executionAuthorized','continuity','eventPrefix','contextWriter','context']);
  assert.equal(record.version,1);assert.equal(record.kind,'fix-nine-rollout-context-witness');assert.equal(record.executionAuthorized,false);
  assert.deepEqual(record.contextWriter,admission.contextWriter);await io.authenticate(record.contextWriter);
  keys(record.continuity,['ref','snapshot']);const captured=record.continuity;
  assert.equal(captured.ref.path,'.harness/continuity.json');assert.equal(typeof captured.snapshot,'string');
  assert.equal(Buffer.byteLength(captured.snapshot),captured.ref.bytes);assert.equal(digest(captured.snapshot),captured.ref.sha256);
  const continuity=JSON.parse(captured.snapshot),owner=continuity.owner;
  assert.equal(owner?.source,'CODEX_THREAD_ID');assert(nativeActor(owner.id));
  assert.equal(record.context.actor,owner.id);
  assert.deepEqual(record.context.witness.owner,owner);assert.equal(record.context.witness.generation,continuity.generation);
  assert(continuity.generation<=lifecycle.continuity.generation);
  assert.deepEqual(record.context.witness.lifecycle.find(row=>row.path===captured.ref.path),captured.ref);
  assert.deepEqual(record.context.witness.lifecycle.find(row=>row.path===record.eventPrefix.path),record.eventPrefix);
  assert.equal(record.eventPrefix.path,'.harness/events.jsonl');
  const current=lifecycle.refs.find(row=>row.path===record.eventPrefix.path);
  assert(record.eventPrefix.bytes<=current.bytes);await io.prefix(record.eventPrefix);
  // The snapshot and actor-free event prefix are observations, not native
  // identity proof. A distinct reviewer must explicitly attest this exact
  // finite observation before a later authority can admit its context.
  const seal=JSON.parse((await io.authenticate(review)).toString('utf8'));
  assert(nativeActor(seal.body?.reviewerId) && seal.body.reviewerId!==owner.id,'Distinct native witness reviewer required');
  assert.equal(typeof io.reviewContextWitness,'function');
  await io.reviewContextWitness(seal,{witness:ref,actor:owner.id,reviewerId:seal.body.reviewerId,scope:'exact-native-owner-observation-only'});
  return record.context;
}

export async function proposeContextAdmission(admission,lifecycle,io,previous=null,actors=[lifecycle.continuity.owner?.id],witnesses=[],readOnlyObservations=[]) {
  const proposal=previous ? structuredClone(previous) : {version:1,contextWriter:admission.contextWriter,contexts:[]};
  assert(Array.isArray(actors) && new Set(actors).size===actors.length,'Explicit unique context actors required');
  const owner=lifecycle.continuity.owner;
  assert.equal(owner?.source,'CODEX_THREAD_ID');assert(nativeActor(owner.id));
  for(const actor of actors) {
    assert(nativeActor(actor) && [owner.id,owner.parentSessionId].includes(actor),'Context proposal requires the current native owner or its parent');
    const relative=`.harness/context/${digest(actor)}.json`;
    if(admission.contexts.has(relative)||proposal.contexts.some(row=>row.path===relative)) continue;
    const captured=await io.pin(relative),snapshot=(await io.authenticate(captured)).toString('utf8');
    proposal.contexts.push({path:relative,actor,captured,snapshot,witness:{owner:structuredClone(owner),generation:lifecycle.continuity.generation,lifecycle:structuredClone(lifecycle.refs)}});
  }
  assert(Array.isArray(witnesses));
  for(const ref of witnesses) {
    const context=await historicalContextWitness(ref,admission,lifecycle,io);
    assert(!admission.contexts.has(context.path)&&!proposal.contexts.some(row=>row.path===context.path),'Duplicate historical witness');
    proposal.contexts.push({...context,witness:{record:ref}});
  }
  assert(Array.isArray(readOnlyObservations));
  for(const bundle of readOnlyObservations) {
    const context=await reviewedReadOnlyContext(bundle,admission,io);
    assert(!admission.contexts.has(context.path)&&!proposal.contexts.some(row=>row.path===context.path),'Duplicate read-only observation');
    proposal.contexts.push(context);
  }
  await extendContextAdmission(admission,proposal,lifecycle,io,{previous});
  return proposal;
}

export async function extendContextAdmission(admission,proposal,lifecycle,io,{previous=null}={}) {
  if(proposal===undefined) {assert(!previous,'Prior context admission disappeared');return admission;}
  keys(proposal,['version','contextWriter','contexts']);assert.equal(proposal.version,1);
  assert.deepEqual(proposal.contextWriter,admission.contextWriter);await io.authenticate(proposal.contextWriter);
  assert(Array.isArray(proposal.contexts));
  if(previous) for(const prior of previous.contexts) assert(proposal.contexts.some(row=>JSON.stringify(row)===JSON.stringify(prior)),'Prior context admission changed or disappeared');
  const contexts=new Map(admission.contexts),contextActors=new Map(admission.contextActors??[]),seen=new Set();
  for(const row of proposal.contexts) {
    keys(row,['path','actor','captured','snapshot','witness']);
    assert(nativeActor(row.actor));assert.equal(row.path,`.harness/context/${digest(row.actor)}.json`);
    const prior=previous?.contexts.find(entry=>entry.path===row.path);
    assert(!seen.has(row.path) && (!admission.contexts.has(row.path)||prior),'Duplicate or historical context proposal');seen.add(row.path);
    keys(row.captured,['path','bytes','sha256']);assert.equal(row.captured.path,row.path);
    assert.equal(typeof row.snapshot,'string');assert.equal(Buffer.byteLength(row.snapshot),row.captured.bytes);assert.equal(digest(row.snapshot),row.captured.sha256);
    validateContextState(JSON.parse(row.snapshot),digest(row.actor));
    keys(row.witness,['owner','generation','lifecycle','record','readOnlyObservation']);
    if(row.witness.readOnlyObservation) {
      exactKeys(row.witness,['readOnlyObservation']);
      // Reauthenticate this exact inert record and its domain-bound review on
      // every load, including cumulative refreshes with byte-identical rows.
      assert.deepEqual(row,await reviewedReadOnlyContext(row.witness.readOnlyObservation,admission,io));
    } else if(!prior) {
      if(row.witness.record) {
        keys(row.witness,['record']);
        const context=await historicalContextWitness(row.witness.record,admission,lifecycle,io);
        assert.deepEqual({...row,witness:context.witness},context);
      } else {
        assert.equal(lifecycle.continuity.owner?.source,'CODEX_THREAD_ID');
        assert.deepEqual(row.witness,{owner:lifecycle.continuity.owner,generation:lifecycle.continuity.generation,lifecycle:lifecycle.refs});
        assert([row.witness.owner.id,row.witness.owner.parentSessionId].includes(row.actor),'Context actor lacks an authenticated ownership witness');
      }
    }
    contexts.set(row.path,row.captured);contextActors.set(row.path,row.actor);
  }
  return {...admission,contexts,contextActors};
}

// Continuity is authenticated separately by the owned lifecycle bridge. Context
// files never supply actor identities and never authorize an ownership change.
export async function authenticateContextInventory(root,relative,continuity,admission) {
  const match=contextPattern.exec(relative); if(!match) return false;
  assert(admission.contexts.has(relative),`Unreviewed context path: ${relative}`);
  if(match[1]===frozenActor) {
    await authenticateFile(root,admission.contexts.get(relative)); return true;
  }
  const actors=[continuity.owner?.id,continuity.owner?.parentSessionId,...(continuity.retiredWorkerIds??[])].filter(value=>typeof value==='string' && value.length>0);
  const admittedActor=admission.contextActors?.get(relative);
  assert((admittedActor && digest(admittedActor)===match[1]) || actors.some(actor=>digest(actor)===match[1]),`Unauthenticated context actor: ${relative}`);
  validateContextState(await readJson(root,relative),match[1]);
  return true;
}

export async function authenticateObservedAddition(root,ref,admission) {
  const admitted=admission.pins.get(ref.path);
  assert(admitted,'Unreviewed source inventory addition: '+ref.path);
  assert.deepEqual(ref,admitted);
  await authenticateFile(root,admitted);
}

export async function authenticatePrerequisiteArtifact(root,ref,admission) {
  const admitted=admission.prerequisiteArtifacts?.get(ref.path);
  if(!admitted) return false;
  lifecycleReference(ref);assert(!admission.pins.has(ref.path)&&!admission.contexts?.has(ref.path),'Prerequisite inventory class collision');
  assert.deepEqual(ref,admitted);await authenticateFile(root,admitted);return true;
}

export async function authenticatePrerequisiteInventory(manifest,admission,io) {
  for(const ref of admission.prerequisiteArtifacts?.values()??[]) {
    lifecycleReference(ref);assert(!admission.pins.has(ref.path)&&!admission.contexts?.has(ref.path),'Prerequisite inventory class collision');
    const rows=manifest.files.filter(row=>row.path===ref.path);
    assert.equal(rows.length,1,'Prerequisite artifact disappeared or was duplicated: '+ref.path);
    assert.deepEqual(rows[0],ref);await io.authenticate(ref);
  }
}
