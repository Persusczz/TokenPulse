import type { AccentKey } from './accents'
import type { Hotkey, HotkeyStatus } from './hotkeys'

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'

export interface UsageEntry {
  /** message.id + requestId; identical usage rows from one response share it */
  key: string
  ts: number
  model: string
  sessionId: string
  project: string
  projectPath: string
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  webSearch: number
  speed: 'standard' | 'fast'
  geo: string | null
  /** which tool wrote it; absent = Claude Code */
  source?: UsageSource
  /** a subagent's request (Claude Code sidechain): its context is not the session's */
  side?: boolean
}

export type UsageSource = 'claude' | 'codex'
/** what the app shows: one tool, or both together */
export type SourceView = 'all' | UsageSource

/** A message the user typed, as found in the session logs */
export interface PromptMark {
  key: string
  sessionId: string
  ts: number
  /** shortened */
  text: string
  project: string
  source: UsageSource
}

/** One prompt and everything it set off until the next one */
export interface PromptCost {
  key: string
  sessionId: string
  project: string
  source: UsageSource
  ts: number
  text: string
  cost: number
  tokens: number
  output: number
  requests: number
  /** from the prompt to its last response */
  durationMs: number
  models: string[]
}

export interface PromptReport {
  range: RangeKey
  /** prompts with usage in the range */
  count: number
  totalCost: number
  avgCost: number
  medianCost: number
  /** the most expensive first */
  top: PromptCost[]
  /** usage with no prompt found in the logs (cleaned-up logs, archived rows) */
  unattributedCost: number
}

/** How big each request's context was through a session */
export interface SessionContext {
  sessionId: string
  project: string
  source: UsageSource
  model: string
  /** context tokens per request (thinned) */
  points: { t: number; tokens: number }[]
  latest: number
  peak: number
  /** times the context shrank sharply (/compact or auto-compact) */
  compactions: number[]
  /** average growth per request since the last compaction */
  growthPerRequest: number
  requests: number
  /** the warning line, tokens */
  warnAt: number
  /** the model's context window, when known */
  window?: number
  prompts: PromptCost[]
}

/** A session whose context has grown past the warning line */
export interface ContextAlert {
  sessionId: string
  project: string
  source: UsageSource
  tokens: number
  warnAt: number
  /** the model's context window */
  window: number
  model?: string
  growthPerRequest: number
  at: number
}

/** One 5-hour window, from start to reset */
export interface WindowRecord {
  source: UsageSource
  start: number
  end: number
  /** highest reading, percent */
  peak: number
  /** when it reached 100%, if it did */
  hitAt: number | null
  /** readings through the window, for the replay */
  samples: { t: number; pct: number }[]
  /** worked out from local logs, not read from the provider */
  estimated: boolean
}

export interface WindowHistory {
  days: number
  windows: WindowRecord[]
  summary: { source: UsageSource; windows: number; hits: number; avgToHitMs: number | null; avgPeak: number; estimated: number }[]
}

export interface CostParts {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  webSearch: number
  total: number
  /** what cache reads would have cost as plain input, minus what they did cost */
  cacheSavings: number
}

/** All prices are USD per million tokens */
export interface PriceRow {
  id: string
  name: string
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
  fastInput?: number
  fastOutput?: number
  /** retired by the provider (kept so old history still prices), or only offered to some customers */
  status?: 'retired' | 'limited'
}

export type PricingSource = 'official' | 'litellm' | 'bundled'

export interface ModelResolution {
  model: string
  matched: string | null
  /** id of the price row used */
  rowId?: string | null
  estimated: boolean
  /** which tool used it, and how much over the last 30 days */
  source?: UsageSource
  tokens?: number
  cost?: number
  lastSeen?: number
}

export interface PricingInfo {
  source: PricingSource
  fetchedAt: number
  rows: PriceRow[]
  webSearchPer1k: number
  usGeoMultiplier: number
  /** models seen in logs and how they were priced */
  models: ModelResolution[]
  lastError?: string
  refreshing?: boolean
}

export interface TokenTotals {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  tokens: number
  cost: number
  costParts: CostParts
  messages: number
  sessions: number
  webSearch: number
}

export interface Bucket {
  t: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  tokens: number
  cost: number
  costInput: number
  costOutput: number
  costCacheWrite: number
  costCacheRead: number
}

export interface GroupStat {
  name: string
  tokens: number
  cost: number
  messages: number
}

export interface HeatCell {
  date: string
  t: number
  tokens: number
  cost: number
}

export interface RangeSummary {
  range: RangeKey
  start: number
  end: number
  bucketUnit: 'hour' | 'day' | 'week'
  totals: TokenTotals
  previous: { tokens: number; cost: number } | null
  cacheHitRate: number
  buckets: Bucket[]
  byModel: GroupStat[]
  byProject: GroupStat[]
  heatmap: HeatCell[] | null
}

export type Intensity = 0 | 1 | 2 | 3

export interface LiveStats {
  now: number
  today: { tokens: number; cost: number; messages: number }
  monthCost: number
  tokensPerMin: number
  costPerHour: number
  intensity: Intensity
  projectedTodayCost: number
  /** USD; daily budget, or 1.5x the recent daily average */
  capacity: number
  capacityFromBudget: boolean
  dailyAvgCost: number
  lastEntryAt: number | null
  totalEntries: number
}

export interface SessionRow {
  sessionId: string
  project: string
  models: string[]
  start: number
  end: number
  messages: number
  tokens: number
  cost: number
  reportedCost: number | null
  source?: UsageSource
  /** context tokens of the session's latest request */
  context: number
  /** its model's context window and warning line */
  window?: number
  warnAt?: number
}

export interface QuotaWindow {
  key: string
  label: string
  /** percent, 0-100 */
  utilization: number
  resetsAt: string | null
  severity: string | null
}

export type QuotaStatus = 'loading' | 'ok' | 'disabled' | 'no-credentials' | 'expired' | 'error' | 'no-data'

/** Where quota numbers come from; 'auto' picks the freshest available */
export type QuotaSource = 'auto' | 'oauth' | 'statusline' | 'local'
export type QuotaOrigin = Exclude<QuotaSource, 'auto'>

export interface QuotaInfo {
  status: QuotaStatus
  windows: QuotaWindow[]
  /** share of the 7-day usage by surface (Claude Code, chat, …) */
  breakdown: { name: string; percent: number }[]
  plan?: string
  fetchedAt?: number
  error?: string
  /** which source produced `windows` */
  origin?: QuotaOrigin
  /** local estimate only: API-equivalent spend in the 5h window and the limit it is measured against */
  local?: { usedUsd: number; limitUsd: number | null; calibrated: boolean; windowStart: number; windowEnd: number }
  /** 5h burn rate from recent samples */
  burn?: QuotaBurn | null
}

