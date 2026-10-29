import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ASSET_FILES } from './assets.mjs';
const directory = process.argv[2] === 'dist' ? '../dist/' : '../public/';
const base = new URL(directory, import.meta.url);
const allowed = new Set(ASSET_FILES.filter(name => name !== '_headers'));
const types = { html: 'text/html; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const headerSource = await readFile(new URL('_headers', base), 'utf8');
const headers = { 'cache-control': 'no-store' };
for (const line of headerSource.split('\n').slice(1)) {
  const split = line.indexOf(':');
  if (split > 0) headers[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
}
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['GET', 'HEAD'].includes(req.method) || !allowed.has(file)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await readFile(new URL(file, base));
    res.writeHead(200, { ...headers, 'content-type': types[file.split('.').at(-1)] });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500); res.end(); }
});
const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
