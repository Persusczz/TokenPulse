import type { TelegramResult } from '@shared/types'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface Command {
  name: string
  args: string[]
}

/** "/guard@MyBot on" -> { name: 'guard', args: ['on'] } */
export function parseCommand(text: string): Command | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return m ? { name: m[1].toLowerCase(), args: (m[2] ?? '').split(/\s+/).filter(Boolean) } : null
}

/** Shown in Telegram's command menu */
export const BOT_COMMANDS = [
  { command: 'status', description: '额度与运行状态' },
  { command: 'today', description: '今日用量' },
  { command: 'tasks', description: '刷新任务队列（可开始、停止、取消）' },
  { command: 'task', description: '排一个任务到下次 5h 刷新：/task 内容' },
  { command: 'log', description: '正在执行（或最近）的任务日志' },
  { command: 'sign', description: '今天的编码星座' },
  { command: 'star', description: '额度星空：5h 恒星、7 天轨道、星骸' },
  { command: 'week', description: '最近 7 天的用量走势' },
  { command: 'top', description: '今天最贵的提问' },
  { command: 'ach', description: '成就进度' },
  { command: 'pause', description: '暂停所有 Claude Code 任务' },
  { command: 'resume', description: '恢复暂停的任务' },
  { command: 'guard', description: '额度守卫开关' },
  { command: 'report', description: '立即发送今日晚报' },
  { command: 'help', description: '指令说明与按钮键盘' }
]

/** The keyboard under the input box: tap a button instead of typing */
export const KEYBOARD: { text: string; command: string }[][] = [
  [
    { text: '📊 状态', command: 'status' },
    { text: '📅 今日', command: 'today' },
    { text: '📋 任务', command: 'tasks' }
  ],
  [
    { text: '⏸ 暂停', command: 'pause' },
    { text: '▶️ 恢复', command: 'resume' },
    { text: '🛡 守卫', command: 'guard' }
  ],
  [
    { text: '📜 日志', command: 'log' },
    { text: '📰 晚报', command: 'report' },
    { text: '❓ 帮助', command: 'help' }
  ],
  [
    { text: '⭐ 星空', command: 'star' },
    { text: '📈 本周', command: 'week' },
    { text: '🏆 成就', command: 'ach' }
  ],
  [
    { text: '💸 最贵', command: 'top' },
    { text: '✨ 星座', command: 'sign' }
  ]
]

/** A command typed, picked from the menu, or tapped on the keyboard */
export function parseInput(text: string): Command | null {
  const t = text.trim()
  for (const row of KEYBOARD) for (const b of row) if (b.text === t) return { name: b.command, args: [] }
  return parseCommand(t)
}

/** An inline button under a reply; `data` is a command line, "e:" first edits the message in place */
export interface Button {
  text: string
  data: string
}
export type Reply = string | { text: string; buttons?: Button[][]; keyboard?: boolean }

const replyText = (r: Reply) => (typeof r === 'string' ? r : r.text)

function markup(r: Reply): object | undefined {
  if (typeof r === 'string') return undefined
  if (r.buttons?.length) return { inline_keyboard: r.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
  if (r.keyboard) {
    return {
      keyboard: KEYBOARD.map((row) => row.map((b) => ({ text: b.text }))),
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: '点下面的按钮，或输入 / 选择指令'
    }
  }
  return undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Bot API errors, without ever echoing the token */
function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/bot\d+:[\w-]+/g, 'bot***')
}

/**
 * Sends notices through a Telegram bot (created with @BotFather). The base URL
 * can be overridden for tests with TP_TELEGRAM_API.
 */
export class TelegramNotifier {
  constructor(
    private fetchFn: Fetch,
    private base = process.env.TP_TELEGRAM_API || 'https://api.telegram.org'
  ) {}

