import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CandidateDesignV1Schema,
  ExperimentDesignV1Schema,
  ManufacturingRouteV1Schema,
  MaterialCompositionV1Schema,
  ModelCardRefV1Schema,
  ProcessStepV1Schema,
  PropertyObservationV1Schema,
  PropertyPredictionV1Schema
} from '../materials'
import {
  ChangeRequestV1Schema,
  DependencyEdgeV1Schema,
  FeedbackSignalV1Schema,
  InvalidationEventV1Schema
} from '../feedback'
import {
  ArtifactManifestV1Schema,
  CritiqueReportV1Schema,
  ExperimentPackageV1Schema,
  HumanDecisionV1Schema,
  HumanGateRequestV1Schema
} from '../package'
import {
  materialsPackageFeedbackArtifactManifestFixture,
  materialsPackageFeedbackCandidateFixture,
  materialsPackageFeedbackChangeRequestFixture,
  materialsPackageFeedbackCompositionFixture,
  materialsPackageFeedbackCritiqueFixture,
  materialsPackageFeedbackDependencyEdgeFixture,
  materialsPackageFeedbackExperimentDesignFixture,
  materialsPackageFeedbackExperimentPackageFixture,
  materialsPackageFeedbackHumanDecisionFixture,
  materialsPackageFeedbackHumanGateRequestFixture,
  materialsPackageFeedbackInvalidationFixture,
  materialsPackageFeedbackModelCardFixture,
  materialsPackageFeedbackProcessStepFixture,
  materialsPackageFeedbackPropertyObservationFixture,
  materialsPackageFeedbackPropertyPredictionFixture,
  materialsPackageFeedbackRouteFixture,
  materialsPackageFeedbackSignalFixture
} from './materialsPackageFeedback.fixtures'

const validContracts = [
  [
    'ModelCardRefV1',
    ModelCardRefV1Schema,
    materialsPackageFeedbackModelCardFixture
  ],
  [
    'PropertyObservationV1',
    PropertyObservationV1Schema,
    materialsPackageFeedbackPropertyObservationFixture
  ],
  [
    'PropertyPredictionV1',
    PropertyPredictionV1Schema,
    materialsPackageFeedbackPropertyPredictionFixture
  ],
  [
    'MaterialCompositionV1',
    MaterialCompositionV1Schema,
    materialsPackageFeedbackCompositionFixture
  ],
  [
    'ProcessStepV1',
    ProcessStepV1Schema,
    materialsPackageFeedbackProcessStepFixture
  ],
  [
    'ManufacturingRouteV1',
    ManufacturingRouteV1Schema,
    materialsPackageFeedbackRouteFixture
  ],
  [
    'CandidateDesignV1',
    CandidateDesignV1Schema,
    materialsPackageFeedbackCandidateFixture
  ],
  [
    'ExperimentDesignV1',
    ExperimentDesignV1Schema,
    materialsPackageFeedbackExperimentDesignFixture
  ],
  [
    'FeedbackSignalV1',
    FeedbackSignalV1Schema,
    materialsPackageFeedbackSignalFixture
  ],
  [
    'ChangeRequestV1',
    ChangeRequestV1Schema,
    materialsPackageFeedbackChangeRequestFixture
  ],
  [
    'DependencyEdgeV1',
    DependencyEdgeV1Schema,
    materialsPackageFeedbackDependencyEdgeFixture
  ],
  [
    'InvalidationEventV1',
    InvalidationEventV1Schema,
    materialsPackageFeedbackInvalidationFixture
  ],
  [
    'HumanGateRequestV1',
    HumanGateRequestV1Schema,
    materialsPackageFeedbackHumanGateRequestFixture
  ],
  [
    'HumanDecisionV1',
    HumanDecisionV1Schema,
    materialsPackageFeedbackHumanDecisionFixture
  ],
  [
    'CritiqueReportV1',
    CritiqueReportV1Schema,
    materialsPackageFeedbackCritiqueFixture
  ],
  [
    'ExperimentPackageV1',
    ExperimentPackageV1Schema,
    materialsPackageFeedbackExperimentPackageFixture
  ],
  [
    'ArtifactManifestV1',
    ArtifactManifestV1Schema,
    materialsPackageFeedbackArtifactManifestFixture
  ]
] as const satisfies ReadonlyArray<
  readonly [string, z.ZodType, Record<string, unknown>]
