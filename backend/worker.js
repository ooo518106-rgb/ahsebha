// احسبها — خادم طلبات الخدمات (Cloudflare Worker، ملف واحد)
//
// الإعدادات (Settings → Variables and Secrets / Bindings):
//   ORDERS            KV namespace لتخزين الطلبات والملفات
//   PAYPAL_CLIENT_ID  Client ID من تطبيق PayPal (Live)
//   PAYPAL_SECRET     Secret من تطبيق PayPal (سرّي)
//   PAYPAL_ENV        "live" أو "sandbox" للتجربة
//   AGENT_TOKEN       مفتاح سرّي طويل يستعمله الإيجنت (سرّي)
//   ALLOWED_ORIGIN    https://ooo518106-rgb.github.io

const CURRENCY = "USD";
const MAX_BODY = 120 * 1024;
const MAX_FILE = 20 * 1024 * 1024;
const UNPAID_TTL = 3 * 24 * 3600;

// ─── كتالوج الخدمات (السعر يُحسب هنا فقط، المتصفح يعرضه للتقدير) ───
const CATALOG = [
  {
    id: "cv", icon: "📄", hours: 24,
    name: "سيرة ذاتية احترافية متوافقة مع ATS",
    blurb: "نعيد كتابة سيرتك بصياغة قوية وكلمات مفتاحية تناسب الوظيفة، بتنسيق تقرؤه أنظمة فرز المتقدمين.",
    delivers: "ملف Word جاهز + النص",
    pricing: { type: "fixed", base: 15, addons: { language: { both: 8 }, cover: { true: 5 } } },
    fields: [
      { id: "target", label: "الوظيفة أو المجال الذي تتقدم إليه", type: "text", required: true, max: 200, placeholder: "مثال: محاسب في شركة تجزئة" },
      { id: "language", label: "لغة السيرة", type: "select", required: true, options: [["ar", "العربية"], ["en", "الإنجليزية"], ["both", "العربية + الإنجليزية (+8$)"]] },
      { id: "info", label: "الصق سيرتك الحالية أو اكتب معلوماتك", type: "textarea", required: true, max: 15000,
        placeholder: "الاسم، المدينة، طريقة التواصل، التعليم، الخبرات بالتواريخ، المهارات، الدورات، اللغات…" },
      { id: "cover", label: "أضف رسالة تعريفية Cover Letter (+5$)", type: "checkbox" },
    ],
  },
  {
    id: "translate", icon: "🌐", hours: 24,
    name: "ترجمة عربي ↔ إنجليزي",
    blurb: "ترجمة طبيعية تُقرأ وكأنها كُتبت بلغتها، مع مراجعة لغوية كاملة. 8$ لكل 500 كلمة.",
    delivers: "ملف Word + النص",
    pricing: { type: "per_words", field: "text", unit: 500, rate: 8, min: 8 },
    fields: [
      { id: "direction", label: "اتجاه الترجمة", type: "select", required: true, options: [["en-ar", "من الإنجليزية إلى العربية"], ["ar-en", "من العربية إلى الإنجليزية"]] },
      { id: "text", label: "النص المطلوب ترجمته (حتى 5000 كلمة)", type: "textarea", required: true, max: 40000, maxWords: 5000 },
      { id: "notes", label: "ملاحظات (المجال، الأسلوب، مصطلحات معيّنة)", type: "text", max: 500 },
    ],
  },
  {
    id: "article", icon: "✍️", hours: 24,
    name: "مقالات عربية حصرية متوافقة مع SEO",
    blurb: "مقالات أصلية بعناوين فرعية منظمة ووصف ميتا جاهز، مكتوبة للقارئ ولمحركات البحث.",
    delivers: "ملف Word لكل الطلب + النص",
    pricing: { type: "table", field: "length", table: { "600": 8, "1000": 12, "1500": 18 }, multiplyBy: "count" },
    fields: [
      { id: "topic", label: "موضوع المقالة أو المقالات", type: "textarea", required: true, max: 2000, placeholder: "إذا طلبت أكثر من مقالة، اكتب موضوع كل واحدة بسطر" },
      { id: "keywords", label: "الكلمات المفتاحية (اختياري)", type: "text", max: 300 },
      { id: "audience", label: "الجمهور والأسلوب (اختياري)", type: "text", max: 300, placeholder: "مثال: أصحاب المتاجر في السعودية، أسلوب بسيط" },
      { id: "length", label: "طول المقالة", type: "select", required: true, options: [["600", "600 كلمة — 8$"], ["1000", "1000 كلمة — 12$"], ["1500", "1500 كلمة — 18$"]] },
      { id: "count", label: "عدد المقالات", type: "select", required: true, options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]] },
    ],
  },
  {
    id: "products", icon: "🛍️", hours: 24,
    name: "أوصاف منتجات لمتجرك",
    blurb: "أوصاف مقنعة ومتوافقة مع SEO لمنتجات سلة وزد وأي متجر. 10$ لكل 10 منتجات.",
    delivers: "ملف Excel جاهز للرفع + النص",
    pricing: { type: "per_lines", field: "products", unit: 10, rate: 10, min: 10 },
    fields: [
      { id: "store", label: "نوع المتجر وجمهوره", type: "text", required: true, max: 300, placeholder: "مثال: متجر عطور نسائية في الرياض" },
      { id: "products", label: "المنتجات (منتج في كل سطر: الاسم + أهم المعلومات)، حتى 100 منتج", type: "textarea", required: true, max: 20000, maxLines: 100 },
      { id: "tone", label: "الأسلوب", type: "select", required: true, options: [["fusha", "فصحى بسيطة"], ["gulf", "لهجة خليجية خفيفة"], ["luxury", "فاخر وراقٍ"]] },
    ],
  },
  {
    id: "excel", icon: "📊", hours: 24,
    name: "شيت إكسل جاهز لإدارة شغلك",
    blurb: "جداول منظمة بمعادلات تلقائية ولوحة ملخص، يعمل على Excel وGoogle Sheets.",
    delivers: "ملف Excel",
    pricing: { type: "fixed", base: 25, addons: { kind: { custom: 15 } } },
    fields: [
      { id: "kind", label: "نوع الشيت", type: "select", required: true, options: [["sales", "المبيعات والمخزون"], ["expenses", "المصاريف والأرباح"], ["hr", "الموظفين والحضور والرواتب"], ["invoices", "الفواتير والعملاء"], ["custom", "شيت مخصص حسب وصفك (+15$)"]] },
      { id: "details", label: "صف نشاطك وما تريد أن يحسبه الشيت", type: "textarea", required: true, max: 5000 },
    ],
  },
  {
    id: "slides", icon: "🖥️", hours: 24,
    name: "عرض تقديمي بوربوينت",
    blurb: "عرض منظم بتسلسل واضح ونقاط مختصرة وملاحظات للمتحدث، جاهز للتعديل.",
    delivers: "ملف PowerPoint",
    pricing: { type: "table", field: "slides", table: { "10": 20, "15": 28, "20": 35 } },
    fields: [
      { id: "topic", label: "موضوع العرض", type: "text", required: true, max: 300 },
      { id: "audience", label: "لمن العرض؟", type: "text", required: true, max: 300, placeholder: "مثال: مستثمرين، إدارة الشركة، لجنة جامعية" },
      { id: "content", label: "المحتوى أو النقاط (اختياري — إذا تركته فارغاً نكتب المحتوى)", type: "textarea", max: 20000 },
      { id: "slides", label: "عدد الشرائح", type: "select", required: true, options: [["10", "10 شرائح — 20$"], ["15", "15 شريحة — 28$"], ["20", "20 شريحة — 35$"]] },
    ],
  },
];

