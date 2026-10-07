// ✨ Gemini من Google: نفس شغل الوكيل (محادثة بأدوات، وبحث عن محلات) بمفتاح GEMINI_API_KEY، بدون مكتبة إضافية
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

let picked = null; // الموديل اللي اخترناه (بيضل محفوظ طول ما الـ Worker شغّال)

async function call(cfg, path, body) {
  const res = await cfg.fetch(`${BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': cfg.apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error((data.error && data.error.message) || `Gemini ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// إذا ما حددت GEMINI_MODEL، بنختار أحدث «Flash» ثابت متوفر لمفتاحك
export async function geminiModel(cfg) {
  if (cfg.model) return cfg.model;
  if (picked) return picked;
  try {
    const list = (await call(cfg, 'models?pageSize=200')).models || [];
    const ok = list.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
    const stable = ok.map((n) => [n, /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(n)]).filter(([, m]) => m).sort((a, b) => Number(b[1][1]) - Number(a[1][1]));
    picked = stable.length ? stable[0][0] : ok.includes('gemini-flash-latest') ? 'gemini-flash-latest'
      : ok.find((n) => /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp/.test(n)) || 'gemini-flash-latest';
  } catch {
    picked = 'gemini-flash-latest';
  }
  return picked;
}

// مخطط الأدوات (JSON Schema) بصيغة Gemini: الأنواع بحروف كبيرة، وبدون additionalProperties
export function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

const emptyUsage = () => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 });
function addUsage(u, res) {
  const m = res.usageMetadata || {};
  const cached = m.cachedContentTokenCount || 0;
  u.input_tokens += Math.max(0, (m.promptTokenCount || 0) - cached);
  u.cache_read_input_tokens += cached;
  u.output_tokens += (m.candidatesTokenCount || 0) + (m.thoughtsTokenCount || 0);
  const g = res.candidates && res.candidates[0] && res.candidates[0].groundingMetadata;
  u.web_search_requests += (g && g.webSearchQueries && g.webSearchQueries.length) || 0;
}
const textOf = (cand) => ((cand && cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
const blocked = (res, cand) => !!(res.promptFeedback && res.promptFeedback.blockReason) || (cand && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(cand.finishReason));

// نفس chat() تبع Claude: system كتل نص، messages [{ role: user|assistant, content }]، tools بصيغة Anthropic
export async function geminiChat(cfg, { system, messages, tools = [], runTool, stopOn = null, maxTokens = 8192, maxRounds = 4 }) {
  const model = await geminiModel(cfg);
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const usage = emptyUsage();
  const body = {
    systemInstruction: { parts: (Array.isArray(system) ? system : [{ text: String(system) }]).map((b) => ({ text: b.text })) },
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }];
  let text = '';
  for (let round = 1; round <= maxRounds; round++) {
    const res = await call(cfg, `models/${model}:generateContent`, { ...body, contents });
    addUsage(usage, res);
    const cand = res.candidates && res.candidates[0];
    if (blocked(res, cand)) return { text: '', usage, refused: true, rounds: round };
    const said = textOf(cand);
    if (said) text = said;
    const callsMade = ((cand && cand.content && cand.content.parts) || []).filter((p) => p.functionCall);
    if (!callsMade.length || !runTool) return { text, usage, refused: false, rounds: round };
    contents.push(cand.content); // كما هو (فيه توقيع التفكير اللي لازم يرجع)
    const parts = [];
    for (const p of callsMade) {
      let response;
      try { response = await runTool(p.functionCall.name, p.functionCall.args || {}); } catch (e) { response = { error: String(e.message || e) }; }
      parts.push({ functionResponse: { name: p.functionCall.name, response: response && typeof response === 'object' ? response : { result: response } } });
    }
    if (stopOn && callsMade.some((p) => p.functionCall.name === stopOn)) return { text, usage, refused: false, rounds: round };
    contents.push({ role: 'user', parts });
  }
  return { text, usage, refused: false, rounds: maxRounds };
}

// 🔎 البحث عن محلات: Gemini بيدوّر بـ Google Search، وبعدين طلب تاني بيرتّب النتايج JSON حسب مخطط save_shops
export async function geminiFindShops(cfg, { system, ask, shopsSchema }) {
  const model = await geminiModel(cfg);
  const usage = emptyUsage();
  const found = await call(cfg, `models/${model}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `${ask}\n\nاكتب كل المحلات اللي لقيتها بالتفصيل (الاسم، المنطقة، النوع، الرقم، الانستغرام، الصفحة، جملة عنه، وأول رسالة إله).` }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 8192 },
  });
  addUsage(usage, found);
  const notes = textOf(found.candidates && found.candidates[0]);
  if (!notes) return { shops: [], usage };
  const shaped = await call(cfg, `models/${model}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: `حوّل هالقائمة لـ JSON حسب المخطط. ما تضيف ولا تخترع إشي مش موجود فيها، والحقول الناقصة فاضية.\n\n${notes}` }] }],
    generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: toGeminiSchema(shopsSchema) },
  });
  addUsage(usage, shaped);
  let shops = [];
  try { shops = JSON.parse(textOf(shaped.candidates && shaped.candidates[0])).shops || []; } catch { shops = []; }
  return { shops: Array.isArray(shops) ? shops : [], usage };
}
