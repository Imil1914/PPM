# AntyFlow Materials R&D: контракты данных и API

**Статус:** нормативное ТЗ для реализации  
**Источник runtime-валидации:** Zod в TypeScript  
**Формат обмена:** JSON Schema 2020-12  
**Python-границы:** Pydantic 2, генерируемый или сверяемый с той же JSON Schema

## 1. Зачем нужны контракты

Контракт отвечает на вопрос: «Какой объект разрешено передать следующему блоку?» Он проверяет наличие полей, типы, единицы, диапазоны и ссылки на версии. Контракт не доказывает научную истинность результата. Для этого существуют доменные правила, происхождение данных, научные инструменты, критик и инженер.

Все входы от LLM, renderer, IPC, файлового импорта и внешнего сервиса считаются недоверенными до прохождения Zod-валидации.

## 2. Правила версионирования

1. Имя нормативного контракта содержит версию: `ResearchGoalV1`.
2. Добавление необязательного поля допускается в той же major-версии.
3. Переименование, удаление или изменение смысла поля создаёт `V2` и миграцию.
4. Сохранённый объект содержит `schema_version`, `id`, `version`, `created_at` и `created_by`.
5. Утверждённая версия не изменяется. Правка создаёт следующий объект с `supersedes_id`.
6. Ссылки всегда указывают на конкретную версию, а не только на логическое имя.
7. Все даты передаются в ISO 8601 UTC.
8. Все физические величины содержат единицу. Внутреннее каноническое представление использует SI или явно заданную доменную единицу.

## 3. Общие примитивы

```ts
type EntityId = string
type IsoDateTime = string

type ActorRef = {
  kind: 'engineer' | 'agent_run' | 'system' | 'tool'
  id: EntityId
}

type VersionRef = {
  entity_type: string
  entity_id: EntityId
  version: number
}

type ProvenanceRef = {
  source_id: EntityId
  source_version: number
  fragment_id?: EntityId
  locator?: {
    page?: number
    table?: string
    figure?: string
    section?: string
    cell_range?: string
    char_start?: number
    char_end?: number
  }
}

type Quantity = {
  value: number
  unit: string
}

type IntervalQuantity = {
  min?: number
  target?: number
  max?: number
  unit: string
}
```

`EntityId` проверяется как непустая безопасная строка. `Quantity.value` должен быть конечным числом. Конвертация единиц выполняется до научного сравнения и записывается в аудит.

## 4. Состояния проекта

```ts
type MaterialsProjectStatus =
  | 'draft'
  | 'needs_clarification'
  | 'goal_ready'
  | 'plan_compiled'
  | 'awaiting_plan_approval'
  | 'approved_for_run'
  | 'running'
  | 'needs_revision'
  | 'awaiting_package_approval'
  | 'approved_for_experiment'
  | 'rejected'
  | 'cancelled'
  | 'blocked'
```

Разрешённые переходы определяются отдельной state machine. Renderer не присваивает статус напрямую: он отправляет команду, а main-процесс проверяет текущую версию и полномочия.

## 5. `ResearchGoalV1`

Это единый паспорт инженерной задачи.

```ts
type ResearchGoalV1 = {
  schema_version: 'ResearchGoalV1'
  id: EntityId
  project_id: EntityId
  version: number
  supersedes_id?: EntityId
  title: string
  product: {
    kind: 'structural_plate'
    material_family: 'aluminium_alloy'
    description: string
    geometry?: Record<string, Quantity>
  }
  service_conditions: {
    nominal_temperature: Quantity
    exposure_duration: Quantity
    peak_temperature?: Quantity
    peak_duration?: Quantity
    environment?: string
  }
  target_properties: TargetPropertyV1[]
  composition_constraints: {
    required_elements: string[]
    allowed_elements: string[]
    forbidden_elements: string[]
    max_total_alloying_fraction?: Quantity
  }
  manufacturing_constraints: {
    allowed_route_families: RouteFamily[]
    forbidden_operations: string[]
    available_equipment: string[]
    stock_form?: string
  }
  business_constraints: {
    budget_limit?: Quantity
    deadline?: IsoDateTime
    maximum_physical_experiments?: number
    priority_weights: Record<string, number>
  }
  required_outputs: ArtifactKind[]
  assumptions: AssumptionV1[]
  open_questions: ClarificationQuestionV1[]
  created_at: IsoDateTime
  created_by: ActorRef
}
```

