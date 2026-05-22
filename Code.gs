// ============================================================
//  PrintShop Pro — Google Apps Script Backend  (Code.gs)
//  FIXED v3 — All audit issues resolved
// ============================================================

// ── DEFAULT CONFIGURATION (fallbacks when Settings not saved) ─
const SS_ID       = '1pbXYLywtiwBSE1MOxLT87aLLpFidRnr_eqqsHmv-eqk';   // Google Sheets ID
const FOLDER_ID   = '1htIazpmdr51JmbzT4f9bfkMfZNKLc5yb';  // Google Drive Folder ID
const ADMIN_CREDS = { email: 'admin@printshop.com', password: 'Admin@123' };
const SHOP        = { name: 'PrintShop Pro', upiId: '7860981562@ybl' };
const PRICING     = { base:10, bwPerPage:1.5, colorPerPage:5, a3Multi:1.8, customMulti:2.0, urgentFee:50, deliveryFee:60 };
const MAX_FILE_MB = 10;

// ── DYNAMIC SETTINGS ──────────────────────────────────────────
// Reads from Script Properties at runtime; falls back to consts above.
// Admin can change these via the Settings page in the Admin panel.
function liveSettings() {
  try {
    const p = PropertiesService.getScriptProperties().getProperties();
    const num = (v, fb) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fb;
    };
    const int = (v, fb) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : fb;
    };
    return {
      shopName    : p.SHOP_NAME      || SHOP.name,
      upiId       : p.SHOP_UPI       || SHOP.upiId,
      shopEmail   : p.SHOP_EMAIL     || '',
      pricing: {
        base        : num(p.PRICE_BASE,     PRICING.base),
        bwPerPage   : num(p.PRICE_BW,       PRICING.bwPerPage),
        colorPerPage: num(p.PRICE_COLOR,    PRICING.colorPerPage),
        a3Multi     : num(p.PRICE_A3,       PRICING.a3Multi),
        customMulti : num(p.PRICE_CUSTOM,   PRICING.customMulti),
        urgentFee   : num(p.PRICE_URGENT,   PRICING.urgentFee),
        deliveryFee : num(p.PRICE_DELIVERY, PRICING.deliveryFee)
      },
      qrExpiryMin : int(p.QR_EXPIRY,    15),
      retryLimit  : int(p.RETRY_LIMIT,  3),
      autoApprove : int(p.AUTO_APPROVE, 80),
      needsReview : int(p.NEEDS_REVIEW, 50)
    };
  } catch(e) {
    return { shopName:SHOP.name, upiId:SHOP.upiId, shopEmail:'', pricing:PRICING,
             qrExpiryMin:15, retryLimit:3, autoApprove:80, needsReview:50 };
  }
}

// Called by Admin Settings page to load current values
function getShopSettings(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  return { ok:true, settings: liveSettings() };
}

