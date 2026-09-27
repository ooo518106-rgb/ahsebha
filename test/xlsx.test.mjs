import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { writeXlsx, readXlsx, parseCSV, decodeText } from '../js/xlsx.js';

test('كتابة ثم قراءة xlsx بنفس القيم', async () => {
  const rows = [['الاسم', 'السعر', 'ملاحظة'], ['منتج <أ> & "ب"', 12.5, ''], ['ثاني', 0, 'سطر\nجديد'], ['', -3, 'x']];
  const bytes = writeXlsx([{ name: 'المنتجات', rows }, { name: 'ورقة/2', rows: [['a']] }]);
  const back = await readXlsx(bytes);
  assert.deepEqual(back[0], rows[0]);
  assert.deepEqual(back[1], ['منتج <أ> & "ب"', 12.5]);
  assert.deepEqual(back[2], ['ثاني', 0, 'سطر\nجديد']);
  assert.deepEqual(back[3], ['', -3, 'x']);
});

test('قراءة ملف مضغوط من Excel حقيقي (openpyxl)', async (t) => {
  const f = process.env.XLSX_SAMPLE;
  if (!f || !existsSync(f)) return t.skip('لا يوجد ملف عينة');
  const rows = await readXlsx(readFileSync(f));
  assert.deepEqual(rows[0], ['اسم المنتج', 'الباركود', 'سعر البيع', 'التكلفة', 'الكمية', 'التصنيف']);
  assert.deepEqual(rows[1], ['سماعة بلوتوث', '6291041500213', 149, 85.5, 40, 'إكسسوارات']);
  assert.equal(rows[2][0], 'كيبل "USB-C" & شاحن');
  assert.equal(rows[3][2], 50);
});

test('CSV بفواصل مختلفة وترميز ويندوز العربي', () => {
  assert.deepEqual(parseCSV('a,b\n"1,5","x ""y"""\r\n'), [['a', 'b'], ['1,5', 'x "y"']]);
  assert.deepEqual(parseCSV('الاسم;السعر\nقلم;3\n'), [['الاسم', 'السعر'], ['قلم', '3']]);
  const win1256 = Uint8Array.from([0xC7, 0xE1, 0xC7, 0xD3, 0xE3]);
  assert.equal(decodeText(win1256), 'الاسم');
  assert.equal(decodeText(new TextEncoder().encode('﻿قلم')), 'قلم');
});
