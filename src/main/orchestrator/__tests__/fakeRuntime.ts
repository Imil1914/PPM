import type {
  AiChatResult,
  BoardNodeSpec,
  HumanDecision,
  NodeRegistryEntry,
  NodeRequirements,
  PaperLite,
  Runtime,
  StatusEvent,
  TaskResult,
  TraceDraft
} from '../contracts'

type AiChatArgs = Parameters<Runtime['aiChat']>[0]
type HumanRequestArgs = Parameters<Runtime['humanRequest']>[0]
type SpawnSubArgs = Parameters<Runtime['spawnSub']>[0]
type PapersSearchArgs = Parameters<Runtime['papersSearch']>[0]
type PapersPdfArgs = Parameters<Runtime['papersPdf']>[0]
type AnythingIngestArgs = Parameters<Runtime['anythingIngest']>[0]
type WebLLMAskArgs = Parameters<Runtime['webLLMAsk']>[0]
type RuntimeStatus = Parameters<Runtime['status']>[0]

export type FakeVaultSeed = {
  content: string
  metadata?: Record<string, unknown>
}

type FakeVaultEntry = {
  content: string
  metadata?: Record<string, unknown>
}

type FakeProjectState = {
  vault: Map<string, FakeVaultEntry>
  logs: Map<string, unknown[]>
  cancelled: boolean
  cancellationReason?: string
  idCounters: Map<string, number>
}

export class FakeRuntimeBackend {
  private readonly projects = new Map<string, FakeProjectState>()

  constructor(readonly idSeed = 0) {}

  project(projectId: string): FakeProjectState {
    let state = this.projects.get(projectId)
    if (!state) {
      state = {
        vault: new Map(),
        logs: new Map(),
        cancelled: false,
        idCounters: new Map()
      }
      this.projects.set(projectId, state)
    }
    return state
  }
}

export type FakeEffectStep<TArgs, TResult> = {
  readonly kind: 'fake_effect'
  match?: (args: TArgs) => boolean
  respond: TResult | Error | ((args: TArgs) => TResult | Promise<TResult>)
}

type FakeQueuedEffect<TArgs, TResult> = TResult | Error | FakeEffectStep<TArgs, TResult>

export function fakeEffect<TArgs, TResult>(
  respond: FakeEffectStep<TArgs, TResult>['respond'],
  match?: FakeEffectStep<TArgs, TResult>['match']
): FakeEffectStep<TArgs, TResult> {
  return { kind: 'fake_effect', respond, match }
}

export class UnexpectedFakeRuntimeCall extends Error {
  constructor(
    readonly method: string,
    readonly args: unknown,
    reason = 'effect is not scripted'
  ) {
    super(`Unexpected FakeRuntime call: ${method} (${reason}); args=${safeJson(args)}`)
    this.name = 'UnexpectedFakeRuntimeCall'
  }
}

export type FakeRuntimeOptions = {
  projectId?: string
  depth?: number
  backend?: FakeRuntimeBackend
  idSeed?: number
  cancelled?: boolean
  initialVault?: Record<string, string | FakeVaultSeed>
}

type FakeRuntimeMethod =
  | 'aiChat'
  | 'vaultWrite'
  | 'vaultRead'
  | 'vaultReadMany'
  | 'vaultQuery'
  | 'vaultAppendLog'
  | 'findCandidates'
  | 'trace'
  | 'status'
  | 'humanRequest'
  | 'spawnSub'
  | 'papersSearch'
  | 'papersPdf'
  | 'anythingEnsure'
  | 'anythingIngest'
  | 'boardCreateNodes'
  | 'webLLMAsk'
  | 'isCancelled'
  | 'newId'

export type FakeRuntimeOrderedCall = {
  sequence: number
  method: FakeRuntimeMethod
  args: unknown
}

export class FakeRuntime implements Runtime {
  readonly projectId: string
  readonly depth: number
  readonly backend: FakeRuntimeBackend