/** Codex (ChatGPT plan) limits, read from the rate_limits Codex writes into its session logs */
export interface CodexQuota {
  plan: string | null
  /** when Codex last reported them */
  updatedAt: number
  /** keys codex_5h / codex_7d; a window whose reset has passed is shown as 0% */
  windows: QuotaWindow[]
  /** files read under ~/.codex */
  files: number
  /** from the session logs, or the ChatGPT account's usage endpoint */
  origin?: 'logs' | 'api'
}

/** Updating from the GitHub releases */
export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  /** the portable exe is replaced in place; the installed app runs the new installer; a dev build only checks */
  kind: 'portable' | 'installer' | 'dev'
  latest?: { version: string; notes: string; page: string; publishedAt: number; size?: number }
  /** 0–1 while downloading */
  progress?: number
  error?: string
  checkedAt?: number
}

/** Reading Codex's limits from the ChatGPT account */
export interface CodexUsageState {
  /** off: not used; nologin: no ChatGPT login to read with */
  status: 'off' | 'ok' | 'error' | 'nologin'
  /** whose login was used: TokenPulse's own, or Codex CLI's */
  source: 'tokenpulse' | 'cli' | null
  email: string | null
  /** last good reading */
  at: number | null
  error?: string
  /** TokenPulse has its own ChatGPT login */
  loggedIn: boolean
  /** Codex CLI is logged in with ChatGPT (~/.codex/auth.json) */
  cliLogin: boolean
  /** banked resets the account holds and can use (rate_limit_reset_credits), null = not reported */
  resetCredits?: number | null
}

/** A Codex limit reset announced by Tibo (@thsottiaux, who leads Codex) on X, as Codex Resets tracks them */
export interface CodexResetPost {
  /** the X post's id, or an observed-… id for a reset that came without a post */
  id: string
  /** regular: everyone's limits start over; banked: a reset put into every account to use later */
  kind: 'regular' | 'banked'
  /** announced, or first seen */
  at: number
  text: string
  url: string | null
  /** seen happening, no announcement */
  observed: boolean
}

/** What a regular reset did to the user's own Codex 7-day window */
export interface ResetEffect {
  /** the week's highest reading before the reset, percent (null = no reading then) */
  before: number | null
  /** the 7-day window started over after the announcement */
  restarted: boolean
  /** there is a reading from after the announcement to tell by */
  checked: boolean
}

/** Tibo's reset announcements and hints, read from codex-resets.com (which watches his posts on X) */
export interface CodexResets {
  status: 'off' | 'loading' | 'ok' | 'error'
  /** last good read */
  at: number | null
  error?: string
  latest: CodexResetPost | null
  /** announced, not seen happening yet */
  scheduled: (CodexResetPost & { due: number | null }) | null
  /** a post that hints at a reset, as the tracker reads it */
  hint: { level: 'elevated' | 'strong'; chance: number | null; window: string; at: number; until: number; text: string; url: string | null } | null
  stats: { total: number; avgDays: number | null } | null
  /** newest first */
  history: CodexResetPost[]
  /** keyed by post id: the user's own window around each regular reset (filled when asked for) */
  effects?: Record<string, ResetEffect>
}

/** How a quota window is being used against a straight line from its start to its reset */
export interface Pace {
  key: string
  label: string
  source: UsageSource
  pct: number
  start: number
  end: number
  /** where an even pace would be now, percent */
  ideal: number
  /** pct - ideal: positive = ahead (runs out early), negative = behind (will go unused) */
  lead: number
  /** percent per hour, recent */
  pctPerHour: number
  /** at the reset, at the recent pace (may exceed 100) */
  projected: number
  /** when it reaches 100% at the recent pace, if before the reset */
  etaFull: number | null
  /** percent left unused at the reset, at the recent pace */
  unused: number
  /** estimated cumulative percent through the window so far */
  curve: { t: number; pct: number }[]
}

/** Prompt-cache rewrites after a session sat idle past the cache lifetime */
export interface CacheReport {
  range: RangeKey
  source: SourceView
  /** rewrites of an expired cache */
  rebuilds: number
  /** what they cost beyond reading the same tokens from cache, USD */
  extraCost: number
  /** all Claude spend in the range, USD */
  totalCost: number
  /** all cache-write spend in the range, USD */
  writeCost: number
  hitRate: number
  avgRebuildTokens: number
  gaps: { label: string; count: number; extra: number }[]
  sessions: { sessionId: string; project: string; rebuilds: number; extra: number; last: number }[]
  tips: string[]
}

export interface QuotaBurn {
  /** percentage points per hour */
  pctPerHour: number
  /** epoch ms when the 5h window reaches the guard threshold at this pace (null: not before reset) */
  etaPause: number | null
  /** epoch ms when it reaches 100% at this pace */
  etaFull: number | null
}

/** Live throughput over the last hour */
export interface RateStats {
  now: number
  /** one point per minute, oldest first, 60 points ending at the current minute */
  perMinute: { t: number; tokens: number; output: number; cost: number; requests: number }[]
  /** tokens in the last 60 s */
  tokensPerMin: number
  /** the last 60 s counted like API rate limits (TPM): input not read from the cache (fresh + cache writes), and output */
  inputTpm: number
  outputTpm: number
  /** average over the last 5 min */
  tokensPerMin5: number
  /** output tokens per second over the last 5 min */
  outputPerSec: number
  /** API responses per minute over the last 5 min */
  requestsPerMin: number
  costPerHour: number
  /** busiest minute today */
  peakPerMin: number
  peakAt: number | null
  /** gauge full scale (tokens/min) */
  scale: number
}

export interface PausedTask {
  sessionId: string
  cwd: string
  since: number
  /** epoch ms the 5h window resets, if known */
  until: number | null
  pct: number
  /** what holds it: the 5h line, the 7-day line, waiting for the allowed resume hours, or a manual / remote pause */
  reason?: 'five' | 'week' | 'window' | 'manual'
}

