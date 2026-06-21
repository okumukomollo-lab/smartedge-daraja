// api/generate.js
// POST endpoint: securely proxies a request to the Anthropic API so the
// SmartEdge portal can offer an AI Content Generator (for teachers) and
// AI Tutor (for learners) without ever exposing an API key in the browser.
//
// REQUEST BODY (JSON):
//   { mode: "content" | "tutor", prompt: "...", context: {...optional...} }
//
// "content" mode is for teachers generating lesson content (exam questions,
// schemes of work, notes, summaries). "tutor" mode is for learners asking
// study questions, with extra guardrails (no doing homework verbatim, stays
// on-topic, age-appropriate, encourages understanding over answer-copying).
//
// RESPONSE: { success: true, text: "..." } or { success: false, error: "..." }
//
// ENV VARS REQUIRED:
//   ANTHROPIC_API_KEY   - from console.anthropic.com (Settings -> API Keys)

const SYSTEM_PROMPTS = {
  content: `You are an expert CBC (Competency-Based Curriculum) Junior Secondary School teaching assistant for SmartEdge Online School in Kenya, helping a teacher create lesson content for Grade 7-9 learners.

Generate clear, curriculum-aligned content the teacher can use directly: exam questions, schemes of work, lesson plans, notes, or summaries. Match the formality and structure of Kenyan CBC educational materials. Be concise and well-organised — use headings, numbered lists, and tables where useful. When generating exam questions, include a marking rubric. When the subject is Kiswahili, respond in Kiswahili unless asked otherwise.`,

  tutor: `You are a patient, encouraging AI tutor for a Grade 7-9 (Junior Secondary, CBC curriculum) learner in Kenya, used inside the SmartEdge Online School portal.

Your job is to help the learner understand concepts — not to do their homework for them. If they paste a question that looks like a graded assignment or exam question, guide them toward the answer with hints, simpler related examples, and step-by-step reasoning, rather than just stating the final answer outright. Use simple, age-appropriate language suitable for a young teenager. Be warm and encouraging. Keep answers focused and not too long. If a question is in Kiswahili, you may answer in Kiswahili. Never produce content unrelated to schoolwork, and never anything inappropriate for a minor.`
};

// Lightweight in-memory rate limiting (per server instance — good enough to
// stop accidental loops/abuse, not a substitute for a real gateway if this
// app gets large). Resets on cold start.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 12; // 12 requests per minute per IP

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Use POST' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests — please wait a moment and try again.' });
  }

  try {
    const { mode, prompt, history } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ success: false, error: 'A "prompt" string is required.' });
    }
    if (prompt.length > 6000) {
      return res.status(400).json({ success: false, error: 'Prompt is too long (max 6000 characters).' });
    }
    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.content;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'Server misconfigured: missing ANTHROPIC_API_KEY' });
    }

    // Build message history if the frontend sent prior turns (for AI Tutor chat)
    const messages = Array.isArray(history) && history.length > 0
      ? [...history, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(400).json({ success: false, error: data?.error?.message || 'AI request failed.' });
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return res.status(200).json({ success: true, text });
  } catch (err) {
    console.error('generate error', err);
    return res.status(500).json({ success: false, error: err.message || 'Unexpected server error' });
  }
};
