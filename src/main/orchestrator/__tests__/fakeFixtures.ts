import type {
  AiChatResult,
  BoardNodeSpec,
  NodeRegistryEntry,
  PaperLite,
  TaskNode,
  TaskResult
} from '../contracts'

export function aiTextFixture(
  content = 'fixture response',
  totalTokens = 7
): AiChatResult {
  return { ok: true, content, totalTokens }
}

export function aiJsonFixture(value: unknown, totalTokens = 11): AiChatResult {
  return aiTextFixture(JSON.stringify(value), totalTokens)
}

export function taskNodeFixture(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'fixture-task',
    description: 'Synthetic fixture task',
    deps: [],
    mode: 'pipeline',
    success_criteria: 'The fixture result is present',
    size: 'small',
    ...overrides
  }
}

export function nodeRegistryFixture(
  overrides: Partial<NodeRegistryEntry> = {}
): NodeRegistryEntry {
  return {
    node_id: 'fixture-node',
    type: 'writer',
    capabilities: ['fixture-capability'],
    tools: ['fixture-tool'],
    model: 'fixture::model',
    system_prompt: 'Return only deterministic synthetic fixture content.',
    cost_per_call_estimate: 1,
    avg_latency_ms: 1,
    max_context_tokens: 4096,
    status: 'idle',
    ...overrides
  }
}

export function taskResultFixture(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    task_id: 'fixture-task',
    status: 'success',
    output_vault_key: 'fixture/output',
    summary: 'Synthetic fixture result',
    confidence: 0.9,
    cost_spent: { tokens: 7, calls: 1 },
    issues: [],
    ...overrides
  }
}

export function paperFixture(overrides: Partial<PaperLite> = {}): PaperLite {
  return {
    title: 'Synthetic fixture paper',
    authors: ['Fixture Author'],
    year: 2024,
    venue: 'Fixture Journal',
    doi: '10.0000/fixture.paper',
    url: 'https://example.invalid/papers/fixture',
    pdfUrl: 'https://example.invalid/papers/fixture.pdf',
    abstract: 'Synthetic abstract used only by deterministic tests.',
    oa: true,
    ...overrides
  }
}

export function boardNodeFixture(overrides: Partial<BoardNodeSpec> = {}): BoardNodeSpec {
  return {
    kind: 'note',
    title: 'Synthetic fixture note',
    body: 'Fixture body',
    url: 'https://example.invalid/notes/fixture',
    ...overrides
  }
}
