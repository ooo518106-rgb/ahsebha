// لغة صفحات الزبون (البطاقة والانضمام): حسب لغة الجوال، والزبون بيقدر يغيّرها بكبسة
const KEY = 'nq_lang';

export const LANG = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* اختياري */ }
  return /^ar\b/i.test(navigator.language || 'ar') ? 'ar' : 'en';
})();

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* اختياري */ }
}

export function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
}

const AR = {
  // البطاقة
  name: 'الاسم', points: 'النقاط', stamps: 'الأختام', unitPoint: 'نقطة', unitStamp: 'ختم',
  ready1: '🎁 عندك مكافأة جاهزة: {reward}', readyN: '🎁 عندك {n} مكافآت جاهزة: {reward}', remaining: 'باقي {n} {unit} لـ {reward}',
  cardTitle: 'بطاقة {shop}', welcomeNew: 'أهلاً {name}! هاي بطاقتك 🎉', saveToWallet: 'احفظها بالمحفظة عشان تطلعلك بسرعة.',
  gwOff: 'الحفظ بمحفظة Google لسا مش مفعّل. اعرض هالصفحة للكاشير.', appleOff: 'الحفظ بـ Apple Wallet لسا مش مفعّل. اعرض هالصفحة للكاشير.',
  gwAlt: 'الإضافة إلى محفظة Google',
  iosTip: '<b>على الآيفون:</b> كبس على <b>مشاركة ⬆️</b> وبعدين <b>«إضافة إلى الشاشة الرئيسية»</b>، وافتح البطاقة من الأيقونة: بتفتح بسرعة وبتقدر تفعّل إشعارات النقاط والعروض 🔔',
  showQr: 'اعرض الـ QR للكاشير مع كل طلب.', walletHint: 'بعد ما تحفظها بالمحفظة بتلاقيها جنب بطاقاتك، وبتطلعلك لحالها لما تقرّب من المحل.',
  iosSide: ' وعلى الآيفون بتفتحها بكبستين على الزر الجانبي.',
  visits: 'زياراتك: {v} · المكافآت اللي أخدتها: {r}', privacy: 'سياسة الخصوصية', deleteCard: 'احذف بطاقتي وبياناتي', powered: 'بطاقات الولاء من',
  deleteConfirm: 'أكيد بدك تحذف بطاقتك؟ رح تنمسح نقاطك وكل سجلك عند هالمحل نهائياً، وما في رجعة.',
  deleted: 'انحذفت بطاقتك وكل بياناتك. إذا كانت محفوظة بالمحفظة، رح تتوقف لحالها.',
  // الإشعارات
  pushAsk: '🔔 بدك يوصلك إشعار لما تنضافلك نقاط أو يكون في عرض؟', pushOn: 'فعّل الإشعارات', pushIsOn: '🔔 الإشعارات مفعّلة', pushTest: 'جرّب إشعار',
  pushOff: 'إيقاف', pushDenied: '🔕 الإشعارات مسكّرة لهالبطاقة. بتقدر تفتحها من إعدادات الجوال.', pushEnabled: 'تفعّلت الإشعارات 🔔',
  pushFailed: 'ما قدرنا نفعّل الإشعارات', pushStopped: 'وقّفنا الإشعارات',
  pushTestOk: '✅ انبعتلك إشعار تجريبي، لازم يطلعلك هلق. إذا ما شفته، اسحب من فوق الشاشة لتحت.',
  pushTestBad: '❌ ما قدرنا نوصّل الإشعار ({reason}). صوّر هالشاشة وابعتها للمحل.', error: 'خطأ',
  // العروض
  bdayToday: '🎂 كل سنة وإنت سالم يا {name}! 🎉', boostNow: '⏰ هلق نقاطك ×{m} على كل طلب!', boostUntil: '🎁 اشتقنالك! نقاطك دبل لحد {day}',
  tier: '{icon} مستواك: {name}', tierMult: ' · نقاطك ×{m}', tierNext: 'باقي {n} {visits} وبتصير {icon} {name}', visit1: 'زيارة', visitN: 'زيارات',
  thanks: 'شكراً إلك 🙏', googleAsk: 'بتساعدنا كتير إذا كتبت تقييمك على Google ⭐', googleBtn: 'قيّمنا على Google', feedbackSent: 'وصل كلامك لـ {shop}.',
  rateAsk: 'كيف كانت زيارتك اليوم؟', rateNote: 'شو اللي ما عجبك؟ رح يوصل لصاحب المحل بس', send: 'ابعت',
  bdayAsk: '🎂 شو تاريخ ميلادك؟', bdayGift: 'بنهديك {gift} يوم عيدك 🎁', bdayGreet: 'عشان نعايدك يوم عيدك 🎉', day: 'اليوم', month: 'الشهر', save: 'حفظ',
  bdaySaved: 'انحفظ تاريخ ميلادك 🎂',
  invite: '👥 ادعُ صاحبك', inviteHint: 'لما يزورنا أول مرة، بتاخدوا انتو التنين {n} {unit} هدية.', inviteSend: 'ابعتله الدعوة', copyLink: 'نسخ الرابط', copied: 'انسخ الرابط ✅',
  inviteText: 'تعال انضم لبطاقة الولاء تبعت {shop} ☕ وبأول زيارة بناخد انا وإنت هدية 🎁\n{url}',
  coupon: '🎟️ {title}', couponUntil: 'لحد {day} · اعرض بطاقتك للكاشير',
  credit: '💳 رصيدك: {amount} {cur}', creditHint: 'بتدفع منه عند الكاشير',
  expires: '⏳ نقاطك صالحة لحد {day}. أي زيارة بتجددها.',
  links: 'تابعنا', instagram: 'إنستغرام', tiktok: 'تيك توك', facebook: 'فيسبوك', whatsapp: 'واتساب', website: 'الموقع',
  months: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
  langSwitch: 'English',
  // الانضمام
  joinTitle: 'انضم لبطاقة الولاء', joinPageTitle: 'انضم لبطاقة ولاء {shop}', paused: 'برنامج الولاء بهالمحل متوقف مؤقتاً.', openMine: 'افتح بطاقتي',
  haveCard: 'عندك بطاقة عنا من قبل 👋', referred: '🎁 {name} دعاك! بأول زيارة إلك بتاخدوا انتو التنين {n} {unit} هدية.',
  phone: 'رقم الجوال', phoneHint: 'عشان لو ضاعت بطاقتك، الكاشير بيلاقيها برقمك.', bday: '🎂 تاريخ ميلادك', optional: '(اختياري)',
  getCard: 'أعطيني بطاقتي', walletNote: 'بتنحفظ بمحفظة الجوال، وبتطلعلك لحالها لما تكون قريب من {shop}.',
  consent: 'لما تنضم بتوافق على <a href="/privacy" target="_blank" rel="noopener">سياسة الخصوصية</a>. منحفظ اسمك ورقمك ونقاطك (وتاريخ ميلادك لو كتبته) بس، وبتقدر تحذفهم بأي وقت.',
  loading: 'جاري التحميل…',
  // المنيو
  menu: 'المنيو', menuEmpty: 'المنيو لسا فاضي.', menuJoin: '🎁 اجمع نقاط مع كل طلب واحصل على {reward}', menuJoinBtn: 'خذ بطاقة الولاء', menuOpenCard: 'افتح بطاقتي', menuPdf: 'افتح المنيو', menuPdfHint: 'المنيو الكامل (PDF)', sizeLabel: 'الحجم', seeMenu: '📋 شوف المنيو',
  // كل بطاقاتي والهدايا
  myCards: '💼 بطاقاتي', myCardsEmpty: 'ما في بطاقات محفوظة على هالجهاز لسا. افتح رابط بطاقتك مرة وبتنحفظ هون.', addCardLink: 'الصق رابط بطاقة', addCard: 'ضيف', removeCard: 'شيلها من هون',
  myCardsHint: 'ضيف هالصفحة على الشاشة الرئيسية، وبتصير عندك أيقونة وحدة لكل بطاقاتك.', allCards: '💼 كل بطاقاتي',
  giftBtn: '🎁 أهدي رصيد لصاحب', giftAsk: 'كم بدك تهدي؟ ({cur})', giftMade: 'جاهزة الهدية 🎁 ابعت الرابط لصاحبك', giftText: '🎁 أهديتك {amount} {cur} رصيد بـ {shop}! افتح الرابط واستلمها:\n{url}',
  giftTitle: '🎁 {name} أهداك {amount} {cur}', giftAt: 'رصيد بـ {shop}، بتدفع منه عند الكاشير.', giftClaim: 'استلم الهدية على بطاقتي', giftJoin: 'خذ بطاقة واستلم الهدية',
  giftClaimed: 'استلمت الهدية ✅', giftSend: 'ابعت الهدية', giftGone: 'هالهدية انستلمت أو انتهت.',
};

