import 'dotenv/config'

/* ------------------------------------------------------------------ */
/* One place for all AI calls: model fallback, cooldowns, retries.     */
/* ------------------------------------------------------------------ */

const GROQ_BASE = 'https://api.groq.com/openai/v1'

// Preferred models, best first. Only models your Groq account really has are used.
// Free limits are per model, so having several to fall back on multiplies capacity.
const CHAT_PREFS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
]
const BUILD_PREFS = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]

const groqKey = () => process.env.GROQ_API_KEY
export const hasLlmKey = () => Boolean(groqKey())

let available = null // Set of model ids your Groq account can use (null until discovered)
const cooldown = new Map() // "Provider:model" -> { until, daily }

async function discoverModels() {
  if (!groqKey()) return
  try {
    const response = await fetch(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${groqKey()}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return
    const data = await response.json()
    const ids = (Array.isArray(data.data) ? data.data : []).map((m) => m?.id).filter(Boolean)
    if (ids.length > 0) available = new Set(ids)
  } catch {
    // Keep what we had. The fallback chain still works without this list.
  }
}

export async function startModelDiscovery() {
  await discoverModels()
  setInterval(() => void discoverModels(), 6 * 60 * 60_000).unref()
}

const listFrom = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function chainFor(purpose) {
  const explicit = listFrom(purpose === 'build' ? process.env.BUILD_MODELS : process.env.CHAT_MODELS)
  const single = purpose === 'build' ? process.env.BUILD_MODEL : process.env.GROQ_MODEL
  const prefs = purpose === 'build' ? BUILD_PREFS : CHAT_PREFS
  const wanted = explicit.length > 0 ? explicit : [single, ...prefs].filter(Boolean)
  const unique = [...new Set(wanted)]
  const usable = available ? unique.filter((id) => available.has(id)) : unique
  const targets = (usable.length > 0 ? usable : unique).map((id) => ({
    id,
    base: GROQ_BASE,
    key: groqKey(),
    provider: 'Groq',
  }))

  // Optional second provider with its own free allowance (any OpenAI-compatible API).
  const extraUrl = process.env.EXTRA_API_URL
  const extraKey = process.env.EXTRA_API_KEY
  const extraModel = process.env.EXTRA_MODEL
  if (extraUrl && extraKey && extraModel) {
    targets.push({
      id: extraModel,
      base: extraUrl.replace(/\/+$/, ''),
      key: extraKey,
      provider: 'Extra',
    })
  }
  return targets
}

export function describeChains() {
  return {
    chat: chainFor('chat').map((t) => `${t.provider}:${t.id}`),
    build: chainFor('build').map((t) => `${t.provider}:${t.id}`),
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
      },
      { once: true },
    )
  })
}

// How many seconds the provider asks us to wait.
function retrySeconds(response, text) {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return header
  const match = text.match(/try again in (?:(\d+)m)?\s*([\d.]+)s/i)
  if (match) return Number(match[1] ?? 0) * 60 + Number(match[2])
  return 30
}

function failure(result) {
  const error = new Error(`AI returned ${result.status}: ${String(result.text).slice(0, 300)}`)
  error.status = result.status
  return error
}

// Tries one model. Handles two small problems by itself:
// a model that dislikes reasoning_effort, and a request that is slightly too big.
async function tryTarget(target, body, reasoning, signal) {
  let payload = { ...body }
  let useReasoning = Boolean(reasoning) && target.id.includes('gpt-oss')

  for (let attempt = 0; attempt < 3; attempt++) {
    const send = { model: target.id, ...payload }
    if (useReasoning) send.reasoning_effort = reasoning

    let response
    try {
      response = await fetch(`${target.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.key}` },
        body: JSON.stringify(send),
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      return { ok: false, status: 0, text: String(error?.message ?? error), retry: 0 }
    }

    if (response.ok) return { ok: true, response }

    const text = await response.text().catch(() => '')

    if (response.status === 400 && useReasoning && /reasoning/i.test(text)) {
      useReasoning = false
      continue
    }

    if (response.status === 413) {
      const match = text.match(/Limit (\d+), Requested (\d+)/i)
      const current = Number(payload.max_tokens) || 0
      if (match && current) {
        const shorter = current - (Number(match[2]) - Number(match[1])) - 300
        if (shorter >= 2500) {
          payload = { ...payload, max_tokens: shorter }
          continue
        }
      }
    }

    return { ok: false, status: response.status, text, retry: retrySeconds(response, text) }
  }
  return { ok: false, status: 413, text: 'Request too large', retry: 0 }
}

/* Sends a chat request. Goes down the model list when one is rate limited.
   purpose: 'chat' or 'build'. Returns { response, model, provider }. */
export async function llmFetch(purpose, body, signal) {
  const { reasoning, ...rest } = body
  let lastFailure = null

  for (let round = 0; round < 2; round++) {
    const limits = [] // { seconds, daily } for every model that is rate limited

    for (const target of chainFor(purpose)) {
      const key = `${target.provider}:${target.id}`
      const cool = cooldown.get(key)
      if (cool && cool.until > Date.now()) {
        limits.push({ seconds: (cool.until - Date.now()) / 1000, daily: cool.daily })
        continue
      }

      const result = await tryTarget(target, rest, reasoning, signal)
      if (result.ok) return { response: result.response, model: target.id, provider: target.provider }
      lastFailure = result

      if (result.status === 400) throw failure(result)
      if (result.status === 401 && target.provider === 'Groq') throw failure(result)
      if (result.status === 429) {
        const daily = /per day|\bTPD\b|\bRPD\b/i.test(result.text)
        const seconds = Math.max(1, result.retry)
        cooldown.set(key, { until: Date.now() + seconds * 1000, daily })
        limits.push({ seconds, daily })
      }
      // 404, 413, 5xx or a network problem: just try the next model.
    }

    const shortest = limits.length > 0 ? Math.min(...limits.map((l) => l.seconds)) : 0
    if (round === 0 && shortest > 0 && shortest <= 15) {
      await sleep(Math.ceil(shortest * 1000) + 300, signal)
      continue
    }

    const error = new Error(
      lastFailure
        ? `AI failed: ${lastFailure.status} ${String(lastFailure.text).slice(0, 200)}`
        : 'No AI model is available.',
    )
    error.status = limits.length > 0 ? 429 : lastFailure?.status || 502
    error.retryAfter = Math.ceil(shortest)
    error.daily = limits.length > 0 && limits.every((l) => l.daily)
    throw error
  }
  throw new Error('AI request failed.')
}

/* Turns an error into a short message for people. */
export function describeLlmError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return { status: 504, message: 'The AI took too long. Please try again.' }
  }
  if (error?.status === 429) {
    if (error.daily) {
      return {
        status: 429,
        message:
          'The free AI limit for today is used up on every model. It resets within about a day. You can also add another AI provider in server/.env.',
      }
    }
    const wait = Number(error.retryAfter) || 0
    const when =
      wait > 90 ? `about ${Math.ceil(wait / 60)} minutes` : wait > 0 ? `about ${wait} seconds` : 'a minute'
    return { status: 429, message: `The free AI limit is busy right now. Try again in ${when}.` }
  }
  if (error?.status === 413) {
    return {
      status: 413,
      message: 'That request is too big for the free AI limits. Try something shorter or simpler.',
    }
  }
  return { status: 502, message: 'The AI service had a problem. Check the server terminal for details.' }
}