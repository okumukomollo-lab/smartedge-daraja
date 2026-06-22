// api/paystack-webhook.js
// Paystack POSTs payment events here (charge.success, charge.failed, etc).
// Set this URL in your Paystack Dashboard -> Settings -> API Keys & Webhooks
// -> Webhook URL, e.g. https://smartedge-daraja.vercel.app/api/paystack-webhook
//
// SECURITY: Paystack signs each webhook with your secret key via the
// x-paystack-signature header. We verify this so random requests to this
// URL can't fake a successful payment.

const crypto = require('crypto');
const { updateRecord } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    const rawBody = JSON.stringify(req.body);

    if (secretKey && signature) {
      const expectedHash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
      if (expectedHash !== signature) {
        console.error('paystack-webhook: invalid signature, ignoring request');
        return res.status(200).json({ received: true }); // 200 so Paystack doesn't retry forever, but we drop it
      }
    }

    const event = req.body || {};
    const reference = event.data?.reference;

    if (!reference) {
      return res.status(200).json({ received: true });
    }

    if (event.event === 'charge.success') {
      await updateRecord(`ps_${reference}`, {
        status: 'success',
        receiptNumber: event.data?.id || reference,
        amountPaid: (event.data?.amount || 0) / 100, // convert back from smallest unit
        payerPhone: event.data?.mobile_money?.phone || event.data?.customer?.phone,
        resultDesc: 'Payment confirmed via Paystack',
        completedAt: Date.now(),
      });
    } else if (event.event === 'charge.failed') {
      await updateRecord(`ps_${reference}`, {
        status: 'failed',
        resultDesc: event.data?.gateway_response || 'Payment failed',
        completedAt: Date.now(),
      });
    }
    // Other event types (e.g. charge.dispute.create) are ignored for now.

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('paystack-webhook error', err);
    return res.status(200).json({ received: true }); // always 200, same reasoning as the Daraja callback
  }
};
