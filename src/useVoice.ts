import { useCallback, useEffect, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/* Speech input (microphone -> text)                                   */
/* The browser's speech API is not in TypeScript's built-in types, so  */
/* we describe the small part we use.                                  */
/* ------------------------------------------------------------------ */

interface RecognitionAlternative {
  transcript: string
}

interface RecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: RecognitionAlternative
}

interface RecognitionEvent {
  readonly results: ArrayLike<RecognitionResult>
}

interface RecognitionErrorEvent {
  readonly error: string
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionCtor = new () => Recognition

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechInputSupported = getRecognitionCtor() !== null

function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then try again.'
    case 'no-speech':
      return 'I did not hear anything. Tap the mic and try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Voice input needs an internet connection to your browser\'s speech service.'
    case 'language-not-supported':
      return 'This browser does not support that voice language.'
    default:
      return `Voice input stopped (${code}).`
  }
}

export function useSpeechInput(lang: string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)

  // Always call the newest onText without restarting the microphone.
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('This browser does not support voice input. Try Chrome or Edge.')
      return
    }
    recognitionRef.current?.abort()

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) {
        const first = event.results[i]?.[0]
        if (first) text += first.transcript
      }
      onTextRef.current(text.trim())
    }
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setError(describeError(event.error))
    }
    recognition.onend = () => {
      setListening(false)
      if (recognitionRef.current === recognition) recognitionRef.current = null
    }

    recognitionRef.current = recognition
    setError('')
    try {
      recognition.start()
      setListening(true)
    } catch {
      setError('Could not start the microphone. Please try again.')
    }
  }, [lang])

  // Finish and keep what was heard.
  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  // Cancel and throw away anything not yet delivered.
  const abort = useCallback(() => {
    recognitionRef.current?.abort()
  }, [])

  // Stop the microphone if the component disappears.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  return { supported: speechInputSupported, listening, error, start, stop, abort }
}

/* ------------------------------------------------------------------ */
/* Speech output (text -> voice)                                       */
/* ------------------------------------------------------------------ */

export const speechOutputSupported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined'

// Removes formatting and emojis, and says maths symbols as words.
function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3/gu, '')
    .replace(/√/g, ' square root of ')
    .replace(/×/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/²/g, ' squared')
    .replace(/³/g, ' cubed')
    .replace(/\s+/g, ' ')
    .trim()
}

// Browsers can cut off one very long utterance, so we read in sentences.
function toChunks(text: string): string[] {
  const sentences = text.match(/[^.!?।\n]+[.!?।]*/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && (current + sentence).length > 180) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export function stopSpeaking(): void {
  if (speechOutputSupported) window.speechSynthesis.cancel()
}

export function speak(text: string, lang: string, onEnd?: () => void): void {
  if (!speechOutputSupported) return
  const clean = cleanForSpeech(text)
  window.speechSynthesis.cancel()
  if (!clean) {
    onEnd?.()
    return
  }

  // Hindi text is read with a Hindi voice, whatever the setting says.
  const useLang = /[\u0900-\u097F]/.test(clean) ? 'hi-IN' : lang
  const voices = window.speechSynthesis.getVoices()
  const voice =
    voices.find((v) => v.lang === useLang) ??
    voices.find((v) => v.lang.startsWith(useLang.split('-')[0] ?? ''))

  const parts = toChunks(clean)
  parts.forEach((part, i) => {
    const utterance = new SpeechSynthesisUtterance(part)
    utterance.lang = useLang
    if (voice) utterance.voice = voice
    if (i === parts.length - 1) {
      utterance.onend = () => onEnd?.()
      utterance.onerror = () => onEnd?.()
    }
    window.speechSynthesis.speak(utterance)
  })
}