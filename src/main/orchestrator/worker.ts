// ============================================================================
// Worker-оркестратор. Исполняет ОДИН оркестратор (root или саб). Не знает про
// провайдеров/Vault напрямую — всё через Runtime-прокси к main-брокеру
// (parentPort). Так вся safety (бюджет/глубина/отмена) централизована в main.
// ============================================================================
import { parentPort, workerData } from 'worker_threads'
import type {
  Runtime,
  WorkerData,
  WorkerToMain,
  MainToWorker,
  AiChatResult,
  NodeRegistryEntry,
  NodeRequirements,
  TaskResult,
  Budget,
  TraceDraft,
  StatusEvent,
  HumanDecision,
  ChatMessage
} from './contracts'
import { orchestrateWorkflowProfile } from './profiles'
import { stampTraceEntry, toOrchestrateOpts } from './profilePropagation'

const wd = workerData as WorkerData
const port = parentPort!
const cancelView = new Int32Array(wd.cancelBuf)

// Корреляция req/res по reqId.
type Resolver = (m: MainToWorker) => void
const pending = new Map<string, Resolver>()
let counter = 0
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${counter++}`
}
function post(m: WorkerToMain): void {
  port.postMessage(m)
}
// Отправить запрос и дождаться ответа нужного типа.
function request<T>(build: (reqId: string) => WorkerToMain, pick: (m: MainToWorker) => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const reqId = newId('r')
    pending.set(reqId, (m) => resolve(pick(m)))
    post(build(reqId))
  })
}

port.on('message', (m: MainToWorker) => {
  const r = pending.get(m.reqId)
  if (r) {
    pending.delete(m.reqId)
    r(m)
  }
})

// --- Runtime-прокси ---
const rt: Runtime = {
  projectId: wd.projectId,
  depth: wd.depth,
  aiChat: (args) =>
    request<AiChatResult>(
      (reqId) => ({
        t: 'aiChat',
        reqId,
        model: args.model,
        messages: args.messages as ChatMessage[],
        images: args.images,
        timeoutMs: args.timeoutMs
      }),
      (m) => (m.t === 'aiChatRes' ? m.res : { ok: false, error: 'bad response' })
    ),
  vaultWrite: (key, content, metadata) =>
    request<string>(
      (reqId) => ({ t: 'vaultWrite', reqId, key, content, metadata }),
      (m) => (m.t === 'vaultWriteRes' ? m.key : key)
    ),
  vaultRead: (key) =>
    request<string | null>(
      (reqId) => ({ t: 'vaultRead', reqId, key }),
      (m) => (m.t === 'vaultReadRes' ? m.content : null)
    ),
  vaultReadMany: (keys) =>
    request<Record<string, string>>(
      (reqId) => ({ t: 'vaultReadMany', reqId, keys }),
      (m) => (m.t === 'vaultReadManyRes' ? m.map : {})
    ),
  vaultQuery: (query, filters) =>
    request<string[]>(
      (reqId) => ({ t: 'vaultQuery', reqId, query, filters }),
      (m) => (m.t === 'vaultQueryRes' ? m.keys : [])
    ),
  vaultAppendLog: (taskId, event) =>
    request<void>(
      (reqId) => ({ t: 'vaultAppendLog', reqId, taskId, event }),
      () => undefined
    ),
  findCandidates: (req: NodeRequirements) =>
    request<NodeRegistryEntry[]>(
      (reqId) => ({ t: 'findCandidates', reqId, req }),
      (m) => (m.t === 'findCandidatesRes' ? m.entries : [])
    ),
  trace: (entry: TraceDraft) => post({ t: 'trace', entry: stampTraceEntry(entry, wd.workflowProfile) }),
  status: (ev: Omit<StatusEvent, 'project_id' | 'depth'>) => post({ t: 'status', ev }),
  humanRequest: (req) =>
    request<HumanDecision>(
      (reqId) => ({
        t: 'humanRequest',
        reqId,
        taskId: req.task_id,
        reason: req.reason,
        best_output_key: req.best_output_key,
        best_summary: req.best_summary
      }),
      (m) => (m.t === 'humanRequestRes' ? m.decision : { decision: 'reject' })
    ),
  spawnSub: (args: { goal: string; budget: Budget; materials: string[] }) =>
    request<TaskResult>(
      (reqId) => ({ t: 'spawnSub', reqId, goal: args.goal, budget: args.budget, materials: args.materials }),
      (m) =>
        m.t === 'spawnSubRes'
          ? m.result
          : {
              task_id: 'sub',
              status: 'failure',
              output_vault_key: '',
              summary: 'sub-оркестратор не вернул результат',
              confidence: 0,
              cost_spent: { tokens: 0, calls: 0 },
              issues: ['spawnSub failed']
            }
    ),
  papersSearch: (args) =>
    request(
      (reqId) => ({ t: 'papersSearch', reqId, args }),
      (m) => (m.t === 'papersSearchRes' ? m.papers : [])
    ),
  papersPdf: (args) =>
    request(
      (reqId) => ({ t: 'papersPdf', reqId, args }),
      (m) => (m.t === 'papersPdfRes' ? m.res : { ok: false })
    ),
  anythingEnsure: () =>
    request(
      (reqId) => ({ t: 'anythingEnsure', reqId }),
      (m) => (m.t === 'anythingEnsureRes' ? m.running : false)
    ),
  anythingIngest: (args) =>
    request(
      (reqId) => ({ t: 'anythingIngest', reqId, args }),
      (m) => (m.t === 'anythingIngestRes' ? m.res : { ok: false })
    ),
  boardCreateNodes: (nodes) =>
    request(
      (reqId) => ({ t: 'boardCreateNodes', reqId, nodes }),
      () => undefined
    ),
  webLLMAsk: (args) =>
    request(
      (reqId) => ({ t: 'webLLMAsk', reqId, prompt: args.prompt, target: args.target, provider: args.provider, timeoutMs: args.timeoutMs }),
      (m) => (m.t === 'webLLMAskRes' ? m.res : { ok: false, text: '' })
    ),
  isCancelled: () => Atomics.load(cancelView, 0) !== 0,
  newId
}

// --- Точка входа ---
;(async () => {
  try {
    const result = await orchestrateWorkflowProfile(rt, toOrchestrateOpts(wd))
    post({ t: 'result', result })
  } catch (e) {
    post({
      t: 'result',
      result: {
        task_id: 'root',
        status: 'failure',
        output_vault_key: '',
        summary: `Сбой оркестратора: ${(e as Error).message}`,
        confidence: 0,
        cost_spent: { tokens: 0, calls: 0 },
        issues: [(e as Error).message]
      }
    })
  }
})()
