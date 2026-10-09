// طرق التواصل من إعدادات السيرفر (CONTACT_EMAIL ورقم الواتساب)
import { $, api, html, render } from './common.js?v=1.82';

api('/api/site').then(({ contactEmail, whatsapp }) => {
  const ways = [];
  if (contactEmail) ways.push(html`الإيميل <a href="mailto:${contactEmail}" dir="ltr">${contactEmail}</a>`);
  if (whatsapp) ways.push(html`واتساب <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" dir="ltr">+${whatsapp}</a>`);
  if (!ways.length) return;
  render($('#contact'), html`لأي سؤال عن الشروط أو اشتراكك، راسلنا على ${ways.reduce((acc, w, i) => html`${acc}${i ? ' أو ' : ''}${w}`, html``)}.`);
}).catch(() => {});