```ts
type TargetPropertyV1 = {
  id: EntityId
  property: string
  comparator: 'gte' | 'lte' | 'range' | 'maximize' | 'minimize'
  target?: IntervalQuantity
  test_temperature?: Quantity
  prior_exposure?: { temperature: Quantity; duration: Quantity }
  test_method?: string
  required: boolean
  weight: number
}
```

Обязательные проверки:

- `version >= 1`;
- температура и длительность имеют совместимые единицы;
- веса неотрицательны и нормализуемы;
- присутствует хотя бы одно целевое свойство;
- присутствует хотя бы одно семейство маршрута;
- неразрешённые обязательные вопросы переводят проект в `needs_clarification`;
- одно и то же легирующее вещество не может одновременно быть обязательным и запрещённым.

## 6. Уточнения и решения человека

```ts
type ClarificationQuestionV1 = {
  id: EntityId
  field_path: string
  question: string
  reason: string
  required: boolean
  proposed_default?: unknown
  status: 'open' | 'answered' | 'waived'
}

type AssumptionV1 = {
  id: EntityId
  statement: string
  rationale: string
  source: 'engineer' | 'system_default' | 'inference'
  risk: 'low' | 'medium' | 'high'
  confirmed_by_engineer: boolean
}

type HumanGateRequestV1 = {
  schema_version: 'HumanGateRequestV1'
  id: EntityId
  project_id: EntityId
  gate: 'plan_preview' | 'experiment_package'
  object_ref: VersionRef
  summary: string
  assumptions: VersionRef[]
  estimated_cost?: Quantity
  estimated_duration?: Quantity
  risk_summary: string[]
  created_at: IsoDateTime
}

type HumanDecisionV1 = {
  schema_version: 'HumanDecisionV1'
  id: EntityId
  request_ref: VersionRef
  decision: 'approve' | 'reject' | 'request_changes'
  feedback: string
  requested_changes: ChangeRequestV1[]
  decided_at: IsoDateTime
  decided_by: ActorRef
}
```

Решение проверяется по optimistic concurrency: `object_ref.version` обязан совпадать с текущей ожидающей утверждения версией.

## 7. План и исполняемый граф

LLM создаёт только `PlanDraftV1`. Исполняться может только `CompiledGraphV1`, созданный детерминированным компилятором.

```ts
type PlanDraftV1 = {
  schema_version: 'PlanDraftV1'
  id: EntityId
  goal_ref: VersionRef
  stages: Array<{
    draft_id: string
    objective: string
    dependencies: string[]
    required_capabilities: string[]
    expected_output_contract: string
    proposed_parallel_group?: string
  }>
}

type NodeSpecV1 = {
  schema_version: 'NodeSpecV1'
  id: string
  version: number
  name: string
  node_type: 'deterministic' | 'agent_task' | 'human_gate' | 'fan_out' | 'fan_in'
  required_capability?: string
  allowed_tools: string[]
  input_contracts: string[]
  output_contract: string
  acceptance_rules: string[]
  timeout_ms: number
  maximum_attempts: number
  retry_policy: 'none' | 'same_executor' | 'fallback_executor' | 'replan'
  risk_level: 'low' | 'medium' | 'high'
  approval_before_run: boolean
  invalidated_by: string[]
}

type CompiledNodeV1 = {
  run_node_id: EntityId
  node_spec_ref: VersionRef
  objective: string
  dependencies: EntityId[]
  input_refs: VersionRef[]
  selected_capabilities: string[]
  state: 'pending' | 'ready' | 'running' | 'validating' | 'completed' | 'failed' | 'stale' | 'cancelled'
}

type CompiledGraphV1 = {
  schema_version: 'CompiledGraphV1'
  id: EntityId
  project_id: EntityId
  version: number
  goal_ref: VersionRef
  nodes: CompiledNodeV1[]
  edges: Array<{ from: EntityId; to: EntityId; contract: string }>
  estimated_cost?: Quantity
  estimated_duration?: Quantity
  estimated_model_calls: number
  risk_summary: string[]
  validation: {
    acyclic: boolean
    all_contracts_resolved: boolean
    all_tools_registered: boolean
    all_outputs_consumable: boolean
  }
  created_at: IsoDateTime
}
```

