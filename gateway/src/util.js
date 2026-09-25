const crypto = require("crypto");

const randomId = (n = 10) => crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n).toUpperCase();
const randomToken = () => crypto.randomBytes(24).toString("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// "962791234567" أو "+962 79 123 4567" أو "00962..." ← 962791234567@s.whatsapp.net
function toJid(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("رقم فاضي");
  if (s.includes("@")) return s;
  let d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) throw new Error("اكتب الرقم بالصيغة الدولية بدون صفر بالأول، مثل 962791234567");
  if (!/^\d{8,15}$/.test(d)) throw new Error("رقم غير صالح");
  return d + "@s.whatsapp.net";
}

const phoneOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

// تحويل رسالة Baileys لشكل بسيط للـ webhook
function normalizeIncoming(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg;
  const chatId = m.key?.remoteJid || "";
  const altJid = m.key?.senderPn || m.key?.participant || null;
  const out = {
    idMessage: m.key?.id,
    chatId,
    phone: phoneOf(altJid && altJid.endsWith("@s.whatsapp.net") ? altJid : chatId),
    senderName: m.pushName || "",
    timestamp: Number(m.messageTimestamp || 0) || Math.floor(Date.now() / 1000),
    type: "unknown",
    text: "",
    hasMedia: false,
  };
  if (inner.conversation || inner.extendedTextMessage) {
    out.type = "text";
    out.text = inner.conversation || inner.extendedTextMessage.text || "";
  } else if (inner.imageMessage) {
    Object.assign(out, { type: "image", text: inner.imageMessage.caption || "", hasMedia: true, mimetype: inner.imageMessage.mimetype });
  } else if (inner.audioMessage) {
    Object.assign(out, { type: inner.audioMessage.ptt ? "voice" : "audio", hasMedia: true, mimetype: inner.audioMessage.mimetype, seconds: inner.audioMessage.seconds });
  } else if (inner.documentMessage) {
    Object.assign(out, { type: "document", text: inner.documentMessage.caption || "", hasMedia: true, mimetype: inner.documentMessage.mimetype, fileName: inner.documentMessage.fileName });
  } else if (inner.videoMessage) {
    Object.assign(out, { type: "video", text: inner.videoMessage.caption || "", hasMedia: true, mimetype: inner.videoMessage.mimetype });
  } else if (inner.locationMessage || inner.liveLocationMessage) {
    const l = inner.locationMessage || inner.liveLocationMessage;
    Object.assign(out, { type: "location", location: { lat: l.degreesLatitude, lng: l.degreesLongitude, name: l.name || "", address: l.address || "" } });
  } else if (inner.contactMessage) {
    Object.assign(out, { type: "contact", text: inner.contactMessage.displayName || "", vcard: inner.contactMessage.vcard });
  } else if (inner.stickerMessage) {
    out.type = "sticker";
  } else if (inner.buttonsResponseMessage || inner.listResponseMessage || inner.templateButtonReplyMessage) {
    out.type = "text";
    out.text = inner.buttonsResponseMessage?.selectedDisplayText || inner.listResponseMessage?.title || inner.templateButtonReplyMessage?.selectedDisplayText || "";
  }
  if (altJid && altJid !== chatId) out.altChatId = altJid;
  return out;
}

module.exports = { randomId, randomToken, safeEqual, toJid, phoneOf, normalizeIncoming };