/** A session burning through tokens far faster than usual, or stuck repeating itself */
export interface RunawayAlert {
  sessionId: string
  project: string
  kind: 'burst' | 'loop'
  /** API-equivalent cost and tokens in the last 5 minutes */
  cost5: number
  tokens5: number
  requests5: number
  /** cost5 over the usual heavy 5 minutes */
  ratio: number
  /** identical responses in a row (loops) */
  repeats: number
  at: number
  /** the guard holds this session's next tool call */
  held: boolean
}

/** Is the subscription paying off, measured in API-equivalent cost */
export interface ValueReport {
  source: SourceView
  plan: string | null
  /** USD per month */
  planPrice: number
  /** false when the price comes from settings */
  priceDetected: boolean
  monthCost: number
  projectedMonthCost: number
  multiple: number
  projectedMultiple: number
  dayOfMonth: number
  daysInMonth: number
  /** times the 5h window reached 90% this month */
  quotaHits: number
  verdict: 'upgrade' | 'keep' | 'downgrade' | 'unknown'
  advice: string
  /** cumulative cost at the end of each day so far this month */
  daily: { t: number; cost: number }[]
}

/** Where the 7-day window is heading at the current pace */
export interface WeeklyForecast {
  available: boolean
  usedPct: number
  resetsAt: number | null
  windowStart: number | null
  daysLeft: number
  /** average since the window opened */
  avgPctPerDay: number
  /** last 24 h, estimated from local logs */
  recentPctPerDay: number | null
  /** at reset, with the blended pace */
  projectedPct: number
  etaFull: number | null
  /** daily share that lands the window at about 95% by reset */
  suggestPctPerDay: number
  tokensPerPct: number | null
  suggestTokensPerDay: number | null
  /** estimated cumulative % at the end of each day so far */
  days: { t: number; pct: number }[]
}

/** A constellation drawing: stars at 0–1 positions and the lines between them (by index) */
export interface StarFigure {
  points: [number, number][]
  lines: [number, number][]
}

/** Today's sun sign, lit star by star as the day's usage nears an ordinary day */
export interface ZodiacInfo extends StarFigure {
  key: string
  name: string
  symbol: string
  stars: number
  lit: number
  today: number
  /** tokens on an average active day (last 30 days) */
  average: number
}

/** The constellation read from the last 30 days of habits */
export interface CodingSign extends StarFigure {
  key: string
  name: string
  symbol: string
  desc: string
  traits: string[]
  zodiac: ZodiacInfo
}

export type AchievementGroup = 'volume' | 'streak' | 'time' | 'efficiency' | 'sessions' | 'explore' | 'guardian' | 'cosmos' | 'collect'

export interface Achievement {
  id: string
  title: string
  desc: string
  /** one glyph */
  icon: string
  group: AchievementGroup
  /** 1 bronze, 2 silver, 3 gold, 4 legendary */
  tier: 1 | 2 | 3 | 4
  unlocked: boolean
  at: number | null
  /** 0–1 toward unlocking */
  progress: number
  hint: string
  /** tier = reach a number; collect = gather every piece (items); secret = hidden until earned */
  kind?: 'tier' | 'collect' | 'secret'
  hidden?: boolean
  items?: { label: string; got: boolean }[]
}

// ---------------------------------------------------------------- the quota as stars

/** a 5-hour window's life, by how much of it is used */
export type StarStage = 'nebula' | 'protostar' | 'main' | 'giant' | 'supergiant' | 'supernova'
/** what a closed window leaves: by its peak */
export type RemnantKind = 'dwarf' | 'neutron' | 'nebula' | 'blackhole'
export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

/** A tool's 5-hour window as a star, with its 7-day window as the orbit around it */
export interface QuotaStar {
  key: string
  source: UsageSource
  label: string
  pct: number
  stage: StarStage
  start: number
  end: number
  pctPerHour: number
  /** at the reset, at the recent pace (may exceed 100) */
  projected: number
  /** when each later stage comes at the recent pace (null: not before the reset) */
  next: { stage: StarStage; name: string; at: number | null }[]
  /** what it will leave behind at the reset, at the recent pace */
  fate: RemnantKind
  week: { pct: number; start: number; end: number; ideal: number; projected: number } | null
}

/** A closed (or ended) 5-hour window and what it left */
export interface Remnant {
  source: UsageSource
  start: number
  end: number
  peak: number
  hitAt: number | null
  kind: RemnantKind
  tokens: number
  cost: number
  estimated: boolean
}

/** A session as a star: luminosity = tokens, temperature = tokens per active minute */
export interface SessionStar {
  id: string
  project: string
  source: UsageSource
  model: string
  tokens: number
  cost: number
  minutes: number
  rate: number
  cls: SpectralClass
  branch: 'main' | 'giant' | 'dwarf'
  start: number
  end: number
}

/** The last 30 days as one kind of star */
export interface StellarType {
  kind: 'star' | 'blackhole' | 'white-dwarf' | 'binary' | 'neutron' | 'flare' | 'pulsar' | 'dust'
  name: string
  /** a spectral code such as G2V, or BH / NS / PSR */
  code: string
  /** the spectral class by mass, whatever the kind */
  cls: SpectralClass
  color: string
  desc: string
  traits: string[]
  days: number
}

/** A project of the last 30 days as a planet */
export interface ProjectPlanet {
  project: string
  tokens: number
  cost: number
  /** of the planets shown */
  share: number
  sessions: number
  activeDays: number
  last: number
  source: UsageSource
  model: string
}

/** A prompt of today as a meteor: brightness = cost */
export interface Meteor {
  ts: number
  cost: number
  tokens: number
  text: string
  sessionId: string
  project: string
  source: UsageSource
  durationMs: number
}

/** The whole history squeezed into one year */
export interface CosmicCalendar {
  start: number
  end: number
  events: { ts: number; title: string; icon: string; kind: 'origin' | 'record' | 'ach' }[]
}

export interface Cosmos {
  stars: QuotaStar[]
  remnants: Remnant[]
  sessions: SessionStar[]
  me: StellarType
  projects: ProjectPlanet[]
  meteors: Meteor[]
  /** prompts in the busiest hour today, and when it began */
  zhr: { rate: number; at: number | null }
  calendar: CosmicCalendar
}

/** tokens and cost one window's quota bought, for "how much is 1% worth" */
export interface QuotaRate {
  source: UsageSource
  start: number
  end: number
  /** percent used: the peak, or the current reading for the running window */
  pct: number
  tokens: number
  cost: number
  current: boolean
}

