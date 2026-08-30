import { describe, expect, it } from 'vitest'
import {
  assertTypecheckBaseline,
  compareDiagnosticMultiset,
  normalizeDiagnosticFile,
  parseTypeScriptDiagnostics,
  type AllowedTypeScriptFingerprint,
  type TypeScriptDiagnostic
} from './typecheckBaseline'

const PROJECT_ROOT = 'C:\\fixture\\AntyFlow'
const ALLOWED: AllowedTypeScriptFingerprint[] = [
  {
    id: 'fixture-one',
    file: 'src/fixture.ts',
    code: 18048,
    message: "'value' is possibly 'undefined'.",
    allowed_count: 2,
    locations: [
      { line: 10, column: 3, symbol: 'value', source_anchor: 'fixture anchor one' },
      { line: 20, column: 5, symbol: 'value', source_anchor: 'fixture anchor two' }
    ]
  }
]

function diagnostic(overrides: Partial<TypeScriptDiagnostic> = {}): TypeScriptDiagnostic {
  return {
    file: 'src/fixture.ts',
    line: 10,
    column: 3,
    code: 18048,
    message: "'value' is possibly 'undefined'.",
    ...overrides
  }
}

describe('TypeScript baseline exact multiset comparator', () => {
  it('normalizes primary diagnostics and reports an added or changed diagnostic', () => {
    const output = [
      "C:\\fixture\\AntyFlow\\src\\fixture.ts(10,3): error TS18048:   'value'   is possibly 'undefined'.  ",
      "  Type 'continuation' is not assignable to type 'anything'.",
      "src/other.ts(4,2): error TS2307: Cannot find module 'fixture'.",
      'error TS9999: Global fixture failure.',
      'Found 3 errors.'
    ].join('\r\n')

    expect(parseTypeScriptDiagnostics(output, PROJECT_ROOT)).toEqual([
      diagnostic(),
      {
        file: 'src/other.ts',
        line: 4,
        column: 2,
        code: 2307,
        message: "Cannot find module 'fixture'."
      },
      {
        file: '<global>',
        line: 0,
        column: 0,
        code: 9999,
        message: 'Global fixture failure.'
      }
    ])
    expect(normalizeDiagnosticFile('.\\src\\fixture.ts', PROJECT_ROOT)).toBe(
      'src/fixture.ts'
    )

    const added = compareDiagnosticMultiset(
      [diagnostic(), diagnostic({ line: 20 }), diagnostic({ code: 9999, message: 'Added.' })],
      ALLOWED,
      PROJECT_ROOT
    )
    expect(added.ok).toBe(false)
    expect(added.unexpected).toEqual([
      {
        file: 'src/fixture.ts',
        code: 9999,
        message: 'Added.',
        expected_count: 0,
        actual_count: 1
      }
    ])
    expect(added.missing).toEqual([])

    const changed = compareDiagnosticMultiset(
      [diagnostic(), diagnostic({ line: 20, message: "'value' is definitely undefined." })],
      ALLOWED,
      PROJECT_ROOT
    )
    expect(changed.ok).toBe(false)
    expect(changed.unexpected).toEqual([
      {
        file: 'src/fixture.ts',
        code: 18048,
        message: "'value' is definitely undefined.",
        expected_count: 0,
        actual_count: 1
      }
    ])
    expect(changed.missing).toEqual([
      {
        file: 'src/fixture.ts',
        code: 18048,
        message: "'value' is possibly 'undefined'.",
        expected_count: 2,
        actual_count: 1
      }
    ])
  })

  it('reports a removed allowed diagnostic as missing', () => {
    const result = compareDiagnosticMultiset([diagnostic()], ALLOWED, PROJECT_ROOT)

    expect(result.ok).toBe(false)
    expect(result.unexpected).toEqual([])
    expect(result.missing).toEqual([
      {
        file: 'src/fixture.ts',
        code: 18048,
        message: "'value' is possibly 'undefined'.",
        expected_count: 2,
        actual_count: 1
      }
    ])
  })
})

describe('M0.6 project TypeScript baseline', () => {
  it(
    'matches the local compiler output to the normative manifest exactly',
    () => {
      const result = assertTypecheckBaseline()

      expect(result.exitCode).toBe(2)
      expect(result.diagnostics).toHaveLength(13)
      expect(result.comparison).toEqual({ ok: true, unexpected: [], missing: [] })
    },
    35_000
  )
})