// Called by Admin Settings page to save values
function saveShopSettings(cfg, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const p = PropertiesService.getScriptProperties();
    if (cfg.shopName)     p.setProperty('SHOP_NAME',      cfg.shopName.trim());
    if (cfg.upiId)        p.setProperty('SHOP_UPI',        cfg.upiId.trim());
    const pr = cfg.pricing || {};
    const num = (v, fb) => {
      const n = parseFloat(v);
      return String(Number.isFinite(n) ? n : fb);
    };
    if (pr.base         != null) p.setProperty('PRICE_BASE',     num(pr.base,        PRICING.base));
    if (pr.bwPerPage    != null) p.setProperty('PRICE_BW',       num(pr.bwPerPage,   PRICING.bwPerPage));
    if (pr.colorPerPage != null) p.setProperty('PRICE_COLOR',    num(pr.colorPerPage,PRICING.colorPerPage));
    if (pr.a3Multi      != null) p.setProperty('PRICE_A3',       num(pr.a3Multi,     PRICING.a3Multi));
    if (pr.customMulti  != null) p.setProperty('PRICE_CUSTOM',   num(pr.customMulti, PRICING.customMulti));
    if (pr.urgentFee    != null) p.setProperty('PRICE_URGENT',   num(pr.urgentFee,   PRICING.urgentFee));
    if (pr.deliveryFee  != null) p.setProperty('PRICE_DELIVERY', num(pr.deliveryFee, PRICING.deliveryFee));
    const int = (v, fb) => {
      const n = parseInt(v, 10);
      return String(Number.isFinite(n) ? n : fb);
    };
    if (cfg.qrExpiryMin != null) p.setProperty('QR_EXPIRY',    int(cfg.qrExpiryMin, 15));
    if (cfg.retryLimit  != null) p.setProperty('RETRY_LIMIT',  int(cfg.retryLimit,  3));
    if (cfg.autoApprove != null) p.setProperty('AUTO_APPROVE', int(cfg.autoApprove, 80));
    if (cfg.needsReview != null) p.setProperty('NEEDS_REVIEW', int(cfg.needsReview, 50));
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

// Public endpoint — frontend uses this to sync pricing before rendering summary
function getPublicPricing() {
  const s = liveSettings();
  return { ok:true, pricing:s.pricing, shopName:s.shopName };
}


// ── SHOP STATUS (Open / Temporarily Closed) ───────────────────
function getShopInfo() {
  // Public — called by home.html and user pages
  const p  = PropertiesService.getScriptProperties().getProperties();
  const s  = liveSettings();
  let socialLinks = {};
  try { socialLinks = JSON.parse(p.SHOP_SOCIAL || '{}'); } catch(e) { socialLinks = {}; }
  return {
    ok          : true,
    isOpen      : p.SHOP_IS_OPEN !== 'false',
    closedMsg   : p.SHOP_CLOSED_MSG || 'We are temporarily closed. Please check back soon.',
    shopName    : s.shopName,
    upiId       : s.upiId,
    address     : p.SHOP_ADDRESS  || '',
    phone       : p.SHOP_PHONE    || '',
    email       : p.SHOP_EMAIL    || '',
    hours       : p.SHOP_HOURS    || '',
    tagline     : p.SHOP_TAGLINE  || 'Professional Printing Services',
    logo        : p.SHOP_LOGO     || '🖨️',
    socialLinks
  };
}

function setShopStatus(isOpen, closedMsg, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const p = PropertiesService.getScriptProperties();
  p.setProperty('SHOP_IS_OPEN', isOpen ? 'true' : 'false');
  if (closedMsg) p.setProperty('SHOP_CLOSED_MSG', closedMsg.trim());
  return { ok:true };
}

function saveShopInfo(info, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const p = PropertiesService.getScriptProperties();
  if (info.address  != null) p.setProperty('SHOP_ADDRESS',  info.address.trim());
  if (info.phone    != null) p.setProperty('SHOP_PHONE',    info.phone.trim());
  if (info.email    != null) p.setProperty('SHOP_EMAIL',    info.email.trim());
  if (info.hours    != null) p.setProperty('SHOP_HOURS',    info.hours.trim());
  if (info.tagline  != null) p.setProperty('SHOP_TAGLINE',  info.tagline.trim());
  if (info.logo     != null) p.setProperty('SHOP_LOGO',     info.logo.trim());
  if (info.social   != null) p.setProperty('SHOP_SOCIAL',   JSON.stringify(info.social));
  return { ok:true };
}

// ── PAPER CONFIGURATION ───────────────────────────────────────
// Admin configures paper types (GSM, sizes, price per sheet).
// getPublicPaperConfig is called by user pages to calculate paper cost.

const DEFAULT_PAPER_CONFIG = {
  paperTypes: [
    { id:'p70bond',  name:'Bond Paper 70gsm',     gsm:70,  prices:{ A4:1.5,  A3:3.0,  A5:0.8,  Letter:1.5 }, active:true },
    { id:'p80bond',  name:'Bond Paper 80gsm',     gsm:80,  prices:{ A4:1.8,  A3:3.5,  A5:0.9,  Letter:1.8 }, active:true },
    { id:'p90off',   name:'Offset Paper 90gsm',   gsm:90,  prices:{ A4:2.2,  A3:4.2,  A5:1.1,  Letter:2.2 }, active:true },
    { id:'p120gloss',name:'Glossy Paper 120gsm',  gsm:120, prices:{ A4:4.0,  A3:7.5,  A5:2.0,  Letter:4.0 }, active:true },
    { id:'p200photo',name:'Photo Paper 200gsm',   gsm:200, prices:{ A4:8.0,  A3:15.0, A5:4.0              }, active:true }
  ],
  inkCost: { bw: 1.0, color: 4.0 },
  defaultPaperId: 'p70bond'
};

function getPublicPaperConfig() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('PAPER_CONFIG');
    const cfg = raw ? JSON.parse(raw) : DEFAULT_PAPER_CONFIG;
    return { ok:true, config:cfg };
  } catch(e) { return { ok:true, config:DEFAULT_PAPER_CONFIG }; }
}

