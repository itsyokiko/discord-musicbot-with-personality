const DEFAULT_BASE_URL = 'https://api.relink-gateway.biz.id/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const FALLBACK_MODELS = ['deepseek-v4-pro', 'auto', 'hy4'];

/**
 * Gateway kadang balas HTTP 200 tapi isinya teks error ("AI provider
 * temporarily unavailable ... Request ID: req_..."). Itu BUKAN respons model —
 * kalau tidak dideteksi, fallback tidak pernah jalan dan teks error terkirim
 * ke user sebagai "balasan Callista".
 *
 * Guard: balasan asli Callista selalu JSON (ada '"intent"'). Kalau konten
 * mengutip error di dalam JSON, biarkan lewat.
 */
function isGatewayErrorText(text) {
  const t = String(text || '');
  if (!t || t.includes('"intent"')) return false;
  return /AI provider temporarily unavailable/i.test(t)
    || /The AI provider failed to process your request/i.test(t)
    || (/UpstreamResponseCode\s*[:=]/i.test(t) && /Request ID\s*[:=]\s*req_/i.test(t))
    || (/Request ID\s*[:=]\s*req_/i.test(t) && /Billing/i.test(t));
}

// ponytail: circuit breaker in-memory (hilang saat restart). Model yang gagal
// berulang di-skip sementara supaya kuota tidak terbakar di model yang mati.
// Upgrade path: simpan ke bot_state.json kalau perlu bertahan lintas restart.
const BREAKER_FAILS = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const breaker = new Map(); // model -> { failures, openUntil }

function getLLMConfig(overrides = {}) {
  let config = {};
  try {
    // Lazy require supaya modul ini bisa dipakai tanpa efek samping saat testing.
    config = require('./storage').getConfig() || {};
  } catch (e) {}

  const baseUrl = String(
    overrides.baseUrl || process.env.RELINK_BASE_URL || config.baseUrl || DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

  const apiKey = overrides.apiKey || process.env.RELINK_API_KEY || process.env.RELINK_KEY || '';

  const model = overrides.model || process.env.RELINK_MODEL || config.model || DEFAULT_MODEL;

  return { baseUrl, apiKey, model };
}

function logUsage(prefix, usage) {
  if (!usage) return;
  const input = usage.prompt_tokens ?? '?';
  const output = usage.completion_tokens ?? '?';
  const total = usage.total_tokens ?? '?';
  console.log(`[${prefix} TOKENS] in=${input} out=${output} total=${total}`);
}

async function executeSingleCall({ messages, temperature, timeoutMs, maxTokens, model, baseUrl, apiKey }) {
  const body = {
    model,
    temperature,
    messages
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Respons kosong dari gateway');
  }

  if (isGatewayErrorText(content)) {
    // HTTP 200 tapi isinya error gateway → perlakukan sebagai gagal
    // supaya fallback ke model berikutnya jalan.
    throw new Error(`Gateway error text (model ${model}): ${content.split('\n')[0]}`);
  }

  return {
    content,
    model: data.model || model,
    usage: data.usage || null
  };
}

/**
 * Client OpenAI-compatible untuk Re:Link Gateway dengan sistem Auto-Fallback.
 * Jika model utama gagal/timeout, otomatis beralih ke model cadangan yang aktif.
 */
async function chatCompletion({
  messages,
  temperature = 0.7,
  timeoutMs = 18000,
  maxTokens,
  model,
  baseUrl,
  apiKey,
  useFallback = true
} = {}) {
  const cfg = getLLMConfig({ model, baseUrl, apiKey });

  if (!cfg.apiKey) {
    console.error('[LLM] RELINK_API_KEY belum diset di .env.');
    return null;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    console.error('[LLM] messages kosong.');
    return null;
  }

  const modelsToTry = [cfg.model];
  if (useFallback) {
    for (const fb of FALLBACK_MODELS) {
      if (!modelsToTry.includes(fb)) {
        modelsToTry.push(fb);
      }
    }
  }

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];
    const health = breaker.get(currentModel);
    if (health?.openUntil > Date.now() && modelsToTry.length > 1) {
      console.log(`[LLM SKIP] Model [${currentModel}] dibypass circuit breaker (sedang down ${BREAKER_COOLDOWN_MS / 60000} menit).`);
      continue;
    }
    try {
      const result = await executeSingleCall({
        messages,
        temperature,
        timeoutMs,
        maxTokens,
        model: currentModel,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey
      });

      if (breaker.has(currentModel)) breaker.delete(currentModel); // sehat lagi
      if (i > 0) {
        console.log(`[LLM FALLBACK SUCCESS] Berhasil mendapatkan respons menggunakan model fallback [${currentModel}].`);
      }
      return result;
    } catch (err) {
      const st = breaker.get(currentModel) || { failures: 0, openUntil: 0 };
      st.failures++;
      if (st.failures >= BREAKER_FAILS) {
        st.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
        st.failures = 0;
        console.warn(`[LLM BREAKER] Model [${currentModel}] ditandai down selama ${BREAKER_COOLDOWN_MS / 60000} menit (gagal berulang).`);
      }
      breaker.set(currentModel, st);
      console.error(`[LLM ERROR] Model [${currentModel}] gagal di ${cfg.baseUrl}: ${err.message}`);
      if (i < modelsToTry.length - 1) {
        console.log(`[LLM RETRY] Beralih ke model cadangan berikutnya [${modelsToTry[i + 1]}]...`);
      }
    }
  }

  return null;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  isGatewayErrorText,
  getLLMConfig,
  logUsage,
  chatCompletion
};
