// رقم واتساب واحد مربوط بـ QR: اتصال، إعادة اتصال، استقبال وإرسال.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { Guard, SendQueue, withDefaults } = require("./guard");
const { toJid, normalizeIncoming, phoneOf } = require("./util");

const SKIP_JIDS = ["status@broadcast"];

// المصنع الحقيقي (Baileys). بالاختبارات منحط مصنع وهمي.
async function baileysFactory({ authDir, logger }) {
  const baileys = require("@whiskeysockets/baileys");
  const makeWASocket = baileys.default;
  const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
  let version;
  try { ({ version } = await baileys.fetchLatestBaileysVersion()); } catch (e) { /* نستعمل الافتراضي */ }
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: baileys.Browsers.appropriate("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);
  return {
    sock,
    loggedOutCode: baileys.DisconnectReason.loggedOut,
    restartCode: baileys.DisconnectReason.restartRequired,
    download: (m) => baileys.downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }),
  };
}

class Instance extends EventEmitter {
  constructor(meta, { dataDir, logger, factory = baileysFactory, sleep } = {}) {
    super();
    this.meta = meta;
    this.logger = logger;
    this.factory = factory;
    this.authDir = path.join(dataDir, "auth", meta.id);
    this.state = "stopped"; // stopped | starting | qr | qr_expired | connected | disconnected | logged_out
    this.qr = null;
    this.me = null;
    this.sock = null;
    this.retries = 0;
    this.qrFails = 0; // كم مرة انتهى الـ QR بدون ما حدا يمسحه
    this.seen = new Set(); // آخر الرسائل اللي وصلت، لمنع التكرار
    this.stopping = false;
    const settings = () => withDefaults(this.meta.settings);
    this.guard = new Guard(settings);
    this.queue = new SendQueue(settings, sleep);
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  _setState(s, extra) {
    if (this.state === s && !extra) return;
    this.state = s;
    this.emit("state", { state: s, ...(extra || {}) });
  }

  async start() {
    this.stopping = false;
    fs.mkdirSync(this.authDir, { recursive: true });
    this._setState("starting");
    const { sock, loggedOutCode, restartCode = 515, download } = await this.factory({ authDir: this.authDir, logger: this.logger });
    this.sock = sock;
    this.download = download;

    sock.ev.on("connection.update", (u) => {
      if (u.qr) { this.qr = u.qr; this._setState("qr"); }
      if (u.connection === "open") {
        this.qr = null;
        this.retries = 0;
        this.qrFails = 0;
        this.me = sock.user ? { id: sock.user.id, phone: phoneOf(sock.user.id), name: sock.user.name || "" } : null;
        this._setState("connected", { me: this.me });
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        this.sock = null;
        if (this.stopping) return this._setState("stopped");
        if (code === loggedOutCode) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
          this.me = null;
          return this._setState("logged_out");
        }
        // بعد مسح الـ QR واتساب بيطلب إعادة اتصال فورية
        if (code === restartCode) {
          setTimeout(() => { if (!this.stopping) this.start().catch((e) => this.logger?.error?.(e)); }, 500).unref?.();
          return this._setState("disconnected", { code });
        }
        // الـ QR انتهى وما حدا مسحه: منوقف بعد 3 مرات بدل ما نضل نولّد أكواد للأبد
        if (this.state === "qr" && ++this.qrFails >= 3) {
          this.qr = null;
          return this._setState("qr_expired");
        }
        this._setState("disconnected", { code });
        const wait = Math.min(60000, 2000 * 2 ** this.retries++);
        setTimeout(() => { if (!this.stopping) this.start().catch((e) => this.logger?.error?.(e)); }, wait).unref?.();
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const jid = m.key?.remoteJid || "";
        if (m.key?.fromMe || !m.message || SKIP_JIDS.includes(jid)) continue;
        if (jid.endsWith("@g.us") && withDefaults(this.meta.settings).ignoreGroups) continue;
        const msg = normalizeIncoming(m);
        if (msg.idMessage) {
          if (this.seen.has(msg.idMessage)) continue;
          this.seen.add(msg.idMessage);
          if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
        }
        this.guard.noteIncoming(msg.chatId, msg.altChatId, msg.phone ? msg.phone + "@s.whatsapp.net" : null);
        this.emit("message", msg, m);
      }
    });
  }

  async stop() {
    this.stopping = true;
    try { this.sock?.end?.(undefined); } catch (e) { /* ignore */ }
    this.sock = null;
    this._setState("stopped");
  }

  async logout() {
    this.stopping = true;
    try { await this.sock?.logout?.(); } catch (e) { /* ignore */ }
    this.sock = null;
    fs.rmSync(this.authDir, { recursive: true, force: true });
    this.me = null;
    this._setState("logged_out");
  }

  // content: { text } أو { image|document|audio: Buffer, mimetype, fileName, caption }
  async send(to, content, { force = false } = {}) {
    if (this.state !== "connected" || !this.sock) {
      const e = new Error("الرقم مش متصل"); e.status = 409; e.code = "not_connected"; throw e;
    }
    const jid = toJid(to);
    if (!force) {
      const c = this.guard.check(jid);
      if (!c.ok) { const e = new Error(c.message); e.status = 429; e.code = c.reason; throw e; }
    }
    return this.queue.push(async () => {
      const s = withDefaults(this.meta.settings);
      try {
        await this.sock.sendPresenceUpdate?.("composing", jid);
        await this.sleep(s.typingMs);
        await this.sock.sendPresenceUpdate?.("paused", jid);
      } catch (e) { /* الكتابة مش ضرورية */ }
      const res = await this.sock.sendMessage(jid, content);
      this.guard.noteSent();
      return { idMessage: res?.key?.id || null, chatId: jid };
    });
  }

  async markRead(key) {
    try { await this.sock?.readMessages?.([key]); } catch (e) { /* ignore */ }
  }

  info() {
    return {
      id: this.meta.id,
      name: this.meta.name,
      state: this.state,
      me: this.me,
      webhookUrl: this.meta.webhookUrl || "",
      settings: withDefaults(this.meta.settings),
      usage: this.guard.status(),
      createdAt: this.meta.createdAt,
    };
  }
}

module.exports = { Instance, baileysFactory };
