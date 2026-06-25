// api/paystack-charge.js
// TEMPORARY DEBUG VERSION — adds console.log so we can see exactly what
// phone value arrives and what normalizePhone() produces, visible in
// Vercel's runtime logs. Once the bug is found, remove the console.log
// lines (marked with "DEBUG:") and this goes back to normal.

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function normalizePhone(raw) {
  // Paystack expects Kenyan numbers in 07xxxxxxxx / 01xxxxxxxx local format
  let p = String(raw || '').replace(/[^0-9]/g, '');
  if (p.startsWith('254')) p = '0' + p.slice(3);
  if (p.startsWith('7') || p.startsWith('1')) p = '0' + p;
  if (!p.startsWith('0') || p.length !== 10) return null;
  return p;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST' });

  try {
    const { phone, amount, email, accountRef, description, source } = req.body || {};

    // DEBUG: log exactly what we received, raw, before any processing
    console.log('DEBUG: req.body =', JSON.stringify(req.body));
    console.log('DEBUG: typeof phone =', typeof phone, '| phone value =', JSON.stringify(phone));

    const localPhone = normalizePhone(phone);

    // DEBUG: log what normalizePhone produced
    console.log('DEBUG: normalizePhone result =', JSON.stringify(localPhone));

    if (!localPhone) {
      console.log('DEBUG: REJECTED — localPhone was falsy');
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

    const customerEmail = email && email.includes('@') ? email : `${localPhone}@payer.local`;
    const reference = `${source || 'pay'}_${Date.now()}`;

    const payload = {
      email: customerEmail,
      amount: amt * 100,
      currency: 'KES',
      reference,
      mobile_money: {
        phone: localPhone,
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

    const { savePending } = require('./_store');
    await savePending(`ps_${reference}`, {
      status: 'pending',
      phone: localPhone,
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
      status: psData.data?.status,
      displayText: psData.data?.display_text || 'Check your phone to complete payment.',
      message: 'Charge initiated. Check your phone to complete payment.',
    });
  } catch (err) {
    console.error('paystack-charge error', err);
    return res.status(500).json({ success: false, error: err.message || 'Unexpected server error' });
  }
};
