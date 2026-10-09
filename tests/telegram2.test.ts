import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'
import { EFFECTS, fold, multipart, parseInput, TelegramBot, TelegramNotifier, type Reply } from '../src/main/telegram'
import { cardSvg, type CardData } from '../src/main/tgCard'

type Call = { method: string; body: any; raw?: Buffer; type?: string }

/** a fake Bot API: JSON bodies are parsed, multipart ones kept raw */
function fakeApi(result: (c: Call) => unknown = () => true, fail?: (c: Call) => string | null) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = url.split('/').pop()!
    const type = String((init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '')
    const c: Call = type.startsWith('multipart/') ? { method, body: null, raw: init!.body as unknown as Buffer, type } : { method, body: init?.body ? JSON.parse(String(init.body)) : {} }
    calls.push(c)
    const err = fail?.(c)
    if (err) return new Response(JSON.stringify({ ok: false, description: err }), { status: 400 })
    return new Response(JSON.stringify({ ok: true, result: result(c) }), { status: 200 })
  }
  return { calls, api: new TelegramNotifier(fetchFn, 'http://tg') }
}

describe('telegram: the keyboard folds away', () => {
  it('sends one row that folds after a tap, one that stays, or takes it away', async () => {
    const { calls, api } = fakeApi(() => ({ message_id: 1 }))
    await api.send('1:A', '42', { text: 'x', keyboard: 'fold' })
    await api.send('1:A', '42', { text: 'x', keyboard: 'keep' })
    await api.send('1:A', '42', { text: 'x', keyboard: 'remove' })
    const [fold, keep, remove] = calls.map((c) => c.body.reply_markup)
    expect(fold.keyboard).toHaveLength(1)
    expect(fold).toMatchObject({ is_persistent: false, one_time_keyboard: true })
    expect(keep).toMatchObject({ is_persistent: false, one_time_keyboard: false })
    expect(remove).toEqual({ remove_keyboard: true })
  })

  it('reads the new row, the old big keyboard and plain words as commands', () => {
    expect(parseInput('🎛 面板')).toEqual({ name: 'panel', args: [] })
    expect(parseInput('🃏 卡片')).toEqual({ name: 'card', args: [] })
    // a chat may still show the keyboard of an older version
    expect(parseInput('📅 今日')).toEqual({ name: 'today', args: [] })
    expect(parseInput('❓ 帮助')).toEqual({ name: 'help', args: [] })
    expect(parseInput(' 状态 ')).toEqual({ name: 'status', args: [] })
    expect(parseInput('把测试修好')).toBeNull()
  })
})

describe('telegram: long replies fold', () => {
  it('puts the rest into an expandable quote', () => {
    expect(fold(['a', 'b', '', 'c', 'd'], 2)).toBe('a\nb\n<blockquote expandable>c\nd</blockquote>')
    expect(fold(['a', '', 'b'], 1)).toBe('a\n<blockquote expandable>b</blockquote>')
    expect(fold(['a', 'b'], 5)).toBe('a\nb')
  })
})

