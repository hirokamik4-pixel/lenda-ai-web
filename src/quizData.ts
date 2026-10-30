export interface QuizQuestion {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface QuizData {
  id: string
  title: string
  questions: QuizQuestion[]
}

export const MIN_QUESTIONS = 5
export const MAX_QUESTIONS = 30
export const DEFAULT_QUESTIONS = 10

/* Pulls "photosynthesis" out of "quiz me on photosynthesis with 20 questions". */
export function extractTopic(text: string): string {
  const cleaned = text.replace(/\b(?:with|of)?\s*\d{1,3}\s*(?:questions?|qs?)\b/gi, ' ')
  const match = cleaned.match(/\b(?:on|about|for|in)\s+(.+)$/i)
  const raw = match?.[1] ?? ''
  return raw.replace(/[.!?]+$/, '').trim()
}

/* Pulls 20 out of "quiz me with 20 questions", clamped to 5 to 30. */
export function extractCount(text: string): number {
  const match = text.match(/\b(\d{1,3})\s*(?:questions?|qs?)\b/i)
  if (!match?.[1]) return DEFAULT_QUESTIONS
  const n = parseInt(match[1], 10)
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, n))
}