const byId = Object.fromEntries(CATALOG.map((s) => [s.id, s]));

export function countWords(t) { return String(t || "").trim().split(/\s+/).filter(Boolean).length; }
export function countLines(t) { return String(t || "").split(/\n/).map((s) => s.trim()).filter(Boolean).length; }

export function priceOf(p, f) {
  let v = 0;
  if (p.type === "fixed") v = p.base;
  else if (p.type === "table") v = Number(p.table[String(f[p.field])] || 0);
  else if (p.type === "per_words") v = Math.max(p.min, Math.ceil(countWords(f[p.field]) / p.unit) * p.rate);
  else if (p.type === "per_lines") v = Math.max(p.min, Math.ceil(countLines(f[p.field]) / p.unit) * p.rate);
  for (const k in p.addons || {}) {
    const val = f[k] === true ? "true" : String(f[k] ?? "");
    if (p.addons[k][val]) v += p.addons[k][val];
  }
  if (p.multiplyBy) v *= Math.max(1, parseInt(f[p.multiplyBy], 10) || 1);
  return Math.round(v * 100) / 100;
}

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export function validateOrder(body) {
  const svc = byId[body && body.service];
  if (!svc) throw new HttpError(400, "unknown_service", "الخدمة غير موجودة");
  const input = (body.fields && typeof body.fields === "object") ? body.fields : {};
  const fields = {};
  const errors = {};
  for (const fd of svc.fields) {
    let v = input[fd.id];
    if (fd.type === "checkbox") { fields[fd.id] = v === true || v === "true" || v === "on"; continue; }
    v = typeof v === "string" ? v.trim() : "";
    if (fd.required && !v) { errors[fd.id] = "هذا الحقل مطلوب"; continue; }
    if (fd.max && v.length > fd.max) { errors[fd.id] = `النص أطول من المسموح (${fd.max} حرف)`; continue; }
    if (fd.type === "select" && v && !fd.options.some((o) => o[0] === v)) { errors[fd.id] = "اختيار غير صالح"; continue; }
    if (fd.maxWords && countWords(v) > fd.maxWords) { errors[fd.id] = `الحد الأقصى ${fd.maxWords} كلمة`; continue; }
    if (fd.maxLines && countLines(v) > fd.maxLines) { errors[fd.id] = `الحد الأقصى ${fd.maxLines} سطر`; continue; }
    fields[fd.id] = v;
  }
  const email = String(body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) errors.email = "اكتب بريداً إلكترونياً صحيحاً";
  if (Object.keys(errors).length) { const e = new HttpError(400, "invalid_fields", "راجع الحقول المظللة"); e.fields = errors; throw e; }
  const price = priceOf(svc.pricing, fields);
  if (!(price > 0)) throw new HttpError(400, "bad_price", "تعذّر حساب السعر");
  return { svc, fields, email, price };
}

