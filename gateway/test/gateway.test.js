const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { Guard, SendQueue } = require("../src/guard");
const { toJid, normalizeIncoming } = require("../src/util");
const { Manager } = require("../src/manager");
const { createApp } = require("../src/server");

// ─── واتساب وهمي ───
function fakeFactory(registry) {
  return async () => {
    const ev = new EventEmitter();
    const sock = {
      ev, user: null, sent: [], presence: [],
      sendMessage: async (jid, content) => { sock.sent.push({ jid, content }); return { key: { id: "OUT" + sock.sent.length } }; },
      sendPresenceUpdate: async (p, jid) => { sock.presence.push([p, jid]); },
      readMessages: async () => {},
      logout: async () => {},
      end: () => {},
    };
    registry.push(sock);
    return { sock, loggedOutCode: 401, download: async () => Buffer.from("IMAGEBYTES") };
  };
}
const noSleep = async () => {};

test("guard: reply window and daily limit", () => {
  let now = Date.parse("2026-09-25T10:00:00Z");
  const settings = { replyWindowHours: 24, dailyLimit: 2 };
  const g = new Guard(() => settings, () => now);
  assert.equal(g.check("a@s.whatsapp.net").reason, "outside_reply_window");
  g.noteIncoming("a@s.whatsapp.net");
  assert.equal(g.check("a@s.whatsapp.net").ok, true);
  g.noteSent(); g.noteSent();
  assert.equal(g.check("a@s.whatsapp.net").reason, "daily_limit");
  now += 24 * 3600e3 + 1; // يوم جديد، والنافذة انتهت
  assert.equal(g.check("a@s.whatsapp.net").reason, "outside_reply_window");
  g.noteIncoming("a@s.whatsapp.net");
  assert.equal(g.check("a@s.whatsapp.net").ok, true);
});

test("queue waits a random delay between sends, not before the first", async () => {
  const waits = [];
  const q = new SendQueue(() => ({ minDelayMs: 1000, maxDelayMs: 3000 }), async (ms) => { waits.push(ms); }, () => 0.5);
  const out = await Promise.all([q.push(async () => 1), q.push(async () => 2), q.push(async () => 3)]);
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(waits, [2000, 2000]);
});

test("toJid and normalizeIncoming", () => {
  assert.equal(toJid("+962 79 123 4567"), "962791234567@s.whatsapp.net");
  assert.equal(toJid("00962791234567"), "962791234567@s.whatsapp.net");
  assert.throws(() => toJid("0791234567"), /الصيغة الدولية/);
  const m = normalizeIncoming({ key: { id: "ABC", remoteJid: "123@lid", senderPn: "962791234567@s.whatsapp.net" }, pushName: "أحمد", message: { extendedTextMessage: { text: "بدي أطلب" } } });
  assert.equal(m.type, "text");
  assert.equal(m.text, "بدي أطلب");
  assert.equal(m.phone, "962791234567");
  assert.equal(m.altChatId, "962791234567@s.whatsapp.net");
  const loc = normalizeIncoming({ key: { id: "L", remoteJid: "9@s.whatsapp.net" }, message: { locationMessage: { degreesLatitude: 31.95, degreesLongitude: 35.91 } } });
  assert.deepEqual(loc.location, { lat: 31.95, lng: 35.91, name: "", address: "" });
});

