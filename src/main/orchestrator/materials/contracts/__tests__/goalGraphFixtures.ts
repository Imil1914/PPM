import type { CompiledGraphV1, NodeSpecV1, PlanDraftV1 } from '../graph'
import type { ResearchGoalV1 } from '../goal'

export const goalGraphMinimalGoalFixture: ResearchGoalV1 = {
  schema_version: 'ResearchGoalV1',
  id: 'goal_fixture_minimal',
  project_id: 'project_fixture',
  version: 1,
  title: 'Minimal structural plate screening goal',
  product: {
    kind: 'structural_plate',
    material_family: 'aluminium_alloy',
    description: 'Synthetic contract fixture'
  },
  service_conditions: {
    nominal_temperature: { value: 200, unit: 'degC' },
    exposure_duration: { value: 100, unit: 'h' }
  },
  target_properties: [
    {
      id: 'target_fixture_primary',
      property: 'fixture_property',
      comparator: 'maximize',
      required: true,
      weight: 1
    }
  ],
  composition_constraints: {
    required_elements: [],
    allowed_elements: [],
    forbidden_elements: []
  },
  manufacturing_constraints: {
    allowed_route_families: ['rolling'],
    forbidden_operations: [],
    available_equipment: []
  },
  business_constraints: {
    priority_weights: { fixture_property: 1 }
  },
  required_outputs: [],
  assumptions: [],
  open_questions: [],
  created_at: '2026-08-28T00:00:00.000Z',
  created_by: { kind: 'system', id: 'system_fixture' }
}

export const goalGraphGoldenGoalFixture: ResearchGoalV1 = {
  schema_version: 'ResearchGoalV1',
  id: 'goal_aluminium_plate_v1',
  project_id: 'project_aluminium_plate',
  version: 1,
  title: 'Скрининг алюминиевой конструкционной пластины',
  product: {
    kind: 'structural_plate',
    material_family: 'aluminium_alloy',
    description: 'Цифровой подбор кандидатов и маршрутов'
  },
  service_conditions: {
    nominal_temperature: { value: 200, unit: 'degC' },
    exposure_duration: { value: 100, unit: 'h' },
    peak_temperature: { value: 250, unit: 'degC' }
  },
  target_properties: [
    {
      id: 'target_yield_strength',
      property: 'yield_strength',
      comparator: 'maximize',
      test_temperature: { value: 200, unit: 'degC' },
      prior_exposure: {
        temperature: { value: 200, unit: 'degC' },
        duration: { value: 100, unit: 'h' }
      },
      required: true,
      weight: 0.35
    },
    {
      id: 'target_strength_retention',
      property: 'strength_retention',
      comparator: 'maximize',
      test_temperature: { value: 200, unit: 'degC' },
      prior_exposure: {
        temperature: { value: 200, unit: 'degC' },
        duration: { value: 100, unit: 'h' }
      },
      required: true,
      weight: 0.3
    },
    {
      id: 'target_ductility',
      property: 'ductility',
      comparator: 'maximize',
      test_temperature: { value: 25, unit: 'degC' },
      required: true,
      weight: 0.15
    },
    {
      id: 'target_estimated_cost',
      property: 'estimated_cost',
      comparator: 'minimize',
      required: true,
      weight: 0.2
    }
  ],
  composition_constraints: {
    required_elements: ['Al'],
    allowed_elements: ['Al'],
    forbidden_elements: []
  },
  manufacturing_constraints: {
    allowed_route_families: [
      'casting_deformation',
      'rolling',
      'powder_metallurgy',
      'additive'
    ],
    forbidden_operations: [],
    available_equipment: ['fixture_unspecified']
  },
  business_constraints: {
    maximum_physical_experiments: 8,
    priority_weights: {
      yield_strength: 0.35,
      strength_retention: 0.3,
      ductility: 0.15,
      estimated_cost: 0.2
    }
  },
  required_outputs: ['flow_board', 'markdown', 'xlsx', 'docx', 'pdf', 'pptx', 'kanban'],
  assumptions: [
    {
      id: 'assumption_temperature_fixture',
      statement: 'Use the 200 degC for 100 h and 250 degC peak pilot benchmark',
      rationale: 'Deterministic golden scenario only',
      source: 'system_default',
      risk: 'high',
      confirmed_by_engineer: true
    }
  ],
  open_questions: [],
  created_at: '2026-08-28T00:00:00.000Z',
  created_by: { kind: 'engineer', id: 'engineer_fixture' }
}