  readonly traces: TraceDraft[] = []
  readonly statuses: RuntimeStatus[] = []
  readonly boardNodes: BoardNodeSpec[] = []
  readonly orderedCalls: FakeRuntimeOrderedCall[] = []
  readonly unexpectedCalls: UnexpectedFakeRuntimeCall[] = []

  readonly calls = {
    aiChat: [] as AiChatArgs[],
    vaultWrite: [] as Array<{ key: string; content: string; metadata?: Record<string, unknown> }>,
    vaultRead: [] as string[],
    vaultReadMany: [] as string[][],
    vaultQuery: [] as Array<{ query: string; filters?: Record<string, unknown> }>,
    vaultAppendLog: [] as Array<{ taskId: string; event: unknown }>,
    findCandidates: [] as NodeRequirements[],
    trace: [] as TraceDraft[],
    status: [] as RuntimeStatus[],
    humanRequest: [] as HumanRequestArgs[],
    spawnSub: [] as SpawnSubArgs[],
    papersSearch: [] as PapersSearchArgs[],
    papersPdf: [] as PapersPdfArgs[],
    anythingEnsure: [] as Array<Record<string, never>>,
    anythingIngest: [] as AnythingIngestArgs[],
    boardCreateNodes: [] as BoardNodeSpec[][],
    webLLMAsk: [] as WebLLMAskArgs[],
    isCancelled: [] as boolean[],
    newId: [] as Array<{ prefix: string; id: string }>
  }

  private sequence = 0
  private modelTokens = 0
  private modelCalls = 0

  private readonly aiChatQueue: Array<FakeQueuedEffect<AiChatArgs, AiChatResult>> = []
  private readonly candidatesQueue: Array<
    FakeQueuedEffect<NodeRequirements, NodeRegistryEntry[]>
  > = []
  private readonly vaultQueryQueue: Array<
    FakeQueuedEffect<{ query: string; filters?: Record<string, unknown> }, string[]>
  > = []
  private readonly humanQueue: Array<FakeQueuedEffect<HumanRequestArgs, HumanDecision>> = []
  private readonly spawnQueue: Array<FakeQueuedEffect<SpawnSubArgs, TaskResult>> = []
  private readonly papersSearchQueue: Array<
    FakeQueuedEffect<PapersSearchArgs, PaperLite[]>
  > = []
  private readonly papersPdfQueue: Array<
    FakeQueuedEffect<PapersPdfArgs, { ok: boolean; base64?: string }>
  > = []
  private readonly anythingEnsureQueue: Array<FakeQueuedEffect<void, boolean>> = []
  private readonly anythingIngestQueue: Array<
    FakeQueuedEffect<AnythingIngestArgs, { ok: boolean; location?: string }>
  > = []
  private readonly boardCreateNodesQueue: Array<
    FakeQueuedEffect<BoardNodeSpec[], void>
  > = []
  private readonly webLLMQueue: Array<
    FakeQueuedEffect<WebLLMAskArgs, { ok: boolean; text: string; provider?: string }>
  > = []

  constructor(options: FakeRuntimeOptions = {}) {
    this.projectId = options.projectId ?? 'fixture-project'
    this.depth = options.depth ?? 0
    this.backend = options.backend ?? new FakeRuntimeBackend(options.idSeed)

    if (options.cancelled) this.cancel('initial')
    for (const [key, value] of Object.entries(options.initialVault ?? {})) {
      this.seedVault(key, typeof value === 'string' ? { content: value } : value)
    }
  }

  queueAiChat(...effects: Array<FakeQueuedEffect<AiChatArgs, AiChatResult>>): this {
    this.aiChatQueue.push(...effects)
    return this
  }

  queueCandidates(
    ...effects: Array<FakeQueuedEffect<NodeRequirements, NodeRegistryEntry[]>>
  ): this {
    this.candidatesQueue.push(...effects)
    return this
  }

  queueVaultQuery(
    ...effects: Array<
      FakeQueuedEffect<{ query: string; filters?: Record<string, unknown> }, string[]>
    >
  ): this {
    this.vaultQueryQueue.push(...effects)
    return this
  }

