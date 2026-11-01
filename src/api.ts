import type { QuizQuestion } from './quizData'

// Where the Axion server lives. Locally this is your own computer.
// When published, VITE_API_URL is set to the public server address.
const configured = import.meta.env.VITE_API_URL as string | undefined
const API_URL = (configured || 'http://localhost:8787').replace(/\/+$/, '')

export type ApiMode = 'study' | 'normal' | 'funny'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface Source {
  title: string
  url: string
}

export interface ChatResult {
  reply: string
  sources: Source[]
  searchError: string
}

export interface QuizResponse {
  title: string
  questions: QuizQuestion[]
  requested: number
  shortBy: number
}

const SERVER_DOWN =
  'Cannot reach the Axion server. It may be waking up (this can take up to a minute), so please try again shortly.'

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(data?.error ?? `Server error (${response.status}).`)
    }
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The AI took too long to answer. Please try again.')
    }
    if (error instanceof TypeError) {
      throw new Error(SERVER_DOWN)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function fetchChat(mode: ApiMode, turns: ChatTurn[]): Promise<ChatResult> {
  const data = await post<{ reply: string; sources?: Source[]; searchError?: string }>(
    '/api/chat',
    { mode, messages: turns },
    120_000,
  )
  return {
    reply: data.reply.trim() || '(The AI sent an empty reply. Please try again.)',
    sources: Array.isArray(data.sources) ? data.sources : [],
    searchError: data.searchError ?? '',
  }
}

export function fetchQuiz(topic: string, count: number): Promise<QuizResponse> {
  return post<QuizResponse>('/api/quiz', { topic, count }, 120_000)
}

export async function fetchImage(
  prompt: string,
  seed: number,
  signal: AbortSignal,
): Promise<Blob> {
  const params = new URLSearchParams({ prompt, seed: String(seed) })
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/image?${params}`, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(SERVER_DOWN)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error ?? `Image error (${response.status}).`)
  }
  return response.blob()
}

// Wake a sleeping free-tier server as soon as the page opens.
void fetch(`${API_URL}/api/health`).catch(() => {
  // Ignore: the first real request will show a clear message if it is still down.
})