// ─── أدوات ───
function rid(n, alphabet) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (const b of bytes) s += alphabet[b % alphabet.length]; return s;
}
const newId = () => "AH" + rid(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
const newKey = () => rid(32, "abcdefghijklmnopqrstuvwxyz0123456789");
const now = () => new Date().toISOString();

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function corsHeaders(env, req) {
  const origin = req.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { Vary: "Origin" };
  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {}) });
}

async function readJson(req, limit) {
  limit = limit || MAX_BODY;
  if (Number(req.headers.get("Content-Length") || 0) > limit) throw new HttpError(413, "too_large", "الطلب أكبر من المسموح");
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "too_large", "الطلب أكبر من المسموح");
  try { return JSON.parse(text || "{}"); } catch (e) { throw new HttpError(400, "bad_json"); }
}

// ─── التخزين ───
async function getOrder(env, id) {
  if (!/^AH[A-Z0-9]{8}$/.test(id || "")) return null;
  return await env.ORDERS.get("order:" + id, { type: "json" });
}

async function putOrder(env, o) {
  const opts = { metadata: { status: o.status, service: o.service, createdAt: o.createdAt, paidAt: o.paidAt || null } };
  if (o.status === "awaiting_payment") opts.expirationTtl = UNPAID_TTL;
  await env.ORDERS.put("order:" + o.id, JSON.stringify(o), opts);
}

function setStatus(o, status, by, note) {
  o.status = status;
  o.history = o.history || [];
  o.history.push({ at: now(), status, by, note: note || undefined });
}

function publicView(o) {
  const svc = byId[o.service] || {};
  return {
    id: o.id, service: o.service, serviceName: o.serviceName, icon: svc.icon || "",
    price: o.price, currency: o.currency, status: o.status, hours: svc.hours || 24,
    createdAt: o.createdAt, paidAt: o.paidAt || null, deliveredAt: o.deliveredAt || null,
    publicNote: o.publicNote || "",
    result: o.status === "delivered" && o.result
      ? { text: o.result.text || "", files: (o.result.files || []).map((f, n) => ({ n, name: f.name, size: f.size })) }
      : null,
  };
}

// ─── PayPal ───
function ppBase(env) { return env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com"; }

async function ppToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) throw new HttpError(503, "payments_not_configured", "الدفع غير مفعّل بعد");
  const r = await fetch(ppBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_SECRET), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new HttpError(502, "paypal_auth_failed", "تعذّر الاتصال بـ PayPal");
  return (await r.json()).access_token;
}

