import { contextBridge, ipcRenderer } from 'electron'
import type { WorkflowProfile } from '../shared/orchestrator/workflowProfile'

// Preload — безопасный мост между окном (renderer) и системой (main).
// Здесь мы выставляем в окно объект window.flow с функциями,
// которые под капотом обращаются к главному процессу Electron.
const api = {
  // Отправить историю диалога в модель LM Studio и получить ответ
  aiChat: (args: {
    model: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    images?: string[]
  }) => ipcRenderer.invoke('ai:chat', args),
  // Получить агрегированный список моделей всех включённых провайдеров
  listModels: () => ipcRenderer.invoke('ai:models'),
  // Провайдеры моделей (настройки)
  getProviders: () => ipcRenderer.invoke('providers:list'),
  saveProviders: (list: unknown) => ipcRenderer.invoke('providers:save', list),
  // Общие настройки (модель по умолчанию)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  // Выполнить Python-код локально (id — id квадрата, для остановки)
  runCode: (args: { id: string; code: string }) => ipcRenderer.invoke('code:run', args),
  // Остановить процесс квадрата (при удалении)
  killCode: (args: { id: string }) => ipcRenderer.invoke('code:kill', args),
  // Веб-поиск и открытие ссылок
  webSearch: (args: { query: string }) => ipcRenderer.invoke('web:search', args),
  papersSearch: (args: { query: string; sources?: string[]; limit?: number; yearFrom?: number; yearTo?: number }) =>
    ipcRenderer.invoke('papers:search', args),
  papersPdf: (args: { doi?: string; pdfUrl?: string; source?: string }) => ipcRenderer.invoke('papers:pdf', args),
  papersTestElsevier: () => ipcRenderer.invoke('papers:testElsevier'),
  openExternal: (args: { url: string }) => ipcRenderer.invoke('shell:open', args),
  saveFile: (args: { base64: string; name: string }) => ipcRenderer.invoke('file:save', args),
  // Извлечь текст из PDF / DOCX / PPTX (для вложений в ИИ-ноду)
  extractDoc: (args: { base64: string; name: string }) => ipcRenderer.invoke('file:extractText', args),
  // MCP: агентный чат с инструментами + управление серверами
  agentChat: (args: {
    model: string
    messages: Array<{ role: string; content: string }>
  }) => ipcRenderer.invoke('ai:agentChat', args),
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpSave: (list: unknown) => ipcRenderer.invoke('mcp:save', list),
  // Генерация картинок через ComfyUI
  comfyModels: () => ipcRenderer.invoke('comfy:models'),
  comfyGenerate: (args: {
    checkpoint: string
    prompt: string
    negative: string
    width: number
    height: number
    steps: number
    modelType: string
  }) => ipcRenderer.invoke('comfy:generate', args),
  // Локальные сервисы: статус и ручной запуск
  servicesStatus: () => ipcRenderer.invoke('services:status'),
  startService: (args: { name: 'comfy' | 'lm' }) => ipcRenderer.invoke('services:start', args),
  sysGpu: () => ipcRenderer.invoke('sys:gpu'),
  // Автозапуск Flow при входе в Windows
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (args: { enabled: boolean }) => ipcRenderer.invoke('startup:set', args),
  // OpenCode — агентный ассистент для кода (headless server)
  opencodeEnsure: (args: { cwd?: string }) => ipcRenderer.invoke('opencode:ensure', args),
  opencodeProviders: (args: { cwd?: string }) => ipcRenderer.invoke('opencode:providers', args),
  opencodeSession: (args: { cwd?: string; title?: string }) => ipcRenderer.invoke('opencode:session', args),
  opencodeMessage: (args: { cwd?: string; sessionId: string; model?: string; text: string }) =>
    ipcRenderer.invoke('opencode:message', args),
  opencodeSetAuth: (args: { cwd?: string; provider: string; key: string }) =>
    ipcRenderer.invoke('opencode:setAuth', args),
  // Выбор папки проекта (для рабочей директории OpenCode)
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // OpenCode как настоящий терминал (PTY + xterm.js)
  ptyStart: (args: {
    id: string
    cwd?: string
    cols?: number
    rows?: number
    autostart?: boolean
    autostartCmd?: string
  }) => ipcRenderer.invoke('pty:start', args),
  ptyWrite: (args: { id: string; data: string }) => ipcRenderer.send('pty:write', args),
  ptyResize: (args: { id: string; cols: number; rows: number }) => ipcRenderer.send('pty:resize', args),
  ptyRun: (args: { id: string; cmd: string; interrupt?: boolean }) => ipcRenderer.send('pty:run', args),
  ptyKill: (args: { id: string }) => ipcRenderer.send('pty:kill', args),
  onPtyData: (cb: (d: { id: string; data: string }) => void) => {
    const h = (_e: unknown, d: { id: string; data: string }) => cb(d)
    ipcRenderer.on('pty:data', h)
    return () => ipcRenderer.removeListener('pty:data', h)
  },
  onPtyExit: (cb: (d: { id: string; exitCode: number }) => void) => {
    const h = (_e: unknown, d: { id: string; exitCode: number }) => cb(d)
    ipcRenderer.on('pty:exit', h)
    return () => ipcRenderer.removeListener('pty:exit', h)
  },
  // AnythingLLM (управляемый сайдкар)
  anythingEnsure: () => ipcRenderer.invoke('anythingllm:ensure'),
  anythingState: () => ipcRenderer.invoke('anythingllm:state'),
  anythingStop: () => ipcRenderer.invoke('anythingllm:stop'),
  anythingIngest: (args: { base64: string; name: string; workspace?: string }) => ipcRenderer.invoke('anythingllm:ingest', args),
  anythingRemove: (args: { location: string }) => ipcRenderer.invoke('anythingllm:remove', args),
  anythingWorkspaces: () => ipcRenderer.invoke('anythingllm:workspaces'),
  // Оркестратор просит создать ноды на доске (research-фаза скилла lecture-forge)
  onOrchCreateNodes: (
    cb: (payload: { projectId: string; nodes: Array<Record<string, unknown>> }) => void
  ) => {
    const h = (_e: unknown, p: { projectId: string; nodes: Array<Record<string, unknown>> }): void => cb(p)
    ipcRenderer.on('orch:createNodes', h)
    return () => ipcRenderer.removeListener('orch:createNodes', h)
  },
  onAnythingProgress: (cb: (p: { phase: string; message: string }) => void) => {
    const h = (_e: unknown, p: { phase: string; message: string }) => cb(p)
    ipcRenderer.on('anythingllm:progress', h)
    return () => ipcRenderer.removeListener('anythingllm:progress', h)
  },
  // OpenScience (headless-сервер + webview)
  openscienceEnsure: (args?: { cwd?: string }) => ipcRenderer.invoke('openscience:ensure', args),
  openscienceState: () => ipcRenderer.invoke('openscience:state'),
  openscienceStop: () => ipcRenderer.invoke('openscience:stop'),
  onOpenscienceProgress: (cb: (p: { phase: string; message: string }) => void) => {
    const h = (_e: unknown, p: { phase: string; message: string }) => cb(p)
    ipcRenderer.on('openscience:progress', h)
    return () => ipcRenderer.removeListener('openscience:progress', h)
  },
  // Jupyter/Colab-нода: постоянный Python-kernel
  notebookKernels: () => ipcRenderer.invoke('notebook:kernels'),
  notebookStart: (args: { id: string; python?: string }) => ipcRenderer.invoke('notebook:start', args),
  notebookRun: (args: { id: string; cell: string; code: string }) => ipcRenderer.send('notebook:run', args),
  notebookRestart: (args: { id: string; python?: string }) => ipcRenderer.invoke('notebook:restart', args),
  notebookShutdown: (args: { id: string }) => ipcRenderer.send('notebook:shutdown', args),
  onNotebookMsg: (cb: (m: NotebookMsg) => void) => {
    const h = (_e: unknown, m: NotebookMsg) => cb(m)
    ipcRenderer.on('notebook:msg', h)
    return () => ipcRenderer.removeListener('notebook:msg', h)
  },
  // PDF-нода: хранение, индекс, RAG-поиск и стриминговый Q&A
  pdfImport: (args: { base64: string; id: string }) => ipcRenderer.invoke('pdf:import', args),
  pdfBytes: (args: { id: string }) => ipcRenderer.invoke('pdf:bytes', args),
  pdfIndexAdd: (args: { id: string; chunks: Array<{ id: string; page: number; text: string; vector: number[] }> }) =>
    ipcRenderer.invoke('pdf:index-add', args),
  pdfSearch: (args: { id: string; vector: number[]; topK?: number; query?: string }) => ipcRenderer.invoke('pdf:search', args),
  pdfIndexed: (args: { id: string }) => ipcRenderer.invoke('pdf:indexed', args),
  pdfDelete: (args: { id: string }) => ipcRenderer.invoke('pdf:delete', args),
  pdfAsk: (args: {
    reqId: string
    model: string
    pdfId: string
    question: string
    queryVector?: number[]
    selection?: string
    imageDataUrl?: string
  }) => ipcRenderer.invoke('pdf:ask', args),
  onPdfStream: (
    cb: (m: { channel: 'token' | 'done' | 'error'; reqId: string; delta?: string; text?: string; error?: string }) => void
  ) => {
    const tok = (_e: unknown, d: { reqId: string; delta: string }) => cb({ channel: 'token', ...d })
    const don = (_e: unknown, d: { reqId: string; text: string }) => cb({ channel: 'done', ...d })
    const err = (_e: unknown, d: { reqId: string; error: string }) => cb({ channel: 'error', ...d })
    ipcRenderer.on('pdf:token', tok)
    ipcRenderer.on('pdf:done', don)
    ipcRenderer.on('pdf:error', err)
    return () => {
      ipcRenderer.removeListener('pdf:token', tok)
      ipcRenderer.removeListener('pdf:done', don)
      ipcRenderer.removeListener('pdf:error', err)
    }
  },
  // Meta-Orchestrator: запуск/отмена/human-review + подписки на трейс/статусы
  orchStart: (args: {
    goal: string
    model?: string
    budget?: Record<string, number>
    materials?: string
    workflowProfile?: WorkflowProfile
  }) => ipcRenderer.invoke('orch:start', args),
  orchCancel: (args: { projectId: string }) => ipcRenderer.invoke('orch:cancel', args),
  orchHumanDecision: (args: {
    projectId: string
    requestId: string
    decision: { decision: 'approve' | 'reject' | 'edit'; feedback?: string }
  }) => ipcRenderer.invoke('orch:humanDecision', args),
  orchState: (args: { projectId: string }) => ipcRenderer.invoke('orch:state', args),
  // Ответ веб-чата обратно оркестратору (разблокирует его webLLMAsk)
  orchWebLLMResult: (args: { projectId: string; requestId: string; ok: boolean; text: string; provider?: string }) =>
    ipcRenderer.invoke('orch:webLLMResult', args),
  // Оркестратор просит вписать запрос в веб-чат-ноду и вернуть ответ
  onOrchAskWebLLM: (
    cb: (m: { projectId: string; requestId: string; prompt: string; target?: string; provider?: string; timeoutMs?: number }) => void
  ) => {
    const h = (_e: unknown, m: Parameters<typeof cb>[0]) => cb(m)
    ipcRenderer.on('orch:askWebLLM', h)
    return () => ipcRenderer.removeListener('orch:askWebLLM', h)
  },
  orchVaultRead: (args: { key: string }) => ipcRenderer.invoke('orch:vaultRead', args),
  orchRegistry: () => ipcRenderer.invoke('orch:registry'),
  orchRegistrySet: (args: { nodeId: string; model: string }) => ipcRenderer.invoke('orch:registrySet', args),
  onOrchTrace: (cb: (m: { projectId: string; entry: unknown }) => void) => {
    const h = (_e: unknown, m: { projectId: string; entry: unknown }) => cb(m)
    ipcRenderer.on('orch:trace', h)
    return () => ipcRenderer.removeListener('orch:trace', h)
  },
  onOrchStatus: (cb: (m: Record<string, unknown>) => void) => {
    const h = (_e: unknown, m: Record<string, unknown>) => cb(m)
    ipcRenderer.on('orch:status', h)
    return () => ipcRenderer.removeListener('orch:status', h)
  },
  onOrchDone: (cb: (m: { projectId: string; result: unknown }) => void) => {
    const h = (_e: unknown, m: { projectId: string; result: unknown }) => cb(m)
    ipcRenderer.on('orch:done', h)
    return () => ipcRenderer.removeListener('orch:done', h)
  },
  // Vault — хранилище заметок в стиле Obsidian (реальные .md на диске)
  vaultRoot: () => ipcRenderer.invoke('vault:root'),
  vaultPick: () => ipcRenderer.invoke('vault:pick'),
  vaultTree: () => ipcRenderer.invoke('vault:tree'),
  vaultRead: (args: { path: string }) => ipcRenderer.invoke('vault:read', args),
  vaultWrite: (args: { path: string; content: string }) => ipcRenderer.invoke('vault:write', args),
  vaultCreate: (args: { dir?: string; name?: string; content?: string }) =>
    ipcRenderer.invoke('vault:create', args),
  vaultMkdir: (args: { dir?: string; name?: string }) => ipcRenderer.invoke('vault:mkdir', args),
  vaultRename: (args: { path: string; name: string }) => ipcRenderer.invoke('vault:rename', args),
  vaultMove: (args: { path: string; destDir: string }) => ipcRenderer.invoke('vault:move', args),
  vaultDelete: (args: { path: string }) => ipcRenderer.invoke('vault:delete', args),
  vaultReveal: (args: { path: string }) => ipcRenderer.invoke('vault:reveal', args),
  onVaultChanged: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('vault:changed', h)
    return () => ipcRenderer.removeListener('vault:changed', h)
  },
  // Файловая синхронизация холстов через папку Vault
  canvasStatus: () => ipcRenderer.invoke('canvas:status'),
  canvasRead: (args: { key: string }) => ipcRenderer.invoke('canvas:read', args),
  canvasWrite: (args: { key: string; snapshot: unknown; updatedAt: number; name?: string }) =>
    ipcRenderer.invoke('canvas:write', args),
  canvasRemove: (args: { key: string }) => ipcRenderer.invoke('canvas:remove', args),
  canvasBoardsRead: () => ipcRenderer.invoke('canvas:boards:read'),
  canvasBoardsWrite: (args: { boards: unknown; updatedAt: number }) =>
    ipcRenderer.invoke('canvas:boards:write', args),
  onOrchHumanRequest: (
    cb: (m: {
      request_id: string
      project_id: string
      task_id: string
      reason: string
      best_output_key: string
      best_summary: string
    }) => void
  ) => {
    const h = (_e: unknown, m: Parameters<typeof cb>[0]) => cb(m)
    ipcRenderer.on('orch:humanRequest', h)
    return () => ipcRenderer.removeListener('orch:humanRequest', h)
  },
  // Локальная БД: память доски и пер-борд мета (T1.1). Все методы возвращают
  // { ok, data } | { ok:false, error } (кроме dbStatus).
  memory: {
    list: (args: { boardId: string }) => ipcRenderer.invoke('memory:list', args),
    get: (args: { boardId: string; periodKind?: 'day' | 'week' | 'month'; periodKey: string }) =>
      ipcRenderer.invoke('memory:get', args),
    upsert: (args: {
      boardId: string
      periodKind?: 'day' | 'week' | 'month'
      periodKey: string
      content: string
      ts?: number
    }) => ipcRenderer.invoke('memory:upsert', args),
    delete: (args: { boardId: string; periodKind?: 'day' | 'week' | 'month'; periodKey: string }) =>
      ipcRenderer.invoke('memory:delete', args),
    search: (args: { query: string; boardId?: string; limit?: number }) => ipcRenderer.invoke('memory:search', args),
    embList: (args: { boardId: string }) => ipcRenderer.invoke('memory:embList', args),
    embSet: (args: { boardId: string; periodKind?: 'day' | 'week' | 'month'; periodKey: string; vector: number[] }) =>
      ipcRenderer.invoke('memory:embSet', args)
  },
  boardmeta: {
    get: (args: { boardId: string; key: string }) => ipcRenderer.invoke('boardmeta:get', args),
    getAll: (args: { boardId: string }) => ipcRenderer.invoke('boardmeta:getAll', args),
    set: (args: { boardId: string; key: string; value: string }) => ipcRenderer.invoke('boardmeta:set', args)
  },
  nodes: {
    reindex: (args: {
      boardId: string
      boardName?: string
      nodes: { shapeId: string; kind?: string; title?: string; body?: string }[]
    }) => ipcRenderer.invoke('nodes:reindex', args),
    deleteBoard: (args: { boardId: string }) => ipcRenderer.invoke('nodes:deleteBoard', args),
    search: (args: { query: string; limit?: number }) => ipcRenderer.invoke('nodes:search', args)
  },
  dbStatus: () => ipcRenderer.invoke('db:status'),
  dbImportLocalDump: (args: {
    memory: { boardId: string; periodKind?: 'day' | 'week' | 'month'; periodKey: string; content: string; ts?: number }[]
    meta: { boardId: string; key: string; value: string }[]
    rawDump?: string
  }) => ipcRenderer.invoke('db:importLocalDump', args)
}

type NotebookMsg = {
  id: string
  cell?: string
  type: 'ready' | 'stream' | 'image' | 'result' | 'error' | 'done' | 'exit'
  name?: string
  text?: string
  html?: string | null
  mime?: string
  data?: string
  count?: number
}

contextBridge.exposeInMainWorld('flow', api)
