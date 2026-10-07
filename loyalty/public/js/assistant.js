// 🤖 دردشة المساعد الذكي للزبون: زر عائم بيفتح محادثة قصيرة (على البطاقة أو المنيو)
import { api } from './common.js';
import { LANG, t } from './i18n.js';

let mounted = false;

export function mountAssistant({ token = null, slug = null, shopName }) {
  if (mounted) return;
  mounted = true;
  const history = []; // اللي بينبعت للسيرفر: [{ role, content }]
  document.body.classList.add('has-ai');

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.innerHTML = '<span aria-hidden="true">🤖</span> ';
  fab.append(t('aiAsk'));

  const dlg = document.createElement('dialog');
  dlg.className = 'ai-chat';
  dlg.setAttribute('aria-label', t('aiTitle', { shop: shopName }));
  dlg.innerHTML = `<div class="ai-head"><b></b><button type="button" class="ai-x" aria-label="✕">✕</button></div>
    <div class="ai-log" aria-live="polite"></div>
    <div class="ai-sugg"></div>
    <form class="ai-form"><input name="q" maxlength="500" autocomplete="off" required><button class="btn" type="submit"></button></form>
    <p class="ai-note small muted"></p>`;
  dlg.querySelector('.ai-head b').textContent = `🤖 ${t('aiTitle', { shop: shopName })}`;
  const input = dlg.querySelector('input');
  input.placeholder = t('aiPlaceholder');
  dlg.querySelector('.ai-form button').textContent = t('aiSend');
  dlg.querySelector('.ai-note').textContent = t('aiNote');
  const log = dlg.querySelector('.ai-log');
  const sugg = dlg.querySelector('.ai-sugg');
  document.body.append(fab, dlg);

  const bubble = (who, text) => {
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    el.textContent = text;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };
  bubble('bot', t('aiHello', { shop: shopName }));
  for (const k of token ? ['aiQ1', 'aiQ2', 'aiQ3'] : ['aiQ1', 'aiQ4', 'aiQ3']) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = t(k);
    chip.onclick = () => send(t(k));
    sugg.append(chip);
  }

  let busy = false;
  async function send(text) {
    const q = String(text || '').trim().slice(0, 500);
    if (!q || busy) return;
    busy = true;
    sugg.hidden = true;
    bubble('user', q);
    history.push({ role: 'user', content: q });
    const wait = bubble('bot typing', '');
    try {
      const r = await api('/api/assistant', { method: 'POST', body: { token, slug, lang: LANG, messages: history.slice(-12) } });
      wait.remove();
      bubble('bot', r.reply);
      history.push({ role: 'assistant', content: r.reply });
    } catch (e) {
      wait.remove();
      history.pop(); // السؤال اللي ما انجاوب ما بيضل بالمحادثة
      bubble('bot err', e.message || t('aiErr'));
    }
    busy = false;
    input.focus();
  }

  dlg.querySelector('.ai-form').onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); };
  dlg.querySelector('.ai-x').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // كبسة برّا المحادثة بتسكّرها
  fab.onclick = () => { dlg.showModal(); if (matchMedia('(hover: hover)').matches) input.focus(); };
}
