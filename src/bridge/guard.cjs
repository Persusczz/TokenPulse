'use strict'
// TokenPulse quota guard: a Claude Code PreToolUse / UserPromptSubmit hook.
// While the 5-hour window (or, if set, the 7-day window) is at or above its
// threshold it holds the task (the hook simply does not return), and lets it
// continue once the window has reset - optionally only inside allowed local
// hours. When the wait would outlast the hook, it stops the task with a reason
// instead. Anything unexpected lets the task through.

const fs = require('fs')
const path = require('path')

const DIR = process.env.TOKENPULSE_BRIDGE_DIR || __dirname
/** readings older than this never start a pause */
const STALE_MS = 20 * 60_000
const RESET_GRACE_MS = 20_000
const POLL_MS = Number(process.env.TOKENPULSE_GUARD_POLL_MS) || 30_000
/** stays under the hook's 6 h timeout */
const MAX_WAIT_MS = Number(process.env.TOKENPULSE_GUARD_MAX_WAIT_MS) || 5.5 * 3600_000

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
  } catch {
    return null
  }
}

/** Newest reading of one window from TokenPulse (quota.json) or the statusline bridge (statusline.json) */
function reading(appKey, slKey) {
  const found = []
  const q = readJson('quota.json')
  const a = q && q[appKey]
  if (a && typeof a.pct === 'number') found.push({ at: Number(q.updatedAt) || 0, pct: a.pct, resetsAt: Number(a.resetsAt) || null })
  const s = readJson('statusline.json')
  const w = s && s.rate_limits && s.rate_limits[slKey]
  if (w && typeof w.used_percentage === 'number') {
    found.push({ at: Number(s.updatedAt) || 0, pct: w.used_percentage, resetsAt: Number(w.resets_at) ? w.resets_at * 1000 : null })
  }
  found.sort((x, y) => y.at - x.at)
  return found[0] || null
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

/** "HH:MM" -> minutes after midnight */
function minutes(v) {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Inside [from, to) local time; windows may wrap past midnight */
function inWindow(t, from, to) {
  const d = new Date(t)
  const m = d.getHours() * 60 + d.getMinutes()
  return from <= to ? m >= from && m < to : m >= from || m < to
}

function nextWindowStart(t, from) {
  const d = new Date(t)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(from / 60), from % 60).getTime()
  return start > t ? start : start + 24 * 3600_000
}

const clock = (t) => {
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** What should hold the task right now, if anything */
function holdReason(now, cfg, paused, sessionId) {
  // paused by hand (app or Telegram), for every task or just this session; re-read so a resume takes effect
  const fresh = readJson('guard.json') || {}
  if (fresh.manual || (Array.isArray(fresh.sessions) && sessionId && fresh.sessions.includes(sessionId))) {
    return { reason: 'manual', until: null, pct: 0 }
  }
  if (!fresh.enabled) return null
  const live = (r) => r && (paused || now - r.at <= STALE_MS) && !(r.resetsAt && now >= r.resetsAt + RESET_GRACE_MS)
  const five = reading('fiveHour', 'five_hour')
  if (live(five) && five.pct >= cfg.pauseAt) return { reason: 'five', until: five.resetsAt, pct: five.pct }
  const week = cfg.weeklyAt ? reading('sevenDay', 'seven_day') : null
  if (live(week) && week.pct >= cfg.weeklyAt) return { reason: 'week', until: week.resetsAt, pct: week.pct }
  // after a pause, resume only inside the allowed hours
  if (paused && cfg.from !== null && cfg.to !== null && !inWindow(now, cfg.from, cfg.to)) {
    return { reason: 'window', until: nextWindowStart(now, cfg.from), pct: 0 }
  }
  return null
}

function stop(input, message) {
  const event = input.hook_event_name || 'PreToolUse'
  const out =
    event === 'UserPromptSubmit'
      ? { decision: 'block', reason: message }
      : { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: message } }
  process.stdout.write(JSON.stringify(out))
}

async function main() {
  const input = readStdin()
  const raw = readJson('guard.json')
  if (!raw || !(raw.enabled || raw.manual || (Array.isArray(raw.sessions) && raw.sessions.length))) return
  const cfg = {
    pauseAt: Number(raw.pauseAt) || 90,
    weeklyAt: Number(raw.weeklyAt) || null,
    from: minutes(raw.resumeFrom),
    to: minutes(raw.resumeTo)
  }
  const started = Date.now()
  const pausedDir = path.join(DIR, 'paused')
  const pausedFile = path.join(pausedDir, `${String(input.session_id || 'unknown').replace(/[^\w-]/g, '')}-${process.pid}.json`)
  let paused = false
  let first = null

  try {
    for (;;) {
      const now = Date.now()
      const hold = holdReason(now, cfg, paused, input.session_id)
      if (!hold) break
      first = first || hold
      // a manual pause has no end time: stop the task rather than let it run on when the hook gives up
      if (hold.reason === 'manual' && now - started > MAX_WAIT_MS) {
        stop(input, 'TokenPulse：任务已被手动暂停超过 5.5 小时，已停止执行。在 TokenPulse 或 Telegram 里恢复后请重新发起任务。')
        return
      }
      // a wait the hook cannot sit out: stop the task with a reason instead of letting it run on
      if (hold.until && hold.until - started > MAX_WAIT_MS) {
        const what =
          hold.reason === 'week'
            ? `7 天额度已用 ${Math.round(hold.pct)}%（守卫线 ${cfg.weeklyAt}%），${clock(hold.until)} 重置`
            : hold.reason === 'window'
              ? `额度已重置，但设定只在 ${raw.resumeFrom}–${raw.resumeTo} 自动继续（下次 ${clock(hold.until)}）`
              : `5 小时额度已用 ${Math.round(hold.pct)}%，${clock(hold.until)} 重置`
        stop(input, `TokenPulse 额度守卫：${what}。为保护剩余额度已停止执行，到时间后请重新发起任务。`)
        return
      }
      if (now - started > MAX_WAIT_MS) break
      fs.mkdirSync(pausedDir, { recursive: true })
      fs.writeFileSync(
        pausedFile,
        JSON.stringify({ sessionId: input.session_id || '', cwd: input.cwd || '', since: started, until: hold.until, pct: hold.pct, reason: hold.reason, pid: process.pid })
      )
      paused = true
      const untilNext = hold.until ? hold.until + RESET_GRACE_MS - now : POLL_MS
      await sleep(Math.max(1000, Math.min(POLL_MS, untilNext)))
    }
  } finally {
    if (paused) {
      try {
        fs.unlinkSync(pausedFile)
      } catch {
        /* already gone */
      }
    }
  }

  if (paused) {
    const mins = Math.max(1, Math.round((Date.now() - started) / 60_000))
    const context =
      first && first.reason === 'manual'
        ? `TokenPulse：任务被手动暂停了约 ${mins} 分钟，现已恢复，继续执行之前的任务。`
        : `TokenPulse 额度守卫：${first && first.reason === 'week' ? `7 天额度达到 ${cfg.weeklyAt}%` : `5 小时额度达到 ${cfg.pauseAt}%`} 后暂停了约 ${mins} 分钟，额度窗口已重置，继续执行之前的任务。`
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || 'PreToolUse', additionalContext: context } }))
  }
}

main().catch(() => {})
