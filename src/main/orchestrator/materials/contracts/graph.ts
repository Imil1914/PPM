import { z } from 'zod'
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  QuantitySchema,
  RiskLevelSchema,
  VersionRefSchema
} from './common'

export const PlanDraftStageV1Schema = z
  .object({
    draft_id: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    dependencies: z.array(NonEmptyStringSchema),
    required_capabilities: z.array(NonEmptyStringSchema),
    expected_output_contract: NonEmptyStringSchema,
    proposed_parallel_group: NonEmptyStringSchema.optional()
  })
  .strict()

export const PlanDraftV1Schema = z
  .object({
    schema_version: z.literal('PlanDraftV1'),
    id: EntityIdSchema,
    goal_ref: VersionRefSchema,
    stages: z.array(PlanDraftStageV1Schema)
  })
  .strict()

export const NodeTypeSchema = z.enum([
  'deterministic',
  'agent_task',
  'human_gate',
  'fan_out',
  'fan_in'
])

export const NodeRetryPolicySchema = z.enum([
  'none',
  'same_executor',
  'fallback_executor',
  'replan'
])

export const NodeSpecV1Schema = z
  .object({
    schema_version: z.literal('NodeSpecV1'),
    id: NonEmptyStringSchema,
    version: PositiveIntegerSchema,
    name: NonEmptyStringSchema,
    node_type: NodeTypeSchema,
    required_capability: NonEmptyStringSchema.optional(),
    allowed_tools: z.array(NonEmptyStringSchema),
    input_contracts: z.array(NonEmptyStringSchema),
    output_contract: NonEmptyStringSchema,
    acceptance_rules: z.array(NonEmptyStringSchema),
    timeout_ms: PositiveIntegerSchema,
    maximum_attempts: PositiveIntegerSchema,
    retry_policy: NodeRetryPolicySchema,
    risk_level: RiskLevelSchema,
    approval_before_run: z.boolean(),
    invalidated_by: z.array(NonEmptyStringSchema)
  })
  .strict()

export const CompiledNodeStateSchema = z.enum([
  'pending',
  'ready',
  'running',
  'validating',
  'completed',
  'failed',
  'stale',
  'cancelled'
])

export const CompiledNodeV1Schema = z
  .object({
    run_node_id: EntityIdSchema,
    node_spec_ref: VersionRefSchema,
    objective: NonEmptyStringSchema,
    dependencies: z.array(EntityIdSchema),
    input_refs: z.array(VersionRefSchema),
    selected_capabilities: z.array(NonEmptyStringSchema),
    state: CompiledNodeStateSchema
  })
  .strict()

export const CompiledGraphEdgeV1Schema = z
  .object({
    from: EntityIdSchema,
    to: EntityIdSchema,
    contract: NonEmptyStringSchema
  })
  .strict()

export const CompiledGraphValidationV1Schema = z
  .object({
    acyclic: z.boolean(),
    all_contracts_resolved: z.boolean(),
    all_tools_registered: z.boolean(),
    all_outputs_consumable: z.boolean()
  })
  .strict()

export const CompiledGraphV1Schema = z
  .object({
    schema_version: z.literal('CompiledGraphV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    version: PositiveIntegerSchema,
    goal_ref: VersionRefSchema,
    nodes: z.array(CompiledNodeV1Schema),
    edges: z.array(CompiledGraphEdgeV1Schema),
    estimated_cost: QuantitySchema.optional(),
    estimated_duration: QuantitySchema.optional(),
    estimated_model_calls: NonNegativeIntegerSchema,
    risk_summary: z.array(NonEmptyStringSchema),
    validation: CompiledGraphValidationV1Schema,
    created_at: IsoDateTimeSchema
  })
  .strict()

export type PlanDraftStageV1 = z.infer<typeof PlanDraftStageV1Schema>
export type PlanDraftV1 = z.infer<typeof PlanDraftV1Schema>
export type NodeType = z.infer<typeof NodeTypeSchema>
export type NodeRetryPolicy = z.infer<typeof NodeRetryPolicySchema>
export type NodeSpecV1 = z.infer<typeof NodeSpecV1Schema>
export type CompiledNodeState = z.infer<typeof CompiledNodeStateSchema>
export type CompiledNodeV1 = z.infer<typeof CompiledNodeV1Schema>
export type CompiledGraphEdgeV1 = z.infer<typeof CompiledGraphEdgeV1Schema>
export type CompiledGraphValidationV1 = z.infer<typeof CompiledGraphValidationV1Schema>
export type CompiledGraphV1 = z.infer<typeof CompiledGraphV1Schema>
