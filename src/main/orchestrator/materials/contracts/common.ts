import { z } from 'zod'

const hasNoOuterWhitespace = (value: string): boolean => value === value.trim()

export const NonEmptyStringSchema = z
  .string()
  .min(1)
  .refine(hasNoOuterWhitespace, 'String must not have leading or trailing whitespace')

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, 'EntityId contains unsafe characters')

export const IsoDateTimeSchema = z.iso.datetime()

export const PositiveIntegerSchema = z.number().int().positive()
export const NonNegativeIntegerSchema = z.number().int().nonnegative()
export const NonNegativeFiniteNumberSchema = z.number().finite().nonnegative()

export const ActorKindSchema = z.enum(['engineer', 'agent_run', 'system', 'tool'])

export const ActorRefSchema = z
  .object({
    kind: ActorKindSchema,
    id: EntityIdSchema
  })
  .strict()

export const VersionRefSchema = z
  .object({
    entity_type: NonEmptyStringSchema,
    entity_id: EntityIdSchema,
    version: PositiveIntegerSchema
  })
  .strict()

export const SourceLocatorSchema = z
  .object({
    page: PositiveIntegerSchema.optional(),
    table: NonEmptyStringSchema.optional(),
    figure: NonEmptyStringSchema.optional(),
    section: NonEmptyStringSchema.optional(),
    cell_range: NonEmptyStringSchema.optional(),
    char_start: NonNegativeIntegerSchema.optional(),
    char_end: NonNegativeIntegerSchema.optional()
  })
  .strict()
  .superRefine((locator, context) => {
    if (Object.values(locator).every((value) => value === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Locator must identify at least one source position'
      })
    }
    if (
      locator.char_start !== undefined &&
      locator.char_end !== undefined &&
      locator.char_end < locator.char_start
    ) {
      context.addIssue({
        code: 'custom',
        path: ['char_end'],
        message: 'char_end must be greater than or equal to char_start'
      })
    }
  })

export const ProvenanceRefSchema = z
  .object({
    source_id: EntityIdSchema,
    source_version: PositiveIntegerSchema,
    fragment_id: EntityIdSchema.optional(),
    locator: SourceLocatorSchema.optional()
  })
  .strict()

export const QuantitySchema = z
  .object({
    value: z.number().finite(),
    unit: NonEmptyStringSchema
  })
  .strict()

export const IntervalQuantitySchema = z
  .object({
    min: z.number().finite().optional(),
    target: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unit: NonEmptyStringSchema
  })
  .strict()
  .superRefine((interval, context) => {
    if (interval.min === undefined && interval.target === undefined && interval.max === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'IntervalQuantity must contain min, target, or max'
      })
    }
    if (
      interval.min !== undefined &&
      interval.target !== undefined &&
      interval.min > interval.target
    ) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'target must be greater than or equal to min'
      })
    }
    if (
      interval.target !== undefined &&
      interval.max !== undefined &&
      interval.target > interval.max
    ) {
      context.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'max must be greater than or equal to target'
      })
    }
    if (interval.min !== undefined && interval.max !== undefined && interval.min > interval.max) {
      context.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'max must be greater than or equal to min'
      })
    }
  })

export const PriorExposureSchema = z
  .object({
    temperature: QuantitySchema,
    duration: QuantitySchema
  })
  .strict()

export const MaterialsProjectStatusSchema = z.enum([
  'draft',
  'needs_clarification',
  'goal_ready',
  'plan_compiled',
  'awaiting_plan_approval',
  'approved_for_run',
  'running',
  'needs_revision',
  'awaiting_package_approval',
  'approved_for_experiment',
  'rejected',
  'cancelled',
  'blocked'
])

export const RouteFamilySchema = z.enum([
  'casting_deformation',
  'rolling',
  'forging',
  'powder_metallurgy',
  'additive'
])

export const ArtifactKindSchema = z.enum([
  'flow_board',
  'markdown',
  'xlsx',
  'docx',
  'pdf',
  'pptx',
  'kanban'
])

export const RiskLevelSchema = z.enum(['low', 'medium', 'high'])
export const FindingSeveritySchema = z.enum(['info', 'warning', 'error', 'blocking'])

export const StructuredFailureV1Schema = z
  .object({
    code: NonEmptyStringSchema,
    category: z.enum([
      'validation',
      'permission',
      'timeout',
      'tool',
      'model',
      'scientific',
      'budget',
      'cancelled'
    ]),
    message: NonEmptyStringSchema,
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    caused_by_ref: VersionRefSchema.optional()
  })
  .strict()

export type EntityId = z.infer<typeof EntityIdSchema>
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>
export type ActorKind = z.infer<typeof ActorKindSchema>
export type ActorRef = z.infer<typeof ActorRefSchema>
export type VersionRef = z.infer<typeof VersionRefSchema>
export type SourceLocator = z.infer<typeof SourceLocatorSchema>
export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>
export type Quantity = z.infer<typeof QuantitySchema>
export type IntervalQuantity = z.infer<typeof IntervalQuantitySchema>
export type PriorExposure = z.infer<typeof PriorExposureSchema>
export type MaterialsProjectStatus = z.infer<typeof MaterialsProjectStatusSchema>
export type RouteFamily = z.infer<typeof RouteFamilySchema>
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>
export type StructuredFailureV1 = z.infer<typeof StructuredFailureV1Schema>
