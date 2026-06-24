// api/_store.js
// Durable storage for STK push / Paystack charge pending state, keyed
// exactly the same way the old in-memory version was (e.g. 'stk:xxx', 'ps_xxx').
//
// REPLACES the old in-memory Map. The old version reset on every cold
// start and wasn't shared across serverless instances, which caused
// "payment succeeded but app never found out" bugs — STK push would run
// on one instance, the callback/poll would land on a different instance
// with an empty Map, and the pending record was simply gone.
//
// This version stores the same key -> record data in Supabase instead,
// so any instance can find any other instance's pending record.
//
// Function names/signatures are UNCHANGED from the old _store.js, so
// stk-push.js, callback.js, status.js, paystack-charge.js, and
// paystack-status.js all keep working without any changes.
//
// ENV VARS REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function savePending(key, record) {
  const { error } = await supabase
    .from('pending_payments')
    .upsert({ key: String(key), record }, { onConflict: 'key' });

  if (error) {
    console.error('_store.savePending error', error);
    throw new Error('Failed to save pending payment record');
  }
}

async function getRecord(key) {
  const { data, error } = await supabase
    .from('pending_payments')
    .select('record')
    .eq('key', String(key))
    .maybeSingle();

  if (error) {
    console.error('_store.getRecord error', error);
    return null;
  }
  return data ? data.record : null;
}

async function updateRecord(key, patch) {
  const existing = (await getRecord(key)) || {};
  const updated = { ...existing, ...patch };
  await savePending(key, updated);
  return updated;
}

module.exports = { savePending, getRecord, updateRecord };
