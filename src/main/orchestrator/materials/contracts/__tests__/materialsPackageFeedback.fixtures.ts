import type { VersionRef } from '../common'
import type {
  CandidateDesignV1,
  ExperimentDesignV1,
  ManufacturingRouteV1,
  MaterialCompositionV1,
  ModelCardRefV1,
  ProcessStepV1,
  PropertyObservationV1,
  PropertyPredictionV1
} from '../materials'
import type {
  ChangeRequestV1,
  DependencyEdgeV1,
  FeedbackSignalV1,
  InvalidationEventV1
} from '../feedback'
import type {
  ArtifactManifestV1,
  CritiqueReportV1,
  ExperimentPackageV1,
  HumanDecisionV1,
  HumanGateRequestV1
} from '../package'

const fixtureTimestamp = '2026-08-28T00:00:00.000Z'

const fixtureRef = (entityType: string, entityId: string): VersionRef => ({
  entity_type: entityType,
  entity_id: entityId,
  version: 1
})

export const materialsPackageFeedbackModelCardFixture: ModelCardRefV1 = {
  model_id: 'fixture-model',
  model_version: 'fixture-v1',
  training_domain: 'symbolic-fixture-domain',
  applicability_check: 'inside',
  metrics_ref: fixtureRef('model_metrics', 'fixture-model-metrics')
}

export const materialsPackageFeedbackPropertyObservationFixture: PropertyObservationV1 =
  {
    schema_version: 'PropertyObservationV1',
    id: 'fixture-observation',
    version: 1,
    material_ref: fixtureRef('material_composition', 'fixture-composition'),
    route_ref: fixtureRef('manufacturing_route', 'fixture-route'),
    property: 'fixture-property',
    value: { value: 1, unit: 'fixture-unit' },
    test_temperature: { value: 200, unit: 'degC' },
    prior_exposure: {
      temperature: { value: 200, unit: 'degC' },
      duration: { value: 100, unit: 'h' }
    },
    test_method: 'fixture-method',
    specimen: 'fixture-specimen',
    uncertainty: { value: 0.1, unit: 'fixture-unit' },
    evidence: {
      source_id: 'fixture-source',
      source_version: 1,
      fragment_id: 'fixture-fragment',
      locator: { page: 1, cell_range: 'A1' }
    },
    quality_level: 'screening'
  }

export const materialsPackageFeedbackPropertyPredictionFixture: PropertyPredictionV1 =
  {
    schema_version: 'PropertyPredictionV1',
    id: 'fixture-prediction',
    version: 1,
    candidate_ref: fixtureRef('candidate_design', 'fixture-candidate'),
    property: 'fixture-property',
    prediction: { value: 1, unit: 'fixture-unit' },
    interval: {
      lower: { value: 0.8, unit: 'fixture-unit' },
      upper: { value: 1.2, unit: 'fixture-unit' },
      level: 0.95
    },
    test_temperature: { value: 200, unit: 'degC' },
    prior_exposure: {
      temperature: { value: 200, unit: 'degC' },
      duration: { value: 100, unit: 'h' }
    },
    model: materialsPackageFeedbackModelCardFixture,
    input_snapshot_ref: fixtureRef('input_snapshot', 'fixture-input-snapshot'),
    warnings: []
  }

export const materialsPackageFeedbackCompositionFixture: MaterialCompositionV1 =
  {
    schema_version: 'MaterialCompositionV1',
    id: 'fixture-composition',
    version: 1,
    basis: 'mass_fraction',
    components: [
      { element: 'fixture-element', fraction: 0.1, tolerance: 0.01 }
    ],
    balance_element: 'Al',
    status: 'hypothesis'
  }

export const materialsPackageFeedbackProcessStepFixture: ProcessStepV1 = {
  id: 'fixture-process-step',
  order: 0,
  operation: 'fixture-operation',
  parameters: {
    fixture_quantity: { value: 1, unit: 'fixture-unit' },
    fixture_text: 'fixture-value',
    fixture_number: 1,
    fixture_boolean: true
  },
  equipment_constraints: ['fixture-equipment'],
  acceptance_rules: ['fixture-acceptance-rule']
}

