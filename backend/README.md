# خادم طلبات خدمات احسبها

ملف واحد (`worker.js`) بيشتغل على Cloudflare Workers (مجاني). بيعمل هالشغلات:
- بيعرض الخدمات والأسعار لصفحة `services/`.
- بيحسب السعر بنفسه (الزبون ما بيقدر يغيّره)، وبيفتح عملية الدفع بـ PayPal، وبيتأكد إنها انقبضت بالمبلغ الصح.
- بيخزّن الطلب، وبيعطي الإيجنت الطلبات المدفوعة (بمفتاح سرّي)، وبيسلّم الملفات للزبون.

المصاري بتروح مباشرة من الزبون لحساب PayPal تبعك. الخادم والإيجنت ما بيلمسوها.

## الإعداد (مرة وحدة، حوالي 30 دقيقة)

### 1. PayPal
1. حوّل حسابك لحساب **Business** (مجاني). PayPal بتنصح فيه بالأردن حتى تسحب على بنك محلي.
2. من إعدادات الدفعات، خلّي PayPal **يقبل الدفعات بالدولار تلقائياً**، حتى ما تعلق الدفعات «معلّقة».
3. ادخل على developer.paypal.com بنفس الحساب ← Apps & Credentials ← اختار **Live** ← Create App (الاسم: ahsebha).
4. انسخ **Client ID** و **Secret**. ما تبعتهم لحدا ولا تلصقهم بالشات.

> للتجربة بلا مصاري حقيقية: اعمل نفس الخطوة 3 على **Sandbox**، وحط `PAYPAL_ENV = sandbox`.

### 2. Cloudflare
1. سجّل مجاناً على dash.cloudflare.com.
2. **Storage & Databases ← KV ← Create**: الاسم `ahsebha-orders`.
3. **Workers & Pages ← Create ← Worker**: الاسم `ahsebha-orders` ← Deploy ← **Edit code** ← امسح كل شي والصق محتوى `backend/worker.js` ← Deploy.
4. من الـ Worker ← **Settings ← Bindings ← Add ← KV namespace**: اسم المتغير `ORDERS`، واختار `ahsebha-orders`.
5. **Settings ← Variables and Secrets**:

   | الاسم | النوع | القيمة |
   |---|---|---|
   | `PAYPAL_CLIENT_ID` | Text | من PayPal |
   | `PAYPAL_SECRET` | Secret | من PayPal |
   | `PAYPAL_ENV` | Text | `live` (أو `sandbox` للتجربة) |
   | `AGENT_TOKEN` | Secret | كلمة سر طويلة عشوائية (40 حرف أو أكتر) من مولّد كلمات السر |
   | `ALLOWED_ORIGIN` | Text | `https://ooo518106-rgb.github.io` |

6. افتح `https://ahsebha-orders.<اسمك>.workers.dev/api/config`. لازم يطلعلك `"enabled":true`.

### 3. بيئة Claude (عشان الإيجنت يوصل للطلبات)
من قائمة البيئة بعنوان الجلسة ← **Edit**:
- **Network access**: Custom، وضيف `ahsebha-orders.<اسمك>.workers.dev` و `github.com` و `*.github.com` و `*.githubusercontent.com`.
- **Environment variables**: `AHSEBHA_API=https://ahsebha-orders.<اسمك>.workers.dev`
- **API credentials ← Add credential**: النوع Bearer، الموقع `ahsebha-orders.<اسمك>.workers.dev`، والقيمة = `AGENT_TOKEN`.
  هيك الإيجنت ما بيشوف كلمة السر، والبيئة بتضيفها لحالها لكل طلب للخادم.

### 4. آخر خطوة
حط عنوان الـ Worker بملف `services/config.js`، وشغّل Routine «إيجنت تنفيذ الطلبات» كل ساعة.

## التشغيل اليومي
- الإيجنت بيفحص كل ساعة، بينفّذ الطلبات المدفوعة، وبيسلّمها على صفحة الطلب.
- الطلب المرفوض بيوصلك عنه إشعار: رجّع المبلغ من PayPal، وبعدين:
  `python3 agent/orders.py set ID refunded`
- السحب من PayPal لبنكك: من تطبيق PayPal (بياخد لحد 7 أيام عمل للبنوك الأردنية).

## الاختبارات
```bash
cd backend && npm test
```
