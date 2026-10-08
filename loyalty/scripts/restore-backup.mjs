// 💾 استرجاع نسخة احتياطية: بيحوّل ملف nuqatak-backup-….json.gz لأوامر SQL
//   node scripts/restore-backup.mjs nuqatak-backup-2026-10-08.json.gz > restore.sql
//   npx wrangler d1 execute loyalty --remote --file=restore.sql
// ⚠️ بيمسح محتوى كل جدول بالنسخة وبيرجّعه متل ما كان. الجلسات بتنمسح فالكل بيسجّل دخول من جديد.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('الاستعمال: node scripts/restore-backup.mjs ملف.json.gz > restore.sql');
  process.exit(1);
}
const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
if (data.app !== 'nuqatak' || data.format !== 1) throw new Error('هاد مش ملف نسخة احتياطية من نقاطك');

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`);
const out = ['PRAGMA defer_foreign_keys = true;', 'DELETE FROM sessions;'];
for (const [table, { columns, rows }] of Object.entries(data.tables)) {
  out.push(`DELETE FROM "${table}";`);
  const cols = columns.map((c) => `"${c}"`).join(', ');
  for (const r of rows) out.push(`INSERT INTO "${table}" (${cols}) VALUES (${r.map(lit).join(', ')});`);
}
process.stdout.write(`${out.join('\n')}\n`);
console.error(`✅ ${Object.keys(data.tables).length} جدول من نسخة ${data.exportedAt}`);
