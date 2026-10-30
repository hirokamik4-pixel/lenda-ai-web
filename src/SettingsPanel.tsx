import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { LANGUAGES } from './settings'
import type { Settings } from './settings'
import { speechInputSupported, speechOutputSupported } from './useVoice'

interface SwitchProps {
  checked: boolean
  labelledBy: string
  onChange: (checked: boolean) => void
}

function Switch({ checked, labelledBy, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      className={checked ? 'switch is-on' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}

interface SettingsPanelProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClearChats: () => void
  onClose: () => void
}

export default function SettingsPanel({
  settings,
  onChange,
  onClearChats,
  onClose,
}: SettingsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)

  // Move keyboard focus into the dialog when it opens.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Escape closes. Tab stays inside the dialog.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select, input',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return (
    <motion.div
      className="settings-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        ref={dialogRef}
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onKeyDown={handleKeyDown}
      >
        <div className="settings__head">
          <h2 id="settings-title" className="settings__title">
            ⚙️ Settings
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={20} />
          </button>
        </div>

        <h3 className="settings__section">🎤 Voice</h3>

        <div className="settings__row">
          <div>
            <p id="set-speak" className="settings__name">
              Speak replies aloud
            </p>
            <p className="settings__desc">
              Read every new AI reply out loud. You can also use the Listen button on any reply.
            </p>
          </div>
          <Switch
            checked={settings.speakReplies}
            labelledBy="set-speak"
            onChange={(speakReplies) => onChange({ speakReplies })}
          />
        </div>

        <div className="settings__row">
          <div>
            <label htmlFor="voice-lang" className="settings__name">
              Voice language
            </label>
            <p className="settings__desc">Used for the microphone and for speaking.</p>
          </div>
          <select
            id="voice-lang"
            className="settings__select"
            value={settings.voiceLang}
            onChange={(e) => onChange({ voiceLang: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {!speechInputSupported && (
          <p className="settings__warn">
            This browser does not support voice input. Use Chrome or Edge for the microphone.
          </p>
        )}
        {!speechOutputSupported && (
          <p className="settings__warn">This browser cannot speak replies aloud.</p>
        )}
        <p className="settings__desc">
          Voice input sends your audio to your browser&apos;s own speech service, so it needs
          internet. The LENDA AI server only receives the text.
        </p>

        <h3 className="settings__section">🎨 Look</h3>

        <div className="settings__row">
          <div>
            <p id="set-bg" className="settings__name">
              Animated backgrounds
            </p>
            <p className="settings__desc">Turn off if your device feels slow.</p>
          </div>
          <Switch
            checked={settings.background}
            labelledBy="set-bg"
            onChange={(background) => onChange({ background })}
          />
        </div>

        <h3 className="settings__section">🗑️ Data</h3>

        <div className="settings__row">
          <div>
            <p className="settings__name">Delete all chats</p>
            <p className="settings__desc">Removes every chat saved in this browser.</p>
          </div>
          {confirming ? (
            <button
              type="button"
              className="settings__danger is-confirm"
              onClick={() => {
                onClearChats()
                setConfirming(false)
              }}
            >
              Click again to confirm
            </button>
          ) : (
            <button type="button" className="settings__danger" onClick={() => setConfirming(true)}>
              Delete all
            </button>
          )}
        </div>

        <p className="settings__about">LENDA AI · created by Ayush</p>
      </motion.div>
    </motion.div>
  )
}