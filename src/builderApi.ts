// Where the Axion server lives. Locally this is your own computer.
// When published, VITE_API_URL is set to the public server address.
const configured = import.meta.env.VITE_API_URL as string | undefined
const API_URL = (configured || 'http://localhost:8787').replace(/\/+$/, '')

export interface Plan {
  title: string
  summary: string
  style: string
  palette: { bg: string; surface: string; text: string; accent: string; accent2: string }
  fonts: { heading: string; body: string }
  sections: string[]
  features: string[]
  assumptions: string[]
  questions: string[]
  searchQueries: string[]
}

export interface Note {
  title: string
  url: string
  content: string
}

export interface BuildRequest {
  mode: 'create' | 'patch' | 'rewrite' | 'continue'
  brief: string
  plan?: Plan | null
  answers?: string
  notes?: Note[]
  html?: string
  instruction?: string
}

const SERVER_DOWN =
  'Cannot reach the Axion server. It may be waking up (this can take up to a minute), so please try again shortly.'

async function postJson<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort)
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error ?? `Server error (${response.status}).`)
    return data as T
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('That took too long. Please try again.')
    }
    if (error instanceof TypeError) throw new Error(SERVER_DOWN)
    throw error
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

export async function fetchPlan(
  brief: string,
  answers: string,
  useDefaults: boolean,
  signal: AbortSignal,
): Promise<Plan> {
  const data = await postJson<{ plan: Plan }>(
    '/api/build/plan',
    { brief, answers, useDefaults },
    signal,
    70_000,
  )
  return data.plan
}

export function fetchResearch(
  queries: string[],
  signal: AbortSignal,
): Promise<{ notes: Note[]; skipped?: string }> {
  return postJson('/api/build/research', { queries }, signal, 45_000)
}

/* Streams the website text as the AI writes it. */
export async function streamBuild(
  request: BuildRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ finish: string }> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/build/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(SERVER_DOWN)
  }

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error ?? `Server error (${response.status}).`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finish = 'stop'

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let data: { t?: string; done?: boolean; finish?: string; error?: string }
        try {
          data = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        if (data.error) throw new Error(data.error)
        if (data.t) onText(data.t)
        if (data.done) finish = data.finish ?? 'stop'
      }
    }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof TypeError) {
      throw new Error('The connection dropped while the site was being written. Please try again.')
    }
    throw error
  }
  return { finish }
}