Компилятор отклоняет неизвестные `NodeSpec`, `ToolSpec`, контракты, циклы, оборванные зависимости и несовместимые входы/выходы.

## 8. `AgentSpecV1` и `AgentRunV1`

`AgentSpec` — зарегистрированный паспорт роли. `AgentRun` — временный экземпляр этой роли в одном запуске.

```ts
type AgentSpecV1 = {
  schema_version: 'AgentSpecV1'
  id: string
  version: number
  name: string
  purpose: string
  capabilities: string[]
  allowed_goal_patterns: string[]
  forbidden_actions: string[]
  input_contracts: string[]
  output_contracts: string[]
  allowed_tools: string[]
  context_policy: {
    required_refs: string[]
    maximum_context_tokens: number
    forbidden_context_classes: string[]
  }
  memory_policy: {
    readable_scopes: string[]
    writable_proposal_scopes: string[]
  }
  model_policy: {
    preferred_tier: 'local_small' | 'standard' | 'strong'
    escalation_conditions: string[]
  }
  limits: {
    ttl_ms: number
    maximum_attempts: number
    maximum_tool_calls: number
    maximum_tokens: number
  }
  success_rules: string[]
}

type AgentRunV1 = {
  schema_version: 'AgentRunV1'
  id: EntityId
  project_id: EntityId
  graph_version: number
  node_run_id: EntityId
  agent_spec_ref: VersionRef
  model: { provider: string; model_id: string; policy_reason: string }
  context_bundle_ref: VersionRef
  tool_lease_ids: EntityId[]
  state:
    | 'requested'
    | 'selected'
    | 'leased'
    | 'running'
    | 'waiting_tool'
    | 'submitted'
    | 'validating'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'expired'
  started_at?: IsoDateTime
  finished_at?: IsoDateTime
  usage: { tokens: number; model_calls: number; tool_calls: number; duration_ms: number }
  result_ref?: VersionRef
  failure?: StructuredFailureV1
}

type AgentResultV1<T = unknown> = {
  schema_version: 'AgentResultV1'
  agent_run_ref: VersionRef
  status: 'success' | 'partial' | 'needs_revision' | 'failed'
  output_contract: string
  output: T
  claims: ClaimProposalV1[]
  change_requests: ChangeRequestV1[]
  assumptions_used: VersionRef[]
  issues: StructuredFailureV1[]
}
```

```ts
type CapabilityRequestV1 = {
  schema_version: 'CapabilityRequestV1'
  id: EntityId
  project_id: EntityId
  graph_ref: VersionRef
  node_run_id: EntityId
  objective: string
  required_capabilities: string[]
  input_contracts: string[]
  output_contract: string
  allowed_tools: string[]
  risk_level: 'low' | 'medium' | 'high'
  limits: { maximum_tokens: number; maximum_tool_calls: number; ttl_ms: number }
}
```

## 9. `ToolSpecV1` и вызов инструмента

```ts
type ToolSpecV1 = {
  schema_version: 'ToolSpecV1'
  id: string
  version: number
  name: string
  kind: 'local_function' | 'sidecar' | 'external_api' | 'model' | 'artifact_generator'
  purpose: string
  input_contract: string
  output_contract: string
  side_effects: Array<'none' | 'filesystem_read' | 'filesystem_write' | 'network' | 'database_write'>
  required_permissions: string[]
  timeout_ms: number
  maximum_retries: number
  idempotent: boolean
  healthcheck: string
  failure_codes: string[]
  provenance_fields: string[]
}

type ToolInvocationV1 = {
  schema_version: 'ToolInvocationV1'
  id: EntityId
  project_id: EntityId
  agent_run_ref: VersionRef
  tool_spec_ref: VersionRef
  input_ref: VersionRef
  lease_id: EntityId
  state: 'requested' | 'authorized' | 'running' | 'completed' | 'failed' | 'timed_out' | 'denied'
  output_ref?: VersionRef
  failure?: StructuredFailureV1
  started_at?: IsoDateTime
  finished_at?: IsoDateTime
}
```