  /** One Bot API call; resolves to `result`, throws with a readable reason */
  async call(token: string, method: string, body?: object, timeoutMs = 15000): Promise<any> {
    const res = await this.fetchFn(`${this.base}/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    })
    let json: any = null
    try {
      json = await res.json()
    } catch {
      /* not JSON */
    }
    if (!res.ok || !json?.ok) {
      const reason = json?.description ? String(json.description) : `HTTP ${res.status}`
      throw new Error(res.status === 401 ? 'Bot Token 无效' : res.status === 400 && /chat not found/i.test(reason) ? '找不到这个 Chat ID，先给机器人发一条消息' : reason)
    }
    return json.result
  }

  /** HTML message (use escapeHtml for dynamic parts), optionally with buttons */
  async send(token: string, chatId: string, html: Reply): Promise<TelegramResult> {
    if (!token || !chatId) return { ok: false, error: '还没有填写 Bot Token 和 Chat ID' }
    try {
      const reply_markup = markup(html)
      const msg = await this.call(token, 'sendMessage', { chat_id: chatId, text: replyText(html), parse_mode: 'HTML', disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) })
      return { ok: true, messageId: typeof msg?.message_id === 'number' ? msg.message_id : undefined }
    } catch (e) {
      return { ok: false, error: describe(e) }
    }
  }

  /** Sends the text to the chat, ignoring failures (pushes are best effort) */
  async reply(token: string, chatId: string, html: Reply): Promise<void> {
    await this.send(token, chatId, html)
  }

  /** Replaces a message's text and buttons (the "refresh" buttons); `quiet` skips the fallback of sending it anew */
  async edit(token: string, chatId: string, messageId: number, html: Reply, quiet = false): Promise<void> {
    const reply_markup = markup(html)
    await this.call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: replyText(html), parse_mode: 'HTML', disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }).catch(
      // "message is not modified" is not worth a new message
      (e: Error) => (quiet || /not modified/i.test(e.message) ? undefined : this.send(token, chatId, html))
    )
  }

  /**
   * Makes the commands show up when typing "/" and behind the Menu button:
   * registered for every chat and for this chat, with the menu button set to
   * the command list. Throws when Telegram cannot be reached.
   */
  async registerMenu(token: string, chatId: string): Promise<void> {
    await this.call(token, 'setMyCommands', { commands: BOT_COMMANDS })
    await this.call(token, 'setMyCommands', { commands: BOT_COMMANDS, scope: { type: 'chat', chat_id: chatId } })
    await this.call(token, 'setChatMenuButton', { menu_button: { type: 'commands' } })
    await this.call(token, 'setChatMenuButton', { chat_id: chatId, menu_button: { type: 'commands' } })
  }

  /** The chat of the newest message sent to the bot (only while the bot is not listening: getUpdates allows one reader) */
  async detectChat(token: string): Promise<TelegramResult> {
    if (!token) return { ok: false, error: '先填写 Bot Token' }
    try {
      const updates: any[] = await this.call(token, 'getUpdates', { limit: 20, allowed_updates: ['message', 'channel_post'] })
      for (let i = updates.length - 1; i >= 0; i--) {
        const chat = updates[i]?.message?.chat ?? updates[i]?.channel_post?.chat
        if (chat?.id !== undefined) {
          const name = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? chat.username
          return { ok: true, chatId: String(chat.id), name: name || chat.username || undefined }
        }
      }
      return { ok: false, error: '没有找到消息：先在 Telegram 里给你的机器人发一条任意消息，再点一次' }
    } catch (e) {
      return { ok: false, error: describe(e) }
    }
  }
}

/**
 * Listens for commands with long polling and answers them. Only messages from
 * the configured chat are acted on; anything sent while TokenPulse was not
 * listening is skipped, so an old /pause never fires hours later.
 */
export class TelegramBot {
  private gen = 0
  private offset = 0
  private menuAt = 0
  /** the menu and command list are registered for the current token */
  menuReady = false
  /** newest chat that wrote to the bot (any chat), for "auto detect" while the bot is listening */
  lastChat: { id: string; name?: string } | null = null

  constructor(
    private api: TelegramNotifier,
    private handle: (cmd: Command) => Promise<Reply>
  ) {}

  /** registers the command menu, retrying at most once a minute until it works */
  private async ensureMenu(token: string, chatId: string): Promise<void> {
    if (this.menuReady || Date.now() - this.menuAt < 60_000) return
    this.menuAt = Date.now()
    try {
      await this.api.registerMenu(token, chatId)
      this.menuReady = true
    } catch {
      /* next round */
    }
  }

  private async answer(token: string, chatId: string, cmd: Command, editId?: number): Promise<void> {
    const r = await this.handle(cmd).catch((e: Error): Reply => `出错了：${escapeHtml(e.message)}`)
    if (editId !== undefined) await this.api.edit(token, chatId, editId, r)
    else await this.api.reply(token, chatId, r)
  }

  get running(): boolean {
    return this.gen % 2 === 1
  }

  start(token: string, chatId: string): void {
    this.stop()
    this.menuReady = false
    this.menuAt = 0
    const gen = ++this.gen
    void this.loop(gen, token, chatId)
  }

  stop(): void {
    if (this.running) this.gen++
  }

  private async loop(gen: number, token: string, chatId: string): Promise<void> {
    let skipped = false
    let backoff = 2000
    while (gen === this.gen) {
      try {
        // anything sent while TokenPulse was not listening is dropped
        if (!skipped) {
          const old: any[] = await this.api.call(token, 'getUpdates', { offset: -1, timeout: 0 })
          this.offset = old.length ? old[old.length - 1].update_id + 1 : 0
          skipped = true
        }
        await this.ensureMenu(token, chatId)
        const updates: any[] = await this.api.call(token, 'getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65_000)
        backoff = 2000
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1)
          if (gen !== this.gen) break
          const msg = u.message
          if (msg?.chat?.id !== undefined) {
            const c = msg.chat
            this.lastChat = { id: String(c.id), name: c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username) }
          }
          if (msg?.text && String(msg.chat?.id) === chatId) {
            const cmd = parseInput(msg.text)
            if (cmd) await this.answer(token, chatId, cmd)
          }
          // a tapped inline button
          const cb = u.callback_query
          if (cb?.id) {
            await this.api.call(token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})
            if (String(cb.message?.chat?.id) !== chatId || typeof cb.data !== 'string') continue
            const edit = cb.data.startsWith('e:')
            const cmd = parseCommand(`/${cb.data.replace(/^e:/, '')}`)
            if (cmd) await this.answer(token, chatId, cmd, edit ? cb.message.message_id : undefined)
          }
        }
      } catch {
        if (gen !== this.gen) break
        await sleep(backoff)
        backoff = Math.min(60_000, backoff * 2)
      }
    }
  }
}
