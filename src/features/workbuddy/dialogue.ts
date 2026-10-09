import { stat } from 'node:fs/promises'
import type { Dialogue } from '@shared/types'
import { Steps } from '../../main/dialogue'
import { readLinesFrom } from '../../main/collector/store'
import { isSubagentLog, nativeSession, workbuddyPromptText, workbuddyText, workbuddyTimestamp } from './collector'
import { harnessText, isHarnessFile, parseHarnessEvent, readHarnessEvents, type HarnessState } from './harness'

export async function workbuddyDialogue(files: string[], sessionId: string, harnessProviders: string[] = ['workbuddy'], harnessAuto = true): Promise<Dialogue> {
  const rows: any[] = []
  const seen = new Set<string>()
  const harnessSteps = new Steps()
  for (const path of files) {
    if (isHarnessFile(path)) {
      const state: HarnessState = {}
      let user: any
      await readHarnessEvents(path, 0, (event) => {
        if (event?.type === 'user/message' && (!event.data?.source?.kind || event.data.source.kind === 'user')) user = event
        const parsed = parseHarnessEvent(event, state, harnessProviders, harnessAuto)
        if (!parsed || state.sessionId !== sessionId) return
        const key = parsed.entry?.key ?? event.data?.message?.id
        if (key && seen.has(key)) return
        if (key) seen.add(key)
        if (parsed.prompt && user) harnessSteps.prompt(user.time, harnessText(user.data.content))
        if (event.type === 'compaction/summary') harnessSteps.compact(event.time)
        else {
          harnessSteps.reply(event.time, harnessText(event.data?.message?.content), key)
          for (const a of parsed.actions) harnessSteps.tool(a.ts, a.name)
        }
      })
      continue
    }
    if (isSubagentLog(path)) continue
    let size: number
    try { size = (await stat(path)).size } catch { continue }
    await readLinesFrom(path, 0, size, (line) => {
      let obj: any
      try { obj = JSON.parse(line) } catch { return }
      if (obj?.sessionId !== nativeSession(sessionId) || obj.providerData?.isSubAgent || obj.providerData?.teammateMessage) return
      if (!['message', 'function_call'].includes(obj.type) || !Number.isFinite(workbuddyTimestamp(obj.timestamp))) return
      const key = obj.id ?? `${obj.timestamp}:${obj.type}`
      if (seen.has(key)) return
      seen.add(key); rows.push(obj)
    })
  }
  if (files.some(isHarnessFile)) return harnessSteps.done(sessionId, 'workbuddy')
  rows.sort((a, b) => workbuddyTimestamp(a.timestamp) - workbuddyTimestamp(b.timestamp))
  const steps = new Steps()
  for (const o of rows) {
    const ts = workbuddyTimestamp(o.timestamp)
    if (o.type === 'function_call' && typeof o.name === 'string') steps.tool(ts, o.name)
    else if (o.role === 'user') {
      // one compaction writes its history and its summary as two rows
      if (o.providerData?.isSummary && o.providerData?.isCompacted && steps.items[steps.items.length - 1]?.kind !== 'compact') steps.compact(ts)
      const text = workbuddyPromptText(o)
      if (text) steps.prompt(ts, text)
    }
    else if (o.role === 'assistant') steps.reply(ts, workbuddyText(o.content), o.providerData?.messageId ?? o.id)
  }
  return steps.done(sessionId, 'workbuddy')
}
