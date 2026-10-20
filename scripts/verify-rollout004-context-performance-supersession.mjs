import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as A from './rollout004-context-performance-authority.mjs';
import {verifyContinuationArchive} from './verify-rollout004-context-performance.mjs';

export async function verifySupersession(file,{reference=A.reference,authenticate=A.authenticate,currentAuthority=A.currentAuthority,assertPreserved=A.assertProductionPreserved}={}){
 assert.equal(typeof file,'string');const selected=await reference(file),archive=JSON.parse(await authenticate(selected));
 await currentAuthority();
 const result=await verifyContinuationArchive(archive,{authenticate,json:async ref=>JSON.parse(await authenticate(ref)),preservation:async ref=>JSON.parse(await authenticate(ref)),assertPreserved});
 return {pass:true,archive:selected,result};
}
export async function verifySupersessionReport(file,deps={}){const reference=deps.reference??A.reference,authenticate=deps.authenticate??A.authenticate;assert.equal(typeof file,'string');const selected=await reference(file),report=JSON.parse(await authenticate(selected));assert.equal(report.version,1);assert.equal(report.featureId,A.featureId);assert.equal(report.status,'passed');assert.equal(report.pending,null);assert(report.continuation&&typeof report.continuation.path==='string');await authenticate(report.continuation);const result=await verifySupersession(report.continuation.path,deps);assert.deepEqual(result.archive,report.continuation,'Continuation must bind authenticated archive bytes');return {...result,report:selected};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const reportAt=process.argv.indexOf('--report'),at=process.argv.indexOf('--archive');(reportAt>=0?verifySupersessionReport(process.argv[reportAt+1]):verifySupersession(at<0?undefined:process.argv[at+1])).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify(A.safeFailure(error)));process.exitCode=1;});
}
