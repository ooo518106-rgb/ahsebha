import test from "node:test";
import assert from "node:assert/strict";
import worker, { priceOf, countWords } from "../worker.js";

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, o) {
    const e = this.m.get(k); if (!e) return null;
    const t = o && o.type;
    if (t === "json") return JSON.parse(e.v);
    if (t === "arrayBuffer") return e.v.buffer.slice(e.v.byteOffset, e.v.byteOffset + e.v.byteLength);
    return e.v;
  }
  async put(k, v, o) { this.m.set(k, { v, meta: o && o.metadata, ttl: o && o.expirationTtl }); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) {
    return { list_complete: true, keys: [...this.m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })) };
  }
}

const ORIGIN = "https://ooo518106-rgb.github.io";
function makeEnv() {
  return { ORDERS: new FakeKV(), PAYPAL_CLIENT_ID: "cid", PAYPAL_SECRET: "sec", PAYPAL_ENV: "sandbox", AGENT_TOKEN: "agent-secret-token", ALLOWED_ORIGIN: ORIGIN };
}

// PayPal وهمي: يسجّل الطلبات ويرجع التحصيل بالمبلغ اللي نحدده
const pp = { created: [], captureAmount: null, captureStatus: "COMPLETED" };
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok" });
  if (url.endsWith("/v2/checkout/orders")) {
    const body = JSON.parse(init.body); pp.created.push(body);
    return Response.json({ id: "PP" + pp.created.length, status: "CREATED" });
  }
  if (/\/v2\/checkout\/orders\/PP\d+\/capture$/.test(url)) {
    const value = pp.captureAmount;
    return Response.json({ status: "COMPLETED", payer: { email_address: "buyer@example.com" },
      purchase_units: [{ payments: { captures: [{ id: "CAP1", status: pp.captureStatus, amount: { currency_code: "USD", value } }] } }] });
  }
  throw new Error("unexpected fetch " + url);
};

const call = (env, method, path, body, headers) => worker.fetch(new Request("https://w.example" + path, {
  method, headers: Object.assign({ "Content-Type": "application/json", Origin: ORIGIN }, headers || {}),
  body: body == null ? undefined : JSON.stringify(body),
}), env);

const cvOrder = { service: "cv", email: "a@b.co", fields: { target: "محاسب", language: "both", info: "خبرة 5 سنوات", cover: true } };

test("pricing rules", () => {
  assert.equal(priceOf({ type: "fixed", base: 15, addons: { language: { both: 8 }, cover: { true: 5 } } }, { language: "both", cover: true }), 28);
  assert.equal(priceOf({ type: "per_words", field: "t", unit: 500, rate: 8, min: 8 }, { t: "كلمة ".repeat(1200) }), 24);
  assert.equal(priceOf({ type: "per_words", field: "t", unit: 500, rate: 8, min: 8 }, { t: "كلمة" }), 8);
  assert.equal(priceOf({ type: "table", field: "length", table: { "1000": 12 }, multiplyBy: "count" }, { length: "1000", count: "3" }), 36);
  assert.equal(countWords("  a  b\nc "), 3);
});

test("catalog and config are public", async () => {
  const env = makeEnv();
  const c = await (await call(env, "GET", "/api/catalog")).json();
  assert.ok(c.services.length >= 6);
  const cfg = await (await call(env, "GET", "/api/config")).json();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.paypalClientId, "cid");
});

test("CORS preflight only for the site origin", async () => {
  const env = makeEnv();
  const ok = await call(env, "OPTIONS", "/api/orders");
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const bad = await call(env, "OPTIONS", "/api/orders", null, { Origin: "https://evil.example" });
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
});

test("invalid order returns field errors", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/orders", { service: "cv", email: "nope", fields: { language: "xx" } });
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.ok(b.fields.target && b.fields.info && b.fields.language && b.fields.email);
});

