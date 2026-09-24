// ═══ خدمات احسبها: صفحة الطلب وصفحة متابعة الطلب ═══
(function () {
  const API = String(window.AHSEBHA_API || "").replace(/\/+$/, "");
  const STORE_KEY = "ahsebha-orders";

  // ── أدوات عامة ──
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach((c) => { if (c != null) n.append(c); });
    return n;
  }
  const $ = (id) => document.getElementById(id);
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  async function api(path, opts) {
    if (!API) return { ok: false, status: 0, data: { message: "الطلب متوقف مؤقتاً. عد لاحقاً." } };
    try {
      const r = await fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { message: "تعذّر الاتصال. تأكد من الإنترنت وحاول مرة أخرى." } };
    }
  }

  function remember(o) {
    try {
      const xs = JSON.parse(localStorage.getItem(STORE_KEY) || "[]").filter((x) => x.id !== o.id);
      xs.unshift({ id: o.id, key: o.key, name: o.name, at: new Date().toISOString() });
      localStorage.setItem(STORE_KEY, JSON.stringify(xs.slice(0, 20)));
    } catch (e) {}
  }
  function remembered() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; } }
  const statusUrl = (id, key) => "order.html?id=" + encodeURIComponent(id) + "&key=" + encodeURIComponent(key);

  // نفس قواعد التسعير في الخادم (الخادم هو المرجع النهائي)
  const countWords = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
  const countLines = (t) => String(t || "").split(/\n/).map((s) => s.trim()).filter(Boolean).length;
  function priceOf(p, f) {
    let v = 0;
    if (p.type === "fixed") v = p.base;
    else if (p.type === "table") v = Number(p.table[String(f[p.field])] || 0);
    else if (p.type === "per_words") v = Math.max(p.min, Math.ceil(countWords(f[p.field]) / p.unit) * p.rate);
    else if (p.type === "per_lines") v = Math.max(p.min, Math.ceil(countLines(f[p.field]) / p.unit) * p.rate);
    for (const k in p.addons || {}) {
      const val = f[k] === true ? "true" : String(f[k] ?? "");
      if (p.addons[k][val]) v += p.addons[k][val];
    }
    if (p.multiplyBy) v *= Math.max(1, parseInt(f[p.multiplyBy], 10) || 1);
    return Math.round(v * 100) / 100;
  }
  function startingPrice(p) {
    if (p.type === "fixed") return p.base;
    if (p.type === "table") return Math.min.apply(null, Object.values(p.table));
    return p.min;
  }

  // ═══ صفحة الطلب ═══
  function initOrderPage() {
    let catalog = [], svc = null, current = null;
    const grid = $("svc-grid"), form = $("order-form"), msg = $("order-msg");

    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "alert alert-" + (kind || "info");
      msg.hidden = !text;
    }

    function renderMine() {
      const xs = remembered(); const box = $("mine");
      if (!xs.length) { box.hidden = true; return; }
      box.hidden = false;
      $("mine-list").replaceChildren(...xs.slice(0, 5).map((x) => el("a", { href: statusUrl(x.id, x.key) }, [
        el("span", { text: x.name || "طلب" }), el("span", { text: x.id }),
      ])));
    }

    function renderGrid() {
      grid.replaceChildren(...catalog.map((s) => el("button", {
        type: "button", class: "svc-card", "aria-pressed": String(!!svc && svc.id === s.id),
        onclick: () => select(s.id),
      }, [
        el("span", { class: "ic", text: s.icon }),
        el("span", { class: "nm", text: s.name }),
        el("span", { class: "bl", text: s.blurb }),
        el("span", { class: "ft" }, [
          el("span", { class: "from" }, ["يبدأ من ", el("b", { text: money(startingPrice(s.pricing)) })]),
          el("span", { text: s.delivers }),
        ]),
      ])));
    }

    function fieldInput(fd) {
      const id = "f-" + fd.id;
      if (fd.type === "select") {
        return el("select", { id, name: fd.id, oninput: update }, fd.options.map((o) => el("option", { value: o[0], text: o[1] })));
      }
      if (fd.type === "textarea") return el("textarea", { id, name: fd.id, maxlength: fd.max, placeholder: fd.placeholder, oninput: update });
      return el("input", { id, name: fd.id, type: "text", maxlength: fd.max, placeholder: fd.placeholder, oninput: update });
    }

    function renderForm() {
      const box = $("svc-fields");
      box.replaceChildren(...svc.fields.map((fd) => {
        if (fd.type === "checkbox") {
          return el("div", { class: "form-group", id: "g-" + fd.id }, [
            el("label", { class: "check" }, [el("input", { type: "checkbox", id: "f-" + fd.id, name: fd.id, onchange: update }), el("span", { text: fd.label })]),
          ]);
        }
        const hint = (fd.maxWords || fd.maxLines) ? el("div", { class: "hint", id: "h-" + fd.id }) : null;
        return el("div", { class: "form-group", id: "g-" + fd.id }, [
          el("label", { for: "f-" + fd.id, text: fd.label }),
          fieldInput(fd), hint, el("div", { class: "err", id: "e-" + fd.id, hidden: true }),
        ]);
      }));
      $("svc-title").textContent = svc.icon + " " + svc.name;
      $("svc-delivers").textContent = "تستلم: " + svc.delivers + " — خلال " + svc.hours + " ساعة من الدفع";
      form.hidden = false;
      update();
    }

    function values() {
      const f = {};
      svc.fields.forEach((fd) => {
        const n = $("f-" + fd.id); if (!n) return;
        f[fd.id] = fd.type === "checkbox" ? n.checked : n.value;
      });
      return f;
    }

    function update() {
      if (!svc) return;
      const f = values();
      svc.fields.forEach((fd) => {
        const h = $("h-" + fd.id);
        if (h && fd.maxWords) h.textContent = countWords(f[fd.id]) + " كلمة من " + fd.maxWords;
        if (h && fd.maxLines) h.textContent = countLines(f[fd.id]) + " منتج من " + fd.maxLines;
      });
      $("total-amt").textContent = money(priceOf(svc.pricing, f));
    }

    function clearErrors() {
      form.querySelectorAll(".has-err").forEach((g) => g.classList.remove("has-err"));
      form.querySelectorAll(".err").forEach((e) => { e.hidden = true; e.textContent = ""; });
    }
    function showErrors(errs) {
      let first = null;
      for (const k in errs || {}) {
        const g = $("g-" + k), e = $("e-" + k);
        if (g) g.classList.add("has-err");
        if (e) { e.textContent = errs[k]; e.hidden = false; }
        if (!first && g) first = g;
      }
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function validate() {
      clearErrors();
      const f = values(), errs = {};
      svc.fields.forEach((fd) => {
        const v = typeof f[fd.id] === "string" ? f[fd.id].trim() : f[fd.id];
        if (fd.type === "checkbox") return;
        if (fd.required && !v) errs[fd.id] = "هذا الحقل مطلوب";
        else if (fd.maxWords && countWords(v) > fd.maxWords) errs[fd.id] = "الحد الأقصى " + fd.maxWords + " كلمة";
        else if (fd.maxLines && countLines(v) > fd.maxLines) errs[fd.id] = "الحد الأقصى " + fd.maxLines + " سطر";
      });
      const email = $("f-email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "اكتب بريداً إلكترونياً صحيحاً";
      if (!$("f-terms").checked) errs.terms = "وافق على الشروط لإكمال الطلب";
      showErrors(errs);
      return Object.keys(errs).length === 0;
    }

    function select(id) {
      svc = catalog.find((s) => s.id === id) || null;
      renderGrid();
      if (!svc) { form.hidden = true; return; }
      say("");
      renderForm();
      try { history.replaceState(null, "", "#" + svc.id); } catch (e) {}
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function loadPayPal(clientId) {
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(clientId) + "&currency=USD&intent=capture&components=buttons";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    function renderButtons() {
      window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        onClick: (data, actions) => (validate() ? actions.resolve() : actions.reject()),
        createOrder: async () => {
          say("");
          const body = { service: svc.id, fields: values(), email: $("f-email").value.trim() };
          const r = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
          if (!r.ok) {
            if (r.data && r.data.fields) showErrors(r.data.fields);
            say((r.data && r.data.message) || "تعذّر إنشاء الطلب", "error");
            throw new Error("create_failed");
          }
          current = { id: r.data.id, key: r.data.key, name: svc.name };
          remember(current);
          return r.data.paypalOrderId;
        },
        onApprove: async () => {
          say("جارٍ تأكيد الدفع…", "info");
          await api("/api/orders/" + current.id + "/capture", { method: "POST", body: JSON.stringify({ key: current.key }) });
          location.href = statusUrl(current.id, current.key);
        },
        onCancel: () => say("ألغيت الدفع. يمكنك المحاولة مرة أخرى متى شئت.", "warning"),
        onError: () => { if (!msg.textContent) say("حدث خطأ أثناء الدفع. لم يُخصم أي مبلغ، حاول مرة أخرى.", "error"); },
      }).render("#paypal-buttons");
    }

    function clearFieldError(e) {
      const g = e.target.closest && e.target.closest(".form-group");
      if (!g || !g.classList.contains("has-err")) return;
      g.classList.remove("has-err");
      const er = g.querySelector(".err"); if (er) { er.hidden = true; er.textContent = ""; }
    }
    form.addEventListener("input", clearFieldError);
    form.addEventListener("change", clearFieldError);

    renderMine();
    (async () => {
      const [cat, cfg] = await Promise.all([api("/api/catalog"), api("/api/config")]);
      if (!cat.ok) { grid.replaceChildren(el("div", { class: "alert alert-warning", text: "استقبال الطلبات متوقف مؤقتاً. عد لاحقاً." })); return; }
      catalog = cat.data.services || [];
      renderGrid();
      const wanted = (location.hash || "").slice(1);
      if (catalog.some((s) => s.id === wanted)) select(wanted);
      if (cfg.ok && cfg.data.enabled && cfg.data.paypalClientId) {
        try { await loadPayPal(cfg.data.paypalClientId); renderButtons(); }
        catch (e) { $("paypal-buttons").replaceChildren(el("div", { class: "alert alert-error", text: "تعذّر تحميل PayPal. حدّث الصفحة." })); }
      } else {
        $("paypal-buttons").replaceChildren(el("div", { class: "alert alert-warning", text: "الدفع غير متاح حالياً." }));
      }
    })();

    $("change-svc").addEventListener("click", () => { $("svc-grid").scrollIntoView({ behavior: "smooth" }); });
  }

  // ═══ صفحة متابعة الطلب ═══
  function initStatusPage() {
    const q = new URLSearchParams(location.search);
    const id = q.get("id") || "", key = q.get("key") || "";
    const box = $("status-box");
    const STEPS = [["created", "تم الطلب"], ["paid", "تم الدفع"], ["in_progress", "قيد التنفيذ"], ["delivered", "تم التسليم"]];
    const LABEL = { awaiting_payment: "بانتظار الدفع", paid: "تم الدفع — في الدور", in_progress: "قيد التنفيذ", delivered: "تم التسليم", needs_review: "قيد المراجعة", refunded: "تم استرجاع المبلغ", cancelled: "ملغي" };
    let timer = null, triedCapture = false;

    function stepIndex(s) { return { awaiting_payment: 0, paid: 1, needs_review: 1, in_progress: 2, delivered: 3 }[s] ?? 0; }
    function fmtDate(iso) { try { return new Date(iso).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return iso; } }
    function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

    async function load() {
      if (!id || !key) { box.replaceChildren(el("div", { class: "alert alert-error", text: "رابط الطلب ناقص. افتح الرابط كما وصلك بعد الدفع." })); return; }
      const r = await api("/api/orders/" + encodeURIComponent(id) + "?key=" + encodeURIComponent(key));
      if (!r.ok) { box.replaceChildren(el("div", { class: "alert alert-error", text: (r.data && r.data.message) || "تعذّر تحميل الطلب" })); return; }
      let o = r.data;
      // وافق على الدفع وسكّر الصفحة قبل التأكيد؟ نكمّل التحصيل مرة وحدة
      if (o.status === "awaiting_payment" && !triedCapture) {
        triedCapture = true;
        const c = await api("/api/orders/" + encodeURIComponent(id) + "/capture", { method: "POST", body: JSON.stringify({ key }) });
        if (c.ok && c.data && c.data.status) o = c.data;
      }
      remember({ id: o.id, key, name: o.serviceName });
      render(o);
      clearTimeout(timer);
      if (!["delivered", "refunded", "cancelled"].includes(o.status)) timer = setTimeout(load, 60000);
    }

    function render(o) {
      const at = stepIndex(o.status);
      const parts = [
        el("div", { class: "order-head" }, [
          el("h2", { text: (o.icon || "") + " " + o.serviceName }),
          el("span", { class: "status-pill", "data-s": o.status, text: LABEL[o.status] || o.status }),
        ]),
        el("dl", { class: "kv" }, [
          el("dt", { text: "رقم الطلب" }), el("dd", { text: o.id }),
          el("dt", { text: "المبلغ" }), el("dd", { text: money(o.price) }),
          el("dt", { text: "تاريخ الطلب" }), el("dd", { text: fmtDate(o.createdAt) }),
          o.paidAt ? el("dt", { text: "التسليم المتوقع" }) : null,
          o.paidAt ? el("dd", { text: "قبل " + fmtDate(new Date(new Date(o.paidAt).getTime() + o.hours * 3600e3).toISOString()) }) : null,
        ]),
      ];
      if (!["refunded", "cancelled"].includes(o.status)) {
        parts.push(el("div", { class: "timeline" }, STEPS.map((s, i) => el("div", { class: i < at ? "done" : i === at ? (o.status === "delivered" ? "done" : "now") : "", text: s[1] }))));
      }
      if (o.publicNote) parts.push(el("div", { class: "alert alert-warning", text: o.publicNote }));
      if (o.status === "awaiting_payment") parts.push(el("div", { class: "alert alert-warning" }, ["لم يكتمل الدفع لهذا الطلب. ", el("a", { href: "index.html", text: "اطلب من جديد" })]));
      if (o.status === "paid" || o.status === "in_progress") parts.push(el("div", { class: "alert alert-info", text: "نعمل على طلبك. هذه الصفحة تتحدّث تلقائياً كل دقيقة، ويمكنك إغلاقها والعودة لاحقاً من نفس الرابط." }));

      if (o.status === "delivered" && o.result) {
        const files = o.result.files || [];
        if (files.length) {
          parts.push(el("h3", { text: "ملفاتك", style: "margin-top:18px" }));
          parts.push(el("div", { class: "files" }, files.map((f) => el("a", {
            href: API + "/api/orders/" + encodeURIComponent(o.id) + "/files/" + f.n + "?key=" + encodeURIComponent(key),
          }, [el("b", { text: "⬇ " + f.name }), el("span", { text: kb(f.size) })]))));
        }
        if (o.result.text) {
          const pre = el("div", { class: "result-text", text: o.result.text });
          const copyBtn = el("button", { class: "btn-ghost", type: "button", text: "انسخ النص", onclick: async () => {
            try { await navigator.clipboard.writeText(o.result.text); copyBtn.textContent = "تم النسخ ✓"; }
            catch (e) { const s = getSelection(), rg = document.createRange(); rg.selectNodeContents(pre); s.removeAllRanges(); s.addRange(rg); copyBtn.textContent = "حدّدنا النص، انسخه"; }
            setTimeout(() => { copyBtn.textContent = "انسخ النص"; }, 2000);
          } });
          parts.push(el("div", { class: "row", style: "justify-content:space-between;margin-top:18px" }, [el("h3", { text: "النص" }), copyBtn]));
          parts.push(pre);
        }
        parts.push(el("p", { class: "hint", style: "margin-top:14px;color:var(--text-muted)", text: "تحتاج تعديلاً؟ راسلنا من صفحة اتصل بنا مع رقم الطلب خلال 3 أيام." }));
      }

      const linkBtn = el("button", { class: "btn-ghost", type: "button", text: "انسخ رابط الطلب", onclick: async () => {
        try { await navigator.clipboard.writeText(location.href); linkBtn.textContent = "تم النسخ ✓"; } catch (e) { linkBtn.textContent = "انسخه من شريط العنوان"; }
        setTimeout(() => { linkBtn.textContent = "انسخ رابط الطلب"; }, 2000);
      } });
      parts.push(el("div", { class: "alert alert-info", style: "margin-top:18px" }, ["احفظ رابط هذه الصفحة: منه تتابع طلبك وتستلم ملفاتك. ", linkBtn]));
      box.replaceChildren(...parts);
    }

    load();
  }

  window.AhsebhaServices = { initOrderPage, initStatusPage };
})();
