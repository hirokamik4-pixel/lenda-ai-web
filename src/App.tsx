import { useEffect, useRef, useState } from 'react'
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  BookOpen,
  ExternalLink,
  MessageCircle,
  Mic,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Send,
  Settings as SettingsIcon,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react'
import './App.css'
import './Voice.css'
import ThemeBackground from './ThemeBackground'
import QuizCard from './Quiz'
import ImageCard from './ImageCard'
import RichText from './RichText'
import SettingsPanel from './SettingsPanel'
import { fetchChat } from './api'
import type { ChatTurn, Source } from './api'
import { safeUrl } from './links'
import { extractCount, extractTopic } from './quizData'
import { loadSettings, saveSettings } from './settings'
import type { Settings } from './settings'
import { speak, speechOutputSupported, stopSpeaking, useSpeechInput } from './useVoice'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Mode = 'study' | 'normal' | 'funny'
type Role = 'user' | 'assistant'
type IconType = ComponentType<{ size?: number }>

interface QuizRequest {
  topic: string
  count: number
}

interface ImageRequest {
  prompt: string
  seed: number
}

interface Message {
  id: string
  role: Role
  text: string
  mode?: Mode
  label?: string // small badge under assistant messages
  quiz?: QuizRequest // set when the message includes a quiz setup card
  image?: ImageRequest // set when the message includes a generated image
  sources?: Source[] // web pages the answer was based on
  notice?: string // small warning line, for example "web search failed"
  skipAi?: boolean // true for messages that are not real AI chat replies
}

interface Conversation {
  id: string
  title: string
  mode: Mode // every chat belongs to one mode
  messages: Message[]
}

interface ModeConfig {
  id: Mode
  label: string
  emoji: string
  Icon: IconType
  heading: string
  tagline: string
  placeholder: string
  suggestions: string[]
}

/* ------------------------------------------------------------------ */
/* Static data                                                         */
/* ------------------------------------------------------------------ */

const MODE_ORDER: Mode[] = ['study', 'normal', 'funny']

const MODE_CONFIG: Record<Mode, ModeConfig> = {
  study: {
    id: 'study',
    label: 'Study',
    emoji: '📚',
    Icon: BookOpen,
    heading: 'Ready to study? 🎓',
    tagline:
      'Step-by-step explanations and AI quizzes on any topic. Type "quiz me on ..." to start one.',
    placeholder: 'Ask a question, or type "quiz me on ..." ✏️',
    suggestions: [
      '🌱 Explain photosynthesis simply',
      '🧠 Quiz me on the French Revolution',
      '🔎 Search for class 10 maths previous year papers',
    ],
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    emoji: '💬',
    Icon: MessageCircle,
    heading: 'How can I help today? ✨',
    tagline: 'A balanced assistant. It can search the web for current info and generate images.',
    placeholder: 'Message LENDA AI…',
    suggestions: [
      '🌦️ What is the weather in Delhi today?',
      '🎨 Generate an image of a robot reading a book',
      '✉️ Draft a polite email asking for a deadline extension',
    ],
  },
  funny: {
    id: 'funny',
    label: 'Funny',
    emoji: '🤪',
    Icon: Smile,
    heading: "Let's have some fun! 🎉",
    tagline: 'Playful answers and friendly jokes.',
    placeholder: 'Ask me anything, I dare you… 😜',
    suggestions: [
      '💻 Tell me a joke about computers',
      '🎨 Draw a cat wearing sunglasses',
      '📋 Roast my to-do list (gently)',
    ],
  },
}

const QUIZ_REQUEST = /\b(quiz|quizzes|test me|practice questions)\b/i

