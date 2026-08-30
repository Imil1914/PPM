import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  AgentResultStatusSchema,
  AgentRunStateSchema,
  AgentRunV1Schema,
  AgentSpecV1Schema,
  CapabilityRequestV1Schema,
  createAgentResultV1Schema,
  type AgentResultV1
} from '../agents'
import {
  ClaimProposalV1Schema,
  ContextBundleV1Schema,
  EvidenceClaimV1Schema,
  KnowledgeRequestV1Schema,
  SourceDocumentV1Schema,
  SourceFragmentV1Schema,
  StructuredQueryV1Schema
} from '../evidence'
import {
  ToolCallRequestV1Schema,
  ToolInvocationStateSchema,
  ToolInvocationV1Schema,
  ToolSpecV1Schema,
  ValidationReportV1Schema
} from '../tools'
import {
  agentResultFixture,
  agentRunFixture,
  agentSpecFixture,
  capabilityRequestFixture,
  contextBundleFixture,
  evidenceClaimFixture,
  hypothesisFixture,
  knowledgeRequestFixture,
  reportedFactFixture,
  sourceDocumentFixture,
  sourceFragmentFixture,
  structuredQueryFixture,
  toolCallRequestFixture,
  toolInvocationFixture,
  toolSpecFixture,
  validationReportFixture
} from './agentsEvidenceTools.fixtures'

const expectMissingRequiredFieldsRejected = (
  schema: z.ZodType,
  fixture: object,
  requiredFields: readonly string[]
): void => {
  for (const field of requiredFields) {
    const candidate = { ...fixture } as Record<string, unknown>
    delete candidate[field]
    expect(schema.safeParse(candidate).success, `${field} must be required`).toBe(false)
  }
}

const AGENT_RUN_STATES = [
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
] as const

const TOOL_INVOCATION_STATES = [
  'requested',
  'authorized',
  'running',
  'completed',
  'failed',
  'timed_out',
  'denied'
] as const

describe('agentsEvidenceTools: agent contracts', () => {
  it('parses the normative AgentSpec and rejects unknown fields at every fixed level', () => {
    expect(AgentSpecV1Schema.parse(agentSpecFixture)).toEqual(agentSpecFixture)
    expect(AgentSpecV1Schema.safeParse({ ...agentSpecFixture, unexpected: true }).success).toBe(false)
    expect(
      AgentSpecV1Schema.safeParse({
        ...agentSpecFixture,
        context_policy: { ...agentSpecFixture.context_policy, unexpected: true }
      }).success
    ).toBe(false)
  })

  it.each(AGENT_RUN_STATES)('accepts the normative AgentRun state %s', (state) => {
    expect(AgentRunStateSchema.parse(state)).toBe(state)
    expect(AgentRunV1Schema.safeParse({ ...agentRunFixture, state }).success).toBe(true)
  })

  it('rejects unknown lifecycle states, invalid versions and negative usage', () => {
    expect(AgentRunStateSchema.safeParse('destroyed').success).toBe(false)
    expect(AgentRunV1Schema.safeParse({ ...agentRunFixture, graph_version: 0 }).success).toBe(false)
    expect(
      AgentRunV1Schema.safeParse({
        ...agentRunFixture,
        usage: { ...agentRunFixture.usage, tokens: -1 }
      }).success
    ).toBe(false)
  })

  it('rejects invalid AgentSpec tiers and non-positive limits', () => {
    expect(
      AgentSpecV1Schema.safeParse({
        ...agentSpecFixture,
        model_policy: { ...agentSpecFixture.model_policy, preferred_tier: 'unbounded' }
      }).success
    ).toBe(false)
    expect(
      AgentSpecV1Schema.safeParse({
        ...agentSpecFixture,
        limits: { ...agentSpecFixture.limits, ttl_ms: 0 }
      }).success
    ).toBe(false)
  })

  it('uses the supplied output contract in the generic AgentResult factory', () => {
    const outputSchema = z.object({ value: z.string().min(1) }).strict()
    const resultSchema = createAgentResultV1Schema(outputSchema)

    expect(resultSchema.parse(agentResultFixture)).toEqual(agentResultFixture)
    expect(
      resultSchema.safeParse({ ...agentResultFixture, output: { value: 42 } }).success
    ).toBe(false)
    expect(AgentResultStatusSchema.safeParse('approved').success).toBe(false)
    expectTypeOf<AgentResultV1<{ value: string }>['output']>().toEqualTypeOf<{
      value: string
    }>()
  })

  it('parses CapabilityRequest and rejects an unknown risk or zero budget', () => {
    expect(CapabilityRequestV1Schema.parse(capabilityRequestFixture)).toEqual(
      capabilityRequestFixture
    )
    expect(
      CapabilityRequestV1Schema.safeParse({ ...capabilityRequestFixture, risk_level: 'critical' })
        .success
    ).toBe(false)
    expect(
      CapabilityRequestV1Schema.safeParse({
        ...capabilityRequestFixture,
        limits: { ...capabilityRequestFixture.limits, maximum_tokens: 0 }
      }).success
    ).toBe(false)
  })

  it('requires every normative top-level agent field', () => {
    expectMissingRequiredFieldsRejected(AgentSpecV1Schema, agentSpecFixture, [
      'schema_version',
      'id',
      'version',
      'name',
      'purpose',
      'capabilities',
      'allowed_goal_patterns',
      'forbidden_actions',
      'input_contracts',
      'output_contracts',
      'allowed_tools',
      'context_policy',
      'memory_policy',
      'model_policy',
      'limits',
      'success_rules'
    ])
    expectMissingRequiredFieldsRejected(AgentRunV1Schema, agentRunFixture, [
      'schema_version',
      'id',
      'project_id',
      'graph_version',
      'node_run_id',
      'agent_spec_ref',
      'model',
      'context_bundle_ref',
      'tool_lease_ids',
      'state',
      'usage'
    ])
    expectMissingRequiredFieldsRejected(CapabilityRequestV1Schema, capabilityRequestFixture, [
      'schema_version',
      'id',
      'project_id',
      'graph_ref',
      'node_run_id',
      'objective',
      'required_capabilities',
      'input_contracts',
      'output_contract',
      'allowed_tools',
      'risk_level',
      'limits'
    ])
    expectMissingRequiredFieldsRejected(
      createAgentResultV1Schema(z.object({ value: z.string() }).strict()),
      agentResultFixture,
      [
        'schema_version',
        'agent_run_ref',
        'status',
        'output_contract',
        'output',
        'claims',
        'change_requests',
        'assumptions_used',
        'issues'
      ]
    )
  })
})

