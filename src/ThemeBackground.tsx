import { AnimatePresence, motion } from 'framer-motion'
import type { CSSProperties } from 'react'
import './ThemeBackground.css'

type Mode = 'study' | 'normal' | 'funny'

const EMOJIS: Record<Mode, string[]> = {
  study: ['📚', '✏️', '📖', '💡', '🧮', '🔬', '📝', '🎓'],
  normal: ['✨', '💬', '💡', '🚀', '🌐', '⭐'],
  funny: ['😂', '🤡', '🎉', '🎈', '🤪', '🥳', '😜', '🍕', '🦄', '💥'],
}

const COUNT: Record<Mode, number> = { study: 14, normal: 9, funny: 18 }
// Base seconds for one rise from bottom to top (funny is much faster).
const SPEED: Record<Mode, number> = { study: 22, normal: 26, funny: 11 }
const CONFETTI_COLORS = ['#ff5fa2', '#ffd23f', '#4fd1c5', '#9b6bff', '#ff8a3d']

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/* Emojis that float upward. Positions come from the index (no randomness),
   so the layout is the same on every render. Negative delays mean the
   animation is already "in progress" when the page loads. */
function Floaters({ mode }: { mode: Mode }) {
  const list = EMOJIS[mode]
  return (
    <>
      {range(COUNT[mode]).map((i) => {
        const style = {
          left: `${(i * 37 + 7) % 96}%`,
          fontSize: `${22 + ((i * 13) % 22)}px`,
          animationDuration: `${SPEED[mode] + ((i * 7) % 10)}s`,
          animationDelay: `-${(i * 5) % 24}s`,
          '--o': mode === 'normal' ? 0.3 : 0.45,
        } as CSSProperties
        return (
          <span key={i} className="floater" style={style}>
            <span
              className={`floater__glyph floater__glyph--${mode}`}
              style={{ animationDelay: `-${(i * 3) % 7}s` }}
            >
              {list[i % list.length]}
            </span>
          </span>
        )
      })}
    </>
  )
}

function StudyExtras() {
  return (
    <>
      <div className="lamp" />
      {range(20).map((i) => {
        const size = 2 + (i % 3) * 1.5
        const style = {
          left: `${(i * 53 + 11) % 100}%`,
          width: size,
          height: size,
          animationDuration: `${14 + ((i * 3) % 12)}s`,
          animationDelay: `-${(i * 7) % 20}s`,
          '--o': 0.55,
        } as CSSProperties
        return <span key={i} className="mote" style={style} />
      })}
    </>
  )
}

function NormalExtras() {
  return (
    <>
      <div className="grid" />
      <div className="orb orb--a" />
      <div className="orb orb--b" />
      <div className="orb orb--c" />
      {range(28).map((i) => {
        const style = {
          left: `${(i * 41 + 5) % 100}%`,
          top: `${(i * 29 + 13) % 100}%`,
          animationDuration: `${2.5 + (i % 4)}s`,
          animationDelay: `-${(i * 3) % 7}s`,
        } as CSSProperties
        return <span key={i} className="star" style={style} />
      })}
    </>
  )
}

function FunnyExtras() {
  return (
    <>
      <div className="blob blob--a" />
      <div className="blob blob--b" />
      {range(26).map((i) => {
        const style = {
          left: `${(i * 31 + 3) % 100}%`,
          animationDuration: `${6 + ((i * 5) % 7)}s`,
          animationDelay: `-${(i * 4) % 13}s`,
          '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        } as CSSProperties
        return <span key={i} className="confetti" style={style} />
      })}
    </>
  )
}

export default function ThemeBackground({ mode }: { mode: Mode }) {
  return (
    <AnimatePresence>
      <motion.div
        key={mode}
        className={`bg bg--${mode}`}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.7 }}
      >
        {mode === 'study' && <StudyExtras />}
        {mode === 'normal' && <NormalExtras />}
        {mode === 'funny' && <FunnyExtras />}
        <Floaters mode={mode} />
      </motion.div>
    </AnimatePresence>
  )
}