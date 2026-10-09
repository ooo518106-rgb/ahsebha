// 💾 استرجاع نسخة احتياطية: بيحوّل ملف nuqatak-backup-….json.gz لأوامر SQL
//   node scripts/restore-backup.mjs nuqatak-backup-2026-10-08.json.gz > restore.sql
//   npx wrangler d1 execute loyalty --remote --file=restore.sql
// ⚠️ بيمسح محتوى كل جدول بالنسخة وبيرجّعه متل ما كان. الجلسات بتنمسح فالكل بيسجّل دخول من جديد.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { MEMBER_DELETE_GUARD } from '../src/schema.js';
import { restoreSql } from '../src/backup.js';

const file = process.argv[2];
if (!file) {
  console.error('الاستعمال: node scripts/restore-backup.mjs ملف.json.gz > restore.sql');
  process.exit(1);
}
const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));

process.stdout.write(restoreSql(data, MEMBER_DELETE_GUARD));
console.error(`✅ ${Object.keys(data.tables).length} جدول من نسخة ${data.exportedAt}`);