function savePaperConfig(config, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    PropertiesService.getScriptProperties().setProperty('PAPER_CONFIG', JSON.stringify(config));
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

// Paper-aware price calculation (replaces simple per-page model when paper config is set)
function calcPriceWithPaper(pages, colorType, size, qty, paperId, urgent, delivery) {
  const cfg     = getPublicPaperConfig().config;
  const paper   = cfg.paperTypes.find(p => p.id === paperId && p.active) ||
                  cfg.paperTypes.find(p => p.active) ||
                  cfg.paperTypes[0];
  const paperCost = paper && paper.prices[size] ? parseFloat(paper.prices[size]) : 2.0;
  const inkCost   = colorType === 'color'
                    ? parseFloat(cfg.inkCost.color || 4.0)
                    : parseFloat(cfg.inkCost.bw    || 1.0);
  const p   = Math.max(1, parseInt(pages)||1);
  const q   = Math.max(1, parseInt(qty)  ||1);
  const lv  = liveSettings();
  const urg = urgent              ? parseFloat(lv.pricing.urgentFee)   : 0;
  const del = delivery==='delivery' ? parseFloat(lv.pricing.deliveryFee) : 0;
  const printCost = Math.round((paperCost + inkCost) * p * q * 100) / 100;
  const total     = Math.round((lv.pricing.base + printCost + urg + del) * 100) / 100;
  return {
    ok:true, base:lv.pricing.base, paperCost, inkCost, printCost,
    urgentFee:urg, deliveryFee:del, total,
    paperName : paper ? paper.name : 'Standard',
    breakdown : `${p}pg × ${q}copy × (₹${paperCost} paper + ₹${inkCost} ink) = ₹${printCost}`
  };
}

// ── QUOTE REQUESTS (Poster / Banner / Flex / Advanced Print) ──
function setupQuoteSheet() {
  const sp = SpreadsheetApp.openById(SS_ID);
  const s  = sp.getSheetByName('QuoteRequests') || sp.insertSheet('QuoteRequests');
  if (s.getLastRow() === 0)
    s.appendRow(['quote_id','user_id','user_name','user_email','user_phone',
                 'service_type','width_cm','height_cm','quantity',
                 'material','design_type','details','status',
                 'admin_notes','quoted_price','requested_at','contacted_at']);
  return s;
}

function createQuoteRequest(d, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const user = getData('Users').find(u => String(u.user_id) === String(userId));
    if (!user) return { ok:false, err:'User not found' };
    const id  = uid('QRQ'), now = new Date().toISOString(), s = liveSettings();
    setupQuoteSheet();
    append('QuoteRequests', [
      id, userId, user.name, user.email, user.phone,
      d.serviceType||'Poster', d.width||'', d.height||'', parseInt(d.quantity)||1,
      d.material||'', d.designType||'self', d.details||'', 'Pending',
      '', '', now, ''
    ]);
    try {
      MailApp.sendEmail({ to:s.shopEmail || ADMIN_CREDS.email || user.email,
        subject:`New Quote Request — ${id} | ${s.shopName}`,
        htmlBody:`<p>New quote request from <b>${user.name}</b> (${user.email}, ${user.phone}).</p>
        <p><b>Type:</b> ${d.serviceType} &nbsp; <b>Size:</b> ${d.width}×${d.height}cm &nbsp; <b>Qty:</b> ${d.quantity}</p>
        <p><b>Material:</b> ${d.material} &nbsp; <b>Design:</b> ${d.designType}</p>
        <p><b>Details:</b> ${d.details}</p>` });
    } catch(e) {}
    return { ok:true, quoteId:id, msg:'Quote request submitted! Our team will contact you within 24 hours.' };
  } catch(e) { return { ok:false, err:e.message }; }
}

function getUserQuoteRequests(userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    setupQuoteSheet();
    const quotes = getData('QuoteRequests')
      .filter(q => String(q.user_id) === String(userId))
      .sort((a,b) => new Date(b.requested_at) - new Date(a.requested_at));
    return { ok:true, quotes };
  } catch(e) { return { ok:false, err:e.message }; }
}

