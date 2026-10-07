// 🤖 مساعد المبيعات بصفحة نقاطك: زر عائم بيفتح محادثة مع وكيل المبيعات (بيشرح، بينصح بالباقة، وبيعطي عرض تجربة أطول)
import { api } from './common.js';

const KEY = 'nq_sales_chat';
const load = () => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const save = (h) => { try { sessionStorage.setItem(KEY, JSON.stringify(h.slice(-16))); } catch { /* اختياري */ } };

// onStart: بيفتح التسجيل، onOffer: لما الوكيل يعمل عرض، extra(): معلومات بتنبعت مع كل رسالة (المندوب، العرض)
export function mountSales({ onStart, onOffer, extra = () => ({}) }) {
  const history = load(); // [{ role, content }]
  document.body.classList.add('has-ai');

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.innerHTML = '<span aria-hidden="true">💬</span> اسألنا';

  const dlg = document.createElement('dialog');
  dlg.className = 'ai-chat';
  dlg.setAttribute('aria-label', 'مساعد نقاطك');
  dlg.innerHTML = `<div class="ai-head"><b>🤖 مساعد نقاطك</b><button type="button" class="ai-x" aria-label="سكّر">✕</button></div>
    <div class="ai-log" aria-live="polite"></div>
    <div class="ai-sugg"></div>
    <div class="ai-cta"><button type="button" class="btn sm" data-ai-start>🚀 جرّب مجاناً</button><button type="button" class="btn sm ghost" data-demo>▶ المحل التجريبي</button></div>
    <form class="ai-form"><input name="q" maxlength="600" autocomplete="off" required placeholder="اكتب سؤالك…"><button class="btn" type="submit">إرسال</button></form>
    <p class="ai-note small muted">مساعد ذكي (AI) وممكن يغلط. الأسعار الرسمية بقسم الأسعار.</p>`;
  const input = dlg.querySelector('input');
  const log = dlg.querySelector('.ai-log');
  const sugg = dlg.querySelector('.ai-sugg');
  document.body.append(fab, dlg);

  // الروابط (رابط العرض، الواتساب) بتصير قابلة للكبس، والباقي نص عادي
  const bubble = (who, text) => {
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    for (const part of String(text).split(/(https?:\/\/[^\s<>"'«»]+[^\s<>"'«».,،!?؟)])/)) {
      if (!/^https?:\/\//.test(part)) { el.append(part); continue; }
      const a = document.createElement('a');
      a.href = part;
      a.textContent = part.replace(/^https?:\/\//, '');
      a.dir = 'ltr';
      if (new URL(part).origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; }
      el.append(a);
    }
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };
  bubble('bot', 'أهلا! 👋 أنا مساعد نقاطك. بحكيلك كيف بطاقة الولاء بترجّعلك زبائنك، وأي باقة بتناسب محلك. شو نوع محلك؟');
  for (const m of history) bubble(m.role === 'user' ? 'user' : 'bot', m.content);
  sugg.hidden = history.length > 0;
  for (const q of ['شو الفرق بين الباقتين؟', 'كيف بتشتغل مع زبائني؟', 'عندي كوفي بفرعين، شو بناسبني؟', 'بدي حدا يتواصل معي']) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = q;
    chip.onclick = () => send(q);
    sugg.append(chip);
  }

  let busy = false;
  async function send(text) {
    const q = String(text || '').trim().slice(0, 600);
    if (!q || busy) return;
    busy = true;
    sugg.hidden = true;
    bubble('user', q);
    history.push({ role: 'user', content: q });
    const wait = bubble('bot typing', '');
    try {
      const r = await api('/api/sales', { method: 'POST', body: { messages: history.slice(-16), ...extra() } });
      wait.remove();
      bubble('bot', r.reply);
      history.push({ role: 'assistant', content: r.reply });
      save(history);
      if (r.offer && onOffer) onOffer(r.offer);
    } catch (e) {
      wait.remove();
      history.pop(); // السؤال اللي ما انجاوب ما بيضل بالمحادثة
      bubble('bot err', e.message || 'صار خطأ، جرّب كمان مرة');
    }
    busy = false;
    input.focus();
  }

  dlg.querySelector('.ai-form').onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); };
  dlg.querySelector('.ai-x').onclick = () => dlg.close();
  dlg.querySelector('[data-ai-start]').onclick = () => { dlg.close(); onStart(); };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // كبسة برّا المحادثة بتسكّرها
  fab.onclick = () => { dlg.showModal(); if (matchMedia('(hover: hover)').matches) input.focus(); };
  return { open: () => fab.click() };
}
