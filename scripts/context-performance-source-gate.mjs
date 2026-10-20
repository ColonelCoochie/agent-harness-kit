import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync, createWriteStream, openSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {closedInputs, directory, exclusive, featureId, file, invocationPath, json, nodeIdentity, reference, reviewPath, root, sealGate, transitionPath, verifyCandidate} from './source-context-performance-authority.mjs';

if(process.argv.includes('--help')) {console.log('context-performance-source-gate: run exactly one configured SOURCE verify with a credential-free environment, preserve invocation evidence, then create the immutable gate seal.');process.exit(0);}
await verifyCandidate();const transition=await json(transitionPath),config=await json('.harness/config.json');
const review=await reference(reviewPath);const inputsBefore=await closedInputs(),nodeBefore=await nodeIdentity();assert.deepEqual(inputsBefore,transition.closedInputs);assert.deepEqual(nodeBefore,transition.node);
const state=await json('.harness/features.json'),feature=state.features.find(item=>item.id===featureId);assert.equal(feature.status,'active');assert.equal(feature.attempts,0,'This launcher does not reset or automatically retry gate attempts');
const allowedNames=[...config.security.environmentAllow,'CODEX_THREAD_ID'].sort();
assert(allowedNames.every(name=>!/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(name)));
const env=Object.fromEntries(allowedNames.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]));assert(env.CODEX_THREAD_ID,'Owned gate identity missing');
const argv=['.harness/run.mjs','verify',featureId],logNames=[`${directory}/gate.stdout.log`,`${directory}/gate.stderr.log`],fds=[];
try {for(const relative of logNames) fds.push(openSync(file(relative),'wx',0o600));} catch(error) {fds.forEach(closeSync);throw error;}
const streams=fds.map(fd=>createWriteStream('',{fd,autoClose:true}));
let streamFailure,child;
const streamCompletions=streams.map(stream=>new Promise(resolve=>{stream.once('close',resolve);stream.once('error',error=>{streamFailure=error;child?.kill();});}));
const startedAt=new Date().toISOString();child=spawn(process.execPath,argv,{cwd:root,env,windowsHide:true});child.stdout.pipe(streams[0]);child.stderr.pipe(streams[1]);
const completion=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
await Promise.all(streamCompletions);if(streamFailure) throw streamFailure;const finishedAt=new Date().toISOString();
const inputsAfter=await closedInputs(),nodeAfter=await nodeIdentity();
await exclusive(invocationPath,{version:1,featureId,argv,cwd:root,startedAt,finishedAt,...completion,timedOut:false,providerFree:true,launchProfile:{allowedNames,credentialNames:[]},inputsBefore,inputsAfter,nodeBefore,nodeAfter,review,logs:await Promise.all(logNames.map(reference))});
assert.equal(completion.exitCode,0,'Configured SOURCE gate failed; inspect the recorded evidence and invocation before any authorized retry');assert.equal(completion.signal,null);assert.deepEqual(inputsAfter,inputsBefore);assert.deepEqual(nodeAfter,nodeBefore);
console.log(JSON.stringify(await sealGate()));