/** One quota window (5 hours or 7 days) and what was used in it */
export interface QuotaCycle {
  kind: '5h' | '7d'
  start: number
  end: number
  tokens: number
  cost: number
  /** responses */
  messages: number
  sessions: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** the provider's reading, percent: the highest for a closed window, the latest for the open one; null when never read */
  pct: number | null
  /** when it reached 100%, if it did */
  hitAt: number | null
  /** open now */
  current: boolean
  /** bounds worked out from the logs, not read from the provider */
  estimated: boolean
  /** the most expensive models in it */
  models: { name: string; cost: number; tokens: number }[]
}

/** A tool's 5-hour and 7-day windows, oldest first */
export interface QuotaCycles {
  source: UsageSource
  five: QuotaCycle[]
  seven: QuotaCycle[]
}

/** How a scheduled task may use tools (Claude Code --permission-mode); inherit = the user's own settings */
export type TaskPermission = 'inherit' | 'auto' | 'acceptEdits' | 'bypassPermissions' | 'plan'

/**
 * A prompt handed to Claude Code or Codex when that tool's 5h window
 * refreshes, at a set time, now, by hand, or after another task finishes.
 */
export interface ScheduledTask {
  id: string
  /** which CLI runs it; absent on tasks saved before Codex tasks existed = Claude */
  tool: UsageSource
  prompt: string
  cwd: string
  /** 'manual' waits until started by hand (or until its parent task finishes) */
  trigger: 'reset' | 'now' | 'time' | 'manual'
  /** chosen time for 'time' */
  at: number | null
  /** earliest start, worked out when queued */
  notBefore: number
  /** queue again for the next refresh after each run */
  repeat: boolean
  permission: TaskPermission
  model: string | null
  /** carry on from the folder's latest conversation (claude -c / codex resume --last) */
  continue: boolean
  /** let the CLI compact the conversation when the context fills */
  autoCompact: boolean
  /** where compaction kicks in; null = the CLI's own point, just before the context is full */
  compactAt?: TaskCompactAt | null
  /** runs once this task has finished successfully */
  parentId: string | null
  /** position in the queue (drag to change) */
  order: number
  /** when it was queued or attached to its parent */
  queuedAt: number
  /** started by hand: runs as soon as its folder is free, ignoring its trigger and parent */
  force?: boolean
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  /** last successful run (survives a repeating task being queued again) */
  doneAt: number | null
  sessionId: string | null
  costUsd: number | null
  turns: number | null
  /** the final answer (shortened) */
  summary: string | null
  error: string | null
  /** what it is doing right now */
  activity: string | null
  runs: number
  /** how the latest run ran: in its own terminal window, or hidden in the background */
  mode: 'terminal' | 'background' | null
  /** something TokenPulse did on its own, e.g. switched to a model the account can use */
  note?: string | null
  /** tokens of the latest run (Codex reports them; priced by the app) */
  tokens?: number | null
  /** tool calls made in the latest run */
  steps?: number
  /** tries after a failure, on its own (0 = none) */
  retries?: number
  /** run in the folder after a successful run (e.g. npm test): a failing check counts as a failed try, and the next try is asked to fix it */
  verify?: string | null
  /** a try running longer than this many minutes is stopped */
  timeoutMin?: number | null
  /** Claude: --max-budget-usd for each try */
  budgetUsd?: number | null
  /** Claude: --fallback-model when the model is overloaded; retries of either tool run with it */
  fallbackModel?: string | null
  effort?: TaskEffort | null
  /** carry on this conversation instead of the folder's latest (a follow-up) */
  resumeId?: string | null
  /** the task this one follows up */
  followOf?: string | null
  /** the next try, waiting for its time: what it is and what to tell the model */
  pending?: { kind: TaskAttempt['kind']; prompt: string | null; resumeId: string | null; model: string | null } | null
  /** the tries of the latest run */
  attempts?: TaskAttempt[]
  /** times the latest run waited for a quota refresh */
  quotaWaits?: number
}

/**
 * When a run compacts its conversation: at a share of the model's context
 * window (Claude CLAUDE_AUTOCOMPACT_PCT_OVERRIDE), or at a token count
 * (Claude CLAUDE_CODE_AUTO_COMPACT_WINDOW, Codex model_auto_compact_token_limit).
 */
export interface TaskCompactAt {
  unit: 'pct' | 'tokens'
  value: number
}

/** How hard the model thinks (Claude --effort, Codex model_reasoning_effort) */
export type TaskEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Why a try failed, which decides what comes next: a quota that ran out waits
 * for the refresh and carries on; network trouble, a timeout, a failing check
 * or another failure use up one retry; a stop by hand, a spending cap or a
 * setup problem (folder, CLI) end the run.
 */
export type TaskFailure = 'stopped' | 'quota' | 'transient' | 'timeout' | 'check' | 'budget' | 'setup' | 'other'

/** One try of a task's latest run */
export interface TaskAttempt {
  n: number
  /** the first try, a retry after a failure, a fix after a failing check, or carrying on after the quota refreshed */
  kind: 'run' | 'retry' | 'fix' | 'resume'
  startedAt: number
  finishedAt: number | null
  ok: boolean | null
  reason: string | null
  failure?: TaskFailure | null
  costUsd: number | null
  model: string | null
  /** the check after this try */
  check?: TaskCheck | null
}

export interface TaskCheck {
  code: number
  /** the end of its output */
  tail: string
  ms: number
}

export interface TaskInput {
  prompt: string
  cwd: string
  trigger: ScheduledTask['trigger']
  tool?: UsageSource
  at?: number | null
  repeat?: boolean
  permission?: TaskPermission
  model?: string | null
  continue?: boolean
  autoCompact?: boolean
  compactAt?: TaskCompactAt | null
  parentId?: string | null
  retries?: number
  verify?: string | null
  timeoutMin?: number | null
  budgetUsd?: number | null
  fallbackModel?: string | null
  effort?: TaskEffort | null
  resumeId?: string | null
  followOf?: string | null
}

/** What can be changed on a task that is not running */
export type TaskPatch = Partial<
  Pick<TaskInput, 'prompt' | 'cwd' | 'trigger' | 'at' | 'repeat' | 'permission' | 'model' | 'continue' | 'autoCompact' | 'compactAt' | 'retries' | 'verify' | 'timeoutMin' | 'budgetUsd' | 'fallbackModel' | 'effort'>
>

/** start now, stop, cancel, queue for the next refresh, try again now, or delete */
export type TaskAction = 'start' | 'stop' | 'cancel' | 'requeue' | 'retry' | 'remove'

/** Drop a queued task before / after another, under it as its subtask, or back at the top level */
export type TaskMove = 'before' | 'after' | 'child' | 'root'