describe('telegram: pictures, effects, reactions', () => {
  it('sends a picture as multipart with the caption and buttons', async () => {
    const { calls, api } = fakeApi(() => ({ message_id: 9 }))
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])
    const r = await api.send('1:A', '42', { text: '<b>卡片</b>', photo, buttons: [[{ text: '🔄', data: 'e:card all' }]] })
    expect(r).toEqual({ ok: true, messageId: 9 })
    expect(calls[0].method).toBe('sendPhoto')
    const body = calls[0].raw!.toString('latin1')
    expect(calls[0].type).toMatch(/^multipart\/form-data; boundary=/)
    expect(Buffer.from(body, 'latin1').toString('utf8')).toContain('<b>卡片</b>')
    expect(body).toContain('name="photo"; filename="tokenpulse.jpg"')
    expect(body).toContain('"callback_data":"e:card all"')
    expect(calls[0].raw!.includes(photo)).toBe(true)
  })

  it('builds multipart bodies', () => {
    const m = multipart({ chat_id: '42', skip: undefined, media: { type: 'photo' } }, { field: 'card', name: 'a.jpg', type: 'image/jpeg', data: Buffer.from('JPG') })
    const text = m.body.toString()
    const boundary = m.type.split('boundary=')[1]
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true)
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true)
    expect(text).toContain('name="media"\r\n\r\n{"type":"photo"}')
    expect(text).not.toContain('skip')
  })

  it('edits a picture in place with editMessageMedia', async () => {
    const { calls, api } = fakeApi()
    await api.edit('1:A', '42', 5, { text: 'new', photo: Buffer.from('x') })
    expect(calls[0].method).toBe('editMessageMedia')
    expect(calls[0].raw!.toString()).toContain('"media":"attach://card"')
  })

  it('keeps the picture and changes only its caption and buttons', async () => {
    const { calls, api } = fakeApi()
    await api.edit('1:A', '42', 5, { text: '<b>草稿</b>', caption: true, buttons: [[{ text: '✅', data: 'e:draft 1 go' }]] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'editMessageCaption', body: { message_id: 5, caption: '<b>草稿</b>', parse_mode: 'HTML' } })
    expect(calls[0].body.reply_markup.inline_keyboard[0][0].callback_data).toBe('e:draft 1 go')
  })

  it('plays effects only in private chats, and drops one the chat refuses', async () => {
    const { calls, api } = fakeApi(
      () => ({ message_id: 1 }),
      (c) => (c.body?.message_effect_id && c.body.chat_id === '7' ? 'Bad Request: EFFECT_ID_INVALID' : null)
    )
    await api.send('1:A', '42', { text: 'hi', effect: 'party', silent: true })
    expect(calls[0].body).toMatchObject({ message_effect_id: EFFECTS.party, disable_notification: true })
    await api.send('1:A', '-100123', { text: 'group', effect: 'party' })
    expect(calls[1].body.message_effect_id).toBeUndefined()
    const r = await api.send('1:A', '7', { text: 'refused', effect: 'fire' })
    expect(r.ok).toBe(true)
    expect(calls.slice(2).map((c) => c.body.message_effect_id ?? null)).toEqual([EFFECTS.fire, null])
  })

  it('offers plain text to the handler, reacts, and shows toasts for buttons', async () => {
    let polls = 0
    const { calls, api } = fakeApi((c) => {
      if (c.method !== 'getUpdates') return { message_id: 50 }
      if (c.body.offset === -1) return []
      polls++
      return polls === 1
        ? [
            { update_id: 1, message: { message_id: 11, chat: { id: 42 }, text: '把测试修好' } },
            { update_id: 2, message: { message_id: 12, chat: { id: 42 }, text: '/pause' } },
            { update_id: 3, callback_query: { id: 'cb', data: 'e:panel status pause', message: { chat: { id: 42 }, message_id: 77 } } },
            { update_id: 4, callback_query: { id: 'cb2', data: 'report', message: { chat: { id: 42 }, message_id: 78 } } }
          ]
        : new Promise((r) => setTimeout(() => r([]), 20))
    })
    const seen: string[] = []
    const bot = new TelegramBot(api, async (c): Promise<Reply> => {
      seen.push(c.name === 'plain' ? `plain:${c.plain}` : [c.name, ...c.args].join(' '))
      if (c.name === 'pause') return { text: 'paused', react: '🫡' }
      if (c.name === 'panel') return { text: 'panel', toast: '⏸ 已暂停' }
      if (c.name === 'report') return { text: '', skip: true, toast: '📰 已发送' }
      return 'offer'
    })
    bot.start('1:A', '42')
    for (let i = 0; i < 100 && seen.length < 4; i++) await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 50))
    bot.stop()
    expect(seen).toEqual(['plain:把测试修好', 'pause', 'panel status pause', 'report'])
    const m = (name: string) => calls.filter((c) => c.method === name)
    // plain text is answered with the task panel's picture
    expect(m('sendChatAction').map((c) => c.body.action)).toEqual(['upload_photo', 'typing'])
    expect(m('setMessageReaction')).toHaveLength(1)
    expect(m('setMessageReaction')[0].body).toMatchObject({ message_id: 12, reaction: [{ type: 'emoji', emoji: '🫡' }] })
    expect(m('answerCallbackQuery').map((c) => c.body)).toEqual([
      { callback_query_id: 'cb', text: '⏸ 已暂停' },
      { callback_query_id: 'cb2', text: '📰 已发送' }
    ])
    expect(m('editMessageText')[0].body).toMatchObject({ message_id: 77, text: 'panel' })
    // a handler that already answered sends nothing more
    expect(m('sendMessage').map((c) => c.body.text)).toEqual(['offer', 'paused'])
  })
})