>

function expectInvalidAt(
  schema: z.ZodType,
  value: unknown,
  expectedPath: string
): void {
  const result = schema.safeParse(value)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      expectedPath
    )
  }
}

function expectUnknownKeyAt(
  schema: z.ZodType,
  value: unknown,
  expectedParentPath: string,
  expectedKey = 'unexpected'
): void {
  const result = schema.safeParse(value)
  expect(result.success).toBe(false)
  if (!result.success) {
    const issue = result.error.issues.find(
      (candidate) =>
        candidate.code === 'unrecognized_keys' &&
        candidate.path.join('.') === expectedParentPath
    )
    expect(issue).toBeDefined()
    if (issue?.code === 'unrecognized_keys') {
      expect(issue.keys).toContain(expectedKey)
    }
  }
}

describe('materials, package, and feedback V1 fixtures', () => {
  it.each(validContracts)(
    'parses the complete symbolic %s fixture',
    (_name, schema, fixture) => {
      expect(schema.parse(fixture)).toEqual(fixture)
    }
  )

  it.each(validContracts)(
    'rejects an unknown top-level field in %s',
    (_name, schema, fixture) => {
      expectUnknownKeyAt(schema, { ...fixture, unexpected: true }, '')
    }
  )

  it('accepts forging and boolean route parameters', () => {
    const parsed = ManufacturingRouteV1Schema.parse(
      materialsPackageFeedbackRouteFixture
    )
    expect(parsed.family).toBe('forging')
    expect(parsed.steps[0]?.parameters.fixture_boolean).toBe(true)
  })

  it('rejects boolean experiment factors while accepting the other normative factor values', () => {
    const fixture = structuredClone(
      materialsPackageFeedbackExperimentDesignFixture
    )
    fixture.experiments[0]!.factors.fixture_boolean = true as never
    expectInvalidAt(
      ExperimentDesignV1Schema,
      fixture,
      'experiments.0.factors.fixture_boolean'
    )
  })
})

describe('materials contract negative cases', () => {
  it('rejects fractions outside [0, 1] and unknown enums', () => {
    expectInvalidAt(
      MaterialCompositionV1Schema,
      {
        ...materialsPackageFeedbackCompositionFixture,
        components: [{ element: 'fixture-element', fraction: 1.01 }]
      },
      'components.0.fraction'
    )
    expectInvalidAt(
      MaterialCompositionV1Schema,
      { ...materialsPackageFeedbackCompositionFixture, basis: 'fixture-basis' },
      'basis'
    )
    expectInvalidAt(
      ManufacturingRouteV1Schema,
      {
        ...materialsPackageFeedbackRouteFixture,
        family: 'fixture-route-family'
      },
      'family'
    )
  })

  it('rejects missing units, NaN, and Infinity in quantities', () => {
    expectInvalidAt(
      PropertyObservationV1Schema,
      {
        ...materialsPackageFeedbackPropertyObservationFixture,
        value: { value: 1, unit: undefined }
      },
      'value.unit'
    )
    expectInvalidAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        prediction: { value: Number.NaN, unit: 'fixture-unit' }
      },
      'prediction.value'
    )
    expectInvalidAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        prediction: { value: Number.POSITIVE_INFINITY, unit: 'fixture-unit' }
      },
      'prediction.value'
    )
  })

  it('rejects a prediction without test temperature or ModelCard', () => {
    expectInvalidAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        test_temperature: undefined
      },
      'test_temperature'
    )
    expectInvalidAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        model: undefined
      },
      'model'
    )
  })

  it('rejects invalid prediction confidence and nested extra fields', () => {
    expectInvalidAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        interval: {
          ...materialsPackageFeedbackPropertyPredictionFixture.interval!,
          level: 1.01
        }
      },
      'interval.level'
    )
    expectUnknownKeyAt(
      PropertyPredictionV1Schema,
      {
        ...materialsPackageFeedbackPropertyPredictionFixture,
        model: {
          ...materialsPackageFeedbackModelCardFixture,
          unexpected: true
        }
      },
      'model'
    )
  })

  it('rejects a negative experiment information value and nested extra fields', () => {
    const negativeValue = structuredClone(
      materialsPackageFeedbackExperimentDesignFixture
    )
    negativeValue.experiments[0]!.information_value = -0.1
    expectInvalidAt(
      ExperimentDesignV1Schema,
      negativeValue,
      'experiments.0.information_value'
    )

    const extraField = structuredClone(
      materialsPackageFeedbackExperimentDesignFixture
    )
    Object.assign(extraField.experiments[0]!, { unexpected: true })
    expectUnknownKeyAt(ExperimentDesignV1Schema, extraField, 'experiments.0')
  })
})

