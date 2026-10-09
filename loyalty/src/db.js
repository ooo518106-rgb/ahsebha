// واجهة وحدة لقاعدة البيانات: Cloudflare D1 بالنشر، و node:sqlite محلياً وبالاختبارات.
// التنتين SQLite، فنفس الاستعلامات بتشتغل عالتنتين.

const args = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

// بصمة قائمة الترحيلات: إذا ما تغيّرت من آخر مرة، ما منعيدها (كل وحدة طلب لقاعدة البيانات أول ما يصحى السيرفر)
function migrationsSig(list) {
  let h = 5381;
  for (const ch of list.join('\n')) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `${list.length}:${h.toString(16)}`;
}
const SIG_KEY = 'schema_migrations';
// Preserve the existing administrator once, never grant administration to a new signup.
const ADMIN_MIGRATION = [
  `INSERT OR IGNORE INTO platform_settings (k, v)
   SELECT 'platform_admin_user_id', u.identity FROM users u JOIN shops s ON s.id = u.shop_id
   WHERE s.demo = 0 AND ? = 1 AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE k = 'platform_admin_pinned')
   ORDER BY u.id LIMIT 1`,
  `INSERT OR IGNORE INTO platform_settings (k, v) VALUES ('platform_admin_pinned', '1')`,
];

export function d1(DB) {
  const stmt = (sql, a) => DB.prepare(sql).bind(...args(a));
  const meta = (r) => ({ changes: r.meta.changes, lastId: r.meta.last_row_id });
  return {
    get: (sql, ...a) => stmt(sql, a).first(),
    all: async (sql, ...a) => (await stmt(sql, a).all()).results,
    run: async (sql, ...a) => meta(await stmt(sql, a).run()),
    // دفعة واحدة ذرّية: يا بتنجح كلها يا ولا وحدة
    batch: async (list) => (await DB.batch(list.map(([sql, a = []]) => stmt(sql, a)))).map(meta),
    init: async (statements, migrations = []) => {
      await DB.batch(statements.map((s) => DB.prepare(s)));
      const sig = migrationsSig(migrations);
      const done = await DB.prepare('SELECT v FROM platform_settings WHERE k = ?').bind(SIG_KEY).first();
      if (done && done.v === sig) return;
      for (const m of migrations) {
        try { await DB.prepare(m).run(); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
      }
      await DB.batch([DB.prepare(ADMIN_MIGRATION[0]).bind(done ? 1 : 0), DB.prepare(ADMIN_MIGRATION[1])]);
      await DB.prepare('INSERT INTO platform_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(SIG_KEY, sig).run();
    },
  };
}

export function sqlite(db) {
  const row = (r) => (r ? { ...r } : null);
  const exec = (sql, a) => {
    const r = db.prepare(sql).run(...args(a));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  };
  return {
    get: async (sql, ...a) => row(db.prepare(sql).get(...args(a))),
    all: async (sql, ...a) => db.prepare(sql).all(...args(a)).map(row),
    run: async (sql, ...a) => exec(sql, a),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map(([sql, a = []]) => exec(sql, a));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    init: async (statements, migrations = []) => {
      for (const s of statements) db.exec(s);
      const sig = migrationsSig(migrations);
      const done = db.prepare('SELECT v FROM platform_settings WHERE k = ?').get(SIG_KEY);
      if (done && done.v === sig) return;
      for (const m of migrations) {
        try { db.exec(m); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
      }
      db.exec('BEGIN');
      try {
        db.prepare(ADMIN_MIGRATION[0]).run(done ? 1 : 0);
        db.exec(ADMIN_MIGRATION[1]);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      db.prepare('INSERT INTO platform_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(SIG_KEY, sig);
    },
  };
}
