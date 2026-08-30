// ============================================================================
// Engine — обход дерева подзадач (DAG). Планирует, затем исполняет узлы с учётом
// зависимостей и параллелизма (≤ max_parallel_nodes). Ветка с провалом/human-review
// блокирует ТОЛЬКО своих потомков — соседние ветки идут дальше (решение по ТЗ №3).
// ============================================================================
import type { Runtime, TaskNode, TaskResult, Budget, ControlPlaneCommand, ExecutionMode, TaskStatus } from './contracts'
import { plan } from './planner'
import { researchPhase } from './research'
import { webBuildPhase } from './webbuild'
import { assembleLecture, LECTURE_FORGE_PLAYBOOK } from './lecture'
import { selectMode } from './modeSelector'
import { withTimeout, shortSummary } from './util'
import type { ModeContext, ModeFn } from './modes/common'
import { execute as pipeline } from './modes/pipeline'
import { execute as actorCritic } from './modes/actorCritic'
import { execute as council } from './modes/council'
import { execute as ensemble } from './modes/ensemble'
import { execute as recursive } from './modes/recursive'
import type { WorkflowProfile } from '../../shared/orchestrator/workflowProfile'

const MODE_FNS: Record<ExecutionMode, ModeFn> = {
  pipeline,
  actor_critic: actorCritic,
  council,
  ensemble,
  recursive
}

export type OrchestrateOpts = {
  goal: string
  budget: Budget
  depth: number
  materials: string[]
  plannerModel: string
  workflowProfile: WorkflowProfile
  branch?: string // префикс task_id ветки (уникальность id между root и саб-оркестраторами)
}

type LegacyEnginePhasePolicy = Readonly<{
  enableWebBuildPhase: boolean
  enableLectureAssembly: boolean
}>

const GENERIC_PHASE_POLICY: LegacyEnginePhasePolicy = Object.freeze({
  enableWebBuildPhase: true,
  enableLectureAssembly: true
})

const MATERIALS_PHASE_POLICY: LegacyEnginePhasePolicy = Object.freeze({
  enableWebBuildPhase: false,
  enableLectureAssembly: false
})

export function orchestrate(rt: Runtime, opts: OrchestrateOpts): Promise<TaskResult> {
  return orchestrateWithPhasePolicy(rt, opts, GENERIC_PHASE_POLICY)
}

export function orchestrateMaterialsLegacyBridge(
  rt: Runtime,
  opts: OrchestrateOpts
): Promise<TaskResult> {
  return orchestrateWithPhasePolicy(rt, opts, MATERIALS_PHASE_POLICY)
}

