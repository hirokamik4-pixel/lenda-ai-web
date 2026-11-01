/* A small syntax colouriser with no extra packages. It is simpler than a full
   editor engine, but it handles the common languages well enough for chat. */

export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'function'
  | 'tag'
  | 'attr'
  | 'prop'
  | 'punct'
  | 'plain'

export interface Token {
  kind: TokenKind
  text: string
}

type Rule = [TokenKind, RegExp]

const JS_KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|super|null|undefined|true|false|void|interface|type|enum|implements|public|private|protected|readonly|static|as|yield|delete'

const PY_KEYWORDS =
  'def|class|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|None|True|False|self|async|await|global|nonlocal|assert|del'

const GENERIC_KEYWORDS =
  'int|float|double|char|void|bool|string|public|private|protected|static|class|struct|return|if|else|for|while|switch|case|break|continue|new|null|true|false|import|include|package|using|namespace|func|fn|let|mut|const|var|def|end|do|then|elsif|echo|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE'

const SH_KEYWORDS =
  'if|then|else|elif|fi|for|do|done|while|case|esac|function|in|echo|cd|npm|npx|git|node|pip|python|python3|sudo|export|mkdir|cp|mv|rm|ls|cat|curl|Invoke-RestMethod|Set-Location|Get-Content|New-Item|Remove-Item|Write-Host'

const STRING_JS = /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y
const STRING_PLAIN = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y
const NUMBER = /0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?/iy

function clike(keywords: string): Rule[] {
  return [
    ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ['string', STRING_JS],
    ['number', NUMBER],
    ['keyword', new RegExp(`\\b(?:${keywords})\\b`, 'y')],
    ['function', /[A-Za-z_$][\w$]*(?=\s*\()/y],
    ['plain', /[A-Za-z_$][\w$]*/y],
    ['punct', /[{}()[\];,.<>=+\-*/%!&|?:^~@]+/y],
  ]
}

const JS_RULES = clike(JS_KEYWORDS)
const GENERIC_RULES = clike(GENERIC_KEYWORDS)

const PY_RULES: Rule[] = [
  ['comment', /#[^\n]*/y],
  ['string', /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],
  ['number', NUMBER],
  ['keyword', new RegExp(`\\b(?:${PY_KEYWORDS})\\b`, 'y')],
  ['function', /[A-Za-z_]\w*(?=\s*\()/y],
  ['plain', /[A-Za-z_]\w*/y],
  ['punct', /[{}()[\];,.<>=+\-*/%!&|?:^~@]+/y],
]

const SH_RULES: Rule[] = [
  ['comment', /#[^\n]*/y],
  ['string', STRING_PLAIN],
  ['prop', /\$\{?[\w:?]+\}?/y],
  ['attr', /(?<=\s)--?[A-Za-z][\w-]*/y],
  ['keyword', new RegExp(`\\b(?:${SH_KEYWORDS})\\b`, 'y')],
  ['number', NUMBER],
  ['plain', /[\w.\\/:-]+/y],
  ['punct', /[|&;<>()=]+/y],
]

const JSON_RULES: Rule[] = [
  ['attr', /"(?:\\.|[^"\\\n])*"(?=\s*:)/y],
  ['string', STRING_PLAIN],
  ['number', /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/iy],
  ['keyword', /\b(?:true|false|null)\b/y],
  ['punct', /[{}[\]:,]+/y],
]

const CSS_RULES: Rule[] = [
  ['comment', /\/\*[\s\S]*?\*\//y],
  ['string', STRING_PLAIN],
  ['keyword', /@[\w-]+|!important/y],
  ['number', /#[\da-f]{3,8}\b|-?(?:\d*\.)?\d+(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch)?/iy],
  ['prop', /-{0,2}[a-z][\w-]*(?=\s*:\s*[^{};]*[;}])/iy],
  ['function', /[\w-]+(?=\()/y],
  ['tag', /[.#][\w-]+|::?[\w-]+/y],
  ['plain', /[a-z][\w-]*/iy],
  ['punct', /[{}();,>+~*=[\]]+/y],
]

const HTML_RULES: Rule[] = [
  ['comment', /<!--[\s\S]*?-->/y],
  ['tag', /<!DOCTYPE[^>]*>/iy],
  ['tag', /<\/?[A-Za-z][\w:-]*/y],
  ['punct', /\/?>/y],
  ['attr', /[A-Za-z_:@][\w:.-]*(?=\s*=)/y],
  ['string', /"[^"]*"|'[^']*'/y],
  ['punct', /=/y],
]

// Runs the rules over the code from left to right. The first rule that
// matches at the current position wins.
function run(code: string, rules: Rule[]): Token[] {
  const tokens: Token[] = []
  let pos = 0
  let plain = ''

  const flush = () => {
    if (plain) {
      tokens.push({ kind: 'plain', text: plain })
      plain = ''
    }
  }

  while (pos < code.length) {
    let matched = false
    for (const [kind, re] of rules) {
      re.lastIndex = pos
      const m = re.exec(code)
      const text = m?.[0] ?? ''
      if (text.length > 0) {
        if (kind === 'plain') {
          plain += text
        } else {
          flush()
          tokens.push({ kind, text })
        }
        pos += text.length
        matched = true
        break
      }
    }
    if (!matched) {
      plain += code.charAt(pos)
      pos += 1
    }
  }
  flush()
  return tokens
}

// HTML files often contain <style> and <script>. Colour those parts as CSS and JavaScript.
function tokenizeHtml(code: string): Token[] {
  const tokens: Token[] = []
  const embedded = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi
  let last = 0

  for (const m of code.matchAll(embedded)) {
    const start = m.index ?? 0
    tokens.push(...run(code.slice(last, start), HTML_RULES))
    tokens.push(...run(m[1] ?? '', HTML_RULES))
    const isStyle = (m[2] ?? '').toLowerCase() === 'style'
    tokens.push(...run(m[3] ?? '', isStyle ? CSS_RULES : JS_RULES))
    tokens.push(...run(m[4] ?? '', HTML_RULES))
    last = start + m[0].length
  }
  tokens.push(...run(code.slice(last), HTML_RULES))
  return tokens
}

type Family = 'js' | 'py' | 'html' | 'css' | 'sh' | 'json' | 'generic'

function family(lang: string): Family {
  const l = lang.toLowerCase()
  if (['js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'mjs'].includes(l)) return 'js'
  if (['py', 'python'].includes(l)) return 'py'
  if (['html', 'htm', 'xml', 'svg', 'vue'].includes(l)) return 'html'
  if (['css', 'scss', 'less'].includes(l)) return 'css'
  if (['sh', 'bash', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'terminal', 'console'].includes(l)) {
    return 'sh'
  }
  if (l === 'json') return 'json'
  return 'generic'
}

export function highlight(code: string, lang: string): Token[] {
  // Very long code is shown without colours to keep the page fast.
  if (code.length > 90000) return [{ kind: 'plain', text: code }]
  switch (family(lang)) {
    case 'js':
      return run(code, JS_RULES)
    case 'py':
      return run(code, PY_RULES)
    case 'html':
      return tokenizeHtml(code)
    case 'css':
      return run(code, CSS_RULES)
    case 'sh':
      return run(code, SH_RULES)
    case 'json':
      return run(code, JSON_RULES)
    default:
      return run(code, GENERIC_RULES)
  }
}