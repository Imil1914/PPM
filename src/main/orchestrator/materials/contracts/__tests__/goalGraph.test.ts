import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CompiledGraphV1Schema,
  NodeSpecV1Schema,
  PlanDraftV1Schema,
  type CompiledGraphV1,
  type NodeSpecV1,
  type PlanDraftV1
} from '../graph'
import {
  ResearchGoalV1Schema,
  TargetPropertyV1Schema,
  type ResearchGoalV1,
  type TargetPropertyV1
} from '../goal'
import {
  goalGraphCompiledGraphFixture,
  goalGraphGoldenGoalFixture,
  goalGraphMinimalGoalFixture,
  goalGraphNodeSpecFixture,
  goalGraphPlanDraftFixture
} from './goalGraphFixtures'

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('goalGraph ResearchGoalV1 contracts', () => {
  it('derives public types from the Zod schemas', () => {
    expectTypeOf<ResearchGoalV1>().toEqualTypeOf<
      ReturnType<(typeof ResearchGoalV1Schema)['parse']>
    >()
    expectTypeOf<TargetPropertyV1>().toEqualTypeOf<
      ReturnType<(typeof TargetPropertyV1Schema)['parse']>
    >()
  })

  it('parses the minimal and completed golden goals', () => {
    expect(ResearchGoalV1Schema.parse(goalGraphMinimalGoalFixture)).toEqual(
      goalGraphMinimalGoalFixture
    )
    expect(ResearchGoalV1Schema.parse(goalGraphGoldenGoalFixture)).toEqual(
      goalGraphGoldenGoalFixture
    )
  })

  it('contains the normative aluminium plate golden values', () => {
    const goal = ResearchGoalV1Schema.parse(goalGraphGoldenGoalFixture)

    expect(goal.service_conditions).toMatchObject({
      nominal_temperature: { value: 200, unit: 'degC' },
      exposure_duration: { value: 100, unit: 'h' },
      peak_temperature: { value: 250, unit: 'degC' }
    })
    expect(goal.manufacturing_constraints.allowed_route_families).toEqual([
      'casting_deformation',
      'rolling',
      'powder_metallurgy',
      'additive'
    ])
    expect(goal.business_constraints.maximum_physical_experiments).toBe(8)
  })

  it('keeps test_temperature optional as specified in document 04', () => {
    expect(
      TargetPropertyV1Schema.parse(goalGraphMinimalGoalFixture.target_properties[0])
    ).not.toHaveProperty('test_temperature')
  })

  it.each([
    ['version below one', { ...goalGraphMinimalGoalFixture, version: 0 }],
    ['no target properties', { ...goalGraphMinimalGoalFixture, target_properties: [] }],
    [
      'no allowed route families',
      {
        ...goalGraphMinimalGoalFixture,
        manufacturing_constraints: {
          ...goalGraphMinimalGoalFixture.manufacturing_constraints,
          allowed_route_families: []
        }
      }
    ],
    [
      'negative target weight',
      {
        ...goalGraphMinimalGoalFixture,
        target_properties: [
          { ...goalGraphMinimalGoalFixture.target_properties[0], weight: -0.1 }
        ]
      }
    ],
    [
      'zero total target weight',
      {
        ...goalGraphMinimalGoalFixture,
        target_properties: [{ ...goalGraphMinimalGoalFixture.target_properties[0], weight: 0 }]
      }
    ],
    [
      'negative priority weight',
      {
        ...goalGraphMinimalGoalFixture,
        business_constraints: { priority_weights: { fixture_property: -1 } }
      }
    ],
    [
      'zero total priority weight',
      {
        ...goalGraphMinimalGoalFixture,
        business_constraints: { priority_weights: { fixture_property: 0 } }
      }
    ],
    [
      'required and forbidden element intersection',
      {
        ...goalGraphMinimalGoalFixture,
        composition_constraints: {
          required_elements: ['Al'],
          allowed_elements: ['Al'],
          forbidden_elements: ['Al']
        }
      }
    ],
    [
      'missing physical unit',
      {
        ...goalGraphMinimalGoalFixture,
        service_conditions: {
          ...goalGraphMinimalGoalFixture.service_conditions,
          nominal_temperature: { value: 200 }
        }
      }
    ],
    [
      'non-finite physical quantity',
      {
        ...goalGraphMinimalGoalFixture,
        service_conditions: {
          ...goalGraphMinimalGoalFixture.service_conditions,
          nominal_temperature: { value: Number.POSITIVE_INFINITY, unit: 'degC' }
        }
      }
    ],
    [
      'unknown comparator',
      {
        ...goalGraphMinimalGoalFixture,
        target_properties: [
          { ...goalGraphMinimalGoalFixture.target_properties[0], comparator: 'approximately' }
        ]
      }
    ],
    [
      'unknown route family',
      {
        ...goalGraphMinimalGoalFixture,
        manufacturing_constraints: {
          ...goalGraphMinimalGoalFixture.manufacturing_constraints,
          allowed_route_families: ['teleportation']
        }
      }
    ],
    [
      'unknown artifact kind',
      { ...goalGraphMinimalGoalFixture, required_outputs: ['plain_text'] }
    ],
    ['root extra field', { ...goalGraphMinimalGoalFixture, runtime_override: true }],
    [
      'nested extra field',
      {
        ...goalGraphMinimalGoalFixture,
        product: { ...goalGraphMinimalGoalFixture.product, untrusted: true }
      }
    ]
  ])('rejects %s', (_name, invalidGoal) => {
    expect(ResearchGoalV1Schema.safeParse(invalidGoal).success).toBe(false)
  })
})

