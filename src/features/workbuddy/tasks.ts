import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScheduledTask } from '@shared/types'

/** WorkBuddy's bundled CodeBuddy CLI supports the Claude-compatible stream-json protocol. */
export function workbuddyArgs(t: Pick<ScheduledTask, 'permission' | 'model' | 'effort' | 'compactAt' | 'autoCompact' | 'fallbackModel'>, o: { prompt: string; system: string; resume?: string | boolean; fork?: boolean; partial?: boolean; stdin?: boolean }): string[] {
  const args = ['-p', ...(o.stdin ? [] : [o.prompt]), '--output-format', 'stream-json', '--verbose', '--append-system-prompt', o.system]
  if (o.partial) args.push('--include-partial-messages')
  if (typeof o.resume === 'string') args.push('--resume', o.resume, ...(o.fork ? ['--fork-session'] : []))
  else if (o.resume) args.push('--continue', '--fork-session')
  if (t.permission !== 'inherit') args.push('--permission-mode', t.permission)
  if (t.model) args.push('--model', t.model)
  if (t.fallbackModel && t.fallbackModel !== t.model) args.push('--fallback-model', t.fallbackModel)
  if (t.effort) args.push('--effort', t.effort)
  // WorkBuddy's documented override is a token count; percentage and disabling are not CLI options.
  if (t.compactAt?.unit === 'tokens') args.push('--autocompact', String(Math.min(1_000_000, Math.max(100_000, t.compactAt.value))))
  return args
}

const run = (cmd: string, args: string[]): Promise<string> => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).trim()))
})

export async function findWorkBuddy(override = ''): Promise<string | null> {
  const explicit = override || process.env.WORKBUDDY_CLI
  if (explicit) return existsSync(explicit) ? explicit : null
  const found = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['codebuddy'])
  const onPath = found.split(/\r?\n/).find((p) => process.platform !== 'win32' || /\.(exe|cmd|bat)$/i.test(p))
  if (onPath) return onPath
  if (process.platform !== 'win32') return null
  const npm = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'codebuddy.cmd')
  if (existsSync(npm)) return npm
  // WorkBuddy permits a custom installation folder; use its registered DisplayIcon to locate the bundled CLI.
  const icons = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -match '^WorkBuddy(?: |$)' } | ForEach-Object { $_.DisplayIcon }"])
  for (const icon of icons.split(/\r?\n/)) {
    const exe = icon.replace(/,\d+$/, '').replace(/^"|"$/g, '')
    if (!/WorkBuddy\.exe$/i.test(exe)) continue
    const launcher = join(exe.replace(/[\\/][^\\/]+$/, ''), 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy')
    if (existsSync(launcher)) return launcher
  }
  return null
}
