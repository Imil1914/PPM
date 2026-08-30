import { z } from 'zod'
import {
  EntityIdSchema,
  NonEmptyStringSchema,
  NonNegativeFiniteNumberSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  PriorExposureSchema,
  ProvenanceRefSchema,
  QuantitySchema,
  RouteFamilySchema,
  VersionRefSchema
} from './common'
import { TargetPropertyV1Schema } from './goal'

export const PropertyQualityLevelSchema = z.enum([
  'screening',
  'reported',
  'verified',
  'reference_grade'
])

export const PropertyObservationV1Schema = z
  .object({
    schema_version: z.literal('PropertyObservationV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    material_ref: VersionRefSchema,
    route_ref: VersionRefSchema,
    property: NonEmptyStringSchema,
    value: QuantitySchema,
    test_temperature: QuantitySchema,
    prior_exposure: PriorExposureSchema.optional(),
    test_method: NonEmptyStringSchema.optional(),
    specimen: NonEmptyStringSchema.optional(),
    uncertainty: QuantitySchema.optional(),
    evidence: ProvenanceRefSchema,
    quality_level: PropertyQualityLevelSchema
  })
  .strict()

export const ModelApplicabilityCheckSchema = z.enum([
  'inside',
  'borderline',
  'outside',
  'unknown'
])

export const ModelCardRefV1Schema = z
  .object({
    model_id: NonEmptyStringSchema,
    model_version: NonEmptyStringSchema,
    training_domain: NonEmptyStringSchema,
    applicability_check: ModelApplicabilityCheckSchema,
    metrics_ref: VersionRefSchema.optional()
  })
  .strict()

export const PropertyPredictionIntervalSchema = z
  .object({
    lower: QuantitySchema,
    upper: QuantitySchema,
    level: z.number().finite().min(0).max(1)
  })
  .strict()

export const PropertyPredictionV1Schema = z
  .object({
    schema_version: z.literal('PropertyPredictionV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    candidate_ref: VersionRefSchema,
    property: NonEmptyStringSchema,
    prediction: QuantitySchema,
    interval: PropertyPredictionIntervalSchema.optional(),
    test_temperature: QuantitySchema,
    prior_exposure: PriorExposureSchema.optional(),
    model: ModelCardRefV1Schema,
    input_snapshot_ref: VersionRefSchema,
    warnings: z.array(NonEmptyStringSchema)
  })
  .strict()

export const CompositionBasisSchema = z.enum([
  'mass_fraction',
  'atomic_fraction'
])
export const MaterialCompositionStatusSchema = z.enum([
  'hypothesis',
  'supported_candidate',
  'rejected'
])

export const MaterialCompositionComponentSchema = z
  .object({
    element: NonEmptyStringSchema,
    fraction: z.number().finite().min(0).max(1),
    tolerance: z.number().finite().min(0).max(1).optional()
  })
  .strict()

export const MaterialCompositionV1Schema = z
  .object({
    schema_version: z.literal('MaterialCompositionV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    basis: CompositionBasisSchema,
    components: z.array(MaterialCompositionComponentSchema),
    balance_element: z.literal('Al'),
    status: MaterialCompositionStatusSchema
  })
  .strict()

const ProcessParameterValueSchema = z.union([
  QuantitySchema,
  z.string(),
  z.number().finite(),
  z.boolean()
])

export const ProcessStepV1Schema = z
  .object({
    id: EntityIdSchema,
    order: NonNegativeIntegerSchema,
    operation: NonEmptyStringSchema,
    parameters: z.record(z.string(), ProcessParameterValueSchema),
    equipment_constraints: z.array(NonEmptyStringSchema),
    acceptance_rules: z.array(NonEmptyStringSchema)
  })
  .strict()

export const RouteFeasibilitySchema = z.enum([
  'unknown',
  'feasible',
  'conditional',
  'infeasible'
])

export const ManufacturingRouteV1Schema = z
  .object({
    schema_version: z.literal('ManufacturingRouteV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    family: RouteFamilySchema,
    input_form: NonEmptyStringSchema,
    output_form: NonEmptyStringSchema,
    steps: z.array(ProcessStepV1Schema),
    feasibility: RouteFeasibilitySchema,
    feasibility_reasons: z.array(NonEmptyStringSchema)
  })
  .strict()

export const CandidateDesignStatusSchema = z.enum([
  'generated',
  'screened',
  'pareto',
  'selected_for_doe',
  'rejected'
])

export const CandidateDesignV1Schema = z
  .object({
    schema_version: z.literal('CandidateDesignV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    composition_ref: VersionRefSchema,
    route_ref: VersionRefSchema,
    prediction_refs: z.array(VersionRefSchema),
    evidence_claim_refs: z.array(VersionRefSchema),
    cost_estimate_ref: VersionRefSchema.optional(),
    risk_refs: z.array(VersionRefSchema),
    status: CandidateDesignStatusSchema,
    rejection_reasons: z.array(NonEmptyStringSchema)
  })
  .strict()

const ExperimentFactorValueSchema = z.union([
  QuantitySchema,
  z.string(),
  z.number().finite()
])

export const ExperimentPlanItemSchema = z
  .object({
    experiment_id: EntityIdSchema,
    candidate_ref: VersionRefSchema,
    factors: z.record(z.string(), ExperimentFactorValueSchema),
    planned_measurements: z.array(TargetPropertyV1Schema),
    information_value: NonNegativeFiniteNumberSchema,
    estimated_cost: QuantitySchema.optional()
  })
  .strict()

export const ExperimentDesignV1Schema = z
  .object({
    schema_version: z.literal('ExperimentDesignV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    objective: NonEmptyStringSchema,
    candidate_refs: z.array(VersionRefSchema),
    experiments: z.array(ExperimentPlanItemSchema),
    selection_method: NonEmptyStringSchema,
    stopping_rule: NonEmptyStringSchema
  })
  .strict()

export type PropertyQualityLevel = z.infer<typeof PropertyQualityLevelSchema>
export type PropertyObservationV1 = z.infer<typeof PropertyObservationV1Schema>
export type ModelApplicabilityCheck = z.infer<
  typeof ModelApplicabilityCheckSchema
>
export type ModelCardRefV1 = z.infer<typeof ModelCardRefV1Schema>
export type PropertyPredictionInterval = z.infer<
  typeof PropertyPredictionIntervalSchema
>
export type PropertyPredictionV1 = z.infer<typeof PropertyPredictionV1Schema>
export type CompositionBasis = z.infer<typeof CompositionBasisSchema>
export type MaterialCompositionStatus = z.infer<
  typeof MaterialCompositionStatusSchema
>
export type MaterialCompositionComponent = z.infer<
  typeof MaterialCompositionComponentSchema
>
export type MaterialCompositionV1 = z.infer<typeof MaterialCompositionV1Schema>
export type ProcessStepV1 = z.infer<typeof ProcessStepV1Schema>
export type RouteFeasibility = z.infer<typeof RouteFeasibilitySchema>
export type ManufacturingRouteV1 = z.infer<typeof ManufacturingRouteV1Schema>
export type CandidateDesignStatus = z.infer<typeof CandidateDesignStatusSchema>
export type CandidateDesignV1 = z.infer<typeof CandidateDesignV1Schema>
export type ExperimentPlanItem = z.infer<typeof ExperimentPlanItemSchema>
export type ExperimentDesignV1 = z.infer<typeof ExperimentDesignV1Schema>
