import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

export async function connect({cwd,logName='native-events.jsonl',limit=40000}={}) {
  const directory=path.resolve('scratch/live-host-e2e');
  await mkdir(directory,{recursive:true});
  const log=path.join(directory,logName);
  const env={...process.env};delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;
  const binary='C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe';
  const child=spawn(binary,['app-server','--stdio','-c','features.hooks=true','-c',`model_auto_compact_token_limit=${limit}`,'-c','model_auto_compact_token_limit_scope="body_after_prefix"'],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const secrets=Object.entries(env).filter(([k,v])=>/key|secret|password|credential|auth_token/i.test(k)&&v&&v.length>5).map(([,v])=>v);
  const redact=s=>secrets.reduce((s,v)=>s.split(v).join('[REDACTED]'),s).replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{16,}\b/g,'[REDACTED]');
  let serial=0,bytes=0,closed=false;
  const pending=new Map(),events=[];
  let logQueue=Promise.resolve();
  const record=(kind,value)=>{const line=redact(JSON.stringify({at:new Date().toISOString(),kind,...value}))+'\n';bytes+=Buffer.byteLength(line);if(bytes>6000000)throw new Error('Native event capture exceeded bounded six-megabyte budget');logQueue=logQueue.then(()=>appendFile(log,line));};
  child.stderr.on('data',b=>record('stderr',{text:String(b).slice(0,6000)}));
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{record('nonJson',{text:line.slice(0,500)});return;}
    if(message.id!==undefined&&message.method){record('serverRequest',{id:message.id,method:message.method,params:message.params});child.stdin.write(JSON.stringify({id:message.id,result:{decision:'decline'}})+'\n');return;}
    if(message.id!==undefined){const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(new Error(JSON.stringify(message.error))):waiter.resolve(message.result);}return;}
    if(message.method?.endsWith('/delta'))return;
    record('notification',{method:message.method,params:message.params});events.push(message);
  });
  function rpc(method,params){const id=++serial;record('request',{id,method,params});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  async function waitFor(predicate,timeoutMs=240000){const until=Date.now()+timeoutMs;while(Date.now()<until){const found=events.find(predicate);if(found)return found;if(closed)throw new Error('App-server exited before expected event');await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Native model event timed out');}
  child.on('exit',code=>{closed=true;record('exit',{code});for(const p of pending.values())p.reject(new Error('App-server exited '+code));pending.clear();});
  async function turn(threadId,text){const result=await rpc('turn/start',{threadId,input:[{type:'text',text}],effort:'medium'});const done=await waitFor(e=>e.method==='turn/completed'&&e.params?.threadId===threadId&&e.params?.turn?.id===result.turn.id);return done.params.turn;}
  async function close(){if(!closed)child.kill();lines.close();await logQueue;}
  await rpc('initialize',{clientInfo:{name:'harness_live_e2e',title:'Harness live E2E',version:'0.1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  return {rpc,turn,waitFor,events,close,log};
}
