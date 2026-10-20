import { spawn } from 'node:child_process';
import { appendFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';

export function safeConfigRpcFailure(method,id,error){
  const code=Number.isSafeInteger(error?.nativeCode)?error.nativeCode:Number.isSafeInteger(error?.code)?error.code:'unknown';
  const detailsSha256=createHash('sha256').update(String(error)).digest('hex');
  return new Error(`Captured config RPC failed: method=${method} id=${id} code=${code} detailsSha256=${detailsSha256}`);
}

export const binary = 'C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function boundedProcess(executable,args,env,{timeoutMs=10000,maxBytes=2000000}={}) {
  return new Promise((resolve,reject)=>{
    const proc=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='',settled=false;
    const finish=(failure,value)=>{if(settled)return;settled=true;clearTimeout(timer);failure?reject(failure):resolve(value);};
    const timer=setTimeout(()=>{proc.kill();finish(new Error(executable+' exceeded bounded deadline'));},timeoutMs);
    proc.stdout.on('data',bytes=>{output+=bytes;if(Buffer.byteLength(output)>maxBytes){proc.kill();finish(new Error(executable+' exceeded output bound'));}});
    proc.stderr.on('data',bytes=>{error=(error+bytes).slice(0,2000);});proc.once('error',failure=>finish(failure));
    proc.once('close',code=>finish(null,{code,output,error}));
  });
}
const trim = (value, limit=2200) => String(value ?? '').replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED]').slice(0, limit);
function summarize(message) {
  const {method, params:p={}} = message;
  const base = {method, threadId:p.threadId, turnId:p.turnId};
  if (method?.startsWith('hook/')) {
    const r=p.run ?? {};
    return {...base, run:{id:r.id,eventName:r.eventName,status:r.status,sourcePath:r.sourcePath,exitCode:r.exitCode,output:trim(r.output),error:trim(r.error),entries:trim(JSON.stringify(r.entries??[]),4800),durationMs:r.durationMs,rawKeys:Object.keys(r)}};
  }
  if (method === 'item/completed' || method === 'item/started') {
    const i=p.item ?? {};
    return {...base,item:{id:i.id,type:i.type,status:i.status,exitCode:i.exitCode,command:trim(i.command,1200),text:trim(i.text,4200),aggregatedOutput:trim(i.aggregatedOutput,6000)}};
  }
  if (method === 'turn/completed') return {...base,turn:{id:p.turn?.id,status:p.turn?.status,error:p.turn?.error}};
  if (method === 'error') return {...base,error:trim(JSON.stringify(p),2400)};
  if (method === 'thread/started') return {...base,thread:{id:p.thread?.id,path:p.thread?.path,sessionId:p.thread?.sessionId}};
  if (/tokenUsage/.test(method??'')) return {...base,tokenUsage:p.tokenUsage};
  return base;
}

