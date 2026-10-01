// نقطة الدخول على Cloudflare Workers: قاعدة البيانات D1 (DB) والملفات الثابتة (ASSETS)
import { handle } from './app.js';
import { d1 } from './db.js';
import { SCHEMA } from './schema.js';

let ready = null;

export default {
  async fetch(request, env, ctx) {
    const db = d1(env.DB);
    // الجداول بتنعمل لحالها أول مرة (CREATE IF NOT EXISTS)
    if (!ready) ready = db.init(SCHEMA).catch((e) => { ready = null; throw e; });
    await ready;
    return handle(request, {
      db,
      env,
      waitUntil: (p) => ctx.waitUntil(p),
      asset: (path) => env.ASSETS.fetch(new URL(path, request.url)),
    });
  },
};
