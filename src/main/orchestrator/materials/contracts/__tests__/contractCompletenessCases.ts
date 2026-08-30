import { z } from 'zod'
import {
  AgentResultV1Schema,
  AgentRunV1Schema,
  AgentSpecV1Schema,
  ArtifactManifestV1Schema,
  AssumptionV1Schema,
  CandidateDesignV1Schema,
  CapabilityRequestV1Schema,
  ChangeRequestV1Schema,
  ClaimProposalV1Schema,
  ClarificationQuestionV1Schema,
  CompiledGraphEdgeV1Schema,
  CompiledGraphV1Schema,
  CompiledGraphValidationV1Schema,
  CompiledNodeV1Schema,
  ContextBundleV1Schema,
  CritiqueReportV1Schema,
  DependencyEdgeV1Schema,
  EvidenceClaimV1Schema,
  ExperimentDesignV1Schema,
  ExperimentPackageV1Schema,
  FeedbackSignalV1Schema,
  HumanDecisionV1Schema,
  HumanGateRequestV1Schema,
  InvalidationEventV1Schema,
  KnowledgeRequestV1Schema,
  ManufacturingRouteV1Schema,
  MaterialCompositionV1Schema,
  ModelCardRefV1Schema,
  NodeSpecV1Schema,
  PlanDraftStageV1Schema,
  PlanDraftV1Schema,
  ProcessStepV1Schema,
  PropertyObservationV1Schema,
  PropertyPredictionV1Schema,
  ResearchGoalV1Schema,
  SourceDocumentV1Schema,
  SourceFragmentV1Schema,
  StructuredFailureV1Schema,
  StructuredQueryV1Schema,
  TargetPropertyV1Schema,
  ToolCallRequestV1Schema,
  ToolInvocationV1Schema,
  ToolSpecV1Schema,
  ValidationReportV1Schema
} from '../index'
import {
  agentResultFixture,
  agentRunFixture,
  agentSpecFixture,
  capabilityRequestFixture,
  contextBundleFixture,
  evidenceClaimFixture,
  knowledgeRequestFixture,
  reportedFactFixture,
  sourceDocumentFixture,
  sourceFragmentFixture,
  structuredQueryFixture,
  toolCallRequestFixture,
  toolInvocationFixture,
  toolSpecFixture,
  validationReportFixture,
  versionRefFixture
} from './agentsEvidenceTools.fixtures'
import {
  goalGraphCompiledGraphFixture,
  goalGraphGoldenGoalFixture,
  goalGraphNodeSpecFixture,
  goalGraphPlanDraftFixture
} from './goalGraphFixtures'
import {
  materialsPackageFeedbackArtifactManifestFixture,
  materialsPackageFeedbackCandidateFixture,
  materialsPackageFeedbackChangeRequestFixture,
  materialsPackageFeedbackCompositionFixture,
  materialsPackageFeedbackCritiqueFixture,
  materialsPackageFeedbackDependencyEdgeFixture,
  materialsPackageFeedbackExperimentDesignFixture,
  materialsPackageFeedbackExperimentPackageFixture,
  materialsPackageFeedbackHumanDecisionFixture,
  materialsPackageFeedbackHumanGateRequestFixture,
  materialsPackageFeedbackInvalidationFixture,
  materialsPackageFeedbackModelCardFixture,
  materialsPackageFeedbackProcessStepFixture,
  materialsPackageFeedbackPropertyObservationFixture,
  materialsPackageFeedbackPropertyPredictionFixture,
  materialsPackageFeedbackRouteFixture,
  materialsPackageFeedbackSignalFixture
} from './materialsPackageFeedback.fixtures'

export type FixtureObject = Record<string, unknown>

export type ContractCompletenessCase = {
  name: string
  schema: z.ZodType
  fullFixture: FixtureObject
  optionalRootFields: readonly string[]
  arbitraryUnknownRootFields?: readonly string[]
}

const fixture = (value: object): FixtureObject => value as FixtureObject

const failureFixture = {
  code: 'fixture_failure',
  category: 'validation' as const,
  message: 'Synthetic contract failure',
  retryable: false,
  details: { fixture: true },
  caused_by_ref: versionRefFixture
}

const targetPropertyFixture = {
  ...goalGraphGoldenGoalFixture.target_properties[0],
  target: { min: 1, target: 2, max: 3, unit: 'fixture-unit' },
  test_method: 'fixture-test-method'
}

