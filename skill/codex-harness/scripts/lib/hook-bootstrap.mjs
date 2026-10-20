import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { repairRealPath, nearestHarnessRoot, repairArguments, sourceRepairAuthority, hookRepairCommand, hookFailure } from '../../assets/hook-recovery.mjs';

// Released command bytes are immutable approval identities. V2 intentionally
// retains its original recovery grammar, independent of current helper source.
export function buildNativeHookBootstrapV2() {
  return JSON.parse(readFileSync(new URL('../../assets/native-hook-bootstrap-v2.json', import.meta.url), 'utf8'));
}

export function buildNativeHookBootstrapV3() {
  const functions = [repairRealPath, nearestHarnessRoot, repairArguments, sourceRepairAuthority, hookRepairCommand, hookFailure].map(fn => fn.toString().replaceAll('\r\n', '\n')).join('\n');
  const commands = {};
  for (const platform of ['codex', 'claude']) for (const adapter of ['context-guard.mjs', 'precompact-handoff.mjs', 'sessionstart-routing.mjs', 'claude-worker-identity.mjs']) {
    const code = `const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process'),os=require('node:os'),repairFs=fs,repairOs=os;${functions}\nlet input={},root=p.resolve(process.cwd());try{const raw=fs.readFileSync(0,'utf8');input=JSON.parse(raw||'{}');root=nearestHarnessRoot(input.cwd||process.cwd(),p,fs);if(['PreToolUse','PostToolUse'].includes(input.hook_event_name)&&hookRepairCommand(input,root,p,fs,process.env,os.homedir())){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:input.hook_event_name,additionalContext:'Authenticated source harness repair command routed without installed code.'+(input.hook_event_name==='PostToolUse'?' The repair command already completed; use its result and do not replay side effects.':'')}}));}else{const result=cp.spawnSync(process.execPath,[p.join(root,'.harness/hooks/native-hook-dispatch.mjs'),'--adapter',${JSON.stringify(adapter)},'--platform',${JSON.stringify(platform)}],{cwd:root,input:raw,encoding:'utf8',windowsHide:true});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||'Hook adapter failed');process.stdout.write(result.stdout||'{}');}}catch(e){process.stdout.write(JSON.stringify(hookFailure(input,e.message)));}`;
    const encoded = deflateRawSync(Buffer.from(code)).toString('base64');
    commands[platform + '/' + adapter] = `node -e "const marker='HARNESS_HOOK_LAUNCHER_V3';eval(require('node:zlib').inflateRawSync(Buffer.from('${encoded}','base64')).toString())"`;
  }
  return { version: 3, description: 'Frozen source-authenticated recovery for all managed executables and bootstrap manifests; v1 and v2 remain immutable migration predecessors.', commands };
}