export interface TaskLogLine {
  t: number
  kind: 'system' | 'thinking' | 'text' | 'tool' | 'result' | 'error'
  text: string
}

/** One tool's side of the queue */
export interface TaskToolState {
  /** path of the CLI, null when not found */
  cli: string | null
  /** when its current 5h window refreshes, if known */
  nextReset: number | null
  /** why its due tasks are not starting, if any are due */
  waiting: string | null
}

export interface TaskQueueState {
  tasks: ScheduledTask[]
  /** Claude's side (kept flat for older readers) */
  nextReset: number | null
  claude: string | null
  waiting: string | null
  tools: Record<UsageSource, TaskToolState>
  /** tasks open their own terminal window (Node.js found and the setting on) */
  terminal: boolean
  /** Node.js runs the terminal window; null when not found */
  node: string | null
}

/** A day of the overview's calendar */
export interface CalendarDay {
  t: number
  tokens: number
  cost: number
  messages: number
  sessions: number
  /** the day's main models by cost, and its biggest projects */
  models: { name: string; cost: number }[]
  projects: { name: string; tokens: number }[]
  first: number | null
  last: number | null
  /** hour of the day with the most tokens */
  busiest: number | null
}

/** A session of today on the overview's timeline */
export interface SessionSpan {
  id: string
  project: string
  source: UsageSource
  /** the model it spent most on */
  model: string
  start: number
  end: number
  tokens: number
  cost: number
  messages: number
  /** tokens in each 10 minutes from its start */
  bins: number[]
}

/** One model over a range, for the overview's model table */
export interface ModelRow {
  name: string
  source: UsageSource
  tokens: number
  cost: number
  messages: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** questions it answered, and what they cost together */
  prompts: number
  promptCost: number
}

/** What a tool call did: ran a command, read or searched code, changed files, went online, started a subagent, used an MCP tool */
export type ActionKind = 'run' | 'read' | 'edit' | 'web' | 'agent' | 'mcp' | 'other'

/** One tool call the AI made: a Claude Code tool_use, or a completed Codex item */
export interface ToolAction {
  /** the tool_use / item id */
  key: string
  ts: number
  sessionId: string
  project: string
  source: UsageSource
  kind: ActionKind
  /** as shown: Bash, Read, Edit, Shell, apply_patch, server · tool… */
  name: string
  /** lines written and taken out (edits only) */
  added?: number
  removed?: number
  /** the files an edit touched, with its lines in each */
  files?: { path: string; added: number; removed: number }[]
}

/** The overview's "AI 做了什么": the tool calls over a range */
export interface ActionStats {
  total: number
  kinds: { kind: ActionKind; count: number }[]
  /** the most used tools */
  tools: { name: string; kind: ActionKind; source: UsageSource; count: number }[]
  added: number
  removed: number
  /** distinct files edited */
  files: number
  /** the files edited most */
  topFiles: { path: string; name: string; project: string; edits: number; added: number; removed: number }[]
  /** questions asked in the range, to say how many calls one question set off */
  prompts: number
  /** the oldest tool call still in the logs (Claude Code keeps 30 days) */
  since: number | null
}

/** The overview's personal records, over everything in the logs */
export interface PersonalRecords {
  bestDay: { t: number; tokens: number } | null
  costDay: { t: number; cost: number } | null
  /** the longest run of days in a row with use, and the run going on now (0 if none) */
  streak: { days: number; from: number; to: number } | null
  current: number
  bestHour: { t: number; tokens: number } | null
  bigSession: { id: string; project: string; source: UsageSource; start: number; tokens: number; cost: number } | null
  promptDay: { t: number; prompts: number } | null
  costPrompt: { ts: number; cost: number; text: string; sessionId: string } | null
  codeDay: { t: number; added: number; removed: number } | null
  /** today's numbers, to set against the records */
  today: { tokens: number; cost: number; prompts: number; added: number; hour: number }
  /** per day with use, per question, and a typical conversation */
  avg: { dayTokens: number; dayCost: number; promptCost: number; promptTokens: number; promptsPerDay: number; sessionMinutes: number }
  /** days with use, and the first one */
  days: number
  since: number | null
}

/** What the 22 cards of the 塔罗 page draw: each card is one picture of your usage */
export interface TarotDeck {
  source: SourceView
  /** whose quota the quota cards draw (Claude in 全部) */
  tool: UsageSource
  at: number
  /** the first day in the logs */
  firstDay: number | null
  /** the last 60 days, oldest first */
  days: { day: number; tokens: number; output: number; cost: number }[]
  today: { input: number; output: number; cacheWrite: number; cacheRead: number; hours: number[]; peak: { tokens: number; at: number } | null }
  /** average tokens per hour of the day over the 14 days before today */
  usualHours: number[]
  /** the fastest minute in those 14 days */
  record: number
  tpm: number
  /** Claude and Codex (全部), or the two most used models */
  lovers: { a: { name: string; tokens: number }; b: { name: string; tokens: number } | null } | null
  streak: number
  bestStreak: number
  /** the last 7 days between 22:00 and 05:00 */
  night: { tokens: number; share: number }
  five: { pct: number; end: number } | null
  seven: { pct: number; start: number; end: number } | null
  guardAt: number | null
  /** the 5-hour windows of the open 7-day window */
  wheel: { start: number; end: number; peak: number; current: boolean }[]
  /** cost of the last 7 days and the 7 before */
  week: { now: number; prev: number }
  /** what the 5-hour windows of the last 7 days left unused, on average (percent) */
  unused: { avg: number; n: number } | null
  /** conversations that ended today, newest first */
  ended: { project: string; tokens: number; end: number }[]
  endedCount: number
  /** today's costliest question against the average */
  devil: { text: string; cost: number; avg: number; over3: number } | null
  /** percent of the 7-day quota a full 5-hour window takes */
  full: number | null
  /** the 8 most used projects of the last 7 days */
  projects: { name: string; tokens: number }[]
  /** refresh tasks of the last 7 days, newest first */
  tasks: { title: string; status: string; at: number }[]
}

export interface TitleCorner {
  avg: number[]
  lo: number[]
  hi: number[]
  opaque: number
}

export interface TelegramResult {
  ok: boolean
  error?: string
  chatId?: string
  name?: string
  /** the message sent, for editing it later */
  messageId?: number
}

