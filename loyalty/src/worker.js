// نقطة الدخول على Cloudflare Workers: قاعدة البيانات D1 (DB) والملفات الثابتة (ASSETS)
import { handle, runScheduled } from './app.js';
import { d1 } from './db.js';
import { MIGRATIONS, SCHEMA } from './schema.js';

let ready = null;

async function openDb(env) {
  const db = d1(env.DB);
  // الجداول بتنعمل لحالها أول مرة (CREATE IF NOT EXISTS)
  if (!ready) ready = db.init(SCHEMA, MIGRATIONS).catch((e) => { ready = null; throw e; });
  await ready;
  return db;
}

export default {
  async fetch(request, env, ctx) {
    const db = await openDb(env);
    return handle(request, {
      db,
      env,
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      waitUntil: (p) => ctx.waitUntil(p),
      asset: (path) => env.ASSETS.fetch(new URL(path, request.url)),
    });
  },

  // كل 5 دقايق (wrangler.toml ← triggers): هدايا عيد الميلاد، طلب التقييم، تذكير الغايبين
  async scheduled(event, env, ctx) {
    const db = await openDb(env);
    const out = await runScheduled({ db, env, waitUntil: (p) => ctx.waitUntil(p) }, event.scheduledTime || Date.now());
    console.log('scheduled:', JSON.stringify(out));
  },
};
