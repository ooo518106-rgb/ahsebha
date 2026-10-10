import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup } from './helpers.mjs';
import { BLOG } from '../src/blog-list.js';
import { ARTICLES } from '../blog/articles.mjs';
import { MORE } from '../blog/articles-more.mjs';

const page = (f) => readFile(new URL(`../public/blog/${f}`, import.meta.url), 'utf8');

test('📝 المدونة: الصفحات مبنية من المقالات، وكل وحدة فيها عنوان ووصف ورابط رسمي وبيانات Google', async () => {
  assert.deepEqual(BLOG.map((b) => b.slug), [...ARTICLES, ...MORE].map((a) => a.slug), 'شغّل node scripts/build-blog.mjs بعد تعديل المقالات');
  assert.ok(BLOG.length >= 10);
  for (const { slug } of BLOG) {
    const html = await page(`${slug}.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://nuqatak\\.com/blog/${slug}">`), slug);
    assert.equal((html.match(/<h1>/g) || []).length, 1, `${slug}: عنوان رئيسي واحد`);
    assert.match(html, /<meta name="description" content="[^"]{80,}">/, `${slug}: وصف لـ Google`);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.deepEqual(ld.map((x) => x['@type']), ['BlogPosting', 'BreadcrumbList', 'FAQPage'], slug);
    assert.ok(!/href="\/blog\/(?!")[a-z0-9-]+"/.test(html.replace(new RegExp(`href="/blog/(${BLOG.map((b) => b.slug).join('|')})"`, 'g'), '')), `${slug}: كل روابط المقالات موجودة`);
  }
  const index = await page('index.html');
  for (const { slug } of BLOG) assert.ok(index.includes(`href="/blog/${slug}"`), `الفهرس فيه ${slug}`);
  const landing = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(landing, /<a href="\/blog">مقالات<\/a>/, 'رابط المقالات بأسفل الصفحة الرئيسية');
});

test('📝 روابط المدونة: الفهرس والمقالات بتفتح، والرابط الغلط أو .html المباشر 404، وخريطة الموقع فيها الكل', async () => {
  const { client } = await setup({ PUBLIC_URL: 'https://loyalty.test' });
  const c = client();
  const slug = BLOG[0].slug;
  assert.equal((await c.get('/blog')).data, '<html>/blog/index.html</html>');
  assert.equal((await c.get('/blog/')).status, 200);
  const r = await c.get(`/blog/${slug}`);
  assert.equal(r.status, 200);
  assert.equal(r.data, `<html>/blog/${slug}.html</html>`);
  assert.equal((await c.get(`/blog/${slug}/`)).status, 200);
  assert.equal((await c.get('/blog/no-such-article')).status, 404);
  assert.equal((await c.get(`/blog/${slug}.html`)).status, 404);
  assert.equal((await c.get('/blog/index.html')).status, 404);
  const map = String((await c.get('/sitemap.xml')).data);
  assert.ok(map.includes('<loc>https://loyalty.test/blog</loc>'));
  for (const b of BLOG) assert.ok(map.includes(`<loc>https://loyalty.test/blog/${b.slug}</loc><lastmod>${b.date}</lastmod>`), b.slug);
});

test('📝 المدونة على العنوان القديم بتتحوّل للدومين الرسمي', async () => {
  const { client } = await setup({ PUBLIC_URL: 'https://nuqatak.example' });
  const c = client();
  for (const path of ['/blog', `/blog/${BLOG[1].slug}`]) {
    const r = await c.get(path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get('location'), `https://nuqatak.example${path}`);
  }
});