export interface GuardState {
  enabled: boolean
  pauseAt: number
  hookInstalled: boolean
  bridgeInstalled: boolean
  paused: PausedTask[]
  nodePath: string | null
  /** path of ~/.claude/settings.json that was edited */
  claudeSettings: string | null
  error?: string
  /** every Claude Code task is held (paused from the app or Telegram) */
  manualHold: boolean
  /** sessions held one by one (runaway protection) */
  heldSessions: string[]
  /** the hook was installed during this run: sessions already open have not loaded it */
  hookFresh?: boolean
}

export interface RangeChip {
  range: RangeKey
  start: number
  end: number
  tokens: number
  cost: number
}

export interface RangeOverview {
  chips: RangeChip[]
  /** earliest usage on record (logs + archive) */
  firstTs: number | null
  /** days with any usage */
  activeDays: number
  archived: number
}

export type ThemeSetting = 'system' | 'light' | 'dark'
/** how much decorative motion to show; 'off' also applies when the OS asks for reduced motion */
export type MotionLevel = 'off' | 'subtle' | 'standard' | 'rich'
/** animation frame rate: each animation at its own rate, all at most 30 or 60, or as fast as the display */
export type FrameCap = 'auto' | '30' | '60' | 'max'
export type BackdropStyle =
  | 'plain'
  | 'galaxy'
  | 'flow'
  | 'stars'
  | 'aurora'
  | 'ripples'
  | 'paper'
  | 'neon'
  | 'borealis'
  | 'ink'
  | 'abyss'
  | 'claude'
  | 'codex'
  | 'sakura'
  | 'dune'
  | 'astral'
  | 'orrery'
  | 'lunar'
  | 'eclipse'
  | 'trails'
  | 'rain'
  | 'firefly'
  | 'lava'
  | 'crystal'
  | 'matrix'
  | 'fireworks'
  | 'lantern'
  | 'bauhaus'
  | 'daylight'
  | 'mystic'
  | 'cyber'
  | 'xianxia'
  | 'koi'
  | 'ukiyo'
  | 'pixel'
/** a whole look at once: colours, backdrop and fonts; 'none' = Claude's own */
export type ThemePack =
  | 'none'
  | 'claude'
  | 'codex'
  | 'astral'
  | 'orrery'
  | 'lunar'
  | 'eclipse'
  | 'trails'
  | 'rain'
  | 'firefly'
  | 'lava'
  | 'crystal'
  | 'matrix'
  | 'fireworks'
  | 'lantern'
  | 'bauhaus'
  | 'sakura'
  | 'dune'
  | 'paper'
  | 'neon'
  | 'borealis'
  | 'ink'
  | 'abyss'
  | 'daylight'
  | 'mystic'
  | 'cyber'
  | 'xianxia'
  | 'koi'
  | 'ukiyo'
  | 'pixel'
/** where the sky is drawn for */
export interface SkyPlace {
  name: string
  lat: number
  lon: number
}
export type { AccentKey }
/** Windows 11 system backdrop behind the main window */
export type WindowMaterial = 'none' | 'mica' | 'acrylic'
export type MiniMode = 'card' | 'capsule' | 'orb'

/**
 * Where the floating window rests: its position, and how it sits on its
 * display, so it lands at the same edge on a screen of another size.
 */
export interface MiniPlace {
  x: number
  y: number
  /** the display it was on (Electron's display id); absent on positions saved before 2.19 */
  display?: number
  /** the nearer side of that display's work area and the window's gap to it, in DIP */
  h?: 'left' | 'right'
  dx?: number
  v?: 'top' | 'bottom'
  dy?: number
}

