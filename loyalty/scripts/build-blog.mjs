// 📝 بيبني صفحات المدونة من blog/articles*.mjs: public/blog/index.html وصفحة لكل مقال، وsrc/blog-list.js (للروابط وخريطة الموقع)
// التشغيل: node scripts/build-blog.mjs  (بعد أي تعديل على المقالات)
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { ARTICLES } from '../blog/articles.mjs';
import { MORE } from '../blog/articles-more.mjs';

const SITE = 'https://nuqatak.com';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}public/blog`;
const all = [...ARTICLES, ...MORE];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const arDate = (d) => { const [y, m, day] = d.split('-').map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const strip = (h) => h.replace(/<[^>]+>/g, '');

const slugs = new Set();
for (const a of all) {
  if (!/^[a-z0-9-]{3,80}$/.test(a.slug) || slugs.has(a.slug)) throw new Error(`slug غلط أو مكرر: ${a.slug}`);
  slugs.add(a.slug);
  for (const href of a.body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)) if (!all.some((x) => x.slug === href[1])) throw new Error(`${a.slug}: رابط لمقال مش موجود ${href[1]}`);
}

const head = ({ title, description, path, type = 'website', extra = '' }) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#3b2418">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${path}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="نقاطك">
  <meta property="og:locale" content="ar_JO">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${SITE}${path}">
  <meta property="og:image" content="${SITE}/img/promo-card.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="628">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/img/icon-192.png" type="image/png" sizes="192x192">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/blog.css">
${extra}</head>`;

const top = `<header class="blog-top"><div class="wrap">
  <a class="brand" href="/"><img src="/img/nuqatak-logo.png" alt="" width="30" height="30">نقاطك</a>
  <span class="grow"></span>
  <nav><a href="/blog">المقالات</a></nav>
  <a class="btn sm" href="/#login">جرّب 14 يوم ببلاش</a>
</div></header>`;

const foot = `<footer class="blog-foot"><div class="wrap">
  <span>© نقاطك: بطاقات الولاء الرقمية للمحلات في الأردن</span>
  <span class="grow" style="flex:1"></span>
  <a href="/">الرئيسية</a><a href="/blog">المقالات</a><a href="/#pricing">الأسعار</a><a href="/terms">الشروط</a><a href="/privacy">الخصوصية</a>
</div></footer>`;

const cta = `<section class="cta-box">
  <h2>جرّب نقاطك على محلك</h2>
  <p>بطاقة ولاء بلون محلك في محفظة جوال زبونك، بدون تطبيق. 14 يوم مجاناً بدون بطاقة بنك.</p>
  <a class="btn big" href="/#login">ابدأ التجربة المجانية</a>
</section>`;

const card = (a) => `<a class="post-card" href="/blog/${a.slug}"><b>${esc(a.short || a.title)}</b><span>${esc(a.description)}</span><small>${a.read} دقائق قراءة ←</small></a>`;

const org = { '@type': 'Organization', name: 'نقاطك', alternateName: 'Nuqatak', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/img/nuqatak-logo.png` } };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [i, a] of all.entries()) {
  const path = `/blog/${a.slug}`;
  const related = [...all.slice(i + 1), ...all.slice(0, i)].slice(0, 3);
  const schema = [
    { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title, description: a.description, inLanguage: 'ar', datePublished: a.date, dateModified: a.updated || a.date, mainEntityOfPage: `${SITE}${path}`, image: `${SITE}/img/promo-card.jpg`, author: org, publisher: org },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'نقاطك', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'المقالات', item: `${SITE}/blog` },
      { '@type': 'ListItem', position: 3, name: a.short || a.title, item: `${SITE}${path}` },
    ] },
    ...(a.faq?.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: a.faq.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(ans) } })) }] : []),
  ];
  const html = `${head({ title: `${a.title} | نقاطك`, description: a.description, path, type: 'article', extra: `  <meta property="article:published_time" content="${a.date}">\n  ${ld(schema)}\n` })}
<body>
${top}
<main class="blog-main">
  <nav class="crumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/blog">المقالات</a><span>›</span><span>${esc(a.short || a.title)}</span></nav>
  <article class="post">
    <h1>${esc(a.title)}</h1>
    <p class="meta"><time datetime="${a.date}">${arDate(a.date)}</time> · ${a.read} دقائق قراءة · فريق نقاطك</p>
    <div class="post-body">${a.body}
    </div>
    ${a.faq?.length ? `<section class="faq"><h2>أسئلة شائعة</h2>${a.faq.map(([q, ans]) => `<details><summary>${esc(q)}</summary><p>${esc(ans)}</p></details>`).join('')}</section>` : ''}
  </article>
  ${cta}
  <section class="related"><h2>مقالات ممكن تفيدك</h2><div class="cards">${related.map(card).join('')}</div></section>
</main>
${foot}
</body>
</html>
`;
  writeFileSync(`${OUT}/${a.slug}.html`, html);
}

const indexSchema = { '@context': 'https://schema.org', '@type': 'Blog', name: 'مقالات نقاطك', url: `${SITE}/blog`, inLanguage: 'ar', publisher: org, blogPost: all.map((a) => ({ '@type': 'BlogPosting', headline: a.title, url: `${SITE}/blog/${a.slug}`, datePublished: a.date })) };
writeFileSync(`${OUT}/index.html`, `${head({ title: 'مقالات نقاطك: دليل أصحاب المحلات لبرامج الولاء في الأردن', description: 'مقالات عملية لأصحاب الكافيهات والمطاعم والصالونات والمحلات في الأردن: برامج الولاء، إرجاع الزبائن، المكافآت، منيو QR، والتكلفة بالدينار.', path: '/blog', extra: `  ${ld(indexSchema)}\n` })}
<body>
${top}
<main class="blog-main blog-index">
  <section class="blog-hero">
    <h1>دليل أصحاب المحلات لبرامج الولاء</h1>
    <p>مقالات عملية للكافيهات والمطاعم والصالونات والمحلات في الأردن: كيف ترجّع زبونك، وكيف تختار المكافأة، وكم يكلّف كل شيء.</p>
  </section>
  <div class="cards">${all.map(card).join('')}</div>
  ${cta}
</main>
${foot}
</body>
</html>
`);

writeFileSync(`${ROOT}src/blog-list.js`, `// مولّد من scripts/build-blog.mjs، لا تعدّله بإيدك: روابط المقالات لخريطة الموقع والراوتر
export const BLOG = ${JSON.stringify(all.map((a) => ({ slug: a.slug, date: a.updated || a.date })), null, 2)};
`);
console.log(`ok: ${all.length} مقال، ${readdirSync(OUT).length} صفحة`);
