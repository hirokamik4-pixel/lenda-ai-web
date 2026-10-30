import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, RotateCcw, Settings2, X } from 'lucide-react'
import { fetchQuiz } from './api'
import { MAX_QUESTIONS, MIN_QUESTIONS } from './quizData'
import type { QuizData } from './quizData'
import './Quiz.css'

/* ------------------------------------------------------------------ */
/* The quiz itself (one question at a time)                            */
/* ------------------------------------------------------------------ */

function QuizPlayer({ quiz }: { quiz: QuizData }) {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  const total = quiz.questions.length
  const question = quiz.questions[index]
  if (!question) return null

  const answered = selected !== null
  const gotItRight = selected === question.correctIndex

  function choose(i: number) {
    if (answered || !question) return
    setSelected(i)
    if (i === question.correctIndex) setScore((s) => s + 1)
  }

  function next() {
    if (index + 1 >= total) {
      setDone(true)
    } else {
      setIndex(index + 1)
      setSelected(null)
    }
  }

  function restart() {
    setIndex(0)
    setSelected(null)
    setScore(0)
    setDone(false)
  }

  const progress = done ? 100 : (index / total) * 100 + (answered ? 100 / total : 0)

  let verdict = '📖 Keep practising, you will get there!'
  if (score === total) verdict = '🏆 Perfect score!'
  else if (score >= total / 2) verdict = '👏 Nice work!'

  return (
    <>
      <div className="quiz__bar" aria-hidden="true">
        <motion.div
          className="quiz__bar-fill"
          animate={{ width: `${progress}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 26 }}
        />
      </div>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div
            key="result"
            className="quiz__result"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="quiz__score">
              {score} / {total}
            </p>
            <p className="quiz__verdict">{verdict}</p>
            <button type="button" className="quiz__btn" onClick={restart}>
              <RotateCcw size={16} /> Try again
            </button>
          </motion.div>
        ) : (
          <motion.div
            key={question.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
          >
            <p className="quiz__count">
              Question {index + 1} of {total}
            </p>
            <p className="quiz__prompt">{question.prompt}</p>

            <div className="quiz__options">
              {question.options.map((option, i) => {
                const isCorrect = answered && i === question.correctIndex
                const isWrong = answered && i === selected && i !== question.correctIndex
                let cls = 'quiz__option'
                if (isCorrect) cls += ' is-correct'
                if (isWrong) cls += ' is-wrong'
                return (
                  <motion.button
                    key={option}
                    type="button"
                    className={cls}
                    disabled={answered}
                    onClick={() => choose(i)}
                    whileHover={answered ? undefined : { scale: 1.02 }}
                    whileTap={answered ? undefined : { scale: 0.97 }}
                  >
                    <span className="quiz__letter">{String.fromCharCode(65 + i)}</span>
                    <span className="quiz__text">{option}</span>
                    {isCorrect && <Check size={18} aria-label="Correct answer" />}
                    {isWrong && <X size={18} aria-label="Your answer, incorrect" />}
                  </motion.button>
                )
              })}
            </div>

            <div aria-live="polite">
              {answered && (
                <motion.div
                  className="quiz__explain"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <strong>{gotItRight ? '✅ Correct!' : '❌ Not quite.'}</strong> {question.explanation}
                </motion.div>
              )}
            </div>

            {answered && (
              <button type="button" className="quiz__btn" onClick={next}>
                {index + 1 >= total ? 'See my score 🎯' : 'Next question →'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The card: setup (topic + question count), then the quiz             */
/* ------------------------------------------------------------------ */

interface QuizCardProps {
  initialTopic: string
  initialCount: number
}

export default function QuizCard({ initialTopic, initialCount }: QuizCardProps) {
  const [topic, setTopic] = useState(initialTopic)
  const [count, setCount] = useState(initialCount)
  const [quiz, setQuiz] = useState<QuizData | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  async function start() {
    const name = topic.trim()
    if (loading) return
    if (!name) {
      setNotice('Type a topic first, for example "volcanoes".')
      return
    }
    setLoading(true)
    setNotice('')
    try {
      const result = await fetchQuiz(name, count)
      setQuiz({
        id: `${Date.now()}`,
        title: result.title,
        questions: result.questions,
      })
      setNotice(
        result.shortBy > 0
          ? `The AI wrote ${result.questions.length} usable questions instead of ${result.requested}. You can go back and try again for the full amount.`
          : '',
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="quiz">
      <div className="quiz__head">
        <span className="quiz__title">🧠 {quiz ? quiz.title : 'Quiz setup'}</span>
        <span className="quiz__tag">AI-generated · may contain mistakes</span>
      </div>

      {quiz ? (
        <>
          {notice && <p className="quiz__notice">{notice}</p>}
          <QuizPlayer key={quiz.id} quiz={quiz} />
          <button
            type="button"
            className="quiz__btn quiz__btn--ghost"
            onClick={() => setQuiz(null)}
          >
            <Settings2 size={16} /> Change topic or length
          </button>
        </>
      ) : (
        <div className="quiz__setup">
          <label className="quiz__field">
            <span className="quiz__label">📖 Topic (any subject)</span>
            <input
              type="text"
              className="quiz__input"
              value={topic}
              placeholder="e.g. volcanoes, World War 2, Python loops"
              maxLength={100}
              disabled={loading}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </label>

          <label className="quiz__field">
            <span className="quiz__label">
              🔢 Number of questions: <strong>{count}</strong>
            </span>
            <input
              type="range"
              className="quiz__range"
              min={MIN_QUESTIONS}
              max={MAX_QUESTIONS}
              step={1}
              value={count}
              disabled={loading}
              onChange={(e) => setCount(Number(e.target.value))}
              aria-valuetext={`${count} questions`}
            />
            <span className="quiz__range-scale" aria-hidden="true">
              <span>{MIN_QUESTIONS}</span>
              <span>{MAX_QUESTIONS}</span>
            </span>
          </label>

          {notice && (
            <p className="quiz__notice" role="status">
              {notice}
            </p>
          )}

          <p className="quiz__hint">
            The AI writes the questions, so double-check anything important. Bigger quizzes take longer.
          </p>

          <button
            type="button"
            className={loading ? 'quiz__btn is-loading' : 'quiz__btn'}
            disabled={loading}
            onClick={() => void start()}
          >
            {loading ? 'Writing your quiz… ⏳' : 'Start quiz 🚀'}
          </button>
        </div>
      )}
    </div>
  )
}