// "generate an image of ...", "draw a dragon", "create a logo for ...", "picture of ..."
const IMAGE_REQUEST =
  /\b(?:generate|create|make|draw|paint|design|produce|render|show me|give me)\b[^.?!]*\b(?:images?|pictures?|photos?|illustrations?|drawings?|paintings?|logos?|wallpapers?|posters?|artworks?)\b|\b(?:image|picture|photo|illustration|drawing|painting|logo|wallpaper|poster) of\b|^\s*draw\b/i
// Questions ABOUT making images (code, tutorials) should go to the chat instead.
const IMAGE_EXCLUDE = /\b(?:how (?:to|do|can)|code|python|javascript|api|function|script|program|tutorial|explain)\b/i

const FIRST_ID = 'welcome'
const STORAGE_KEY = 'lenda-ai:v1'

const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: FIRST_ID,
    title: 'Welcome to LENDA AI',
    mode: 'normal',
    messages: [
      {
        id: 'seed-1',
        role: 'assistant',
        mode: 'normal',
        label: 'Welcome message',
        skipAi: true,
        text: '👋 Welcome to LENDA AI, created by Ayush! Ask me anything. I can search the web for current things like weather and news, generate images ("generate an image of ..."), listen with the 🎤 mic, and read answers aloud. Each mode has its own chats, and your history is on the left.',
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeTitle(text: string): string {
  return text.length > 36 ? `${text.slice(0, 36).trimEnd()}…` : text
}

function createConversation(mode: Mode): Conversation {
  return { id: makeId(), title: 'New conversation', mode, messages: [] }
}

function isMode(value: unknown): value is Mode {
  return value === 'study' || value === 'normal' || value === 'funny'
}

// "generate an image of a cat" -> "a cat"
function extractImagePrompt(text: string): string {
  const cleaned = text
    .replace(
      /^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:generate|create|make|draw|paint|design|produce|render|show|give)\s+(?:me\s+)?(?:an?\s+|the\s+|some\s+)?(?:(?:ai\s+)?(?:images?|pictures?|photos?|illustrations?|drawings?|paintings?)\s*)?(?:of\s+|for\s+)?/i,
      '',
    )
    .trim()
  return (cleaned.length >= 3 ? cleaned : text.trim()).slice(0, 500)
}

/* Loads saved chats from this browser (localStorage). Falls back to the
   welcome chat if nothing is saved or the data looks broken. */
function loadSaved(): { conversations: Conversation[]; activeId: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as { conversations?: unknown; activeId?: unknown }
      if (Array.isArray(data.conversations)) {
        const list = (data.conversations as Conversation[]).filter(
          (c) =>
            c &&
            typeof c.id === 'string' &&
            typeof c.title === 'string' &&
            isMode(c.mode) &&
            Array.isArray(c.messages),
        )
        const first = list[0]
        if (first) {
          const saved = list.find((c) => c.id === data.activeId)
          return { conversations: list, activeId: (saved ?? first).id }
        }
      }
    }
  } catch {
    // Broken or blocked storage: start fresh below.
  }
  return { conversations: SEED_CONVERSATIONS, activeId: FIRST_ID }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  open: boolean
  isMobile: boolean
  conversations: Conversation[]
  activeId: string
  settingsRef: RefObject<HTMLButtonElement | null>
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClose: () => void
  onOpenSettings: () => void
}