```ts
type ToolCallRequestV1 = {
  schema_version: 'ToolCallRequestV1'
  project_id: EntityId
  agent_run_ref: VersionRef
  tool_spec_ref: VersionRef
  lease_id: EntityId
  input_ref: VersionRef
  idempotency_key: string
}

type ValidationReportV1 = {
  schema_version: 'ValidationReportV1'
  valid: boolean
  contract_id: string
  errors: Array<{
    code: string
    field_path?: string
    message: string
  }>
  warnings: string[]
}
```

Любой вызов проходит последовательность: проверить существование ToolSpec → проверить аренду → проверить вход → исполнить с таймаутом → проверить выход → записать происхождение.

## 10. Контекст, источник и доказательство

```ts
type SourceDocumentV1 = {
  schema_version: 'SourceDocumentV1'
  id: EntityId
  version: number
  sha256: string
  title: string
  source_type: 'paper' | 'standard' | 'report' | 'dataset' | 'experiment' | 'user_file'
  original_uri: string
  local_object_path: string
  mime_type: string
  authors: string[]
  publication_year?: number
  doi?: string
  ingested_at: IsoDateTime
  access_policy: string
}

type SourceFragmentV1 = {
  schema_version: 'SourceFragmentV1'
  id: EntityId
  source_ref: VersionRef
  text: string
  locator: ProvenanceRef['locator']
  extraction_method: string
  extraction_version: string
}

type ClaimProposalV1 = {
  id: EntityId
  statement: string
  claim_type: 'reported_fact' | 'system_inference' | 'model_prediction' | 'hypothesis'
  subject_refs: VersionRef[]
  evidence_refs: ProvenanceRef[]
  confidence?: number
  created_by: ActorRef
}

type EvidenceClaimV1 = ClaimProposalV1 & {
  schema_version: 'EvidenceClaimV1'
  version: number
  status: 'proposed' | 'verified' | 'contested' | 'rejected' | 'superseded'
  verification_method: string
  verified_by?: ActorRef
}

type ContextBundleV1 = {
  schema_version: 'ContextBundleV1'
  id: EntityId
  project_id: EntityId
  objective: string
  goal_ref: VersionRef
  requirement_refs: VersionRef[]
  evidence_claim_refs: VersionRef[]
  numerical_record_refs: VersionRef[]
  decision_refs: VersionRef[]
  exclusions: string[]
  token_estimate: number
  created_at: IsoDateTime
}
```

```ts
type KnowledgeRequestV1 = {
  schema_version: 'KnowledgeRequestV1'
  project_id: EntityId
  question: string
  modes: Array<'text' | 'numerical' | 'graph' | 'memory'>
  filters: Record<string, string | number | boolean | string[]>
  maximum_results: number
  required_provenance: boolean
}

type StructuredQueryV1 = {
  schema_version: 'StructuredQueryV1'
  project_id: EntityId
  entity: 'property_observation' | 'composition' | 'route' | 'prediction' | 'decision'
  filters: Record<string, string | number | boolean | string[]>
  fields: string[]
  limit: number
}
```

`reported_fact` без `evidence_refs` не проходит Evidence Commit Gate. `system_inference` обязан ссылаться на входные факты. `model_prediction` обязан иметь ссылку на ModelCard и вызов модели. `hypothesis` может не иметь подтверждения, но не отображается как установленный факт.

## 11. Численное наблюдение и прогноз

