// تشغيل محلي أو على أي سيرفر Node 22+ (بدل Cloudflare):
//   node --env-file=.env src/server.js
// المتغيرات: PORT, DB_PATH, PUBLIC_URL, SIGNUP_CODE, CONTACT_EMAIL, GOOGLE_ISSUER_ID, GOOGLE_SERVICE_ACCOUNT
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handle } from './app.js';
import { sqlite } from './db.js';
import { SCHEMA } from './schema.js';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

export async function serveAsset(pathname) {
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=300' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

export async function openDb(dbPath = ':memory:') {
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const db = sqlite(raw);
  await db.init(SCHEMA);
  return db;
}

export function createServer({ db, env = {} }) {
  return http.createServer(async (req, res) => {
    try {
      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      const url = `${proto}://${req.headers.host || 'localhost'}${req.url}`;
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      const response = await handle(request, {
        db,
        env,
        asset: serveAsset,
        ip: req.socket.remoteAddress || 'unknown',
        waitUntil: (p) => Promise.resolve(p).catch((e) => console.error(e)),
      });
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await openDb(process.env.DB_PATH || 'loyalty.db');
  const port = Number(process.env.PORT) || 8787;
  createServer({ db, env: process.env }).listen(port, () => console.log(`نقاط الولاء شغّال على http://localhost:${port}`));
}
