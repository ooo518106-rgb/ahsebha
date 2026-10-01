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
];
