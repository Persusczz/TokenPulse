import { appendFile, readFile } from 'node:fs/promises'
import type { UsageEntry } from '@shared/types'

const FIELDS = ['key', 'ts', 'model', 'sessionId', 'project', 'projectPath', 'input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'webSearch', 'speed', 'geo'] as const

function valid(v: any): v is UsageEntry {
  return !!v && typeof v.key === 'string' && Number.isFinite(v.ts) && typeof v.model === 'string' && Number.isFinite(v.output)
}

/**
 * Append-only copy of every parsed usage row. Claude Code deletes transcripts
 * after `cleanupPeriodDays` (30 by default); the archive keeps the history.
 * A row is re-appended when its output grows (streamed responses), and the
 * largest copy wins on load.
 */
export class UsageArchive {
  readonly entries = new Map<string, UsageEntry>()
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private path: string) {}

  async load(): Promise<void> {
    let text = ''
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const v = JSON.parse(line)
        if (!valid(v)) continue
        const prev = this.entries.get(v.key)
        if (!prev || v.output > prev.output) this.entries.set(v.key, v)
      } catch {
        /* torn write */
      }
    }
  }

  /** Appends rows that are new or grew; returns how many were written */
  save(all: Iterable<UsageEntry>): Promise<number> {
    const p = this.chain.then(async () => {
      const lines: string[] = []
      const fresh: UsageEntry[] = []
      for (const e of all) {
        const prev = this.entries.get(e.key)
        if (prev && prev.output >= e.output) continue
        const row = Object.fromEntries(FIELDS.map((f) => [f, e[f]])) as unknown as UsageEntry
        lines.push(JSON.stringify(row))
        fresh.push(row)
      }
      if (!lines.length) return 0
      await appendFile(this.path, lines.join('\n') + '\n', 'utf8')
      for (const r of fresh) this.entries.set(r.key, r)
      return lines.length
    })
    this.chain = p.catch(() => {})
    return p
  }
}