  queueHuman(...effects: Array<FakeQueuedEffect<HumanRequestArgs, HumanDecision>>): this {
    this.humanQueue.push(...effects)
    return this
  }

  queueSpawnSub(...effects: Array<FakeQueuedEffect<SpawnSubArgs, TaskResult>>): this {
    this.spawnQueue.push(...effects)
    return this
  }

  queuePapersSearch(...effects: Array<FakeQueuedEffect<PapersSearchArgs, PaperLite[]>>): this {
    this.papersSearchQueue.push(...effects)
    return this
  }

  queuePapersPdf(
    ...effects: Array<FakeQueuedEffect<PapersPdfArgs, { ok: boolean; base64?: string }>>
  ): this {
    this.papersPdfQueue.push(...effects)
    return this
  }

  queueAnythingEnsure(...effects: Array<FakeQueuedEffect<void, boolean>>): this {
    this.anythingEnsureQueue.push(...effects)
    return this
  }

  queueAnythingIngest(
    ...effects: Array<
      FakeQueuedEffect<AnythingIngestArgs, { ok: boolean; location?: string }>
    >
  ): this {
    this.anythingIngestQueue.push(...effects)
    return this
  }

  queueBoardCreateNodes(...effects: Array<FakeQueuedEffect<BoardNodeSpec[], void>>): this {
    this.boardCreateNodesQueue.push(...effects)
    return this
  }

  allowBoardCreateNodes(times = 1): this {
    for (let index = 0; index < times; index += 1) this.boardCreateNodesQueue.push(undefined)
    return this
  }

  queueWebLLMAsk(
    ...effects: Array<
      FakeQueuedEffect<WebLLMAskArgs, { ok: boolean; text: string; provider?: string }>
    >
  ): this {
    this.webLLMQueue.push(...effects)
    return this
  }

  seedVault(key: string, entry: FakeVaultSeed): this {
    this.assertWritableKey(key)
    this.state().vault.set(key, cloneFixture(entry))
    return this
  }

  cancel(reason = 'test'): void {
    const state = this.state()
    if (state.cancelled) return
    state.cancelled = true
    state.cancellationReason = reason
  }

  cancellationReason(): string | undefined {
    return this.state().cancellationReason
  }

  modelUsage(): { tokens: number; calls: number } {
    return { tokens: this.modelTokens, calls: this.modelCalls }
  }

