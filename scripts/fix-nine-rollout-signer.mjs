// Cooperative exact-review integrity seal. Private key material never leaves this process.
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Pin before importing the executable graph, then authenticate it again after
// evaluation. No deployment entry point runs on import.
export const signerSourcePaths = Object.freeze([
  ...['signer','deployment','files','release','evidence','closure','preflight','auth','inventory'].map(name=>`scripts/fix-nine-rollout-${name}.mjs`),
  ...['core','hook-policy','native-hook-client'].map(name=>`skill/codex-harness/scripts/lib/${name}.mjs`),
  'skill/codex-harness/assets/context-budget.mjs',
  ...[1,2,3].map(version=>`skill/codex-harness/assets/native-hook-bootstrap-v${version}.json`)
]);
const loadedPins = Object.fromEntries(signerSourcePaths.map(name=>[name,sha(readFileSync(path.join(root,name)))]));
const {reviewPayload, validateReview} = await import('./fix-nine-rollout-deployment.mjs');
const {authenticateFile, exclusiveJson, readJson, readRegular} = await import('./fix-nine-rollout-files.mjs');
for(const name of signerSourcePaths) assert.equal(sha(await readRegular(root,name)),loadedPins[name],'Signer dependency changed during load');

const deploymentPath='scripts/fix-nine-rollout-deployment.mjs';
function parsedAnchor(bytes) {
  const source=bytes.toString('utf8');
  const matches=[...source.matchAll(/^export const reviewPublicKey = ("(?:[^"\\]|\\.)*");$/gm)];
  assert.equal(matches.length,1,'Exactly one parsed public anchor required');
  const value=JSON.parse(matches[0][1]); assert.equal(typeof value,'string');
  return {value,normalized:source.replace(matches[0][0],'export const reviewPublicKey = "<initial-live-anchor>";')};
}

async function sourceGuard(projectRoot,publicKey) {
  const initial=await Promise.all(signerSourcePaths.map(name=>readRegular(projectRoot,name)));
  const pins=Object.fromEntries(signerSourcePaths.map((name,index)=>[name,sha(initial[index])]));
  assert.deepEqual(pins,loadedPins,'Signer source differs from loaded graph');
  const original=parsedAnchor(initial[signerSourcePaths.indexOf(deploymentPath)]);
  let bound=false,drifted=false;
  return async function inspect() {
    let anchorMatches=false;
    try {
      const bytes=await Promise.all(signerSourcePaths.map(name=>readRegular(projectRoot,name)));
      const anchor=parsedAnchor(bytes[signerSourcePaths.indexOf(deploymentPath)]);
      anchorMatches=anchor.value===publicKey;
      for(const [index,name] of signerSourcePaths.entries()) {
        const current=sha(bytes[index]);
        if(current===pins[name]) continue;
        assert(name===deploymentPath && !bound && anchorMatches && anchor.normalized===original.normalized,
          'Signer dependency changed after launch');
      }
      assert(!drifted,'Signer dependency drift is permanent');
      if(!bound && anchorMatches) {
        pins[deploymentPath]=sha(bytes[signerSourcePaths.indexOf(deploymentPath)]); bound=true;
      }
    } catch {drifted=true;}
    return {sourceUnchanged:!drifted,anchorMatches,anchorBound:bound,sourcePins:{...pins}};
  };
}

// Reconnectable transport only returns public data. The owning worker writes
// public metadata and reviewed seals; this server never writes an artifact.
export async function startReviewHttpSigner({projectRoot=root,port=64139}={}) {
  assert(Number.isSafeInteger(port) && port>=0 && port<=65535);
  projectRoot=path.resolve(projectRoot);
  const signer=createReviewSigner(),inspect=await sourceGuard(projectRoot,signer.publicKey);
  let metadata;
  const server=createServer(async (request,response)=>{
    const reply=(status,value)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store',connection:'close'});response.end(JSON.stringify(value));};
    try {
      const hosts=request.rawHeaders.filter((_,index)=>index%2===0 && request.rawHeaders[index].toLowerCase()==='host');
      assert(['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress));
      assert.equal(hosts.length,1); assert.equal(request.headers.host,`127.0.0.1:${server.address().port}`);
      assert.equal(request.headers.origin,undefined);
    } catch {reply(403,{error:'Local signer request required'});request.resume();return;}
    if(!['/public','/seal'].includes(request.url)) {reply(404,{error:'Unknown signer route'});request.resume();return;}
    if(request.method!==(request.url==='/public'?'GET':'POST')) {reply(405,{error:'Unsupported signer method'});request.resume();return;}
    if(request.url==='/public') {reply(200,{metadata,health:await inspect()});request.resume();return;}
    try {
      assert(/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type']||''));
      if(Number(request.headers['content-length'])>16384) {reply(413,{error:'Review command too large'});request.resume();return;}
      let size=0;const chunks=[];
      for await(const chunk of request) {
        size+=chunk.length;
        if(size>16384) {reply(413,{error:'Review command too large'});request.resume();return;}
        chunks.push(chunk);
      }
      const command=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert(command && typeof command==='object' && !Array.isArray(command));
      assert(Object.keys(command).every(key=>['mode','kind','bodyPath','approvalRef','requesterId'].includes(key)));
      const healthy=await inspect();assert(healthy.sourceUnchanged && healthy.anchorBound && healthy.anchorMatches);
      const seal=await reviewedPayloadSeal(signer,command,{projectRoot});
      const finalHealth=await inspect();assert(finalHealth.sourceUnchanged && finalHealth.anchorMatches);
      reply(200,{seal});
    } catch {if(!response.headersSent) reply(400,{error:'Exact reviewed payload required; no seal written'});}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.timeout=5000;
  server.on('upgrade',request=>request.socket.destroy());
  server.on('connect',request=>request.socket.destroy());
  server.on('clientError',(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  metadata={version:1,kind:'fix-nine-rollout-memory-signer',transport:'loopback-http',pid:process.pid,
    startedAt:new Date().toISOString(),endpoint:`http://127.0.0.1:${server.address().port}`,publicKey:signer.publicKey,
    signerSourceSha256:loadedPins['scripts/fix-nine-rollout-signer.mjs']};
  return {metadata,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
export function createReviewSigner() {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const pem = publicKey.export({type:'spki', format:'pem'}).toString();
  return {publicKey:pem, seal({kind, body, approval, requesterId}) {
    const payload = reviewPayload(kind, body);
    assert.equal(approval.version, 1); assert.equal(approval.kind, kind);
    assert.equal(approval.verdict, 'CONTINUE'); assert.deepEqual(approval.findings, []);
    assert.equal(approval.payloadSha256, sha(payload), 'Review must approve these exact domain-bound bytes');
    assert(typeof requesterId === 'string' && requesterId);
    assert(typeof approval.reviewerId === 'string' && approval.reviewerId && approval.reviewerId !== requesterId,
      'Independent reviewer identity required');
    if(['context-owner-witness','context-readonly-observation'].includes(kind)) {
      assert.equal(body.reviewerId,approval.reviewerId,'Witness must bind its exact independent reviewer');
      assert.notEqual(body.actor,approval.reviewerId,'Witness owner cannot attest itself');
    }
    assert(typeof approval.reviewedAt === 'string' && Number.isFinite(Date.parse(approval.reviewedAt)));
    return {version:1, kind, body, verdict:'CONTINUE', signature:sign(null, payload, privateKey).toString('base64')};
  }};
}

async function currentPublicAnchor(projectRoot) {
  const source=await readRegular(projectRoot,'scripts/fix-nine-rollout-deployment.mjs');
  return parsedAnchor(source).value;
}

export async function startReviewSigner(metadataPath,{readOnly=false,projectRoot=root,input=process.stdin,output=value=>console.log(value)}={}) {
  const signer = createReviewSigner(),inspect=await sourceGuard(projectRoot,signer.publicKey);
  const metadata = {version:1,kind:'fix-nine-rollout-memory-signer',transport:'tool-session-stdio',
    readOnly,pid:process.pid,startedAt:new Date().toISOString(),publicKey:signer.publicKey,
    signerSourceSha256:sha(await readRegular(projectRoot,'scripts/fix-nine-rollout-signer.mjs'))};
  if(!readOnly) await exclusiveJson(projectRoot,metadataPath,metadata);
  output(JSON.stringify({metadata}));
  const lines=createInterface({input,crlfDelay:Infinity});
  for await(const line of lines) {
    try {
      assert(line.length<=16384,'Review command too large');
      const command=JSON.parse(line);
      const health=await inspect();
      if(command.mode==='public') {
        output(JSON.stringify({metadata,health}));continue;
      }
      assert(health.sourceUnchanged && health.anchorBound && health.anchorMatches,'Signer dependency changed after launch');
      const {outputPath,...request}=command;
      if(readOnly) assert.equal(outputPath,undefined,'Read-only relay cannot accept an output path');
      const seal=await reviewedPayloadSeal(signer,request,{projectRoot}),finalHealth=await inspect();
      assert(finalHealth.sourceUnchanged && finalHealth.anchorBound && finalHealth.anchorMatches);
      if(readOnly) output(JSON.stringify({seal}));
      else output(JSON.stringify({sealed:await exclusiveJson(projectRoot,outputPath,seal)}));
    } catch {output(JSON.stringify({error:'Exact reviewed payload required; no seal written'}));}
  }
}

export async function reviewedPayloadSeal(signer,{mode,kind,bodyPath,approvalRef,outputPath,requesterId},{projectRoot=root}={}) {
  assert.equal(mode,'seal');
  assert.equal(outputPath,undefined,'Read-only relay cannot accept an output path');
  assert(/^\.harness\/fix-nine-rollout-001\/reviews\/[a-z0-9-]+\.json$/.test(approvalRef.path));
  const [body,approval,publicKey]=await Promise.all([readJson(projectRoot,bodyPath),authenticateFile(projectRoot,approvalRef),
    currentPublicAnchor(projectRoot)]);
  assert.equal(signer.publicKey,publicKey,'Live signer must match reviewed public anchor');
  const seal=signer.seal({kind,body,approval:JSON.parse(approval),requesterId});
  validateReview(seal,kind,body,publicKey);
  return seal;
}

export async function sealReviewedPayload(signer,{outputPath,...command}) {
  return exclusiveJson(root,outputPath,await reviewedPayloadSeal(signer,command));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode,metadataPath]=process.argv.slice(2);
  if(mode==='stdio') await startReviewSigner(metadataPath);
  else if(mode==='relay') {assert.equal(metadataPath,undefined);await startReviewSigner(undefined,{readOnly:true});}
  else if(mode==='http') {assert(metadataPath===undefined || /^\d+$/.test(metadataPath));await startReviewHttpSigner({port:metadataPath===undefined?64139:Number(metadataPath)});}
  else throw new Error('Use http [PORT], relay or stdio METADATA; retain the same process through final review');
}
