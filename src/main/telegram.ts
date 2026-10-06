import type { TelegramResult } from '@shared/types'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface Command {
  name: string
  args: string[]
  /** name 'plain': a message that is not a command, as typed */
  plain?: string
}

/** "/guard@MyBot on" -> { name: 'guard', args: ['on'] } */
export function parseCommand(text: string): Command | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return m ? { name: m[1].toLowerCase(), args: (m[2] ?? '').split(/\s+/).filter(Boolean) } : null
}

/** Shown in Telegram's command menu */
export const BOT_COMMANDS = [
  { command: 'panel', description: '控制面板：一条消息里翻页，可以收起' },
  { command: 'status', description: '额度与运行状态' },
  { command: 'card', description: '今日卡片（图片）' },
  { command: 'today', description: '今日用量' },
  { command: 'tasks', description: '刷新任务队列（可开始、停止、取消）' },
  { command: 'task', description: '排一个任务到下次 5h 刷新：/task 内容' },
  { command: 'log', description: '正在执行（或最近）的任务日志' },
  { command: 'week', description: '最近 7 天的用量走势' },
  { command: 'star', description: '额度星空：5h 恒星、7 天轨道、星骸' },
  { command: 'top', description: '今天最贵的提问' },
  { command: 'ach', description: '成就进度' },
  { command: 'sign', description: '今天的编码星座' },
  { command: 'luck', description: '摇一把今日额度运势 🎰' },
  { command: 'tarot', description: '问题的牌：每个提问翻开一张大阿卡纳 🔮' },
  { command: 'pause', description: '暂停所有 Claude Code 任务' },
  { command: 'resume', description: '恢复暂停的任务' },
  { command: 'guard', description: '额度守卫开关' },
  { command: 'report', description: '立即发送今日晚报' },
  { command: 'board', description: '置顶实时看板：/board on 或 off' },
  { command: 'keys', description: '拿回输入框下面的按钮' },
  { command: 'hide', description: '收起输入框下面的按钮' },
  { command: 'help', description: '指令说明' }
]

/** The keyboard under the input box: one row, everything else is in the panel */
export const KEYBOARD: { text: string; command: string }[][] = [
  [
    { text: '🎛 面板', command: 'panel' },
    { text: '📊 状态', command: 'status' },
    { text: '📋 任务', command: 'tasks' },
    { text: '🃏 卡片', command: 'card' }
  ]
]

/** buttons of the bigger keyboard older versions sent; a chat may still show it */
const LEGACY_KEYS: Record<string, string> = {
  '📅 今日': 'today',
  '⏸ 暂停': 'pause',
  '▶️ 恢复': 'resume',
  '🛡 守卫': 'guard',
  '📜 日志': 'log',
  '📰 晚报': 'report',
  '❓ 帮助': 'help',
  '⭐ 星空': 'star',
  '📈 本周': 'week',
  '🏆 成就': 'ach',
  '💸 最贵': 'top',
  '✨ 星座': 'sign'
}

/** plain words that work like a command */
const WORDS: Record<string, string> = {
  面板: 'panel',
  菜单: 'panel',
  状态: 'status',
  额度: 'status',
  卡片: 'card',
  今日: 'today',
  今天: 'today',
  任务: 'tasks',
  日志: 'log',
  本周: 'week',
  星空: 'star',
  最贵: 'top',
  成就: 'ach',
  星座: 'sign',
  运势: 'luck',
  塔罗: 'tarot',
  占卜: 'tarot',
  暂停: 'pause',
  恢复: 'resume',
  继续: 'resume',
  守卫: 'guard',
  晚报: 'report',
  看板: 'board',
  帮助: 'help'
}

/** A command typed, picked from the menu, tapped on the keyboard, or one word of it */
export function parseInput(text: string): Command | null {
  const t = text.trim()
  for (const row of KEYBOARD) for (const b of row) if (b.text === t) return { name: b.command, args: [] }
  if (LEGACY_KEYS[t]) return { name: LEGACY_KEYS[t], args: [] }
  if (WORDS[t]) return { name: WORDS[t], args: [] }
  return parseCommand(t)
}

/** Lines after the first `keep` go into a quote folded to a few lines, opened with a tap */
export function fold(lines: string[], keep: number): string {
  const head = lines.slice(0, keep)
  const rest = lines.slice(keep)
  while (rest.length && !rest[0].trim()) rest.shift()
  while (head.length && !head[head.length - 1].trim()) head.pop()
  if (!rest.length) return head.join('\n')
  return `${head.join('\n')}\n<blockquote expandable>${rest.join('\n')}</blockquote>`
}

/** An inline button under a reply; `data` is a command line, "e:" first edits the message in place */
export interface Button {
  text: string
  data: string
}

/** Full-screen message effects (private chats only) */
export const EFFECTS = {
  fire: '5104841245755180586',
  like: '5107584321108051014',
  heart: '5159385139981059251',
  party: '5046509860389126442'
} as const
export type Effect = keyof typeof EFFECTS

/** fold: folds away after a tap; keep: stays until folded with the keyboard icon; remove: taken away */
export type KeyboardMode = 'fold' | 'keep' | 'remove'

