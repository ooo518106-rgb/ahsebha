// Apple Wallet: ملف ‎.pkpass لكل زبون، موقّع بشهادة Pass Type ID من حساب Apple Developer.
// - طلب الشهادة (CSR) والمفتاح بيتعملوا بمتصفح مدير المنصة (public/js/csr.js)، فما بنحتاج جهاز Mac.
// - التوقيع PKCS#7 منفصل لملف manifest.json، مع شهادة Apple الوسيطة WWDR G4.
// - locations + relevantText = البطاقة بتطلع على شاشة القفل برسالة ترحيب المحل لما يقرّب الزبون.
import { NULL, children, concat, ctx, int, octets, oid, oidToString, pemToDer, read, seq, set, setOf, utcTime } from '../public/js/asn1.js';
export { generateKeyAndCsr } from '../public/js/csr.js';
import { crc32, hexToRgb } from './png.js';
import { progress, rewardRule, stampsLine } from '../public/js/rules.js';

const OID = {
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  sha256: '2.16.840.1.101.3.4.2.1',
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  cn: '2.5.4.3',
  c: '2.5.4.6',
  o: '2.5.4.10',
  ou: '2.5.4.11',
  uid: '0.9.2342.19200300.100.1.1',
};
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

// Apple Worldwide Developer Relations Certification Authority — G4 (عامة، صالحة لحد 2030)
// المصدر: https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
// SHA-256: EA:47:57:88:55:38:DD:8C:B5:9F:F4:55:6F:67:60:87:D8:3C:85:E7:09:02:C1:22:E4:2C:08:08:B5:BC:E1:4C
export const WWDR_G4_PEM = `-----BEGIN CERTIFICATE-----
MIIEVTCCAz2gAwIBAgIUE9x3lVJx5T3GMujM/+Uh88zFztIwDQYJKoZIhvcNAQEL
BQAwYjELMAkGA1UEBhMCVVMxEzARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsT
HUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQDEw1BcHBsZSBS
b290IENBMB4XDTIwMTIxNjE5MzYwNFoXDTMwMTIxMDAwMDAwMFowdTFEMEIGA1UE
Aww7QXBwbGUgV29ybGR3aWRlIERldmVsb3BlciBSZWxhdGlvbnMgQ2VydGlmaWNh
dGlvbiBBdXRob3JpdHkxCzAJBgNVBAsMAkc0MRMwEQYDVQQKDApBcHBsZSBJbmMu
MQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANAf
eKp6JzKwRl/nF3bYoJ0OKY6tPTKlxGs3yeRBkWq3eXFdDDQEYHX3rkOPR8SGHgjo
v9Y5Ui8eZ/xx8YJtPH4GUnadLLzVQ+mxtLxAOnhRXVGhJeG+bJGdayFZGEHVD41t
QSo5SiHgkJ9OE0/QjJoyuNdqkh4laqQyziIZhQVg3AJK8lrrd3kCfcCXVGySjnYB
5kaP5eYq+6KwrRitbTOFOCOL6oqW7Z+uZk+jDEAnbZXQYojZQykn/e2kv1MukBVl
PNkuYmQzHWxq3Y4hqqRfFcYw7V/mjDaSlLfcOQIA+2SM1AyB8j/VNJeHdSbCb64D
YyEMe9QbsWLFApy9/a8CAwEAAaOB7zCB7DASBgNVHRMBAf8ECDAGAQH/AgEAMB8G
A1UdIwQYMBaAFCvQaUeUdgn+9GuNLkCm90dNfwheMEQGCCsGAQUFBwEBBDgwNjA0
BggrBgEFBQcwAYYoaHR0cDovL29jc3AuYXBwbGUuY29tL29jc3AwMy1hcHBsZXJv
b3RjYTAuBgNVHR8EJzAlMCOgIaAfhh1odHRwOi8vY3JsLmFwcGxlLmNvbS9yb290
LmNybDAdBgNVHQ4EFgQUW9n6HeeaGgujmXYiUIY+kchbd6gwDgYDVR0PAQH/BAQD
AgEGMBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQA/Vj2e5bbD
eeZFIGi9v3OLLBKeAuOugCKMBB7DUshwgKj7zqew1UJEggOCTwb8O0kU+9h0UoWv
p50h5wESA5/NQFjQAde/MoMrU1goPO6cn1R2PWQnxn6NHThNLa6B5rmluJyJlPef
x4elUWY0GzlxOSTjh2fvpbFoe4zuPfeutnvi0v/fYcZqdUmVIkSoBPyUuAsuORFJ
EtHlgepZAE9bPFo22noicwkJac3AfOriJP6YRLj477JxPxpd1F1+M02cHSS+APCQ
A1iZQT0xWmJArzmoUUOSqwSonMJNsUvSq3xKX+udO7xPiEAGE/+QF4oIRynoYpgp
pU8RBWk6z/Kf
-----END CERTIFICATE-----`;