```ts
type PropertyObservationV1 = {
  schema_version: 'PropertyObservationV1'
  id: EntityId
  version: number
  material_ref: VersionRef
  route_ref: VersionRef
  property: string
  value: Quantity
  test_temperature: Quantity
  prior_exposure?: { temperature: Quantity; duration: Quantity }
  test_method?: string
  specimen?: string
  uncertainty?: Quantity
  evidence: ProvenanceRef
  quality_level: 'screening' | 'reported' | 'verified' | 'reference_grade'
}

type ModelCardRefV1 = {
  model_id: string
  model_version: string
  training_domain: string
  applicability_check: 'inside' | 'borderline' | 'outside' | 'unknown'
  metrics_ref?: VersionRef
}

type PropertyPredictionV1 = {
  schema_version: 'PropertyPredictionV1'
  id: EntityId
  version: number
  candidate_ref: VersionRef
  property: string
  prediction: Quantity
  interval?: { lower: Quantity; upper: Quantity; level: number }
  test_temperature: Quantity
  prior_exposure?: { temperature: Quantity; duration: Quantity }
  model: ModelCardRefV1
  input_snapshot_ref: VersionRef
  warnings: string[]
}
```

Нельзя сравнивать наблюдения, если единицы, температура, выдержка или методика несовместимы и отсутствует явное правило преобразования.

## 12. Кандидат, маршрут и эксперимент

```ts
type MaterialCompositionV1 = {
  schema_version: 'MaterialCompositionV1'
  id: EntityId
  version: number
  basis: 'mass_fraction' | 'atomic_fraction'
  components: Array<{ element: string; fraction: number; tolerance?: number }>
  balance_element: 'Al'
  status: 'hypothesis' | 'supported_candidate' | 'rejected'
}

type RouteFamily = 'casting_deformation' | 'rolling' | 'forging' | 'powder_metallurgy' | 'additive'

type ProcessStepV1 = {
  id: EntityId
  order: number
  operation: string
  parameters: Record<string, Quantity | string | number | boolean>
  equipment_constraints: string[]
  acceptance_rules: string[]
}

type ManufacturingRouteV1 = {
  schema_version: 'ManufacturingRouteV1'
  id: EntityId
  version: number
  family: RouteFamily
  input_form: string
  output_form: string
  steps: ProcessStepV1[]
  feasibility: 'unknown' | 'feasible' | 'conditional' | 'infeasible'
  feasibility_reasons: string[]
}

type CandidateDesignV1 = {
  schema_version: 'CandidateDesignV1'
  id: EntityId
  version: number
  composition_ref: VersionRef
  route_ref: VersionRef
  prediction_refs: VersionRef[]
  evidence_claim_refs: VersionRef[]
  cost_estimate_ref?: VersionRef
  risk_refs: VersionRef[]
  status: 'generated' | 'screened' | 'pareto' | 'selected_for_doe' | 'rejected'
  rejection_reasons: string[]
}

type ExperimentDesignV1 = {
  schema_version: 'ExperimentDesignV1'
  id: EntityId
  version: number
  objective: string
  candidate_refs: VersionRef[]
  experiments: Array<{
    experiment_id: EntityId
    candidate_ref: VersionRef
    factors: Record<string, Quantity | string | number>
    planned_measurements: TargetPropertyV1[]
    information_value: number
    estimated_cost?: Quantity
  }>
  selection_method: string
  stopping_rule: string
}
```

Сумма долей явных компонентов должна быть допустима для выбранного basis. Точный допуск задаётся доменным правилом. Состав не считается готовой рецептурой без статуса инженера и эксперимента.

## 13. Критика

```ts
type CritiqueReportV1 = {
  schema_version: 'CritiqueReportV1'
  id: EntityId
  version: number
  package_ref: VersionRef
  critic_agent_run_ref: VersionRef
  verdict: 'pass' | 'changes_required' | 'blocked'
  findings: Array<{
    severity: 'info' | 'warning' | 'error' | 'blocking'
    category: 'contract' | 'evidence' | 'scientific' | 'applicability' | 'units' | 'completeness'
    target_ref?: VersionRef
    message: string
    requested_change?: string
  }>
  created_at: IsoDateTime
}
```

