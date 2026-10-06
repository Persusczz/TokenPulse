/**
 * A small Markdown reader for release notes: GitHub-flavoured blocks
 * (headings, paragraphs, nested and task lists, quotes, fenced code, rules,
 * tables) and inlines (bold, italic, strike, code, links, bare URLs). It
 * builds a tree instead of HTML, so the page renders it without ever
 * injecting markup. Single newlines are line breaks, as on GitHub's
 * release pages; raw HTML tags are dropped and their text kept.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'br' }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export type Align = 'left' | 'center' | 'right' | null

export interface ListItem {
  /** a task-list box: null when the item has none */
  checked: boolean | null
  c: Block[]
}

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const indentOf = (l: string) => /^ */.exec(l)![0].length
const blank = (l: string | undefined) => l === undefined || !l.trim()

export function parseMarkdown(src: string): Block[] {
  const text = src
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\t/g, '    ')
  return blocks(text.split('\n'))
}

function isTable(lines: string[], i: number): boolean {
  const d = lines[i + 1]
  return lines[i].includes('|') && d !== undefined && d.includes('|') && d.includes('-') && DELIM.test(d)
}

/** a line that ends a paragraph and starts something else */
function interrupts(lines: string[], i: number): boolean {
  const l = lines[i]
  if (FENCE.test(l) || ATX.test(l) || HR.test(l) || QUOTE.test(l) || isTable(lines, i)) return true
  const m = ITEM.exec(l)
  // an ordered list only breaks into a paragraph when it starts at 1, and an empty item never does
  return !!m && !!m[4].trim() && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1)
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (blank(line)) {
      i++
      continue
    }
    let m: RegExpExecArray | null
    if ((m = FENCE.exec(line))) {
      const [, ind, fence, lang] = m
      const body: string[] = []
      i++
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++].replace(new RegExp(`^ {0,${ind.length}}`), ''))
      i++
      out.push({ t: 'code', lang, v: body.join('\n') })
      continue
    }
    if ((m = ATX.exec(line))) {
      out.push({ t: 'heading', level: m[1].length as 1, c: parseInline(m[2] ?? '') })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i])
        if (q) body.push(q[1])
        // a lazy line carries on the quoted paragraph
        else if (!interrupts(lines, i)) body.push(lines[i])
        else break
        i++
      }
      out.push({ t: 'quote', c: blocks(body) })
      continue
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i)
      out.push(list)
      i = next
      continue
    }
    if (isTable(lines, i)) {
      const head = cells(line)
      const align = cells(lines[i + 1]).map((c): Align => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : null))
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && !blank(lines[i]) && !(interrupts(lines, i) && !lines[i].includes('|'))) {
        const r = cells(lines[i++])
        rows.push(head.map((_, k) => parseInline(r[k] ?? '')))
      }
      out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((h) => parseInline(h)), rows })
      continue
    }
    // a paragraph, or a setext heading when underlined
    const para = [line.trim()]
    i++
    let level = 0
    while (i < lines.length && !blank(lines[i])) {
      const s = SETEXT.exec(lines[i])
      if (s) {
        level = s[1][0] === '=' ? 1 : 2
        i++
        break
      }
      if (interrupts(lines, i)) break
      para.push(lines[i].trim())
      i++
    }
    const c = parseInline(para.join('\n'))
    out.push(level ? { t: 'heading', level: level as 1, c } : { t: 'para', c })
  }
  return out
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start])!
  const ordered = /\d/.test(first[2])
  const mark = first[2].slice(-1)
  const sameKind = (m: RegExpExecArray) => /\d/.test(m[2]) === ordered && m[2].slice(-1) === mark
  const items: string[][] = []
  let cur: string[] = []
  let indent = 0
  let tight = true
  let gap = false
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    const m = ITEM.exec(line)
    if (m && sameKind(m) && (i === start || indentOf(line) < indent)) {
      if (gap) tight = false
      gap = false
      const pad = m[3].length >= 1 && m[3].length <= 4 ? m[3].length : 1
      indent = m[1].length + m[2].length + pad
      cur = [m[4]]
      items.push(cur)
      i++
      continue
    }
    if (blank(line)) {
      // the list goes on past a blank line only if more of it follows
      let j = i + 1
      while (j < lines.length && blank(lines[j])) j++
      if (j >= lines.length) break
      const n = ITEM.exec(lines[j])
      if (!(indentOf(lines[j]) >= indent || (n && sameKind(n)))) break
      gap = true
      cur.push('')
      i++
      continue
    }
    if (indentOf(line) >= indent) {
      if (gap && cur.some((l) => l.trim())) tight = false
      gap = false
      cur.push(line.slice(indent))
      i++
      continue
    }
    // a lazy line carries on the item's paragraph
    if (!gap && !interrupts(lines, i)) {
      cur.push(line.trim())
      i++
      continue
    }
    break
  }
  return [
    {
      t: 'list',
      ordered,
      start: ordered ? parseInt(first[2], 10) : 1,
      tight,
      items: items.map((body) => {
        const task = /^\[([ xX])\][ \t]+/.exec(body[0])
        if (task) body[0] = body[0].slice(task[0].length)
        return { checked: task ? task[1] !== ' ' : null, c: blocks(body) }
      })
    },
    i
  ]
}