const clarificationQuestionFixture = {
  id: 'fixture-question',
  field_path: 'target_properties.0.target',
  question: 'Confirm the symbolic target?',
  reason: 'A deterministic fixture needs an explicit answer.',
  required: true,
  proposed_default: { mode: 'symbolic' },
  status: 'open' as const
}

const researchGoalFixture = {
  ...goalGraphGoldenGoalFixture,
  supersedes_id: 'goal_aluminium_plate_v0',
  product: {
    ...goalGraphGoldenGoalFixture.product,
    geometry: {
      length: { value: 100, unit: 'mm' },
      width: { value: 50, unit: 'mm' },
      thickness: { value: 5, unit: 'mm' }
    }
  },
  service_conditions: {
    ...goalGraphGoldenGoalFixture.service_conditions,
    peak_duration: { value: 10, unit: 'min' },
    environment: 'synthetic-fixture-environment'
  },
  composition_constraints: {
    ...goalGraphGoldenGoalFixture.composition_constraints,
    max_total_alloying_fraction: { value: 0.2, unit: 'mass_fraction' }
  },
  manufacturing_constraints: {
    ...goalGraphGoldenGoalFixture.manufacturing_constraints,
    stock_form: 'fixture-stock-form'
  },
  business_constraints: {
    ...goalGraphGoldenGoalFixture.business_constraints,
    budget_limit: { value: 1000, unit: 'fixture-currency' },
    deadline: '2026-12-31T00:00:00.000Z'
  },
  open_questions: [clarificationQuestionFixture]
}

const planDraftStageFixture = goalGraphPlanDraftFixture.stages[0]
const compiledNodeFixture = goalGraphCompiledGraphFixture.nodes[0]
const compiledGraphEdgeFixture = goalGraphCompiledGraphFixture.edges[0]
const compiledGraphValidationFixture = goalGraphCompiledGraphFixture.validation

const agentRunFullFixture = {
  ...agentRunFixture,
  finished_at: '2026-08-28T12:04:00.000Z',
  result_ref: {
    ...versionRefFixture,
    entity_type: 'AgentResultV1',
    entity_id: 'agent-result-1'
  },
  failure: failureFixture
}

const toolInvocationFullFixture = {
  ...toolInvocationFixture,
  failure: failureFixture
}

const experimentPackageFullFixture = {
  ...materialsPackageFeedbackExperimentPackageFixture,
  status: 'draft' as const
}

const critiqueReportFullFixture = {
  ...materialsPackageFeedbackCritiqueFixture,
  findings: materialsPackageFeedbackCritiqueFixture.findings.map((finding) => ({
    ...finding,
    requested_change: 'Keep the symbolic fixture addressable.'
  }))
}

