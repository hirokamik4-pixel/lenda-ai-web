import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Download, RefreshCw, Send, Square, X } from 'lucide-react'
import CodeBlock from './CodeBlock'
import GalaxyBackground from './GalaxyBackground'
import { fetchPlan, fetchResearch, streamBuild } from './builderApi'
import type { Note, Plan } from './builderApi'
import {
  applyPatches,
  downloadHtml,
  extractHtml,
  isComplete,
  isRefusal,
  joinContinuation,
  previewDoc,
  repairHtml,
} from './builderUtils'
import { safeUrl } from './links'
import './Builder.css'

/* ------------------------------------------------------------------ */
/* Types and data                                                      */
/* ------------------------------------------------------------------ */

type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error'

interface Step {
  id: string
  label: string
  status: StepStatus
  detail?: string
}

interface Msg {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface Version {
  id: string
  label: string
  html: string
}

interface History {
  versions: Version[]
  index: number
}

interface Project {
  messages: Msg[]
  history: History
  plan: Plan | null
  brief: string
}

const STORAGE_KEY = 'axion:builder:v1'
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals'

// Messages that sound like a request for a brand-new website, such as
// "make a landing page for my school". Editing words like "make the header dark" do not match.
const NEW_SITE = new RegExp(
  '\\b(?:make|build|create|design|generate|develop)\\b[^.?!]{0,20}?\\b(?:a|an|another|new)\\s+(?:[\\w-]+\\s+){0,2}(?:landing\\s*page|web\\s*site|website|web\\s*page|homepage|portfolio|site)\\b',
  'i',
)

// A "refusal" is only real when it is about safety. Anything else is the AI giving up on a big edit.
const SAFETY =
  /phish|imperson|malware|scam|illegal|sexual|hate|harm|fraud|fake login|weapon|violen|abuse|exploit/i

const CREATE_STEPS: Step[] = [
  { id: 'plan', label: 'Understand your idea and plan the design', status: 'pending' },
  { id: 'ask', label: 'Ask for any missing details', status: 'pending' },
  { id: 'research', label: 'Research the web for facts', status: 'pending' },
  { id: 'write', label: 'Write the website', status: 'pending' },
  { id: 'check', label: 'Check and fix the file', status: 'pending' },
  { id: 'ready', label: 'Open the live preview', status: 'pending' },
]

const EDIT_STEPS: Step[] = [
  { id: 'write', label: 'Apply your change', status: 'pending' },
  { id: 'check', label: 'Check and fix the file', status: 'pending' },
  { id: 'ready', label: 'Refresh the live preview', status: 'pending' },
]

const FINISH_STEPS: Step[] = [
  { id: 'write', label: 'Finish writing the site', status: 'pending' },
  { id: 'check', label: 'Check and fix the file', status: 'pending' },
  { id: 'ready', label: 'Refresh the live preview', status: 'pending' },
]

const STARTERS = [
  '🍕 A restaurant website with a menu and table booking',
  '📸 A portfolio for a wedding photographer',
  '🏋️ A landing page for a fitness app',
  '🏫 A coaching class website with courses and a fee table',
]

const EDIT_IDEAS = [
  '🎨 Make it more colourful',
  '🌙 Switch to a light theme',
  '➕ Add a pricing section',
  '❓ Add an FAQ section',
  '📱 Improve the mobile layout',
  '✨ Add more animations',
]

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadProject(): Project {
  const empty: Project = {
    messages: [],
    history: { versions: [], index: -1 },
    plan: null,
    brief: '',
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const data = JSON.parse(raw) as Partial<Project>

    const savedHistory = data.history
    const savedVersions = savedHistory && Array.isArray(savedHistory.versions) ? savedHistory.versions : []
    const versions = savedVersions.filter(
      (v) =>
        !!v &&
        typeof v.id === 'string' &&
        typeof v.label === 'string' &&
        typeof v.html === 'string',
    )
    const savedMessages = Array.isArray(data.messages) ? data.messages : []
    const messages = savedMessages.filter(
      (m) =>
        !!m &&
        typeof m.id === 'string' &&
        typeof m.text === 'string' &&
        (m.role === 'user' || m.role === 'assistant'),
    )
    const rawIndex = typeof savedHistory?.index === 'number' ? savedHistory.index : versions.length - 1
    const index = Math.min(Math.max(rawIndex, versions.length > 0 ? 0 : -1), versions.length - 1)
    const plan = data.plan && typeof data.plan.title === 'string' ? data.plan : null
    return {
      messages,
      history: { versions, index },
      plan,
      brief: typeof data.brief === 'string' ? data.brief : '',
    }
  } catch {
    return empty
  }
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

function StepMark({ status }: { status: StepStatus }) {
  if (status === 'active') return <span className="spin" aria-hidden="true" />
  const mark =
    status === 'done' ? '✓' : status === 'error' ? '!' : status === 'skipped' ? '–' : '○'
  return <span aria-hidden="true">{mark}</span>
}

function Checklist({ steps, liveKb }: { steps: Step[]; liveKb: number }) {
  const finished = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const percent = Math.round((finished / steps.length) * 100)
  return (
    <div className="steps">
      <div className="steps__bar" aria-hidden="true">
        <motion.div
          className="steps__bar-fill"
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 160, damping: 22 }}
        />
      </div>
      <ol className="steps__list" aria-live="polite">
        {steps.map((step) => {
          const detail =
            step.id === 'write' && step.status === 'active' && liveKb > 0
              ? `${liveKb} KB written…`
              : step.detail
          return (
            <motion.li
              key={step.id}
              className={`steps__item is-${step.status}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <span className="steps__mark">
                <StepMark status={step.status} />
              </span>
              <span className="steps__text">
                <span className="steps__label">{step.label}</span>
                <span className="sr"> ({step.status})</span>
                {detail && <span className="steps__detail">{detail}</span>}
              </span>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export default function Builder({ active }: { active: boolean }) {
  const [initial] = useState(loadProject)
  const [messages, setMessages] = useState<Msg[]>(initial.messages)
  const [history, setHistory] = useState<History>(initial.history)
  const [plan, setPlan] = useState<Plan | null>(initial.plan)
  const [brief, setBrief] = useState(initial.brief)
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<{ brief: string; plan: Plan } | null>(null)
  const [askNew, setAskNew] = useState<string | null>(null)
  const [answerDrafts, setAnswerDrafts] = useState<string[]>([])
  const [liveCode, setLiveCode] = useState('')
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'phone'>('desktop')
  const [mobileView, setMobileView] = useState<'chat' | 'work'>('chat')
  const [useResearch, setUseResearch] = useState(true)
  const [draft, setDraft] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [fullscreen, setFullscreen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [failedEdit, setFailedEdit] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [copied, setCopied] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const liveRef = useRef('')
  const liveTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const liveEl = useRef<HTMLPreElement>(null)

  const current = history.versions[history.index]
  const html = current?.html ?? ''
  const doc = useMemo(() => previewDoc(html), [html])
  const hasProject = history.versions.length > 0
  const frameWidth = device === 'desktop' ? '100%' : device === 'tablet' ? '768px' : '390px'

  /* ---- Effects ---- */

  // Save the project in this browser.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ messages: messages.slice(-40), history, plan, brief }),
      )
    } catch {
      // Storage full or blocked: the builder still works, it just will not be remembered.
    }
  }, [messages, history, plan, brief])

  // Listen for JavaScript errors reported by the preview.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; message?: unknown } | null
      if (!data || data.source !== 'axion-preview' || typeof data.message !== 'string') return
      const message = data.message
      if (/^Script error/i.test(message)) return // browsers hide details of cross-site scripts
      setErrors((prev) => (prev.includes(message) ? prev : [...prev, message].slice(-5)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Escape closes the fullscreen preview.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Keep the newest chat item in view.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, steps, pending, askNew, truncated, failedEdit])

  // Follow the code as it is written.
  useEffect(() => {
    const el = liveEl.current
    if (el) el.scrollTop = el.scrollHeight
  }, [liveCode])

  // Stop everything when the builder is closed.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      window.clearTimeout(liveTimer.current)
      window.clearTimeout(copyTimer.current)
    }
  }, [])

  /* ---- Small helpers ---- */

  function addMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: makeId(), role, text }])
  }

  function updateStep(id: string, status: StepStatus, detail?: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s)),
    )
  }

  function scheduleLive(raw: string) {
    liveRef.current = raw
    if (liveTimer.current !== undefined) return
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined
      setLiveCode(liveRef.current)
    }, 150)
  }

  function flushLive(raw: string) {
    window.clearTimeout(liveTimer.current)
    liveTimer.current = undefined
    liveRef.current = raw
    setLiveCode(raw)
  }

  function pushVersion(label: string, newHtml: string) {
    setHistory((prev) => {
      const kept = prev.versions.slice(0, prev.index + 1)
      const versions = [...kept, { id: makeId(), label, html: newHtml }].slice(-5)
      return { versions, index: versions.length - 1 }
    })
    setErrors([])
    setReloadKey((k) => k + 1)
  }

  function handleError(error: unknown, signal: AbortSignal) {
    setSteps((prev) =>
      prev.map((s) =>
        s.status === 'active'
          ? { ...s, status: 'error', detail: signal.aborted ? 'Stopped' : s.detail }
          : s,
      ),
    )
    if (signal.aborted) {
      addMessage('assistant', 'Stopped. Your current site was not changed.')
      return
    }
    addMessage('assistant', `⚠️ ${error instanceof Error ? error.message : 'Something went wrong.'}`)
  }

  function startRun(initialSteps: Step[]): AbortSignal {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setPending(null)
    setAskNew(null)
    setFailedEdit('')
    setTruncated(false)
    setLiveCode('')
    setSteps(initialSteps.map((s) => ({ ...s })))
    return controller.signal
  }

  // Saves the finished file as a new version.
  function commit(finalHtml: string, complete: boolean, label: string, message: string) {
    updateStep('check', 'active')
    const fixed = repairHtml(finalHtml)
    setTruncated(!complete)
    updateStep(
      'check',
      complete ? 'done' : 'error',
      complete ? 'File is complete' : 'The site was cut off. Use "Finish the site".',
    )
    pushVersion(label, fixed)
    updateStep('ready', 'done')
    setTab('preview')
    setMobileView('work')
    addMessage('assistant', message)
  }

  // Handles a full website reply (create, rewrite).
  function processFull(raw: string, finish: string, label: string, message: string) {
    const refusal = isRefusal(raw)
    if (refusal) throw new Error(`I can't build that: ${refusal}`)
    const built = extractHtml(raw)
    if (built.length < 300) throw new Error('The AI did not return a website. Please try again.')
    updateStep('write', 'done', `${Math.round(built.length / 1024)} KB written`)
    commit(built, finish !== 'length' && isComplete(built), label, message)
  }

  /* ---- The kinds of runs ---- */

  async function build(text: string, nextPlan: Plan, answers: string, signal: AbortSignal) {
    let found: Note[] = []
    if (useResearch && nextPlan.searchQueries.length > 0) {
      updateStep('research', 'active', nextPlan.searchQueries.join(' · '))
      try {
        const result = await fetchResearch(nextPlan.searchQueries, signal)
        found = result.notes
        updateStep(
          'research',
          found.length > 0 ? 'done' : 'skipped',
          found.length > 0 ? `${found.length} sources found` : (result.skipped ?? 'No useful sources found'),
        )
      } catch (error) {
        if (signal.aborted) throw error
        updateStep('research', 'skipped', 'Search was not available')
      }
    } else {
      updateStep('research', 'skipped', useResearch ? 'Not needed for this site' : 'Turned off')
    }
    setNotes(found)

    updateStep('write', 'active')
    setTab('code')
    let raw = ''
    const result = await streamBuild(
      { mode: 'create', brief: text, plan: nextPlan, answers, notes: found },
      (piece) => {
        raw += piece
        scheduleLive(raw)
      },
      signal,
    )
    flushLive(raw)

    const assumed =
      nextPlan.assumptions.length > 0 ? ` Assumptions I made: ${nextPlan.assumptions.join('; ')}.` : ''
    const todo =
      found.length === 0 && nextPlan.searchQueries.length > 0
        ? ' I found little real information online, so missing facts use neutral wording and TODO comments in the code. Tell me the real details and I will add them.'
        : ''
    processFull(
      raw,
      result.finish,
      nextPlan.title,
      `✅ "${nextPlan.title}" is ready.${assumed}${todo} Check the preview, then ask for changes in plain words, for example "make the header dark" or "add a pricing section".`,
    )
  }

  async function begin(text: string, answers: string, useDefaults: boolean) {
    const signal = startRun(CREATE_STEPS)
    try {
      updateStep('plan', 'active')
      const nextPlan = await fetchPlan(text, answers, useDefaults, signal)
      setPlan(nextPlan)
      updateStep('plan', 'done', nextPlan.title)

      if (nextPlan.questions.length > 0) {
        updateStep('ask', 'active', 'Waiting for your answers')
        setPending({ brief: text, plan: nextPlan })
        setAnswerDrafts(nextPlan.questions.map(() => ''))
        addMessage(
          'assistant',
          'Before I build, I need a few details. Answer what you know, or skip and I will use sensible placeholders.',
        )
        return
      }

      updateStep('ask', answers ? 'done' : 'skipped', answers ? 'Answered' : 'Using sensible defaults')
      await build(text, nextPlan, answers, signal)
    } catch (error) {
      handleError(error, signal)
    } finally {
      setRunning(false)
    }
  }

  async function edit(instruction: string) {
    const base = html
    if (!base) return
    const signal = startRun(EDIT_STEPS)
    try {
      updateStep('write', 'active')
      setTab('code')
      let raw = ''
      const result = await streamBuild(
        { mode: 'patch', brief, plan, html: base, instruction },
        (piece) => {
          raw += piece
          scheduleLive(raw)
        },
        signal,
      )
      flushLive(raw)

      const refusal = isRefusal(raw)
      if (refusal) {
        if (SAFETY.test(refusal)) throw new Error(`I can't do that: ${refusal}`)
        // The AI gave up on a big edit. That is not a real refusal, so offer a full rewrite.
        updateStep('write', 'error', 'Could not apply the change')
        setFailedEdit(instruction)
        addMessage(
          'assistant',
          "That change was too big for a small edit. I can rewrite the whole site with it (slower, and it uses more of the free limit).",
        )
        return
      }

      const patched = applyPatches(base, raw)
      if (patched.applied === 0) {
        // Sometimes the AI sends a whole new file instead of edit blocks.
        if (/<!doctype html|<html[\s>]/i.test(raw) && raw.length > 1500) {
          processFull(raw, result.finish, instruction.slice(0, 50), '✅ Done. I rebuilt the page with your change.')
          return
        }
        updateStep('write', 'error', 'Could not apply the change')
        setFailedEdit(instruction)
        addMessage(
          'assistant',
          "I couldn't apply that change automatically. Try asking in different words, or let me rewrite the whole site with the change (slower, and it uses more of the free limit).",
        )
        return
      }

      const skipped = patched.failed > 0 ? `, ${patched.failed} skipped` : ''
      updateStep('write', 'done', `${patched.applied} change${patched.applied === 1 ? '' : 's'} applied${skipped}`)
      commit(
        patched.html,
        true,
        instruction.slice(0, 50),
        patched.failed > 0
          ? `✅ I applied ${patched.applied} change(s) and skipped ${patched.failed} I could not place. Ask again if something is missing.`
          : '✅ Done. Check the preview. You can undo this with the Undo button.',
      )
    } catch (error) {
      handleError(error, signal)
    } finally {
      setRunning(false)
    }
  }

  async function rewrite(instruction: string) {
    const base = html
    if (!base) return
    const signal = startRun(EDIT_STEPS)
    try {
      updateStep('write', 'active')
      setTab('code')
      let raw = ''
      const result = await streamBuild(
        { mode: 'rewrite', brief, plan, html: base, instruction },
        (piece) => {
          raw += piece
          scheduleLive(raw)
        },
        signal,
      )
      flushLive(raw)
      processFull(raw, result.finish, instruction.slice(0, 50), '✅ Done. I rewrote the whole site with your change.')
    } catch (error) {
      handleError(error, signal)
    } finally {
      setRunning(false)
    }
  }

  async function finishSite() {
    const base = html.replace(/\s*<\/body>\s*<\/html>\s*$/i, '')
    if (!base) return
    const signal = startRun(FINISH_STEPS)
    try {
      updateStep('write', 'active')
      setTab('code')
      let raw = ''
      const result = await streamBuild(
        { mode: 'continue', brief, plan, html: base },
        (piece) => {
          raw += piece
          scheduleLive(raw)
        },
        signal,
      )
      flushLive(raw)
      const joined = joinContinuation(base, raw)
      updateStep('write', 'done', `${Math.round(joined.length / 1024)} KB written`)
      commit(
        joined,
        result.finish !== 'length' && isComplete(joined),
        'Finished site',
        '✅ I finished the rest of the site. Check the preview.',
      )
    } catch (error) {
      handleError(error, signal)
    } finally {
      setRunning(false)
    }
  }

  /* ---- Actions from the screen ---- */

  function send(raw: string) {
    const text = raw.trim()
    if (!text || running) return
    setDraft('')
    setAskNew(null)
    addMessage('user', text)
    if (pending) {
      void begin(pending.brief, text, false) // they typed their answers instead of using the form
      return
    }
    if (!hasProject) {
      setBrief(text)
      void begin(text, '', false)
      return
    }
    if (NEW_SITE.test(text)) {
      setAskNew(text)
      addMessage(
        'assistant',
        'That sounds like a brand-new website, not a change to the current one. What would you like to do?',
      )
      return
    }
    void edit(text)
  }

  function submitAnswers(skip: boolean) {
    if (!pending || running) return
    const pairs = pending.plan.questions
      .map((question, i) => ({ question, answer: (answerDrafts[i] ?? '').trim() }))
      .filter((pair) => pair.answer)
    const useDefaults = skip || pairs.length === 0
    const answers = useDefaults ? '' : pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n')
    addMessage(
      'user',
      useDefaults ? 'Skip. Use sensible placeholders.' : pairs.map((p) => `${p.question} ${p.answer}`).join('\n'),
    )
    void begin(pending.brief, answers, useDefaults)
  }

  function stop() {
    abortRef.current?.abort()
  }

  function jump(delta: number) {
    setHistory((prev) => {
      const next = prev.index + delta
      if (next < 0 || next >= prev.versions.length) return prev
      return { ...prev, index: next }
    })
    setErrors([])
    setReloadKey((k) => k + 1)
  }

  // Wipes the current project (the site, chat and checklist).
  function clearProject() {
    abortRef.current?.abort()
    setMessages([])
    setHistory({ versions: [], index: -1 })
    setPlan(null)
    setBrief('')
    setSteps([])
    setPending(null)
    setAskNew(null)
    setNotes([])
    setLiveCode('')
    setErrors([])
    setTruncated(false)
    setFailedEdit('')
    setRunning(false)
    setConfirmNew(false)
    setMobileView('chat')
  }

  function resetProject() {
    if (!confirmNew && hasProject) {
      setConfirmNew(true)
      return
    }
    clearProject()
  }

  // Starts a fresh project from a message that asked for a new website.
  function startNew(text: string) {
    clearProject()
    addMessage('user', text)
    setBrief(text)
    void begin(text, '', false)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(html)
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked by the browser: nothing else to do.
    }
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    send(draft)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send(draft)
    }
  }

  /* ---- Render ---- */

  const liveKb = Math.round(liveCode.length / 1024)

  return (
    <div className="builder" data-view={mobileView}>
      {active && <GalaxyBackground mode="normal" />}

      <div className="builder__switch" role="group" aria-label="Builder view">
        <button
          type="button"
          className={mobileView === 'chat' ? 'is-on' : ''}
          aria-pressed={mobileView === 'chat'}
          onClick={() => setMobileView('chat')}
        >
          💬 Chat
        </button>
        <button
          type="button"
          className={mobileView === 'work' ? 'is-on' : ''}
          aria-pressed={mobileView === 'work'}
          onClick={() => setMobileView('work')}
        >
          🖥️ Preview and code
        </button>
      </div>

      {/* ---------- Left: chat, checklist, questions ---------- */}
      <section className="builder__chat" aria-label="Builder chat">
        <header className="builder__head">
          <h2 className="builder__title">🚀 Axion Builder</h2>
          <button
            type="button"
            className={confirmNew ? 'bbtn bbtn--danger' : 'bbtn'}
            onClick={resetProject}
            onBlur={() => setConfirmNew(false)}
          >
            {confirmNew ? 'Click again to confirm' : 'New project'}
          </button>
        </header>

        <div className="builder__scroll">
          {messages.length === 0 && !running && (
            <div className="builder__intro">
              <p className="builder__intro-title">Describe any website and I will build it. ✨</p>
              <p>
                I plan the design, ask for missing details, research facts on the web, write the whole
                site live, and show a working preview. Then you can change it just by chatting.
              </p>
              <div className="chips">
                {STARTERS.map((idea) => (
                  <button key={idea} type="button" className="chip" onClick={() => setDraft(idea.slice(3))}>
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <motion.div
              key={m.id}
              className={`bmsg bmsg--${m.role}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {m.text}
            </motion.div>
          ))}

          {steps.length > 0 && <Checklist steps={steps} liveKb={liveKb} />}

          {askNew && !running && (
            <div className="ask">
              <p className="ask__title">🆕 Start a new project?</p>
              <p className="notes">
                A new project replaces the current site. Use the .html button first if you want to keep a
                copy of it.
              </p>
              <div className="ask__actions">
                <button type="button" className="bbtn bbtn--primary" onClick={() => startNew(askNew)}>
                  Start a new project
                </button>
                <button
                  type="button"
                  className="bbtn"
                  onClick={() => {
                    const text = askNew
                    setAskNew(null)
                    void edit(text)
                  }}
                >
                  Edit the current site instead
                </button>
              </div>
            </div>
          )}

          {pending && !running && (
            <form
              className="ask"
              onSubmit={(event) => {
                event.preventDefault()
                submitAnswers(false)
              }}
            >
              <p className="ask__title">📝 Quick questions</p>
              {pending.plan.questions.map((question, i) => (
                <label key={question} className="ask__field">
                  <span>{question}</span>
                  <input
                    className="ask__input"
                    type="text"
                    value={answerDrafts[i] ?? ''}
                    maxLength={200}
                    onChange={(event) =>
                      setAnswerDrafts((prev) => prev.map((v, j) => (j === i ? event.target.value : v)))
                    }
                  />
                </label>
              ))}
              <div className="ask__actions">
                <button type="submit" className="bbtn bbtn--primary">
                  Build with my answers
                </button>
                <button type="button" className="bbtn" onClick={() => submitAnswers(true)}>
                  Skip, use placeholders
                </button>
              </div>
            </form>
          )}

          {notes.length > 0 && (
            <details className="notes">
              <summary>🌐 {notes.length} web sources used</summary>
              <ul>
                {notes.map((note) => {
                  const href = safeUrl(note.url)
                  return href ? (
                    <li key={href}>
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {note.title}
                      </a>
                    </li>
                  ) : null
                })}
              </ul>
            </details>
          )}

          {failedEdit && !running && (
            <button type="button" className="bbtn bbtn--primary" onClick={() => void rewrite(failedEdit)}>
              Rewrite the whole site with this change
            </button>
          )}
          {truncated && !running && (
            <button type="button" className="bbtn bbtn--primary" onClick={() => void finishSite()}>
              Finish the site
            </button>
          )}

          <div ref={chatEndRef} />
        </div>

        <div className="builder__compose">
          {hasProject && !running && (
            <div className="chips chips--tight">
              {EDIT_IDEAS.map((idea) => (
                <button key={idea} type="button" className="chip chip--small" onClick={() => send(idea.slice(3))}>
                  {idea}
                </button>
              ))}
            </div>
          )}

          <label className="builder__toggle">
            <input
              type="checkbox"
              checked={useResearch}
              onChange={(event) => setUseResearch(event.target.checked)}
              disabled={running || hasProject}
            />
            🌐 Research the web while planning (new projects only)
          </label>

          <form className="builder__form" onSubmit={onFormSubmit}>
            <textarea
              className="builder__input"
              rows={2}
              value={draft}
              maxLength={1500}
              placeholder={
                pending
                  ? 'Or type all your answers here…'
                  : hasProject
                    ? 'Describe a change, e.g. “make the hero section taller”'
                    : 'Describe the website you want…'
              }
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {running ? (
              <button type="button" className="builder__send builder__send--stop" onClick={stop} aria-label="Stop">
                <Square size={18} />
              </button>
            ) : (
              <button type="submit" className="builder__send" disabled={!draft.trim()} aria-label="Send">
                <Send size={18} />
              </button>
            )}
          </form>
        </div>
      </section>

      {/* ---------- Right: preview and code ---------- */}
      <section className="builder__work" aria-label="Preview and code">
        <div className="builder__toolbar">
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={tab === 'preview' ? 'is-on' : ''} aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
              Preview
            </button>
            <button type="button" className={tab === 'code' ? 'is-on' : ''} aria-pressed={tab === 'code'} onClick={() => setTab('code')}>
              Code
            </button>
          </div>

          {tab === 'preview' && (
            <div className="seg" role="group" aria-label="Device size">
              {(['desktop', 'tablet', 'phone'] as const).map((d) => (
                <button key={d} type="button" className={device === d ? 'is-on' : ''} aria-pressed={device === d} onClick={() => setDevice(d)}>
                  {d === 'desktop' ? 'Desktop' : d === 'tablet' ? 'Tablet' : 'Phone'}
                </button>
              ))}
            </div>
          )}

          <div className="builder__tools">
            <button type="button" className="bbtn" disabled={running || history.index <= 0} onClick={() => jump(-1)}>
              ↶ Undo
            </button>
            <button type="button" className="bbtn" disabled={running || history.index >= history.versions.length - 1} onClick={() => jump(1)}>
              ↷ Redo
            </button>
            {hasProject && <span className="builder__ver">v{history.index + 1}/{history.versions.length}</span>}
            <button type="button" className="bbtn" disabled={!html} onClick={() => setReloadKey((k) => k + 1)} aria-label="Reload preview">
              <RefreshCw size={14} />
            </button>
            <button type="button" className="bbtn" disabled={!html} onClick={() => void copyCode()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="bbtn" disabled={!html} onClick={() => downloadHtml(html, plan?.title ?? 'website')}>
              <Download size={14} /> .html
            </button>
            <button type="button" className="bbtn" disabled={!html} onClick={() => setFullscreen(true)}>
              ⤢ Fullscreen
            </button>
          </div>
        </div>

        <div className="builder__stage">
          {tab === 'code' ? (
            running && liveCode ? (
              <pre className="builder__live" ref={liveEl}>
                {liveCode}
              </pre>
            ) : html ? (
              <div className="builder__code">
                <CodeBlock code={html} lang="html" />
              </div>
            ) : (
              <div className="builder__empty">The code will appear here as it is written.</div>
            )
          ) : html ? (
            <iframe
              ref={iframeRef}
              key={`${current?.id ?? 'none'}-${reloadKey}`}
              className="builder__frame"
              title="Website preview"
              sandbox={SANDBOX}
              srcDoc={doc}
              style={{ width: frameWidth }}
            />
          ) : (
            <div className="builder__empty">
              <span className="builder__empty-icon" aria-hidden="true">
                🪐
              </span>
              <p>{running ? 'Writing your website… switch to the Code tab to watch it appear.' : 'Your website will appear here.'}</p>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className="builder__errors" role="alert">
            <p>
              ⚠️ The preview reported {errors.length} JavaScript error{errors.length === 1 ? '' : 's'}:
            </p>
            <ul>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <button
              type="button"
              className="bbtn bbtn--primary"
              disabled={running}
              onClick={() => send(`Fix these JavaScript errors in the page: ${errors.join(' | ')}`)}
            >
              Fix with AI
            </button>
          </div>
        )}
      </section>

      {fullscreen && html && (
        <div className="builder__full" role="dialog" aria-label="Full screen preview">
          <button type="button" className="builder__full-close" onClick={() => setFullscreen(false)} aria-label="Close full screen">
            <X size={20} />
          </button>
          <iframe
            key={`full-${current?.id ?? 'none'}-${reloadKey}`}
            title="Website full screen preview"
            sandbox={SANDBOX}
            srcDoc={doc}
          />
        </div>
      )}
    </div>
  )
}