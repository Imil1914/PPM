export const versionRefFixture = {
  entity_type: 'FixtureEntityV1',
  entity_id: 'fixture-entity-1',
  version: 1
}

export const actorRefFixture = {
  kind: 'agent_run' as const,
  id: 'agent-run-1'
}

export const provenanceRefFixture = {
  source_id: 'source-1',
  source_version: 1,
  fragment_id: 'fragment-1',
  locator: { page: 7, table: 'Table 2', cell_range: 'B4:C4' }
}

export const sourceDocumentFixture = {
  schema_version: 'SourceDocumentV1' as const,
  id: 'source-1',
  version: 1,
  sha256: 'a'.repeat(64),
  title: 'Synthetic fixture source',
  source_type: 'paper' as const,
  original_uri: 'fixture://source-1',
  local_object_path: 'sources/source-1.md',
  mime_type: 'text/markdown',
  authors: ['Fixture Author'],
  publication_year: 2026,
  doi: '10.0000/fixture.1',
  ingested_at: '2026-08-28T12:00:00.000Z',
  access_policy: 'fixture_only'
}

export const sourceFragmentFixture = {
  schema_version: 'SourceFragmentV1' as const,
  id: 'fragment-1',
  source_ref: { ...versionRefFixture, entity_type: 'SourceDocumentV1', entity_id: 'source-1' },
  text: 'A synthetic fragment used only for contract verification.',
  locator: { page: 7, section: 'Fixture results', char_start: 0, char_end: 55 },
  extraction_method: 'fixture_parser',
  extraction_version: '1.0.0'
}

export const reportedFactFixture = {
  id: 'claim-proposal-1',
  statement: 'The fixture reports a measured property under stated conditions.',
  claim_type: 'reported_fact' as const,
  subject_refs: [versionRefFixture],
  evidence_refs: [provenanceRefFixture],
  confidence: 0.8,
  created_by: actorRefFixture
}

export const hypothesisFixture = {
  id: 'claim-proposal-2',
  statement: 'The symbolic candidate may warrant a future digital comparison.',
  claim_type: 'hypothesis' as const,
  subject_refs: [versionRefFixture],
  evidence_refs: [],
  created_by: actorRefFixture
}

export const evidenceClaimFixture = {
  ...reportedFactFixture,
  schema_version: 'EvidenceClaimV1' as const,
  version: 1,
  status: 'verified' as const,
  verification_method: 'fixture_provenance_check',
  verified_by: { kind: 'system' as const, id: 'evidence-gate-1' }
}

export const contextBundleFixture = {
  schema_version: 'ContextBundleV1' as const,
  id: 'context-bundle-1',
  project_id: 'project-1',
  objective: 'Collect evidence for the current fixture node.',
  goal_ref: { ...versionRefFixture, entity_type: 'ResearchGoalV1', entity_id: 'goal-1' },
  requirement_refs: [versionRefFixture],
  evidence_claim_refs: [
    { ...versionRefFixture, entity_type: 'EvidenceClaimV1', entity_id: 'claim-proposal-1' }
  ],
  numerical_record_refs: [],
  decision_refs: [],
  exclusions: ['Unverified numerical rows'],
  token_estimate: 1200,
  created_at: '2026-08-28T12:01:00.000Z'
}

export const knowledgeRequestFixture = {
  schema_version: 'KnowledgeRequestV1' as const,
  project_id: 'project-1',
  question: 'Which fixture spans support the stated condition?',
  modes: ['text', 'graph'] as const,
  filters: { source_type: 'paper', verified: true, years: ['2025', '2026'] },
  maximum_results: 10,
  required_provenance: true
}

export const structuredQueryFixture = {
  schema_version: 'StructuredQueryV1' as const,
  project_id: 'project-1',
  entity: 'property_observation' as const,
  filters: { property: 'fixture_property', minimum_quality: 1 },
  fields: ['property', 'value', 'test_temperature'],
  limit: 20
}

export const agentSpecFixture = {
  schema_version: 'AgentSpecV1' as const,
  id: 'evidence-data-curator',
  version: 1,
  name: 'Fixture evidence curator',
  purpose: 'Produce structured evidence proposals for a graph node.',
  capabilities: ['evidence_retrieval', 'numerical_extraction'],
  allowed_goal_patterns: ['retrieve evidence', 'extract structured observations'],
  forbidden_actions: ['change executable graph', 'approve experiment package'],
  input_contracts: ['ContextBundleV1'],
  output_contracts: ['AgentResultV1'],
  allowed_tools: ['source_search', 'source_span_reader'],
  context_policy: {
    required_refs: ['goal_ref', 'node_ref'],
    maximum_context_tokens: 24_000,
    forbidden_context_classes: ['provider_secret']
  },
  memory_policy: {
    readable_scopes: ['project_evidence'],
    writable_proposal_scopes: ['evidence_proposals']
  },
  model_policy: {
    preferred_tier: 'standard' as const,
    escalation_conditions: ['contradictory sources']
  },
  limits: {
    ttl_ms: 300_000,
    maximum_attempts: 3,
    maximum_tool_calls: 20,
    maximum_tokens: 24_000
  },
  success_rules: ['Every reported fact has evidence']
}

