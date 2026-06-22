// api/paystack-status.js
// GET endpoint: the frontend polls this every 2-3 seconds after calling
// /api/paystack-charge, to find out whether the customer has completed
// payment on their phone yet.
//
// REQUEST:  GET /api/paystack-status?reference=smartedge_172...
// RESPONSE: { status: "pending" | "success" | "failed" | "not_found", ...details }
//
// NOTE: This relies on the webhook (paystack-webhook.js) having fired to
// update the record. As a fallback (e.g. if the webhook is delayed or your
// webhook URL isn't registered yet), this endpoint also calls Paystack's
// Verify Transaction API directly so status is never stuck on "pending"
// forever once the customer has actually paid.

const { getRecord, updateRecord } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ status: 'error', error: 'Use GET' });

  const { reference } = req.query;
  if (!reference) {
    return res.status(400).json({ status: 'error', error: 'reference is required' });
  }

  let record = await getRecord(`ps_${reference}`);
  if (!record) {
    return res.status(200).json({ status: 'not_found' });
  }

  // If still pending, double-check directly with Paystack in case the
  // webhook hasn't arrived yet (network delay, webhook URL not set, etc).
  if (record.status === 'pending') {
    try {
      const secretKey = process.env.PAYSTACK_SECRET_KEY;
      if (secretKey) {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        const verifyData = await verifyRes.json();
        if (verifyData.status && verifyData.data) {
          if (verifyData.data.status === 'success') {
            record = await updateRecord(`ps_${reference}`, {
              status: 'success',
              receiptNumber: verifyData.data.id,
              amountPaid: (verifyData.data.amount || 0) / 100,
              resultDesc: 'Payment confirmed via Paystack (verified)',
              completedAt: Date.now(),
            });
          } else if (verifyData.data.status === 'failed' || verifyData.data.status === 'abandoned') {
            record = await updateRecord(`ps_${reference}`, {
              status: 'failed',
              resultDesc: verifyData.data.gateway_response || 'Payment failed or was abandoned',
              completedAt: Date.now(),
            });
          }
        }
      }
    } catch (err) {
      console.error('paystack-status verify fallback failed', err);
      // Non-fatal — just return whatever we had stored already
    }
  }

  return res.status(200).json(record);
};