export async function connect({cwd,log,trustBypass=false,projectTrust=false,limit=80000,bodyAfterPrefix=false,configReceipt}) {
  await mkdir(path.dirname(log),{recursive:true});
  const args=['app-server','--stdio','-c','features.hooks=true','-c',`model_auto_compact_token_limit=${limit}`];
  if(bodyAfterPrefix)args.push('-c','model_auto_compact_token_limit_scope="body_after_prefix"');
  if(projectTrust)args.push('-c',`projects.${cwd.toLowerCase()}.trust_level="trusted"`);
  if(trustBypass) args.unshift('--dangerously-bypass-hook-trust');
  const hostKeys=new Set(['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>hostKeys.has(key)));
  const child=spawn(binary,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  // Register at spawn so even an early exit is observed before cleanup begins.
  let exitDetails;
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{exitDetails={pid:child.pid,code,signal};resolve(exitDetails);});});
  exited.catch(()=>{});
  let nextId=0,closed=false,bytes=0,logQueue=Promise.resolve(),fatal,closing;
  const pending=new Map(),events=[];
  const fail=error=>{fatal??=error;for(const waiter of pending.values())waiter.reject(fatal);pending.clear();};
  child.on('error',fail);
  child.stdin.on('error',fail);
  const record=value=>{
    const line=JSON.stringify({at:new Date().toISOString(),...value})+'\n';
    bytes+=Buffer.byteLength(line);
    if(bytes>4_000_000){fail(new Error('Bounded native summary capture exceeded four megabytes'));return;}
    logQueue=logQueue.then(()=>appendFile(log,line));logQueue.catch(fail);
  };
  record({kind:'invocation',binary,args,cwd,modelOverride:false,trustBypass,projectTrust,projectTrustPersistent:false});
  child.stderr.on('data',b=>record({kind:'stderr',text:trim(b,1200)}));
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{
    let message;
    try{message=JSON.parse(line);}catch{record({kind:'nonJson',text:trim(line,300)});return;}
    if(message.id!==undefined&&message.method){
      record({kind:'serverRequest',id:message.id,method:message.method});
      child.stdin.write(JSON.stringify({id:message.id,result:{decision:'decline'}})+'\n');
      return;
    }
    if(message.id!==undefined){
      const waiter=pending.get(message.id);
      if(waiter){pending.delete(message.id);message.error?waiter.reject(Object.assign(new Error(JSON.stringify(message.error)),{nativeCode:message.error.code})):waiter.resolve(message.result);}
      return;
    }
    if(message.method?.endsWith('/delta')||message.method?.startsWith('codex/event/'))return;
    const summary=summarize(message);summary.eventIndex=events.length;
    if(message.method?.startsWith('hook/'))summary.structuredEntries=(message.params?.run?.entries??[]).slice(0,16).map(entry=>({kind:entry.kind,text:trim(entry.text,6000)}));
    events.push(summary); record({kind:'notification',...summary});
  });
  function rpc(method,params={}) {
    if(fatal)return Promise.reject(fatal);if(closed)return Promise.reject(new Error('App-server already exited'));
    const id=++nextId;
    record({kind:'request',id,method,threadId:params.threadId,input:method==='turn/start'?params.input:undefined});
    const captureConfig=typeof configReceipt==='function'&&['config/read','config/batchWrite'].includes(method);
    if(captureConfig){try{record({kind:'configRpcReceipt',...configReceipt({stage:'request',id,method,params})});}catch(error){return Promise.reject(safeConfigRpcFailure(method,id,error));}}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},60000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);try{if(captureConfig)record({kind:'configRpcReceipt',...configReceipt({stage:'response',id,method,result:v})});resolve(v);}catch(error){reject(captureConfig?safeConfigRpcFailure(method,id,error):error);}},reject:e=>{clearTimeout(timer);let failure=e;try{if(captureConfig)record({kind:'configRpcReceipt',...configReceipt({stage:'error',id,method,error:e})});}catch(error){failure=error;}reject(captureConfig?safeConfigRpcFailure(method,id,failure):failure);}});
      child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  async function waitFor(predicate,timeoutMs=300000){
    const until=Date.now()+timeoutMs;
    while(Date.now()<until){if(fatal)throw fatal;const found=events.find(predicate);if(found)return found;if(closed)throw new Error('App-server exited before expected event');await sleep(150);}
    throw new Error('Native model event timed out');
  }
  child.on('exit',code=>{closed=true;record({kind:'exit',code});for(const p of pending.values())p.reject(new Error('App-server exited '+code));pending.clear();});
  async function start(instructions,extra={}){
    const result=await rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:'workspace-write',developerInstructions:instructions,config:trustBypass?{bypass_hook_trust:true}:undefined,...extra});
    record({kind:'threadMetadata',id:result.thread?.id,path:result.thread?.path,sessionId:result.thread?.sessionId,model:result.model,modelProvider:result.modelProvider});
    return result;
  }
  async function turn(threadId,text,timeoutMs=300000){
    const at=events.length;
    const result=await rpc('turn/start',{threadId,input:[{type:'text',text}]});
    const completed=await waitFor(e=>e.method==='turn/completed'&&e.threadId===threadId&&e.turn?.id===result.turn.id,timeoutMs);
    return {turn:completed.turn,events:events.slice(at)};
  }
  async function close(){if(!closed)child.kill();lines.close();await logQueue;}
  async function processRows(){
    if(process.platform!=='win32')throw new Error('Confirmed tree cleanup currently requires Windows process inventory');
    const result=await boundedProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'],env);
    if(result.code!==0)throw new Error('Process inventory failed '+trim(result.error,200));const rows=JSON.parse(result.output);return rows===null?[]:Array.isArray(rows)?rows:[rows];
  }
  async function closeConfirmed(){
    if(!closing)closing=terminateConfirmed();return closing;
  }
  async function terminateConfirmed(){
    const before=await processRows(),owned=new Map();let frontier=[child.pid];
    while(frontier.length){const pid=frontier.pop();const row=before.find(p=>p.ProcessId===pid);if(row)owned.set(pid,row.CreationDate);for(const row of before.filter(p=>p.ParentProcessId===pid))if(!owned.has(row.ProcessId))frontier.push(row.ProcessId);}
    if(!owned.has(child.pid))throw new Error('Native root identity unavailable; descendant cleanup is parked');
    if(!exitDetails){const result=await boundedProcess('taskkill.exe',['/PID',String(child.pid),'/T','/F'],env);if(result.code!==0&&!exitDetails)throw new Error('Tree termination failed '+result.code);}
    let deadline;const exit=await Promise.race([exited,new Promise((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('Native child exit was not confirmed')),30000);})]).finally(()=>clearTimeout(deadline));
    const after=await processRows();assertNoOwnedProcess(after);
    function assertNoOwnedProcess(rows){if(rows.some(p=>owned.get(p.ProcessId)===p.CreationDate))throw new Error('Native descendant still running; cleanup is parked');}
    lines.close();record({kind:'confirmedTermination',...exit,treePids:[...owned.keys()],treeAbsent:true,providerEnvironmentSanitized:true});await logQueue;
    return {...exit,treePids:[...owned.keys()],treeAbsent:true};
  }
  try{
    await rpc('initialize',{clientInfo:{name:'harness_repair_native_e2e',title:'Harness repair native E2E',version:'0.1.0'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  }catch(error){try{await closeConfirmed();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Native initialization failed and process cleanup is parked');}throw error;}
  const headerAfterTurn=(file,threadId,turnId,options)=>headerProofAfterTurn(events,record,file,threadId,turnId,options);
  return {rpc,start,turn,waitFor,events,close,closeConfirmed,log,headerAfterTurn};
}

export async function headerProofAfterTurn(events,record,file,threadId,turnId,options){
  const completed=events.find(e=>e.method==='turn/completed'&&e.threadId===threadId&&e.turn?.id===turnId&&e.turn.status==='completed');
  if(!completed||!Number.isSafeInteger(completed.eventIndex))throw new Error('Native transcript proof requires its completed native turn');
  const header={...await headerProof(file,threadId,options),publishedAfterTurnId:turnId,turnCompletedEventIndex:completed.eventIndex};
  record({kind:'transcriptHeaderProof',threadId,turnId,afterTurnCompletedEventIndex:completed.eventIndex,header});
  return header;
}

export async function headerProof(file,expectedId,{timeoutMs=10000,pollMs=100}={}){
  if(typeof file!=='string'||!file)throw new TypeError('Native transcript path must be a nonempty string');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(pollMs)||pollMs<1)throw new TypeError('Native transcript readiness bounds must be positive integers');
  const deadline=Date.now()+timeoutMs;
  let handle;
  for(;;){
    try{handle=await open(file,'r');break;}catch(error){
      if(error.code!=='ENOENT')throw error;
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new Error('Native transcript publication timed out',{cause:error});
      await sleep(Math.min(pollMs,remaining));
    }
  }
  try{
    const buffer=Buffer.alloc(262144);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    const newline=buffer.subarray(0,bytesRead).indexOf(10);
    if(newline<0)throw new Error('No bounded session_meta header found');
    const first=JSON.parse(buffer.subarray(0,newline).toString('utf8'));
    const meta=first.payload??{};
    return {path:file,firstLineBytes:newline,type:first.type,id:meta.id,parentThreadId:meta.source?.subagent?.thread_spawn?.parent_thread_id??meta.parent_thread_id??null,idMatchesExpected:meta.id===expectedId,headerOnlyRead:true};
  }finally{await handle.close();}
}
