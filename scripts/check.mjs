import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASSET_FILES } from './assets.mjs';
import { copy } from '../public/copy.mjs';
const base = new URL('../public/', import.meta.url);
assert.deepEqual((await readdir(base)).sort(), [...ASSET_FILES].sort(), 'Unexpected public asset');
for (const file of ASSET_FILES.filter(name => name.endsWith('.mjs'))) {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL(file, base))], { stdio: 'inherit' });
}
const code = await readFile(new URL('app.mjs', base), 'utf8');
for (const match of code.matchAll(/(?<![\w/])copy\.([A-Za-z][A-Za-z0-9]*)/g)) assert.ok(match[1] in copy, 'Missing copy key: ' + match[1]);
for (const file of ['app.mjs', 'index.html', 'styles.css']) {
  assert.equal(/\p{Script=Han}/u.test(await readFile(new URL(file, base), 'utf8')), false, 'UI copy must live in public/copy.mjs: ' + file);
}
const html = await readFile(new URL('index.html', base), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
for (const match of code.matchAll(/\b(?:byId|text)\('([^']+)'/g)) assert.ok(ids.has(match[1]), 'Missing UI element: ' + match[1]);
const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8'));
assert.equal(config.assets.directory, './dist');
assert.equal(config.main, undefined, 'Static deployment must not require a Worker entry point');
console.log('Static assets, module syntax, UI copy, and deployment config verified.');
