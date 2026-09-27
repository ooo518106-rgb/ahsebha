import test from 'node:test';
import assert from 'node:assert/strict';
import '../vendor/zxing.min.js';
import { code128Modules, ean13Modules, isEan13, eanCheckDigit, barcodeSVG, code128Supported } from '../js/barcode.js';

const Z = globalThis.ZXing;
// نحوّل الوحدات إلى صف بكسلات ونقرؤه بمكتبة zxing نفسها التي تقرأ الكاميرا
function row(modules) {
  const q = 12;
  const r = new Z.BitArray(modules.length + q * 2);
  [...modules].forEach((b, i) => { if (b === '1') r.set(i + q); });
  return r;
}

test('Code128 يُقرأ بنفس النص', () => {
  for (const t of ['A', 'ABC-123', 'Hello 42!', 'SKU0001', '20123456789', 'p-7/x', '~{}|']) {
    const res = new Z.Code128Reader().decodeRow(0, row(code128Modules(t)), new Map());
    assert.equal(res.getText(), t);
  }
  assert.equal(code128Supported('منتج'), false);
});

test('EAN-13: رقم التحقق والقراءة', () => {
  assert.equal(eanCheckDigit('629104150021'), '3');
  assert.equal(isEan13('6291041500213'), true);
  assert.equal(isEan13('6291041500214'), false);
  for (const d12 of ['629104150021', '200000000001', '978030640615', '501234567890']) {
    const code = d12 + eanCheckDigit(d12);
    const res = new Z.EAN13Reader().decodeRow(0, row(ean13Modules(code)), new Map());
    assert.equal(res.getText(), code);
  }
});

test('SVG الباركود', () => {
  const svg = barcodeSVG('6291041500213');
  assert.ok(svg.startsWith('<svg') && svg.includes('6291041500213'));
  assert.equal(barcodeSVG('منتج'), '');
  assert.ok(!barcodeSVG('A"<b>').includes('<b>'));
});
