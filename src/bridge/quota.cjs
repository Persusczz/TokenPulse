#!/usr/bin/env node
'use strict'
// TokenPulse quota CLI (`tpq`): the subscription usage windows (5-hour, 7-day,
// per-model weekly) of the account Claude Code is logged in with.
//
// It asks the usage endpoint behind Claude Code's /usage. That endpoint
// rate-limits, so a reading is reused for a minute, a 429 is respected, and
// while the endpoint is unavailable the newest reading saved by TokenPulse or
// its statusline bridge is shown instead. The OAuth token is only read, never
// refreshed or written.

const fs = require('fs')
const os = require('os')
const path = require('path')

const USAGE_URL = process.env.TOKENPULSE_USAGE_URL || 'https://api.anthropic.com/api/oauth/usage'
const HOUR = 3600_000
const DAY = 24 * HOUR
/** readings younger than this are reused instead of asking the endpoint again */
const CACHE_MS = 60_000

const HELP = `tpq · 查看 Claude 订阅额度（5 小时 / 7 天窗口）

用法
  tpq                    额度面板
  tpq -w, --watch [秒]   持续刷新（默认每 120 秒查询一次，最少 60 秒）
  tpq -l, --line         单行输出，适合放进 shell 提示符
  tpq --json             JSON 输出
  tpq -f, --fresh        跳过 1 分钟缓存立即查询（仍遵守接口限流）
  tpq install            在 Claude Code 状态栏显示额度，并添加 tpq 命令
  tpq uninstall          撤销 install
  --no-color             不使用颜色
`

const LABELS = {
  session: '5 小时会话',
  five_hour: '5 小时会话',
  weekly_all: '7 天 · 全部模型',
  seven_day: '7 天 · 全部模型',
  weekly_opus: '7 天 · Opus',
  seven_day_opus: '7 天 · Opus',
  weekly_sonnet: '7 天 · Sonnet',
  seven_day_sonnet: '7 天 · Sonnet',
  extra_usage: '额外用量 · 本月'
}
const SHORT = {
  session: '5h',
  five_hour: '5h',
  weekly_all: '7d',
  seven_day: '7d',
  weekly_opus: '7d Opus',
  seven_day_opus: '7d Opus',
  weekly_sonnet: '7d Sonnet',
  seven_day_sonnet: '7d Sonnet',
  extra_usage: '额外'
}
const PLANS = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' }
const SOURCES = {
  oauth: '用量接口',
  cache: '用量接口',
  app: 'TokenPulse',
  estimate: 'TokenPulse 本地估算',
  statusline: '官方状态栏'
}

function claudeRoots() {
  const env = process.env.CLAUDE_CONFIG_DIR
  const list = [
    ...(env ? env.split(',').map((s) => s.trim()).filter(Boolean) : []),
    path.join(os.homedir(), '.claude'),
    path.join(os.homedir(), '.config', 'claude')
  ]
  return [...new Set(list.map((p) => path.resolve(p)))].filter((p) => fs.existsSync(p))
}

const ROOT = claudeRoots()[0] || path.join(os.homedir(), '.claude')
/** the folder shared with TokenPulse and its Claude Code scripts */
const DIR = process.env.TOKENPULSE_BRIDGE_DIR || path.join(ROOT, 'tokenpulse')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, file)
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

const win = (key, pct, resetsAt) => ({ key, label: LABELS[key] || key.replace(/_/g, ' '), pct, resetsAt })
const isoMs = (s) => (typeof s === 'string' && Date.parse(s) > 0 ? Date.parse(s) : null)

/**
 * The usage response: the `limits` list, else the older per-window keys. The
 * other top-level keys are internal codenames and are ignored on purpose.
 */
