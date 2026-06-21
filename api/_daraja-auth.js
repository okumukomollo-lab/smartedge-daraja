// _daraja-auth.js
// Shared helper: gets a fresh OAuth access token from Safaricom Daraja.
// Used internally by stk-push.js and callback.js — not an HTTP endpoint itself.
//
// ENV VARS REQUIRED (set these in Vercel Project Settings → Environment Variables):
//   DARAJA_CONSUMER_KEY      - from developer.safaricom.co.ke app
//   DARAJA_CONSUMER_SECRET   - from developer.safaricom.co.ke app
//   DARAJA_ENV               - "sandbox" or "production"

function getBaseUrl() {
  const env = process.env.DARAJA_ENV || 'sandbox';
  return env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getDarajaToken() {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error('Missing DARAJA_CONSUMER_KEY / DARAJA_CONSUMER_SECRET env vars');
  }
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const url = `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daraja auth failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

module.exports = { getDarajaToken, getBaseUrl };
