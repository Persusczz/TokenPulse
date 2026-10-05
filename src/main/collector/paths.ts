import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Claude config roots, in priority order */
export function claudeRoots(): string[] {
  const env = process.env.CLAUDE_CONFIG_DIR
  const list = [
    ...(env ? env.split(',').map((s) => s.trim()).filter(Boolean) : []),
    join(homedir(), '.claude'),
    join(homedir(), '.config', 'claude')
  ]
  return [...new Set(list.map((p) => resolve(p)))].filter((p) => existsSync(p))
}

/**
 * `projects` directories to scan. Extra dirs may point at a Claude root or
 * directly at a projects folder.
 */
export function projectsDirs(extra: string[]): string[] {
  const out: string[] = []
  for (const root of claudeRoots()) {
    const p = join(root, 'projects')
    if (existsSync(p)) out.push(p)
  }
  for (const raw of extra) {
    const d = resolve(raw)
    const p = join(d, 'projects')
    if (existsSync(p)) out.push(p)
    else if (existsSync(d)) out.push(d)
  }
  return [...new Set(out)]
}

export function credentialsPath(): string | null {
  for (const root of claudeRoots()) {
    const p = join(root, '.credentials.json')
    if (existsSync(p)) return p
  }
  return null
}
