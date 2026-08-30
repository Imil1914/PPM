// ============================================================================
// Брокер оркестратора (main). Владелец ресурсов и посредник:
//  - спавнит воркеры (root И каждый саб-оркестратор — плоско, все дети main);
//  - исполняет их запросы: модельные вызовы (мастер-бюджет), Vault, реестр,
//    рекурсию (с hard-stop по глубине), human-in-the-loop;
//  - пробрасывает трейс/статусы/human-запросы в renderer.
// Движок и режимы живут в воркере и общаются с брокером только сообщениями.
// ============================================================================
import { ipcMain, type WebContents } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import {
  vaultWrite,
  vaultRead,
  vaultReadMany,
  vaultQuery,
  vaultAppendLog,
  vaultReadLog,
  vaultEvict
} from './vault'
import { findCandidates, getRegistry, upsertNode } from './registry'
import { BudgetManager, deriveSubBudget } from './budget'
import { parseOrchestratorStartInput } from './startInput'
import {
  createChildWorkerLaunchData,
  createRunStartedTraceEntry,
  createWorkerData,
  type WorkerLaunchData
} from './profilePropagation'
import {
  DEFAULT_BUDGET,
  type Budget,
  type TaskResult,
  type WorkerToMain,
  type MainToWorker,
  type WorkerData,
  type HumanDecision,
  type PaperLite
} from './contracts'

type Deps = {
  callModel: (args: {
    model: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    images?: string[]
    timeoutMs?: number
  }) => Promise<{ ok: true; content: string; totalTokens: number } | { ok: false; error: string }>
  getDefaultModel: () => string
  // Инструменты ресерча (скилл lecture-forge)
  papersSearch: (args: { query: string; yearFrom?: number; yearTo?: number; limit?: number }) => Promise<PaperLite[]>
  papersPdf: (args: { doi?: string; pdfUrl?: string; source?: string }) => Promise<{ ok: boolean; base64?: string }>
  anythingEnsure: () => Promise<boolean>
  anythingIngest: (args: { base64: string; name: string }) => Promise<{ ok: boolean; location?: string }>
}

// Значения cancelBuf[0]: 0 — работаем, 1 — отмена пользователем, 2 — стоп по бюджету
type RunState = {
  projectId: string
  sender: WebContents
  budget: BudgetManager
  cancelBuf: SharedArrayBuffer
  workers: Set<Worker>
  humanResolvers: Map<string, (d: HumanDecision) => void>
  // Ожидающие ответа веб-чата (мост в renderer → webview → обратно).
  webLLMResolvers: Map<string, (res: { ok: boolean; text: string; provider?: string }) => void>
  subCounter: number // для уникальных branch-префиксов саб-оркестраторов
  finished: boolean
}

const runs = new Map<string, RunState>()
let deps: Deps

function workerPath(): string {
  // out/main/orchestratorWorker.js — второй вход electron-vite (см. конфиг).
  return join(__dirname, 'orchestratorWorker.js')
}

function send(run: RunState, channel: string, payload: unknown): void {
  try {
    if (!run.sender.isDestroyed()) run.sender.send(channel, payload)
  } catch {
    /* окно закрыто — не критично */
  }
}

function setCancel(run: RunState, value: number): void {
  new Int32Array(run.cancelBuf)[0] = value
}

// Грубая оценка токенов, если провайдер не вернул usage.
function estTokens(messages: Array<{ content: string }>, content: string): number {
  const chars = messages.reduce((n, m) => n + (m.content?.length || 0), 0) + (content?.length || 0)
  return Math.ceil(chars / 4)
}

// Обёртка над одним воркером (root или саб). Возвращает его финальный TaskResult.
function spawnWorker(run: RunState, wd: WorkerLaunchData): Promise<TaskResult> {
  return new Promise<TaskResult>((resolve) => {
    const fullWd = createWorkerData({ projectId: run.projectId, cancelBuf: run.cancelBuf }, wd)
    const startedEntry = createRunStartedTraceEntry({
      projectId: run.projectId,
      branch: wd.branch,
      depth: wd.depth,
      workflowProfile: wd.workflowProfile
    })
    vaultAppendLog(run.projectId, startedEntry.task_id, { kind: 'trace', ...startedEntry })
    send(run, 'orch:trace', { projectId: run.projectId, entry: startedEntry })
    let worker: Worker
    try {
      worker = new Worker(workerPath(), { workerData: fullWd })
    } catch (e) {
      resolve(failResult(wd.goal, `worker spawn: ${(e as Error).message}`))
      return
    }
    run.workers.add(worker)
    let settled = false
    const done = (r: TaskResult): void => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    const reply = (m: MainToWorker): void => {
      try {
        worker.postMessage(m)
      } catch {
        /* worker уже мёртв */
      }
    }

    worker.on('message', async (msg: WorkerToMain) => {
      try {
        await handleWorkerMessage(run, wd, msg, reply, done)
      } catch (e) {
        // защищаемся: сбой обработчика не должен вешать ветку
        console.error('[orch] message handler error', e)
      }
    })
    worker.on('error', (e) => done(failResult(wd.goal, `worker error: ${e.message}`)))
    worker.on('exit', () => {
      run.workers.delete(worker)
      // Воркер вышел, не прислав result (отмена/бюджет/краш) → отдаём эскалацию.
      const buf = new Int32Array(run.cancelBuf)[0]
      done(
        buf === 1
          ? { ...failResult(wd.goal, 'отменено пользователем'), status: 'failure' }
          : buf === 2
            ? { ...failResult(wd.goal, 'исчерпан бюджет проекта'), status: 'needs_human_review' }
            : failResult(wd.goal, 'воркер завершился без результата')
      )
    })
  })
}

