import { z } from 'zod'
import {
  ActorRefSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  PositiveIntegerSchema,
  ProvenanceRefSchema,
  SourceLocatorSchema,
  VersionRefSchema
} from './common'

export const SourceDocumentTypeSchema = z.enum([
  'paper',
  'standard',
  'report',
  'dataset',
  'experiment',
  'user_file'
])

export const SourceDocumentV1Schema = z
  .object({
    schema_version: z.literal('SourceDocumentV1'),
    id: EntityIdSchema,
    version: PositiveIntegerSchema,
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'sha256 must contain exactly 64 hex characters'),
    title: NonEmptyStringSchema,
    source_type: SourceDocumentTypeSchema,
    original_uri: NonEmptyStringSchema,
    local_object_path: NonEmptyStringSchema,
    mime_type: NonEmptyStringSchema,
    authors: z.array(NonEmptyStringSchema),
    publication_year: PositiveIntegerSchema.optional(),
    doi: NonEmptyStringSchema.optional(),
    ingested_at: IsoDateTimeSchema,
    access_policy: NonEmptyStringSchema
  })
  .strict()

export const SourceFragmentV1Schema = z
  .object({
    schema_version: z.literal('SourceFragmentV1'),
    id: EntityIdSchema,
    source_ref: VersionRefSchema,
    text: NonEmptyStringSchema,
    locator: SourceLocatorSchema,
    extraction_method: NonEmptyStringSchema,
    extraction_version: NonEmptyStringSchema
  })
  .strict()

export const ClaimTypeSchema = z.enum([
  'reported_fact',
  'system_inference',
  'model_prediction',
  'hypothesis'
])

const ClaimProposalV1Shape = {
  id: EntityIdSchema,
  statement: NonEmptyStringSchema,
  claim_type: ClaimTypeSchema,
  subject_refs: z.array(VersionRefSchema),
  evidence_refs: z.array(ProvenanceRefSchema),
  confidence: z.number().finite().min(0).max(1).optional(),
  created_by: ActorRefSchema
} as const

const ClaimProposalV1BaseSchema = z.object(ClaimProposalV1Shape).strict()

const requireReportedFactEvidence = (
  claim: z.infer<typeof ClaimProposalV1BaseSchema>,
  context: z.RefinementCtx
): void => {
  if (claim.claim_type === 'reported_fact' && claim.evidence_refs.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['evidence_refs'],
      message: 'reported_fact requires at least one evidence reference'
    })
  }
}

export const ClaimProposalV1Schema = z
  .object(ClaimProposalV1BaseSchema.shape)
  .strict()
  .superRefine(requireReportedFactEvidence)

export const EvidenceClaimStatusSchema = z.enum([
  'proposed',
  'verified',
  'contested',
  'rejected',
  'superseded'
])

export const EvidenceClaimV1Schema = z
  .object({
    ...ClaimProposalV1BaseSchema.shape,
    schema_version: z.literal('EvidenceClaimV1'),
    version: PositiveIntegerSchema,
    status: EvidenceClaimStatusSchema,
    verification_method: NonEmptyStringSchema,
    verified_by: ActorRefSchema.optional()
  })
  .strict()
  .superRefine(requireReportedFactEvidence)

export const ContextBundleV1Schema = z
  .object({
    schema_version: z.literal('ContextBundleV1'),
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    objective: NonEmptyStringSchema,
    goal_ref: VersionRefSchema,
    requirement_refs: z.array(VersionRefSchema),
    evidence_claim_refs: z.array(VersionRefSchema),
    numerical_record_refs: z.array(VersionRefSchema),
    decision_refs: z.array(VersionRefSchema),
    exclusions: z.array(NonEmptyStringSchema),
    token_estimate: z.number().int().nonnegative(),
    created_at: IsoDateTimeSchema
  })
  .strict()

const QueryFilterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string())
])

export const KnowledgeRequestModeSchema = z.enum(['text', 'numerical', 'graph', 'memory'])

export const KnowledgeRequestV1Schema = z
  .object({
    schema_version: z.literal('KnowledgeRequestV1'),
    project_id: EntityIdSchema,
    question: NonEmptyStringSchema,
    modes: z.array(KnowledgeRequestModeSchema),
    filters: z.record(z.string(), QueryFilterValueSchema),
    maximum_results: PositiveIntegerSchema,
    required_provenance: z.boolean()
  })
  .strict()

export const StructuredQueryEntitySchema = z.enum([
  'property_observation',
  'composition',
  'route',
  'prediction',
  'decision'
])

export const StructuredQueryV1Schema = z
  .object({
    schema_version: z.literal('StructuredQueryV1'),
    project_id: EntityIdSchema,
    entity: StructuredQueryEntitySchema,
    filters: z.record(z.string(), QueryFilterValueSchema),
    fields: z.array(NonEmptyStringSchema),
    limit: PositiveIntegerSchema
  })
  .strict()

export type SourceDocumentType = z.infer<typeof SourceDocumentTypeSchema>
export type SourceDocumentV1 = z.infer<typeof SourceDocumentV1Schema>
export type SourceFragmentV1 = z.infer<typeof SourceFragmentV1Schema>
export type ClaimType = z.infer<typeof ClaimTypeSchema>
export type ClaimProposalV1 = z.infer<typeof ClaimProposalV1Schema>
export type EvidenceClaimStatus = z.infer<typeof EvidenceClaimStatusSchema>
export type EvidenceClaimV1 = z.infer<typeof EvidenceClaimV1Schema>
export type ContextBundleV1 = z.infer<typeof ContextBundleV1Schema>
export type KnowledgeRequestMode = z.infer<typeof KnowledgeRequestModeSchema>
export type KnowledgeRequestV1 = z.infer<typeof KnowledgeRequestV1Schema>
export type StructuredQueryEntity = z.infer<typeof StructuredQueryEntitySchema>
export type StructuredQueryV1 = z.infer<typeof StructuredQueryV1Schema>