function parseUsage(json) {
  const windows = []
  if (Array.isArray(json && json.limits)) {
    for (const l of json.limits) {
      if (l && typeof l.percent === 'number' && typeof l.kind === 'string') windows.push(win(l.kind, l.percent, isoMs(l.resets_at)))
    }
  }
  if (!windows.length) {
    for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
      const w = json && json[key]
      if (w && typeof w.utilization === 'number') windows.push(win(key, w.utilization, isoMs(w.resets_at)))
    }
  }
  const x = json && json.extra_usage
  if (x && x.is_enabled && typeof x.utilization === 'number') windows.push(win('extra_usage', x.utilization, null))
  const rows = json && json.seven_day_breakdown && json.seven_day_breakdown.rows
  const breakdown = Array.isArray(rows)
    ? rows.filter((r) => r && typeof r.percent === 'number' && typeof r.display_name === 'string').map((r) => ({ name: r.display_name, pct: r.percent }))
    : []
  return { windows, breakdown }
}

/** Readings saved by TokenPulse (quota.json), its statusline bridge (statusline.json) and earlier runs (usage.json), newest first */
function savedReadings(dir) {
  const out = []
  const q = readJson(path.join(dir, 'quota.json'))
  if (q && Number(q.updatedAt)) {
    let windows = Array.isArray(q.windows)
      ? q.windows
          .filter((w) => w && typeof w.key === 'string' && typeof w.pct === 'number')
          .map((w) => ({ key: w.key, label: w.label || LABELS[w.key] || w.key, pct: w.pct, resetsAt: Number(w.resetsAt) || null }))
      : []
    // written by TokenPulse versions before the full window list
    if (!windows.length) {
      for (const [key, w] of [['five_hour', q.fiveHour], ['seven_day', q.sevenDay]]) {
        if (w && typeof w.pct === 'number') windows.push(win(key, w.pct, Number(w.resetsAt) || null))
      }
    }
    if (windows.length) out.push({ source: q.origin === 'local' ? 'estimate' : 'app', fetchedAt: Number(q.updatedAt), plan: q.plan || null, windows, breakdown: [] })
  }
  const s = readJson(path.join(dir, 'statusline.json'))
  const l = s && s.rate_limits
  if (l) {
    const windows = []
    for (const key of ['five_hour', 'seven_day']) {
      const w = l[key]
      if (w && typeof w.used_percentage === 'number') windows.push(win(key, w.used_percentage, Number(w.resets_at) > 0 ? w.resets_at * 1000 : null))
    }
    if (windows.length) out.push({ source: 'statusline', fetchedAt: Number(s.updatedAt) || 0, plan: null, windows, breakdown: [] })
  }
  const c = readJson(path.join(dir, 'usage.json'))
  if (c && Array.isArray(c.windows) && c.windows.length && Number(c.fetchedAt)) {
    out.push({ source: 'cache', fetchedAt: c.fetchedAt, plan: c.plan || null, windows: c.windows, breakdown: c.breakdown || [] })
  }
  return out.sort((a, b) => b.fetchedAt - a.fetchedAt)
}

/** A window whose reset time has passed is empty until the next reading */
const settle = (windows, now) => windows.map((w) => (w.resetsAt && w.resetsAt <= now ? { ...w, pct: 0, resetsAt: null, reset: true } : w))

function credentials() {
  for (const root of claudeRoots()) {
    const c = readJson(path.join(root, '.credentials.json'))
    if (c && c.claudeAiOauth) return c.claudeAiOauth
  }
  return null
}

async function fetchUsage(now) {
  const cred = credentials()
  if (!cred || !cred.accessToken) return { error: '未找到 Claude Code 登录凭据，请先在 Claude Code 中登录' }
  const plan = PLANS[cred.subscriptionType] || cred.subscriptionType || null
  if (typeof cred.expiresAt === 'number' && cred.expiresAt < now) return { plan, error: '登录令牌已过期，打开 Claude Code 后会自动续期' }
  let res
  try {
    res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'TokenPulse-CLI/1.1' },
      signal: AbortSignal.timeout(15000)
    })
  } catch (e) {
    return { plan, error: `无法连接用量接口（${(e.cause && e.cause.code) || e.message}）` }
  }
  if (res.status === 401) return { plan, error: '登录令牌已失效，打开 Claude Code 后会自动续期' }
  if (res.status === 429) return { plan, limited: true, retryAfter: Number(res.headers.get('retry-after')) || 0 }
  if (!res.ok) return { plan, error: `用量接口返回 HTTP ${res.status}` }
  try {
    return { plan, ...parseUsage(await res.json()) }
  } catch {
    return { plan, error: '用量接口返回了无法解析的内容' }
  }
}