function adminGetQuoteRequests(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    setupQuoteSheet();
    return { ok:true, quotes: getData('QuoteRequests').sort((a,b) => new Date(b.requested_at) - new Date(a.requested_at)) };
  } catch(e) { return { ok:false, err:e.message }; }
}

function adminUpdateQuote(quoteId, status, adminNotes, quotedPrice, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri = findRow('QuoteRequests', 0, quoteId);
  if (ri < 0) return { ok:false, err:'Quote not found' };
  setCell('QuoteRequests', ri, 13, status);
  setCell('QuoteRequests', ri, 14, adminNotes||'');
  setCell('QuoteRequests', ri, 15, quotedPrice||'');
  setCell('QuoteRequests', ri, 17, new Date().toISOString());
  try {
    const q = getData('QuoteRequests').find(x => String(x.quote_id) === String(quoteId));
    if (q && q.user_email) {
      const s = liveSettings();
      MailApp.sendEmail({ to:q.user_email,
        subject:`Your Quote Request Update — ${quoteId} | ${s.shopName}`,
        htmlBody:`<p>Hi <b>${q.user_name}</b>,</p>
        <p>Status: <b>${status}</b></p>
        ${quotedPrice ? `<p>Quoted Price: <b>₹${quotedPrice}</b></p>` : ''}
        ${adminNotes  ? `<p>Note: ${adminNotes}</p>` : ''}
        <p>— ${s.shopName} Team</p>` });
    }
  } catch(e) {}
  return { ok:true };
}

// ── ADVANCED POSTER/BANNER PRICING (admin-configured fixed rates) ─
function getPosterPricing() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('POSTER_PRICING');
    const def = {
      materials: [
        { id:'vinyl', name:'Vinyl Flex',        pricePerSqFt:12, minSqFt:4  },
        { id:'gloss', name:'Glossy Paper Print', pricePerSqFt:8,  minSqFt:1  },
        { id:'matte', name:'Matte Paper Print',  pricePerSqFt:7,  minSqFt:1  },
        { id:'canvas',name:'Canvas Print',       pricePerSqFt:25, minSqFt:2  },
        { id:'foam',  name:'Foam Board',         pricePerSqFt:30, minSqFt:1  }
      ],
      designCost: 250,
      note: 'Final price confirmed by admin after review. Advance booking required.'
    };
    return { ok:true, pricing: raw ? JSON.parse(raw) : def };
  } catch(e) { return { ok:false, err:e.message }; }
}

function savePosterPricing(pricing, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    PropertiesService.getScriptProperties().setProperty('POSTER_PRICING', JSON.stringify(pricing));
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}
// ── REST API ROUTER ─────────────────────────────────────────────
// Frontend hosted on Vercel → POST { action, args } → returns JSON

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'ping') return _respond({ ok:true, msg:'PrintShop Pro API v3 — online' });
  return _respond({ ok:true, service:'PrintShop Pro API', version:'3.0',
    note:'Use POST with { action, args } to call functions.' });
}

function doPost(e) {
  let result;
  try {
    if (!e.postData || !e.postData.contents) throw new Error('Empty request body');
    const body   = JSON.parse(e.postData.contents);
    const action = String(body.action || '');
    const args   = Array.isArray(body.args) ? body.args : [];

    const FN_MAP = {
      // Auth
      loginUser, registerUser, adminLogin,
      // User
      getUserOrders, createOrder, reorderItem,
      // Files — uploadPrintFile only (uploadScreenshot is internal, called by submitSmartPayment)
      uploadPrintFile,
      // Pricing & Settings
      getPublicPricing, getShopSettings, saveShopSettings,
      // Admin — Orders
      adminGetStats, adminGetAllOrders, adminUpdateStatus,
      // Catalog — Services
      getServicesData, addServiceData, updateServiceData, deleteServiceData,
      // Catalog — Products
      getProductsData, addProductData, updateProductData, deleteProductData,
      // Payments (PaymentSystem.gs)
      initPaymentSession, regeneratePaymentQR, submitSmartPayment,
      getPaymentStatus, adminGetPaymentLedger,
      checkSessionExpiry,
      adminApprovePayment, adminRejectSmartPayment, adminGetFraudLog,
      // Admin session management
      refreshAdminSession,
      // Shop status & info
      getShopInfo, setShopStatus, saveShopInfo,
      // Paper configuration
      getPublicPaperConfig, savePaperConfig, calcPriceWithPaper,
      // Quote requests (poster/banner)
      createQuoteRequest, getUserQuoteRequests, adminGetQuoteRequests, adminUpdateQuote,
      // Poster pricing
      getPosterPricing, savePosterPricing
    };

    const fn = FN_MAP[action];
    result = fn ? fn(...args) : { ok:false, err:'Unknown action: ' + action };
  } catch(err) {
    result = { ok:false, err:err.message };
  }
  return _respond(result);
}