// ─── قراءة الشهادة ───
function parseTime(node) {
  const s = new TextDecoder().decode(node.body);
  const m = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  let y = Number(m[1]);
  if (node.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export function parseCertificate(der) {
  const cert = read(der, 0);
  if (cert.tag !== 0x30 || cert.end > der.length) throw new Error('ملف الشهادة مش صالح');
  const [tbs] = children(der, cert);
  const parts = children(der, tbs);
  const i = parts[0].tag === 0xa0 ? 1 : 0;
  const [serial, , issuer, validity, subject, spki] = parts.slice(i);
  const names = {};
  for (const rdn of children(der, subject)) {
    for (const atv of children(der, rdn)) {
      const [o, v] = children(der, atv);
      names[oidToString(o.body)] = new TextDecoder().decode(v.body);
    }
  }
  const [, notAfter] = children(der, validity);
  return {
    issuerRaw: issuer.raw,
    serialRaw: serial.raw,
    spkiRaw: spki.raw,
    passTypeId: names[OID.uid] || null,
    teamId: names[OID.ou] || null,
    commonName: names[OID.cn] || null,
    notAfter: parseTime(notAfter),
  };
}

// التأكد إنه المفتاح الخاص والعام زوج واحد (توقيع وتحقق)
export async function keyPairMatches(pkcs8, spki) {
  try {
    const priv = await crypto.subtle.importKey('pkcs8', pkcs8, ALG, false, ['sign']);
    const pub = await crypto.subtle.importKey('spki', spki, ALG, false, ['verify']);
    const probe = crypto.getRandomValues(new Uint8Array(32));
    return await crypto.subtle.verify(ALG, pub, await crypto.subtle.sign(ALG, priv, probe), probe);
  } catch {
    return false;
  }
}

// ─── التوقيع (PKCS#7 / CMS SignedData منفصل) ───
export async function signDetached(content, { pkcs8, certDer, chain = [pemToDer(WWDR_G4_PEM)], now = new Date() }) {
  const cert = parseCertificate(certDer);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
  const signedAttrs = setOf([
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utcTime(now))),
    seq(oid(OID.messageDigest), set(octets(digest))),
  ]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, ALG, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign(ALG, key, signedAttrs));
  // التوقيع بيكون على SET (0x31)، وبالملف بتنكتب نفس البايتات بوسم [0]
  const implicitAttrs = concat([Uint8Array.of(0xa0), signedAttrs.subarray(1)]);
  const sha256 = seq(oid(OID.sha256), NULL);
  const signerInfo = seq(int(1), seq(cert.issuerRaw, cert.serialRaw), sha256, implicitAttrs, seq(oid(OID.rsaEncryption), NULL), octets(signature));
  const signedData = seq(int(1), set(sha256), seq(oid(OID.data)), ctx(0, certDer, ...chain), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signedData));
}

// ─── ZIP بدون ضغط (ملف ‎.pkpass هو ZIP) ───
export function zip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    parts.push(local, f.data);
    central.push(c);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}

// ─── محتوى البطاقة ───
const rgb = (hex) => { const [r, g, b] = hexToRgb(hex); return `rgb(${r}, ${g}, ${b})`; };
const isLight = (hex) => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7; };