describe('agentsEvidenceTools: evidence contracts', () => {
  it('parses source document and fragment fixtures', () => {
    expect(SourceDocumentV1Schema.parse(sourceDocumentFixture)).toEqual(sourceDocumentFixture)
    expect(SourceFragmentV1Schema.parse(sourceFragmentFixture)).toEqual(sourceFragmentFixture)
  })

  it('requires an exact 64-character hexadecimal SHA-256 value', () => {
    expect(
      SourceDocumentV1Schema.safeParse({ ...sourceDocumentFixture, sha256: 'a'.repeat(63) })
        .success
    ).toBe(false)
    expect(
      SourceDocumentV1Schema.safeParse({ ...sourceDocumentFixture, sha256: 'g'.repeat(64) })
        .success
    ).toBe(false)
  })

  it('requires evidence for reported facts but permits an ungrounded hypothesis proposal', () => {
    expect(ClaimProposalV1Schema.parse(reportedFactFixture)).toEqual(reportedFactFixture)
    expect(ClaimProposalV1Schema.parse(hypothesisFixture)).toEqual(hypothesisFixture)
    expect(
      ClaimProposalV1Schema.safeParse({ ...reportedFactFixture, evidence_refs: [] }).success
    ).toBe(false)
  })

  it('preserves EvidenceClaim strictness and the reported-fact invariant', () => {
    expect(EvidenceClaimV1Schema.parse(evidenceClaimFixture)).toEqual(evidenceClaimFixture)
    expect(
      EvidenceClaimV1Schema.safeParse({ ...evidenceClaimFixture, evidence_refs: [] }).success
    ).toBe(false)
    expect(
      EvidenceClaimV1Schema.safeParse({ ...evidenceClaimFixture, unexpected: true }).success
    ).toBe(false)
  })

  it('rejects confidence outside 0..1 and unknown claim categories', () => {
    expect(ClaimProposalV1Schema.safeParse({ ...reportedFactFixture, confidence: 1.01 }).success).toBe(
      false
    )
    expect(
      ClaimProposalV1Schema.safeParse({ ...reportedFactFixture, claim_type: 'opinion' }).success
    ).toBe(false)
  })

  it('parses context and both knowledge request forms strictly', () => {
    expect(ContextBundleV1Schema.parse(contextBundleFixture)).toEqual(contextBundleFixture)
    expect(KnowledgeRequestV1Schema.parse(knowledgeRequestFixture)).toEqual(knowledgeRequestFixture)
    expect(StructuredQueryV1Schema.parse(structuredQueryFixture)).toEqual(structuredQueryFixture)
    expect(
      StructuredQueryV1Schema.safeParse({ ...structuredQueryFixture, entity: 'source_document' })
        .success
    ).toBe(false)
    expect(
      KnowledgeRequestV1Schema.safeParse({ ...knowledgeRequestFixture, maximum_results: 0 }).success
    ).toBe(false)
  })

  it('requires every normative top-level evidence field', () => {
    expectMissingRequiredFieldsRejected(SourceDocumentV1Schema, sourceDocumentFixture, [
      'schema_version',
      'id',
      'version',
      'sha256',
      'title',
      'source_type',
      'original_uri',
      'local_object_path',
      'mime_type',
      'authors',
      'ingested_at',
      'access_policy'
    ])
    expectMissingRequiredFieldsRejected(SourceFragmentV1Schema, sourceFragmentFixture, [
      'schema_version',
      'id',
      'source_ref',
      'text',
      'locator',
      'extraction_method',
      'extraction_version'
    ])
    expectMissingRequiredFieldsRejected(ClaimProposalV1Schema, reportedFactFixture, [
      'id',
      'statement',
      'claim_type',
      'subject_refs',
      'evidence_refs',
      'created_by'
    ])
    expectMissingRequiredFieldsRejected(EvidenceClaimV1Schema, evidenceClaimFixture, [
      'id',
      'statement',
      'claim_type',
      'subject_refs',
      'evidence_refs',
      'created_by',
      'schema_version',
      'version',
      'status',
      'verification_method'
    ])
    expectMissingRequiredFieldsRejected(ContextBundleV1Schema, contextBundleFixture, [
      'schema_version',
      'id',
      'project_id',
      'objective',
      'goal_ref',
      'requirement_refs',
      'evidence_claim_refs',
      'numerical_record_refs',
      'decision_refs',
      'exclusions',
      'token_estimate',
      'created_at'
    ])
    expectMissingRequiredFieldsRejected(KnowledgeRequestV1Schema, knowledgeRequestFixture, [
      'schema_version',
      'project_id',
      'question',
      'modes',
      'filters',
      'maximum_results',
      'required_provenance'
    ])
    expectMissingRequiredFieldsRejected(StructuredQueryV1Schema, structuredQueryFixture, [
      'schema_version',
      'project_id',
      'entity',
      'filters',
      'fields',
      'limit'
    ])
  })
})

