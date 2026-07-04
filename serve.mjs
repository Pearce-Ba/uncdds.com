import { createServer } from 'http';
import { createReadStream } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const PORT = 3000;
const ROOT = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html':'text/html','.js':'text/javascript','.css':'text/css',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml',
  '.json':'application/json','.mp4':'video/mp4','.ico':'image/x-icon',
};

createServer((req, res) => {
  let p = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (p === '/' || p === '') p = '/index.html';
  const fp = join(ROOT, p);
  const mime = MIME[extname(fp)] || 'application/octet-stream';
  const s = createReadStream(fp);
  s.on('error', () => { res.writeHead(404); res.end('Not found'); });
  s.once('ready', () => res.writeHead(200, { 'Content-Type': mime }));
  s.pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
