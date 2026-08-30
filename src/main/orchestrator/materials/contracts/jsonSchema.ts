import { z } from 'zod'
import {
  AgentResultV1Schema,
  AgentRunV1Schema,
  AgentSpecV1Schema,
  CapabilityRequestV1Schema
} from './agents'
import { StructuredFailureV1Schema } from './common'
import {
  ClaimProposalV1Schema,
  ContextBundleV1Schema,
  EvidenceClaimV1Schema,
  KnowledgeRequestV1Schema,
  SourceDocumentV1Schema,
  SourceFragmentV1Schema,
  StructuredQueryV1Schema
} from './evidence'
import {
  ChangeRequestV1Schema,
  DependencyEdgeV1Schema,
  FeedbackSignalV1Schema,
  InvalidationEventV1Schema
} from './feedback'
import {
  AssumptionV1Schema,
  ClarificationQuestionV1Schema,
  ResearchGoalV1Schema,
  TargetPropertyV1Schema
} from './goal'
import {
  CompiledGraphEdgeV1Schema,
  CompiledGraphV1Schema,
  CompiledGraphValidationV1Schema,
  CompiledNodeV1Schema,
  NodeSpecV1Schema,
  PlanDraftStageV1Schema,
  PlanDraftV1Schema
} from './graph'
import {
  CandidateDesignV1Schema,
  ExperimentDesignV1Schema,
  ManufacturingRouteV1Schema,
  MaterialCompositionV1Schema,
  ModelCardRefV1Schema,
  ProcessStepV1Schema,
  PropertyObservationV1Schema,
  PropertyPredictionV1Schema
} from './materials'
import {
  ArtifactManifestV1Schema,
  CritiqueReportV1Schema,
  ExperimentPackageV1Schema,
  HumanDecisionV1Schema,
  HumanGateRequestV1Schema
} from './package'
import {
  ToolCallRequestV1Schema,
  ToolInvocationV1Schema,
  ToolSpecV1Schema,
  ValidationReportV1Schema
} from './tools'

export const MATERIALS_JSON_SCHEMA_DIALECT =
  'https://json-schema.org/draft/2020-12/schema' as const

export const MATERIALS_JSON_SCHEMA_OPTIONS = Object.freeze({
  target: 'draft-2020-12' as const,
  io: 'input' as const,
  unrepresentable: 'throw' as const,
  cycles: 'throw' as const,
  reused: 'inline' as const
})

export const materialsV1ContractRegistry = Object.freeze({
  AgentResultV1: AgentResultV1Schema,
  AgentRunV1: AgentRunV1Schema,
  AgentSpecV1: AgentSpecV1Schema,
  ArtifactManifestV1: ArtifactManifestV1Schema,
  AssumptionV1: AssumptionV1Schema,
  CandidateDesignV1: CandidateDesignV1Schema,
  CapabilityRequestV1: CapabilityRequestV1Schema,
  ChangeRequestV1: ChangeRequestV1Schema,
  ClaimProposalV1: ClaimProposalV1Schema,
  ClarificationQuestionV1: ClarificationQuestionV1Schema,
  CompiledGraphEdgeV1: CompiledGraphEdgeV1Schema,
  CompiledGraphV1: CompiledGraphV1Schema,
  CompiledGraphValidationV1: CompiledGraphValidationV1Schema,
  CompiledNodeV1: CompiledNodeV1Schema,
  ContextBundleV1: ContextBundleV1Schema,
  CritiqueReportV1: CritiqueReportV1Schema,
  DependencyEdgeV1: DependencyEdgeV1Schema,
  EvidenceClaimV1: EvidenceClaimV1Schema,
  ExperimentDesignV1: ExperimentDesignV1Schema,
  ExperimentPackageV1: ExperimentPackageV1Schema,
  FeedbackSignalV1: FeedbackSignalV1Schema,
  HumanDecisionV1: HumanDecisionV1Schema,
  HumanGateRequestV1: HumanGateRequestV1Schema,
  InvalidationEventV1: InvalidationEventV1Schema,
  KnowledgeRequestV1: KnowledgeRequestV1Schema,
  ManufacturingRouteV1: ManufacturingRouteV1Schema,
  MaterialCompositionV1: MaterialCompositionV1Schema,
  ModelCardRefV1: ModelCardRefV1Schema,
  NodeSpecV1: NodeSpecV1Schema,
  PlanDraftStageV1: PlanDraftStageV1Schema,
  PlanDraftV1: PlanDraftV1Schema,
  ProcessStepV1: ProcessStepV1Schema,
  PropertyObservationV1: PropertyObservationV1Schema,
  PropertyPredictionV1: PropertyPredictionV1Schema,
  ResearchGoalV1: ResearchGoalV1Schema,
  SourceDocumentV1: SourceDocumentV1Schema,
  SourceFragmentV1: SourceFragmentV1Schema,
  StructuredFailureV1: StructuredFailureV1Schema,
  StructuredQueryV1: StructuredQueryV1Schema,
  TargetPropertyV1: TargetPropertyV1Schema,
  ToolCallRequestV1: ToolCallRequestV1Schema,
  ToolInvocationV1: ToolInvocationV1Schema,
  ToolSpecV1: ToolSpecV1Schema,
  ValidationReportV1: ValidationReportV1Schema
} as const satisfies Readonly<Record<`${string}V1`, z.ZodType>>)

