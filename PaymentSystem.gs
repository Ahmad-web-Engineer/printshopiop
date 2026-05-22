// ============================================================
//  PrintShop Pro — Smart Payment System  (PaymentSystem.gs)
//  FIXED v3 — All audit issues resolved
//  All helpers (ss, sh, getData, append, setCell, findRow,
//  uid, checkUserSession, checkAdminSession, uploadScreenshot,
//  liveSettings) are defined in Code.gs — do NOT redefine.
// ============================================================

// Scoring weights (static — not admin-configurable)
const SCORING = { amountMatch:40, upiRefLen:30, noteConfirm:20, screenshot:10 };

// ── ONE-TIME SETUP ─────────────────────────────────────────
function setupPaymentSheets() {
  const sp = SpreadsheetApp.openById(SS_ID);
  [
    ['PaymentSessions', [
      'session_id','order_id','user_id','amount','upi_link',
      'qr_created_at','qr_expires_at','attempts','status','last_attempt_at'
    ]],
    ['PaymentLedger', [
      'payment_id','session_id','order_id','user_id',
      'upi_ref','entered_amount','screenshot_url',
      'note_confirmed','score','score_breakdown',
      'auto_status','admin_status','fraud_flags',
      'submitted_at','reviewed_at','reviewed_by'
    ]],
    ['FraudLog', ['log_id','order_id','user_id','upi_ref','reason','ip_hint','created_at']]
  ].forEach(([name, headers]) => {
    const s = sp.getSheetByName(name) || sp.insertSheet(name);
    if (s.getLastRow() === 0) s.appendRow(headers);
  });
  Logger.log('✅ Payment sheets ready!');
  return '✅ Payment sheets ready!';
}

// ── INIT / RESUME SESSION ──────────────────────────────────
function initPaymentSession(orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired. Please login again.' };
  try {
    const cfg    = liveSettings();
    const orders = getData('Orders');
    const order  = orders.find(o =>
      String(o.order_id).trim() === String(orderId).trim() &&
      String(o.user_id).trim()  === String(userId).trim()
    );
    if (!order) return { ok:false, err:'Order not found. Please go back and try again.' };
    if (String(order.payment_status) === 'Paid') return { ok:false, err:'This order is already paid.' };

    // Check for existing active session
    const sessions = getData('PaymentSessions');
    const existing = sessions.find(s =>
      String(s.order_id).trim() === String(orderId).trim() &&
      String(s.status).trim()   === 'Active'
    );
    if (existing) {
      const expiry = new Date(existing.qr_expires_at);
      if (expiry > new Date()) return _buildSessionResponse(existing, order, cfg);
      // Expired — mark it
      const ri = findRow('PaymentSessions', 0, existing.session_id);
      if (ri > 0) setCell('PaymentSessions', ri, 9, 'Expired');
      _safeSetOrderStatus(orderId, 'Payment Expired', null);
    }

    // FIXED: Retry limit counts PaymentLedger rows (actual submissions),
    // NOT PaymentSession rows (which also count QR regenerations).
    // This prevents legit users from getting locked out by regenerating QR.
    const ledger   = getData('PaymentLedger');
    const attempts = ledger.filter(p =>
      String(p.order_id).trim() === String(orderId).trim() &&
      String(p.user_id).trim()  === String(userId).trim()
    ).length;
    if (attempts >= cfg.retryLimit)
      return { ok:false, err:`Maximum payment attempts (${cfg.retryLimit}) reached. Contact support.`, locked:true };

    // Create new session using live settings
    const sessionId = uid('PSN');
    const now       = new Date();
    const expiry    = new Date(now.getTime() + cfg.qrExpiryMin * 60000);
    const amount    = parseFloat(order.total_price) || 0;
    const upiLink   = `upi://pay?pa=${encodeURIComponent(cfg.upiId)}&pn=${encodeURIComponent(cfg.shopName)}&am=${amount}&tn=${encodeURIComponent(orderId)}&cu=INR`;

    append('PaymentSessions', [
      sessionId, orderId, userId, amount, upiLink,
      now.toISOString(), expiry.toISOString(), 0, 'Active', ''
    ]);
    _safeSetOrderStatus(orderId, 'Pending Payment', null);

    return _buildSessionResponse({
      session_id:sessionId, order_id:orderId, user_id:userId,
      amount, upi_link:upiLink,
      qr_created_at:now.toISOString(), qr_expires_at:expiry.toISOString(),
      attempts:0, status:'Active'
    }, order, cfg);
  } catch(e) { return { ok:false, err:e.message }; }
}

