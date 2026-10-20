import {acceptance} from './source-context-performance-authority.mjs';
try {console.log(JSON.stringify(await acceptance()));} catch(error) {console.error(error.message);process.exitCode=1;}
