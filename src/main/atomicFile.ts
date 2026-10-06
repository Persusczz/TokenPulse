import { realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { realpath, rename, unlink, writeFile } from 'node:fs/promises'

/**
 * Files written whole or not at all: into a temp file beside the target, then
 * renamed over it. A crash, a shutdown or a second write at the same moment
 * never leaves half a file behind; a half-written settings.json reads as the
 * defaults, and with the guard off by default that would take the user's
 * guard hook out of Claude Code.
 *
 * Writes to one file go one at a time and the newest content wins: a write
 * still waiting when a newer one comes in is dropped (two writes at once
 * could otherwise finish in either order and leave the older content).
 *
 * A link is followed, so the file it points at is replaced, not the link.
 * Windows can refuse the rename for a moment while another program has the
 * target open (a virus scanner, an editor); after a few tries the content is
 * written in place rather than lost.
 */

let seq = 0
const tmpOf = (path: string) => `${path}.${process.pid}.${++seq}.tmp`
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
const WAITS = [20, 60, 150]
/** per file: the write in progress or queued last, and the number of the newest write asked for */
const queues = new Map<string, Promise<void>>()
const newest = new Map<string, number>()

function ask(path: string): number {
  const n = (newest.get(path) ?? 0) + 1
  newest.set(path, n)
  return n
}

export function writeFileAtomic(path: string, data: string): Promise<void> {
  const mine = ask(path)
  const run = (queues.get(path) ?? Promise.resolve()).then(() => (newest.get(path) === mine ? write(path, data) : undefined))
  const tail = run.catch(() => {})
  queues.set(path, tail)
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path)
  })
  return run
}

async function write(path: string, data: string): Promise<void> {
  const target = await realpath(path).catch(() => path)
  const tmp = tmpOf(target)
  try {
    await writeFile(tmp, data, 'utf8')
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, target)
      return
    } catch (e) {
      const busy = BUSY.has((e as NodeJS.ErrnoException).code ?? '')
      if (busy && i < WAITS.length) {
        await new Promise((r) => setTimeout(r, WAITS[i]))
        continue
      }
      await unlink(tmp).catch(() => {})
      if (!busy) throw e
      return writeFile(target, data, 'utf8')
    }
  }
}

/** The same, at once (for the last write on quit); writes still queued for the file are dropped */
export function writeFileAtomicSync(path: string, data: string): void {
  ask(path)
  let target = path
  try {
    target = realpathSync(path)
  } catch {
    /* not there yet */
  }
  const tmp = tmpOf(target)
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, target)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* never made */
    }
    if (!BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e
    writeFileSync(target, data, 'utf8')
  }
}