const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000))
const finish = (r, now) => ({ ...r, windows: settle(r.windows, now) })

/** The freshest reading available: cache, endpoint, then whatever TokenPulse saved */
async function getReading(maxAge = CACHE_MS) {
  const now = Date.now()
  const cacheFile = path.join(DIR, 'usage.json')
  const cache = readJson(cacheFile) || {}
  if (Array.isArray(cache.windows) && cache.windows.length && now - cache.fetchedAt < maxAge) {
    return finish({ source: 'cache', fetchedAt: cache.fetchedAt, plan: cache.plan, windows: cache.windows, breakdown: cache.breakdown || [] }, now)
  }
  let note
  let plan = null
  if (cache.backoffUntil > now) note = `用量接口限流中，约 ${minutes(cache.backoffUntil - now)} 分钟后再试`
  else {
    const r = await fetchUsage(now)
    plan = r.plan || null
    if (r.windows) {
      const reading = { source: 'oauth', fetchedAt: now, plan, windows: r.windows, breakdown: r.breakdown }
      writeJson(cacheFile, reading)
      return finish(reading, now)
    }
    if (r.limited) {
      const backoffMs = Math.min(30 * 60_000, Math.max((cache.backoffMs || 0) * 2, 5 * 60_000))
      const wait = r.retryAfter > 0 ? Math.min(HOUR, r.retryAfter * 1000) : backoffMs
      writeJson(cacheFile, { ...cache, backoffUntil: now + wait, backoffMs })
      note = `用量接口限流（HTTP 429），约 ${minutes(wait)} 分钟后再试`
    } else note = r.error
  }
  const saved = savedReadings(DIR)[0]
  const fallback = saved ? { ...saved, plan: saved.plan || plan } : { source: 'none', fetchedAt: 0, plan, windows: [], breakdown: [] }
  return finish({ ...fallback, note }, now)
}

// ---------------------------------------------------------------- rendering

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

/** Terminal columns, counting CJK and full-width characters as two */
function width(s) {
  let w = 0
  for (const ch of s.replace(ANSI, '')) {
    const c = ch.codePointAt(0)
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    w += wide ? 2 : 1
  }
  return w
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)))

function palette(on) {
  const c = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : String(s))
  return {
    accent: c('38;2;217;119;87'),
    good: c('38;2;76;191;76'),
    warn: c('38;2;250;178;25'),
    bad: c('38;2;230;72;62'),
    dim: c('2'),
    bold: c('1')
  }
}
const level = (C, pct) => (pct >= 90 ? C.bad : pct >= 75 ? C.warn : C.good)