export const goalGraphPlanDraftFixture: PlanDraftV1 = {
  schema_version: 'PlanDraftV1',
  id: 'plan_draft_fixture',
  goal_ref: {
    entity_type: 'ResearchGoalV1',
    entity_id: goalGraphGoldenGoalFixture.id,
    version: goalGraphGoldenGoalFixture.version
  },
  stages: [
    {
      draft_id: 'evidence',
      objective: 'Collect fixture evidence',
      dependencies: [],
      required_capabilities: ['evidence_retrieval'],
      expected_output_contract: 'ContextBundleV1',
      proposed_parallel_group: 'research'
    },
    {
      draft_id: 'candidates',
      objective: 'Generate symbolic fixture candidates',
      dependencies: ['evidence'],
      required_capabilities: ['candidate_generation'],
      expected_output_contract: 'CandidateDesignV1'
    }
  ]
}

export const goalGraphNodeSpecFixture: NodeSpecV1 = {
  schema_version: 'NodeSpecV1',
  id: 'node_spec_evidence_fixture',
  version: 1,
  name: 'Fixture evidence retrieval',
  node_type: 'agent_task',
  required_capability: 'evidence_retrieval',
  allowed_tools: ['fixture.knowledge_search'],
  input_contracts: ['ResearchGoalV1'],
  output_contract: 'ContextBundleV1',
  acceptance_rules: ['Every reported fact has fixture provenance'],
  timeout_ms: 30_000,
  maximum_attempts: 2,
  retry_policy: 'fallback_executor',
  risk_level: 'medium',
  approval_before_run: false,
  invalidated_by: ['goal_ref']
}

export const goalGraphCompiledGraphFixture: CompiledGraphV1 = {
  schema_version: 'CompiledGraphV1',
  id: 'compiled_graph_fixture',
  project_id: goalGraphGoldenGoalFixture.project_id,
  version: 1,
  goal_ref: goalGraphPlanDraftFixture.goal_ref,
  nodes: [
    {
      run_node_id: 'run_node_evidence',
      node_spec_ref: {
        entity_type: 'NodeSpecV1',
        entity_id: goalGraphNodeSpecFixture.id,
        version: goalGraphNodeSpecFixture.version
      },
      objective: 'Collect fixture evidence',
      dependencies: [],
      input_refs: [goalGraphPlanDraftFixture.goal_ref],
      selected_capabilities: ['evidence_retrieval'],
      state: 'pending'
    },
    {
      run_node_id: 'run_node_candidates',
      node_spec_ref: {
        entity_type: 'NodeSpecV1',
        entity_id: 'node_spec_candidates_fixture',
        version: 1
      },
      objective: 'Generate symbolic fixture candidates',
      dependencies: ['run_node_evidence'],
      input_refs: [goalGraphPlanDraftFixture.goal_ref],
      selected_capabilities: ['candidate_generation'],
      state: 'pending'
    }
  ],
  edges: [
    {
      from: 'run_node_evidence',
      to: 'run_node_candidates',
      contract: 'ContextBundleV1'
    }
  ],
  estimated_cost: { value: 10, unit: 'fixture_currency' },
  estimated_duration: { value: 5, unit: 'min' },
  estimated_model_calls: 3,
  risk_summary: ['Synthetic fixture risk only'],
  validation: {
    acyclic: true,
    all_contracts_resolved: true,
    all_tools_registered: true,
    all_outputs_consumable: true
  },
  created_at: '2026-08-28T00:01:00.000Z'
}