describe('telegram: animations', () => {
  it('sends an MP4 as an animation, and plays frames before the reply settles', async () => {
    const { calls, api } = fakeApi(() => ({ message_id: 31 }))
    await api.send('1:A', '42', { text: '卡片', animation: Buffer.from('MP4') })
    expect(calls[0].method).toBe('sendAnimation')
    expect(calls[0].raw!.toString()).toContain('name="animation"; filename="tokenpulse.mp4"')
    calls.length = 0
    await api.play('1:A', '42', { text: 'done', frames: [{ text: 'f1' }, { text: 'f2' }], buttons: [[{ text: '🔄', data: 'e:status' }]] })
    expect(calls.map((c) => [c.method, c.body.text])).toEqual([
      ['sendMessage', 'f1'],
      ['editMessageText', 'f2'],
      ['editMessageText', 'done']
    ])
    // only the settled reply carries the buttons
    expect(calls[2].body.reply_markup.inline_keyboard[0][0].callback_data).toBe('e:status')
    expect(calls[1].body.reply_markup).toBeUndefined()
    calls.length = 0
    // on a tapped button the frames play over that message
    await api.play('1:A', '42', { text: 'again', frames: [{ text: 'g1' }] }, 77)
    expect(calls.map((c) => [c.method, c.body.message_id, c.body.text])).toEqual([
      ['editMessageText', 77, 'g1'],
      ['editMessageText', 77, 'again']
    ])
  })
})

describe('telegram: the picture card', () => {
  const base: CardData = {
    date: '10/5 周日',
    time: '21:34',
    view: 'Claude',
    accent: '#d97757',
    tokens: 268_000_000,
    cost: '$106.06',
    costUsd: 106.06,
    messages: 837,
    sessions: 7,
    cacheHit: 0.988,
    hours: Array.from({ length: 24 }, (_, h) => (h < 20 ? h * 1000 : 0)),
    nowHour: 21,
    quotas: [
      { label: 'Claude 5h', pct: 72, reset: '23:17 重置' },
      { label: 'Claude 7 天', pct: 31, reset: null }
    ],
    star: { name: '红巨星', pct: 72, color: '#ff8a5c', desc: '燃料过半' },
    model: 'Opus <4.6> & co',
    sign: '♌ 狮子座',
    rate: null
  }

  it('draws a ring per quota window, the hours and the tiles', () => {
    const svg = cardSvg(base)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('2.68')
    expect(svg).toContain('亿')
    expect(svg).toContain('Claude 5h')
    expect(svg).toContain('url(#ring1)')
    expect(svg).not.toContain('url(#ring2)')
    expect(svg).toContain('最忙 19:00–20:00')
    expect(svg).toContain('红巨星')
    expect(svg).toContain('空闲中')
    // text is escaped and every number is finite
    expect(svg).toContain('Opus &lt;4.6&gt;…')
    expect(svg).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('copes with a quiet day and no quota', () => {
    const svg = cardSvg({ ...base, tokens: 0, hours: Array(24).fill(0), quotas: [], star: null, model: null, rate: '1.2 万 tokens/分' })
    expect(svg).toContain('额度：暂无数据')
    expect(svg).toContain('正在工作 · 1.2 万 tokens/分')
    expect(svg).not.toContain('最忙')
    expect(svg).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('draws the same sky for the same day', () => {
    expect(cardSvg(base)).toBe(cardSvg(base))
    expect(cardSvg({ ...base, date: '10/6 周一' }).replace(/10\/6 周一/g, '')).not.toBe(cardSvg(base).replace(/10\/5 周日/g, ''))
  })
})

describe('telegram settings', () => {
  it('defaults to a folding keyboard with effects, the card in the report and no board', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ telegramKeyboard: 'fold', telegramEffects: true, telegramCardReport: true, telegramBoard: false, telegramQuietFrom: null, telegramQuietTo: null })
  })

  it('keeps only known styles and HH:MM quiet hours', () => {
    const s = sanitize({ telegramKeyboard: 'off', telegramBoard: true, telegramQuietFrom: '23:00', telegramQuietTo: '7:30' }, DEFAULT_SETTINGS)
    expect(s).toMatchObject({ telegramKeyboard: 'off', telegramBoard: true, telegramQuietFrom: '23:00', telegramQuietTo: '07:30' })
    expect(sanitize({ telegramKeyboard: 'huge', telegramQuietFrom: '25:00' }, s)).toMatchObject({ telegramKeyboard: 'off', telegramQuietFrom: null })
  })
})
