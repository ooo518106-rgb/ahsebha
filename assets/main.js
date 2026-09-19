// ═══ Google Analytics ═══
(function() {
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-DRZH2DY196';
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-DRZH2DY196');
  window.gtag = gtag;
})();

// ═══ Theme Management ═══
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  const theme = document.documentElement.getAttribute('data-theme');
  btn.textContent = theme === 'dark' ? '☀️ فاتح' : '🌙 داكن';
}

// ═══ Number Formatting ═══
function fmt(num, decimals = 2) {
  if (isNaN(num) || num === null || num === undefined) return '0.00';
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// ═══ Search ═══
function initSearch() {
  const searchInput = document.getElementById('search');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.tool-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      const matches = !query || text.includes(query);
      card.style.display = matches ? 'block' : 'none';
      if (matches) visibleCount++;
    });

    const categoryBlocks = document.querySelectorAll('.categories > div');
    categoryBlocks.forEach(cat => {
      const visible = cat.querySelectorAll('.tool-card:not([style*="display: none"])');
      cat.style.display = visible.length > 0 ? 'block' : 'none';
    });

    let noResult = document.getElementById('no-results');
    if (visibleCount === 0) {
      if (!noResult) {
        noResult = document.createElement('div');
        noResult.id = 'no-results';
        noResult.className = 'alert alert-info';
        noResult.textContent = '🔍 لا توجد نتائج مطابقة';
        document.querySelector('.categories').appendChild(noResult);
      }
    } else if (noResult) {
      noResult.remove();
    }
  });
}

// ═══ Copy to Clipboard ═══
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('✅ تم النسخ!');
  });
}

// ═══ Share ═══
function shareWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function shareTwitter(text) {
  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank');
}

// ═══ Print ═══
function printResult(title, content) {
  const win = window.open('', '', 'width=800,height=600');
  win.document.write('<html dir="rtl"><head><meta charset="utf-8">');
  win.document.write('<title>' + title + '</title>');
  win.document.write('<style>body{font-family:Cairo,Arial;padding:40px;line-height:2;direction:rtl;}');
  win.document.write('h2{color:#4f46e5;border-bottom:3px solid #6366f1;padding-bottom:10px;}');
  win.document.write('pre{white-space:pre-wrap;font-size:16px;}</style></head>');
  win.document.write('<body><h2>' + title + '</h2><pre>' + content + '</pre>');
  win.document.write('<p style="margin-top:40px;color:#94a3b8;font-size:12px;">صادر من موقع احسبها</p>');
  win.document.write('</body></html>');
  win.document.close();
  setTimeout(() => win.print(), 300);
}

// ═══ Initialize ═══
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSearch();
  const themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
});
