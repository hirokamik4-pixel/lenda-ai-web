import { ExternalLink } from 'lucide-react'
import GalaxyBackground from './GalaxyBackground'
import { safeUrl } from './links'
import { TOOLS } from './toolsData'
import './Tools.css'

export default function Tools({ active }: { active: boolean }) {
  return (
    <div className="tools">
      {active && <GalaxyBackground mode="normal" />}
      <div className="tools__inner">
        <h2 className="tools__title">🧰 Axion Tools</h2>
        <p className="tools__lead">Your AI tools in one place. Tap one to open it in a new tab.</p>

        <ul className="tools__grid">
          {TOOLS.map((tool) => {
            const href = safeUrl(tool.url)
            if (!href) return null
            const host = new URL(href).hostname
            return (
              <li key={tool.id}>
                <a className="toolcard" href={href} target="_blank" rel="noopener noreferrer">
                  <span className="toolcard__emoji" aria-hidden="true">
                    {tool.emoji}
                  </span>
                  <span className="toolcard__body">
                    <span className="toolcard__name">{tool.name}</span>
                    <span className="toolcard__desc">{tool.description}</span>
                    <span className="toolcard__host">{host}</span>
                  </span>
                  <span className="toolcard__open">
                    Open <ExternalLink size={14} aria-hidden="true" />
                  </span>
                </a>
              </li>
            )
          })}
        </ul>

        <p className="tools__hint">
          To add another tool, open <code>src/tools.ts</code> and add a new block to the list.
        </p>
      </div>
    </div>
  )
}