export interface Message {
  text: string
  buttons?: Button[][]
  /** the keyboard under the input box */
  keyboard?: KeyboardMode
  /** a picture (JPEG) with `text` as its caption */
  photo?: Buffer
  /** a looping animation (H.264 MP4) with `text` as its caption */
  animation?: Buffer
  /** text-only frames shown first, each replacing the last, before the message itself (an animated reply) */
  frames?: Message[]
  effect?: Effect
  /** arrives without a sound */
  silent?: boolean
  /** a reaction put on the message that asked */
  react?: string
  /** a short note shown over the chat when this answers a tapped button */
  toast?: string
  /** the handler already sent its answer: only the toast and the reaction apply */
  skip?: boolean
}
export type Reply = string | Message

const replyText = (r: Reply) => (typeof r === 'string' ? r : r.text)
/** pause between the frames of an animated reply (Telegram takes about two edits a second) */
export const FRAME_MS = 550
const opt = <K extends keyof Message>(r: Reply, key: K): Message[K] | undefined => (typeof r === 'string' ? undefined : r[key])

function markup(r: Reply): object | undefined {
  if (typeof r === 'string') return undefined
  if (r.buttons?.length) return { inline_keyboard: r.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
  if (r.keyboard === 'remove') return { remove_keyboard: true }
  if (r.keyboard) {
    // not persistent: the keyboard icon in the input field folds and unfolds it
    return {
      keyboard: KEYBOARD.map((row) => row.map((b) => ({ text: b.text }))),
      resize_keyboard: true,
      is_persistent: false,
      one_time_keyboard: r.keyboard === 'fold',
      input_field_placeholder: '点 🎛 面板，或输入 / 选择指令'
    }
  }
  return undefined
}

/** effects only play in private chats, whose ids are positive */
const privateChat = (chatId: string) => /^\d+$/.test(chatId)

/** commands answered with a picture show "sending a photo…" instead of "typing…" */
const PHOTO_COMMANDS = new Set(['card', 'tarot'])
const MEDIA = { field: 'animation', name: 'tokenpulse.mp4', type: 'video/mp4' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Bot API errors, without ever echoing the token */
function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/bot\d+:[\w-]+/g, 'bot***')
}