describe('agentsEvidenceTools: tool contracts', () => {
  it('parses the normative ToolSpec and allows zero retries', () => {
    expect(ToolSpecV1Schema.parse(toolSpecFixture)).toEqual(toolSpecFixture)
  })

  it('makes the none side effect exclusive', () => {
    expect(
      ToolSpecV1Schema.safeParse({
        ...toolSpecFixture,
        side_effects: ['none', 'network']
      }).success
    ).toBe(false)
    expect(
      ToolSpecV1Schema.safeParse({ ...toolSpecFixture, side_effects: ['network'] }).success
    ).toBe(true)
  })

  it('rejects invalid tool limits, kinds and nested extra fields', () => {
    expect(ToolSpecV1Schema.safeParse({ ...toolSpecFixture, timeout_ms: 0 }).success).toBe(false)
    expect(ToolSpecV1Schema.safeParse({ ...toolSpecFixture, maximum_retries: -1 }).success).toBe(
      false
    )
    expect(ToolSpecV1Schema.safeParse({ ...toolSpecFixture, kind: 'physical_controller' }).success).toBe(
      false
    )
  })

  it.each(TOOL_INVOCATION_STATES)('accepts the normative ToolInvocation state %s', (state) => {
    expect(ToolInvocationStateSchema.parse(state)).toBe(state)
    expect(ToolInvocationV1Schema.safeParse({ ...toolInvocationFixture, state }).success).toBe(true)
  })

  it('rejects an unknown invocation state without adding transition behavior', () => {
    expect(ToolInvocationV1Schema.safeParse({ ...toolInvocationFixture, state: 'retrying' }).success).toBe(
      false
    )
  })

  it('parses ToolCallRequest and ValidationReport and rejects extra fields', () => {
    expect(ToolCallRequestV1Schema.parse(toolCallRequestFixture)).toEqual(toolCallRequestFixture)
    expect(ValidationReportV1Schema.parse(validationReportFixture)).toEqual(validationReportFixture)
    expect(
      ToolCallRequestV1Schema.safeParse({ ...toolCallRequestFixture, input: {} }).success
    ).toBe(false)
    expect(
      ValidationReportV1Schema.safeParse({
        ...validationReportFixture,
        errors: [{ ...validationReportFixture.errors[0], detail: 'not allowed' }]
      }).success
    ).toBe(false)
  })

  it('requires every normative top-level tool field', () => {
    expectMissingRequiredFieldsRejected(ToolSpecV1Schema, toolSpecFixture, [
      'schema_version',
      'id',
      'version',
      'name',
      'kind',
      'purpose',
      'input_contract',
      'output_contract',
      'side_effects',
      'required_permissions',
      'timeout_ms',
      'maximum_retries',
      'idempotent',
      'healthcheck',
      'failure_codes',
      'provenance_fields'
    ])
    expectMissingRequiredFieldsRejected(ToolInvocationV1Schema, toolInvocationFixture, [
      'schema_version',
      'id',
      'project_id',
      'agent_run_ref',
      'tool_spec_ref',
      'input_ref',
      'lease_id',
      'state'
    ])
    expectMissingRequiredFieldsRejected(ToolCallRequestV1Schema, toolCallRequestFixture, [
      'schema_version',
      'project_id',
      'agent_run_ref',
      'tool_spec_ref',
      'lease_id',
      'input_ref',
      'idempotency_key'
    ])
    expectMissingRequiredFieldsRejected(ValidationReportV1Schema, validationReportFixture, [
      'schema_version',
      'valid',
      'contract_id',
      'errors',
      'warnings'
    ])
  })
})
