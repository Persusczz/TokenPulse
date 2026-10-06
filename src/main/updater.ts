import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { UpdateState } from '@shared/types'

/**
 * Updates from the project's GitHub releases. The portable build is
 * replaced in place (same path, so shortcuts and auto-start keep working);
 * the installed build runs the new installer silently. Every download is
 * checked against the release's SHA256SUMS.txt before it is used.
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const REPO = 'Persusczz/TokenPulse'

export type InstallKind = 'portable' | 'installer' | 'dev'

export interface Asset {
  name: string
  url: string
  size: number
}

export interface Release {
  version: string
  notes: string
  page: string
  publishedAt: number
  assets: Asset[]
}

/** "v2.14.0" → [2, 14, 0]; compares part by part */
export function newer(a: string, b: string): boolean {
  const p = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** the file of a release that fits this kind of install */
export function assetFor(r: Release, kind: InstallKind): Asset | null {
  const v = r.version.replace(/\./g, '\\.')
  const want = kind === 'portable' ? new RegExp(`^TokenPulse-${v}-portable\\.exe$`, 'i') : new RegExp(`^TokenPulse[ .]Setup[ .]${v}\\.exe$`, 'i')
  return r.assets.find((a) => want.test(a.name)) ?? null
}

/** "<sha256>  <name>" lines */
export function checksumOf(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && (m[2].trim() === name || m[2].trim().replace(/ /g, '.') === name)) return m[1].toLowerCase()
  }
  return null
}

export function releaseOf(j: any): Release | null {
  if (!j || typeof j.tag_name !== 'string' || j.draft || j.prerelease) return null
  return {
    version: j.tag_name.replace(/^v/i, ''),
    notes: typeof j.body === 'string' ? j.body : '',
    page: typeof j.html_url === 'string' ? j.html_url : `https://github.com/${REPO}/releases`,
    publishedAt: Date.parse(j.published_at) || 0,
    assets: Array.isArray(j.assets)
      ? j.assets.filter((a: any) => typeof a?.name === 'string' && typeof a?.browser_download_url === 'string').map((a: any) => ({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 }))
      : []
  }
}

export class Updater extends EventEmitter {
  state: UpdateState
  private file: string | null = null
  private release: Release | null = null
  private busy = false

  constructor(
    private fetchFn: Fetch,
    private opts: { current: string; kind: InstallKind; /** the portable exe being run */ portable: string | null; dir: string; /** the latest-release URL (tests point it elsewhere) */ api?: string }
  ) {
    super()
    this.state = { status: 'idle', current: opts.current, kind: opts.kind }
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  /** looks for a newer release */
  async check(): Promise<UpdateState> {
    if (this.busy) return this.state
    if (this.state.status === 'ready' || this.state.status === 'downloading') return this.state
    this.set({ status: 'checking', error: undefined })
    try {
      const res = await this.fetchFn(this.opts.api ?? `https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TokenPulse' },
        signal: AbortSignal.timeout(20_000)
      })
      if (res.status === 404) {
        this.set({ status: 'none', checkedAt: Date.now() })
        return this.state
      }
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub 暂时限制了查询次数，稍后再试' : `HTTP ${res.status}`)
      const r = releaseOf(await res.json())
      if (!r || !newer(r.version, this.opts.current)) {
        this.set({ status: 'none', checkedAt: Date.now(), latest: r ? { version: r.version, notes: r.notes, page: r.page, publishedAt: r.publishedAt } : undefined })
        return this.state
      }
      this.release = r
      const asset = this.opts.kind === 'dev' ? null : assetFor(r, this.opts.kind)
      this.set({
        status: 'available',
        checkedAt: Date.now(),
        latest: { version: r.version, notes: r.notes, page: r.page, publishedAt: r.publishedAt, size: asset?.size },
        error: this.opts.kind !== 'dev' && !asset ? '这个版本没有可用的安装文件，请到 Releases 页面手动下载' : undefined
      })
    } catch (e) {
      this.set({ status: 'error', checkedAt: Date.now(), error: `检查更新失败：${e instanceof Error ? e.message : String(e)}` })
    }
    return this.state
  }

  /** downloads the new version and checks its SHA-256 */
  async download(): Promise<UpdateState> {
    const r = this.release
    if (this.busy || !r || this.opts.kind === 'dev') return this.state
    const asset = assetFor(r, this.opts.kind)
    if (!asset) return this.state
    this.busy = true
    this.set({ status: 'downloading', progress: 0, error: undefined })
    const target = join(this.opts.dir, asset.name)
    const part = `${target}.part`
    try {
      await mkdir(this.opts.dir, { recursive: true })
      const sumsAsset = r.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name))
      const sums = sumsAsset ? await (await this.fetchFn(sumsAsset.url, { signal: AbortSignal.timeout(30_000) })).text() : ''
      const expected = checksumOf(sums, asset.name)
      if (!expected) throw new Error('发布里没有这个文件的校验值（SHA256SUMS.txt），为安全起见不自动安装')
      // already downloaded earlier
      const done = await stat(target).catch(() => null)
      if (done?.size === asset.size && (await sha256(target)) === expected) {
        this.file = target
        this.set({ status: 'ready', progress: 1 })
        return this.state
      }
      const res = await this.fetchFn(asset.url, { signal: AbortSignal.timeout(30 * 60_000) })
      if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || asset.size
      const out = createWriteStream(part)
      const hash = createHash('sha256')
      let got = 0
      let shown = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        hash.update(value)
        got += value.length
        if (!out.write(value)) await new Promise<void>((ok) => out.once('drain', () => ok()))
        if (total && got / total - shown >= 0.02) {
          shown = got / total
          this.set({ progress: shown })
        }
      }
      await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())))
      if (hash.digest('hex') !== expected) {
        await unlink(part).catch(() => {})
        throw new Error('下载的文件校验不通过，已删除')
      }
      await unlink(target).catch(() => {})
      await rename(part, target)
      this.file = target
      this.set({ status: 'ready', progress: 1 })
    } catch (e) {
      await unlink(part).catch(() => {})
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    } finally {
      this.busy = false
    }
    return this.state
  }

  /**
   * Hands over to a small script that waits for TokenPulse to quit, puts the
   * new version in place and starts it; the caller then quits.
   */
  async install(): Promise<boolean> {
    const file = this.file
    if (!file || this.state.status !== 'ready') return false
    const q = (p: string) => `"${p.replace(/"/g, '')}"`
    const script = join(this.opts.dir, 'tokenpulse-update.cmd')
    const lines = ['@echo off', 'setlocal', 'set n=0', ':wait', 'ping -n 2 127.0.0.1 >nul', 'set /a n+=1']
    if (this.opts.kind === 'portable' && this.opts.portable) {
      const old = this.opts.portable
      // the old exe stays locked until TokenPulse has quit: keep trying for a minute
      lines.push(`copy /y ${q(file)} ${q(old)} >nul 2>&1 || (if %n% lss 30 goto wait)`, `start "" ${q(old)}`, `del ${q(file)} >nul 2>&1`)
    } else {
      lines.push('if %n% lss 3 goto wait', `start "" /wait ${q(file)} /S --force-run`, `del ${q(file)} >nul 2>&1`)
    }
    lines.push('del "%~f0" >nul 2>&1')
    await writeFile(script, lines.join('\r\n'), 'utf8')
    spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return true
  }

  /** where the portable exe is replaced (for the settings page) */
  get target(): string | null {
    return this.opts.kind === 'portable' && this.opts.portable ? basename(this.opts.portable) : null
  }

  get folder(): string | null {
    return this.opts.portable ? dirname(this.opts.portable) : null
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
