// طلب شهادة Apple (CSR) ومفتاحه، بيتعملوا بالمتصفح (Web Crypto) وبيشتغلوا كمان بالسيرفر والاختبارات
import { NULL, bits, ctx, derToPem, int, oid, printable, seq, set, utf8 } from './asn1.js';

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

export async function generateKeyAndCsr(commonName = 'Nuqatak Pass Type ID') {
  const keys = await crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const subject = seq(set(seq(oid('2.5.4.3'), utf8(commonName))), set(seq(oid('2.5.4.6'), printable('JO'))));
  const info = seq(int(0), subject, spki, ctx(0));
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, keys.privateKey, info));
  const csr = seq(info, seq(oid('1.2.840.113549.1.1.11'), NULL), bits(sig));
  return { pkcs8, spki, csrPem: derToPem(csr, 'CERTIFICATE REQUEST') };
}