export const materialsPackageFeedbackRouteFixture: ManufacturingRouteV1 = {
  schema_version: 'ManufacturingRouteV1',
  id: 'fixture-route',
  version: 1,
  family: 'forging',
  input_form: 'fixture-input-form',
  output_form: 'fixture-output-form',
  steps: [materialsPackageFeedbackProcessStepFixture],
  feasibility: 'conditional',
  feasibility_reasons: ['fixture-condition']
}

export const materialsPackageFeedbackCandidateFixture: CandidateDesignV1 = {
  schema_version: 'CandidateDesignV1',
  id: 'fixture-candidate',
  version: 1,
  composition_ref: fixtureRef('material_composition', 'fixture-composition'),
  route_ref: fixtureRef('manufacturing_route', 'fixture-route'),
  prediction_refs: [fixtureRef('property_prediction', 'fixture-prediction')],
  evidence_claim_refs: [fixtureRef('evidence_claim', 'fixture-evidence-claim')],
  cost_estimate_ref: fixtureRef('cost_estimate', 'fixture-cost'),
  risk_refs: [fixtureRef('risk', 'fixture-risk')],
  status: 'generated',
  rejection_reasons: []
}

export const materialsPackageFeedbackExperimentDesignFixture: ExperimentDesignV1 =
  {
    schema_version: 'ExperimentDesignV1',
    id: 'fixture-experiment-design',
    version: 1,
    objective: 'Exercise the symbolic fixture contract',
    candidate_refs: [fixtureRef('candidate_design', 'fixture-candidate')],
    experiments: [
      {
        experiment_id: 'fixture-experiment',
        candidate_ref: fixtureRef('candidate_design', 'fixture-candidate'),
        factors: {
          fixture_quantity: { value: 1, unit: 'fixture-unit' },
          fixture_text: 'fixture-level',
          fixture_number: 1
        },
        planned_measurements: [
          {
            id: 'fixture-target-property',
            property: 'fixture-property',
            comparator: 'maximize',
            required: true,
            weight: 1
          }
        ],
        information_value: 1,
        estimated_cost: { value: 1, unit: 'fixture-currency' }
      }
    ],
    selection_method: 'fixture-selection-method',
    stopping_rule: 'fixture-stopping-rule'
  }

export const materialsPackageFeedbackChangeRequestFixture: ChangeRequestV1 = {
  id: 'fixture-change-request',
  target_ref: fixtureRef('property_prediction', 'fixture-prediction'),
  requested_changes: [
    {
      field_path: 'model.applicability_check',
      instruction: 'Review the symbolic applicability fixture'
    }
  ],
  reason: 'Fixture review requires an addressable change',
  requested_by: { kind: 'agent_run', id: 'fixture-critic-agent-run' }
}

export const materialsPackageFeedbackSignalFixture: FeedbackSignalV1 = {
  schema_version: 'FeedbackSignalV1',
  id: 'fixture-feedback',
  project_id: 'fixture-project',
  source: 'dependency_engine',
  source_ref: fixtureRef('dependency_engine_run', 'fixture-dependency-run'),
  category: 'changed_input',
  severity: 'warning',
  message: 'A symbolic fixture input changed',
  affected_refs: [fixtureRef('experiment_package', 'fixture-package')],
  proposed_action: 'replan_branch',
  created_at: fixtureTimestamp
}

export const materialsPackageFeedbackDependencyEdgeFixture: DependencyEdgeV1 = {
  from_ref: fixtureRef('material_composition', 'fixture-composition'),
  to_ref: fixtureRef('property_prediction', 'fixture-prediction'),
  relation: 'derived_from'
}

