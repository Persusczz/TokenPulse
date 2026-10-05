'use strict'
/**
 * TokenPulse task window: runs the refresh tasks of one folder in a visible
 * terminal, one after another. TokenPulse drops a job file into the lane
 * folder; this window runs it, shows the thinking, tool calls and answers as
 * they stream in, and appends the raw event stream to the task's log so
 * TokenPulse can follow along (and pick it up again after a restart).
 *
 *   node taskrunner.cjs <laneDir>
 *
 * Lane folder:
 *   job.json     the next task (TokenPulse writes it, this window takes it)
 *   stop-<id>    stop that task
 *   lane.json    heartbeat: { pid, busy, child, at }
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const laneDir = process.argv[2]
if (!laneDir) {
  console.error('usage: node taskrunner.cjs <laneDir>')
  process.exit(2)
}

/** an idle window closes itself after this long */
const IDLE_EXIT_MS = 3 * 3600_000

process.stdout.on('error', () => {})
const tty = !!process.stdout.isTTY
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const dim = paint('2')
const bold = paint('1')
const italic = paint('3')
const gray = paint('90')
const green = paint('32')
const red = paint('31')
const yellow = paint('33')
const clay = paint('38;5;173')
const blue = paint('38;5;111')
const lilac = paint('38;5;183')

const out = (s) => process.stdout.write(s)
const line = (s = '') => out(`${s}\n`)
const cols = () => Math.max(40, Math.min(process.stdout.columns || 100, 150))
const rule = (ch = '─') => gray(ch.repeat(cols()))
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const indent = (s, pre = '  ') =>
  String(s)
    .split(/\r?\n/)
    .map((l) => pre + l)
    .join('\n')
const duration = (ms) => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

let busy = null
let child = null
let stopped = false
let idleSince = Date.now()
let folderName = path.basename(laneDir)

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Replaces lane.json in one step. TokenPulse reads it every 0.7 s; while it
 * has the file open Windows refuses the rename, so the rename is tried again
 * a moment later. Never written in place: a reader would find it half written
 * and take the window for closed.
 */
function heartbeat() {
  const body = JSON.stringify({ pid: process.pid, busy: busy ? busy.id : null, child: child ? child.pid : null, at: Date.now() })
  const file = path.join(laneDir, 'lane.json')
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, body)
  } catch {
    return
  }
  for (let i = 0; i < 4; i++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch {
      pause(15 + i * 20)
    }
  }
  // still locked: the next beat will do
  try {
    fs.unlinkSync(tmp)
  } catch {
    /* gone already */
  }
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

/** a tool call in one line: Bash(npm test), Edit(src/a.ts) */
function toolDetail(input) {
  const d = input && (input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? input.url ?? input.query ?? '')
  return d ? short(oneLine(d), Math.max(30, cols() - 20)) : ''
}

/** the first lines of a tool's output, indented under the call */
function preview(content, bad) {
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) text = content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n')
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return gray('  ⎿ （无输出）')
  const w = cols() - 6
  const head = lines.slice(0, 3).map((l, i) => `${i ? '    ' : '  ⎿ '}${short(l, w)}`)
  if (lines.length > 3) head.push(`    … 还有 ${lines.length - 3} 行`)
  return (bad ? red : gray)(head.join('\n'))
}

/** Claude Code stream-json, partial messages included */
function claudeView(state) {
  const streamed = new Set()
  let block = null
  let opened = false
  return (ev) => {
    if (ev.type === 'system') {
      if (ev.subtype === 'init') line(gray(`  会话 ${ev.session_id ?? ''} · ${ev.model ?? ''}`))
      else if (ev.subtype === 'compact_boundary') line(yellow('\n  ⟳ 上下文已自动压缩'))
      else if (ev.subtype === 'status' && ev.status === 'compacting') line(yellow('\n  ⟳ 正在压缩上下文…'))
      else if (ev.subtype === 'status' && ev.compact_result === 'failed') line(gray(`  这次没有压缩${ev.compact_error === 'too_few_groups' ? '：对话还太短' : ev.compact_error ? `（${ev.compact_error}）` : ''}`))
      return
    }
    if (ev.type === 'stream_event') {
      const e = ev.event || {}
      if (e.type === 'message_start' && e.message && e.message.id) streamed.add(e.message.id)
      else if (e.type === 'content_block_start') {
        const t = e.content_block && e.content_block.type
        block = t === 'thinking' || t === 'text' ? t : null
        opened = false
      } else if (e.type === 'content_block_delta' && block) {
        const d = e.delta || {}
        const chunk = block === 'thinking' ? d.thinking : d.text
        if (!chunk) return
        if (!opened) {
          out(block === 'thinking' ? `\n${lilac('✻ 思考')}\n` : `\n${clay('●')} `)
          opened = true
        }
        out(block === 'thinking' ? gray(italic(chunk)) : chunk)
      } else if (e.type === 'content_block_stop') {
        if (opened) line()
        block = null
        opened = false
      }
      return
    }
    if (ev.type === 'assistant') {
      const m = ev.message || {}
      const live = m.id && streamed.has(m.id)
      for (const b of m.content || []) {
        if (b.type === 'tool_use') line(`${clay('●')} ${bold(b.name)}${gray(`(${toolDetail(b.input)})`)}`)
        else if (!live && b.type === 'thinking' && b.thinking) line(`\n${lilac('✻ 思考')}\n${gray(italic(indent(b.thinking.trim(), '')))}`)
        else if (!live && b.type === 'text' && b.text && b.text.trim()) line(`\n${clay('●')} ${b.text.trim()}`)
      }
      return
    }
    if (ev.type === 'user') {
      const content = ev.message && ev.message.content
      if (Array.isArray(content)) for (const b of content) if (b && b.type === 'tool_result') line(preview(b.content, b.is_error))
      return
    }
    if (ev.type === 'result') {
      state.ok = ev.subtype === 'success' && !ev.is_error
      state.cost = typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null
      state.turns = typeof ev.num_turns === 'number' ? ev.num_turns : null
      if (!state.ok) state.reason = typeof ev.result === 'string' && ev.result ? ev.result : ev.subtype
    }
  }
}