function _respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function ss()  { return SpreadsheetApp.openById(SS_ID); }
function sh(n) {
  const s = ss().getSheetByName(n);
  if (!s) throw new Error('Sheet "' + n + '" not found. Run fullSystemSetup() first.');
  return s;
}
function getData(name) {
  try {
    const s = ss().getSheetByName(name); if (!s) return [];
    const raw = s.getDataRange().getValues(); if (raw.length <= 1) return [];
    const hdr = raw[0];
    return raw.slice(1).map(r =>
      Object.fromEntries(hdr.map((k, i) => [String(k).trim(), r[i] === null ? '' : r[i]]))
    );
  } catch(e) { Logger.log('getData error for ' + name + ': ' + e); return []; }
}
function append(name, row)      { sh(name).appendRow(row); }
function setCell(name, r, c, v) { sh(name).getRange(r, c).setValue(v); }
function findRow(name, colIdx, val) {
  try {
    const vals = sh(name).getDataRange().getValues();
    for (let i = 1; i < vals.length; i++)
      if (String(vals[i][colIdx]).trim() === String(val).trim()) return i + 1;
  } catch(e) {}
  return -1;
}
function uid(pfx) {
  return pfx + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7).toUpperCase();
}
function sha256(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

// ── ONE-TIME SETUP ────────────────────────────────────────────
function setupSheets() {
  const sp = ss();
  [
    ['Users',    ['user_id','name','email','password','phone','created_at','session_token','token_expiry']],
    ['Orders',   ['order_id','user_id','user_email','file_url','file_name','pages','color_type',
                  'size','quantity','urgent','delivery_type','address','base_price','total_price',
                  'status','payment_status','notes','created_at','paper_id','paper_name']],
    ['Services', ['service_id','name','description','base_price','bw_per_page','color_per_page','active','created_at']],
    ['Products', ['product_id','name','description','price','stock','active','created_at']]
  ].forEach(([name, headers]) => {
    const s = sp.getSheetByName(name) || sp.insertSheet(name);
    if (s.getLastRow() === 0) {
      s.appendRow(headers);
    } else {
      const existing = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0].map(String);
      headers.forEach(h => {
        if (!existing.includes(h)) {
          s.getRange(1, s.getLastColumn() + 1).setValue(h);
          existing.push(h);
        }
      });
    }
  });
  const svc = sp.getSheetByName('Services');
  if (svc.getLastRow() <= 1)
    svc.appendRow([uid('SVC'),'Standard Printing','B&W and Color printing',10,1.5,5,true,new Date().toISOString()]);
  return '✅ Base sheets ready!';
}

function ensureOrderPaperColumns() {
  const s = sh('Orders');
  const headers = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0].map(String);
  ['paper_id','paper_name'].forEach(h => {
    if (!headers.includes(h)) {
      s.getRange(1, s.getLastColumn() + 1).setValue(h);
      headers.push(h);
    }
  });
}

function fullSystemSetup() {
  setupSheets();
  setupPaymentSheets(); // defined in PaymentSystem.gs
  setupQuoteSheet();
  return '✅ All sheets created!';
}