export const agentRunFixture = {
  schema_version: 'AgentRunV1' as const,
  id: 'agent-run-1',
  project_id: 'project-1',
  graph_version: 1,
  node_run_id: 'node-run-1',
  agent_spec_ref: {
    ...versionRefFixture,
    entity_type: 'AgentSpecV1',
    entity_id: 'evidence-data-curator'
  },
  model: {
    provider: 'fixture',
    model_id: 'fixture-model',
    policy_reason: 'Deterministic contract fixture'
  },
  context_bundle_ref: {
    ...versionRefFixture,
    entity_type: 'ContextBundleV1',
    entity_id: 'context-bundle-1'
  },
  tool_lease_ids: ['lease-1'],
  state: 'running' as const,
  started_at: '2026-08-28T12:02:00.000Z',
  usage: { tokens: 120, model_calls: 1, tool_calls: 1, duration_ms: 250 }
}

export const capabilityRequestFixture = {
  schema_version: 'CapabilityRequestV1' as const,
  id: 'capability-request-1',
  project_id: 'project-1',
  graph_ref: { ...versionRefFixture, entity_type: 'CompiledGraphV1', entity_id: 'graph-1' },
  node_run_id: 'node-run-1',
  objective: 'Retrieve evidence for the current fixture requirement.',
  required_capabilities: ['evidence_retrieval'],
  input_contracts: ['ContextBundleV1'],
  output_contract: 'AgentResultV1',
  allowed_tools: ['source_search'],
  risk_level: 'medium' as const,
  limits: { maximum_tokens: 12_000, maximum_tool_calls: 10, ttl_ms: 120_000 }
}

export const changeRequestFixture = {
  id: 'change-request-1',
  target_ref: versionRefFixture,
  requested_changes: [{ field_path: 'evidence_refs', instruction: 'Add a precise fixture span.' }],
  reason: 'The first proposal has insufficient provenance.',
  requested_by: actorRefFixture
}

export const agentResultFixture = {
  schema_version: 'AgentResultV1' as const,
  agent_run_ref: { ...versionRefFixture, entity_type: 'AgentRunV1', entity_id: 'agent-run-1' },
  status: 'success' as const,
  output_contract: 'FixtureOutputV1',
  output: { value: 'validated fixture output' },
  claims: [reportedFactFixture],
  change_requests: [changeRequestFixture],
  assumptions_used: [],
  issues: []
}

export const toolSpecFixture = {
  schema_version: 'ToolSpecV1' as const,
  id: 'fixture-property-reader',
  version: 1,
  name: 'Fixture property reader',
  kind: 'local_function' as const,
  purpose: 'Return a deterministic fixture property record.',
  input_contract: 'FixtureToolInputV1',
  output_contract: 'FixtureToolOutputV1',
  side_effects: ['none'] as const,
  required_permissions: [],
  timeout_ms: 1_000,
  maximum_retries: 0,
  idempotent: true,
  healthcheck: 'fixture_healthcheck',
  failure_codes: ['fixture_failure'],
  provenance_fields: ['fixture_id', 'input_snapshot']
}

export const toolInvocationFixture = {
  schema_version: 'ToolInvocationV1' as const,
  id: 'tool-invocation-1',
  project_id: 'project-1',
  agent_run_ref: { ...versionRefFixture, entity_type: 'AgentRunV1', entity_id: 'agent-run-1' },
  tool_spec_ref: {
    ...versionRefFixture,
    entity_type: 'ToolSpecV1',
    entity_id: 'fixture-property-reader'
  },
  input_ref: { ...versionRefFixture, entity_type: 'FixtureToolInputV1', entity_id: 'input-1' },
  lease_id: 'lease-1',
  state: 'completed' as const,
  output_ref: { ...versionRefFixture, entity_type: 'FixtureToolOutputV1', entity_id: 'output-1' },
  started_at: '2026-08-28T12:03:00.000Z',
  finished_at: '2026-08-28T12:03:01.000Z'
}

export const toolCallRequestFixture = {
  schema_version: 'ToolCallRequestV1' as const,
  project_id: 'project-1',
  agent_run_ref: { ...versionRefFixture, entity_type: 'AgentRunV1', entity_id: 'agent-run-1' },
  tool_spec_ref: {
    ...versionRefFixture,
    entity_type: 'ToolSpecV1',
    entity_id: 'fixture-property-reader'
  },
  lease_id: 'lease-1',
  input_ref: { ...versionRefFixture, entity_type: 'FixtureToolInputV1', entity_id: 'input-1' },
  idempotency_key: 'fixture-call-1'
}

export const validationReportFixture = {
  schema_version: 'ValidationReportV1' as const,
  valid: false,
  contract_id: 'FixtureToolOutputV1',
  errors: [{ code: 'missing_field', field_path: 'value', message: 'value is required' }],
  warnings: ['Synthetic validation report']
}