/** the message inside Codex's JSON error strings */
function codexMessage(m) {
  const s = typeof m === 'string' ? m : m && m.message ? m.message : ''
  try {
    const j = JSON.parse(s)
    return (j.error && j.error.message) || j.message || s
  } catch {
    return s
  }
}

/** codex exec --json */
function codexView(state) {
  return (ev) => {
    const it = ev.item || {}
    if (ev.type === 'thread.started') line(gray(`  会话 ${ev.thread_id ?? ''}`))
    else if (ev.type === 'item.started' && it.type === 'command_execution') line(`${blue('●')} ${bold('运行')} ${gray(toolDetail({ command: it.command }))}`)
    else if (ev.type === 'item.completed') {
      if (it.type === 'reasoning' && it.text) line(`\n${lilac('✻ 思考')}\n${gray(italic(it.text.trim()))}`)
      else if (it.type === 'agent_message' && it.text) line(`\n${blue('●')} ${it.text.trim()}`)
      else if (it.type === 'command_execution') line(preview(it.aggregated_output || '', typeof it.exit_code === 'number' && it.exit_code !== 0))
      else if (it.type === 'file_change') line(`${blue('●')} ${bold('修改文件')} ${gray((it.changes || []).map((c) => c.path).join(', '))}`)
      else if (it.type === 'mcp_tool_call') line(`${blue('●')} ${bold(`${it.server ?? ''}.${it.tool ?? ''}`)}`)
      else if (it.type === 'web_search') line(`${blue('●')} ${bold('搜索')} ${gray(oneLine(it.query))}`)
      else if (it.type === 'todo_list') line(gray(indent((it.items || []).map((x) => `${x.completed ? '☑' : '☐'} ${x.text}`).join('\n'))))
      else if (it.type === 'error' && it.message) line(yellow(`  ⚠ ${it.message}`))
    } else if (ev.type === 'turn.completed') {
      state.ok = true
      const u = ev.usage || {}
      state.tokens = (u.input_tokens || 0) + (u.output_tokens || 0)
    } else if (ev.type === 'turn.failed') {
      state.ok = false
      state.reason = codexMessage(ev.error)
    } else if (ev.type === 'error') line(red(`  ✕ ${codexMessage(ev.message)}`))
  }
}

