import { z } from 'zod'
import {
  ActorRefSchema,
  EntityIdSchema,
  FindingSeveritySchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  VersionRefSchema
} from './common'

export const FeedbackSourceSchema = z.enum([
  'graph_validator',
  'runtime',
  'contract_validator',
  'critic',
  'provenance_gate',
  'engineer',
  'dependency_engine'
])

export const FeedbackCategorySchema = z.enum([
  'missing_requirement',
  'local_technical_error',
  'scientific_issue',
  'insufficient_evidence',
  'changed_input',
  'budget_or_permission'
])

export const FeedbackProposedActionSchema = z.enum([
  'clarify',
  'retry_node',
  'replan_branch',
  'human_escalation'
])

export const FeedbackSignalV1Schema = z
  .object({
    schema_version: z.literal('FeedbackSignalV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    source: FeedbackSourceSchema,
    source_ref: VersionRefSchema,
    category: FeedbackCategorySchema,
    severity: FindingSeveritySchema,
    message: NonEmptyStringSchema,
    affected_refs: z.array(VersionRefSchema),
    proposed_action: FeedbackProposedActionSchema,
    created_at: IsoDateTimeSchema
  })
  .strict()

export const RequestedChangeSchema = z
  .object({
    field_path: NonEmptyStringSchema.optional(),
    instruction: NonEmptyStringSchema
  })
  .strict()

export const ChangeRequestV1Schema = z
  .object({
    id: EntityIdSchema,
    target_ref: VersionRefSchema,
    requested_changes: z.array(RequestedChangeSchema),
    reason: NonEmptyStringSchema,
    requested_by: ActorRefSchema
  })
  .strict()

export const DependencyRelationSchema = z.enum([
  'derived_from',
  'uses_model',
  'uses_assumption',
  'uses_source',
  'uses_requirement'
])

export const DependencyEdgeV1Schema = z
  .object({
    from_ref: VersionRefSchema,
    to_ref: VersionRefSchema,
    relation: DependencyRelationSchema
  })
  .strict()

export const InvalidationEventV1Schema = z
  .object({
    schema_version: z.literal('InvalidationEventV1'),
    id: EntityIdSchema,
    changed_ref: VersionRefSchema,
    stale_refs: z.array(VersionRefSchema),
    reason: NonEmptyStringSchema,
    created_at: IsoDateTimeSchema
  })
  .strict()

export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>
export type FeedbackProposedAction = z.infer<
  typeof FeedbackProposedActionSchema
>
export type FeedbackSignalV1 = z.infer<typeof FeedbackSignalV1Schema>
export type RequestedChange = z.infer<typeof RequestedChangeSchema>
export type ChangeRequestV1 = z.infer<typeof ChangeRequestV1Schema>
export type DependencyRelation = z.infer<typeof DependencyRelationSchema>
export type DependencyEdgeV1 = z.infer<typeof DependencyEdgeV1Schema>
export type InvalidationEventV1 = z.infer<typeof InvalidationEventV1Schema>