Критик не изменяет package. При `changes_required` или `blocked` он создаёт адресные `ChangeRequestV1`.

## 14. `ExperimentPackageV1`

```ts
type ExperimentPackageV1 = {
  schema_version: 'ExperimentPackageV1'
  id: EntityId
  project_id: EntityId
  version: number
  goal_ref: VersionRef
  graph_ref: VersionRef
  run_ref: VersionRef
  assumptions: VersionRef[]
  open_risks: VersionRef[]
  evidence_claims: VersionRef[]
  candidate_designs: VersionRef[]
  pareto_selection: VersionRef[]
  experiment_design_ref: VersionRef
  critique_report_ref: VersionRef
  artifact_manifest_ref?: VersionRef
  status: 'draft' | 'under_review' | 'changes_requested' | 'approved_for_experiment' | 'rejected'
  created_at: IsoDateTime
  approved_decision_ref?: VersionRef
}

type ArtifactManifestV1 = {
  schema_version: 'ArtifactManifestV1'
  id: EntityId
  package_ref: VersionRef
  artifacts: Array<{
    kind: ArtifactKind
    path_or_uri: string
    sha256: string
    generator_version: string
    generated_at: IsoDateTime
  }>
}

type ArtifactKind = 'flow_board' | 'markdown' | 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'kanban'
```

Все артефакты обязаны ссылаться на один `package_ref`. Изменение содержимого создаёт новую версию пакета и новый манифест.

## 15. Обратная связь и инвалидация

```ts
type FeedbackSignalV1 = {
  schema_version: 'FeedbackSignalV1'
  id: EntityId
  project_id: EntityId
  source: 'graph_validator' | 'runtime' | 'contract_validator' | 'critic' | 'provenance_gate' | 'engineer' | 'dependency_engine'
  source_ref: VersionRef
  category:
    | 'missing_requirement'
    | 'local_technical_error'
    | 'scientific_issue'
    | 'insufficient_evidence'
    | 'changed_input'
    | 'budget_or_permission'
  severity: 'info' | 'warning' | 'error' | 'blocking'
  message: string
  affected_refs: VersionRef[]
  proposed_action: 'clarify' | 'retry_node' | 'replan_branch' | 'human_escalation'
  created_at: IsoDateTime
}

type ChangeRequestV1 = {
  id: EntityId
  target_ref: VersionRef
  requested_changes: Array<{ field_path?: string; instruction: string }>
  reason: string
  requested_by: ActorRef
}

type DependencyEdgeV1 = {
  from_ref: VersionRef
  to_ref: VersionRef
  relation: 'derived_from' | 'uses_model' | 'uses_assumption' | 'uses_source' | 'uses_requirement'
}

type InvalidationEventV1 = {
  schema_version: 'InvalidationEventV1'
  id: EntityId
  changed_ref: VersionRef
  stale_refs: VersionRef[]
  reason: string
  created_at: IsoDateTime
}
```

Инвалидация меняет состояние производного объекта на `stale`, но не удаляет историю и не запускает дорогой пересчёт без политики или разрешения.

## 16. Ошибки

```ts
type StructuredFailureV1 = {
  code: string
  category: 'validation' | 'permission' | 'timeout' | 'tool' | 'model' | 'scientific' | 'budget' | 'cancelled'
  message: string
  retryable: boolean
  details?: Record<string, unknown>
  caused_by_ref?: VersionRef
}
```

Ошибка не передаётся как произвольная строка между слоями. Пользовательское сообщение может быть построено из `StructuredFailureV1`, но машинная логика использует `code`, `category` и `retryable`.

## 17. IPC API профиля `materials_rnd`

Новые IPC-обработчики добавляются в main, preload и `flow-api.d.ts`. Публичные payload проверяются в main через Zod. Существующий `orch:*` API сохраняется для обратной совместимости.