function run(job) {
  busy = job
  stopped = false
  folderName = job.folder || folderName
  const accent = job.tool === 'codex' ? blue : clay
  const toolName = job.tool === 'codex' ? 'Codex' : 'Claude Code'
  const started = Date.now()
  const state = { ok: null, cost: null, turns: null, tokens: null, reason: '' }
  process.title = `${toolName} · ${folderName} · 运行中`
  heartbeat()

  line()
  line(rule('━'))
  line(`${accent('●')} ${bold(job.title || '任务')}`)
  line(gray(`  ${toolName} · ${job.model || '默认模型'} · ${job.cwd}`))
  const compact = job.compact ? (job.compact === '关' ? ' · 自动压缩关' : job.compact === '快满时' ? ' · 上下文快满时自动压缩' : ` · 上下文到 ${job.compact} 时自动压缩`) : job.tool === 'claude' ? (job.autoCompact ? ' · 自动压缩开' : ' · 自动压缩关') : ''
  line(gray(`  ${job.resume ? '接着这个文件夹上次的对话' : '新对话'}${compact}`))
  // a retry: which try this is and why
  if (job.note) line(yellow(`  ↻ ${job.note}`))
  if (job.prompt && job.prompt !== job.title) line(dim(indent(job.prompt.trim())))
  line(rule())

  const log = (raw) => {
    try {
      fs.appendFileSync(job.log, `${Date.now()}\t${raw}\n`)
    } catch {
      /* the window still shows it */
    }
  }
  log(JSON.stringify({ type: 'tp_start', pid: process.pid }))

  let finished = false
  let errTail = ''
  const done = (code, err) => {
    if (finished) return
    finished = true
    const why = err || (code ? errTail.trim().slice(-600) : '')
    log(JSON.stringify({ type: 'tp_exit', code, stopped, error: why }))
    line()
    line(rule())
    const took = duration(Date.now() - started)
    if (stopped) line(yellow(`■ 已停止 · 用时 ${took}`))
    else if (state.ok) {
      const bits = [state.turns ? `${state.turns} 轮` : '', state.cost !== null ? `$${state.cost.toFixed(2)}` : '', state.tokens ? `${state.tokens.toLocaleString()} tokens` : '', `用时 ${took}`].filter(Boolean)
      line(`${green('✓ 完成')} ${gray(`· ${bits.join(' · ')}`)}`)
    } else line(`${red('✕ 没有完成')} ${gray(`· ${short(oneLine(state.reason || why || `退出代码 ${code}`), cols() - 20)}`)}`)
    busy = null
    child = null
    idleSince = Date.now()
    process.title = `TokenPulse · ${folderName} · 空闲`
    line(gray('等待这个文件夹的下一个任务…（可以直接关闭这个窗口）'))
    heartbeat()
  }

  let p
  try {
    // shares this console: closing the window or Ctrl+C reaches it too
    p = spawn(job.cmd, job.args || [], {
      cwd: job.cwd,
      env: { ...process.env, ...(job.env || {}) },
      windowsHide: false,
      windowsVerbatimArguments: !!job.verbatim,
      stdio: [typeof job.stdin === 'string' ? 'pipe' : 'ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    line(red(`无法启动：${e.message}`))
    return done(-1, `无法启动：${e.message}`)
  }
  child = p
  heartbeat()
  if (typeof job.stdin === 'string') p.stdin.end(job.stdin)

  const view = job.tool === 'codex' ? codexView(state) : claudeView(state)
  const handle = (l) => {
    if (!l.trim()) return
    let ev = null
    try {
      ev = JSON.parse(l)
    } catch {
      /* plain text */
    }
    // partial chunks only feed the live view; the full messages follow
    if (!ev || ev.type !== 'stream_event') log(l)
    if (ev) view(ev)
    else line(gray(l))
  }
  let buf = ''
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, i))
      buf = buf.slice(i + 1)
    }
  })
  p.stderr.setEncoding('utf8')
  p.stderr.on('data', (d) => {
    errTail = (errTail + d).slice(-2000)
    out(gray(d))
  })
  p.on('error', (e) => done(-1, `无法启动：${e.message}`))
  p.on('close', (code) => {
    if (buf.trim()) handle(buf)
    done(code ?? -1)
  })
}

function poll() {
  if (busy) {
    const f = path.join(laneDir, `stop-${busy.id}`)
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* taken */
      }
      if (child && !stopped) {
        stopped = true
        line(yellow('\n■ TokenPulse 要求停止这个任务'))
        killTree(child.pid)
      }
    }
    return
  }
  // taken by renaming it: when two windows of a folder are open, only one gets the job
  const file = path.join(laneDir, 'job.json')
  const mine = path.join(laneDir, `job.${process.pid}.taken`)
  try {
    fs.renameSync(file, mine)
  } catch {
    if (Date.now() - idleSince > IDLE_EXIT_MS) process.exit(0)
    return
  }
  let job = null
  try {
    job = JSON.parse(fs.readFileSync(mine, 'utf8'))
  } catch {
    /* not a job */
  }
  try {
    fs.unlinkSync(mine)
  } catch {
    /* gone already */
  }
  if (job) run(job)
}

// Ctrl+C stops the task (claude gets it too); a second one while idle closes the window
process.on('SIGINT', () => {
  if (busy && child) {
    stopped = true
    line(yellow('\n■ 已在终端里按 Ctrl+C 停止'))
  } else process.exit(0)
})
// the window is closing: record it, take the task down with it
process.on('SIGHUP', () => {
  if (busy) {
    try {
      fs.appendFileSync(busy.log, `${Date.now()}\t${JSON.stringify({ type: 'tp_exit', code: -1, stopped: false, error: '任务窗口被关闭，任务中断' })}\n`)
    } catch {
      /* nothing to do */
    }
    if (child) killTree(child.pid)
  }
  process.exit(0)
})

process.title = `TokenPulse · 任务窗口`
line(bold(clay('✻ TokenPulse 任务窗口')))
line(gray('同一文件夹里的任务在这个窗口依次执行，思考、工具调用和回答都会实时显示；TokenPulse 里也保留同样的日志。'))
line(gray('关闭窗口或按 Ctrl+C 会中断正在执行的任务。'))
heartbeat()
setInterval(heartbeat, 1000)
setInterval(poll, 300)
poll()
