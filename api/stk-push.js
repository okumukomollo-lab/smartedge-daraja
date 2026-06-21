// api/stk-push.js
// POST endpoint: triggers an M-Pesa "Lipa na M-Pesa Online" (STK Push) prompt
// on the payer's phone. Call this from the SmartEdge portal frontend when a
// learner/parent clicks "Pay with M-Pesa".
//
// REQUEST BODY (JSON):
//   { phone: "0712345678", amount: 100, accountRef: "JSS/2024/001", description: "Mathematics Exam" }
//
// RESPONSE (success):
//   { success: true, checkoutRequestId: "ws_CO_...", merchantRequestId: "..." }
// SmartEdge should store checkoutRequestId against the pending payment record,
// then poll /api/status?checkoutRequestId=... until it resolves.
//
// ENV VARS REQUIRED (in addition to the auth ones in _daraja-auth.js):
//   DARAJA_SHORTCODE      - your Till/Paybill number (sandbox default: 174379)
//   DARAJA_PASSKEY        - Lipa Na M-Pesa Online Passkey (sandbox passkey is public, see Daraja docs)
//   DARAJA_CALLBACK_URL   - public HTTPS URL to this deployment's /api/callback
//   DARAJA_TRANSACTION_TYPE (optional) - "CustomerPayBillOnline" or "CustomerBuyGoodsOnline" (default: CustomerBuyGoodsOnline, matches Till numbers)

const { getDarajaToken, getBaseUrl } = require('./_daraja-auth');

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function normalizePhone(raw) {
  // Accepts 07xxxxxxxx, +254xxxxxxxxx, 254xxxxxxxxx, 7xxxxxxxx
  let p = String(raw || '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254') || p.length !== 12) return null;
  return p;
}

module.exports = async (req, res) => {
  // CORS — allow the portal (hosted wherever) to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST' });

  try {
    const { phone, amount, accountRef, description } = req.body || {};

    const msisdn = normalizePhone(phone);
    if (!msisdn) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Use format 07XXXXXXXX.' });
    }
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }
    if (!accountRef) {
      return res.status(400).json({ success: false, error: 'accountRef (e.g. admission number) is required.' });
    }

    const shortcode = process.env.DARAJA_SHORTCODE || '174379';
    const passkey = process.env.DARAJA_PASSKEY;
    const callbackUrl = process.env.DARAJA_CALLBACK_URL;
    const transactionType = process.env.DARAJA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline';

    if (!passkey || !callbackUrl) {
      return res.status(500).json({ success: false, error: 'Server misconfigured: missing DARAJA_PASSKEY or DARAJA_CALLBACK_URL' });
    }

    const timestamp = timestampNow();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const token = await getDarajaToken();

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amt,
      PartyA: msisdn,
      PartyB: shortcode,
      PhoneNumber: msisdn,
      CallBackURL: callbackUrl,
      AccountReference: String(accountRef).slice(0, 12),
      TransactionDesc: String(description || 'SmartEdge payment').slice(0, 13),
    };

    const stkRes = await fetch(`${getBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const stkData = await stkRes.json();

    if (!stkRes.ok || stkData.ResponseCode !== '0') {
      return res.status(400).json({
        success: false,
        error: stkData.errorMessage || stkData.ResponseDescription || 'STK push was rejected by Safaricom.',
      });
    }

    // Store a pending record so /api/status and the callback can find it.
    // (See _store.js — uses Vercel KV / Upstash if configured, otherwise in-memory fallback for local dev.)
    const { savePending } = require('./_store');
    await savePending(stkData.CheckoutRequestID, {
      status: 'pending',
      phone: msisdn,
      amount: amt,
      accountRef,
      description,
      merchantRequestId: stkData.MerchantRequestID,
      createdAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      message: 'STK push sent. Check your phone to enter M-Pesa PIN.',
    });
  } catch (err) {
    console.error('stk-push error', err);
    return res.status(500).json({ success: false, error: err.message || 'Unexpected server error' });
  }
};
