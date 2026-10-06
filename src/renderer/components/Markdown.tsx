import { useMemo, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '@shared/markdown'

const web = (href: string) => /^https?:\/\//i.test(href)

function inlines(list: Inline[]): ReactNode[] {
  return list.map((n, k) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return <code key={k}>{n.v}</code>
      case 'br':
        return <br key={k} />
      case 'strong':
        return <strong key={k}>{inlines(n.c)}</strong>
      case 'em':
        return <em key={k}>{inlines(n.c)}</em>
      case 'del':
        return <del key={k}>{inlines(n.c)}</del>
      case 'link':
        // links open in the browser, never inside the app
        return web(n.href) ? (
          <a
            key={k}
            href={n.href}
            title={n.href}
            onClick={(e) => {
              e.preventDefault()
              void window.api.openExternal(n.href)
            }}
            onAuxClick={(e) => e.preventDefault()}
          >
            {inlines(n.c)}
          </a>
        ) : (
          <span key={k}>{inlines(n.c)}</span>
        )
    }
  })
}

function block(b: Block, k: number, tight = false): ReactNode {
  switch (b.t) {
    case 'heading': {
      const H = `h${b.level}` as const
      return <H key={k}>{inlines(b.c)}</H>
    }
    case 'para':
      return tight ? <span key={k} className="md-line">{inlines(b.c)}</span> : <p key={k}>{inlines(b.c)}</p>
    case 'list': {
      const items = b.items.map((it, j) => (
        <li key={j} className={it.checked === null ? undefined : `md-task${it.checked ? ' done' : ''}`}>
          {it.checked !== null && <span className="md-check" aria-hidden />}
          {it.c.map((x, n) => block(x, n, b.tight))}
        </li>
      ))
      return b.ordered ? (
        <ol key={k} start={b.start === 1 ? undefined : b.start} className={b.tight ? 'tight' : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={k} className={b.tight ? 'tight' : undefined}>
          {items}
        </ul>
      )
    }
    case 'quote':
      return <blockquote key={k}>{b.c.map((x, n) => block(x, n))}</blockquote>
    case 'code':
      return (
        <pre key={k} data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      )
    case 'hr':
      return <hr key={k} />
    case 'table':
      return (
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                    {inlines(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, j) => (
                    <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                      {inlines(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** Markdown (release notes) rendered as React elements, no HTML injected */
export function Markdown({ source, blocks, className }: { source?: string; blocks?: Block[]; className?: string }) {
  const list = useMemo(() => blocks ?? parseMarkdown(source ?? ''), [source, blocks])
  return <div className={`md${className ? ` ${className}` : ''}`}>{list.map((b, k) => block(b, k))}</div>
}