test("API: create, QR, connect, receive, reply, media, logout, delete", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const socks = [];
  const hooks = [];
  const manager = new Manager({
    dataDir, publicUrl: "http://gw.test", factory: fakeFactory(socks), sleep: noSleep,
    deliverImpl: async (url, secret, payload) => { hooks.push({ url, secret, payload }); return { ok: true }; },
  });
  const ADMIN = "admin-token-123456789";
  const app = createApp(manager, { adminToken: ADMIN });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body, token) => fetch(base + p, {
    method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    assert.equal((await call("GET", "/admin/instances")).status, 401);

    const created = await (await call("POST", "/admin/instances", { name: "متجر العطور", webhookUrl: "https://bot.test/hook" }, ADMIN)).json();
    assert.ok(created.id && created.apiToken && created.connectUrl);
    const sock = socks[0];
    const id = created.id, T = created.apiToken;
    const key = new URL("http://x" + created.connectUrl).searchParams.get("k");

    // QR
    sock.ev.emit("connection.update", { qr: "2@fake-qr-data" });
    const qr = await (await call("GET", `/connect/${id}?k=${key}`)).json();
    assert.equal(qr.state, "qr");
    assert.match(qr.qr, /^data:image\/png;base64,/);
    assert.equal((await call("GET", `/connect/${id}?k=wrong`)).status, 404);

    // اتصل
    sock.user = { id: "962790000000:5@s.whatsapp.net", name: "متجر" };
    sock.ev.emit("connection.update", { connection: "open" });
    const st = await (await call("GET", `/api/${id}/state`, null, T)).json();
    assert.equal(st.state, "connected");
    assert.equal(st.me.phone, "962790000000");
    assert.ok(hooks.some((h) => h.payload.typeWebhook === "stateInstanceChanged" && h.payload.stateInstance === "connected"));

    // ممنوع نبعت لحدا ما راسلنا
    const cold = await call("POST", `/api/${id}/sendMessage`, { phone: "962791234567", message: "مرحبا" }, T);
    assert.equal(cold.status, 429);
    assert.equal((await cold.json()).error, "outside_reply_window");
    assert.equal((await call("POST", `/api/${id}/sendMessage`, { phone: "962791234567", message: "x" }, "bad")).status, 401);

    // رسالة واردة ← webhook
    sock.ev.emit("messages.upsert", { type: "notify", messages: [
      { key: { id: "IN1", remoteJid: "962791234567@s.whatsapp.net", fromMe: false }, pushName: "سارة", message: { conversation: "كم سعر العطر؟" } },
      { key: { id: "G1", remoteJid: "123@g.us", fromMe: false }, message: { conversation: "جروب" } },
      { key: { id: "ME", remoteJid: "962791234567@s.whatsapp.net", fromMe: true }, message: { conversation: "مني" } },
    ] });
    await new Promise((r) => setImmediate(r));
    const inc = hooks.filter((h) => h.payload.typeWebhook === "incomingMessageReceived");
    assert.equal(inc.length, 1);
    assert.equal(inc[0].payload.text, "كم سعر العطر؟");
    assert.equal(inc[0].payload.senderName, "سارة");
    assert.equal(inc[0].url, "https://bot.test/hook");

    // هلأ مسموح نرد
    const ok = await (await call("POST", `/api/${id}/sendMessage`, { phone: "962791234567", message: "السعر 25 دينار" }, T)).json();
    assert.equal(ok.chatId, "962791234567@s.whatsapp.net");
    assert.deepEqual(sock.sent.at(-1), { jid: "962791234567@s.whatsapp.net", content: { text: "السعر 25 دينار" } });
    assert.deepEqual(sock.presence.slice(-2).map((p) => p[0]), ["composing", "paused"]);

    // صورة واردة ← محفوظة ورابطها بالـ webhook
    sock.ev.emit("messages.upsert", { type: "notify", messages: [
      { key: { id: "IMG1", remoteJid: "962791234567@s.whatsapp.net" }, message: { imageMessage: { caption: "إشعار كليك", mimetype: "image/jpeg" } } },
    ] });
    await new Promise((r) => setTimeout(r, 20));
    const img = hooks.filter((h) => h.payload.idMessage === "IMG1")[0].payload;
    assert.equal(img.type, "image");
    assert.equal(img.mediaUrl, `http://gw.test/api/${id}/media/IMG1`);
    const media = await call("GET", `/api/${id}/media/IMG1`, null, T);
    assert.equal(media.status, 200);
    assert.equal(Buffer.from(await media.arrayBuffer()).toString(), "IMAGEBYTES");
    assert.equal((await call("GET", `/api/${id}/media/..%2F..%2Finstances.json`, null, T)).status, 404);

    // إعدادات الحماية للمدير بس
    await call("POST", `/api/${id}/settings`, { webhookUrl: "https://bot.test/new", settings: { dailyLimit: 99999 } }, T);
    const info = await (await call("GET", `/admin/instances/${id}`, null, ADMIN)).json();
    assert.equal(info.webhookUrl, "https://bot.test/new");
    assert.equal(info.settings.dailyLimit, 300);

    // واتساب سجّل خروج الرقم
    sock.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
    assert.equal((await (await call("GET", `/api/${id}/state`, null, T)).json()).state, "logged_out");

    // الإعدادات بتنحفظ بعد إعادة التشغيل
    const again = new Manager({ dataDir, factory: fakeFactory([]), sleep: noSleep, deliverImpl: async () => ({ ok: true }) });
    await again.startAll();
    assert.equal(again.list()[0].name, "متجر العطور");

    assert.equal((await call("DELETE", `/admin/instances/${id}`, null, ADMIN)).status, 200);
    assert.equal((await (await call("GET", "/admin/instances", null, ADMIN)).json()).instances.length, 0);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
