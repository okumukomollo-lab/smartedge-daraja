# SmartEdge Backend (M-Pesa + AI)

This is the small server SmartEdge needs for two things the portal's HTML
file cannot do safely on its own — both because they require a secret key
that must never be visible in a browser:

1. **M-Pesa STK Push** (Daraja) — send a real payment prompt to a learner's
   phone instead of asking them to type a confirmation code by hand.
2. **AI Content Generator / AI Tutor** — securely call Claude on behalf of
   teachers (generating lesson content) and learners (asking study questions).

## What's in this folder

```
api/
  stk-push.js     <- portal calls this to start an M-Pesa payment
  callback.js     <- Safaricom calls this automatically when payment finishes
  status.js       <- portal polls this to check "has the learner paid yet?"
  generate.js     <- portal calls this for AI Content Generator & AI Tutor
  _store.js       <- tiny shared storage helper (in-memory, or Vercel KV)
  _daraja-auth.js <- gets the OAuth token Safaricom requires
package.json
```

## Step 1 — Get Daraja credentials (you haven't done this yet)

1. Go to **https://developer.safaricom.co.ke** and create a free account
   (separate from your M-Pesa line — this is a developer login).
2. Click **My Apps → Add a new app**. Name it e.g. "SmartEdge Portal".
3. Open the app — you'll see a **Consumer Key** and **Consumer Secret**.
   Copy both somewhere safe (you'll paste them into Vercel in Step 3).
4. For testing, Safaricom gives every app these **sandbox** values for free
   (no waiting, works immediately):
   - Shortcode: `174379`
   - Passkey: published on the Daraja docs page for "Lipa Na M-Pesa Online"
     (search "Daraja STK Push passkey" — it's the same public test key for
     everyone, fine to use while testing).
   - Test phone numbers: Safaricom gives you sandbox numbers that simulate
     a successful PIN entry without using real money.

   Your real number, 0707527401, isn't used directly by Daraja — when
   you're ready to go live, you instead apply for a **Till Number** or
   **Paybill** under "Lipa na M-Pesa for Business" at Safaricom (separate
   KYC process, takes a few days). Sandbox lets us build and test
   everything now; switching to production later is just swapping
   3 environment variable values.

## Step 2 — Deploy this folder to Vercel

You don't need to touch a terminal if you don't want to:

1. Create a free account at **https://vercel.com**
2. Push this folder to a new GitHub repo (or use Vercel's "Upload" option
   if you don't want GitHub).
3. In Vercel: **Add New Project → Import** this repo → Deploy.
4. Once deployed, Vercel gives you a URL like:
   `https://smartedge-daraja.vercel.app`
   Your callback URL will be:
   `https://smartedge-daraja.vercel.app/api/callback`

## Step 3 — Set environment variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `DARAJA_CONSUMER_KEY` | from Step 1 |
| `DARAJA_CONSUMER_SECRET` | from Step 1 |
| `DARAJA_ENV` | `sandbox` (change to `production` when you go live) |
| `DARAJA_SHORTCODE` | `174379` (sandbox) or your real Till/Paybill later |
| `DARAJA_PASSKEY` | the sandbox passkey from Daraja docs (Step 1) |
| `DARAJA_CALLBACK_URL` | `https://YOUR-VERCEL-URL.vercel.app/api/callback` |
| `DARAJA_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` (Till) or `CustomerPayBillOnline` (Paybill) |

Redeploy after adding these (Vercel → Deployments → ⋯ → Redeploy).

## Step 4 (optional but recommended) — Add Vercel KV

Without this, payment status is stored in memory and can get lost if the
server restarts between the push and the callback. To make it reliable:

1. In your Vercel project → **Storage** tab → **Create Database → KV**.
2. Connect it to this project — Vercel auto-adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` for you. Nothing else to configure.

## Step 5 — Test it

```bash
curl -X POST https://YOUR-VERCEL-URL.vercel.app/api/stk-push \
  -H "Content-Type: application/json" \
  -d '{"phone":"0712345678","amount":1,"accountRef":"JSS/2024/001","description":"Test exam"}'
```

If it works, your test phone should get a popup to enter the M-Pesa PIN
(sandbox phones don't need a real PIN — check Daraja docs for the
sandbox simulator details). Then check:

```bash
curl "https://YOUR-VERCEL-URL.vercel.app/api/status?checkoutRequestId=PASTE_THE_ID_FROM_ABOVE"
```

## Step 6 — Point the portal at this backend

In `smartedge_portal_v12.html`, set:

```js
const DARAJA_API_BASE = 'https://YOUR-VERCEL-URL.vercel.app/api';
```

That's the only change needed on the frontend side — the portal already
has the "Pay with M-Pesa" UI wired to call `${DARAJA_API_BASE}/stk-push`
and `${DARAJA_API_BASE}/status`.

## Going live later

When you've registered a real Till/Paybill with Safaricom:
1. Change `DARAJA_ENV` to `production`
2. Change `DARAJA_SHORTCODE` to your real Till/Paybill number
3. Change `DARAJA_PASSKEY` to the production passkey Safaricom emails you
4. Redeploy — no code changes needed.

---

## Setting up the AI Content Generator / AI Tutor

This part is much simpler than M-Pesa — one endpoint, no callbacks, no
polling against an external system.

### Step 1 — Get an Anthropic API key

1. Go to **https://console.anthropic.com** → sign up or log in.
2. **Settings → API Keys → Create Key**. Copy it (starts with `sk-ant-...`).
3. Add a small amount of credit under **Billing** — this is a separate,
   pay-as-you-go account from your claude.ai chat subscription. Costs are
   low for this use case (a few cents per generated lesson/answer).

### Step 2 — Add the environment variable in Vercel

In the same Vercel project you already set up for M-Pesa, go to
**Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from Step 1 |

Redeploy after adding it.

### Step 3 — Point the portal at this backend

You've likely already set this for M-Pesa — it's the same variable:

```js
const DARAJA_API_BASE = 'https://YOUR-VERCEL-URL.vercel.app/api';
```

The AI Generator and AI Tutor both call `${DARAJA_API_BASE}/generate`
automatically — no extra config needed once `DARAJA_API_BASE` is set.

### Cost control tips

- The system prompts keep responses focused. `max_tokens` is set to 4096
  in `generate.js` — enough for a full scheme of work or lesson plan
  without getting cut off; lower it if you want to cap cost per request.
- `generate.js` already includes a basic rate limit (12 requests/minute
  per visitor) and a 6,000-character cap on prompts, to stop accidental
  loops or a single user running up a large bill. These are soft limits
  good enough for a school's worth of traffic — not a substitute for a
  real API gateway if SmartEdge grows much larger.
- Check usage anytime at console.anthropic.com → Usage.