export function buildPassJson(shop, member, { passTypeId, teamId, origin, authToken, menuUrl = null }) {
  const p = progress(shop, member.balance);
  const stamps = shop.program_type === 'stamps';
  const light = isLight(shop.color);
  const cardUrl = `${origin}/c/${member.token}`;
  const locations = JSON.parse(shop.locations || '[]').slice(0, 10);
  const welcome = shop.welcome_text || `${shop.name} ترحب بكم`;
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
    serialNumber: member.token,
    authenticationToken: authToken,
    webServiceURL: `${origin}/apple`,
    organizationName: shop.name,
    description: `بطاقة ولاء ${shop.name}`,
    logoText: shop.name,
    backgroundColor: rgb(shop.color),
    foregroundColor: light ? 'rgb(31, 26, 23)' : 'rgb(255, 255, 255)',
    labelColor: light ? 'rgb(90, 80, 72)' : 'rgb(235, 225, 215)',
    sharingProhibited: true,
    storeCard: {
      headerFields: [{
        key: 'balance',
        label: stamps ? 'الأختام' : 'النقاط',
        value: stamps ? `${p.available && !p.toward ? p.cost : p.toward}/${p.cost}` : member.balance,
        changeMessage: stamps ? 'صار عندك %@ أختام' : 'رصيدك صار %@ نقطة',
      }],
      primaryFields: [{
        key: 'reward',
        label: shop.reward_name,
        value: p.available ? (p.available > 1 ? `🎁 ${p.available} مكافآت جاهزة` : '🎁 جاهزة') : `باقي ${p.remaining} ${p.remaining >= 3 && p.remaining <= 10 ? (stamps ? 'أختام' : 'نقاط') : stamps ? 'ختم' : 'نقطة'}`,
        changeMessage: '%@',
      }],
      secondaryFields: [
        { key: 'name', label: 'الاسم', value: member.name },
        { key: 'card', label: 'رقم البطاقة', value: member.card_no },
      ],
      auxiliaryFields: stamps ? [{ key: 'stamps', label: 'التقدّم', value: stampsLine(shop, member.balance) }] : [],
      backFields: [
        { key: 'rule', label: 'المكافأة', value: rewardRule(shop) },
        ...(menuUrl ? [{ key: 'menu', label: 'المنيو', value: menuUrl, attributedValue: `<a href="${menuUrl}">افتح المنيو</a>` }] : []),
        { key: 'web', label: 'بطاقتي على الويب', value: cardUrl, attributedValue: `<a href="${cardUrl}">افتح البطاقة</a>` },
        { key: 'privacy', label: 'الخصوصية', value: `${origin}/privacy`, attributedValue: `<a href="${origin}/privacy">سياسة الخصوصية</a>` },
        { key: 'by', label: '', value: 'بطاقات الولاء من نقاطك' },
      ],
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: member.token, messageEncoding: 'iso-8859-1', altText: member.card_no }],
  };
  if (locations.length) pass.locations = locations.map((l) => ({ latitude: l.lat, longitude: l.lng, relevantText: welcome }));
  return pass;
}

async function hex(algo, data) {
  return [...new Uint8Array(await crypto.subtle.digest(algo, data))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// رمز التحقق لكل بطاقة (Apple بتبعته مع طلبات التحديث): HMAC من سر خاص بالمنصة
export async function authTokenFor(secret, serial) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`apple:${serial}`)));
  return [...mac.subarray(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildPkpass({ passJson, images, pkcs8, certDer, chain }) {
  const enc = new TextEncoder();
  const files = [{ name: 'pass.json', data: enc.encode(JSON.stringify(passJson)) }, ...Object.entries(images).map(([name, data]) => ({ name, data }))];
  const manifest = {};
  for (const f of files) manifest[f.name] = await hex('SHA-1', f.data);
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const signature = await signDetached(manifestBytes, { pkcs8, certDer, ...(chain ? { chain } : {}) });
  return zip([...files, { name: 'manifest.json', data: manifestBytes }, { name: 'signature', data: signature }]);
}
