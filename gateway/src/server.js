// بوابة واتساب احسبها — الخادم
const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { Manager } = require("./manager");
const { safeEqual } = require("./util");

function httpError(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; return e; }
const bearer = (req) => String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(manager, { adminToken }) {
  if (!adminToken || adminToken.length < 16) throw new Error("ADMIN_TOKEN لازم يكون 16 حرف أو أكتر");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "25mb" }));
  app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

  app.get("/health", (req, res) => res.json({ ok: true, instances: manager.list().length }));

  // ─── لوحة المدير ───
  const admin = (req, res, next) => (safeEqual(bearer(req), adminToken) ? next() : next(httpError(401, "unauthorized", "مفتاح المدير غلط")));

  app.get("/admin/instances", admin, (req, res) => res.json({ instances: manager.list() }));

  app.post("/admin/instances", admin, wrap(async (req, res) => {
    const meta = await manager.create(req.body || {});
    res.status(201).json({
      id: meta.id, name: meta.name, apiToken: meta.apiToken, webhookSecret: meta.webhookSecret,
      connectUrl: `/connect.html?i=${meta.id}&k=${meta.connectKey}`,
    });
  }));

  app.get("/admin/instances/:id", admin, (req, res, next) => {
    const inst = manager.get(req.params.id);
    if (!inst) return next(httpError(404, "not_found", "الرقم مش موجود"));
    const m = inst.meta;
    res.json({ ...inst.info(), apiToken: m.apiToken, webhookSecret: m.webhookSecret, connectUrl: `/connect.html?i=${m.id}&k=${m.connectKey}` });
  });

  app.patch("/admin/instances/:id", admin, (req, res, next) => {
    const info = manager.update(req.params.id, req.body || {});
    if (!info) return next(httpError(404, "not_found", "الرقم مش موجود"));
    res.json(info);
  });

  app.post("/admin/instances/:id/restart", admin, wrap(async (req, res) => {
    const info = await manager.restart(req.params.id);
    if (!info) throw httpError(404, "not_found", "الرقم مش موجود");
    res.json(info);
  }));

  app.delete("/admin/instances/:id", admin, wrap(async (req, res) => {
    if (!(await manager.remove(req.params.id))) throw httpError(404, "not_found", "الرقم مش موجود");
    res.json({ ok: true });
  }));

  const qrPayload = async (inst) => ({
    state: inst.state,
    me: inst.me,
    qr: inst.state === "qr" && inst.qr ? await QRCode.toDataURL(inst.qr, { margin: 1, width: 320 }) : null,
  });

  app.get("/admin/instances/:id/qr", admin, wrap(async (req, res) => {
    const inst = manager.get(req.params.id);
    if (!inst) throw httpError(404, "not_found", "الرقم مش موجود");
    res.json(await qrPayload(inst));
  }));

  // ─── صفحة الربط للتاجر (بمفتاح ربط خاص، مش مفتاح الـ API) ───
  app.get("/connect/:id", wrap(async (req, res) => {
    const inst = manager.get(req.params.id);
    if (!inst || !safeEqual(req.query.k, inst.meta.connectKey)) throw httpError(404, "not_found", "رابط الربط غلط");
    res.json({ name: inst.meta.name, ...(await qrPayload(inst)) });
  }));

  // ─── واجهة الـ API لكل رقم (متل Green-API) ───
  const instAuth = (req, res, next) => {
    const inst = manager.get(req.params.id);
    if (!inst || !safeEqual(bearer(req) || req.query.token, inst.meta.apiToken)) return next(httpError(401, "unauthorized", "مفتاح الـ API غلط"));
    req.inst = inst;
    next();
  };

  app.get("/api/:id/state", instAuth, (req, res) => res.json({ state: req.inst.state, me: req.inst.me, usage: req.inst.guard.status() }));

  app.get("/api/:id/qr", instAuth, wrap(async (req, res) => res.json(await qrPayload(req.inst))));

  app.post("/api/:id/sendMessage", instAuth, wrap(async (req, res) => {
    const { chatId, phone, message } = req.body || {};
    if (!message || typeof message !== "string") throw httpError(400, "bad_request", "الرسالة فاضية");
    if (message.length > 4096) throw httpError(400, "bad_request", "الرسالة أطول من 4096 حرف");
    res.json(await req.inst.send(chatId || phone, { text: message }));
  }));

  app.post("/api/:id/sendFile", instAuth, wrap(async (req, res) => {
    const { chatId, phone, base64, mimetype, fileName, caption } = req.body || {};
    if (!base64) throw httpError(400, "bad_request", "الملف فاضي (base64)");
    const buf = Buffer.from(base64, "base64");
    if (!buf.length || buf.length > 16 * 1024 * 1024) throw httpError(400, "bad_request", "الملف فاضي أو أكبر من 16MB");
    const mt = String(mimetype || "application/octet-stream");
    const content = mt.startsWith("image/") ? { image: buf, caption: caption || undefined, mimetype: mt }
      : mt.startsWith("audio/") ? { audio: buf, mimetype: mt, ptt: !!req.body.ptt }
      : { document: buf, mimetype: mt, fileName: String(fileName || "file"), caption: caption || undefined };
    res.json(await req.inst.send(chatId || phone, content));
  }));

  app.post("/api/:id/sendLocation", instAuth, wrap(async (req, res) => {
    const { chatId, phone, lat, lng, name, address } = req.body || {};
    if (typeof lat !== "number" || typeof lng !== "number") throw httpError(400, "bad_request", "lat و lng لازم يكونوا أرقام");
    res.json(await req.inst.send(chatId || phone, { location: { degreesLatitude: lat, degreesLongitude: lng, name, address } }));
  }));

  app.get("/api/:id/media/:msgId", instAuth, (req, res, next) => {
    const p = manager.mediaPath(req.params.id, req.params.msgId);
    if (!p || !fs.existsSync(p)) return next(httpError(404, "not_found", "الملف مش موجود أو انتهت صلاحيته"));
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(p + ".json", "utf8")); } catch (e) { /* ignore */ }
    res.type(meta.mimetype || "application/octet-stream").sendFile(p);
  });

  app.post("/api/:id/settings", instAuth, (req, res) => {
    const { webhookUrl } = req.body || {};
    // التاجر بيقدر يغيّر الـ webhook، بس إعدادات الحماية للمدير وحده
    res.json(manager.update(req.params.id, { webhookUrl }));
  });

  app.post("/api/:id/logout", instAuth, wrap(async (req, res) => {
    await req.inst.logout();
    res.json({ ok: true });
  }));

  app.post("/api/:id/reconnect", instAuth, wrap(async (req, res) => res.json(await manager.restart(req.params.id))));

  // ─── الأخطاء ───
  app.use((req, res) => res.status(404).json({ error: "not_found", message: "المسار مش موجود" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500) manager.logger?.error?.(err);
    res.status(status).json({ error: err.code || (status >= 500 ? "server_error" : "bad_request"), message: status >= 500 ? "خطأ بالخادم" : err.message });
  });

  return app;
}

async function main() {
  const pino = require("pino");
  const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
  const manager = new Manager({
    dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
    publicUrl: process.env.PUBLIC_URL || "",
    logger,
  });
  const app = createApp(manager, { adminToken: process.env.ADMIN_TOKEN });
  await manager.startAll();
  setInterval(() => manager.cleanupMedia(), 3600e3).unref();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => logger.warn(`gateway on :${port}`));
  const bye = async () => { server.close(); await manager.shutdown(); process.exit(0); };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { createApp };
