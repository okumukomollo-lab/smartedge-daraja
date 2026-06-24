// api/paystack-push.js
// POST endpoint: triggers an M-Pesa STK push via PAYSTACK (not Daraja).
// This is the LIVE payment path while Safaricom Daraja production access
// is still pending approval. Once Daraja is approved, you can switch back
// by pointing the portal's "Pay" button at /api/stk-push instead.
//
// REQUEST BODY (JSON):
//   { phone: "0712345678", amount: 100, learnerId: "l1", admissionRef: "JSS/2024/001", description: "Mathematics Exam" }
//
// RESPONSE (success):
//   { success: true, reference: "se_1234567890_abc123" }
// SmartEdge portal should store this reference, then poll
// /api/paystack-status?reference=... until status is "success" or "failed".
//
// ENV VARS REQUIRED:
//   PAYSTACK_SECRET_KEY      - already set (sk_live_...)
//   SUPABASE_URL             - already set
//   SUPABASE_SERVICE_ROLE_KEY - already set

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizePhone(raw) {
  // Paystack Kenya mobile money expects 2547XXXXXXXX (no plus sign)
  let p = String(raw || '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254') || p.length !== 12) return null;
  return p;
}

function generateReference() {
  return `se_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST' });

  try {
    const { phone, amount, learnerId, admissionRef, description } = req.body || {};

    const msisdn = normalizePhone(phone);
    if (!msisdn) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Use format 07XXXXXXXX.' });
    }
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }
    if (!learnerId) {
      return res.status(400).json({ success: false, error: 'learnerId is required.' });
    }
    if (!admissionRef) {
      return res.status(400).json({ success: false, error: 'admissionRef is required.' });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ success: false, error: 'Server misconfigured: missing PAYSTACK_SECRET_KEY' });
    }

    const reference = generateReference();

    // Paystack charge amounts are in the LOWEST currency unit.
    // For KES, Paystack treats it like kobo/cents style — multiply by 100.
    const amountInSubunit = amt * 100;

    const chargePayload = {
      email: `${msisdn}@smartedge-payer.example`, // Paystack requires an email; we synthesize one since learners don't have one on file
      amount: amountInSubunit,
      currency: 'KES',
      reference,
      mobile_money: {
        phone: msisdn,
        provider: 'mpesa',
      },
    };

    const chargeRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chargePayload),
    });

    const chargeData = await chargeRes.json();

    if (!chargeRes.ok || !chargeData.status) {
      return res.status(400).json({
        success: false,
        error: chargeData.message || 'Paystack rejected the charge request.',
      });
    }

    // Save a pending record in Supabase BEFORE telling the frontend it's pending,
    // so the webhook always has something to find when it arrives.
    const { error: insertError } = await supabase.from('payments').insert({
      learner_id: learnerId,
      admission_ref: admissionRef,
      description: description || 'SmartEdge payment',
      amount: amt,
      phone: msisdn,
      provider: 'paystack',
      provider_reference: reference,
      status: 'pending',
      provider_response: chargeData,
    });

    if (insertError) {
      console.error('Supabase insert error', insertError);
      return res.status(500).json({ success: false, error: 'Failed to save pending payment record.' });
    }

    return res.status(200).json({
      success: true,
      reference,
      message: 'STK push sent. Check your phone to enter M-Pesa PIN.',
    });
  } catch (err) {
    console.error('paystack-push error', err);
    return res.status(500).json({ success: false, error: err.message || 'Unexpected server error' });
  }
};
