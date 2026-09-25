// إدارة كل الأرقام: إنشاء، تشغيل، حذف، وتوجيه الرسائل الواردة للـ webhook
const fs = require("fs");
const path = require("path");
const { Store } = require("./store");
const { Instance } = require("./instance");
const { deliver } = require("./webhook");
const { randomId, randomToken } = require("./util");

const MEDIA_TTL_MS = 24 * 3600e3;
const MAX_MEDIA = 16 * 1024 * 1024;

function checkWebhookUrl(u) {
  if (!u) return "";
  let url;
  try { url = new URL(String(u)); } catch (e) { const err = new Error("رابط الـ webhook غير صالح"); err.status = 400; err.code = "bad_request"; throw err; }
  if (!["http:", "https:"].includes(url.protocol)) { const err = new Error("رابط الـ webhook لازم يبلّش بـ http أو https"); err.status = 400; err.code = "bad_request"; throw err; }
  return url.toString();
}

class Manager {
  constructor({ dataDir, publicUrl = "", logger, factory, sleep, deliverImpl = deliver }) {
    this.dataDir = dataDir;
    this.publicUrl = publicUrl.replace(/\/+$/, "");
    this.logger = logger;
    this.factory = factory;
    this.sleep = sleep;
    this.deliver = deliverImpl;
    this.store = new Store(dataDir);
    this.instances = new Map();
    this.mediaDir = path.join(dataDir, "media");
  }

  async startAll() {
    for (const meta of this.store.all()) await this._spawn(meta);
  }

  async _spawn(meta) {
    const inst = new Instance(meta, { dataDir: this.dataDir, logger: this.logger, factory: this.factory, sleep: this.sleep });
    this.instances.set(meta.id, inst);
    inst.on("state", (s) => this._emit(inst, { typeWebhook: "stateInstanceChanged", stateInstance: s.state, me: s.me || inst.me || null }));
    inst.on("message", (msg, raw) => this._onMessage(inst, msg, raw).catch((e) => this.logger?.error?.(e)));
    try { await inst.start(); } catch (e) { this.logger?.error?.(e); }
    return inst;
  }

  async create({ name, webhookUrl, settings } = {}) {
    let id; do { id = randomId(10); } while (this.store.get(id));
    const meta = {
      id,
      name: String(name || "رقم " + id).slice(0, 80),
      apiToken: randomToken(),
      connectKey: randomToken(),
      webhookUrl: checkWebhookUrl(webhookUrl),
      webhookSecret: randomToken(),
      settings: settings && typeof settings === "object" ? settings : {},
      createdAt: new Date().toISOString(),
    };
    this.store.put(meta);
    await this._spawn(meta);
    return meta;
  }

  get(id) { return this.instances.get(id) || null; }
  list() { return [...this.instances.values()].map((i) => i.info()); }

  update(id, patch) {
    const inst = this.get(id);
    if (!inst) return null;
    const m = inst.meta;
    if (typeof patch.name === "string") m.name = patch.name.slice(0, 80);
    if (typeof patch.webhookUrl === "string") m.webhookUrl = checkWebhookUrl(patch.webhookUrl);
    if (patch.settings && typeof patch.settings === "object") {
      const allowed = ["replyWindowHours", "dailyLimit", "minDelayMs", "maxDelayMs", "typingMs", "ignoreGroups"];
      for (const k of allowed) if (k in patch.settings) m.settings[k] = patch.settings[k];
    }
    this.store.put(m);
    return inst.info();
  }

  async remove(id) {
    const inst = this.get(id);
    if (!inst) return false;
    await inst.logout();
    inst.removeAllListeners();
    this.instances.delete(id);
    this.store.remove(id);
    fs.rmSync(path.join(this.mediaDir, id), { recursive: true, force: true });
    return true;
  }

  async restart(id) {
    const inst = this.get(id);
    if (!inst) return null;
    await inst.stop();
    await inst.start();
    return inst.info();
  }

  mediaPath(id, msgId) {
    if (!/^[A-Za-z0-9]+$/.test(String(msgId))) return null;
    return path.join(this.mediaDir, id, msgId);
  }

  async _onMessage(inst, msg, raw) {
    const payload = { typeWebhook: "incomingMessageReceived", instanceId: inst.meta.id, ...msg };
    if (msg.hasMedia && inst.download) {
      try {
        const buf = await inst.download(raw);
        if (buf && buf.length <= MAX_MEDIA) {
          const p = this.mediaPath(inst.meta.id, msg.idMessage);
          if (p) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, buf);
            fs.writeFileSync(p + ".json", JSON.stringify({ mimetype: msg.mimetype || "application/octet-stream", fileName: msg.fileName || "" }));
            payload.mediaUrl = `${this.publicUrl}/api/${inst.meta.id}/media/${msg.idMessage}`;
          }
        }
      } catch (e) { payload.mediaError = "download_failed"; }
    }
    await this._emit(inst, payload);
  }

  async _emit(inst, event) {
    const m = inst.meta;
    if (!m.webhookUrl) return;
    const payload = Object.assign({ instanceId: m.id, timestamp: Math.floor(Date.now() / 1000) }, event);
    const r = await this.deliver(m.webhookUrl, m.webhookSecret, payload);
    if (!r.ok && !r.skipped) this.logger?.warn?.({ instance: m.id, error: r.error }, "webhook failed");
  }

  cleanupMedia(now = Date.now()) {
    if (!fs.existsSync(this.mediaDir)) return 0;
    let n = 0;
    for (const id of fs.readdirSync(this.mediaDir)) {
      const dir = path.join(this.mediaDir, id);
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (now - fs.statSync(p).mtimeMs > MEDIA_TTL_MS) { fs.rmSync(p, { force: true }); n++; }
      }
    }
    return n;
  }

  async shutdown() {
    for (const inst of this.instances.values()) await inst.stop();
  }
}

module.exports = { Manager, checkWebhookUrl };