export const materialsPackageFeedbackInvalidationFixture: InvalidationEventV1 =
  {
    schema_version: 'InvalidationEventV1',
    id: 'fixture-invalidation',
    changed_ref: fixtureRef('material_composition', 'fixture-composition'),
    stale_refs: [fixtureRef('property_prediction', 'fixture-prediction')],
    reason: 'Symbolic fixture dependency changed',
    created_at: fixtureTimestamp
  }

export const materialsPackageFeedbackHumanGateRequestFixture: HumanGateRequestV1 =
  {
    schema_version: 'HumanGateRequestV1',
    id: 'fixture-human-gate-request',
    project_id: 'fixture-project',
    gate: 'experiment_package',
    object_ref: fixtureRef('experiment_package', 'fixture-package'),
    summary: 'Review the symbolic experiment package',
    assumptions: [fixtureRef('assumption', 'fixture-assumption')],
    estimated_cost: { value: 1, unit: 'fixture-currency' },
    estimated_duration: { value: 1, unit: 'h' },
    risk_summary: ['fixture-risk-summary'],
    created_at: fixtureTimestamp
  }

export const materialsPackageFeedbackHumanDecisionFixture: HumanDecisionV1 = {
  schema_version: 'HumanDecisionV1',
  id: 'fixture-human-decision',
  request_ref: fixtureRef('human_gate_request', 'fixture-human-gate-request'),
  decision: 'approve',
  feedback: 'Approved for the symbolic fixture only',
  requested_changes: [],
  decided_at: fixtureTimestamp,
  decided_by: { kind: 'engineer', id: 'fixture-engineer' }
}

export const materialsPackageFeedbackCritiqueFixture: CritiqueReportV1 = {
  schema_version: 'CritiqueReportV1',
  id: 'fixture-critique',
  version: 1,
  package_ref: fixtureRef('experiment_package', 'fixture-package'),
  critic_agent_run_ref: fixtureRef('agent_run', 'fixture-critic-agent-run'),
  verdict: 'pass',
  findings: [
    {
      severity: 'info',
      category: 'completeness',
      target_ref: fixtureRef('experiment_package', 'fixture-package'),
      message: 'The symbolic package is structurally complete'
    }
  ],
  created_at: fixtureTimestamp
}

export const materialsPackageFeedbackExperimentPackageFixture: ExperimentPackageV1 =
  {
    schema_version: 'ExperimentPackageV1',
    id: 'fixture-package',
    project_id: 'fixture-project',
    version: 1,
    goal_ref: fixtureRef('research_goal', 'fixture-goal'),
    graph_ref: fixtureRef('compiled_graph', 'fixture-graph'),
    run_ref: fixtureRef('materials_run', 'fixture-run'),
    assumptions: [fixtureRef('assumption', 'fixture-assumption')],
    open_risks: [fixtureRef('risk', 'fixture-risk')],
    evidence_claims: [fixtureRef('evidence_claim', 'fixture-evidence-claim')],
    candidate_designs: [fixtureRef('candidate_design', 'fixture-candidate')],
    pareto_selection: [fixtureRef('candidate_design', 'fixture-candidate')],
    experiment_design_ref: fixtureRef(
      'experiment_design',
      'fixture-experiment-design'
    ),
    critique_report_ref: fixtureRef('critique_report', 'fixture-critique'),
    artifact_manifest_ref: fixtureRef(
      'artifact_manifest',
      'fixture-artifact-manifest'
    ),
    status: 'approved_for_experiment',
    created_at: fixtureTimestamp,
    approved_decision_ref: fixtureRef(
      'human_decision',
      'fixture-human-decision'
    )
  }

export const materialsPackageFeedbackArtifactManifestFixture: ArtifactManifestV1 =
  {
    schema_version: 'ArtifactManifestV1',
    id: 'fixture-artifact-manifest',
    package_ref: fixtureRef('experiment_package', 'fixture-package'),
    artifacts: [
      {
        kind: 'markdown',
        path_or_uri: 'fixture-output.md',
      sha256: 'b'.repeat(64),
        generator_version: 'fixture-generator-v1',
        generated_at: fixtureTimestamp
      }
    ]
  }