function failResult(goal: string, issue: string): TaskResult {
  return {
    task_id: 'root',
    status: 'failure',
    output_vault_key: '',
    summary: `Не удалось: ${issue}`,
    confidence: 0,
    cost_spent: { tokens: 0, calls: 0 },
    issues: [issue]
  }
}

// Централизованная обработка запросов воркера.
async function handleWorkerMessage(
  run: RunState,
  wd: WorkerLaunchData,
  msg: WorkerToMain,
  reply: (m: MainToWorker) => void,
  done: (r: TaskResult) => void
): Promise<void> {
  switch (msg.t) {
    case 'aiChat': {
      // Hard-stop по бюджету (раздел 6 ТЗ) — не молчаливое обрезание.
      if (!run.budget.canSpend()) {
        setCancel(run, 2)
        reply({ t: 'aiChatRes', reqId: msg.reqId, res: { ok: false, error: 'budget_exceeded' } })
        return
      }
      const r = await deps.callModel({
        model: msg.model || deps.getDefaultModel(),
        messages: msg.messages,
        images: msg.images,
        timeoutMs: msg.timeoutMs
      })
      const used = r.ok ? r.totalTokens || estTokens(msg.messages, r.content) : estTokens(msg.messages, '')
      const alerts = run.budget.charge(used, 1)
      if (alerts.crossed80) send(run, 'orch:status', budgetAlert(run, 80))
      if (alerts.crossed100) {
        setCancel(run, 2)
        send(run, 'orch:status', budgetAlert(run, 100))
      }
      reply({ t: 'aiChatRes', reqId: msg.reqId, res: r })
      return
    }
    case 'vaultWrite':
      reply({ t: 'vaultWriteRes', reqId: msg.reqId, key: vaultWrite(msg.key, msg.content, msg.metadata) })
      return
    case 'vaultRead':
      reply({ t: 'vaultReadRes', reqId: msg.reqId, content: vaultRead(msg.key) })
      return
    case 'vaultReadMany':
      reply({ t: 'vaultReadManyRes', reqId: msg.reqId, map: vaultReadMany(msg.keys) })
      return
    case 'vaultQuery':
      reply({ t: 'vaultQueryRes', reqId: msg.reqId, keys: vaultQuery(msg.query, msg.filters) })
      return
    case 'vaultAppendLog':
      vaultAppendLog(run.projectId, msg.taskId, msg.event)
      reply({ t: 'vaultAppendLogRes', reqId: msg.reqId })
      return
    case 'findCandidates':
      reply({ t: 'findCandidatesRes', reqId: msg.reqId, entries: findCandidates(msg.req, deps.getDefaultModel()) })
      return
    case 'papersSearch': {
      const papers = await deps.papersSearch(msg.args).catch(() => [] as PaperLite[])
      reply({ t: 'papersSearchRes', reqId: msg.reqId, papers })
      return
    }
    case 'papersPdf': {
      const res = await deps.papersPdf(msg.args).catch(() => ({ ok: false }))
      reply({ t: 'papersPdfRes', reqId: msg.reqId, res })
      return
    }
    case 'anythingEnsure': {
      const running = await deps.anythingEnsure().catch(() => false)
      reply({ t: 'anythingEnsureRes', reqId: msg.reqId, running })
      return
    }
    case 'anythingIngest': {
      const res = await deps.anythingIngest(msg.args).catch(() => ({ ok: false }))
      reply({ t: 'anythingIngestRes', reqId: msg.reqId, res })
      return
    }
    case 'boardCreateNodes':
      // Мост в рендерер: он создаёт tldraw-ноды на активной доске.
      send(run, 'orch:createNodes', { projectId: run.projectId, nodes: msg.nodes })
      reply({ t: 'boardCreateNodesRes', reqId: msg.reqId })
      return
    case 'webLLMAsk': {
      // Мост в рендерер: он вписывает запрос в веб-чат-ноду (webview) и возвращает
      // ответ. Резолвер висит здесь до 'orch:webLLMResult' или таймаута.
      const request_id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const timeoutMs = Math.min(Math.max(msg.timeoutMs || 180000, 15000), 600000)
      let settled = false
      const finish = (res: { ok: boolean; text: string; provider?: string }): void => {
        if (settled) return
        settled = true
        run.webLLMResolvers.delete(request_id)
        reply({ t: 'webLLMAskRes', reqId: msg.reqId, res })
      }
      run.webLLMResolvers.set(request_id, finish)
      setTimeout(() => finish({ ok: false, text: '' }), timeoutMs + 5000)
      send(run, 'orch:askWebLLM', {
        projectId: run.projectId,
        requestId: request_id,
        prompt: msg.prompt,
        target: msg.target,
        provider: msg.provider,
        timeoutMs
      })
      return
    }
    case 'trace':
      vaultAppendLog(run.projectId, msg.entry.task_id, { kind: 'trace', ...msg.entry })
      send(run, 'orch:trace', { projectId: run.projectId, entry: msg.entry })
      return
    case 'status':
      send(run, 'orch:status', { projectId: run.projectId, depth: wd.depth, ...msg.ev })
      return
    case 'log':
      console.log('[orch:worker]', msg.message)
      return
    case 'humanRequest': {
      // Human-in-the-loop блокирует ТОЛЬКО свою ветку: promise висит здесь, пока
      // пользователь не ответит; другие воркеры/ветки продолжают работать.
      const request_id = `hr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      run.humanResolvers.set(request_id, (d) => reply({ t: 'humanRequestRes', reqId: msg.reqId, decision: d }))
      send(run, 'orch:humanRequest', {
        request_id,
        project_id: run.projectId,
        task_id: msg.taskId,
        reason: msg.reason,
        best_output_key: msg.best_output_key,
        best_summary: msg.best_summary
      })
      return
    }
    case 'spawnSub': {
      // Рекурсия плоская: проверяем глубину здесь (hard-stop, раздел 6 ТЗ) и
      // спавним воркер-сиблинг под main, а не вложенно.
      const nextDepth = wd.depth + 1
      if (nextDepth > run.budget.limits.max_recursion_depth) {
        reply({
          t: 'spawnSubRes',
          reqId: msg.reqId,
          result: {
            task_id: 'sub',
            status: 'needs_human_review',
            output_vault_key: '',
            summary: `Достигнут предел рекурсии (${run.budget.limits.max_recursion_depth}) — требуется решение человека`,
            confidence: 0,
            cost_spent: { tokens: 0, calls: 0 },
            issues: ['max_recursion_depth reached']
          }
        })
        return
      }
      // Уникальный branch-префикс ветки: глубина + счётчик прогона (сиблинги на
      // одной глубине не сталкиваются). Все task_id саб-дерева получат этот префикс.
      const childBranch = `${wd.branch || ''}s${nextDepth}_${run.subCounter++}~`
      const result = await spawnWorker(
        run,
        createChildWorkerLaunchData(wd, {
          goal: msg.goal,
          budget: msg.budget,
          depth: nextDepth,
          materials: msg.materials,
          branch: childBranch
        })
      )
      reply({ t: 'spawnSubRes', reqId: msg.reqId, result })
      return
    }
    case 'result':
      done(msg.result)
      return
  }
}

function budgetAlert(run: RunState, pct: number): unknown {
  const s = run.budget.snapshot()
  return {
    projectId: run.projectId,
    depth: 0,
    task_id: '__budget__',
    status: pct >= 100 ? 'needs_human_review' : 'running',
    summary: `Бюджет: израсходовано ${Math.round(s.fraction * 100)}% (${s.tokens}/${s.limit} токенов)${
      pct >= 100 ? ' — HARD STOP, эскалация' : ' — алерт 80%'
    }`
  }
}

// --- IPC ---
export function registerOrchestratorIpc(d: Deps): void {
  deps = d

  ipcMain.handle(
    'orch:start',
    async (
      e,
      rawArgs: unknown
    ): Promise<{ ok: boolean; projectId?: string; error?: string }> => {
      let args
      try {
        args = parseOrchestratorStartInput(rawArgs)
      } catch {
        return { ok: false, error: 'Некорректные параметры или профиль запуска оркестратора' }
      }
      if (!args.goal || !args.goal.trim()) return { ok: false, error: 'Пустое описание проекта' }
      const projectId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const budget: Budget = { ...DEFAULT_BUDGET, ...(args.budget || {}) }
      const cancelBuf = new SharedArrayBuffer(4)
      const run: RunState = {
        projectId,
        sender: e.sender,
        budget: new BudgetManager(budget),
        cancelBuf,
        workers: new Set(),
        humanResolvers: new Map(),
        webLLMResolvers: new Map(),
        subCounter: 0,
        finished: false
      }
      runs.set(projectId, run)

      // Исходные материалы (если есть) — в Vault, воркеру отдаём ссылку-ключ.
      const materials: string[] = []
      if (args.materials && args.materials.trim()) {
        const key = `project:${projectId}/task:root/context`
        vaultWrite(key, args.materials, { kind: 'materials' })
        materials.push(key)
      }

      const plannerModel = args.model || deps.getDefaultModel()
      // Запускаем root-воркер асинхронно; клиенту сразу отдаём projectId.
      spawnWorker(run, {
        goal: args.goal,
        budget,
        depth: 0,
        materials,
        plannerModel,
        workflowProfile: args.workflowProfile,
        branch: ''
      })
        .then((result) => {
          run.finished = true
          send(run, 'orch:done', { projectId, result })
          send(run, 'orch:status', {
            projectId,
            depth: 0,
            task_id: 'root',
            status: result.status,
            summary: result.summary
          })
          vaultEvict(projectId)
        })
        .catch((err) => {
          run.finished = true
          send(run, 'orch:done', { projectId, result: failResult(args.goal, String(err)) })
        })

      return { ok: true, projectId }
    }
  )

  ipcMain.handle('orch:cancel', (_e, args: { projectId: string }) => {
    const run = runs.get(args.projectId)
    if (!run) return { ok: false }
    setCancel(run, 1)
    // Разблокируем зависшие human-запросы отказом
    for (const resolve of run.humanResolvers.values()) resolve({ decision: 'reject' })
    run.humanResolvers.clear()
    // И зависшие веб-чат-запросы — пустым ответом
    for (const resolve of run.webLLMResolvers.values()) resolve({ ok: false, text: '' })
    run.webLLMResolvers.clear()
    // Даём воркерам мягко завершиться, затем принудительно
    setTimeout(() => {
      for (const w of run.workers) w.terminate().catch(() => {})
    }, 1500)
    return { ok: true }
  })

  // Ответ веб-чата из renderer → разблокирует висящий webLLMAsk воркера.
  ipcMain.handle(
    'orch:webLLMResult',
    (_e, args: { projectId: string; requestId: string; ok: boolean; text: string; provider?: string }) => {
      const run = runs.get(args.projectId)
      const resolve = run?.webLLMResolvers.get(args.requestId)
      if (run && resolve) {
        resolve({ ok: args.ok, text: args.text || '', provider: args.provider })
        return { ok: true }
      }
      return { ok: false }
    }
  )

  ipcMain.handle('orch:humanDecision', (_e, args: { projectId: string; requestId: string; decision: HumanDecision }) => {
    const run = runs.get(args.projectId)
    const resolve = run?.humanResolvers.get(args.requestId)
    if (run && resolve) {
      resolve(args.decision)
      run.humanResolvers.delete(args.requestId)
      return { ok: true }
    }
    return { ok: false }
  })

  // Прочитать произвольный ключ Vault (для просмотра контекста/вывода узла на холсте).
  ipcMain.handle('orch:vaultRead', (_e, args: { key: string }) => ({ ok: true, content: vaultRead(args.key) }))

  // Состояние проекта из Vault (для восстановления панели после перезапуска).
  ipcMain.handle('orch:state', (_e, args: { projectId: string }) => {
    const treeKey = `project:${args.projectId}/tree`
    return {
      ok: true,
      tree: vaultRead(treeKey),
      log: vaultReadLog(args.projectId)
    }
  })

  // Реестр ролей: какие модели у под-агентов. Пустая model у роли = «модель по
  // умолчанию» (getRegistry подставит текущую дефолтную при возврате).
  ipcMain.handle('orch:registry', () => {
    const def = deps.getDefaultModel()
    const roles = getRegistry(def).map((r) => ({
      node_id: r.node_id,
      type: r.type,
      model: r.model // уже с подстановкой дефолта для пустых
    }))
    return { ok: true as const, default: def, roles }
  })
  // Назначить модель роли. model === '' → сбросить на модель по умолчанию.
  ipcMain.handle('orch:registrySet', (_e, args: { nodeId: string; model: string }) => {
    const def = deps.getDefaultModel()
    const entry = getRegistry(def).find((r) => r.node_id === args.nodeId)
    if (!entry) return { ok: false as const, error: 'роль не найдена' }
    upsertNode({ ...entry, model: args.model || '' })
    return { ok: true as const }
  })
}

export function stopAllOrchestrations(): void {
  for (const run of runs.values()) {
    setCancel(run, 1)
    for (const w of run.workers) w.terminate().catch(() => {})
  }
  runs.clear()
}