/** 4 小时 48 分 / 5 天 4 小时, or 4h48m / 5d04h when short */
function countdown(ms, short) {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (short) return d ? `${d}d${String(h).padStart(2, '0')}h` : h ? `${h}h${String(mm).padStart(2, '0')}m` : `${mm}m`
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${mm} 分` : `${mm} 分钟`
}

function ago(ms) {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  return `${Math.floor(m / 1440)} 天前`
}

function clockAt(t, now) {
  const d = new Date(t)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(new Date(now))) / DAY)
  if (diff === 0) return `今天 ${hm}`
  if (diff === 1) return `明天 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()} 周${'日一二三四五六'[d.getDay()]} ${hm}`
}

/** window length, for the elapsed-time tick */
function spanOf(key) {
  if (key === 'session' || key === 'five_hour') return 5 * HOUR
  if (/^(weekly|seven_day)/.test(key)) return 7 * DAY
  return 0
}

const EIGHTHS = ' ▏▎▍▌▋▊▉'

/** `n` cells at eighth-cell resolution; `mark` (0–1) puts a tick where the window's elapsed time is */
function bar(pct, n, C, mark) {
  const fill = Math.max(0, Math.min(1, pct / 100)) * n
  const full = Math.floor(fill)
  const part = Math.floor((fill - full) * 8)
  const tick = typeof mark === 'number' && mark >= 0 && mark <= 1 ? Math.min(n - 1, Math.floor(mark * n)) : -1
  const paint = level(C, pct)
  let s = ''
  for (let i = 0; i < n; i++) {
    if (i === tick) s += C.accent('┃')
    else if (i < full) s += paint('█')
    else if (i === full && part) s += paint(EIGHTHS[part])
    else s += C.dim('░')
  }
  return s
}

function guardLine(C) {
  const g = readJson(path.join(DIR, 'guard.json'))
  if (!g || !g.enabled) return ''
  let paused = 0
  try {
    paused = fs.readdirSync(path.join(DIR, 'paused')).filter((n) => n.endsWith('.json')).length
  } catch {
    /* nothing paused */
  }
  return paused ? C.bad('⏸ 额度守卫正在暂停任务') : C.dim(`额度守卫：5h 达到 ${g.pauseAt}% 时暂停任务`)
}

function renderPanel(r, now, C) {
  const BAR = 24
  const lw = Math.max(0, ...r.windows.map((w) => width(w.label)))
  let ticked = false
  const rows = r.windows.map((w) => {
    const span = spanOf(w.key)
    const mark = span && w.resetsAt ? 1 - (w.resetsAt - now) / span : null
    if (mark !== null && mark >= 0 && mark <= 1) ticked = true
    const pct = level(C, w.pct)(`${Math.round(w.pct)}%`.padStart(4))
    const when = w.reset ? C.dim('已重置') : w.resetsAt ? `${countdown(w.resetsAt - now)}后重置${C.dim(' · ' + clockAt(w.resetsAt, now))}` : ''
    return `  ${pad(w.label, lw)}  ${bar(w.pct, BAR, C, mark)} ${pct}   ${when}`
  })
  const title = `  ${C.accent('✻')} ${C.bold('TokenPulse')}${r.plan ? `${C.dim(' · ')}Claude ${r.plan}` : ''}`
  const meta = r.fetchedAt ? C.dim(`${SOURCES[r.source] || r.source} · ${ago(now - r.fetchedAt)}`) : ''
  const full = Math.max(60, ...rows.map(width))
  const out = ['', meta ? title + ' '.repeat(Math.max(3, full - width(title) - width(meta))) + meta : title, '']
  out.push(...(rows.length ? rows : [`  ${C.dim('暂无额度数据')}`]))
  const shares = (r.breakdown || []).filter((b) => Math.round(b.pct) > 0)
  if (shares.length) out.push('', `  ${C.dim('本周用量构成')}  ${shares.map((b) => `${b.name} ${Math.round(b.pct)}%`).join(C.dim(' · '))}`)
  const foot = []
  if (ticked) foot.push(`${C.accent('┃')} ${C.dim('窗口已过去的时间')}`)
  const g = guardLine(C)
  if (g) foot.push(g)
  if (foot.length) out.push('', `  ${foot.join('     ')}`)
  if (r.note) {
    const shown = r.windows.length ? C.dim(`，以上是${ago(now - r.fetchedAt)}保存的读数`) : ''
    out.push('', `  ${C.warn('!')} ${r.note}${shown}`)
  }
  out.push('')
  return out.join('\n')
}

function renderLine(r, now, C) {
  if (!r.windows.length) return C.dim(r.note || '暂无额度数据')
  return r.windows
    .map((w) => `${SHORT[w.key] || w.label} ${level(C, w.pct)(`${Math.round(w.pct)}%`)}${w.resetsAt ? C.dim(` ↻${countdown(w.resetsAt - now, true)}`) : ''}`)
    .join(C.dim(' · '))
}

const toJson = (r) => ({
  source: r.source,
  fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).toISOString() : null,
  plan: r.plan || null,
  windows: r.windows.map((w) => ({ key: w.key, label: w.label, usedPercent: w.pct, resetsAt: w.resetsAt ? new Date(w.resetsAt).toISOString() : null })),
  breakdown: r.breakdown || [],
  note: r.note || null
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function watch(seconds, C) {
  const every = Math.max(60, seconds) * 1000
  const out = process.stdout
  const restore = () => out.write('\x1b[?25h\x1b[?1049l')
  out.write('\x1b[?1049h\x1b[?25l')
  process.on('SIGINT', () => {
    restore()
    process.exit(0)
  })
  let r = null
  let at = 0
  for (;;) {
    if (!r || Date.now() - at >= every) {
      r = await getReading(every)
      at = Date.now()
    }
    out.write(`\x1b[H\x1b[2J${renderPanel(r, Date.now(), C)}\n  ${C.dim(`每 ${every / 1000} 秒查询一次 · Ctrl+C 退出`)}\n`)
    await sleep(10_000)
  }
}

// ------------------------------------------------------------ install

const BRIDGE_RE = /tokenpulse[\\/]+statusline\.cjs/i
const SHIM_MARK = 'TokenPulse quota CLI'

const isBridge = (sl) =>
  !!sl && typeof sl === 'object' && [sl.command, ...(Array.isArray(sl.args) ? sl.args : [])].some((s) => typeof s === 'string' && BRIDGE_RE.test(s))

/** Read-modify-write of Claude Code's settings.json, keeping a backup; invalid JSON is left untouched */
function editSettings(fn) {
  const file = path.join(ROOT, 'settings.json')
  let text = null
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    /* no settings yet */
  }
  let cfg = {}
  if (text && text.trim()) {
    cfg = JSON.parse(text.replace(/^﻿/, ''))
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('settings.json 不是 JSON 对象')
  }
  const next = fn(cfg)
  if (JSON.stringify(next) === JSON.stringify(cfg)) return false
  fs.mkdirSync(ROOT, { recursive: true })
  if (text !== null) fs.copyFileSync(file, `${file}.tokenpulse.bak`)
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return true
}

/** A directory on PATH to put the `tpq` command in */
function shimDir() {
  const norm = (p) => {
    const r = path.resolve(p).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  const onPath = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean).map(norm)
  const home = os.homedir()
  const candidates =
    process.platform === 'win32'
      ? [process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), path.join(home, '.local', 'bin'), path.join(home, 'bin'), path.dirname(process.execPath)]
      : [path.join(home, '.local', 'bin'), path.join(home, 'bin')]
  return candidates.filter(Boolean).find((d) => fs.existsSync(d) && onPath.includes(norm(d))) || null
}

const shimFiles = (dir) => (process.platform === 'win32' ? ['tpq.cmd', 'tpq'] : ['tpq']).map((n) => path.join(dir, n))
const ours = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').includes(SHIM_MARK)
  } catch {
    return false
  }
}

function writeShims(dir) {
  const node = process.execPath
  const script = path.join(DIR, 'quota.cjs')
  const posix = (p) => p.replace(/\\/g, '/')
  for (const file of shimFiles(dir)) {
    if (fs.existsSync(file) && !ours(file)) throw new Error(`${file} 已存在且不是 TokenPulse 创建的`)
    if (file.endsWith('.cmd')) fs.writeFileSync(file, `@rem ${SHIM_MARK}\r\n@"${node}" "${script}" %*\r\n`)
    else fs.writeFileSync(file, `#!/bin/sh\n# ${SHIM_MARK}\nexec "${posix(node)}" "${posix(script)}" "$@"\n`, { mode: 0o755 })
  }
}

