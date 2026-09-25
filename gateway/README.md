# بوابة واتساب احسبها

بوابة متعددة الأرقام، شغلها متل Green-API: بتربط رقم واتساب عادي بمسح QR، وبعدين بتبعت وبتستقبل رسائل عن طريق API، وكل رسالة واردة بتوصلك على رابط webhook.

> ⚠️ **تنبيه:** هاد ربط غير رسمي (متل واتساب ويب)، وواتساب ممكن يحظر أي رقم بيستعمله. البوابة فيها حماية بتقلل الخطر، بس ما بتلغيه. خبّر كل تاجر بهالشي قبل ما يربط رقمه.

## الحماية من الحظر (مفعّلة تلقائياً)
| الإعداد | الافتراضي | الشرح |
|---|---|---|
| `replyWindowHours` | 24 | ما بتبعت إلا لحدا راسلك خلال آخر 24 ساعة، يعني ما في رسائل لناس غرباء |
| `dailyLimit` | 300 | أقصى عدد رسائل صادرة باليوم لكل رقم |
| `minDelayMs` / `maxDelayMs` | 2000 / 5000 | تأخير عشوائي بين كل رسالتين |
| `typingMs` | 1500 | «عم يكتب…» قبل كل رسالة |
| `ignoreGroups` | true | بتتجاهل الجروبات |

هالإعدادات بيغيّرها المدير بس (`PATCH /admin/instances/:id`)، والتاجر ما بيقدر يغيّرها.

## التشغيل على سيرفر (مرة وحدة)
1. استأجر سيرفر Linux صغير (1 CPU، 2GB RAM، Ubuntu 24)، متل Hetzner CX22 أو DigitalOcean. حوالي 5$ بالشهر.
2. ادخل عليه بـ SSH ونزّل Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/ooo518106-rgb/ahsebha.git && cd ahsebha/gateway
   cp .env.example .env && nano .env
   ```
3. بملف `.env`:
   - **`DOMAIN`**: إذا ما عندك دومين، استعمل `IP.sslip.io`. مثلاً إذا الـ IP هو `5.6.7.8` بتكتب `5-6-7-8.sslip.io`، وهيك بيشتغل HTTPS مجاناً.
   - **`PUBLIC_URL`**: نفس الدومين مع `https://` بالأول.
   - **`ADMIN_TOKEN`**: كلمة سر طويلة عشوائية.
4. شغّل:
   ```bash
   docker compose up -d
   ```
5. افتح `https://الدومين/` وادخل بـ `ADMIN_TOKEN`.

التحديث بعدين: `git pull && docker compose up -d --build`

## الاستعمال
1. من لوحة المدير ← **رقم جديد**.
2. اكبس **رابط الربط للتاجر** وابعته للتاجر، هو بيمسح الـ QR من «الأجهزة المرتبطة».
3. اكبس **API Token** واستعمله بالطلبات.

## الـ API
كل طلب لازم يكون فيه الترويسة `Authorization: Bearer <API Token>`.

| الطريقة | المسار | الجسم |
|---|---|---|
| GET | `/api/:id/state` | — |
| GET | `/api/:id/qr` | — |
| POST | `/api/:id/sendMessage` | `{ "phone": "962791234567", "message": "..." }` |
| POST | `/api/:id/sendFile` | `{ "phone", "base64", "mimetype", "fileName", "caption" }` |
| POST | `/api/:id/sendLocation` | `{ "phone", "lat", "lng", "name", "address" }` |
| GET | `/api/:id/media/:idMessage` | تنزيل صورة أو صوت أو ملف وارد (بيضل 24 ساعة) |
| POST | `/api/:id/settings` | `{ "webhookUrl": "https://..." }` |
| POST | `/api/:id/reconnect` | — |
| POST | `/api/:id/logout` | — |

بدل `phone` فيك تبعت `chatId` كما وصلك بالـ webhook.

**الأخطاء:**
- `429 outside_reply_window`: الشخص ما راسل الرقم خلال آخر 24 ساعة.
- `429 daily_limit`: الرقم وصل الحد اليومي.
- `409 not_connected`: الرقم مش مربوط.

### Webhook
كل حدث بيوصل `POST` لرابط الـ webhook، ومعه الترويسة `X-Signature: sha256=<HMAC(body, webhookSecret)>`.

```json
{
  "typeWebhook": "incomingMessageReceived",
  "instanceId": "6IDWYR7YBH",
  "idMessage": "3EB0...",
  "chatId": "962791234567@s.whatsapp.net",
  "phone": "962791234567",
  "senderName": "سارة",
  "type": "text | image | voice | audio | document | video | location | contact | sticker",
  "text": "كم سعر العطر؟",
  "mediaUrl": "https://.../api/<id>/media/<idMessage>",
  "location": { "lat": 31.95, "lng": 35.91 },
  "timestamp": 1790000000
}
```
وكمان `stateInstanceChanged` لما تتغيّر حالة الرقم: `qr`، `connected`، `disconnected`، `qr_expired` (الكود انتهى بدون مسح، والتاجر بيطلب كود جديد من صفحة الربط)، `logged_out`.

## الاختبارات
```bash
npm test
```