export interface Settings {
  /** USD */
  dailyBudget: number | null
  /** USD */
  monthlyBudget: number | null
  currency: 'USD' | 'CNY'
  cnyRate: number
  quotaEnabled: boolean
  extraDirs: string[]
  launchAtLogin: boolean
  showMini: boolean
  miniPosition: MiniPlace | null
  theme: ThemeSetting
  quotaSource: QuotaSource
  /** local estimate: API-equivalent USD that equals 100% of the 5h window; null = learn from official data */
  local5hLimitUsd: number | null
  /** pause Claude Code tasks when the 5h window reaches `guardPauseAt` % and resume after reset */
  guardEnabled: boolean
  guardPauseAt: number
  /** keep a copy of parsed usage so history survives Claude Code's log cleanup */
  archiveEnabled: boolean
  motion: MotionLevel
  frameCap: FrameCap
  /** a small frame-rate meter in the corner of the main window */
  fpsMeter: boolean
  /** theme colour preset */
  accent: AccentKey
  backdrop: BackdropStyle
  /** backdrop colours follow the time of day, usage intensity and the 5h quota */
  adaptiveBackdrop: boolean
  /** 0.2–1, how strongly the backdrop shows */
  backdropVivid: number
  /** translucent frosted cards that let the backdrop through */
  glassCards: boolean
  /** light effects: rays, a glint across the cards on new usage, the pointer's glow, unlock bursts */
  lightFx: boolean
  windowMaterial: WindowMaterial
  miniMode: MiniMode
  /** 0.3–1 */
  miniOpacity: number
  /** 0.8–1.5 */
  miniScale: number
  /** clicks pass through the floating window */
  miniClickThrough: boolean
  /** a window docked to a screen edge slides out of sight while the pointer is away */
  miniEdgeHide: boolean
  /** sound effects (drips, chimes) */
  sound: boolean
  /** 0–1 */
  soundVolume: number
  /** USD per month; null = from the detected plan */
  planPrice: number | null
  telegramEnabled: boolean
  telegramToken: string
  telegramChatId: string
  pushGuard: boolean
  pushQuota: boolean
  pushBudget: boolean
  pushAchievement: boolean
  pushRunaway: boolean
  /** answer /status, /pause … from the configured chat */
  telegramCommands: boolean
  /** the button row under Telegram's input box: folds away after a tap, stays until folded, or none */
  telegramKeyboard: 'fold' | 'keep' | 'off'
  /** full-screen effects on celebrations and reactions to commands */
  telegramEffects: boolean
  /** the today card as an animation, animated quota alerts, replies that count up */
  telegramAnimations: boolean
  /** the evening report comes as a picture card */
  telegramCardReport: boolean
  /** a message pinned at the top of the chat that keeps the quota up to date */
  telegramBoard: boolean
  /** pushes arrive without a sound between these times ("HH:MM"); null = never */
  telegramQuietFrom: string | null
  telegramQuietTo: string | null
  /** daily report at reportTime ("HH:MM"); null = off */
  reportTime: string | null
  /** watch sessions for runaway token use */
  runawayDetect: boolean
  runawaySensitivity: 'low' | 'medium' | 'high'
  /** alert only, or also hold the runaway session */
  runawayAction: 'notify' | 'pause'
  /** dynamic-island capsule at the top of the screen */
  island: boolean
  /** refresh tasks: hold the queue */
  taskQueuePaused: boolean
  taskPermission: TaskPermission
  taskModel: string | null
  /** default working folder for new tasks (and Telegram /task) */
  taskCwd: string
  /** new tasks carry on from the folder's latest conversation */
  taskContinue: boolean
  /** new tasks may auto-compact */
  taskAutoCompact: boolean
  /** where new tasks compact; null = the CLI's own point */
  taskCompactAt: TaskCompactAt | null
  /** tasks run in a visible terminal window instead of hidden */
  taskTerminal: boolean
  /** new tasks try again on their own this many times after a failure */
  taskRetries: number
  /** new tasks stop a try after this many minutes; null = no limit */
  taskTimeoutMin: number | null
  /** defaults for new Codex tasks */
  codexTaskPermission: TaskPermission
  codexTaskModel: string | null
  pushTasks: boolean
  /** also read Codex (GPT) session logs from ~/.codex */
  codexEnabled: boolean
  /** read Codex's limits from the ChatGPT account every minute (TokenPulse's login, else Codex CLI's) */
  codexUsageApi: boolean
  /** follow Tibo's Codex reset announcements and hints (codex-resets.com) on the Codex overview */
  codexResetWatch: boolean
  /** a desktop notice (and a Telegram push with quota pushes) when Tibo announces or hints at a reset */
  codexResetNotify: boolean
  /** look for a new release each time TokenPulse starts and show what's new (downloading and installing wait for a click) */
  autoUpdate: boolean
  /** which tool the app shows: Claude, Codex, or both together */
  sourceFilter: SourceView
  /** theme pack in use; the colours, backdrop and fonts it set can still be changed one by one */
  themePack: ThemePack
  /** warn when a session's context grows large */
  contextAlert: boolean
  /** judge by each model's own window (70% / 88%); off = a fixed line of contextWarnK thousand tokens */
  contextAuto: boolean
  contextWarnK: number
  /** remind when a quota window is about to reset with much of it unused */
  wasteAlert: boolean
  /** how long before a 5h reset to remind, minutes */
  wasteLeadMin: number
  /** start the next queued refresh task early instead of letting the window go to waste */
  wasteRunTasks: boolean
  /** also pause at this 7-day percentage; null = off */
  guardWeeklyAt: number | null
  /** after a reset, only resume inside these local hours ("HH:MM"); null = any time */
  guardResumeFrom: string | null
  guardResumeTo: string | null
  /** a global hotkey toggles the floating window */
  globalHotkey: boolean
  /** Electron accelerator; falls back to the next free one in HOTKEYS when taken */
  hotkey: Hotkey
  /** the backdrop as a live desktop wallpaper behind the icons */
  wallpaper: boolean
  /** the place for sunrise, the moon and the sky map; null = guessed from the time zone */
  skyPlace: SkyPlace | null
  /** switch theme packs at sunrise and sunset */
  dayNight: boolean
  dayPack: ThemePack
  nightPack: ThemePack
}

/** When and where the usage happens */
export interface UsagePatterns {
  range: RangeKey
  /** tokens per hour of the day within the range */
  hours: number[]
  /** the last 30 days: tokens by weekday (Monday first) and hour */
  week: number[][]
  /** cost from project to model within the range, biggest first */
  flows: { project: string; model: string; cost: number; tokens: number }[]
  /** every token ever, and the average per active day over 30 days (the journey) */
  allTokens: number
  dailyAvg: number
  /** the last 120 days, oldest first (tree rings) */
  days: { t: number; tokens: number; cost: number; codex: number }[]
}

/** This week (or month) against the one before, as running totals since each began (the overview's race) */
export interface RaceSeries {
  kind: 'week' | 'month'
  start: number
  end: number
  prevStart: number
  /** steps in this period / the one before: hours through a week, days through a month */
  steps: number
  prevSteps: number
  /** running totals at the end of each step; this period only as far as now */
  cur: { tokens: number; cost: number }[]
  prev: { tokens: number; cost: number }[]
}

/** One step of a conversation as read back from its log */
export interface DialogueItem {
  kind: 'prompt' | 'reply' | 'tools' | 'compact'
  ts: number
  /** what was typed or answered */
  text?: string
  /** the text was too long and is cut */
  cut?: boolean
  /** the tools used between two messages, by name, most used first */
  tools?: { name: string; n: number }[]
}

export interface Dialogue {
  sessionId: string
  source: UsageSource
  items: DialogueItem[]
  /** earlier steps of a very long conversation left out */
  skipped: number
}

/** Every prompt of the last days, with its session (the star map) */
export interface StarMap {
  from: number
  to: number
  /** the days drawn: `asked`, or fewer when the records begin later */
  days: number
  asked: number
  /** the first record of all */
  since: number | null
  /** oldest first; texts shortened */
  prompts: PromptCost[]
  sessions: { id: string; project: string; source: UsageSource; first: number; last: number; cost: number; tokens: number; prompts: number }[]
  /** each model's share of the span, costliest first */
  models: { name: string; source: UsageSource; cost: number; tokens: number; requests: number }[]
  unattributedCost: number
}

export interface UpdateEvent {
  addedTokens: number
  addedCost: number
  at: number
}

export interface LoadState {
  loading: boolean
  files: number
  dirs: string[]
  /** Codex session folders read, and their file count */
  codexDirs?: string[]
  codexFiles?: number
}

/** A quota window about to reset with much of it unused */
export interface WasteAlert {
  key: string
  label: string
  source: UsageSource
  unused: number
  resetsAt: number
  /** a refresh task started early to use it */
  startedTask: string | null
}

