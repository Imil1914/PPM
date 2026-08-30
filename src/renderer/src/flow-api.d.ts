// Описание для TypeScript: что за объект window.flow появился из preload
import type { WorkflowProfile } from '../../shared/orchestrator/workflowProfile'

export {}

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }
export type Provider = {
  id: string
  name: string
  baseURL: string
  apiKey: string
  models: string
  enabled: boolean
}
type ModelOption = { value: string; label: string; group: string }

declare global {
  interface Window {
    flow: {
      aiChat: (args: {
        model: string
        messages: ChatMessage[]
        images?: string[]
      }) => Promise<
        | { ok: true; content: string; totalTokens: number }
        | { ok: false; error: string }
      >
      listModels: () => Promise<ModelOption[]>
      getProviders: () => Promise<Provider[]>
      saveProviders: (list: Provider[]) => Promise<{ ok: boolean; error?: string }>
      getSettings: () => Promise<{
        defaultModel: string
        autoStart: boolean
        comfyCmd: string
        comfyCwd: string
        lmsCmd: string
        elsevierKey: string
        elsevierInsttoken: string
        unpaywallEmail: string
        anythingllmKey: string
        ragHybrid: boolean
        ragTopN: number
        ragReranker: boolean
        memoryRetrieval: boolean
        memoryContextBudget: number
        memoryRecentDays: number
        memoryTopK: number
      }>
      saveSettings: (s: {
        defaultModel?: string
        autoStart?: boolean
        comfyCmd?: string
        comfyCwd?: string
        lmsCmd?: string
        elsevierKey?: string
        elsevierInsttoken?: string
        unpaywallEmail?: string
        anythingllmKey?: string
        ragHybrid?: boolean
        ragTopN?: number
        ragReranker?: boolean
        memoryRetrieval?: boolean
        memoryContextBudget?: number
        memoryRecentDays?: number
        memoryTopK?: number
      }) => Promise<{ ok: boolean; error?: string }>
      servicesStatus: () => Promise<{ comfy: boolean; lm: boolean }>
      startService: (args: { name: 'comfy' | 'lm' }) => Promise<{ ok: true }>
      sysGpu: () => Promise<
        { ok: true; name: string; usedMB: number; totalMB: number } | { ok: false }
      >

      getStartup: () => Promise<boolean>
      setStartup: (args: { enabled: boolean }) => Promise<{ ok: boolean; error?: string }>
      runCode: (args: { id: string; code: string }) => Promise<
        | { ok: true; stdout: string; images: string[] }
        | { ok: false; error: string; killed?: boolean }
      >
      killCode: (args: { id: string }) => Promise<{ ok: true }>
      webSearch: (args: { query: string }) => Promise<
        | { ok: true; results: Array<{ title: string; url: string; snippet: string }> }
        | { ok: false; error: string }
      >
      papersSearch: (args: { query: string; sources?: string[]; limit?: number; yearFrom?: number; yearTo?: number }) => Promise<
        | {
            ok: true
            note?: string
            results: Array<{
              id: string
              source: string
              title: string
              authors: string[]
              year: number | null
              abstract: string
              doi: string
              url: string
              pdfUrl: string
              oa: boolean
              venue: string
            }>
          }
        | { ok: false; error: string }
      >
      papersPdf: (args: { doi?: string; pdfUrl?: string; source?: string }) => Promise<
        { ok: true; base64: string } | { ok: false; error: string }
      >
      papersTestElsevier: () => Promise<
        | {
            ok: true
            key: 'ok' | 'fail' | 'none'
            keyMsg: string
            token: 'ok' | 'fail' | 'none'
            tokenMsg: string
            fulltext: 'ok' | 'fail' | 'none'
            ftMsg: string
          }
        | { ok: false; error: string }
      >
      openExternal: (args: { url: string }) => Promise<{ ok: true }>
      saveFile: (args: { base64: string; name: string }) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
      extractDoc: (args: { base64: string; name: string }) => Promise<
        { ok: true; text: string } | { ok: false; error: string }
      >
      agentChat: (args: {
        model: string
        messages: ChatMessage[]
      }) => Promise<
        | { ok: true; content: string; totalTokens: number }
        | { ok: false; error: string }
      >
      mcpList: () => Promise<
        Array<{
          id: string
          name: string
          command: string
          args: string[]
          env: Record<string, string>
          enabled: boolean
          status: string
          toolCount: number
          error?: string
        }>
      >
      mcpSave: (list: McpServer[]) => Promise<{ ok: boolean }>
      comfyModels: () => Promise<
        | { ok: true; checkpoints: string[]; unets: string[]; clips: string[]; vaes: string[] }
        | { ok: false; error: string }
      >
      comfyGenerate: (args: {
        checkpoint: string
        prompt: string
        negative: string
        width: number
        height: number
        steps: number
        modelType: string
      }) => Promise<{ ok: true; image: string } | { ok: false; error: string }>
      opencodeEnsure: (args: { cwd?: string }) => Promise<{ ok: boolean; port?: number; error?: string }>
      opencodeProviders: (args: { cwd?: string }) => Promise<
        | {
            ok: true
            providers: Array<{ id: string; name: string; models: string[]; env: string[] }>
            defaultModel: string
          }
        | { ok: false; error: string }
      >
      opencodeSetAuth: (args: {
        cwd?: string
        provider: string
        key: string
      }) => Promise<{ ok: true } | { ok: false; error: string }>
      opencodeSession: (args: { cwd?: string; title?: string }) => Promise<
        { ok: true; id: string; directory: string } | { ok: false; error: string }
      >
      opencodeMessage: (args: {
        cwd?: string
        sessionId: string
        model?: string
        text: string
      }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
      pickFolder: () => Promise<{ ok: true; path: string } | { ok: false }>
      ptyStart: (args: {
        id: string
        cwd?: string
        cols?: number
        rows?: number
        autostart?: boolean
        autostartCmd?: string
      }) => Promise<{ ok: true; reused: boolean } | { ok: false; error: string }>
      ptyWrite: (args: { id: string; data: string }) => void
      ptyResize: (args: { id: string; cols: number; rows: number }) => void
      ptyRun: (args: { id: string; cmd: string; interrupt?: boolean }) => void
      ptyKill: (args: { id: string }) => void
      onPtyData: (cb: (d: { id: string; data: string }) => void) => () => void
      onPtyExit: (cb: (d: { id: string; exitCode: number }) => void) => () => void
      anythingEnsure: () => Promise<{ ok: boolean; port?: number; error?: string }>
      anythingState: () => Promise<{
        phase: string
        message: string
        installed: boolean
        running: boolean
        port: number
        error: string
      }>
      anythingStop: () => Promise<{ ok: true }>
      anythingIngest: (args: { base64: string; name: string; workspace?: string }) => Promise<{ ok: boolean; error?: string; location?: string }>
      anythingRemove: (args: { location: string }) => Promise<{ ok: boolean; error?: string }>
      anythingWorkspaces: () => Promise<{ ok: boolean; error?: string; workspaces?: Array<{ name: string; slug: string }> }>
      onOrchCreateNodes: (
        cb: (payload: {
          projectId: string
          nodes: Array<{ kind: string; title: string; body?: string; facet?: string; url?: string; meta?: Record<string, unknown> }>
        }) => void
      ) => () => void
      onAnythingProgress: (cb: (p: { phase: string; message: string }) => void) => () => void
      openscienceEnsure: (args?: { cwd?: string }) => Promise<{ ok: boolean; url?: string; error?: string }>
      openscienceState: () => Promise<{
        phase: string
        message: string
        running: boolean
        url: string
        error: string
        cwd: string
      }>
      openscienceStop: () => Promise<{ ok: true }>
      onOpenscienceProgress: (cb: (p: { phase: string; message: string }) => void) => () => void
      notebookKernels: () => Promise<{ ok: true; kernels: Array<{ name: string; python: string }> }>
      notebookStart: (args: { id: string; python?: string }) => Promise<{ ok: true; running: boolean; python: string }>
      notebookRun: (args: { id: string; cell: string; code: string }) => void
      notebookRestart: (args: { id: string; python?: string }) => Promise<{ ok: true }>
      notebookShutdown: (args: { id: string }) => void
      onNotebookMsg: (cb: (m: NotebookMsg) => void) => () => void
      pdfImport: (args: { base64: string; id: string }) => Promise<
        { ok: true; id: string; path: string } | { ok: false; error: string }
      >
      pdfBytes: (args: { id: string }) => Promise<{ ok: true; base64: string } | { ok: false; error: string }>
      pdfIndexAdd: (args: {
        id: string
        chunks: Array<{ id: string; page: number; text: string; vector: number[] }>
      }) => Promise<{ ok: true; total: number } | { ok: false; error: string }>
      pdfSearch: (args: { id: string; vector: number[]; topK?: number; query?: string }) => Promise<
        { ok: true; chunks: Array<{ page: number; text: string; score: number }> } | { ok: false; error: string }
      >
      pdfIndexed: (args: { id: string }) => Promise<{ ok: true; indexed: boolean; count: number }>
      pdfDelete: (args: { id: string }) => Promise<{ ok: true }>
      pdfAsk: (args: {
        reqId: string
        model: string
        pdfId: string
        question: string
        queryVector?: number[]
        selection?: string
        imageDataUrl?: string
      }) => Promise<
        { ok: true; text: string; sources?: Array<{ n: number; page: number; text: string }> } | { ok: false; error: string }
      >
      onPdfStream: (
        cb: (m: {
          channel: 'token' | 'done' | 'error'
          reqId: string
          delta?: string
          text?: string
          error?: string
          sources?: Array<{ n: number; page: number; text: string }>
        }) => void
      ) => () => void
      // Meta-Orchestrator
      orchStart: (args: {
        goal: string
        model?: string
        budget?: Partial<{
          project_token_budget: number
          max_tokens_per_task: number
          max_iterations_per_mode: number
          max_parallel_nodes: number
          max_recursion_depth: number
        }>
        materials?: string
        workflowProfile?: WorkflowProfile
      }) => Promise<{ ok: boolean; projectId?: string; error?: string }>
      orchCancel: (args: { projectId: string }) => Promise<{ ok: boolean }>
      orchHumanDecision: (args: {
        projectId: string
        requestId: string
        decision: { decision: 'approve' | 'reject' | 'edit'; feedback?: string }
      }) => Promise<{ ok: boolean }>
      orchState: (args: { projectId: string }) => Promise<{ ok: boolean; tree: string | null; log: unknown[] }>
      orchWebLLMResult: (args: {
        projectId: string
        requestId: string
        ok: boolean
        text: string
        provider?: string
      }) => Promise<{ ok: boolean }>
      onOrchAskWebLLM: (
        cb: (m: { projectId: string; requestId: string; prompt: string; target?: string; provider?: string; timeoutMs?: number }) => void
      ) => () => void
      orchVaultRead: (args: { key: string }) => Promise<{ ok: boolean; content: string | null }>
      orchRegistry: () => Promise<{
        ok: boolean
        default: string
        roles: Array<{ node_id: string; type: string; model: string }>
      }>
      orchRegistrySet: (args: { nodeId: string; model: string }) => Promise<{ ok: boolean; error?: string }>
      onOrchTrace: (cb: (m: { projectId: string; entry: OrchTraceEntry }) => void) => () => void
      onOrchStatus: (cb: (m: OrchStatus) => void) => () => void
      onOrchDone: (cb: (m: { projectId: string; result: OrchResult }) => void) => () => void
      onOrchHumanRequest: (cb: (m: OrchHumanRequest) => void) => () => void
      // Vault — хранилище заметок в стиле Obsidian
      vaultRoot: () => Promise<{ root: string }>
      vaultPick: () => Promise<{ ok: boolean; root?: string }>
      vaultTree: () => Promise<{ root: string; tree: VaultEntry[] }>
      vaultRead: (args: { path: string }) => Promise<{ ok: true; content: string } | { ok: false; error: string }>
      vaultWrite: (args: { path: string; content: string }) => Promise<{ ok: boolean; error?: string }>
      vaultCreate: (args: { dir?: string; name?: string; content?: string }) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
      vaultMkdir: (args: { dir?: string; name?: string }) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
      vaultRename: (args: { path: string; name: string }) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
      vaultMove: (args: { path: string; destDir: string }) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
      vaultDelete: (args: { path: string }) => Promise<{ ok: boolean; error?: string }>
      vaultReveal: (args: { path: string }) => Promise<{ ok: boolean; error?: string }>
      onVaultChanged: (cb: () => void) => () => void
      // Файловая синхронизация холстов
      canvasStatus: () => Promise<{ enabled: boolean; dir: string }>
      canvasRead: (args: { key: string }) => Promise<{ snapshot: unknown; updatedAt: number; name?: string } | null>
      canvasWrite: (args: { key: string; snapshot: unknown; updatedAt: number; name?: string }) => Promise<{ ok: boolean; error?: string }>
      canvasRemove: (args: { key: string }) => Promise<{ ok: boolean }>
      canvasBoardsRead: () => Promise<{ boards: Array<{ id: string; name: string; key: string }>; updatedAt: number } | null>
      canvasBoardsWrite: (args: { boards: unknown; updatedAt: number }) => Promise<{ ok: boolean; error?: string }>
      // Локальная БД: память доски и пер-борд мета (T1.1)
      memory: {
        list: (args: { boardId: string }) => Promise<DbResult<MemoryEntry[]>>
        get: (args: { boardId: string; periodKind?: PeriodKind; periodKey: string }) => Promise<DbResult<MemoryEntry | null>>
        upsert: (args: {
          boardId: string
          periodKind?: PeriodKind
          periodKey: string
          content: string
          ts?: number
        }) => Promise<DbResult<MemoryEntry>>
        delete: (args: { boardId: string; periodKind?: PeriodKind; periodKey: string }) => Promise<
          DbResult<{ ok: true; deleted: number }>
        >
        search: (args: { query: string; boardId?: string; limit?: number }) => Promise<DbResult<MemorySearchHit[]>>
        embList: (args: { boardId: string }) => Promise<
          DbResult<Array<{ periodKind: PeriodKind; periodKey: string; vector: number[] }>>
        >
        embSet: (args: { boardId: string; periodKind?: PeriodKind; periodKey: string; vector: number[] }) => Promise<
          DbResult<{ ok: true }>
        >
      }
      boardmeta: {
        get: (args: { boardId: string; key: string }) => Promise<DbResult<string | null>>
        getAll: (args: { boardId: string }) => Promise<DbResult<Record<string, string>>>
        set: (args: { boardId: string; key: string; value: string }) => Promise<DbResult<{ ok: true }>>
      }
      nodes: {
        reindex: (args: {
          boardId: string
          boardName?: string
          nodes: { shapeId: string; kind?: string; title?: string; body?: string }[]
        }) => Promise<DbResult<{ ok: true; count: number }>>
        deleteBoard: (args: { boardId: string }) => Promise<DbResult<{ ok: true }>>
        search: (args: { query: string; limit?: number }) => Promise<DbResult<NodeSearchHit[]>>
      }
      dbStatus: () => Promise<{ ok: boolean; recreated: boolean; error?: string }>
      dbImportLocalDump: (args: {
        memory: { boardId: string; periodKind?: PeriodKind; periodKey: string; content: string; ts?: number }[]
        meta: { boardId: string; key: string; value: string }[]
        rawDump?: string
      }) => Promise<DbResult<{ ok: true; memory: number; meta: number }>>
    }
  }
}

export type PeriodKind = 'day' | 'week' | 'month'
export type MemoryEntry = {
  boardId: string
  periodKind: PeriodKind
  periodKey: string
  content: string
  createdAt: number
  updatedAt: number
}
export type MemorySearchHit = MemoryEntry & { snippet: string }
export type NodeSearchHit = {
  boardId: string
  boardName: string
  shapeId: string
  kind: string
  title: string
  snippet: string
}
export type DbResult<T> = { ok: true; data: T } | { ok: false; error: string }

export type VaultEntry = {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: VaultEntry[]
}

export type OrchTraceEntry = {
  command_id: string
  task_id: string
  node_id: string
  mode: string
  input_refs: string[]
  output_ref: string
  cost: { tokens: number; calls: number }
  duration_ms: number
  timestamp: number
  parent_command_id?: string
  note?: string
  workflow_profile: WorkflowProfile
}
export type OrchStatus = {
  projectId: string
  depth?: number
  task_id: string
  status: 'pending' | 'running' | 'success' | 'failure' | 'partial' | 'needs_human_review'
  mode?: string
  summary?: string
}
export type OrchResult = {
  task_id: string
  status: string
  output_vault_key: string
  summary: string
  confidence: number
  cost_spent: { tokens: number; calls: number }
  issues: string[]
}
export type OrchHumanRequest = {
  request_id: string
  project_id: string
  task_id: string
  reason: string
  best_output_key: string
  best_summary: string
}

export type NotebookMsg = {
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

export type McpServer = {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}
