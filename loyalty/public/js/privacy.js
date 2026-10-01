// إيميل التواصل بييجي من إعدادات السيرفر (CONTACT_EMAIL)
import { $, api, html, render } from './common.js';

api('/api/site').then(({ contactEmail }) => {
  if (!contactEmail) return;
  render($('#contact'), html`لأي سؤال أو طلب عن بياناتك، تواصل مع المحل اللي انضميت لبطاقته، أو راسلنا على <a href="mailto:${contactEmail}" dir="ltr">${contactEmail}</a>.`);
}).catch(() => {});