describe('goalGraph plan and graph contracts', () => {
  it('derives graph types from the Zod schemas', () => {
    expectTypeOf<PlanDraftV1>().toEqualTypeOf<
      ReturnType<(typeof PlanDraftV1Schema)['parse']>
    >()
    expectTypeOf<NodeSpecV1>().toEqualTypeOf<ReturnType<(typeof NodeSpecV1Schema)['parse']>>()
    expectTypeOf<CompiledGraphV1>().toEqualTypeOf<
      ReturnType<(typeof CompiledGraphV1Schema)['parse']>
    >()
  })

  it('parses complete plan, node spec, and compiled graph fixtures', () => {
    expect(PlanDraftV1Schema.parse(goalGraphPlanDraftFixture)).toEqual(goalGraphPlanDraftFixture)
    expect(NodeSpecV1Schema.parse(goalGraphNodeSpecFixture)).toEqual(goalGraphNodeSpecFixture)
    expect(CompiledGraphV1Schema.parse(goalGraphCompiledGraphFixture)).toEqual(
      goalGraphCompiledGraphFixture
    )
  })

  it.each([
    [
      'unknown node type',
      { ...goalGraphNodeSpecFixture, node_type: 'unregistered_node_type' }
    ],
    ['unknown retry policy', { ...goalGraphNodeSpecFixture, retry_policy: 'forever' }],
    ['unknown risk level', { ...goalGraphNodeSpecFixture, risk_level: 'critical' }],
    ['zero timeout', { ...goalGraphNodeSpecFixture, timeout_ms: 0 }],
    ['zero attempts', { ...goalGraphNodeSpecFixture, maximum_attempts: 0 }],
    ['extra node field', { ...goalGraphNodeSpecFixture, implementation: 'hidden' }]
  ])('rejects NodeSpec with %s', (_name, invalidNodeSpec) => {
    expect(NodeSpecV1Schema.safeParse(invalidNodeSpec).success).toBe(false)
  })

  it.each([
    ['unknown node state', 'mysterious'],
    ['wrong state casing', 'Pending']
  ])('rejects compiled graph with %s', (_name, state) => {
    const invalid = clone(goalGraphCompiledGraphFixture)
    const firstNode = invalid.nodes[0]
    expect(firstNode).toBeDefined()
    if (firstNode) (firstNode as { state: string }).state = state

    expect(CompiledGraphV1Schema.safeParse(invalid).success).toBe(false)
  })

  it.each([
    ['version below one', { ...goalGraphCompiledGraphFixture, version: 0 }],
    [
      'negative model call estimate',
      { ...goalGraphCompiledGraphFixture, estimated_model_calls: -1 }
    ],
    [
      'fractional model call estimate',
      { ...goalGraphCompiledGraphFixture, estimated_model_calls: 1.5 }
    ],
    ['wrong schema literal', { ...goalGraphCompiledGraphFixture, schema_version: 'GraphV1' }],
    ['extra graph field', { ...goalGraphCompiledGraphFixture, plan_hash: 'not-yet-normative' }],
    [
      'extra validation field',
      {
        ...goalGraphCompiledGraphFixture,
        validation: { ...goalGraphCompiledGraphFixture.validation, executable: true }
      }
    ]
  ])('rejects CompiledGraph with %s', (_name, invalidGraph) => {
    expect(CompiledGraphV1Schema.safeParse(invalidGraph).success).toBe(false)
  })

  it('does not duplicate future cycle, dangling dependency, or registry checks', () => {
    const structurallyValidButUncompiled = clone(goalGraphCompiledGraphFixture)
    const [firstNode, secondNode] = structurallyValidButUncompiled.nodes
    expect(firstNode).toBeDefined()
    expect(secondNode).toBeDefined()
    if (firstNode && secondNode) {
      firstNode.dependencies = [secondNode.run_node_id]
      secondNode.dependencies = ['missing_runtime_node']
      firstNode.node_spec_ref.entity_id = 'unregistered_node_spec'
    }

    expect(CompiledGraphV1Schema.safeParse(structurallyValidButUncompiled).success).toBe(true)
  })
})
