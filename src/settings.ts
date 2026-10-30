export interface Settings {
  speakReplies: boolean
  voiceLang: string
  background: boolean
}

export const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)' },
]

const KEY = 'lenda-ai:settings'

function defaultLang(): string {
  const preferred = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  return LANGUAGES.some((l) => l.code === preferred) ? preferred : 'en-US'
}

export function loadSettings(): Settings {
  const defaults: Settings = {
    speakReplies: false,
    voiceLang: defaultLang(),
    background: true,
  }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaults
    const data = JSON.parse(raw) as Partial<Settings>
    return {
      speakReplies:
        typeof data.speakReplies === 'boolean' ? data.speakReplies : defaults.speakReplies,
      voiceLang: LANGUAGES.some((l) => l.code === data.voiceLang)
        ? (data.voiceLang as string)
        : defaults.voiceLang,
      background: typeof data.background === 'boolean' ? data.background : defaults.background,
    }
  } catch {
    return defaults
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked or full: settings just will not be remembered.
  }
}