// ── AUTH ──────────────────────────────────────────────────────
function registerUser(name, email, password, phone) {
  try {
    if (!name || !email || !password || !phone) return { ok:false, err:'All fields required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok:false, err:'Invalid email address' };
    if (password.length < 6) return { ok:false, err:'Password must be at least 6 characters' };
    if (!/^\d{10}$/.test(phone.trim())) return { ok:false, err:'Enter a valid 10-digit phone number' };
    const users = getData('Users');
    if (users.find(u => String(u.email).toLowerCase() === email.toLowerCase().trim()))
      return { ok:false, err:'Email already registered' };
    const id = uid('USR'), now = new Date().toISOString(), s = liveSettings();
    append('Users', [id, name.trim(), email.toLowerCase().trim(), sha256(password), phone.trim(), now, '', '']);
    try { MailApp.sendEmail({ to:email, subject:`Welcome to ${s.shopName}!`,
      htmlBody:`<p>Hi <b>${name}</b>,</p><p>Welcome to <b>${s.shopName}</b>! Your account is ready.</p>` }); } catch(e) {}
    return { ok:true, msg:'Registration successful! Please login.' };
  } catch(e) { return { ok:false, err:e.message }; }
}

function loginUser(email, password) {
  try {
    if (!email || !password) return { ok:false, err:'Email and password required' };
    const users = getData('Users'), hashed = sha256(password);
    const u = users.find(x =>
      String(x.email).toLowerCase().trim() === email.toLowerCase().trim() &&
      String(x.password).trim() === hashed
    );
    if (!u) return { ok:false, err:'Invalid email or password' };
    const token = Utilities.getUuid(), expiry = new Date(Date.now() + 86400000).toISOString();
    const ri = findRow('Users', 0, u.user_id);
    if (ri > 0) { setCell('Users', ri, 7, token); setCell('Users', ri, 8, expiry); }
    return { ok:true, user:{ id:u.user_id, name:u.name, email:u.email, phone:u.phone }, token };
  } catch(e) { return { ok:false, err:e.message }; }
}

const ADMIN_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

function adminLogin(email, password) {
  if (email === ADMIN_CREDS.email && password === ADMIN_CREDS.password) {
    const t      = Utilities.getUuid();
    const expiry = new Date(Date.now() + ADMIN_SESSION_MS).toISOString();
    PropertiesService.getScriptProperties().setProperty('AT_' + t, expiry);
    return { ok:true, token:t, expiresAt:expiry };
  }
  return { ok:false, err:'Invalid admin credentials' };
}

// Extend admin session by 4 more hours (called from frontend "Extend Session" button)
function refreshAdminSession(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Session expired or invalid' };
  const expiry = new Date(Date.now() + ADMIN_SESSION_MS).toISOString();
  PropertiesService.getScriptProperties().setProperty('AT_' + token, expiry);
  return { ok:true, expiresAt:expiry };
}

function checkUserSession(userId, token) {
  if (!userId || !token) return false;
  const u = getData('Users').find(x =>
    String(x.user_id).trim() === String(userId).trim() &&
    String(x.session_token).trim() === String(token).trim()
  );
  return !!(u && new Date(u.token_expiry) > new Date());
}

function checkAdminSession(token) {
  if (!token) return false;
  const p = PropertiesService.getScriptProperties(), exp = p.getProperty('AT_' + token);
  if (!exp) return false;
  if (new Date(exp) < new Date()) { p.deleteProperty('AT_' + token); return false; }
  return true;
}

// ── FILE UPLOAD ───────────────────────────────────────────────
function uploadPrintFile(b64, name, mime, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired. Please login again.' };
  try {
    if (!['application/pdf','image/jpeg','image/png','image/jpg'].includes(mime))
      return { ok:false, err:'Only PDF, JPG, PNG files allowed' };
    if (!b64) return { ok:false, err:'No file data received' };
    const bytes = Utilities.base64Decode(b64), sizeMB = bytes.length / 1048576;
    if (sizeMB > MAX_FILE_MB) return { ok:false, err:`File too large (max ${MAX_FILE_MB} MB)` };
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file   = folder.createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok:true, fileId:file.getId(),
      fileUrl: file.getDownloadUrl(),
      viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      name, sizeMB: Math.round(sizeMB * 100) / 100 };
  } catch(e) { return { ok:false, err:e.message }; }
}

