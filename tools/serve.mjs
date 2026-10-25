// Local static server with the cross-origin isolation headers GitHub Pages cannot send (COOP / COEP), so the
// multi-threaded wasm build works without the service worker. Usage: node tools/serve.mjs [port] [--no-coi]
// Development only: `PUT /dev/out/<name>.json` saves a validation run's results to dev/out/.
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || process.argv.find((a) => /^\d+$/.test(a)) || 8642);
const coi = !process.argv.includes('--no-coi');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.jsonl': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  let file = join(root, path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (req.method === 'PUT') {
    const name = /^dev[/\\]out[/\\]([\w.-]+\.json)$/.exec(path)?.[1];
    if (!name) return res.writeHead(403).end();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      mkdirSync(join(root, 'dev', 'out'), { recursive: true });
      writeFileSync(join(root, 'dev', 'out', name), Buffer.concat(chunks));
      res.writeHead(204).end();
    });
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const size = statSync(file).size;
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': size,
      'Cache-Control': 'no-cache' };
    if (coi) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless' });
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/ (COOP/COEP ${coi ? 'on' : 'off'})`));