function _buildSessionResponse(session, order, cfg) {
  const s = cfg || liveSettings();
  return {
    ok        : true,
    sessionId : String(session.session_id),
    orderId   : String(session.order_id),
    amount    : parseFloat(session.amount) || 0,
    upiLink   : String(session.upi_link),
    upiId     : s.upiId,
    shopName  : s.shopName,
    expiresAt : String(session.qr_expires_at),
    createdAt : String(session.qr_created_at),
    expiryMins: s.qrExpiryMin,
    orderData : {
      pages:order.pages, colorType:order.color_type,
      size:order.size,   quantity:order.quantity,
      urgent:order.urgent, deliveryType:order.delivery_type
    }
  };
}

// Helper — safely update order status and/or payment_status
function _safeSetOrderStatus(orderId, status, payStatus) {
  const oi = findRow('Orders', 0, orderId);
  if (oi > 0) {
    if (status    !== null) setCell('Orders', oi, 15, status);
    if (payStatus !== null) setCell('Orders', oi, 16, payStatus);
  }
}

// ── REGENERATE QR ──────────────────────────────────────────
function regeneratePaymentQR(orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    // Expire all currently active sessions for this order
    const sessions = getData('PaymentSessions');
    sessions
      .filter(s => String(s.order_id).trim() === String(orderId).trim() && String(s.status).trim() === 'Active')
      .forEach(s => {
        const ri = findRow('PaymentSessions', 0, s.session_id);
        if (ri > 0) setCell('PaymentSessions', ri, 9, 'Expired');
      });
    // FIXED: initPaymentSession now counts PaymentLedger rows for the limit,
    // so QR regeneration without payment won't burn the retry limit.
    return initPaymentSession(orderId, userId, token);
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── SMART SCORING ENGINE ───────────────────────────────────
function _scorePayment(payload) {
  const { enteredAmount, orderAmount, upiRef, noteConfirmed, hasScreenshot } = payload;
  let score = 0;
  const breakdown = [], flags = [];

  const amtMatch = Math.abs(parseFloat(enteredAmount||0) - parseFloat(orderAmount||0)) < 0.01;
  if (amtMatch) { score += SCORING.amountMatch; breakdown.push(`Amount match: +${SCORING.amountMatch}`); }
  else { flags.push(`AMOUNT_MISMATCH: entered ₹${enteredAmount}, expected ₹${orderAmount}`); breakdown.push('Amount mismatch: +0'); }

  const refLen = String(upiRef||'').trim().length;
  if (refLen >= 12) { score += SCORING.upiRefLen; breakdown.push(`UPI ref length (${refLen} chars): +${SCORING.upiRefLen}`); }
  else { flags.push(`SHORT_UPI_REF: length ${refLen}`); breakdown.push(`UPI ref short (${refLen} chars): +0`); }

  if (noteConfirmed) { score += SCORING.noteConfirm; breakdown.push(`Note confirmed: +${SCORING.noteConfirm}`); }
  else { flags.push('NOTE_NOT_CONFIRMED'); breakdown.push('Note not confirmed: +0'); }

  if (hasScreenshot) { score += SCORING.screenshot; breakdown.push(`Screenshot uploaded: +${SCORING.screenshot}`); }
  else { breakdown.push('No screenshot: +0'); }

  const cfg = liveSettings();
  const autoStatus = score >= cfg.autoApprove ? 'Auto Approved'
                   : score >= cfg.needsReview  ? 'Needs Review'
                   : 'Auto Rejected';
  return { score, breakdown:breakdown.join(' | '), autoStatus, flags:flags.join(', '), amtMatch };
}

// ── SUBMIT PAYMENT (SMART) ─────────────────────────────────
function submitSmartPayment(payload, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const { sessionId, orderId, upiRef, enteredAmount,
            noteConfirmed, screenshotB64, screenshotName, screenshotMime } = payload;

    const sessions = getData('PaymentSessions');
    const session  = sessions.find(s =>
      String(s.session_id).trim() === String(sessionId).trim() &&
      String(s.order_id).trim()   === String(orderId).trim() &&
      String(s.user_id).trim()    === String(userId).trim()
    );
    if (!session) return { ok:false, err:'Payment session not found. Please refresh the page.' };
    if (String(session.status).trim() !== 'Active')
      return { ok:false, err:'Session is ' + session.status + '. Please regenerate the QR code.' };

    if (new Date(session.qr_expires_at) < new Date()) {
      const ri = findRow('PaymentSessions', 0, sessionId);
      if (ri > 0) setCell('PaymentSessions', ri, 9, 'Expired');
      _safeSetOrderStatus(orderId, 'Payment Expired', null);
      return { ok:false, err:'QR code has expired. Please click "Regenerate QR".', expired:true };
    }

    const refClean = String(upiRef||'').trim();
    if (!refClean || refClean.length < 6)
      return { ok:false, err:'Please enter a valid UPI Transaction ID (minimum 6 characters).' };
    if (!enteredAmount || isNaN(parseFloat(enteredAmount)))
      return { ok:false, err:'Please enter the amount you paid.' };

    const ledger = getData('PaymentLedger');
    const cfg = liveSettings();
    const totalAttempts = ledger.filter(p =>
      String(p.order_id).trim() === String(orderId).trim() &&
      String(p.user_id).trim()  === String(userId).trim()
    ).length;
    if (totalAttempts >= cfg.retryLimit)
      return { ok:false, err:`Maximum payment attempts (${cfg.retryLimit}) reached. Contact support.`, locked:true };

    const dupRef = ledger.find(p =>
      String(p.upi_ref).trim() === refClean &&
      String(p.auto_status).trim() !== 'Auto Rejected'
    );
    if (dupRef) {
      _logFraud(orderId, userId, refClean, 'DUPLICATE_UPI_REF');
      return { ok:false, err:'⚠️ This UPI Transaction ID has already been used. Contact support if this is a mistake.', fraud:true };
    }

    const dupOrder = ledger.find(p =>
      String(p.order_id).trim() === String(orderId).trim() &&
      String(p.admin_status).trim() === 'Approved'
    );
    if (dupOrder) return { ok:false, err:'This order already has an approved payment.' };

    // Increment session attempts counter
    const sri = findRow('PaymentSessions', 0, sessionId);
    const newAttempts = parseInt(session.attempts||0) + 1;
    if (newAttempts > cfg.retryLimit)
      return { ok:false, err:`Maximum payment attempts (${cfg.retryLimit}) reached. Contact support.`, locked:true };
    if (sri > 0) {
      setCell('PaymentSessions', sri, 8, newAttempts);
      setCell('PaymentSessions', sri, 10, new Date().toISOString());
    }

    // Upload screenshot
    let screenshotUrl = '';
    if (screenshotB64 && String(screenshotB64).length > 0) {
      const upRes = uploadScreenshot(screenshotB64, screenshotName||'screenshot.jpg', screenshotMime||'image/jpeg', orderId);
      if (upRes.ok) screenshotUrl = upRes.url;
      else return { ok:false, err:upRes.err || 'Screenshot upload failed' };
    }

    // Score the payment
    const scoreResult = _scorePayment({
      enteredAmount, orderAmount:parseFloat(session.amount)||0,
      upiRef:refClean, noteConfirmed:!!noteConfirmed, hasScreenshot:!!screenshotUrl
    });

    const payId       = uid('PAY');
    const now         = new Date().toISOString();
    const adminStatus = scoreResult.autoStatus === 'Auto Approved' ? 'Approved' : 'Pending';
    append('PaymentLedger', [
      payId, sessionId, orderId, userId,
      refClean, parseFloat(enteredAmount), screenshotUrl,
      noteConfirmed ? 'Yes' : 'No',
      scoreResult.score, scoreResult.breakdown,
      scoreResult.autoStatus, adminStatus,
      scoreResult.flags, now, '', ''
    ]);

    let orderStatus, paymentStatus;
    if (scoreResult.autoStatus === 'Auto Approved') {
      orderStatus='Accepted'; paymentStatus='Paid';
    } else if (scoreResult.autoStatus === 'Needs Review') {
      orderStatus='Pending Verification'; paymentStatus='Under Review';
    } else {
      orderStatus='Payment Rejected'; paymentStatus='Rejected';
      _logFraud(orderId, userId, refClean, 'LOW_SCORE:' + scoreResult.score);
    }
    if (sri > 0) setCell('PaymentSessions', sri, 9, 'Completed');
    _safeSetOrderStatus(orderId, orderStatus, paymentStatus);

    try {
      const user = getData('Users').find(u => String(u.user_id).trim() === String(userId).trim());
      if (user) _sendPaymentEmail(user, orderId, parseFloat(session.amount)||0, scoreResult.autoStatus, payId);
    } catch(e) {}

    return {
      ok:true, paymentId:payId,
      score:scoreResult.score, autoStatus:scoreResult.autoStatus,
      breakdown:scoreResult.breakdown, orderStatus, paymentStatus,
      msg: scoreResult.autoStatus === 'Auto Approved'
        ? '🎉 Payment Auto-Approved! Your order is confirmed.'
        : scoreResult.autoStatus === 'Needs Review'
        ? '⏳ Payment submitted for review. We will confirm shortly.'
        : '❌ Payment could not be verified. Please retry or contact support.'
    };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── FRAUD LOGGER ───────────────────────────────────────────
function _logFraud(orderId, userId, upiRef, reason) {
  try { append('FraudLog', [uid('FRD'), orderId, userId, upiRef, reason, '', new Date().toISOString()]); } catch(e) {}
}

// ── ADMIN — PAYMENT LEDGER ─────────────────────────────────
function adminGetPaymentLedger(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const ledger   = getData('PaymentLedger').sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    const orders   = getData('Orders');
    const sessions = getData('PaymentSessions');
    const fraud    = getData('FraudLog');
    return {
      ok:true,
      payments: ledger.map(p => ({
        ...p,
        order  : orders.find(o   => String(o.order_id)   === String(p.order_id))   || {},
        session: sessions.find(s => String(s.session_id) === String(p.session_id)) || {},
        isFraud: fraud.some(f =>
          String(f.upi_ref)   === String(p.upi_ref) ||
          (String(f.order_id) === String(p.order_id) && String(f.reason).startsWith('LOW_SCORE'))
        )
      })),
      stats:{
        total        : ledger.length,
        autoApproved : ledger.filter(p => String(p.auto_status)  === 'Auto Approved').length,
        needsReview  : ledger.filter(p => String(p.auto_status)  === 'Needs Review').length,
        autoRejected : ledger.filter(p => String(p.auto_status)  === 'Auto Rejected').length,
        adminPending : ledger.filter(p => String(p.admin_status) === 'Pending').length,
        fraudFlags   : fraud.length
      }
    };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── ADMIN — APPROVE ────────────────────────────────────────
function adminApprovePayment(payId, orderId, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const ri = findRow('PaymentLedger', 0, payId);
    if (ri < 0) return { ok:false, err:'Payment not found in ledger' };
    const ledger = getData('PaymentLedger');
    const pay    = ledger.find(p => String(p.payment_id) === String(payId));
    if (!pay) return { ok:false, err:'Payment not found in ledger' };
    const ordId = String(pay.order_id || '').trim();
    const now = new Date().toISOString();
    setCell('PaymentLedger', ri, 12, 'Approved');
    setCell('PaymentLedger', ri, 15, now);
    setCell('PaymentLedger', ri, 16, 'Admin');
    _safeSetOrderStatus(ordId, 'Accepted', 'Paid');
    const si = findRow('PaymentSessions', 0, pay.session_id);
    if (si > 0) setCell('PaymentSessions', si, 9, 'Completed');
    try {
      const o = getData('Orders').find(x => String(x.order_id) === ordId);
      if (o && o.user_email) {
        const u = getData('Users').find(u => String(u.email).toLowerCase() === String(o.user_email).toLowerCase());
        if (u) _sendPaymentStatusEmail(u, ordId, 'Approved', '');
      }
    } catch(e) {}
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── ADMIN — REJECT (SMART) ─────────────────────────────────
function adminRejectSmartPayment(payId, orderId, reason, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const ri = findRow('PaymentLedger', 0, payId);
    if (ri < 0) return { ok:false, err:'Payment not found in ledger' };
    const ledger = getData('PaymentLedger');
    const pay    = ledger.find(p => String(p.payment_id) === String(payId));
    if (!pay) return { ok:false, err:'Payment not found in ledger' };
    const ordId = String(pay.order_id || '').trim();
    const now = new Date().toISOString();
    setCell('PaymentLedger', ri, 12, 'Rejected');
    setCell('PaymentLedger', ri, 15, now);
    setCell('PaymentLedger', ri, 16, 'Admin');
    _safeSetOrderStatus(ordId, 'Payment Rejected', 'Rejected');
    _logFraud(ordId, String(pay.user_id)||'', String(pay.upi_ref)||'', 'ADMIN_REJECTED: ' + (reason||''));
    try {
      const o = getData('Orders').find(x => String(x.order_id) === ordId);
      if (o && o.user_email) {
        const u = getData('Users').find(u => String(u.email).toLowerCase() === String(o.user_email).toLowerCase());
        if (u) _sendPaymentStatusEmail(u, ordId, 'Rejected', reason||'');
      }
    } catch(e) {}
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── ADMIN — FRAUD LOG ──────────────────────────────────────
function adminGetFraudLog(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    return { ok:true, logs:getData('FraudLog').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)) };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── USER — PAYMENT STATUS (used for polling) ───────────────
function getPaymentStatus(orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const ledger  = getData('PaymentLedger');
    const payment = ledger
      .filter(p => String(p.order_id) === String(orderId) && String(p.user_id) === String(userId))
      .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
    const order = getData('Orders').find(o =>
      String(o.order_id) === String(orderId) &&
      String(o.user_id)  === String(userId)
    );
    return { ok:true, payment:payment||null, order:order||null };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── CHECK SESSION EXPIRY ───────────────────────────────────
function checkSessionExpiry(sessionId, orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const session = getData('PaymentSessions').find(s =>
      String(s.session_id) === String(sessionId) &&
      String(s.order_id)   === String(orderId) &&
      String(s.user_id)    === String(userId)
    );
    if (!session) return { ok:false, err:'Session not found' };
    const secsLeft = Math.max(0, Math.floor((new Date(session.qr_expires_at) - new Date()) / 1000));
    const expired  = secsLeft === 0;
    if (expired && String(session.status).trim() === 'Active') {
      const ri = findRow('PaymentSessions', 0, sessionId);
      if (ri > 0) setCell('PaymentSessions', ri, 9, 'Expired');
      _safeSetOrderStatus(orderId, 'Payment Expired', null);
    }
    return { ok:true, secsLeft, expired, status:String(session.status) };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── EMAIL HELPERS ──────────────────────────────────────────
function _sendPaymentEmail(user, orderId, amount, autoStatus, payId) {
  const s = liveSettings();
  const colors = {'Auto Approved':'#16a34a','Needs Review':'#f59e0b','Auto Rejected':'#dc2626'};
  const icons  = {'Auto Approved':'🎉','Needs Review':'⏳','Auto Rejected':'❌'};
  const msgs   = {
    'Auto Approved':'Your payment has been <b>automatically verified</b>! Your order is confirmed.',
    'Needs Review' :'Your payment is <b>under review</b>. We\'ll confirm within 30 minutes.',
    'Auto Rejected':'Your payment could not be verified. Please <b>retry with correct details</b>.'
  };
  const color=colors[autoStatus]||'#374151', icon=icons[autoStatus]||'💳', msg=msgs[autoStatus]||'';
  try {
    MailApp.sendEmail({ to:user.email,
      subject:`${icon} Payment ${autoStatus} — ${orderId} | ${s.shopName}`,
      htmlBody:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
<div style="background:${color};color:#fff;padding:28px;text-align:center"><div style="font-size:40px">${icon}</div><h2>Payment ${autoStatus}</h2></div>
<div style="padding:28px;background:#f9fafb"><h3>Hello ${user.name}!</h3><p style="margin:12px 0">${msg}</p>
<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:16px">
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Order ID</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:700">${orderId}</td></tr>
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Amount</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:700">₹${amount}</td></tr>
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Payment ID</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:700">${payId}</td></tr>
<tr><td style="padding:11px 16px;color:#6b7280">Status</td><td style="padding:11px 16px;font-weight:700;color:${color}">${autoStatus}</td></tr>
</table><p style="margin-top:20px;color:#6b7280;font-size:13px">— ${s.shopName} Team</p></div></div>`
    });
  } catch(e) { Logger.log('Email error: ' + e); }
}

function _sendPaymentStatusEmail(user, orderId, status, reason) {
  const s = liveSettings();
  const ok=status==='Approved', color=ok?'#16a34a':'#dc2626', icon=ok?'✅':'❌';
  const msg=ok
    ?'Your payment has been <b>manually approved</b>! Your order is now being processed.'
    :`Your payment was <b>rejected</b>. ${reason?'Reason: <i>'+reason+'</i>.':''} Please resubmit or contact support.`;
  try {
    MailApp.sendEmail({ to:user.email,
      subject:`${icon} Payment ${status} — ${orderId} | ${s.shopName}`,
      htmlBody:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
<div style="background:${color};color:#fff;padding:28px;text-align:center"><div style="font-size:40px">${icon}</div><h2>Payment ${status}</h2></div>
<div style="padding:28px"><p>Hello <b>${user.name}</b>,</p><p style="margin:12px 0">${msg}</p>
<p><b>Order ID:</b> ${orderId}</p><p style="margin-top:20px;color:#6b7280;font-size:13px">— ${s.shopName} Team</p></div></div>`
    });
  } catch(e) { Logger.log('Email error: ' + e); }
}