export const contractCases: readonly ContractCompletenessCase[] = [
  {
    name: 'StructuredFailureV1Schema',
    schema: StructuredFailureV1Schema,
    fullFixture: fixture(failureFixture),
    optionalRootFields: ['details', 'caused_by_ref']
  },
  {
    name: 'TargetPropertyV1Schema',
    schema: TargetPropertyV1Schema,
    fullFixture: fixture(targetPropertyFixture),
    optionalRootFields: ['target', 'test_temperature', 'prior_exposure', 'test_method']
  },
  {
    name: 'ClarificationQuestionV1Schema',
    schema: ClarificationQuestionV1Schema,
    fullFixture: fixture(clarificationQuestionFixture),
    optionalRootFields: ['proposed_default']
  },
  {
    name: 'AssumptionV1Schema',
    schema: AssumptionV1Schema,
    fullFixture: fixture(goalGraphGoldenGoalFixture.assumptions[0]),
    optionalRootFields: []
  },
  {
    name: 'ResearchGoalV1Schema',
    schema: ResearchGoalV1Schema,
    fullFixture: fixture(researchGoalFixture),
    optionalRootFields: ['supersedes_id']
  },
  {
    name: 'PlanDraftStageV1Schema',
    schema: PlanDraftStageV1Schema,
    fullFixture: fixture(planDraftStageFixture),
    optionalRootFields: ['proposed_parallel_group']
  },
  {
    name: 'PlanDraftV1Schema',
    schema: PlanDraftV1Schema,
    fullFixture: fixture(goalGraphPlanDraftFixture),
    optionalRootFields: []
  },
  {
    name: 'NodeSpecV1Schema',
    schema: NodeSpecV1Schema,
    fullFixture: fixture(goalGraphNodeSpecFixture),
    optionalRootFields: ['required_capability']
  },
  {
    name: 'CompiledNodeV1Schema',
    schema: CompiledNodeV1Schema,
    fullFixture: fixture(compiledNodeFixture),
    optionalRootFields: []
  },
  {
    name: 'CompiledGraphEdgeV1Schema',
    schema: CompiledGraphEdgeV1Schema,
    fullFixture: fixture(compiledGraphEdgeFixture),
    optionalRootFields: []
  },
  {
    name: 'CompiledGraphValidationV1Schema',
    schema: CompiledGraphValidationV1Schema,
    fullFixture: fixture(compiledGraphValidationFixture),
    optionalRootFields: []
  },
  {
    name: 'CompiledGraphV1Schema',
    schema: CompiledGraphV1Schema,
    fullFixture: fixture(goalGraphCompiledGraphFixture),
    optionalRootFields: ['estimated_cost', 'estimated_duration']
  },
  {
    name: 'SourceDocumentV1Schema',
    schema: SourceDocumentV1Schema,
    fullFixture: fixture(sourceDocumentFixture),
    optionalRootFields: ['publication_year', 'doi']
  },
  {
    name: 'SourceFragmentV1Schema',
    schema: SourceFragmentV1Schema,
    fullFixture: fixture(sourceFragmentFixture),
    optionalRootFields: []
  },
  {
    name: 'ClaimProposalV1Schema',
    schema: ClaimProposalV1Schema,
    fullFixture: fixture(reportedFactFixture),
    optionalRootFields: ['confidence']
  },
  {
    name: 'EvidenceClaimV1Schema',
    schema: EvidenceClaimV1Schema,
    fullFixture: fixture(evidenceClaimFixture),
    optionalRootFields: ['confidence', 'verified_by']
  },
  {
    name: 'ContextBundleV1Schema',
    schema: ContextBundleV1Schema,
    fullFixture: fixture(contextBundleFixture),
    optionalRootFields: []
  },
  {
    name: 'KnowledgeRequestV1Schema',
    schema: KnowledgeRequestV1Schema,
    fullFixture: fixture(knowledgeRequestFixture),
    optionalRootFields: []
  },
  {
    name: 'StructuredQueryV1Schema',
    schema: StructuredQueryV1Schema,
    fullFixture: fixture(structuredQueryFixture),
    optionalRootFields: []
  },
  {
    name: 'AgentSpecV1Schema',
    schema: AgentSpecV1Schema,
    fullFixture: fixture(agentSpecFixture),
    optionalRootFields: []
  },
  {
    name: 'AgentRunV1Schema',
    schema: AgentRunV1Schema,
    fullFixture: fixture(agentRunFullFixture),
    optionalRootFields: ['started_at', 'finished_at', 'result_ref', 'failure']
  },
  {
    name: 'AgentResultV1Schema',
    schema: AgentResultV1Schema,
    fullFixture: fixture(agentResultFixture),
    optionalRootFields: [],
    arbitraryUnknownRootFields: ['output']
  },
  {
    name: 'CapabilityRequestV1Schema',
    schema: CapabilityRequestV1Schema,
    fullFixture: fixture(capabilityRequestFixture),
    optionalRootFields: []
  },
  {
    name: 'ToolSpecV1Schema',
    schema: ToolSpecV1Schema,
    fullFixture: fixture(toolSpecFixture),
    optionalRootFields: []
  },
  {
    name: 'ToolInvocationV1Schema',
    schema: ToolInvocationV1Schema,
    fullFixture: fixture(toolInvocationFullFixture),
    optionalRootFields: ['output_ref', 'failure', 'started_at', 'finished_at']
  },
  {
    name: 'ToolCallRequestV1Schema',
    schema: ToolCallRequestV1Schema,
    fullFixture: fixture(toolCallRequestFixture),
    optionalRootFields: []
  },
  {
    name: 'ValidationReportV1Schema',
    schema: ValidationReportV1Schema,
    fullFixture: fixture(validationReportFixture),
    optionalRootFields: []
  },
  {
    name: 'PropertyObservationV1Schema',
    schema: PropertyObservationV1Schema,
    fullFixture: fixture(materialsPackageFeedbackPropertyObservationFixture),
    optionalRootFields: ['prior_exposure', 'test_method', 'specimen', 'uncertainty']
  },
  {
    name: 'ModelCardRefV1Schema',
    schema: ModelCardRefV1Schema,
    fullFixture: fixture(materialsPackageFeedbackModelCardFixture),
    optionalRootFields: ['metrics_ref']
  },
  {
    name: 'PropertyPredictionV1Schema',
    schema: PropertyPredictionV1Schema,
    fullFixture: fixture(materialsPackageFeedbackPropertyPredictionFixture),
    optionalRootFields: ['interval', 'prior_exposure']
  },
  {
    name: 'MaterialCompositionV1Schema',
    schema: MaterialCompositionV1Schema,
    fullFixture: fixture(materialsPackageFeedbackCompositionFixture),
    optionalRootFields: []
  },
  {
    name: 'ProcessStepV1Schema',
    schema: ProcessStepV1Schema,
    fullFixture: fixture(materialsPackageFeedbackProcessStepFixture),
    optionalRootFields: []
  },
  {
    name: 'ManufacturingRouteV1Schema',
    schema: ManufacturingRouteV1Schema,
    fullFixture: fixture(materialsPackageFeedbackRouteFixture),
    optionalRootFields: []
  },
  {
    name: 'CandidateDesignV1Schema',
    schema: CandidateDesignV1Schema,
    fullFixture: fixture(materialsPackageFeedbackCandidateFixture),
    optionalRootFields: ['cost_estimate_ref']
  },
  {
    name: 'ExperimentDesignV1Schema',
    schema: ExperimentDesignV1Schema,
    fullFixture: fixture(materialsPackageFeedbackExperimentDesignFixture),
    optionalRootFields: []
  },
  {
    name: 'FeedbackSignalV1Schema',
    schema: FeedbackSignalV1Schema,
    fullFixture: fixture(materialsPackageFeedbackSignalFixture),
    optionalRootFields: []
  },
  {
    name: 'ChangeRequestV1Schema',
    schema: ChangeRequestV1Schema,
    fullFixture: fixture(materialsPackageFeedbackChangeRequestFixture),
    optionalRootFields: []
  },
  {
    name: 'DependencyEdgeV1Schema',
    schema: DependencyEdgeV1Schema,
    fullFixture: fixture(materialsPackageFeedbackDependencyEdgeFixture),
    optionalRootFields: []
  },
  {
    name: 'InvalidationEventV1Schema',
    schema: InvalidationEventV1Schema,
    fullFixture: fixture(materialsPackageFeedbackInvalidationFixture),
    optionalRootFields: []
  },
  {
    name: 'HumanGateRequestV1Schema',
    schema: HumanGateRequestV1Schema,
    fullFixture: fixture(materialsPackageFeedbackHumanGateRequestFixture),
    optionalRootFields: ['estimated_cost', 'estimated_duration']
  },
  {
    name: 'HumanDecisionV1Schema',
    schema: HumanDecisionV1Schema,
    fullFixture: fixture(materialsPackageFeedbackHumanDecisionFixture),
    optionalRootFields: []
  },
  {
    name: 'CritiqueReportV1Schema',
    schema: CritiqueReportV1Schema,
    fullFixture: fixture(critiqueReportFullFixture),
    optionalRootFields: []
  },
  {
    name: 'ExperimentPackageV1Schema',
    schema: ExperimentPackageV1Schema,
    fullFixture: fixture(experimentPackageFullFixture),
    optionalRootFields: ['artifact_manifest_ref', 'approved_decision_ref']
  },
  {
    name: 'ArtifactManifestV1Schema',
    schema: ArtifactManifestV1Schema,
    fullFixture: fixture(materialsPackageFeedbackArtifactManifestFixture),
    optionalRootFields: []
  }
]

export const clone = (value: FixtureObject): FixtureObject => structuredClone(value)

export const removeOptionalRootFields = (
  testCase: ContractCompletenessCase
): FixtureObject => {
  const minimal = clone(testCase.fullFixture)
  for (const field of testCase.optionalRootFields) delete minimal[field]
  return minimal
}

export const requiredRootFields = (testCase: ContractCompletenessCase): string[] =>
  Object.keys(testCase.fullFixture).filter(
    (field) => !testCase.optionalRootFields.includes(field)
  )

export const wrongTypeFor = (value: unknown): unknown => {
  if (Array.isArray(value)) return { fixture_wrong_type: true }
  if (typeof value === 'string') return 101
  if (typeof value === 'number') return 'fixture_wrong_type'
  if (typeof value === 'boolean') return 'fixture_wrong_type'
  if (typeof value === 'object' && value !== null) return 'fixture_wrong_type'
  return { fixture_wrong_type: true }
}