function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

// ---------- inlines ----------

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const WORD = /[\p{L}\p{N}]/u
const LINK = /^\[((?:\\.|[^[\]\\]|\[[^\]]*\])*)\]\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/
/** characters a bare URL does not end with */
const URL_TAIL = /[.,:;!?'")\]}>。，、；：！？）】」』]+$/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const push = (n: Inline) => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
    out.push(n)
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if (c === '\\' && src[i + 1] === '\n') {
      push({ t: 'br' })
      i += 2
      continue
    }
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (c === '\n') {
      text = text.replace(/ +$/, '')
      push({ t: 'br' })
      i++
      continue
    }
    if (c === '`') {
      const run = /^`+/.exec(rest)![0]
      m = new RegExp(`^${run}(?!\`)([\\s\\S]*?[^\`])${run}(?!\`)`).exec(rest)
      if (m) {
        const v = m[1].replace(/\n/g, ' ')
        push({ t: 'code', v: /^ .*[^ ].* $/.test(v) ? v.slice(1, -1) : v })
        i += m[0].length
      } else {
        // an unmatched run stays as it is
        text += run
        i += run.length
      }
      continue
    }
    if (c === '!' && (m = LINK.exec(rest.slice(1)))) {
      // pictures can't load in the app: link to them instead
      push({ t: 'link', href: m[2], c: [{ t: 'text', v: m[1] ? `🖼 ${m[1]}` : '🖼 图片' }] })
      i += m[0].length + 1
      continue
    }
    if (c === '[' && (m = LINK.exec(rest))) {
      push({ t: 'link', href: m[2], c: parseInline(m[1]) })
      i += m[0].length
      continue
    }
    if (c === '<') {
      if ((m = /^<(https?:\/\/[^\s<>]+)>/i.exec(rest))) {
        push({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1] }] })
        i += m[0].length
        continue
      }
      if ((m = /^<br\s*\/?>/i.exec(rest))) {
        push({ t: 'br' })
        i += m[0].length
        continue
      }
      // other HTML tags are dropped, their text is kept
      if ((m = /^<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/i.exec(rest))) {
        i += m[0].length
        continue
      }
    }
    if ((c === 'h' || c === 'H') && !/[\w/]/.test(src[i - 1] ?? '') && (m = /^https?:\/\/[^\s<>]+/i.exec(rest))) {
      const url = m[0].replace(URL_TAIL, '')
      push({ t: 'link', href: url, c: [{ t: 'text', v: url }] })
      i += url.length
      continue
    }
    if (c === '~' && (m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      push({ t: 'del', c: parseInline(m[1]) })
      i += m[0].length
      continue
    }
    if (c === '*' || c === '_') {
      const e = emphasis(src, i)
      if (e) {
        push(e.node)
        i = e.end
        continue
      }
      // a run that opens nothing stays as text
      const run = c === '*' ? /^\*+/.exec(rest)![0] : /^_+/.exec(rest)![0]
      text += run
      i += run.length
      continue
    }
    text += c
    i++
  }
  if (text) out.push({ t: 'text', v: text })
  return out
}

/** `***x***`, `**x**`, `__x__`, `*x*`, `_x_` starting at i */
function emphasis(src: string, i: number): { node: Inline; end: number } | null {
  const ch = src[i]
  const runLen = /^(\*+|_+)/.exec(src.slice(i))![0].length
  for (const n of [3, 2, 1]) {
    if (runLen < n) continue
    const after = src[i + n]
    if (after === undefined || /\s/.test(after)) continue
    // underscores inside a word are just underscores
    if (ch === '_' && WORD.test(src[i - 1] ?? '')) return null
    for (let j = i + n; j < src.length; j++) {
      // look at whole runs only
      if (src[j] !== ch || src[j - 1] === ch) continue
      let k = j
      while (src[k] === ch) k++
      // the closing run is exactly as long, follows non-space, and an underscore one ends a word
      if (k - j === n && !/\s/.test(src[j - 1]) && !(ch === '_' && WORD.test(src[k] ?? ''))) {
        const inner = parseInline(src.slice(i + n, j))
        const node: Inline = n === 3 ? { t: 'strong', c: [{ t: 'em', c: inner }] } : n === 2 ? { t: 'strong', c: inner } : { t: 'em', c: inner }
        return { node, end: k }
      }
      j = k - 1
    }
  }
  return null
}

/** the text of some inlines, without formatting */
export function plainText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : plainText(n.c))).join('')
}

/** leaves out the sections whose heading matches (each up to the next heading of its level or above) */
export function withoutSections(list: Block[], drop: RegExp): Block[] {
  const out: Block[] = []
  let skipping = 0
  for (const b of list) {
    if (b.t === 'heading') {
      if (skipping && b.level <= skipping) skipping = 0
      if (!skipping && drop.test(plainText(b.c).trim())) {
        skipping = b.level
        continue
      }
    }
    if (!skipping) out.push(b)
  }
  return out
}
