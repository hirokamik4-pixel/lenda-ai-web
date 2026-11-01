import { useState } from 'react'
import App from './App'
import Builder from './Builder'
import Tools from './ToolsPage'
import './Root.css'

type View = 'chat' | 'build' | 'tools'

export default function Root() {
  const [view, setView] = useState<View>('chat')
  // Sections are created the first time they are opened, then kept alive.
  const [opened, setOpened] = useState<Record<View, boolean>>({
    chat: true,
    build: false,
    tools: false,
  })

  function show(next: View) {
    setView(next)
    setOpened((prev) => (prev[next] ? prev : { ...prev, [next]: true }))
  }

  return (
    <div className="shell">
      <nav className="shell__tabs" aria-label="Axion sections">
        <span className="shell__brand">✦ Axion</span>
        <div className="shell__switch" role="group" aria-label="Choose a section">
          <button
            type="button"
            className={view === 'chat' ? 'is-on' : ''}
            aria-pressed={view === 'chat'}
            onClick={() => show('chat')}
          >
            💬 Chat
          </button>
          <button
            type="button"
            className={view === 'build' ? 'is-on' : ''}
            aria-pressed={view === 'build'}
            onClick={() => show('build')}
          >
            🚀 Build<span className="shell__long"> websites</span>
          </button>
          <button
            type="button"
            className={view === 'tools' ? 'is-on' : ''}
            aria-pressed={view === 'tools'}
            onClick={() => show('tools')}
          >
            🧰 Tools
          </button>
        </div>
      </nav>

      <div className="shell__body">
        <div className="shell__pane" hidden={view !== 'chat'}>
          <App />
        </div>
        {opened.build && (
          <div className="shell__pane" hidden={view !== 'build'}>
            <Builder active={view === 'build'} />
          </div>
        )}
        {opened.tools && (
          <div className="shell__pane" hidden={view !== 'tools'}>
            <Tools active={view === 'tools'} />
          </div>
        )}
      </div>
    </div>
  )
}