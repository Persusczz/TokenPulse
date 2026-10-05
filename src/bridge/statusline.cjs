'use strict'
// TokenPulse statusline bridge. Claude Code passes its official `rate_limits`
// (5-hour and 7-day used_percentage / resets_at) to statusline commands; this
// saves them for TokenPulse and the quota guard, runs the statusline that was
// configured before (if any) and appends the quota: a bar and reset countdown
// per window, plus the per-model weekly windows TokenPulse or `tpq` last read
// from the usage endpoint. Without a previous statusline it also shows the
// model and how full the context window is.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const DIR = process.env.TOKENPULSE_BRIDGE_DIR || __dirname
/** per-model weekly readings older than this are left out */
const EXTRA_FRESH_MS = 6 * 3600_000

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
  } catch {
    return null
  }
}

let raw = ''
try {
  raw = fs.readFileSync(0, 'utf8')
} catch {
  /* no stdin */
}
let input = {}
try {
  input = JSON.parse(raw.replace(/^﻿/, '')) || {}
} catch {
  /* not JSON */
}

const limits = input.rate_limits
if (limits && (limits.five_hour || limits.seven_day)) {
  const tmp = path.join(DIR, `statusline.${process.pid}.tmp`)
  try {
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), sessionId: input.session_id || '', rate_limits: limits }))
    fs.renameSync(tmp, path.join(DIR, 'statusline.json'))
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

const paint = (code, s) => (s ? `\x1b[${code}m${s}\x1b[0m` : '')
const dim = (s) => paint(2, s)
const level = (pct) => (pct >= 90 ? 31 : pct >= 75 ? 33 : 32)
const EIGHTHS = ' ▏▎▍▌▋▊▉'

/** 8 cells at eighth-cell resolution */
function bar(pct) {
  const n = 8
  const fill = Math.max(0, Math.min(1, pct / 100)) * n
  const full = Math.floor(fill)
  const part = full < n ? Math.floor((fill - full) * 8) : 0
  return paint(level(pct), '█'.repeat(full) + (part ? EIGHTHS[part] : '')) + dim('░'.repeat(n - full - (part ? 1 : 0)))
}

function until(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d${String(h).padStart(2, '0')}h` : h ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

const is5 = (k) => k === 'five_hour' || k === 'session'
const is7 = (k) => k === 'seven_day' || k === 'weekly_all'
const EXTRA = { seven_day_opus: '7d Opus', weekly_opus: '7d Opus', seven_day_sonnet: '7d Sonnet', weekly_sonnet: '7d Sonnet' }

/** `rate_limits` as Claude Code passes it (resets_at in epoch seconds) */
function fromLimits(l) {
  const out = []
  for (const key of ['five_hour', 'seven_day']) {
    const w = l && l[key]
    if (w && typeof w.used_percentage === 'number') out.push({ key, pct: w.used_percentage, resetsAt: Number(w.resets_at) > 0 ? w.resets_at * 1000 : null })
  }
  return out
}

/** Readings saved earlier by this bridge, TokenPulse (quota.json) and `tpq` (usage.json), newest first */
function saved() {
  const out = []
  const s = readJson('statusline.json')
  if (s) out.push({ at: Number(s.updatedAt) || 0, windows: fromLimits(s.rate_limits) })
  const q = readJson('quota.json')
  if (q) {
    const windows = Array.isArray(q.windows) ? q.windows : []
    if (!windows.length) {
      if (q.fiveHour) windows.push({ key: 'five_hour', ...q.fiveHour })
      if (q.sevenDay) windows.push({ key: 'seven_day', ...q.sevenDay })
    }
    out.push({ at: Number(q.updatedAt) || 0, windows })
  }
  const u = readJson('usage.json')
  if (u && Array.isArray(u.windows)) out.push({ at: Number(u.fetchedAt) || 0, windows: u.windows })
  return out
    .map((r) => ({ ...r, windows: r.windows.filter((w) => w && typeof w.key === 'string' && typeof w.pct === 'number') }))
    .filter((r) => r.windows.length)
    .sort((a, b) => b.at - a.at)
}

function quota() {
  const now = Date.now()
  const prior = saved()
  const live = fromLimits(limits)
  // before the session's first response, show the last numbers anything saw
  const base = live.length ? live : (prior.find((r) => r.windows.some((w) => is5(w.key) || is7(w.key))) || { windows: [] }).windows
  const extra = (prior.find((r) => now - r.at < EXTRA_FRESH_MS && r.windows.some((w) => EXTRA[w.key])) || { windows: [] }).windows
  const parts = []
  for (const w of base.filter((x) => is5(x.key)).concat(base.filter((x) => is7(x.key)))) {
    const reset = !!w.resetsAt && w.resetsAt <= now
    const pct = reset ? 0 : w.pct
    const left = !reset && w.resetsAt ? dim(` ↻${until(w.resetsAt)}`) : ''
    parts.push(`${is5(w.key) ? '5h' : '7d'} ${bar(pct)} ${paint(level(pct), `${Math.round(pct)}%`)}${left}`)
  }
  for (const w of extra.filter((x) => EXTRA[x.key])) {
    const pct = w.resetsAt && w.resetsAt <= now ? 0 : w.pct
    parts.push(`${EXTRA[w.key]} ${paint(level(pct), `${Math.round(pct)}%`)}`)
  }
  const guard = readJson('guard.json')
  if (guard && guard.enabled) {
    let paused = 0
    try {
      paused = fs.readdirSync(path.join(DIR, 'paused')).filter((n) => n.endsWith('.json')).length
    } catch {
      /* none */
    }
    parts.push(paused ? paint(31, '⏸ 守卫暂停中') : dim(`守卫 ${guard.pauseAt}%`))
  }
  return parts.join(dim(' · '))
}

/** Model and context use, shown when there is no previous statusline */
function context() {
  const parts = []
  const model = input.model && input.model.display_name
  if (model) parts.push(paint(1, model))
  const ctx = input.context_window && input.context_window.used_percentage
  if (typeof ctx === 'number') parts.push(`上下文 ${paint(level(ctx), `${Math.round(ctx)}%`)}`)
  return parts.join(dim(' · '))
}

let prevOut = ''
const prev = readJson('statusline-prev.json')
if (prev && typeof prev.command === 'string' && prev.command.trim()) {
  const r = spawnSync(prev.command, { input: raw, shell: true, encoding: 'utf8', timeout: 4000, windowsHide: true })
  if (r.status === 0 && r.stdout && r.stdout.trim()) prevOut = r.stdout.replace(/\s+$/, '')
}
process.stdout.write([prevOut || context(), quota()].filter(Boolean).join(' │ '))
