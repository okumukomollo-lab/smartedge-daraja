// api/status.js
// GET endpoint: the SmartEdge frontend polls this every 2-3 seconds after
// triggering an STK push, to find out whether the learner has completed
// payment on their phone yet.
//
// REQUEST:  GET /api/status?checkoutRequestId=ws_CO_...
// RESPONSE: { status: "pending" | "success" | "failed" | "not_found", ...details }

const { getRecord } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ status: 'error', error: 'Use GET' });

  const { checkoutRequestId } = req.query;
  if (!checkoutRequestId) {
    return res.status(400).json({ status: 'error', error: 'checkoutRequestId is required' });
  }

  const record = await getRecord(checkoutRequestId);
  if (!record) {
    return res.status(200).json({ status: 'not_found' });
  }

  return res.status(200).json(record);
};