async function ppCreate(env, o) {
  const token = await ppToken(env);
  const r = await fetch(ppBase(env) + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "PayPal-Request-Id": "create-" + o.id },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: o.id, custom_id: o.id, invoice_id: o.id,
        description: (o.serviceName + " — " + o.id).slice(0, 127),
        amount: { currency_code: CURRENCY, value: o.price.toFixed(2) },
      }],
    }),
  });
  if (!r.ok) throw new HttpError(502, "paypal_create_failed", "تعذّر إنشاء عملية الدفع");
  return (await r.json()).id;
}

async function ppCapture(env, o) {
  const token = await ppToken(env);
  const base = ppBase(env) + "/v2/checkout/orders/" + encodeURIComponent(o.paypalOrderId);
  let r = await fetch(base + "/capture", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "PayPal-Request-Id": "capture-" + o.id },
    body: "{}",
  });
  let data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // ربما تم التحصيل سابقاً: نقرأ حالة الطلب من PayPal مباشرة
    const g = await fetch(base, { headers: { Authorization: "Bearer " + token } });
    data = await g.json().catch(() => ({}));
    if (!g.ok) throw new HttpError(502, "paypal_capture_failed", "لم تكتمل عملية الدفع");
  }
  const cap = data && data.purchase_units && data.purchase_units[0] && data.purchase_units[0].payments
    && data.purchase_units[0].payments.captures && data.purchase_units[0].payments.captures[0];
  return { orderStatus: data.status, cap, payerEmail: data.payer && data.payer.email_address };
}