function Sidebar({
  open,
  isMobile,
  conversations,
  activeId,
  settingsRef,
  onSelect,
  onNew,
  onDelete,
  onClose,
  onOpenSettings,
}: SidebarProps) {
  return (
    <motion.aside
      className={isMobile ? 'sidebar sidebar--drawer' : 'sidebar'}
      aria-label="Conversations"
      initial={false}
      animate={
        isMobile
          ? { width: 288, x: open ? 0 : '-100%' }
          : { width: open ? 288 : 0, x: 0 }
      }
      transition={{ type: 'spring', stiffness: 360, damping: 38 }}
      inert={!open}
    >
      <div className="sidebar__inner">
        <div className="sidebar__header">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <span className="brand__name">LENDA AI</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <PanelLeftClose size={20} />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={onNew}>
          <Plus size={18} />
          New conversation
        </button>

        <h2 className="sidebar__label">Chat history</h2>
        <ul className="history">
          {conversations.map((c) => {
            const { emoji, label } = MODE_CONFIG[c.mode]
            return (
              <li
                key={c.id}
                className={c.id === activeId ? 'history__item is-active' : 'history__item'}
              >
                <button
                  type="button"
                  className="history__select"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  aria-label={`${c.title} (${label} mode)`}
                >
                  <span className="history__emoji" aria-hidden="true">
                    {emoji}
                  </span>
                  {c.title}
                </button>
                <button
                  type="button"
                  className="history__delete"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete conversation: ${c.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            )
          })}
        </ul>

        <button
          ref={settingsRef}
          type="button"
          className="sidebar__settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={18} />
          Settings
        </button>

        <div className="sidebar__footer">
          <p>Chats are saved in this browser only</p>
          <p>Created by Ayush</p>
        </div>
      </div>
    </motion.aside>
  )
}

interface ModeSwitcherProps {
  mode: Mode
  onChange: (mode: Mode) => void
}

function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <div className="mode-switch" role="group" aria-label="Assistant mode">
      {MODE_ORDER.map((id) => {
        const { label, emoji } = MODE_CONFIG[id]
        const selected = id === mode
        return (
          <button
            key={id}
            type="button"
            className={selected ? 'mode-switch__btn is-selected' : 'mode-switch__btn'}
            aria-pressed={selected}
            aria-label={`${label} mode`}
            onClick={() => onChange(id)}
          >
            {selected && (
              <motion.span
                layoutId="mode-pill"
                className="mode-switch__pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="mode-switch__content">
              <span className="mode-switch__emoji" aria-hidden="true">
                {emoji}
              </span>
              <span className="mode-switch__label">{label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface WelcomeProps {
  mode: Mode
  onPick: (text: string) => void
}

function Welcome({ mode, onPick }: WelcomeProps) {
  const config = MODE_CONFIG[mode]
  return (
    <motion.div
      className="welcome"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        key={`emoji-${mode}`}
        className="welcome__emoji-wrap"
        aria-hidden="true"
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
      >
        <span className="welcome__emoji">{config.emoji}</span>
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <h2 className="welcome__heading">{config.heading}</h2>
          <p className="welcome__tagline">{config.tagline}</p>
        </motion.div>
      </AnimatePresence>
      <div className="chips">
        {config.suggestions.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

interface MessageBubbleProps {
  message: Message
  speaking: boolean
  canSpeak: boolean
  onSpeak: () => void
}

function MessageBubble({ message, speaking, canSpeak, onSpeak }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const sources = message.sources ?? []
  return (
    <motion.div
      className={isUser ? 'msg msg--user' : 'msg msg--assistant'}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      {!isUser && (
        <span className="avatar" aria-hidden="true">
          <Sparkles size={16} />
        </span>
      )}
      <div className="msg__body">
        {isUser ? (
          <div className="msg__bubble">{message.text}</div>
        ) : (
          <div className="msg__bubble msg__bubble--rich">
            <RichText text={message.text} sources={sources} />
          </div>
        )}
        {message.image && <ImageCard prompt={message.image.prompt} seed={message.image.seed} />}
        {message.quiz && (
          <QuizCard initialTopic={message.quiz.topic} initialCount={message.quiz.count} />
        )}
        {!isUser && sources.length > 0 && (
          <div className="sources">
            <span className="sources__title">🌐 Sources</span>
            <ul className="sources__list">
              {sources.map((source, i) => {
                const href = safeUrl(source.url)
                if (!href) return null
                return (
                  <li key={href}>
                    <a
                      className="sources__link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="sources__num">{i + 1}</span>
                      <span className="sources__text">{source.title}</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {!isUser && message.notice && <p className="msg__notice">⚠️ {message.notice}</p>}
        {!isUser && (message.label || canSpeak) && (
          <div className="msg__meta">
            {message.label && <span className="badge">{message.label}</span>}
            {canSpeak && (
              <button
                type="button"
                className={speaking ? 'speak-btn is-speaking' : 'speak-btn'}
                onClick={onSpeak}
                aria-pressed={speaking}
                aria-label={speaking ? 'Stop reading this reply' : 'Read this reply aloud'}
              >
                {speaking ? <Square size={12} /> : <Volume2 size={13} />}
                {speaking ? 'Stop' : 'Listen'}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function TypingIndicator() {
  return (
    <motion.div
      className="msg msg--assistant"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <span className="avatar" aria-hidden="true">
        <Sparkles size={16} />
      </span>
      <div className="msg__body">
        <div className="msg__bubble typing" role="status" aria-label="LENDA AI is thinking">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="typing__dot"
              animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  placeholder: string
  voiceLang: string
}

function Composer({ value, onChange, onSend, disabled, placeholder, voiceLang }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const baseRef = useRef('') // text that was already in the box when the mic started

  const voice = useSpeechInput(voiceLang, (heard) => {
    const base = baseRef.current
    onChange(base && heard ? `${base} ${heard}` : base || heard)
  })

  // Grow the textarea as the user types (up to 180px).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !disabled

  function submit() {
    if (!canSend) return
    voice.abort() // stop listening so late speech does not refill the box
    onSend()
  }

  function toggleMic() {
    if (voice.listening) {
      voice.stop()
    } else {
      baseRef.current = value.trim()
      voice.start()
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer-wrap">
      {voice.error && (
        <p className="voice-note" role="alert">
          🎤 {voice.error}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <button
          type="button"
          className={voice.listening ? 'icon-btn is-listening' : 'icon-btn'}
          disabled={!voice.supported}
          onClick={toggleMic}
          aria-pressed={voice.listening}
          aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
          title={
            voice.supported
              ? voice.listening
                ? 'Stop listening'
                : 'Speak your message'
              : 'Voice input needs Chrome or Edge'
          }
        >
          <Mic size={20} />
        </button>
        <textarea
          ref={ref}
          className="composer__input"
          rows={1}
          value={value}
          placeholder={voice.listening ? 'Listening… speak now 🎤' : placeholder}
          aria-label="Message"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <motion.button
          type="submit"
          className="send-btn"
          disabled={!canSend}
          aria-label="Send message"
          whileHover={canSend ? { scale: 1.06 } : undefined}
          whileTap={canSend ? { scale: 0.92 } : undefined}
        >
          <Send size={18} />
        </motion.button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

function App() {
  const isMobile = useMediaQuery('(max-width: 820px)')
  const [conversations, setConversations] = useState<Conversation[]>(
    () => loadSaved().conversations,
  )
  const [activeId, setActiveId] = useState<string>(() => loadSaved().activeId)
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [typingIds, setTypingIds] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)

  const endRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const activeIdRef = useRef(activeId)

  const sidebarOpen = isMobile ? drawerOpen : desktopOpen
  const active = conversations.find((c) => c.id === activeId)
  const mode: Mode = active?.mode ?? 'normal' // the mode comes from the open chat
  const messages = active?.messages ?? []
  const isTyping = typingIds.includes(activeId)

  // Apply the open chat's theme (CSS variables switch on data-mode).
  useEffect(() => {
    document.documentElement.dataset.mode = mode
  }, [mode])

  // Remember which chat is open (used to decide whether to speak a late reply).
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  // Save chats and settings in this browser whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeId }))
    } catch {
      // Storage full or blocked: the app still works, chats just are not saved.
    }
  }, [conversations, activeId])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Stop reading aloud when switching chats or closing the app.
  useEffect(() => {
    return () => {
      stopSpeaking()
      setSpeakingId(null)
    }
  }, [activeId])

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!(isMobile && drawerOpen)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, drawerOpen])

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeId, messages.length, isTyping])

  function setSidebarOpen(open: boolean) {
    if (isMobile) setDrawerOpen(open)
    else setDesktopOpen(open)
  }

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function openSettings() {
    setSettingsOpen(true)
    if (isMobile) setDrawerOpen(false)
  }

  function closeSettings() {
    setSettingsOpen(false)
    settingsBtnRef.current?.focus()
  }

  function selectConversation(id: string) {
    setActiveId(id) // the mode and theme follow the chat automatically
    if (isMobile) setDrawerOpen(false)
  }

  function changeMode(next: Mode) {
    if (next === mode) return

    // An empty chat has nothing to lose, so just change its mode.
    if (active && active.messages.length === 0) {
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, mode: next } : c)),
      )
      return
    }

    // Otherwise open a chat in the new mode (reuse an empty one if it exists).
    const empty = conversations.find((c) => c.mode === next && c.messages.length === 0)
    if (empty) {
      setActiveId(empty.id)
      return
    }
    const fresh = createConversation(next)
    setConversations((prev) => [fresh, ...prev])
    setActiveId(fresh.id)
  }

  function newConversation() {
    // Reuse the current chat if it is still empty.
    if (active && active.messages.length === 0) {
      if (isMobile) setDrawerOpen(false)
      return
    }
    const fresh = createConversation(mode)
    setConversations((prev) => [fresh, ...prev])
    setActiveId(fresh.id)
    if (isMobile) setDrawerOpen(false)
  }

  function deleteConversation(id: string) {
    const remaining = conversations.filter((c) => c.id !== id)
    if (remaining.length === 0) {
      const fresh = createConversation(mode)
      setConversations([fresh])
      setActiveId(fresh.id)
      return
    }
    setConversations(remaining)
    const next = remaining[0]
    if (next && id === activeId) setActiveId(next.id)
  }

  function clearAllChats() {
    const fresh = createConversation(mode)
    setConversations([fresh])
    setActiveId(fresh.id)
    setSettingsOpen(false)
  }

  function appendMessage(conversationId: string, message: Message) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, messages: [...c.messages, message] } : c,
      ),
    )
  }

  function startSpeaking(id: string, text: string) {
    setSpeakingId(id)
    speak(text, settings.voiceLang, () =>
      setSpeakingId((current) => (current === id ? null : current)),
    )
  }

  function toggleSpeak(message: Message) {
    if (speakingId === message.id) {
      stopSpeaking()
      setSpeakingId(null)
    } else {
      startSpeaking(message.id, message.text)
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !active || typingIds.includes(active.id)) return

    const targetId = active.id
    const replyMode = mode
    const userMessage: Message = { id: makeId(), role: 'user', text: trimmed }
    const history = [...active.messages, userMessage]

    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetId
          ? {
              ...c,
              title: c.messages.length === 0 ? makeTitle(trimmed) : c.title,
              messages: [...c.messages, userMessage],
            }
          : c,
      ),
    )
    setDraft('')

    // Quiz requests show the quiz setup card (the card talks to the AI itself).
    if (QUIZ_REQUEST.test(trimmed)) {
      if (replyMode !== 'study') {
        appendMessage(targetId, {
          id: makeId(),
          role: 'assistant',
          mode: replyMode,
          label: 'LENDA AI',
          skipAi: true,
          text: '🧠 Quizzes live in Study mode. Tap 📚 Study in the top bar (it opens a Study chat), then ask again!',
        })
      } else {
        appendMessage(targetId, {
          id: makeId(),
          role: 'assistant',
          mode: replyMode,
          label: 'LENDA AI · Study mode',
          skipAi: true,
          text: '🧠 Set up your quiz below: pick any topic and 5 to 30 questions. The AI writes the questions, so double-check anything important.',
          quiz: { topic: extractTopic(trimmed), count: extractCount(trimmed) },
        })
      }
      return
    }

    // Image requests show an image card (the card talks to the server itself).
    if (IMAGE_REQUEST.test(trimmed) && !IMAGE_EXCLUDE.test(trimmed)) {
      appendMessage(targetId, {
        id: makeId(),
        role: 'assistant',
        mode: replyMode,
        label: 'AI-generated image',
        skipAi: true,
        text: '🎨 Here is your image. An AI image service made it, so it may not match your words perfectly. Use "New version" for another try.',
        image: {
          prompt: extractImagePrompt(trimmed),
          seed: Math.floor(Math.random() * 1_000_000),
        },
      })
      return
    }

    // Normal chat: send the conversation to the AI through our server.
    setTypingIds((prev) => [...prev, targetId])
    try {
      const turns: ChatTurn[] = history
        .filter((m) => !m.skipAi)
        .map((m) => ({ role: m.role, text: m.text }))
      const result = await fetchChat(replyMode, turns)
      const searched = result.sources.length > 0
      const label = [
        'AI response',
        searched ? 'Web search' : '',
        `${MODE_CONFIG[replyMode].label} mode`,
      ]
        .filter(Boolean)
        .join(' · ')

      const replyId = makeId()
      appendMessage(targetId, {
        id: replyId,
        role: 'assistant',
        text: result.reply,
        mode: replyMode,
        label,
        ...(searched ? { sources: result.sources } : {}),
        ...(result.searchError ? { notice: result.searchError } : {}),
      })
      // Read it aloud if auto-speak is on and the user is still looking at this chat.
      if (settings.speakReplies && speechOutputSupported && activeIdRef.current === targetId) {
        startSpeaking(replyId, result.reply)
      }
    } catch (error) {
      appendMessage(targetId, {
        id: makeId(),
        role: 'assistant',
        mode: replyMode,
        label: 'Error',
        skipAi: true,
        text: `⚠️ ${error instanceof Error ? error.message : 'Something went wrong.'}`,
      })
    } finally {
      setTypingIds((prev) => prev.filter((id) => id !== targetId))
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        {settings.background && <ThemeBackground mode={mode} />}
        <AnimatePresence>
          {isMobile && sidebarOpen && (
            <motion.div
              key="backdrop"
              className="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        <Sidebar
          open={sidebarOpen}
          isMobile={isMobile}
          conversations={conversations}
          activeId={activeId}
          settingsRef={settingsBtnRef}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={deleteConversation}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={openSettings}
        />

        <div className="main">
          <header className="topbar">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
            </button>
            <h1 className="topbar__title">{active?.title ?? 'LENDA AI'}</h1>
            <ModeSwitcher mode={mode} onChange={changeMode} />
          </header>

          <main className="chat">
            <div className="chat__inner" key={activeId} role="log" aria-live="polite">
              {messages.length === 0 && <Welcome mode={mode} onPick={send} />}
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  speaking={speakingId === m.id}
                  canSpeak={speechOutputSupported && m.role === 'assistant' && !m.skipAi}
                  onSpeak={() => toggleSpeak(m)}
                />
              ))}
              <AnimatePresence>{isTyping && <TypingIndicator key="typing" />}</AnimatePresence>
              <div ref={endRef} />
            </div>
          </main>

          <footer className="footer">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => send(draft)}
              disabled={isTyping}
              placeholder={MODE_CONFIG[mode].placeholder}
              voiceLang={settings.voiceLang}
            />
            <p className="footer__note">
              AI can make mistakes, so check important facts. Web searches and image descriptions
              are sent to third-party services. Chats are saved in this browser only.
            </p>
          </footer>
        </div>

        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              key="settings"
              settings={settings}
              onChange={updateSettings}
              onClearChats={clearAllChats}
              onClose={closeSettings}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

export default App 