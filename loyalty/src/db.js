// واجهة وحدة لقاعدة البيانات: Cloudflare D1 بالنشر، و node:sqlite محلياً وبالاختبارات.
// التنتين SQLite، فنفس الاستعلامات بتشتغل عالتنتين.

const args = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

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
      for (const m of migrations) {
        try { await DB.prepare(m).run(); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
      }
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
      for (const m of migrations) {
        try { db.exec(m); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
      }
    },
  };
}