function uploadScreenshot(b64, name, mime, orderId) {
  try {
    if (!b64) return { ok:false, err:'Empty screenshot data' };
    if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(mime))
      return { ok:false, err:'Only JPG, PNG, or WEBP screenshots allowed' };
    const bytes = Utilities.base64Decode(b64), sizeMB = bytes.length / 1048576;
    if (sizeMB > 5) return { ok:false, err:'Screenshot too large (max 5 MB)' };
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file   = folder.createFile(
      Utilities.newBlob(bytes, mime, 'pay_' + orderId + '_' + name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok:true, url:'https://drive.google.com/file/d/' + file.getId() + '/view' };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── PRICING ENGINE ────────────────────────────────────────────
function calcPrice(pages, colorType, size, qty, urgent, delivery) {
  const pr = liveSettings().pricing;
  const p = Math.max(1, parseInt(pages)||1), q = Math.max(1, parseInt(qty)||1);
  const pp = colorType === 'color' ? pr.colorPerPage : pr.bwPerPage;
  let print = pr.base + p * pp * q;
  if (size === 'A3')     print *= pr.a3Multi;
  if (size === 'Custom') print *= pr.customMulti;
  const urgentFee   = urgent             ? pr.urgentFee   : 0;
  const deliveryFee = delivery==='delivery' ? pr.deliveryFee : 0;
  const total = Math.round((print + urgentFee + deliveryFee) * 100) / 100;
  return { base:pr.base, printCost:Math.round(p*pp*q*100)/100, urgentFee, deliveryFee, total,
    breakdown:`${p} pg × ₹${pp} × ${q} copy = ₹${Math.round(p*pp*q*100)/100}` };
}

// ── ORDERS ────────────────────────────────────────────────────
function createOrder(d, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired. Please login again.' };
  try {
    const user = getData('Users').find(u => String(u.user_id) === String(userId));
    if (!user) return { ok:false, err:'User account not found' };
    // FIXED: validate file is uploaded before order can be created
    if (!d.fileUrl || !String(d.fileUrl).trim())
      return { ok:false, err:'Please upload your print file before placing an order.' };
    if (d.delivery === 'delivery' && (!d.address || !d.address.trim()))
      return { ok:false, err:'Delivery address is required for home delivery' };
    ensureOrderPaperColumns();
    const id = uid('ORD');
    const price = d.paperId
      ? calcPriceWithPaper(d.pages, d.colorType, d.size, d.qty, d.paperId, d.urgent, d.delivery)
      : calcPrice(d.pages, d.colorType, d.size, d.qty, d.urgent, d.delivery);
    const paperId = d.paperId || '';
    const paperName = price.paperName || '';
    const now = new Date().toISOString(), s = liveSettings();
    append('Orders', [
      id, userId, user.email, d.fileUrl||'', d.fileName||'',
      parseInt(d.pages)||1, d.colorType||'bw', d.size||'A4', parseInt(d.qty)||1,
      d.urgent?'Yes':'No', d.delivery||'pickup', d.address?d.address.trim():'',
      price.base, price.total, 'Pending Payment', 'Unpaid', d.notes?d.notes.trim():'', now,
      paperId, paperName
    ]);
    try { MailApp.sendEmail({ to:user.email,
      subject:`Order Placed — ${id} | ${s.shopName}`,
      htmlBody:_orderEmailHtml(user.name, id, price.total, 'Pending Payment', s.shopName) }); } catch(e) {}
    return { ok:true, orderId:id, price };
  } catch(e) { return { ok:false, err:e.message }; }
}

function getUserOrders(userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const orders = getData('Orders')
      .filter(o => String(o.user_id) === String(userId))
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const ledger = getData('PaymentLedger');
    return { ok:true, orders: orders.map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }))};
  } catch(e) { return { ok:false, err:e.message }; }
}

function reorderItem(orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  const o = getData('Orders').find(x =>
    String(x.order_id) === String(orderId) && String(x.user_id) === String(userId));
  if (!o) return { ok:false, err:'Order not found' };
  return { ok:true, data:{ fileUrl:o.file_url, fileName:o.file_name, pages:o.pages,
    colorType:o.color_type, size:o.size, paperId:o.paper_id || '', paperName:o.paper_name || '', qty:o.quantity,
    urgent:o.urgent==='Yes', delivery:o.delivery_type, address:o.address }};
}

// ── ADMIN — ORDERS ────────────────────────────────────────────
function adminGetAllOrders(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const orders = getData('Orders').sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const ledger = getData('PaymentLedger');
    return { ok:true, orders: orders.map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }))};
  } catch(e) { return { ok:false, err:e.message }; }
}

