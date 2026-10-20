// Portable, fixture-only regression entry point. Historical gate audits require
// their separately authenticated, untracked evidence and are intentionally separate.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=await mkdtemp(path.join(tmpdir(),'harness-rollout-test-home-'));
const files=[
 'scripts/native-hook-rollout-v2-verifier.test.mjs',
 'scripts/native-hook-rollout-v2-doc-review.test.mjs',
 'scripts/rollout004-context-performance-isolated.test.mjs',
 'scripts/rollout004-review-regressions.test.mjs',
];
try{
 const env={...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex')};
 delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;
 const child=spawn(process.execPath,['--test',...files],{cwd:root,env,stdio:'inherit',windowsHide:true});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 process.exitCode=result.signal?1:result.code??1;
}finally{
 assert.equal(path.dirname(path.resolve(home)),path.resolve(tmpdir()));
 assert(path.basename(home).startsWith('harness-rollout-test-home-'));
 await rm(home,{recursive:true,force:true});
}
