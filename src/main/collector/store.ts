import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { PromptMark, UsageEntry } from '@shared/types'
import { parseLine } from './parser'

const CHUNK = 4 << 20

interface FileState {
  offset: number
  keys: Set<string>
}

/**
 * Reads `\n`-terminated lines from `offset` to the current end of the file.
 * Returns the offset just past the last consumed line. A trailing line without
 * a newline is consumed only if it is complete JSON (the writer may still be
 * mid-line otherwise).
 */
export async function readLinesFrom(
  path: string,
  offset: number,
  size: number,
  onLine: (line: string) => void
): Promise<number> {
  const fh = await open(path, 'r')
  let pos = offset
  let carry: Buffer = Buffer.alloc(0)
  try {
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos)
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      if (!bytesRead) break
      pos += bytesRead
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      let start = 0
      let nl: number
      while ((nl = data.indexOf(10, start)) !== -1) {
        const line = data.toString('utf8', start, nl).trim()
        if (line) onLine(line)
        start = nl + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
  } finally {
    await fh.close()
  }
  if (carry.length) {
    const tail = carry.toString('utf8').trim()
    if (!tail) return pos
    try {
      JSON.parse(tail)
      onLine(tail)
      return pos
    } catch {
      return pos - carry.length
    }
  }
  return pos
}

export async function listJsonl(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir, { recursive: true })
    return names.filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n))
  } catch {
    return []
  }
}

/** Project folder name, used only when a line carries no cwd */
function fallbackProject(file: string, projectsDir: string): string {
  let d = dirname(file)
  while (dirname(d) !== projectsDir && dirname(d) !== d) d = dirname(d)
  return basename(d)
}

export class UsageStore {
  readonly entries = new Map<string, UsageEntry>()
  readonly reportedCost = new Map<string, number>()
  /** what the user typed, by session + prompt id */
  readonly prompts = new Map<string, PromptMark>()
  /** bumped whenever entries change */
  revision = 0
  private files = new Map<string, FileState>()
  private owner = new Map<string, string>()
  /** the logs each session was written to (a resumed session copies its history into a new one) */
  private sessionFiles = new Map<string, Set<string>>()

  get fileCount(): number {
    return this.files.size
  }

  filesOf(sessionId: string): string[] {
    return [...(this.sessionFiles.get(sessionId) ?? [])]
  }

  private note(sessionId: string, path: string): void {
    if (!sessionId) return
    const s = this.sessionFiles.get(sessionId)
    if (s) s.add(path)
    else this.sessionFiles.set(sessionId, new Set([path]))
  }

  /** Adds archived rows; they belong to no file, so a rewritten log never removes them */
  seed(rows: Iterable<UsageEntry>): void {
    for (const e of rows) {
      const prev = this.entries.get(e.key)
      if (prev && prev.output >= e.output) continue
      this.entries.set(e.key, e)
      this.revision++
    }
  }

  /** Reads new data from a file. Returns entries that were newly added. */
  async readFile(path: string, projectsDir: string): Promise<UsageEntry[]> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return []
    }
    let st = this.files.get(path)
    if (st && size < st.offset) {
      for (const k of st.keys) {
        if (this.owner.get(k) === path) {
          this.entries.delete(k)
          this.owner.delete(k)
          this.revision++
        }
      }
      st = undefined
    }
    if (!st) {
      st = { offset: 0, keys: new Set() }
      this.files.set(path, st)
    }
    if (size === st.offset) return []

    const added: UsageEntry[] = []
    const fb = fallbackProject(path, projectsDir)
    const state = st
    state.offset = await readLinesFrom(path, state.offset, size, (line) => {
      const p = parseLine(line, fb)
      if (!p) return
      if (p.kind === 'cost') {
        this.reportedCost.set(p.state.sessionId, p.state.totalCostUSD)
        return
      }
      if (p.kind === 'prompt') {
        this.note(p.prompt.sessionId, path)
        // a resumed session repeats its history: keep the first sighting
        if (!this.prompts.has(p.prompt.key)) this.prompts.set(p.prompt.key, p.prompt)
        return
      }
      const e = p.entry
      this.note(e.sessionId, path)
      const prev = this.entries.get(e.key)
      if (prev) {
        if (e.output > prev.output) {
          this.entries.set(e.key, e)
          this.revision++
          const i = added.indexOf(prev)
          if (i >= 0) added[i] = e
        }
        return
      }
      this.entries.set(e.key, e)
      this.revision++
      this.owner.set(e.key, path)
      state.keys.add(e.key)
      added.push(e)
    })
    return added
  }

  /** Full scan; files are read sequentially to keep memory flat */
  async scan(projectsDirs: string[]): Promise<UsageEntry[]> {
    const added: UsageEntry[] = []
    for (const dir of projectsDirs) {
      for (const f of await listJsonl(dir)) added.push(...(await this.readFile(f, dir)))
    }
    return added
  }

  /** Files whose size differs from what has been read */
  async changedFiles(projectsDirs: string[]): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = []
    for (const dir of projectsDirs) {
      for (const f of await listJsonl(dir)) {
        const st = this.files.get(f)
        try {
          const size = (await stat(f)).size
          if (!st || st.offset !== size) out.push([f, dir])
        } catch {
          /* removed */
        }
      }
    }
    return out
  }
}
