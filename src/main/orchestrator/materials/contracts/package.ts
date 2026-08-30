import { z } from 'zod'
import {
  ActorRefSchema,
  ArtifactKindSchema,
  EntityIdSchema,
  FindingSeveritySchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  PositiveIntegerSchema,
  QuantitySchema,
  VersionRefSchema
} from './common'
import { ChangeRequestV1Schema } from './feedback'

export const HumanGateSchema = z.enum(['plan_preview', 'experiment_package'])

export const HumanGateRequestV1Schema = z
  .object({
    schema_version: z.literal('HumanGateRequestV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    gate: HumanGateSchema,
    object_ref: VersionRefSchema,
    summary: NonEmptyStringSchema,
    assumptions: z.array(VersionRefSchema),
    estimated_cost: QuantitySchema.optional(),
    estimated_duration: QuantitySchema.optional(),
    risk_summary: z.array(NonEmptyStringSchema),
    created_at: IsoDateTimeSchema
  })
  .strict()

export const HumanDecisionKindSchema = z.enum([
  'approve',
  'reject',
  'request_changes'
])

export const HumanDecisionV1Schema = z
  .object({
    schema_version: z.literal('HumanDecisionV1'),
    id: EntityIdSchema,
    request_ref: VersionRefSchema,
    decision: HumanDecisionKindSchema,
    feedback: NonEmptyStringSchema,
    requested_changes: z.array(ChangeRequestV1Schema),
    decided_at: IsoDateTimeSchema,
    decided_by: ActorRefSchema
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      decision.decision === 'request_changes' &&
      decision.requested_changes.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requested_changes'],
        message:
          'request_changes decision must contain at least one change request'
      })
    }
  })

export const CritiqueVerdictSchema = z.enum([
  'pass',
  'changes_required',
  'blocked'
])
export const CritiqueFindingCategorySchema = z.enum([
  'contract',
  'evidence',
  'scientific',
  'applicability',
  'units',
  'completeness'
])

export const CritiqueFindingSchema = z
  .object({
    severity: FindingSeveritySchema,
    category: CritiqueFindingCategorySchema,
    target_ref: VersionRefSchema.optional(),
    message: NonEmptyStringSchema,
    requested_change: NonEmptyStringSchema.optional()
  })
  .strict()

export const CritiqueReportV1Schema = z
  .object({
    schema_version: z.literal('CritiqueReportV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    package_ref: VersionRefSchema,
    critic_agent_run_ref: VersionRefSchema,
    verdict: CritiqueVerdictSchema,
    findings: z.array(CritiqueFindingSchema),
    created_at: IsoDateTimeSchema
  })
  .strict()

export const ExperimentPackageStatusSchema = z.enum([
  'draft',
  'under_review',
  'changes_requested',
  'approved_for_experiment',
  'rejected'
])

export const ExperimentPackageV1Schema = z
  .object({
    schema_version: z.literal('ExperimentPackageV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    version: PositiveIntegerSchema,
    goal_ref: VersionRefSchema,
    graph_ref: VersionRefSchema,
    run_ref: VersionRefSchema,
    assumptions: z.array(VersionRefSchema),
    open_risks: z.array(VersionRefSchema),
    evidence_claims: z.array(VersionRefSchema),
    candidate_designs: z.array(VersionRefSchema),
    pareto_selection: z.array(VersionRefSchema),
    experiment_design_ref: VersionRefSchema,
    critique_report_ref: VersionRefSchema,
    artifact_manifest_ref: VersionRefSchema.optional(),
    status: ExperimentPackageStatusSchema,
    created_at: IsoDateTimeSchema,
    approved_decision_ref: VersionRefSchema.optional()
  })
  .strict()
  .superRefine((experimentPackage, context) => {
    if (
      experimentPackage.status === 'approved_for_experiment' &&
      experimentPackage.approved_decision_ref === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approved_decision_ref'],
        message:
          'approved_for_experiment package must reference its approval decision'
      })
    }
  })

export const ArtifactManifestEntrySchema = z
  .object({
    kind: ArtifactKindSchema,
    path_or_uri: NonEmptyStringSchema,
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, 'sha256 must contain exactly 64 hex characters'),
    generator_version: NonEmptyStringSchema,
    generated_at: IsoDateTimeSchema
  })
  .strict()

export const ArtifactManifestV1Schema = z
  .object({
    schema_version: z.literal('ArtifactManifestV1'),
    id: EntityIdSchema,
    package_ref: VersionRefSchema,
    artifacts: z.array(ArtifactManifestEntrySchema)
  })
  .strict()

export type HumanGate = z.infer<typeof HumanGateSchema>
export type HumanGateRequestV1 = z.infer<typeof HumanGateRequestV1Schema>
export type HumanDecisionKind = z.infer<typeof HumanDecisionKindSchema>
export type HumanDecisionV1 = z.infer<typeof HumanDecisionV1Schema>
export type CritiqueVerdict = z.infer<typeof CritiqueVerdictSchema>
export type CritiqueFindingCategory = z.infer<
  typeof CritiqueFindingCategorySchema
>
export type CritiqueFinding = z.infer<typeof CritiqueFindingSchema>
export type CritiqueReportV1 = z.infer<typeof CritiqueReportV1Schema>
export type ExperimentPackageStatus = z.infer<
  typeof ExperimentPackageStatusSchema
>
export type ExperimentPackageV1 = z.infer<typeof ExperimentPackageV1Schema>
export type ArtifactManifestEntry = z.infer<typeof ArtifactManifestEntrySchema>
export type ArtifactManifestV1 = z.infer<typeof ArtifactManifestV1Schema>
