import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetFor, checksumOf, newer, releaseOf, Updater } from '../src/main/updater'

const release = (version: string, files: Record<string, Buffer>, sums?: string) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  body: '## 更新\n- 新东西',
  html_url: `https://github.com/x/TokenPulse/releases/tag/v${version}`,
  published_at: '2026-10-06T00:00:00Z',
  assets: [
    ...Object.entries(files).map(([name, data]) => ({ name, size: data.length, browser_download_url: `https://dl/${name}` })),
    { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'https://dl/SHA256SUMS.txt' }
  ],
  _sums: sums ?? Object.entries(files).map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}`).join('\n')
})

function fakeGitHub(rel: ReturnType<typeof release>, files: Record<string, Buffer>) {
  const hits: string[] = []
  const fetchFn = async (url: string) => {
    hits.push(url)
    if (url.includes('api.github.com')) return new Response(JSON.stringify(rel), { status: 200 })
    if (url.endsWith('SHA256SUMS.txt')) return new Response(rel._sums, { status: 200 })
    const name = url.split('/').pop()!
    const data = files[name]
    if (!data) return new Response('no', { status: 404 })
    return new Response(new Blob([data]).stream(), { status: 200, headers: { 'content-length': String(data.length) } })
  }
  return { fetchFn, hits }
}

describe('updater: picking the release and its file', () => {
  it('compares versions part by part', () => {
    expect(newer('2.14.1', '2.14.0')).toBe(true)
    expect(newer('v2.10.0', '2.9.9')).toBe(true)
    expect(newer('2.14.0', '2.14.0')).toBe(false)
    expect(newer('2.9.0', '2.14.0')).toBe(false)
  })

  it('finds the portable exe or the installer, with GitHub turning spaces into dots', () => {
    const r = releaseOf(release('2.15.0', { 'TokenPulse-2.15.0-portable.exe': Buffer.from('p'), 'TokenPulse.Setup.2.15.0.exe': Buffer.from('i') }))!
    expect(assetFor(r, 'portable')?.name).toBe('TokenPulse-2.15.0-portable.exe')
    expect(assetFor(r, 'installer')?.name).toBe('TokenPulse.Setup.2.15.0.exe')
    expect(releaseOf({ ...release('2.15.0', {}), draft: true })).toBeNull()
  })

  it('reads SHA256SUMS lines, also when written with the original spaces', () => {
    const h = 'a'.repeat(64)
    expect(checksumOf(`${h}  TokenPulse Setup 2.15.0.exe\n${'b'.repeat(64)} *TokenPulse-2.15.0-portable.exe`, 'TokenPulse.Setup.2.15.0.exe')).toBe(h)
    expect(checksumOf(`${h}  other.exe`, 'TokenPulse-2.15.0-portable.exe')).toBeNull()
  })
})

describe('updater: checking and downloading', () => {
  const exe = Buffer.from('MZ new portable build '.repeat(5000))
  const files = { 'TokenPulse-2.15.0-portable.exe': exe, 'TokenPulse.Setup.2.15.0.exe': Buffer.from('MZ installer') }

  it('finds a newer release, downloads the portable exe and checks it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-up-'))
    const gh = fakeGitHub(release('2.15.0', files), files)
    const u = new Updater(gh.fetchFn, { current: '2.14.0', kind: 'portable', portable: 'G:\\apps\\TokenPulse-2.14.0-portable.exe', dir })
    const seen: string[] = []
    u.on('state', (s) => seen.push(s.status))
    expect((await u.check()).status).toBe('available')
    expect(u.state.latest).toMatchObject({ version: '2.15.0', size: exe.length })
    expect((await u.download()).status).toBe('ready')
    expect(readFileSync(join(dir, 'TokenPulse-2.15.0-portable.exe')).equals(exe)).toBe(true)
    expect(seen).toContain('downloading')
    expect(gh.hits.some((h) => h.endsWith('TokenPulse.Setup.2.15.0.exe'))).toBe(false)
  })

  it('stays put when there is nothing newer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-up-'))
    const gh = fakeGitHub(release('2.14.0', files), files)
    const u = new Updater(gh.fetchFn, { current: '2.14.0', kind: 'portable', portable: null, dir })
    expect((await u.check()).status).toBe('none')
  })

  it('throws away a download whose checksum does not match, and refuses a release without checksums', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-up-'))
    const bad = fakeGitHub(release('2.15.0', files, `${'0'.repeat(64)}  TokenPulse-2.15.0-portable.exe`), files)
    const u = new Updater(bad.fetchFn, { current: '2.14.0', kind: 'portable', portable: null, dir })
    await u.check()
    const s = await u.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('校验不通过')
    expect(existsSync(join(dir, 'TokenPulse-2.15.0-portable.exe'))).toBe(false)
    expect(existsSync(join(dir, 'TokenPulse-2.15.0-portable.exe.part'))).toBe(false)

    const none = fakeGitHub(release('2.15.0', files, ''), files)
    const v = new Updater(none.fetchFn, { current: '2.14.0', kind: 'installer', portable: null, dir })
    await v.check()
    expect((await v.download()).error).toContain('没有这个文件的校验值')
  })
})