export interface TokenPulseApi {
  getSummary(range: RangeKey): Promise<RangeSummary>
  getRanges(): Promise<RangeOverview>
  getRate(): Promise<RateStats>
  getGuard(): Promise<GuardState>
  installBridge(on: boolean): Promise<GuardState>
  onGuard(cb: (g: GuardState) => void): () => void
  getLive(): Promise<LiveStats>
  getSessions(): Promise<SessionRow[]>
  getPricing(): Promise<PricingInfo>
  refreshPricing(): Promise<PricingInfo>
  getQuota(): Promise<QuotaInfo>
  refreshQuota(): Promise<QuotaInfo>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getLoadState(): Promise<LoadState>
  showMain(): void
  toggleMini(show?: boolean): void
  /** the floating window's quick-settings menu */
  miniMenu(): void
  /** where a click-through window (floating window, island) still takes the pointer, in window coordinates */
  hotspot(r: { x: number; y: number; width: number; height: number } | null): void
  /** Claude's plan, ChatGPT's (Codex), or both added up */
  getValue(source?: SourceView): Promise<ValueReport>
  getForecast(source?: UsageSource): Promise<WeeklyForecast>
  getAchievements(): Promise<Achievement[]>
  /** the coding constellation and today's zodiac progress, for the tool on view */
  getSign(): Promise<CodingSign>
  /** hour-of-day, weekday and project → model patterns for a range */
  getPatterns(range: RangeKey): Promise<UsagePatterns>
  /** quota windows as stars and remnants, sessions as stars, you as a star */
  getCosmos(): Promise<Cosmos>
  /** this week or month against the one before, as running totals */
  getRace(kind: RaceSeries['kind']): Promise<RaceSeries>
  /** every prompt of the last `days` days, for the star map */
  getStarMap(days: number): Promise<StarMap>
  /** what each 5-hour window's quota bought, over `days` */
  getQuotaRates(days: number): Promise<QuotaRate[]>
  /** each tool on view: its 5-hour and 7-day windows with the usage in each */
  getQuotaCycles(): Promise<QuotaCycles[]>
  /** counts a use of an app feature (for achievements) */
  bumpCounter(name: 'palette'): void
  /** newly unlocked achievements */
  onAchievement(cb: (a: Achievement[]) => void): () => void
  /** saves a PNG data URL through a save dialog; resolves to the path or null */
  savePoster(dataUrl: string, name: string): Promise<string | null>
  copyPoster(dataUrl: string): Promise<void>
  telegramTest(): Promise<TelegramResult>
  telegramDetectChat(token: string): Promise<TelegramResult>
  hotkeyStatus(): Promise<HotkeyStatus>
  /** big-screen mode, on a second display when there is one */
  openStage(): void
  closeStage(): void
  /** hold / release every Claude Code task through the guard hook */
  setManualHold(on: boolean): Promise<GuardState>
  /** release held runaway sessions (all when omitted) */
  releaseSessions(sessionId?: string): Promise<GuardState>
  holdSession(sessionId: string): Promise<GuardState>
  getRunaway(): Promise<RunawayAlert[]>
  dismissRunaway(sessionId: string): void
  onRunaway(cb: (a: RunawayAlert[]) => void): () => void
  /** a command arrived from Telegram (shown on the island) */
  onRemote(cb: (r: { command: string; reply: string }) => void): () => void
  /** the island takes the mouse while hovered, and lets clicks through otherwise */
  islandInteractive(on: boolean): void
  islandMenu(): void
  sendReport(): Promise<TelegramResult>
  getTasks(): Promise<TaskQueueState>
  addTask(input: TaskInput): Promise<ScheduledTask>
  taskAction(id: string, action: TaskAction): Promise<TaskQueueState>
  /** change a task that is not running; `then` queues it again: now, or at the next refresh */
  updateTask(id: string, patch: TaskPatch, then?: 'keep' | 'now' | 'reset'): Promise<TaskQueueState>
  /** removes finished, failed and cancelled tasks of one tool (or both) */
  clearTaskHistory(tool: SourceView): Promise<TaskQueueState>
  /** reorder the queue or make a task another one's subtask */
  moveTask(id: string, target: string | null, how: TaskMove): Promise<TaskQueueState>
  taskLog(id: string): Promise<TaskLogLine[]>
  onTasks(cb: (s: TaskQueueState) => void): () => void
  pickFolder(): Promise<string | null>
  getCodexQuota(): Promise<CodexQuota | null>
  onCodexQuota(cb: (q: CodexQuota | null) => void): () => void
  /** pace of the quota windows of the tools on view */
  getPace(): Promise<Pace[]>
  getCacheReport(range: RangeKey): Promise<CacheReport>
  /** the most expensive prompts in a range */
  getPrompts(range: RangeKey): Promise<PromptReport>
  getSessionContext(sessionId: string): Promise<SessionContext | null>
  /** a session's conversation read from its log: prompts, answers, tools */
  getDialogue(sessionId: string): Promise<Dialogue | null>
  getContextAlerts(): Promise<ContextAlert[]>
  onContextAlert(cb: (a: ContextAlert) => void): () => void
  /** past 5-hour windows: peaks, hits and how long they took */
  getWindowHistory(days: number): Promise<WindowHistory>
  onWaste(cb: (w: WasteAlert) => void): () => void
  setThemeColors(colors: { bg: string; fg: string }): void
  /** the pixels under the title-bar buttons: average, darkest tenth and brightest tenth (RGB), and the share that is opaque */
  titleCorner(): Promise<TitleCorner | null>
  getTarot(): Promise<TarotDeck>
  getCalendar(): Promise<CalendarDay[]>
  getTimeline(): Promise<SessionSpan[]>
  getModelRows(range: RangeKey): Promise<ModelRow[]>
  getActions(range: RangeKey): Promise<ActionStats>
  getRecords(): Promise<PersonalRecords>
  codexUsageState(): Promise<CodexUsageState>
  codexSignIn(): Promise<{ ok: boolean; error?: string; email?: string | null }>
  codexSignOut(): Promise<void>
  codexUsageRefresh(): Promise<CodexUsageState>
  onCodexUsage(cb: (s: CodexUsageState) => void): () => void
  /** Tibo's reset announcements, with what each did to the user's own Codex week */
  getCodexResets(): Promise<CodexResets>
  refreshCodexResets(): Promise<CodexResets>
  onCodexResets(cb: (r: CodexResets) => void): () => void
  updateState(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  updateDownload(): Promise<UpdateState>
  updateInstall(): Promise<boolean>
  onAppUpdate(cb: (s: UpdateState) => void): () => void
  /** opens an http(s) link in the browser */
  openExternal(url: string): Promise<void>
  /** the refresh rate of the display the window is on (0 when unknown) */
  displayHz(): Promise<number>
  onUpdate(cb: (e: UpdateEvent) => void): () => void
  onQuota(cb: (q: QuotaInfo) => void): () => void
  onPricing(cb: (p: PricingInfo) => void): () => void
  onSettings(cb: (s: Settings) => void): () => void
  onLoadState(cb: (s: LoadState) => void): () => void
}
