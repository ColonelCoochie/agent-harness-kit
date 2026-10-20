import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root=path.resolve('scratch/live-host-e2e/project-native');
const discovery=JSON.parse(await readFile('scratch/live-host-e2e/hooks-discovery.json','utf8'));
const source=JSON.parse(await readFile('.codex/hooks.json','utf8'));
const installed=JSON.parse(await readFile(path.join(root,'.codex/hooks.json'),'utf8'));
const definitions=discovery.data.find(d=>path.resolve(d.cwd)===root).hooks;
assert.equal(definitions.length,6);
const reviewed=[];
for(const definition of definitions){
 const event=Object.keys(source.hooks).find(k=>k.toLowerCase()===definition.eventName.toLowerCase());
 assert(event);assert.deepEqual(installed.hooks[event],source.hooks[event]);
 const hook=source.hooks[event][0].hooks[0];
 assert.equal(definition.command,hook.commandWindows??hook.command);
 assert.equal(definition.sourcePath,path.join(root,'.codex/hooks.json'));
 assert.match(definition.currentHash,/^sha256:[0-9a-f]{64}$/);
 reviewed.push({event,key:definition.key,currentHash:definition.currentHash,commandSha256:createHash('sha256').update(definition.command).digest('hex')});
}
const configPath=path.join(process.env.USERPROFILE,'.codex/config.toml');
const original=await readFile(configPath,'utf8');let next=original;
for(const definition of reviewed){
 assert(!definition.key.includes("'"));
 const heading=`[hooks.state.'${definition.key}']`;
 const start=next.indexOf(heading);
 const block=`${heading}\ntrusted_hash = ${JSON.stringify(definition.currentHash)}\n`;
 if(start<0)next+='\n'+block;
 else {const end=next.indexOf('\n[',start+heading.length);const stop=end<0?next.length:end+1;const old=next.slice(start,stop);const replaced=/^trusted_hash\s*=/m.test(old)?old.replace(/^trusted_hash\s*=.*$/m,`trusted_hash = ${JSON.stringify(definition.currentHash)}`):old.replace(heading,heading+`\ntrusted_hash = ${JSON.stringify(definition.currentHash)}`);next=next.slice(0,start)+replaced+next.slice(stop);}
}
if(next!==original)await writeFile(configPath,next);
await writeFile('scratch/live-host-e2e/reviewed-native-trust.json',JSON.stringify({recordedAt:new Date().toISOString(),sourceAuthenticated:true,trustBypass:false,projectTrustOverride:false,definitions:reviewed},null,2)+'\n');
console.log(JSON.stringify({reviewed:reviewed.length,updated:next!==original,persistedNativeHashes:true}));