| Канал | Вход | Выход | Назначение |
|---|---|---|---|
| `materials:createDraft` | начальный текст, boardId | projectId, ResearchGoal draft | Создать проект |
| `materials:getProject` | projectId | агрегированное состояние и версии | Восстановить UI |
| `materials:answerClarifications` | projectId, goalVersion, answers | новая ResearchGoal version | Ответить на вопросы |
| `materials:compilePlan` | projectId, goalVersion | PlanPreview, CompiledGraph | Построить план |
| `materials:decideGate` | HumanDecisionV1 | новое состояние | Решить human gate |
| `materials:startRun` | projectId, graphVersion | runId | Запустить только утверждённый граф |
| `materials:cancelRun` | projectId, runId | результат отмены | Мягкая остановка |
| `materials:getObject` | VersionRef | объект | Просмотреть версию |
| `materials:getTrace` | projectId, runId | события | Аудит запуска |
| `materials:submitChange` | ChangeRequestV1 | новая версия или feedback id | Правка инженера |
| `materials:exportPackage` | packageRef, formats | ArtifactManifestV1 | Создать представления |
| `materials:importExperiment` | файлы и metadata | import report | Ручной импорт результатов |

События main → renderer:

- `materials:projectStatus`;
- `materials:graphStatus`;
- `materials:nodeStatus`;
- `materials:agentStatus`;
- `materials:humanGateRequested`;
- `materials:feedbackCreated`;
- `materials:artifactsReady`;
- `materials:runCompleted`.

## 18. Внутренний runtime API

Текущий `Runtime` расширяется, не ломая существующие методы:

```ts
interface MaterialsRuntimeExtension {
  validate(contractId: string, value: unknown): Promise<ValidationReportV1>
  knowledgeSearch(request: KnowledgeRequestV1): Promise<ContextBundleV1>
  structuredQuery(request: StructuredQueryV1): Promise<VersionRef[]>
  proposeEvidence(items: ClaimProposalV1[]): Promise<VersionRef[]>
  requestTool(call: ToolCallRequestV1): Promise<ToolInvocationV1>
  requestCapability(request: CapabilityRequestV1): Promise<AgentRunV1>
  submitFeedback(signal: FeedbackSignalV1): Promise<VersionRef>
  proposeGraphChange(change: ChangeRequestV1): Promise<VersionRef>
  checkpoint(reason: string): Promise<VersionRef>
}
```

Агент не получает прямой доступ к SQLite, файловой системе, IPC или реестру. Он обращается только к runtime-интерфейсу и ToolGateway.

## 19. Хранение

Предлагаемые группы таблиц в `flow.db`:

- `materials_projects`;
- `research_goal_versions`;
- `graph_versions`, `graph_nodes`, `graph_edges`;
- `materials_runs`, `task_runs`;
- `agent_specs`, `agent_runs`, `tool_specs`, `tool_invocations`;
- `source_documents`, `source_fragments`, `source_fragments_fts`;
- `evidence_claims`, `claim_evidence`, `evidence_nodes`, `evidence_edges`;
- `property_observations`, `material_compositions`, `manufacturing_routes`;
- `model_cards`, `property_predictions`;
- `experiment_packages`, `artifact_manifests`;
- `human_decisions`, `feedback_events`, `dependency_edges`, `project_events`.

Большие оригиналы и сгенерированные файлы хранятся вне SQLite. В базе находятся путь, SHA-256, MIME, размер, версия и политика доступа.

## 20. Обязательные контрактные тесты

Для каждого контракта нужны:

1. минимальный допустимый объект;
2. полный допустимый объект;
3. отсутствие каждого обязательного поля;
4. неверный тип;
5. `NaN`, `Infinity` и некорректная единица для физических величин;
6. неизвестная enum-категория;
7. лишние поля, если контракт строгий;
8. миграция предыдущей версии;
9. JSON Schema round-trip;
10. проверка, что renderer и IPC не могут обойти main-валидацию.

## 21. Критерий готовности слоя контрактов

Слой готов, когда нормативные Zod-схемы находятся в одном модуле, из них получаются TypeScript-типы и JSON Schema, каждый внешний payload валидируется, ошибки имеют структурированный формат, а fixtures эталонного сценария проходят те же схемы, что и рабочий runtime.