/** multipart/form-data with one file; other fields as strings (objects as JSON) */
export function multipart(fields: Record<string, unknown>, file: { field: string; name: string; type: string; data: Buffer }): { body: Buffer; type: string } {
  const boundary = `----TokenPulse${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    const value = typeof v === 'string' ? v : JSON.stringify(v)
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` }
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

  /** One Bot API call; resolves to `result`, throws with a readable reason. With `file` it goes as multipart */
  async call(token: string, method: string, body?: Record<string, unknown>, timeoutMs = 15000, file?: { field: string; name: string; type: string; data: Buffer }): Promise<any> {
    let init: RequestInit = { method: 'GET' }
    if (file) {
      const m = multipart(body ?? {}, file)
      init = { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body as unknown as RequestInit['body'] }
    } else if (body) init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    const res = await this.fetchFn(`${this.base}/bot${token}/${method}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })
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

  /** HTML message (use escapeHtml for dynamic parts), optionally with buttons, a picture or an effect */
  async send(token: string, chatId: string, html: Reply): Promise<TelegramResult> {
    if (!token || !chatId) return { ok: false, error: '还没有填写 Bot Token 和 Chat ID' }
    const effect = opt(html, 'effect')
    const attempt = async (withEffect: boolean) => {
      const reply_markup = markup(html)
      const photo = opt(html, 'photo')
      const common = {
        chat_id: chatId,
        parse_mode: 'HTML',
        ...(reply_markup ? { reply_markup } : {}),
        ...(opt(html, 'silent') ? { disable_notification: true } : {}),
        ...(withEffect && effect && privateChat(chatId) ? { message_effect_id: EFFECTS[effect] } : {})
      }
      const animation = opt(html, 'animation')
      if (animation) return this.call(token, 'sendAnimation', { ...common, caption: replyText(html) }, 120_000, { ...MEDIA, data: animation })
      if (photo) return this.call(token, 'sendPhoto', { ...common, caption: replyText(html) }, 60_000, { field: 'photo', name: 'tokenpulse.jpg', type: 'image/jpeg', data: photo })
      return this.call(token, 'sendMessage', { ...common, text: replyText(html), link_preview_options: { is_disabled: true } })
    }
    try {
      let msg: any
      try {
        msg = await attempt(true)
      } catch (e) {
        // an effect this client or chat can't play: send it plain
        if (!effect || !/effect/i.test(describe(e))) throw e
        msg = await attempt(false)
      }
      return { ok: true, messageId: typeof msg?.message_id === 'number' ? msg.message_id : undefined }
    } catch (e) {
      return { ok: false, error: describe(e) }
    }
  }

  /** Sends the text to the chat, ignoring failures (pushes are best effort) */
  async reply(token: string, chatId: string, html: Reply): Promise<void> {
    await this.send(token, chatId, html)
  }

  /** Replaces a message's text (or picture) and buttons (the "refresh" buttons); `quiet` skips the fallback of sending it anew */
  async edit(token: string, chatId: string, messageId: number, html: Reply, quiet = false): Promise<void> {
    await this.update(token, chatId, messageId, html).catch(() => (quiet ? undefined : this.send(token, chatId, html)))
  }

  /** Replaces a message's text (or picture) and buttons; throws when it can't ("not modified" is fine) */
  async update(token: string, chatId: string, messageId: number, html: Reply): Promise<void> {
    const reply_markup = markup(html)
    const photo = opt(html, 'photo')
    const animation = opt(html, 'animation')
    const done = animation
      ? this.call(
          token,
          'editMessageMedia',
          { chat_id: chatId, message_id: messageId, media: { type: 'animation', media: 'attach://animation', caption: replyText(html), parse_mode: 'HTML' }, ...(reply_markup ? { reply_markup } : {}) },
          120_000,
          { ...MEDIA, data: animation }
        )
      : photo
      ? this.call(
          token,
          'editMessageMedia',
          { chat_id: chatId, message_id: messageId, media: { type: 'photo', media: 'attach://card', caption: replyText(html), parse_mode: 'HTML' }, ...(reply_markup ? { reply_markup } : {}) },
          60_000,
          { field: 'card', name: 'tokenpulse.jpg', type: 'image/jpeg', data: photo }
        )
      : this.call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: replyText(html), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) })
    await done.catch((e: Error) => {
      // "message is not modified" is not worth a new message
      if (!/not modified/i.test(e.message)) throw e
    })
  }

  /**
   * An animated reply: its frames one after another in one message, then the
   * message itself. `messageId` plays it over a message already there (a
   * tapped button); otherwise the first frame is sent as a new message.
   */
  async play(token: string, chatId: string, html: Reply, messageId?: number): Promise<void> {
    const frames = opt(html, 'frames') ?? []
    const last = typeof html === 'string' ? html : { ...html, frames: undefined }
    if (!frames.length) {
      if (messageId === undefined) await this.reply(token, chatId, last)
      else await this.edit(token, chatId, messageId, last)
      return
    }
    let id = messageId
    let rest = frames
    if (id === undefined) {
      const sent = await this.send(token, chatId, frames[0])
      if (!sent.ok || sent.messageId === undefined) return void (await this.reply(token, chatId, last))
      id = sent.messageId
      rest = frames.slice(1)
    }
    for (const f of rest) {
      await sleep(FRAME_MS)
      await this.update(token, chatId, id, f).catch(() => {})
    }
    await sleep(FRAME_MS)
    await this.edit(token, chatId, id, last)
  }

  /** "typing…" / "sending a photo…" at the top of the chat for a few seconds */
  async action(token: string, chatId: string, action: 'typing' | 'upload_photo'): Promise<void> {
    await this.call(token, 'sendChatAction', { chat_id: chatId, action }).catch(() => {})
  }

  /** puts an emoji reaction on a message (best effort) */
  async react(token: string, chatId: string, messageId: number, emoji: string): Promise<void> {
    await this.call(token, 'setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }).catch(() => {})
  }

  /** an animated dice (🎰 🎲 🎯 🏀 ⚽ 🎳); resolves to the value it lands on */
  async dice(token: string, chatId: string, emoji: string): Promise<number | null> {
    try {
      const msg = await this.call(token, 'sendDice', { chat_id: chatId, emoji })
      return typeof msg?.dice?.value === 'number' ? msg.dice.value : null
    } catch {
      return null
    }
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

  private run(cmd: Command): Promise<Reply> {
    return this.handle(cmd).catch((e: Error): Reply => `出错了：${escapeHtml(e.message)}`)
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
            const text = String(msg.text)
            const cmd = parseInput(text) ?? (text.trim().startsWith('/') ? null : { name: 'plain', args: [], plain: text.trim() })
            if (cmd) {
              void this.api.action(token, chatId, PHOTO_COMMANDS.has(cmd.name) ? 'upload_photo' : 'typing')
              const r = await this.run(cmd)
              if (!opt(r, 'skip')) await this.api.play(token, chatId, r)
              const react = opt(r, 'react')
              if (react && typeof msg.message_id === 'number') await this.api.react(token, chatId, msg.message_id, react)
            }
          }
          // a tapped inline button: the button spins until it is answered, with an optional note
          const cb = u.callback_query
          if (cb?.id) {
            const mine = String(cb.message?.chat?.id) === chatId && typeof cb.data === 'string'
            const edit = mine && cb.data.startsWith('e:')
            const cmd = mine ? parseCommand(`/${cb.data.replace(/^e:/, '')}`) : null
            const r = cmd ? await this.run(cmd) : null
            const toast = r ? opt(r, 'toast') : undefined
            await this.api.call(token, 'answerCallbackQuery', { callback_query_id: cb.id, ...(toast ? { text: toast } : {}) }).catch(() => {})
            if (r && !opt(r, 'skip')) await this.api.play(token, chatId, r, edit ? cb.message.message_id : undefined)
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
