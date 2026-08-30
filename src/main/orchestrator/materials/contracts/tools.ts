import { z } from 'zod'
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  StructuredFailureV1Schema,
  VersionRefSchema
} from './common'

export const ToolKindSchema = z.enum([
  'local_function',
  'sidecar',
  'external_api',
  'model',
  'artifact_generator'
])

export const ToolSideEffectSchema = z.enum([
  'none',
  'filesystem_read',
  'filesystem_write',
  'network',
  'database_write'
])

export const ToolSpecV1Schema = z
  .object({
    schema_version: z.literal('ToolSpecV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    name: NonEmptyStringSchema,
    kind: ToolKindSchema,
    purpose: NonEmptyStringSchema,
    input_contract: NonEmptyStringSchema,
    output_contract: NonEmptyStringSchema,
    side_effects: z.array(ToolSideEffectSchema),
    required_permissions: z.array(NonEmptyStringSchema),
    timeout_ms: PositiveIntegerSchema,
    maximum_retries: NonNegativeIntegerSchema,
    idempotent: z.boolean(),
    healthcheck: NonEmptyStringSchema,
    failure_codes: z.array(NonEmptyStringSchema),
    provenance_fields: z.array(NonEmptyStringSchema)
  })
  .strict()
  .superRefine((specification, context) => {
    if (specification.side_effects.includes('none') && specification.side_effects.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['side_effects'],
        message: 'none cannot be combined with other side effects'
      })
    }
  })

export const ToolInvocationStateSchema = z.enum([
  'requested',
  'authorized',
  'running',
  'completed',
  'failed',
  'timed_out',
  'denied'
])

export const ToolInvocationV1Schema = z
  .object({
    schema_version: z.literal('ToolInvocationV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    agent_run_ref: VersionRefSchema,
    tool_spec_ref: VersionRefSchema,
    input_ref: VersionRefSchema,
    lease_id: EntityIdSchema,
    state: ToolInvocationStateSchema,
    output_ref: VersionRefSchema.optional(),
    failure: StructuredFailureV1Schema.optional(),
    started_at: IsoDateTimeSchema.optional(),
    finished_at: IsoDateTimeSchema.optional()
  })
  .strict()

export const ToolCallRequestV1Schema = z
  .object({
    schema_version: z.literal('ToolCallRequestV1'),
    project_id: EntityIdSchema,
    agent_run_ref: VersionRefSchema,
    tool_spec_ref: VersionRefSchema,
    lease_id: EntityIdSchema,
    input_ref: VersionRefSchema,
    idempotency_key: NonEmptyStringSchema
  })
  .strict()

export const ValidationReportV1Schema = z
  .object({
    schema_version: z.literal('ValidationReportV1'),
    valid: z.boolean(),
    contract_id: NonEmptyStringSchema,
    errors: z.array(
      z
        .object({
          code: NonEmptyStringSchema,
          field_path: NonEmptyStringSchema.optional(),
          message: NonEmptyStringSchema
        })
        .strict()
    ),
    warnings: z.array(NonEmptyStringSchema)
  })
  .strict()

export type ToolKind = z.infer<typeof ToolKindSchema>
export type ToolSideEffect = z.infer<typeof ToolSideEffectSchema>
export type ToolSpecV1 = z.infer<typeof ToolSpecV1Schema>
export type ToolInvocationState = z.infer<typeof ToolInvocationStateSchema>
export type ToolInvocationV1 = z.infer<typeof ToolInvocationV1Schema>
export type ToolCallRequestV1 = z.infer<typeof ToolCallRequestV1Schema>
export type ValidationReportV1 = z.infer<typeof ValidationReportV1Schema>
