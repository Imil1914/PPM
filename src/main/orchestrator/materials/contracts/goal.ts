import { z } from 'zod'
import {
  ActorRefSchema,
  ArtifactKindSchema,
  EntityIdSchema,
  IntervalQuantitySchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeFiniteNumberSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  PriorExposureSchema,
  QuantitySchema,
  RiskLevelSchema,
  RouteFamilySchema
} from './common'

export const TargetPropertyComparatorSchema = z.enum([
  'gte',
  'lte',
  'range',
  'maximize',
  'minimize'
])

export const TargetPropertyV1Schema = z
  .object({
    id: EntityIdSchema,
    property: NonEmptyStringSchema,
    comparator: TargetPropertyComparatorSchema,
    target: IntervalQuantitySchema.optional(),
    test_temperature: QuantitySchema.optional(),
    prior_exposure: PriorExposureSchema.optional(),
    test_method: NonEmptyStringSchema.optional(),
    required: z.boolean(),
    weight: NonNegativeFiniteNumberSchema
  })
  .strict()

export const ClarificationQuestionStatusSchema = z.enum(['open', 'answered', 'waived'])

export const ClarificationQuestionV1Schema = z
  .object({
    id: EntityIdSchema,
    field_path: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    required: z.boolean(),
    proposed_default: z.unknown().optional(),
    status: ClarificationQuestionStatusSchema
  })
  .strict()

export const AssumptionSourceSchema = z.enum(['engineer', 'system_default', 'inference'])

export const AssumptionV1Schema = z
  .object({
    id: EntityIdSchema,
    statement: NonEmptyStringSchema,
    rationale: NonEmptyStringSchema,
    source: AssumptionSourceSchema,
    risk: RiskLevelSchema,
    confirmed_by_engineer: z.boolean()
  })
  .strict()

const ProductV1Schema = z
  .object({
    kind: z.literal('structural_plate'),
    material_family: z.literal('aluminium_alloy'),
    description: NonEmptyStringSchema,
    geometry: z.record(NonEmptyStringSchema, QuantitySchema).optional()
  })
  .strict()

const ServiceConditionsV1Schema = z
  .object({
    nominal_temperature: QuantitySchema,
    exposure_duration: QuantitySchema,
    peak_temperature: QuantitySchema.optional(),
    peak_duration: QuantitySchema.optional(),
    environment: NonEmptyStringSchema.optional()
  })
  .strict()

const CompositionConstraintsV1Schema = z
  .object({
    required_elements: z.array(NonEmptyStringSchema),
    allowed_elements: z.array(NonEmptyStringSchema),
    forbidden_elements: z.array(NonEmptyStringSchema),
    max_total_alloying_fraction: QuantitySchema.optional()
  })
  .strict()

const ManufacturingConstraintsV1Schema = z
  .object({
    allowed_route_families: z.array(RouteFamilySchema).min(1),
    forbidden_operations: z.array(NonEmptyStringSchema),
    available_equipment: z.array(NonEmptyStringSchema),
    stock_form: NonEmptyStringSchema.optional()
  })
  .strict()

const PriorityWeightsSchema = z
  .record(NonEmptyStringSchema, NonNegativeFiniteNumberSchema)
  .refine((weights) => Object.values(weights).reduce((sum, weight) => sum + weight, 0) > 0, {
    message: 'Priority weights must have a positive total'
  })

const BusinessConstraintsV1Schema = z
  .object({
    budget_limit: QuantitySchema.optional(),
    deadline: IsoDateTimeSchema.optional(),
    maximum_physical_experiments: NonNegativeIntegerSchema.optional(),
    priority_weights: PriorityWeightsSchema
  })
  .strict()

export const ResearchGoalV1Schema = z
  .object({
    schema_version: z.literal('ResearchGoalV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    version: PositiveIntegerSchema,
    supersedes_id: EntityIdSchema.optional(),
    title: NonEmptyStringSchema,
    product: ProductV1Schema,
    service_conditions: ServiceConditionsV1Schema,
    target_properties: z.array(TargetPropertyV1Schema).min(1),
    composition_constraints: CompositionConstraintsV1Schema,
    manufacturing_constraints: ManufacturingConstraintsV1Schema,
    business_constraints: BusinessConstraintsV1Schema,
    required_outputs: z.array(ArtifactKindSchema),
    assumptions: z.array(AssumptionV1Schema),
    open_questions: z.array(ClarificationQuestionV1Schema),
    created_at: IsoDateTimeSchema,
    created_by: ActorRefSchema
  })
  .strict()
  .superRefine((goal, context) => {
    const targetWeightTotal = goal.target_properties.reduce(
      (sum, property) => sum + property.weight,
      0
    )
    if (targetWeightTotal <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['target_properties'],
        message: 'Target property weights must have a positive total'
      })
    }

    const forbiddenElements = new Set(goal.composition_constraints.forbidden_elements)
    for (const [index, element] of goal.composition_constraints.required_elements.entries()) {
      if (forbiddenElements.has(element)) {
        context.addIssue({
          code: 'custom',
          path: ['composition_constraints', 'required_elements', index],
          message: `Element ${element} cannot be both required and forbidden`
        })
      }
    }
  })

export type TargetPropertyComparator = z.infer<typeof TargetPropertyComparatorSchema>
export type TargetPropertyV1 = z.infer<typeof TargetPropertyV1Schema>
export type ClarificationQuestionStatus = z.infer<typeof ClarificationQuestionStatusSchema>
export type ClarificationQuestionV1 = z.infer<typeof ClarificationQuestionV1Schema>
export type AssumptionSource = z.infer<typeof AssumptionSourceSchema>
export type AssumptionV1 = z.infer<typeof AssumptionV1Schema>
export type ResearchGoalV1 = z.infer<typeof ResearchGoalV1Schema>
