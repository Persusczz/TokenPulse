import type { LoadState, Settings, SourceView, UsageSource } from './types'

export const SOURCE_NAMES: Record<SourceView, string> = { claude: 'Claude', codex: 'Codex', workbuddy: 'WorkBuddy', all: '全部' }
export const SOURCE_CLI: Record<UsageSource, string> = { claude: 'Claude Code', codex: 'Codex', workbuddy: 'WorkBuddy' }

export function effectiveSource(settings: Pick<Settings, 'sourceFilter' | 'codexEnabled' | 'workbuddyEnabled'> | null, load?: LoadState | null): SourceView {
  const f = settings?.sourceFilter ?? 'all'
  if (f === 'codex' && !settings?.codexEnabled || f === 'workbuddy' && !settings?.workbuddyEnabled) return 'claude'
  if (f === 'all' && load && !load.loading && !(settings?.codexEnabled && load.codexFiles) && !(settings?.workbuddyEnabled && load.workbuddyFiles)) return 'claude'
  return f
}

/** Subscription windows exist for Claude and Codex; WorkBuddy uses credit packages. */
export const hasClaude = (source: SourceView): boolean => source === 'claude' || source === 'all'
export const hasCodex = (source: SourceView): boolean => source === 'codex' || source === 'all'