async function orchestrateWithPhasePolicy(
  rt: Runtime,
  opts: OrchestrateOpts,
  phasePolicy: LegacyEnginePhasePolicy
): Promise<TaskResult> {
  const { budget, depth, materials, plannerModel } = opts
  const branch = opts.branch || ''
  rt.status({ task_id: 'root', status: 'running', summary: opts.goal })

  // --- Research-фаза (скилл lecture-forge, шаг 1) ---
  // Только на корне (не в саб-оркестраторах) и только для научных тем: собирает
  // статьи на доску + в AnythingLLM + гипотезы, обогащает materials для планировщика.
  let allMaterials = materials
  let scientific = false
  let researchSummary = ''
  if (depth === 0) {
    try {
      const research = await researchPhase(rt, opts.goal)
      scientific = research.scientific
      researchSummary = research.summary
      if (research.materials.length) allMaterials = [...materials, ...research.materials]
    } catch (e) {
      rt.trace({
        command_id: rt.newId('cmd'),
        task_id: '__research__',
        node_id: 'role:researcher',
        mode: 'system',
        input_refs: [],
        output_ref: '',
        cost: { tokens: 0, calls: 0 },
        duration_ms: 0,
        timestamp: Date.now(),
        note: `Ресерч-фаза упала (не критично): ${(e as Error).message}`
      })
    }
  }

  // --- Веб-сборка (приоритетный путь, только на корне) ---
  // Если на холсте открыты веб-чат-ноды (ChatGPT/Gemini/GLM с логином), делегируем
  // генерацию сильным веб-моделям (задачи раскидываются по нескольким моделям), а
  // оркестратор строит настоящие ноды: канбаны/таблицы/списки/документы/схемы/заметки.
  // Опирается на сводку ресерча. Если веб-сборка что-то дала — ЗАМЫКАЕМ прогон: дешёвый
  // локальный planner/modes/lecture не запускаем. Веб-нод нет / пусто → идём обычным путём.
  if (phasePolicy.enableWebBuildPhase && depth === 0 && !rt.isCancelled()) {
    try {
      const built = await webBuildPhase(rt, opts.goal, researchSummary)
      if (built.ran && built.result) {
        rt.status({ task_id: 'root', status: built.result.status, summary: built.result.summary })
        return built.result
      }
    } catch (e) {
      rt.trace({
        command_id: rt.newId('cmd'),
        task_id: '__webbuild__',
        node_id: 'role:webllm',
        mode: 'system',
        input_refs: [],
        output_ref: '',
        cost: { tokens: 0, calls: 0 },
        duration_ms: 0,
        timestamp: Date.now(),
        note: `Веб-сборка упала (не критично): ${(e as Error).message}`
      })
    }
  }

  // --- Планирование (научным темам подмешиваем плейбук lecture-forge) ---
  const tasks = await plan(rt, opts.goal, allMaterials, plannerModel, scientific ? LECTURE_FORGE_PLAYBOOK : undefined)
  // Префикс ветки: делает task_id глобально уникальными в проекте, чтобы статусы/
  // трейсы саб-оркестратора не привязывались к одноимённым узлам родителя.
  if (branch) {
    for (const t of tasks) {
      t.deps = t.deps.map((d) => branch + d)
      t.id = branch + t.id
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  // Дерево — в Vault (персистентность) и в renderer (для панели).
  await rt.vaultWrite(
    `project:${rt.projectId}/tree`,
    JSON.stringify({ goal: opts.goal, workflow_profile: opts.workflowProfile, tasks }),
    { kind: 'tree' }
  )
  rt.status({ task_id: '__tree__', status: 'pending', summary: JSON.stringify(tasks) })

  const results = new Map<string, TaskResult>()

  // Состояние зависимостей узла.
  const depState = (t: TaskNode): 'ready' | 'wait' | 'blocked' => {
    for (const d of t.deps) {
      const r = results.get(d)
      if (!r) return 'wait'
      if (r.status === 'failure') return 'blocked'
    }
    return 'ready'
  }

  const blockedResult = (t: TaskNode): TaskResult => ({
    task_id: t.id,
    status: 'failure',
    output_vault_key: '',
    summary: 'Пропущено: заблокировано провалившейся зависимостью',
    confidence: 0,
    cost_spent: { tokens: 0, calls: 0 },
    issues: ['blocked by failed dependency']
  })

  // --- Исполнение одного узла ---
  const runTask = async (t: TaskNode): Promise<void> => {
    rt.status({ task_id: t.id, status: 'running' })
    // context_refs: материалы — узлам-входам (без зависимостей); иначе выводы зависимостей.
    const contextRefs: string[] = []
    if (t.deps.length === 0) contextRefs.push(...allMaterials)
    for (const d of t.deps) {
      const r = results.get(d)
      if (r?.output_vault_key) contextRefs.push(r.output_vault_key)
    }

    const mode = selectMode(t, depth, budget)
    const command: ControlPlaneCommand = {
      command_id: rt.newId('cmd'),
      task_id: t.id,
      mode,
      participants: [],
      context_refs: contextRefs,
      role_prompts: {},
      success_criteria: t.success_criteria,
      rubric: t.rubric,
      budget: {
        max_tokens: budget.max_tokens_per_task,
        max_iterations: budget.max_iterations_per_mode,
        max_depth: budget.max_recursion_depth
      },
      // Рекурсивные/крупные подзадачи запускают саб-оркестратор и легко идут
      // дольше 2.5 мин — им даём 12 мин, обычным — 4 мин (было 150с на всё, из-за
      // чего рекурсивные задачи ложно падали по таймауту).
      timeout_ms: mode === 'recursive' || t.size === 'large' ? 720000 : 240000
    }
    const candidates = await rt.findCandidates({}) // все роли; режим выбирает нужные
    const ctx: ModeContext = { rt, task: t, command, candidates, budget }

    const failFallback: TaskResult = {
      task_id: t.id,
      status: 'failure',
      output_vault_key: '',
      summary: 'Таймаут исполнения подзадачи',
      confidence: 0,
      cost_spent: { tokens: 0, calls: 0 },
      issues: ['mode timeout']
    }
    let result = await withTimeout(MODE_FNS[mode](ctx), command.timeout_ms + 8000, failFallback)

    // Human-in-the-loop: блокирует только эту ветку (остальные идут параллельно).
    if (result.status === 'needs_human_review' && !rt.isCancelled()) {
      const decision = await rt.humanRequest({
        task_id: t.id,
        reason: result.issues.join('; ') || 'Требуется решение человека',
        best_output_key: result.output_vault_key,
        best_summary: result.summary
      })
      if (decision.decision === 'approve') {
        result = { ...result, status: 'success' }
      } else if (decision.decision === 'reject') {
        result = { ...result, status: 'failure', issues: [...result.issues, 'отклонено человеком'] }
      } else {
        // edit: один повтор с правками человека.
        const t2: TaskNode = {
          ...t,
          description: `${t.description}\n\nПравки от человека: ${decision.feedback || '(без комментария)'}`
        }
        result = await withTimeout(MODE_FNS[mode]({ ...ctx, task: t2 }), command.timeout_ms + 8000, failFallback)
        if (result.status === 'needs_human_review') result = { ...result, status: 'partial' }
      }
    }

    results.set(t.id, result)
    rt.status({ task_id: t.id, status: result.status, summary: result.summary, mode })
  }

  // --- Планировщик выполнения (параллелизм с барьером зависимостей) ---
  const pendingIds = new Set(tasks.map((t) => t.id))
  const inflight = new Map<string, Promise<void>>()
  const limit = Math.max(1, budget.max_parallel_nodes)

  while (pendingIds.size || inflight.size) {
    if (rt.isCancelled()) break

    // Заблокированные узлы снимаем сразу.
    for (const id of [...pendingIds]) {
      if (depState(byId.get(id)!) === 'blocked') {
        pendingIds.delete(id)
        const t = byId.get(id)!
        results.set(id, blockedResult(t))
        rt.status({ task_id: id, status: 'failure', summary: 'заблокировано зависимостью' })
      }
    }
    // Запускаем готовые до предела параллелизма.
    for (const id of [...pendingIds]) {
      if (inflight.size >= limit) break
      if (depState(byId.get(id)!) === 'ready') {
        pendingIds.delete(id)
        const p = runTask(byId.get(id)!).finally(() => inflight.delete(id))
        inflight.set(id, p)
      }
    }
    if (inflight.size) {
      await Promise.race(inflight.values())
    } else if (pendingIds.size) {
      // Ничего не готово и ничто не исполняется → остаток висит на заблокированных.
      for (const id of [...pendingIds]) {
        pendingIds.delete(id)
        results.set(id, blockedResult(byId.get(id)!))
        rt.status({ task_id: id, status: 'failure', summary: 'заблокировано зависимостью' })
      }
    }
  }
  await Promise.allSettled(inflight.values())

  // --- Сборка финальной лекции (скилл lecture-forge, стадия 5), для научных тем ---
  if (phasePolicy.enableLectureAssembly && scientific && !rt.isCancelled()) {
    try {
      const doneResults = [...results.values()].filter((r) => r.status === 'success' || r.status === 'partial')
      const outKeys = doneResults.map((r) => r.output_vault_key).filter(Boolean)
      const outMap = outKeys.length ? await rt.vaultReadMany(outKeys) : {}
      const summaries = doneResults.map((r) => outMap[r.output_vault_key] || r.summary)
      await assembleLecture(rt, opts.goal, allMaterials, summaries)
    } catch (e) {
      rt.status({ task_id: '__lecture__', status: 'failure', summary: 'сборка лекции упала: ' + (e as Error).message })
    }
  }

  return aggregate(rt, tasks, results, opts.goal)
}

// Свести результаты «стоковых» узлов (без потомков) в корневой TaskResult.
async function aggregate(
  rt: Runtime,
  tasks: TaskNode[],
  results: Map<string, TaskResult>,
  goal: string
): Promise<TaskResult> {
  const sinks = tasks.filter((t) => !tasks.some((o) => o.deps.includes(t.id)))
  const sinkResults = sinks.map((s) => results.get(s.id)).filter(Boolean) as TaskResult[]
  const all = [...results.values()]
  const cost = all.reduce(
    (acc, r) => ({ tokens: acc.tokens + r.cost_spent.tokens, calls: acc.calls + r.cost_spent.calls }),
    { tokens: 0, calls: 0 }
  )

  const status = rollupStatus(sinkResults)

  // Единый корневой вывод: сшиваем выводы стоков (по ссылкам).
  const parts: string[] = []
  for (const s of sinks) {
    const r = results.get(s.id)
    if (!r) continue
    const content = r.output_vault_key ? (await rt.vaultRead(r.output_vault_key)) ?? r.summary : r.summary
    parts.push(`## ${s.description}\n${content}`)
  }
  const combined = parts.join('\n\n---\n\n') || 'Нет результата'
  const rootKey = `project:${rt.projectId}/task:root/output:0`
  await rt.vaultWrite(rootKey, combined, { kind: 'root_output', status })

  return {
    task_id: 'root',
    status,
    output_vault_key: rootKey,
    summary: `Проект «${shortSummary(goal, 80)}»: ${status}. Подзадач: ${tasks.length}, стоков: ${sinks.length}.`,
    confidence: status === 'success' ? 0.8 : status === 'partial' ? 0.5 : 0.2,
    cost_spent: cost,
    issues: all.flatMap((r) => r.issues)
  }
}

function rollupStatus(results: TaskResult[]): TaskStatus {
  if (!results.length) return 'failure'
  if (results.some((r) => r.status === 'needs_human_review')) return 'needs_human_review'
  const ok = results.filter((r) => r.status === 'success' || r.status === 'partial').length
  if (ok === results.length && results.every((r) => r.status === 'success')) return 'success'
  if (ok === 0) return 'failure'
  return 'partial'
}
