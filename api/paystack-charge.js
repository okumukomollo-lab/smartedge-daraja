// api/paystack-charge.js
// POST endpoint: initiates an M-PESA payment via Paystack's "Pay with M-PESA"
// mobile money channel. This is a faster-to-launch alternative to direct
// Daraja STK push, useful while waiting on Safaricom's Till/Paybill
// production approval (which involves a separate business paperwork process).
//
// REQUEST BODY (JSON):
//   { phone: "0712345678", amount: 100, email: "name@example.com", accountRef: "JSS/2024/001", source: "smartedge" }
//   (email is required by Paystack even though it's not really used for M-Pesa;
//    if you don't collect emails, generate a placeholder like `${phone}@chiefbookclub.local`)
//
// RESPONSE (success):
//   { success: true, reference: "...", status: "pay_offline", displayText: "..." }
// The frontend should show displayText to the user (e.g. "Enter your PIN"),
// then poll /api/paystack-status?reference=... to find out when it completes.
//
// ENV VARS REQUIRED:
//   PAYSTACK_SECRET_KEY  - from your Paystack dashboard (Settings -> API Keys & Webhooks)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - used by ./_store.js for durable pending-state

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function normalizePhone(raw) {
  // Per Paystack's own docs, phone numbers must be sent in international
  // format WITH a plus sign, e.g. +254722000000 — NOT local 07xxxxxxxx.
  // See: https://paystack.com/docs/payments/payment-channels/
  // (An earlier version of this function sent local format, which Paystack
  // rejected with "Invalid phone number format" even for valid numbers.)
  let p = String(raw || '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254') || p.length !== 12) return null;
  return '+' + p;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST' });

  try {
    const { phone, amount, email, accountRef, description, source } = req.body || {};

    const intlPhone = normalizePhone(phone);
    if (!intlPhone) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Use format 07XXXXXXXX.' });
    }
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ success: false, error: 'Server misconfigured: missing PAYSTACK_SECRET_KEY' });
    }

    // Paystack requires an email even for mobile money charges, and validates
    // that it's a plausible format/domain. ".local" was rejected as invalid,
    // so we use example.com (reserved by RFC 2606 for placeholder use).
    const customerEmail = email && email.includes('@') ? email : `${intlPhone.replace('+', '')}@example.com`;

    const reference = `${source || 'pay'}_${Date.now()}`;

    const payload = {
      email: customerEmail,
      amount: amt * 100, // Paystack uses the smallest currency unit (cents/kobo equivalent)
      currency: 'KES',
      reference,
      mobile_money: {
        phone: intlPhone, // +254XXXXXXXXX — Paystack's documented required format
        provider: 'mpesa',
      },
      metadata: {
        accountRef: accountRef || '',
        description: description || '',
        source: source || 'unspecified',
      },
    };

    const psRes = await fetch(`${PAYSTACK_BASE_URL}/charge`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const psData = await psRes.json();

    if (!psRes.ok || !psData.status) {
      return res.status(400).json({
        success: false,
        error: psData.message || 'Paystack rejected the charge request.',
      });
    }

    // Store a pending record so the status endpoint and webhook can find it.
    const { savePending } = require('./_store');
    await savePending(`ps_${reference}`, {
      status: 'pending',
      phone: intlPhone,
      amount: amt,
      accountRef,
      description,
      source: source || 'unspecified',
      reference,
      createdAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      reference,
      status: psData.data?.status, // usually "pay_offline" or "send_otp"
      displayText: psData.data?.display_text || 'Check your phone to complete payment.',
      message: 'Charge initiated. Check your phone to complete payment.',
    });
  } catch (err) {
    console.error('paystack-charge error', err);
    return res.status(500).json({ success: false, error: err.message || 'Unexpected server error' });
  }
};
