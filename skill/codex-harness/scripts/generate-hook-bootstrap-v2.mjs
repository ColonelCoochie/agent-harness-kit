import { writeFile } from 'node:fs/promises';
import { buildNativeHookBootstrapV2 } from './lib/hook-bootstrap.mjs';
await writeFile(new URL('../assets/native-hook-bootstrap-v2.json', import.meta.url), JSON.stringify(buildNativeHookBootstrapV2(), null, 2) + '\n');
