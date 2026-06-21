// api/_store.js
// Tiny storage abstraction for STK push state, keyed by CheckoutRequestID.
//
// In production on Vercel, set up Vercel KV (or Upstash Redis) and it will be
// used automatically. Without it, falls back to an in-memory Map — this works
// for quick testing but resets on every cold start / deploy, and won't work
// reliably across multiple serverless instances. For real production use,
// connect Vercel KV (Storage tab in your Vercel project → Create Database → KV).
//
// ENV VARS (optional, only needed for Vercel KV):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN

const memoryStore = new Map();

async function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function savePending(checkoutRequestId, record) {
  if (await hasKV()) {
    const { kv } = require('@vercel/kv');
    await kv.set(`stk:${checkoutRequestId}`, record, { ex: 60 * 30 }); // expire in 30 min
    return;
  }
  memoryStore.set(checkoutRequestId, record);
}

async function getRecord(checkoutRequestId) {
  if (await hasKV()) {
    const { kv } = require('@vercel/kv');
    return (await kv.get(`stk:${checkoutRequestId}`)) || null;
  }
  return memoryStore.get(checkoutRequestId) || null;
}

async function updateRecord(checkoutRequestId, patch) {
  const existing = (await getRecord(checkoutRequestId)) || {};
  const updated = { ...existing, ...patch };
  await savePending(checkoutRequestId, updated);
  return updated;
}

module.exports = { savePending, getRecord, updateRecord };