// ─── المسارات ───
async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  let mm;

  if (m === "GET" && p === "/api/config") {
    return json({ paypalClientId: env.PAYPAL_CLIENT_ID || "", currency: CURRENCY, enabled: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) });
  }
  if (m === "GET" && p === "/api/catalog") {
    return json({ currency: CURRENCY, services: CATALOG });
  }

  if (m === "POST" && p === "/api/orders") {
    const body = await readJson(req);
    const { svc, fields, email, price } = validateOrder(body);
    const o = {
      id: newId(), key: newKey(), service: svc.id, serviceName: svc.name, fields, email,
      price, currency: CURRENCY, status: "awaiting_payment", createdAt: now(), history: [],
    };
    o.paypalOrderId = await ppCreate(env, o);
    setStatus(o, "awaiting_payment", "customer");
    await putOrder(env, o);
    return json({ id: o.id, key: o.key, paypalOrderId: o.paypalOrderId, price: o.price, currency: o.currency });
  }

  if (m === "POST" && (mm = p.match(/^\/api\/orders\/(AH[A-Z0-9]{8})\/capture$/))) {
    const body = await readJson(req);
    const o = await getOrder(env, mm[1]);
    if (!o || !safeEqual(body.key, o.key)) throw new HttpError(404, "not_found", "الطلب غير موجود");
    if (o.status !== "awaiting_payment") return json(publicView(o));
    const { cap, payerEmail } = await ppCapture(env, o);
    if (!cap) throw new HttpError(402, "not_paid", "لم تكتمل عملية الدفع");
    const amountOk = cap.amount && cap.amount.currency_code === CURRENCY && Number(cap.amount.value) === o.price;
    o.captureId = cap.id; o.payerEmail = payerEmail || null;
    if (cap.status === "COMPLETED" && amountOk) {
      o.paidAt = now();
      setStatus(o, "paid", "paypal");
    } else if (cap.status === "PENDING" && amountOk) {
      o.paidAt = now();
      o.publicNote = "تم استلام الدفع وهو قيد التأكيد لدى PayPal. سنبدأ فور تأكيده.";
      setStatus(o, "needs_review", "paypal", "capture pending: " + ((cap.status_details && cap.status_details.reason) || ""));
    } else {
      setStatus(o, "needs_review", "paypal", "unexpected capture: " + cap.status + " " + JSON.stringify(cap.amount || {}));
      o.publicNote = "نراجع عملية الدفع وسنتواصل معك.";
    }
    await putOrder(env, o);
    return json(publicView(o));
  }

  if (m === "GET" && (mm = p.match(/^\/api\/orders\/(AH[A-Z0-9]{8})$/))) {
    const o = await getOrder(env, mm[1]);
    if (!o || !safeEqual(url.searchParams.get("key"), o.key)) throw new HttpError(404, "not_found", "الطلب غير موجود");
    return json(publicView(o));
  }

  if (m === "GET" && (mm = p.match(/^\/api\/orders\/(AH[A-Z0-9]{8})\/files\/(\d{1,2})$/))) {
    const o = await getOrder(env, mm[1]);
    if (!o || !safeEqual(url.searchParams.get("key"), o.key) || o.status !== "delivered") throw new HttpError(404, "not_found", "الملف غير موجود");
    const meta = o.result && o.result.files && o.result.files[Number(mm[2])];
    const buf = meta && await env.ORDERS.get(`file:${o.id}:${mm[2]}`, { type: "arrayBuffer" });
    if (!buf) throw new HttpError(404, "not_found", "الملف غير موجود");
    return new Response(buf, { headers: {
      "Content-Type": meta.mime || "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(meta.name),
      "Cache-Control": "private, no-store",
    } });
  }

  // ─── واجهة الإيجنت ───
  if (p.startsWith("/api/agent/")) {
    const auth = req.headers.get("Authorization") || "";
    if (!env.AGENT_TOKEN || !safeEqual(auth.replace(/^Bearer\s+/i, ""), env.AGENT_TOKEN)) throw new HttpError(401, "unauthorized");

    if (m === "GET" && p === "/api/agent/orders") {
      const want = new Set((url.searchParams.get("status") || "paid,in_progress").split(",").map((s) => s.trim()).filter(Boolean));
      const ids = []; let cursor;
      do {
        const page = await env.ORDERS.list({ prefix: "order:", cursor });
        for (const k of page.keys) if (k.metadata && want.has(k.metadata.status)) ids.push(k.name.slice(6));
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      const orders = (await Promise.all(ids.map((id) => getOrder(env, id)))).filter((o) => o && want.has(o.status));
      orders.sort((a, b) => String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)));
      return json({ orders: orders.map(({ key, ...o }) => o) });
    }

    if ((mm = p.match(/^\/api\/agent\/orders\/(AH[A-Z0-9]{8})(\/[a-z]+)?$/))) {
      const o = await getOrder(env, mm[1]);
      if (!o) throw new HttpError(404, "not_found");
      const action = mm[2] || "";

      if (m === "GET" && !action) { const { key, ...rest } = o; return json(rest); }

      if (m === "POST" && action === "/status") {
        const body = await readJson(req);
        const allowed = ["paid", "in_progress", "needs_review", "refunded", "cancelled"];
        if (!allowed.includes(body.status)) throw new HttpError(400, "bad_status");
        if (typeof body.publicNote === "string") o.publicNote = body.publicNote.slice(0, 1000);
        setStatus(o, body.status, "agent", typeof body.note === "string" ? body.note.slice(0, 2000) : undefined);
        await putOrder(env, o);
        return json({ ok: true, status: o.status });
      }

      if (m === "POST" && action === "/deliver") {
        if (!["paid", "in_progress", "needs_review", "delivered"].includes(o.status)) throw new HttpError(409, "not_payable_state", "الطلب غير مدفوع");
        const body = await readJson(req, 90 * 1024 * 1024);
        const files = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
        const metas = [];
        for (let n = 0; n < files.length; n++) {
          const f = files[n];
          const bin = Uint8Array.from(atob(String(f.base64 || "")), (c) => c.charCodeAt(0));
          if (!bin.length || bin.length > MAX_FILE) throw new HttpError(400, "bad_file", "ملف فارغ أو كبير");
          await env.ORDERS.put(`file:${o.id}:${n}`, bin);
          metas.push({ name: String(f.name || `file-${n}`).slice(0, 120), mime: String(f.mime || "application/octet-stream").slice(0, 120), size: bin.length });
        }
        o.result = { text: String(body.text || "").slice(0, 200000), files: metas };
        if (typeof body.publicNote === "string") o.publicNote = body.publicNote.slice(0, 1000);
        o.deliveredAt = now();
        setStatus(o, "delivered", "agent");
        await putOrder(env, o);
        return json({ ok: true, status: o.status, files: metas.length });
      }
    }
    throw new HttpError(404, "not_found");
  }

  throw new HttpError(404, "not_found");
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env);
      for (const k in cors) res.headers.set(k, cors[k]);
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const body = { error: e instanceof HttpError ? e.code : "server_error", message: e instanceof HttpError ? e.message : "حدث خطأ غير متوقع" };
      if (e && e.fields) body.fields = e.fields;
      if (!(e instanceof HttpError)) console.error(e && e.stack || e);
      return json(body, status, cors);
    }
  },
};