  vaultSnapshot(): Record<string, FakeVaultSeed> {
    return Object.fromEntries(
      [...this.state().vault.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, cloneFixture(value)])
    )
  }

  taskLog(taskId: string): unknown[] {
    return cloneFixture(this.state().logs.get(taskId) ?? [])
  }

  pendingFixtures(): Record<string, number> {
    return {
      aiChat: this.aiChatQueue.length,
      vaultQuery: this.vaultQueryQueue.length,
      findCandidates: this.candidatesQueue.length,
      humanRequest: this.humanQueue.length,
      spawnSub: this.spawnQueue.length,
      papersSearch: this.papersSearchQueue.length,
      papersPdf: this.papersPdfQueue.length,
      anythingEnsure: this.anythingEnsureQueue.length,
      anythingIngest: this.anythingIngestQueue.length,
      boardCreateNodes: this.boardCreateNodesQueue.length,
      webLLMAsk: this.webLLMQueue.length
    }
  }

  clearUnexpectedCalls(): void {
    this.unexpectedCalls.length = 0
  }

  verify(): void {
    if (this.unexpectedCalls.length) {
      throw new Error(
        `FakeRuntime observed unexpected calls: ${this.unexpectedCalls
          .map((error) => error.method)
          .join(', ')}`
      )
    }
    const pending = Object.entries(this.pendingFixtures()).filter(([, count]) => count > 0)
    if (pending.length) {
      throw new Error(
        `FakeRuntime has unused fixtures: ${pending
          .map(([method, count]) => `${method}=${count}`)
          .join(', ')}`
      )
    }
  }

  async aiChat(args: AiChatArgs): Promise<AiChatResult> {
    const recorded = cloneFixture(args)
    this.calls.aiChat.push(recorded)
    this.record('aiChat', recorded)
    const result = await this.takeEffect('aiChat', this.aiChatQueue, args)
    this.modelCalls += 1
    if (result.ok) this.modelTokens += result.totalTokens
    return cloneFixture(result)
  }

  async vaultWrite(
    key: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const call = cloneFixture({ key, content, metadata })
    this.calls.vaultWrite.push(call)
    this.record('vaultWrite', call)
    this.assertWritableKey(key)
    this.state().vault.set(key, cloneFixture({ content, metadata }))
    return key
  }

  async vaultRead(key: string): Promise<string | null> {
    this.calls.vaultRead.push(key)
    this.record('vaultRead', key)
    if (this.isForeignProjectKey(key)) return null
    return this.state().vault.get(key)?.content ?? null
  }

  async vaultReadMany(keys: string[]): Promise<Record<string, string>> {
    const recorded = [...keys]
    this.calls.vaultReadMany.push(recorded)
    this.record('vaultReadMany', recorded)
    const result: Record<string, string> = {}
    for (const key of keys) {
      if (this.isForeignProjectKey(key)) continue
      const value = this.state().vault.get(key)
      if (value) result[key] = value.content
    }
    return result
  }

  async vaultQuery(query: string, filters?: Record<string, unknown>): Promise<string[]> {
    const call = cloneFixture({ query, filters })
    this.calls.vaultQuery.push(call)
    this.record('vaultQuery', call)
    return cloneFixture(
      await this.takeEffect('vaultQuery', this.vaultQueryQueue, { query, filters })
    )
  }

  async vaultAppendLog(taskId: string, event: unknown): Promise<void> {
    const call = cloneFixture({ taskId, event })
    this.calls.vaultAppendLog.push(call)
    this.record('vaultAppendLog', call)
    const events = this.state().logs.get(taskId) ?? []
    events.push(cloneFixture(event))
    this.state().logs.set(taskId, events)
  }

  async findCandidates(req: NodeRequirements): Promise<NodeRegistryEntry[]> {
    const recorded = cloneFixture(req)
    this.calls.findCandidates.push(recorded)
    this.record('findCandidates', recorded)
    return cloneFixture(
      await this.takeEffect('findCandidates', this.candidatesQueue, req)
    )
  }

  trace(entry: TraceDraft): void {
    const recorded = cloneFixture(entry)
    this.traces.push(recorded)
    this.calls.trace.push(recorded)
    this.record('trace', recorded)
  }

  status(event: Omit<StatusEvent, 'project_id' | 'depth'>): void {
    const recorded = cloneFixture(event)
    this.statuses.push(recorded)
    this.calls.status.push(recorded)
    this.record('status', recorded)
  }

  async humanRequest(req: HumanRequestArgs): Promise<HumanDecision> {
    const recorded = cloneFixture(req)
    this.calls.humanRequest.push(recorded)
    this.record('humanRequest', recorded)
    return cloneFixture(await this.takeEffect('humanRequest', this.humanQueue, req))
  }

  async spawnSub(args: SpawnSubArgs): Promise<TaskResult> {
    const recorded = cloneFixture(args)
    this.calls.spawnSub.push(recorded)
    this.record('spawnSub', recorded)
    return cloneFixture(await this.takeEffect('spawnSub', this.spawnQueue, args))
  }

  async papersSearch(args: PapersSearchArgs): Promise<PaperLite[]> {
    const recorded = cloneFixture(args)
    this.calls.papersSearch.push(recorded)
    this.record('papersSearch', recorded)
    return cloneFixture(await this.takeEffect('papersSearch', this.papersSearchQueue, args))
  }

  async papersPdf(args: PapersPdfArgs): Promise<{ ok: boolean; base64?: string }> {
    const recorded = cloneFixture(args)
    this.calls.papersPdf.push(recorded)
    this.record('papersPdf', recorded)
    return cloneFixture(await this.takeEffect('papersPdf', this.papersPdfQueue, args))
  }

  async anythingEnsure(): Promise<boolean> {
    const recorded = {}
    this.calls.anythingEnsure.push(recorded)
    this.record('anythingEnsure', recorded)
    return this.takeEffect('anythingEnsure', this.anythingEnsureQueue, undefined)
  }

  async anythingIngest(
    args: AnythingIngestArgs
  ): Promise<{ ok: boolean; location?: string }> {
    const recorded = cloneFixture(args)
    this.calls.anythingIngest.push(recorded)
    this.record('anythingIngest', recorded)
    return cloneFixture(
      await this.takeEffect('anythingIngest', this.anythingIngestQueue, args)
    )
  }

  async boardCreateNodes(nodes: BoardNodeSpec[]): Promise<void> {
    const recorded = cloneFixture(nodes)
    this.calls.boardCreateNodes.push(recorded)
    this.record('boardCreateNodes', recorded)
    await this.takeEffect('boardCreateNodes', this.boardCreateNodesQueue, nodes)
    this.boardNodes.push(...recorded)
  }

  async webLLMAsk(
    args: WebLLMAskArgs
  ): Promise<{ ok: boolean; text: string; provider?: string }> {
    const recorded = cloneFixture(args)
    this.calls.webLLMAsk.push(recorded)
    this.record('webLLMAsk', recorded)
    return cloneFixture(await this.takeEffect('webLLMAsk', this.webLLMQueue, args))
  }

  isCancelled(): boolean {
    const cancelled = this.state().cancelled
    this.calls.isCancelled.push(cancelled)
    this.record('isCancelled', {})
    return cancelled
  }

  newId(prefix: string): string {
    const state = this.state()
    const next = (state.idCounters.get(prefix) ?? this.backend.idSeed) + 1
    state.idCounters.set(prefix, next)
    const id = `${prefix}_${this.projectId}_${next}`
    const call = { prefix, id }
    this.calls.newId.push(call)
    this.record('newId', { prefix })
    return id
  }

  private state(): FakeProjectState {
    return this.backend.project(this.projectId)
  }

  private record(method: FakeRuntimeMethod, args: unknown): void {
    this.sequence += 1
    this.orderedCalls.push({ sequence: this.sequence, method, args: cloneFixture(args) })
  }

  private async takeEffect<TArgs, TResult>(
    method: string,
    queue: Array<FakeQueuedEffect<TArgs, TResult>>,
    args: TArgs
  ): Promise<TResult> {
    const index = queue.findIndex((item) => !isEffectStep(item) || !item.match || item.match(args))
    if (index < 0) throw this.unexpected(method, args, queue.length ? 'no fixture matched' : 'fixture queue is empty')

    const [item] = queue.splice(index, 1)
    const response = isEffectStep<TArgs, TResult>(item) ? item.respond : item
    if (response instanceof Error) throw response
    if (typeof response === 'function') {
      return (response as (value: TArgs) => TResult | Promise<TResult>)(args)
    }
    return response as TResult
  }

  private unexpected(method: string, args: unknown, reason: string): UnexpectedFakeRuntimeCall {
    const error = new UnexpectedFakeRuntimeCall(method, cloneFixture(args), reason)
    this.unexpectedCalls.push(error)
    return error
  }

  private assertWritableKey(key: string): void {
    if (!this.isForeignProjectKey(key)) return
    throw this.unexpected('vaultWrite', { key }, 'foreign project key')
  }

  private isForeignProjectKey(key: string): boolean {
    const match = /^project:([^/]+)\//.exec(key)
    return Boolean(match && match[1] !== this.projectId)
  }
}

function isEffectStep<TArgs, TResult>(
  value: FakeQueuedEffect<TArgs, TResult>
): value is FakeEffectStep<TArgs, TResult> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'fake_effect'
  )
}

function cloneFixture<T>(value: T): T {
  if (value === undefined || value === null) return value
  return structuredClone(value)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}
