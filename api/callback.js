// api/callback.js
// This is the URL you put in DARAJA_CALLBACK_URL. Safaricom's servers POST
// here automatically once the customer enters their M-Pesa PIN (or cancels,
// or it times out). You never call this yourself — Safaricom calls it.
//
// IMPORTANT: this URL must be public HTTPS (Vercel gives you this for free,
// e.g. https://your-project.vercel.app/api/callback). Safaricom sandbox/production
// cannot reach localhost — deploy to Vercel before testing real STK pushes.

const { updateRecord } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body || {};
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) {
      console.error('callback: unexpected payload shape', JSON.stringify(body));
      return res.status(200).json({ received: true }); // always 200 so Safaricom stops retrying
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    if (ResultCode === 0) {
      // Payment succeeded — extract the M-Pesa receipt number and amount
      const items = CallbackMetadata?.Item || [];
      const get = (name) => items.find((i) => i.Name === name)?.Value;
      await updateRecord(CheckoutRequestID, {
        status: 'success',
        mpesaReceiptNumber: get('MpesaReceiptNumber'),
        amountPaid: get('Amount'),
        transactionDate: get('TransactionDate'),
        payerPhone: get('PhoneNumber'),
        resultDesc: ResultDesc,
        completedAt: Date.now(),
      });
    } else {
      // Payment failed, was cancelled, or timed out
      await updateRecord(CheckoutRequestID, {
        status: 'failed',
        resultDesc: ResultDesc,
        completedAt: Date.now(),
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('callback error', err);
    // Still return 200 — Safaricom will keep retrying otherwise, which won't fix a code bug
    return res.status(200).json({ received: true });
  }
};
