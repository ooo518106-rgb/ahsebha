// 🤖 الذكاء الاصطناعي لوكيل المبيعات (src/sales.js): Claude من Anthropic، أو Gemini من Google (src/gemini.js)
import Anthropic from '@anthropic-ai/sdk';
import { geminiChat } from './gemini.js';

export const AI_MODEL_DEFAULT = 'claude-opus-5-5';
// الموديلات اللي بتقبل الرجوع التلقائي لموديل تاني إذا رفض الطلب (fallbacks: "default")
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// Haiku 4.5 ما بيقبل effort
const NO_EFFORT = new Set(['claude-haiku-4-5']);

export const MAX_TURNS = 16; // آخر 16 رسالة من المحادثة بس
export const MAX_CHARS = 600;

// المفتاح سري بـ Cloudflare: ANTHROPIC_API_KEY (Claude) أو GEMINI_API_KEY (Gemini). إذا الاتنين موجودين، Claude إلا إذا AI_PROVIDER=gemini
export function aiConfig(env) {
  const claudeKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const geminiKey = String(env.GEMINI_API_KEY || '').trim();
  const want = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const provider = want === 'gemini' && geminiKey ? 'gemini' : claudeKey ? 'anthropic' : geminiKey ? 'gemini' : null;
  if (!provider) return null;
  const num = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    provider,
    apiKey: provider === 'gemini' ? geminiKey : claudeKey,
    model: provider === 'gemini' ? (String(env.GEMINI_MODEL || '').trim() || null) : String(env.AI_MODEL || AI_MODEL_DEFAULT).trim(),
    perVisitor: num(env.AI_VISITOR_DAILY, 30), // رسائل الزائر الواحد للمساعد بالموقع باليوم
    platform: num(env.AI_DAILY_LIMIT, 600), // كل رسائل الوكيل باليوم (موقع وواتساب)
    fetch: env.fetch,
  };
}

// بنتأكد إنه المحادثة اللي جاية من المتصفح أو من قاعدة البيانات سليمة: أدوار متناوبة، نص قصير، وآخر رسالة من الطرف التاني
export function cleanHistory(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const m of list.slice(-MAX_TURNS)) {
    const role = m && m.role === 'assistant' ? 'assistant' : m && m.role === 'user' ? 'user' : null;
    const text = String((m && m.content) || '').trim().slice(0, role === 'user' ? MAX_CHARS : 2000);
    if (!role || !text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

const addUsage = (a, u = {}) => {
  a.input_tokens += u.input_tokens || 0;
  a.output_tokens += u.output_tokens || 0;
  a.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  a.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
  a.web_search_requests += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
};

// محادثة وحدة مع Claude: بيستعمل الأدوات (runTool بينفّذها عنا) لحد ما يخلّص جوابه.
// بيرجّع { text, usage, refused, rounds }
export async function chat(cfg, opts) {
  if (cfg.provider === 'gemini') return geminiChat(cfg, { ...opts, maxTokens: Math.max(opts.maxTokens || 0, 8192) });
  return claudeChat(cfg, opts);
}

async function claudeChat(cfg, { system, messages, tools = [], runTool, stopOn = null, maxTokens = 4000, effort = 'low', timeout = 25_000, maxRounds = 4 }) {
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 1, timeout, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
  const convo = [...messages];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };
  let text = '';
  for (let round = 1; round <= maxRounds; round++) {
    const params = { model: cfg.model, max_tokens: maxTokens, system, messages: convo };
    if (tools.length) params.tools = tools;
    // effort منخفض كفاية للدردشة وأرخص (والتفكير بيشتغل لحاله)
    if (!NO_EFFORT.has(cfg.model)) params.output_config = { effort };
    // إذا الموديل رفض الطلب لسبب أمان، Anthropic بتعيده على الموديل المناسب لحالها
    const res = FALLBACK_MODELS.has(cfg.model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    addUsage(usage, res.usage);
    if (res.stop_reason === 'refusal') return { text: '', usage, refused: true, rounds: round };
    const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (said) text = said;
    // البحث بالإنترنت (أداة عند Anthropic) وقف بالنص: بنرجّع نفس الرد وهو بيكمّل من مكانه
    if (res.stop_reason === 'pause_turn') {
      convo.push({ role: 'assistant', content: res.content });
      continue;
    }
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length || !runTool) return { text, usage, refused: false, rounds: round };
    convo.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const u of uses) {
      let out;
      try {
        out = { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input || {})) };
      } catch (e) {
        // الخطأ برجع للموديل كنص، فبيصلّح (متلاً بيطلب الرقم كمان مرة)
        out = { type: 'tool_result', tool_use_id: u.id, is_error: true, content: String(e.message || e) };
      }
      results.push(out);
    }
    // stopOn: أداة بتخلّص الشغل (متل حفظ نتايج البحث)، فما في داعي لجولة كمان
    if (stopOn && uses.some((u) => u.name === stopOn)) return { text, usage, refused: false, rounds: round };
    convo.push({ role: 'user', content: results });
  }
  return { text, usage, refused: false, rounds: maxRounds };
}

// تقدير التكلفة بالدولار (أسعار Anthropic لكل مليون توكن: دخل، طلع، قراءة كاش، كتابة كاش 5 دقايق) + البحث 10$ لكل 1000
const PRICES = {
  gemini: [0.3, 2.5, 0.075, 0], // Flash بالباقة المدفوعة (بالمجانية ما في تكلفة)
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
};
export function aiCost(model, u) {
  const p = PRICES[/^gemini/.test(String(model || 'gemini')) ? 'gemini' : model];
  if (!p) return null;
  const usd = (u.input * p[0] + u.output * p[1] + u.cacheRead * p[2] + u.cacheWrite * p[3]) / 1e6 + (u.searches || 0) * 0.01;
  return Math.round(usd * 100) / 100;
}
