// الجداول — كل الأوقات بالمللي ثانية (Date.now())، وكل جدول مربوط بالمحل (shop_id)
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b3e26',
    program_type TEXT NOT NULL DEFAULT 'points' CHECK (program_type IN ('points', 'stamps')),
    points_per_unit REAL NOT NULL DEFAULT 1,
    reward_threshold INTEGER NOT NULL DEFAULT 100,
    stamps_required INTEGER NOT NULL DEFAULT 9,
    reward_name TEXT NOT NULL DEFAULT 'مشروب مجاني',
    currency TEXT NOT NULL DEFAULT 'JOD',
    country TEXT NOT NULL DEFAULT 'JO',
    welcome_text TEXT NOT NULL DEFAULT '',
    locations TEXT NOT NULL DEFAULT '[]',
    logo_version INTEGER NOT NULL DEFAULT 0,
    custom_logo INTEGER NOT NULL DEFAULT 0,
    gw_synced_at INTEGER,
    gw_error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS shop_logos (
    shop_id INTEGER PRIMARY KEY REFERENCES shops(id),
    mime TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
    pw_hash TEXT NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    token TEXT NOT NULL UNIQUE,
    card_no TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    lifetime INTEGER NOT NULL DEFAULT 0,
    redeemed INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    last_visit INTEGER,
    gw_object INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (shop_id, card_no),
    UNIQUE (shop_id, phone)
  )`,
  `CREATE TABLE IF NOT EXISTS txns (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'adjust')),
    delta INTEGER NOT NULL,
    amount REAL,
    user_id INTEGER,
    note TEXT,
    idem TEXT,
    created_at INTEGER NOT NULL
  )`,
  // عدّاد طلبات بسيط ضد السبام: مفتاح لكل (نوع الطلب + IP + نافذة زمنية)
  `CREATE TABLE IF NOT EXISTS rate_hits (
    k TEXT PRIMARY KEY,
    n INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // طلبات الاشتراك من صفحة البيع
  `CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY,
    shop_name TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost')),
    created_at INTEGER NOT NULL
  )`,
  // Apple Wallet: مفتاح وشهادة المنصة (صف واحد)، والأجهزة المسجّلة لتحديث البطاقات
  `CREATE TABLE IF NOT EXISTS apple_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    private_key TEXT,
    public_key TEXT,
    cert TEXT,
    pass_type_id TEXT,
    team_id TEXT,
    cert_expires INTEGER,
    auth_secret TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS apple_regs (
    device_id TEXT NOT NULL,
    serial TEXT NOT NULL,
    push_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, serial)
  )`,
  'CREATE INDEX IF NOT EXISTS apple_regs_serial ON apple_regs(serial)',
  // إشعارات الويب: مفاتيح VAPID للمنصة، واشتراكات أجهزة الزبائن، والرسائل الجماعية
  `CREATE TABLE IF NOT EXISTS push_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (endpoint, member_id)
  )`,
  'CREATE INDEX IF NOT EXISTS push_subs_member ON push_subs(member_id)',
  'CREATE INDEX IF NOT EXISTS push_subs_shop ON push_subs(shop_id, id)',
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    header TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // تقييمات الزبائن بعد الزيارة (التعليق بيوصل لصاحب المحل بس)
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS reviews_shop ON reviews(shop_id, created_at)',
  'CREATE INDEX IF NOT EXISTS reviews_member ON reviews(member_id, created_at)',
  // إعدادات المنصة (رقم CliQ، آخر رابط للموقع…)
  `CREATE TABLE IF NOT EXISTS platform_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  )`,
  // دفعات الاشتراك: صاحب المحل بيحوّل بـ CliQ وبيبلّغ، ومدير المنصة بيأكد
  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    plan TEXT NOT NULL CHECK (plan IN ('month', 'year')),
    amount REAL NOT NULL,
    payer TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS payments_status ON payments(status, created_at)',
  'CREATE INDEX IF NOT EXISTS payments_shop ON payments(shop_id, created_at)',
  // إشعارات لأصحاب المحلات ومدير المنصة (على اللوحة)
  `CREATE TABLE IF NOT EXISTS user_push_subs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    last_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (endpoint, user_id)
  )`,
  'CREATE INDEX IF NOT EXISTS user_push_user ON user_push_subs(user_id)',
  // كوبونات لمجموعة زبائن، وكل زبون بيصرف الكوبون مرة وحدة
  `CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    segment TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    issued INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS coupons_shop ON coupons(shop_id, created_at)',
  `CREATE TABLE IF NOT EXISTS member_coupons (
    coupon_id INTEGER NOT NULL REFERENCES coupons(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    shop_id INTEGER NOT NULL,
    used_at INTEGER,
    used_by INTEGER,
    PRIMARY KEY (coupon_id, member_id)
  )`,
  'CREATE INDEX IF NOT EXISTS member_coupons_member ON member_coupons(member_id)',
  // الرصيد المدفوع مسبقاً (بالفلس: 1000 = دينار)
  `CREATE TABLE IF NOT EXISTS credit_txns (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    kind TEXT NOT NULL CHECK (kind IN ('topup', 'spend')),
    amount INTEGER NOT NULL,
    bonus INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER,
    branch_id TEXT,
    idem TEXT,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS credit_member ON credit_txns(member_id, created_at)',
  'CREATE INDEX IF NOT EXISTS credit_shop ON credit_txns(shop_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS credit_idem ON credit_txns(shop_id, idem)',
  // المندوبين: بيجيبوا محلات وبياخدوا نسبة من الاشتراك
  `CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    pct INTEGER NOT NULL DEFAULT 20,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reseller_payouts (
    id INTEGER PRIMARY KEY,
    reseller_id INTEGER NOT NULL REFERENCES resellers(id),
    amount REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // المنيو الإلكتروني (الصورة اختيارية وصغيرة، بتنحفظ بقاعدة البيانات)
  `CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    category TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL,
    image TEXT,
    available INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS menu_shop ON menu_items(shop_id, category, sort)',
  // ملف المنيو PDF: بينحفظ قطع (base64) لأنه قاعدة البيانات ما بتقبل قيمة أكبر من 2 ميغا. ver = وقت الرفع
  `CREATE TABLE IF NOT EXISTS menu_files (
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    ver INTEGER NOT NULL,
    part INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (shop_id, ver, part)
  )`,
  // إهداء رصيد لصاحب: الرصيد بينخصم فوراً، والصاحب بيستلمه برابط (وبيرجع لصاحبه بعد 30 يوم لو ما انستلم)
  `CREATE TABLE IF NOT EXISTS credit_gifts (
    id INTEGER PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    from_member INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    claimed_by INTEGER,
    claimed_at INTEGER,
    refunded_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS gifts_open ON credit_gifts(created_at) WHERE claimed_at IS NULL AND refunded_at IS NULL',
  'CREATE INDEX IF NOT EXISTS leads_time ON leads(created_at)',
  'CREATE INDEX IF NOT EXISTS members_shop ON members(shop_id, created_at)',
  'CREATE INDEX IF NOT EXISTS txns_shop_time ON txns(shop_id, created_at)',
  'CREATE INDEX IF NOT EXISTS txns_member ON txns(member_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS txns_idem ON txns(shop_id, idem)',
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
];

// تعديلات على جداول موجودة (بتنطبق مرة وحدة؛ لو العمود موجود بنتجاهل الخطأ)
export const MIGRATIONS = [
  'ALTER TABLE shops ADD COLUMN active_until INTEGER',
  'ALTER TABLE shops ADD COLUMN paid INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN updated_at INTEGER',
  'ALTER TABLE members ADD COLUMN updated_at INTEGER',
  // نتيجة آخر إشعار لكل جهاز (عشان صاحب المحل يشوف إذا وصل أو ليش ما وصل)
  'ALTER TABLE push_subs ADD COLUMN last_at INTEGER',
  'ALTER TABLE push_subs ADD COLUMN last_error TEXT',
  // العروض: نقاط دبل بأوقات، المستويات، عيد الميلاد، الزبائن الغايبين، التقييمات، ادعُ صاحبك
  "ALTER TABLE shops ADD COLUMN boosts TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE shops ADD COLUMN tiers_on INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN tier_silver INTEGER NOT NULL DEFAULT 10',
  'ALTER TABLE shops ADD COLUMN tier_gold INTEGER NOT NULL DEFAULT 25',
  'ALTER TABLE shops ADD COLUMN bday_on INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE shops ADD COLUMN bday_gift INTEGER',
  'ALTER TABLE shops ADD COLUMN winback_days INTEGER NOT NULL DEFAULT 30',
  "ALTER TABLE shops ADD COLUMN winback_text TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE shops ADD COLUMN winback_double INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE shops ADD COLUMN review_on INTEGER NOT NULL DEFAULT 1',
  "ALTER TABLE shops ADD COLUMN review_url TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE shops ADD COLUMN ref_bonus INTEGER',
  'ALTER TABLE members ADD COLUMN birthday TEXT',
  'ALTER TABLE members ADD COLUMN bday_set_at INTEGER',
  'ALTER TABLE members ADD COLUMN bday_year INTEGER',
  'ALTER TABLE members ADD COLUMN ref_code TEXT',
  'ALTER TABLE members ADD COLUMN referred_by INTEGER',
  'ALTER TABLE members ADD COLUMN ref_rewarded INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE members ADD COLUMN boost_until INTEGER',
  'ALTER TABLE members ADD COLUMN nudged_at INTEGER',
  'ALTER TABLE members ADD COLUMN review_ask_at INTEGER',
  // الحماية من التلاعب، الملخص اليومي، الرصيد المدفوع، صلاحية النقاط، الروابط، الفروع، اللغة، المندوبين
  'ALTER TABLE shops ADD COLUMN guard_cooldown INTEGER NOT NULL DEFAULT 10',
  'ALTER TABLE shops ADD COLUMN guard_daily INTEGER NOT NULL DEFAULT 3',
  'ALTER TABLE shops ADD COLUMN guard_big INTEGER',
  'ALTER TABLE shops ADD COLUMN summary_day INTEGER',
  'ALTER TABLE shops ADD COLUMN credit_on INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN credit_bonus INTEGER NOT NULL DEFAULT 10',
  'ALTER TABLE shops ADD COLUMN expiry_months INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN expiry_since INTEGER',
  "ALTER TABLE shops ADD COLUMN links TEXT NOT NULL DEFAULT '{}'",
  'ALTER TABLE shops ADD COLUMN reseller_id INTEGER',
  'ALTER TABLE members ADD COLUMN credit INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE members ADD COLUMN expiry_warned_at INTEGER',
  "ALTER TABLE members ADD COLUMN lang TEXT NOT NULL DEFAULT 'ar'",
  'ALTER TABLE users ADD COLUMN branch_id TEXT',
  'ALTER TABLE txns ADD COLUMN branch_id TEXT',
  'ALTER TABLE leads ADD COLUMN reseller_id INTEGER',
  // حساب العرض، خطوات البداية، تذكير نهاية التجربة، ملاحظات الرصيد
  'ALTER TABLE shops ADD COLUMN demo INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE shops ADD COLUMN onboard TEXT NOT NULL DEFAULT '{}'",
  'ALTER TABLE shops ADD COLUMN reminder_key TEXT',
  'ALTER TABLE shops ADD COLUMN menu_pdf INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN menu_pdf_size INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shops ADD COLUMN menu_pdf_parts INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE menu_items ADD COLUMN sizes TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE credit_txns ADD COLUMN note TEXT',
  // فهارس على الأعمدة الجديدة (لازم تيجي بعد ما ينضاف العمود)
  'CREATE INDEX IF NOT EXISTS shops_reseller ON shops(reseller_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS members_ref ON members(shop_id, ref_code)',
  'CREATE INDEX IF NOT EXISTS members_referrer ON members(referred_by)',
  'CREATE INDEX IF NOT EXISTS members_visit ON members(shop_id, last_visit)',
  'CREATE INDEX IF NOT EXISTS members_bday ON members(shop_id, birthday)',
];
