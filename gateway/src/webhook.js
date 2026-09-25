// إرسال الأحداث لرابط الـ webhook مع توقيع HMAC وإعادة محاولة
const crypto = require("crypto");

async function deliver(url, secret, payload, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fetchImpl = fetch } = {}) {
  if (!url) return { ok: false, skipped: true };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", String(secret || "")).update(body).digest("hex");
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": "sha256=" + sig, "User-Agent": "ahsebha-wa-gateway" },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return { ok: true, status: r.status };
      last = new Error("HTTP " + r.status);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // خطأ من المستقبل، ما في داعي نعيد
    } catch (e) { last = e; }
    if (i < attempts - 1) await sleep(1000 * 3 ** i);
  }
  return { ok: false, error: String(last && last.message || last) };
}

module.exports = { deliver };