const EN = {
  name: 'Name', points: 'Points', stamps: 'Stamps', unitPoint: 'points', unitStamp: 'stamps',
  ready1: '🎁 Your reward is ready: {reward}', readyN: '🎁 {n} rewards ready: {reward}', remaining: '{n} {unit} to go for {reward}',
  cardTitle: '{shop} card', welcomeNew: 'Welcome {name}! This is your card 🎉', saveToWallet: 'Save it to your wallet for quick access.',
  gwOff: 'Saving to Google Wallet isn’t available yet. Show this page at the counter.', appleOff: 'Saving to Apple Wallet isn’t available yet. Show this page at the counter.',
  gwAlt: 'Add to Google Wallet',
  iosTip: '<b>On iPhone:</b> tap <b>Share ⬆️</b> then <b>“Add to Home Screen”</b>, and open the card from the icon: it opens faster and you can turn on notifications 🔔',
  showQr: 'Show the QR code at the counter with every order.', walletHint: 'Once saved in your wallet it sits next to your cards and pops up when you’re near the shop.',
  iosSide: ' On iPhone, double-press the side button to open it.',
  visits: 'Visits: {v} · Rewards redeemed: {r}', privacy: 'Privacy policy', deleteCard: 'Delete my card and data', powered: 'Loyalty cards by',
  deleteConfirm: 'Delete your card? Your points and history at this shop will be removed for good.',
  deleted: 'Your card and data were deleted. If it was saved in a wallet, it will stop working.',
  pushAsk: '🔔 Get a notification when you earn points or there’s an offer?', pushOn: 'Turn on notifications', pushIsOn: '🔔 Notifications on', pushTest: 'Send a test',
  pushOff: 'Turn off', pushDenied: '🔕 Notifications are blocked for this card. You can allow them in your phone settings.', pushEnabled: 'Notifications are on 🔔',
  pushFailed: 'Couldn’t turn on notifications', pushStopped: 'Notifications turned off',
  pushTestOk: '✅ A test notification is on its way. If you don’t see it, swipe down from the top of the screen.',
  pushTestBad: '❌ The notification couldn’t be delivered ({reason}). Take a screenshot and show it to the shop.', error: 'error',
  bdayToday: '🎂 Happy birthday, {name}! 🎉', boostNow: '⏰ Right now your points are ×{m} on every order!', boostUntil: '🎁 We missed you! Double points until {day}',
  tier: '{icon} Your level: {name}', tierMult: ' · points ×{m}', tierNext: '{n} more {visits} to reach {icon} {name}', visit1: 'visit', visitN: 'visits',
  thanks: 'Thank you 🙏', googleAsk: 'It would mean a lot if you left us a Google review ⭐', googleBtn: 'Review us on Google', feedbackSent: '{shop} got your feedback.',
  rateAsk: 'How was your visit today?', rateNote: 'What could be better? Only the owner will see this', send: 'Send',
  bdayAsk: '🎂 When is your birthday?', bdayGift: 'We’ll give you {gift} on your birthday 🎁', bdayGreet: 'So we can celebrate with you 🎉', day: 'Day', month: 'Month', save: 'Save',
  bdaySaved: 'Birthday saved 🎂',
  invite: '👥 Invite a friend', inviteHint: 'When they visit for the first time, you both get {n} {unit}.', inviteSend: 'Send invite', copyLink: 'Copy link', copied: 'Link copied ✅',
  inviteText: 'Join the {shop} loyalty card ☕ and we both get a gift on your first visit 🎁\n{url}',
  coupon: '🎟️ {title}', couponUntil: 'Until {day} · show your card at the counter',
  credit: '💳 Your balance: {amount} {cur}', creditHint: 'Pay with it at the counter',
  expires: '⏳ Your points are valid until {day}. Any visit renews them.',
  links: 'Follow us', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', whatsapp: 'WhatsApp', website: 'Website',
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  langSwitch: 'العربية',
  joinTitle: 'Join the loyalty card', joinPageTitle: 'Join the {shop} loyalty card', paused: 'This shop’s loyalty program is paused for now.', openMine: 'Open my card',
  haveCard: 'You already have a card here 👋', referred: '🎁 {name} invited you! You both get {n} {unit} on your first visit.',
  phone: 'Mobile number', phoneHint: 'So the cashier can find your card if you lose it.', bday: '🎂 Your birthday', optional: '(optional)',
  getCard: 'Get my card', walletNote: 'It saves to your phone wallet and pops up when you’re near {shop}.',
  consent: 'By joining you agree to the <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>. We only keep your name, number, points (and birthday if you add it), and you can delete them anytime.',
  loading: 'Loading…',
  menu: 'Menu', menuEmpty: 'The menu is empty for now.', menuJoin: '🎁 Earn points with every order and get {reward}', menuJoinBtn: 'Get the loyalty card', menuOpenCard: 'Open my card', menuPdf: 'Open the menu', menuPdfHint: 'Full menu (PDF)', sizeLabel: 'Size', seeMenu: '📋 See the menu',
  myCards: '💼 My cards', myCardsEmpty: 'No cards saved on this device yet. Open your card link once and it will show up here.', addCardLink: 'Paste a card link', addCard: 'Add', removeCard: 'Remove from here',
  myCardsHint: 'Add this page to your home screen to get one icon for all your cards.', allCards: '💼 All my cards',
  giftBtn: '🎁 Gift credit to a friend', giftAsk: 'How much do you want to gift? ({cur})', giftMade: 'Your gift is ready 🎁 Send the link to your friend', giftText: '🎁 I gifted you {amount} {cur} of credit at {shop}! Open the link to claim it:\n{url}',
  giftTitle: '🎁 {name} gifted you {amount} {cur}', giftAt: 'Credit at {shop} you can spend at the counter.', giftClaim: 'Claim it on my card', giftJoin: 'Get a card and claim the gift',
  giftClaimed: 'Gift claimed ✅', giftSend: 'Send the gift', giftGone: 'This gift was already claimed or has expired.',
};

export function t(key, vars = {}) {
  const dict = LANG === 'en' ? EN : AR;
  const s = dict[key] ?? AR[key] ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

export const fmtDate = (ms, opts = { dateStyle: 'medium' }) => new Intl.DateTimeFormat(LANG === 'en' ? 'en-GB' : 'ar-u-nu-latn', opts).format(new Date(ms));

// قاعدة البرنامج بالإنجليزي (القاعدة العربية بتيجي جاهزة من السيرفر)
export function ruleText(shop) {
  if (LANG !== 'en') return shop.rule;
  if (shop.programType === 'stamps') return `Collect ${shop.cost} stamps and get ${shop.rewardName}`;
  return `${shop.pointsPerUnit} point${shop.pointsPerUnit === 1 ? '' : 's'} per 1 ${shop.currency} · ${shop.cost} points = ${shop.rewardName}`;
}
