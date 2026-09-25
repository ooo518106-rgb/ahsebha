// حماية الرقم من الحظر: نافذة رد، حد يومي، وتأخير بين الرسائل.
// واتساب بيحظر الأرقام اللي بتبعت رسائل آلية لناس ما راسلوها، أو بتبعت كتير بسرعة.

const DEFAULTS = {
  replyWindowHours: 24, // ما منبعت إلا لحدا راسلنا خلال هالمدة
  dailyLimit: 300, // أقصى عدد رسائل صادرة باليوم
  minDelayMs: 2000, // أقل تأخير بين رسالتين
  maxDelayMs: 5000, // أكبر تأخير بين رسالتين
  typingMs: 1500, // «عم يكتب…» قبل كل رسالة
  ignoreGroups: true, // تجاهل رسائل الجروبات
};

function withDefaults(settings) {
  return Object.assign({}, DEFAULTS, settings || {});
}

class Guard {
  constructor(getSettings, now = () => Date.now()) {
    this.getSettings = getSettings;
    this.now = now;
    this.lastIncoming = new Map(); // chatId -> وقت آخر رسالة واردة
    this.day = null;
    this.sentToday = 0;
  }

  noteIncoming(...chatIds) {
    const t = this.now();
    for (const id of chatIds) if (id) this.lastIncoming.set(id, t);
  }

  _rollDay() {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.sentToday = 0; }
  }

  check(chatId) {
    const s = withDefaults(this.getSettings());
    this._rollDay();
    if (this.sentToday >= s.dailyLimit) {
      return { ok: false, reason: "daily_limit", message: `وصلت الحد اليومي (${s.dailyLimit} رسالة)` };
    }
    if (s.replyWindowHours > 0) {
      const last = this.lastIncoming.get(chatId);
      if (!last || this.now() - last > s.replyWindowHours * 3600e3) {
        return { ok: false, reason: "outside_reply_window", message: `ما بنقدر نبعت إلا لحدا راسلك خلال آخر ${s.replyWindowHours} ساعة` };
      }
    }
    return { ok: true };
  }

  noteSent() {
    this._rollDay();
    this.sentToday += 1;
  }

  status() {
    const s = withDefaults(this.getSettings());
    this._rollDay();
    return { sentToday: this.sentToday, dailyLimit: s.dailyLimit, activeChats: this.lastIncoming.size };
  }
}

// طابور إرسال لكل رقم: رسالة ورا رسالة مع تأخير عشوائي بينهم.
class SendQueue {
  constructor(getSettings, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random) {
    this.getSettings = getSettings;
    this.sleep = sleep;
    this.random = random;
    this.tail = Promise.resolve();
    this.first = true;
  }

  push(task) {
    const run = async () => {
      const s = withDefaults(this.getSettings());
      if (!this.first) await this.sleep(Math.round(s.minDelayMs + this.random() * Math.max(0, s.maxDelayMs - s.minDelayMs)));
      this.first = false;
      return task();
    };
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => {});
    return p;
  }
}

module.exports = { Guard, SendQueue, DEFAULTS, withDefaults };