describe('package and human decision local invariants', () => {
  it('requires critique and risks fields in an experiment package', () => {
    expectInvalidAt(
      ExperimentPackageV1Schema,
      {
        ...materialsPackageFeedbackExperimentPackageFixture,
        critique_report_ref: undefined
      },
      'critique_report_ref'
    )
    expectInvalidAt(
      ExperimentPackageV1Schema,
      {
        ...materialsPackageFeedbackExperimentPackageFixture,
        open_risks: undefined
      },
      'open_risks'
    )
  })

  it('requires an approval decision for an approved package', () => {
    expectInvalidAt(
      ExperimentPackageV1Schema,
      {
        ...materialsPackageFeedbackExperimentPackageFixture,
        approved_decision_ref: undefined
      },
      'approved_decision_ref'
    )
  })

  it('requires an addressable change for request_changes decisions', () => {
    expectInvalidAt(
      HumanDecisionV1Schema,
      {
        ...materialsPackageFeedbackHumanDecisionFixture,
        decision: 'request_changes',
        requested_changes: []
      },
      'requested_changes'
    )
  })

  it('rejects nested extra fields in critique findings and artifacts', () => {
    const critique = structuredClone(materialsPackageFeedbackCritiqueFixture)
    Object.assign(critique.findings[0]!, { unexpected: true })
    expectUnknownKeyAt(CritiqueReportV1Schema, critique, 'findings.0')

    const manifest = structuredClone(
      materialsPackageFeedbackArtifactManifestFixture
    )
    Object.assign(manifest.artifacts[0]!, { unexpected: true })
    expectUnknownKeyAt(ArtifactManifestV1Schema, manifest, 'artifacts.0')
  })

  it('rejects an artifact digest that is not a 64-character SHA-256 hex value', () => {
    const manifest = structuredClone(materialsPackageFeedbackArtifactManifestFixture)
    manifest.artifacts[0]!.sha256 = 'not-a-sha256'
    expectInvalidAt(ArtifactManifestV1Schema, manifest, 'artifacts.0.sha256')
  })
})

describe('feedback and invalidation contract negative cases', () => {
  it('rejects unknown feedback source, category, action, and invalid UTC timestamps', () => {
    expectInvalidAt(
      FeedbackSignalV1Schema,
      { ...materialsPackageFeedbackSignalFixture, source: 'fixture-source' },
      'source'
    )
    expectInvalidAt(
      FeedbackSignalV1Schema,
      {
        ...materialsPackageFeedbackSignalFixture,
        category: 'fixture-category'
      },
      'category'
    )
    expectInvalidAt(
      FeedbackSignalV1Schema,
      {
        ...materialsPackageFeedbackSignalFixture,
        proposed_action: 'fixture-action'
      },
      'proposed_action'
    )
    expectInvalidAt(
      InvalidationEventV1Schema,
      {
        ...materialsPackageFeedbackInvalidationFixture,
        created_at: '2026-08-28T03:00:00+03:00'
      },
      'created_at'
    )
  })

  it('rejects invalid referenced versions and nested requested-change extras', () => {
    expectInvalidAt(
      InvalidationEventV1Schema,
      {
        ...materialsPackageFeedbackInvalidationFixture,
        changed_ref: {
          ...materialsPackageFeedbackInvalidationFixture.changed_ref,
          version: 0
        }
      },
      'changed_ref.version'
    )
    expectUnknownKeyAt(
      ChangeRequestV1Schema,
      {
        ...materialsPackageFeedbackChangeRequestFixture,
        requested_changes: [
          {
            ...materialsPackageFeedbackChangeRequestFixture
              .requested_changes[0],
            unexpected: true
          }
        ]
      },
      'requested_changes.0'
    )
  })
})