export type MaterialsV1ContractName = keyof typeof materialsV1ContractRegistry

export type MaterialsV1ContractSchema<Name extends MaterialsV1ContractName> =
  (typeof materialsV1ContractRegistry)[Name]

export type MaterialsV1ContractInput<Name extends MaterialsV1ContractName> = z.input<
  MaterialsV1ContractSchema<Name>
>

export type MaterialsV1ContractOutput<Name extends MaterialsV1ContractName> = z.output<
  MaterialsV1ContractSchema<Name>
>

export type MaterialsJsonPrimitive = null | boolean | number | string
export type MaterialsJsonValue =
  | MaterialsJsonPrimitive
  | readonly MaterialsJsonValue[]
  | { readonly [key: string]: MaterialsJsonValue }

export type MaterialsJsonSchema = Readonly<
  {
    $schema: typeof MATERIALS_JSON_SCHEMA_DIALECT
  } & Record<string, MaterialsJsonValue>
>

export type MaterialsV1JsonSchemaCatalog = Readonly<{
  [Name in MaterialsV1ContractName]: MaterialsJsonSchema
}>

const sortedContractNames = Object.keys(materialsV1ContractRegistry).sort() as Array<
  MaterialsV1ContractName
>

export const materialsV1ContractNames: readonly MaterialsV1ContractName[] =
  Object.freeze(sortedContractNames)

export const getMaterialsV1ContractSchema = <Name extends MaterialsV1ContractName>(
  name: Name
): MaterialsV1ContractSchema<Name> => materialsV1ContractRegistry[name]

const canonicalizeMaterialsJsonValue = (
  value: unknown,
  ancestors: WeakSet<object>
): MaterialsJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot contain a non-finite number')
    }
    return value
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError('Canonical JSON cannot contain a cycle')
    }

    ancestors.add(value)
    try {
      return Object.freeze(
        value.map((item) => canonicalizeMaterialsJsonValue(item, ancestors))
      )
    } finally {
      ancestors.delete(value)
    }
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON can contain only plain objects')
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON cannot contain symbol keys')
    }

    if (ancestors.has(value)) {
      throw new TypeError('Canonical JSON cannot contain a cycle')
    }

    ancestors.add(value)
    try {
      const record = value as Record<string, unknown>
      const entries = Object.keys(record)
        .sort()
        .map(
          (key) =>
            [key, canonicalizeMaterialsJsonValue(record[key], ancestors)] as const
        )

      return Object.freeze(Object.fromEntries(entries))
    } finally {
      ancestors.delete(value)
    }
  }

  throw new TypeError(`Value of type ${typeof value} is not JSON-serializable`)
}

export const canonicalizeMaterialsJson = (value: unknown): MaterialsJsonValue =>
  canonicalizeMaterialsJsonValue(value, new WeakSet<object>())

const normalizeGeneratedSchema = (generated: unknown): MaterialsJsonSchema => {
  const validated = canonicalizeMaterialsJson(generated)
  const serialized = JSON.stringify(validated)
  if (serialized === undefined) {
    throw new TypeError('Generated JSON Schema is not JSON-serializable')
  }

  const normalized = JSON.parse(serialized) as unknown
  const canonical = canonicalizeMaterialsJson(normalized)
  if (
    canonical === null ||
    Array.isArray(canonical) ||
    typeof canonical !== 'object'
  ) {
    throw new TypeError('Generated schema does not declare JSON Schema Draft 2020-12')
  }

  if (
    (canonical as Readonly<Record<string, MaterialsJsonValue>>).$schema !==
    MATERIALS_JSON_SCHEMA_DIALECT
  ) {
    throw new TypeError('Generated schema does not declare JSON Schema Draft 2020-12')
  }

  return canonical as MaterialsJsonSchema
}

export const generateMaterialsV1JsonSchema = <Name extends MaterialsV1ContractName>(
  name: Name
): MaterialsJsonSchema =>
  normalizeGeneratedSchema(
    z.toJSONSchema(getMaterialsV1ContractSchema(name), MATERIALS_JSON_SCHEMA_OPTIONS)
  )

export const generateMaterialsV1JsonSchemaCatalog = (): MaterialsV1JsonSchemaCatalog => {
  const catalog = Object.fromEntries(
    materialsV1ContractNames.map((name) => [name, generateMaterialsV1JsonSchema(name)])
  )

  return Object.freeze(catalog) as MaterialsV1JsonSchemaCatalog
}

export const serializeMaterialsV1JsonSchemaCatalog = (
  catalog: MaterialsV1JsonSchemaCatalog = generateMaterialsV1JsonSchemaCatalog()
): string => JSON.stringify(canonicalizeMaterialsJson(catalog), null, 2)