function install(noShim, C) {
  fs.mkdirSync(DIR, { recursive: true })
  for (const name of ['quota.cjs', 'statusline.cjs']) {
    const src = path.join(__dirname, name)
    const dst = path.join(DIR, name)
    if (path.resolve(src) !== path.resolve(dst)) fs.copyFileSync(src, dst)
  }
  const command = `"${process.execPath}" "${path.join(DIR, 'statusline.cjs')}"`
  let prev = null
  const changed = editSettings((cfg) => {
    const cur = cfg.statusLine
    // installing again (or after TokenPulse did) must not lose the original statusline
    if (cur && typeof cur === 'object' && !isBridge(cur)) prev = cur
    const statusLine = { type: 'command', command }
    if (cur && typeof cur.refreshInterval === 'number') statusLine.refreshInterval = cur.refreshInterval
    return { ...cfg, statusLine }
  })
  if (prev) writeJson(path.join(DIR, 'statusline-prev.json'), prev)
  const lines = [`${C.good('✓')} Claude Code 状态栏${changed ? '已改为' : '已经是'} TokenPulse 额度桥接${changed ? `（原设置备份为 settings.json.tokenpulse.bak）` : ''}`]
  if (prev) lines.push(`  原来的状态栏会继续显示在前面：${C.dim(prev.command || JSON.stringify(prev))}`)
  if (!noShim) {
    const dir = shimDir()
    if (dir) {
      writeShims(dir)
      lines.push(`${C.good('✓')} 已添加命令 tpq（${dir}），新开一个终端即可使用`)
    } else lines.push(`${C.warn('!')} 没有找到可写入的 PATH 目录，请直接运行：node "${path.join(DIR, 'quota.cjs')}"`)
  }
  lines.push('', '  Claude Code 状态栏会显示 5h / 7d 额度，每次响应后更新')
  return lines.join('\n')
}