function adminUpdateStatus(orderId, status, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri = findRow('Orders', 0, orderId);
  if (ri < 0) return { ok:false, err:'Order not found' };
  setCell('Orders', ri, 15, status);
  try {
    const o = getData('Orders').find(x => String(x.order_id) === String(orderId));
    const s = liveSettings();
    if (o && o.user_email && ['Ready','Delivered','Accepted'].includes(status))
      MailApp.sendEmail({ to:o.user_email,
        subject:`Your Order is ${status} — ${orderId} | ${s.shopName}`,
        htmlBody:_orderEmailHtml('Customer', orderId, o.total_price, status, s.shopName) });
  } catch(e) {}
  return { ok:true };
}

// FIXED: Recent orders now joined with PaymentLedger so score shows in dashboard
function adminGetStats(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const orders = getData('Orders'), ledger = getData('PaymentLedger');
    const today  = new Date().toDateString();
    const statusList = ['Pending Payment','Pending Verification','Accepted','Printing','Ready','Delivered','Payment Rejected','Payment Expired'];
    const sortedOrders = [...orders].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const recent = sortedOrders.slice(0,8).map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }));
    return { ok:true, stats:{
      total    : orders.length,
      pending  : ledger.filter(p => String(p.admin_status) === 'Pending').length,
      completed: orders.filter(o => String(o.status) === 'Delivered').length,
      revenue  : Math.round(orders
        .filter(o => new Date(o.created_at).toDateString() === today && String(o.payment_status) === 'Paid')
        .reduce((s,o) => s + parseFloat(o.total_price||0), 0) * 100) / 100,
      byStatus : statusList.reduce((a,s) => { a[s]=orders.filter(o=>String(o.status)===s).length; return a; }, {}),
      recent
    }};
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── ADMIN — SERVICES CRUD ─────────────────────────────────────
function getServicesData() {
  try { return { ok:true, services:getData('Services') }; } catch(e) { return { ok:false, err:e.message }; }
}
function addServiceData(n,d,b,bw,col,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  if (!n||!n.trim()) return { ok:false, err:'Name required' };
  const id=uid('SVC'); append('Services',[id,n.trim(),d||'',parseFloat(b)||0,parseFloat(bw)||0,parseFloat(col)||0,true,new Date().toISOString()]); return { ok:true, id };
}
function updateServiceData(id,n,d,b,bw,col,active,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Services',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Services').getRange(ri,2,1,6).setValues([[n,d,parseFloat(b)||0,parseFloat(bw)||0,parseFloat(col)||0,active]]); return { ok:true };
}
function deleteServiceData(id,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Services',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Services').deleteRow(ri); return { ok:true };
}

// ── ADMIN — PRODUCTS CRUD ─────────────────────────────────────
function getProductsData() {
  try { return { ok:true, products:getData('Products') }; } catch(e) { return { ok:false, err:e.message }; }
}
function addProductData(n,d,p,s,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  if (!n||!n.trim()) return { ok:false, err:'Name required' };
  const id=uid('PRD'); append('Products',[id,n.trim(),d||'',parseFloat(p)||0,parseInt(s)||0,true,new Date().toISOString()]); return { ok:true, id };
}
function updateProductData(id,n,d,p,s,active,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Products',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Products').getRange(ri,2,1,5).setValues([[n,d,parseFloat(p)||0,parseInt(s)||0,active]]); return { ok:true };
}
function deleteProductData(id,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Products',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Products').deleteRow(ri); return { ok:true };
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────
function _orderEmailHtml(name, id, total, status, shopName) {
  const sn = shopName || liveSettings().shopName;
  const c = {'Pending Payment':'#f59e0b','Accepted':'#2563eb','Printing':'#7c3aed',
    'Ready':'#16a34a','Delivered':'#065f46','Payment Rejected':'#dc2626','Payment Expired':'#6b7280'}[status]||'#374151';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
<div style="background:#2563eb;color:#fff;padding:28px;text-align:center"><h2 style="margin:0">🖨️ ${sn}</h2></div>
<div style="padding:28px;background:#f9fafb"><h3>Hello ${name}!</h3>
<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Order ID</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:600">${id}</td></tr>
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Amount</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:600">₹${total}</td></tr>
<tr><td style="padding:11px 16px;color:#6b7280">Status</td><td style="padding:11px 16px;font-weight:700;color:${c}">${status}</td></tr>
</table><p style="margin-top:24px;color:#6b7280;font-size:13px">Thank you for choosing <b>${sn}</b>! 🎉</p></div></div>`;
}
