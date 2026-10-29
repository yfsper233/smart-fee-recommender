import { mkdir, rm, copyFile } from 'node:fs/promises';
import { ASSET_FILES } from './assets.mjs';
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ASSET_FILES) await copyFile(new URL('../public/' + file, import.meta.url), new URL(file, output));
console.log('Built ' + ASSET_FILES.length + ' static deployment files.');
