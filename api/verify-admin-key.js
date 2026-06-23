// api/verify-admin-key.js
// POST endpoint: checks a submitted "admin secret key" against the real
// value stored server-side (an environment variable), and returns only a
// true/false result — the actual key value never appears in the response,
// and is never present anywhere in the browser-side HTML/JS.
//
// This replaces a client-side check like `if(key !== ADMIN_SECRET_KEY)`,
// which doesn't work as a real security boundary — anyone can view-source
// or open dev tools and read a value hardcoded in the page itself. Storing
// the real key only as a Vercel environment variable (server-side) means
// it's never sent to the browser at all.
//
// REQUEST BODY (JSON): { key: "whatever the admin typed" }
// RESPONSE: { valid: true } or { valid: false }
//
// ENV VAR REQUIRED:
//   ADMIN_SECRET_KEY  - set this in Vercel -> Settings -> Environment
//                        Variables. Pick a long, random value and only
//                        share it with people who should be able to grant
//                        admin rights. Treat it like a master password.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ valid: false, error: 'Use POST' });

  try {
    const { key } = req.body || {};
    const realKey = process.env.ADMIN_SECRET_KEY;

    if (!realKey) {
      // Server misconfigured — fail closed (deny), not open. Better to
      // block a legitimate admin temporarily than silently allow anyone in.
      console.error('verify-admin-key: ADMIN_SECRET_KEY env var is not set');
      return res.status(500).json({ valid: false, error: 'Server misconfigured: ADMIN_SECRET_KEY not set' });
    }
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ valid: false, error: 'A "key" string is required.' });
    }

    // Basic rate limiting to slow down brute-force guessing attempts.
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ valid: false, error: 'Too many attempts — please wait a minute and try again.' });
    }

    const valid = key === realKey;
    return res.status(200).json({ valid });
  } catch (err) {
    console.error('verify-admin-key error', err);
    return res.status(500).json({ valid: false, error: 'Unexpected server error' });
  }
};

// Lightweight in-memory rate limit — resets on cold start, good enough to
// slow down casual guessing without needing a real database.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5; // 5 attempts per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}