function uninstall(noShim, C) {
  const prevFile = path.join(DIR, 'statusline-prev.json')
  const prev = readJson(prevFile)
  const changed = editSettings((cfg) => {
    if (!isBridge(cfg.statusLine)) return cfg
    const next = { ...cfg }
    if (prev) next.statusLine = prev
    else delete next.statusLine
    return next
  })
  try {
    fs.unlinkSync(prevFile)
  } catch {
    /* there was no statusline before */
  }
  const lines = [changed ? `${C.good('✓')} 已恢复原来的 Claude Code 状态栏` : `${C.dim('·')} 状态栏没有使用 TokenPulse 桥接，未改动`]
  const dir = noShim ? null : shimDir()
  const removed = dir ? shimFiles(dir).filter(ours) : []
  for (const f of removed) fs.unlinkSync(f)
  if (removed.length) lines.push(`${C.good('✓')} 已移除 tpq 命令`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- main

async function main(argv) {
  const args = argv.slice(2)
  const has = (...flags) => flags.some((f) => args.includes(f))
  const C = palette(!has('--no-color') && !process.env.NO_COLOR && (has('--color') || !!process.stdout.isTTY))
  const words = args.filter((a) => !a.startsWith('-'))
  const say = (s) => process.stdout.write(s + '\n')
  if (has('-h', '--help')) return say(HELP)
  if (words[0] === 'install') return say(install(has('--no-shim'), C))
  if (words[0] === 'uninstall') return say(uninstall(has('--no-shim'), C))
  if (words.some((w) => !/^\d+$/.test(w))) {
    process.stderr.write(`未知参数：${words.join(' ')}\n\n${HELP}`)
    process.exitCode = 2
    return
  }
  if (has('-w', '--watch')) return watch(Number(words[0]) || 120, C)
  const r = await getReading(has('-f', '--fresh') ? 0 : CACHE_MS)
  const now = Date.now()
  if (has('--json')) say(JSON.stringify(toJson(r), null, 2))
  else if (has('-l', '--line')) say(renderLine(r, now, C))
  else say(renderPanel(r, now, C))
  if (!r.windows.length) process.exitCode = 1
}

if (require.main === module) {
  main(process.argv).catch((e) => {
    process.stderr.write(`tpq: ${e.message}\n`)
    process.exitCode = 1
  })
}

module.exports = { parseUsage, savedReadings, settle, countdown, clockAt, width, bar, palette, renderLine, renderPanel, isBridge }