test("full flow: create, capture, agent deliver, customer download", async () => {
  const env = makeEnv();
  const created = await (await call(env, "POST", "/api/orders", cvOrder)).json();
  assert.equal(created.price, 28);
  assert.equal(pp.created.at(-1).purchase_units[0].amount.value, "28.00");
  assert.equal(env.ORDERS.m.get("order:" + created.id).ttl, 3 * 24 * 3600);

  // مفتاح غلط
  assert.equal((await call(env, "POST", `/api/orders/${created.id}/capture`, { key: "wrong" })).status, 404);

  pp.captureAmount = "28.00";
  const paid = await (await call(env, "POST", `/api/orders/${created.id}/capture`, { key: created.key })).json();
  assert.equal(paid.status, "paid");
  assert.equal(paid.result, null);
  assert.equal(env.ORDERS.m.get("order:" + created.id).ttl, undefined);

  // الإيجنت
  assert.equal((await call(env, "GET", "/api/agent/orders")).status, 401);
  const auth = { Authorization: "Bearer agent-secret-token" };
  const list = await (await call(env, "GET", "/api/agent/orders", null, auth)).json();
  assert.equal(list.orders.length, 1);
  assert.equal(list.orders[0].key, undefined);
  assert.equal(list.orders[0].fields.target, "محاسب");

  const r1 = await call(env, "POST", `/api/agent/orders/${created.id}/status`, { status: "in_progress" }, auth);
  assert.equal((await r1.json()).status, "in_progress");

  const bytes = Buffer.from("hello docx");
  const d = await (await call(env, "POST", `/api/agent/orders/${created.id}/deliver`,
    { text: "سيرتك جاهزة", files: [{ name: "السيرة الذاتية.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: bytes.toString("base64") }] }, auth)).json();
  assert.equal(d.status, "delivered");

  const view = await (await call(env, "GET", `/api/orders/${created.id}?key=${created.key}`)).json();
  assert.equal(view.status, "delivered");
  assert.equal(view.result.text, "سيرتك جاهزة");
  assert.equal(view.result.files[0].name, "السيرة الذاتية.docx");
  assert.equal(view.fields, undefined);

  const f = await call(env, "GET", `/api/orders/${created.id}/files/0?key=${created.key}`);
  assert.equal(f.status, 200);
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), "hello docx");
  assert.match(f.headers.get("Content-Disposition"), /filename\*=UTF-8''/);
  assert.equal((await call(env, "GET", `/api/orders/${created.id}/files/0?key=bad`)).status, 404);

  // التحصيل مرة تانية ما بيغيّر شي
  const again = await (await call(env, "POST", `/api/orders/${created.id}/capture`, { key: created.key })).json();
  assert.equal(again.status, "delivered");

  // حذف بيانات الطلب نهائياً
  assert.equal((await call(env, "DELETE", `/api/agent/orders/${created.id}`)).status, 401);
  assert.equal((await (await call(env, "DELETE", `/api/agent/orders/${created.id}`, null, auth)).json()).deleted, created.id);
  assert.equal((await call(env, "GET", `/api/orders/${created.id}?key=${created.key}`)).status, 404);
  assert.equal([...env.ORDERS.m.keys()].filter((k) => k.includes(created.id)).length, 0);
});

test("amount mismatch goes to review, not paid", async () => {
  const env = makeEnv();
  const created = await (await call(env, "POST", "/api/orders", cvOrder)).json();
  pp.captureAmount = "1.00";
  const v = await (await call(env, "POST", `/api/orders/${created.id}/capture`, { key: created.key })).json();
  assert.equal(v.status, "needs_review");
  const auth = { Authorization: "Bearer agent-secret-token" };
  const list = await (await call(env, "GET", "/api/agent/orders", null, auth)).json();
  assert.equal(list.orders.length, 0);
});

test("translate price is computed by the server, not the client", async () => {
  const env = makeEnv();
  const r = await (await call(env, "POST", "/api/orders", { service: "translate", email: "a@b.co", price: 1,
    fields: { direction: "en-ar", text: "word ".repeat(1001) } })).json();
  assert.equal(r.price, 24);
});

test("payments not configured returns 503", async () => {
  const env = makeEnv(); delete env.PAYPAL_SECRET;
  const r = await call(env, "POST", "/api/orders", cvOrder);
  assert.equal(r.status, 503);
});
