import { z } from 'zod'
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  RiskLevelSchema,
  StructuredFailureV1Schema,
  VersionRefSchema
} from './common'
import { ChangeRequestV1Schema } from './feedback'
import { ClaimProposalV1Schema } from './evidence'

export const AgentModelTierSchema = z.enum(['local_small', 'standard', 'strong'])

export const AgentSpecV1Schema = z
  .object({
    schema_version: z.literal('AgentSpecV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    name: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
    capabilities: z.array(NonEmptyStringSchema),
    allowed_goal_patterns: z.array(NonEmptyStringSchema),
    forbidden_actions: z.array(NonEmptyStringSchema),
    input_contracts: z.array(NonEmptyStringSchema),
    output_contracts: z.array(NonEmptyStringSchema),
    allowed_tools: z.array(NonEmptyStringSchema),
    context_policy: z
      .object({
        required_refs: z.array(NonEmptyStringSchema),
        maximum_context_tokens: PositiveIntegerSchema,
        forbidden_context_classes: z.array(NonEmptyStringSchema)
      })
      .strict(),
    memory_policy: z
      .object({
        readable_scopes: z.array(NonEmptyStringSchema),
        writable_proposal_scopes: z.array(NonEmptyStringSchema)
      })
      .strict(),
    model_policy: z
      .object({
        preferred_tier: AgentModelTierSchema,
        escalation_conditions: z.array(NonEmptyStringSchema)
      })
      .strict(),
    limits: z
      .object({
        ttl_ms: PositiveIntegerSchema,
        maximum_attempts: PositiveIntegerSchema,
        maximum_tool_calls: PositiveIntegerSchema,
        maximum_tokens: PositiveIntegerSchema
      })
      .strict(),
    success_rules: z.array(NonEmptyStringSchema)
  })
  .strict()

export const AgentRunStateSchema = z.enum([
  'requested',
  'selected',
  'leased',
  'running',
  'waiting_tool',
  'submitted',
  'validating',
  'completed',
  'failed',
  'cancelled',
  'expired'
])

export const AgentRunV1Schema = z
  .object({
    schema_version: z.literal('AgentRunV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    graph_version: PositiveIntegerSchema,
    node_run_id: EntityIdSchema,
    agent_spec_ref: VersionRefSchema,
    model: z
      .object({
        provider: NonEmptyStringSchema,
        model_id: NonEmptyStringSchema,
        policy_reason: NonEmptyStringSchema
      })
      .strict(),
    context_bundle_ref: VersionRefSchema,
    tool_lease_ids: z.array(EntityIdSchema),
    state: AgentRunStateSchema,
    started_at: IsoDateTimeSchema.optional(),
    finished_at: IsoDateTimeSchema.optional(),
    usage: z
      .object({
        tokens: NonNegativeIntegerSchema,
        model_calls: NonNegativeIntegerSchema,
        tool_calls: NonNegativeIntegerSchema,
        duration_ms: NonNegativeIntegerSchema
      })
      .strict(),
    result_ref: VersionRefSchema.optional(),
    failure: StructuredFailureV1Schema.optional()
  })
  .strict()

export const AgentResultStatusSchema = z.enum(['success', 'partial', 'needs_revision', 'failed'])

export const createAgentResultV1Schema = <TOutput extends z.ZodType>(outputSchema: TOutput) =>
  z
    .object({
      schema_version: z.literal('AgentResultV1'),
      agent_run_ref: VersionRefSchema,
      status: AgentResultStatusSchema,
      output_contract: NonEmptyStringSchema,
      output: outputSchema.nonoptional(),
      claims: z.array(ClaimProposalV1Schema),
      change_requests: z.array(ChangeRequestV1Schema),
      assumptions_used: z.array(VersionRefSchema),
      issues: z.array(StructuredFailureV1Schema)
    })
    .strict()

export const AgentResultV1Schema = createAgentResultV1Schema(z.unknown())

export const CapabilityRequestV1Schema = z
  .object({
    schema_version: z.literal('CapabilityRequestV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    graph_ref: VersionRefSchema,
    node_run_id: EntityIdSchema,
    objective: NonEmptyStringSchema,
    required_capabilities: z.array(NonEmptyStringSchema),
    input_contracts: z.array(NonEmptyStringSchema),
    output_contract: NonEmptyStringSchema,
    allowed_tools: z.array(NonEmptyStringSchema),
    risk_level: RiskLevelSchema,
    limits: z
      .object({
        maximum_tokens: PositiveIntegerSchema,
        maximum_tool_calls: PositiveIntegerSchema,
        ttl_ms: PositiveIntegerSchema
      })
      .strict()
  })
  .strict()

export type AgentModelTier = z.infer<typeof AgentModelTierSchema>
export type AgentSpecV1 = z.infer<typeof AgentSpecV1Schema>
export type AgentRunState = z.infer<typeof AgentRunStateSchema>
export type AgentRunV1 = z.infer<typeof AgentRunV1Schema>
export type AgentResultStatus = z.infer<typeof AgentResultStatusSchema>
export type AgentResultV1<TOutput = unknown> = z.infer<
  ReturnType<typeof createAgentResultV1Schema<z.ZodType<TOutput>>>
>
export type CapabilityRequestV1 = z.infer<typeof CapabilityRequestV1Schema>
