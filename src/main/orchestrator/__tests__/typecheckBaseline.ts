import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TypeScriptDiagnostic {
  file: string
  line: number
  column: number
  code: number
  message: string
}

export interface AllowedTypeScriptFingerprint {
  id?: string
  file: string
  code: number
  message: string
  allowed_count: number
  locations?: ReadonlyArray<{
    line: number
    column: number
    symbol?: string
    source_anchor?: string
  }>
}

export interface TypecheckBaselineManifest {
  schema_version: 1
  toolchain: {
    typescript: string
  }
  hashes: {
    'tsconfig.json': string
    [file: string]: string
  }
  typecheck: {
    command?: string | readonly string[]
    expected_exit_code: number
    diagnostic_count: number
    fingerprints: AllowedTypeScriptFingerprint[]
  }
}

export interface DiagnosticCount {
  file: string
  code: number
  message: string
  count: number
}

export interface DiagnosticDelta {
  file: string
  code: number
  message: string
  expected_count: number
  actual_count: number
}

export interface DiagnosticComparison {
  ok: boolean
  unexpected: DiagnosticDelta[]
  missing: DiagnosticDelta[]
}

export interface TypecheckBaselineResult {
  ok: boolean
  exitCode: number
  expectedExitCode: number
  diagnostics: TypeScriptDiagnostic[]
  comparison: DiagnosticComparison
}

export interface TypecheckBaselineOptions {
  projectRoot?: string
  manifestPath?: string
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PROJECT_ROOT = resolve(MODULE_DIR, '../../../..')
export const DEFAULT_MANIFEST_PATH = resolve(
  DEFAULT_PROJECT_ROOT,
  'docs/materials-orchestrator/baselines/M0.6-quality-baseline.json'
)

const PRIMARY_DIAGNOSTIC = /^(.+)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s*(.*)$/
const GLOBAL_DIAGNOSTIC = /^error\s+TS(\d+):\s*(.*)$/
const SHA256 = /^[a-f0-9]{64}$/
const WINDOWS_ABSOLUTE = /^[a-z]:\//i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid baseline manifest: ${label} must be an object`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid baseline manifest: ${label} must be a non-empty string`)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid baseline manifest: ${label} must be a non-negative integer`)
  }
  return value as number
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function caseInsensitivePrefix(value: string, prefix: string): boolean {
  return value.toLocaleLowerCase('en-US').startsWith(prefix.toLocaleLowerCase('en-US'))
}

/**
 * Converts TypeScript's platform-specific path to a stable project-relative POSIX path.
 */
export function normalizeDiagnosticFile(file: string, projectRoot = DEFAULT_PROJECT_ROOT): string {
  const raw = normalizeSlashes(file.trim())
  const rawProjectRoot = normalizeSlashes(projectRoot.trim()).replace(/\/$/, '')
  const root = WINDOWS_ABSOLUTE.test(rawProjectRoot)
    ? posix.normalize(rawProjectRoot)
    : normalizeSlashes(resolve(projectRoot)).replace(/\/$/, '')
  const rootPrefix = `${root}/`
  let projectRelative: string
  const belongsToRoot = WINDOWS_ABSOLUTE.test(root)
    ? raw.toLocaleLowerCase('en-US') === root.toLocaleLowerCase('en-US') ||
      caseInsensitivePrefix(raw, rootPrefix)
    : raw === root || raw.startsWith(rootPrefix)

  if (belongsToRoot) {
    projectRelative = raw.slice(root.length).replace(/^\/+/, '')
  } else if (isAbsolute(file)) {
    projectRelative = normalizeSlashes(relative(projectRoot, file))
  } else {
    projectRelative = raw.replace(/^\.\//, '')
  }

  return posix.normalize(projectRelative)
}

/** Normalizes only the primary one-line diagnostic message used in the fingerprint. */
export function normalizeDiagnosticMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ')
}

/**
 * Parses only primary one-line diagnostics produced by `tsc --pretty false`.
 * Continuation lines of complex TypeScript messages intentionally do not become diagnostics.
 */
export function parseTypeScriptDiagnostics(
  output: string,
  projectRoot = DEFAULT_PROJECT_ROOT
): TypeScriptDiagnostic[] {
  const diagnostics: TypeScriptDiagnostic[] = []

  for (const rawLine of output.split(/\r?\n/)) {
    const match = PRIMARY_DIAGNOSTIC.exec(rawLine)
    if (match) {
      diagnostics.push({
        file: normalizeDiagnosticFile(match[1], projectRoot),
        line: Number(match[2]),
        column: Number(match[3]),
        code: Number(match[4]),
        message: normalizeDiagnosticMessage(match[5])
      })
      continue
    }

    const globalMatch = GLOBAL_DIAGNOSTIC.exec(rawLine)
    if (globalMatch) {
      diagnostics.push({
        file: '<global>',
        line: 0,
        column: 0,
        code: Number(globalMatch[1]),
        message: normalizeDiagnosticMessage(globalMatch[2])
      })
    }
  }

  return diagnostics
}

function fingerprint(file: string, code: number, message: string): string {
  return `${file}\u0000TS${code}\u0000${message}`
}

function sortCounts(left: DiagnosticCount, right: DiagnosticCount): number {
  return (
    left.file.localeCompare(right.file, 'en') ||
    left.code - right.code ||
    left.message.localeCompare(right.message, 'en')
  )
}

export function groupDiagnostics(
  diagnostics: ReadonlyArray<Pick<TypeScriptDiagnostic, 'file' | 'code' | 'message'>>,
  projectRoot = DEFAULT_PROJECT_ROOT
): DiagnosticCount[] {
  const groups = new Map<string, DiagnosticCount>()

  for (const diagnostic of diagnostics) {
    const file = normalizeDiagnosticFile(diagnostic.file, projectRoot)
    const message = normalizeDiagnosticMessage(diagnostic.message)
    const key = fingerprint(file, diagnostic.code, message)
    const current = groups.get(key)
    if (current) current.count += 1
    else groups.set(key, { file, code: diagnostic.code, message, count: 1 })
  }

  return [...groups.values()].sort(sortCounts)
}

function groupAllowedFingerprints(
  fingerprints: ReadonlyArray<AllowedTypeScriptFingerprint>,
  projectRoot: string
): DiagnosticCount[] {
  const groups = new Map<string, DiagnosticCount>()

  for (const allowed of fingerprints) {
    const file = normalizeDiagnosticFile(allowed.file, projectRoot)
    const message = normalizeDiagnosticMessage(allowed.message)
    const key = fingerprint(file, allowed.code, message)
    const current = groups.get(key)
    if (current) current.count += allowed.allowed_count
    else {
      groups.set(key, {
        file,
        code: allowed.code,
        message,
        count: allowed.allowed_count
      })
    }
  }

  return [...groups.values()].sort(sortCounts)
}

export function compareDiagnosticMultiset(
  actual: ReadonlyArray<Pick<TypeScriptDiagnostic, 'file' | 'code' | 'message'>>,
  allowed: ReadonlyArray<AllowedTypeScriptFingerprint>,
  projectRoot = DEFAULT_PROJECT_ROOT
): DiagnosticComparison {
  const actualGroups = groupDiagnostics(actual, projectRoot)
  const expectedGroups = groupAllowedFingerprints(allowed, projectRoot)
  const actualByKey = new Map(
    actualGroups.map((item) => [fingerprint(item.file, item.code, item.message), item])
  )
  const expectedByKey = new Map(
    expectedGroups.map((item) => [fingerprint(item.file, item.code, item.message), item])
  )
  const keys = [...new Set([...actualByKey.keys(), ...expectedByKey.keys()])].sort()
  const unexpected: DiagnosticDelta[] = []
  const missing: DiagnosticDelta[] = []

  for (const key of keys) {
    const actualItem = actualByKey.get(key)
    const expectedItem = expectedByKey.get(key)
    const actualCount = actualItem?.count ?? 0
    const expectedCount = expectedItem?.count ?? 0
    if (actualCount === expectedCount) continue

    const source = actualItem ?? expectedItem
    if (!source) continue
    const delta: DiagnosticDelta = {
      file: source.file,
      code: source.code,
      message: source.message,
      expected_count: expectedCount,
      actual_count: actualCount
    }
    if (actualCount > expectedCount) unexpected.push(delta)
    else missing.push(delta)
  }

  return { ok: unexpected.length === 0 && missing.length === 0, unexpected, missing }
}

export function readTypecheckBaselineManifest(
  manifestPath = DEFAULT_MANIFEST_PATH
): TypecheckBaselineManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot read baseline manifest ${manifestPath}: ${detail}`)
  }

  const root = requireRecord(parsed, 'root')
  if (root.schema_version !== 1) {
    throw new Error('Invalid baseline manifest: schema_version must equal 1')
  }
  const toolchain = requireRecord(root.toolchain, 'toolchain')
  const hashes = requireRecord(root.hashes, 'hashes')
  const typecheck = requireRecord(root.typecheck, 'typecheck')
  const rawFingerprints = typecheck.fingerprints
  if (!Array.isArray(rawFingerprints)) {
    throw new Error('Invalid baseline manifest: typecheck.fingerprints must be an array')
  }

  const fingerprints = rawFingerprints.map((value, index): AllowedTypeScriptFingerprint => {
    const item = requireRecord(value, `typecheck.fingerprints[${index}]`)
    const code = requireNonNegativeInteger(item.code, `typecheck.fingerprints[${index}].code`)
    const allowedCount = requireNonNegativeInteger(
      item.allowed_count,
      `typecheck.fingerprints[${index}].allowed_count`
    )
    if (code === 0 || allowedCount === 0) {
      throw new Error(
        `Invalid baseline manifest: fingerprint ${index} code and allowed_count must be positive`
      )
    }
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      file: requireString(item.file, `typecheck.fingerprints[${index}].file`),
      code,
      message: requireString(item.message, `typecheck.fingerprints[${index}].message`),
      allowed_count: allowedCount,
      locations: Array.isArray(item.locations)
        ? (item.locations as AllowedTypeScriptFingerprint['locations'])
        : undefined
    }
  })
  const diagnosticCount = requireNonNegativeInteger(
    typecheck.diagnostic_count,
    'typecheck.diagnostic_count'
  )
  const allowedCount = fingerprints.reduce((sum, item) => sum + item.allowed_count, 0)
  if (allowedCount !== diagnosticCount) {
    throw new Error(
      `Invalid baseline manifest: diagnostic_count=${diagnosticCount}, allowed_count sum=${allowedCount}`
    )
  }

  const tsconfigHash = requireString(hashes['tsconfig.json'], "hashes['tsconfig.json']")
    .toLocaleLowerCase('en-US')
  if (!SHA256.test(tsconfigHash)) {
    throw new Error("Invalid baseline manifest: hashes['tsconfig.json'] must be lowercase SHA-256")
  }

  return {
    schema_version: 1,
    toolchain: { typescript: requireString(toolchain.typescript, 'toolchain.typescript') },
    hashes: { ...hashes, 'tsconfig.json': tsconfigHash } as TypecheckBaselineManifest['hashes'],
    typecheck: {
      command:
        typeof typecheck.command === 'string' || Array.isArray(typecheck.command)
          ? (typecheck.command as string | readonly string[])
          : undefined,
      expected_exit_code: requireNonNegativeInteger(
        typecheck.expected_exit_code,
        'typecheck.expected_exit_code'
      ),
      diagnostic_count: diagnosticCount,
      fingerprints
    }
  }
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function readLocalTypeScriptVersion(projectRoot = DEFAULT_PROJECT_ROOT): string {
  const packagePath = resolve(projectRoot, 'node_modules/typescript/package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot read local TypeScript package ${packagePath}: ${detail}`)
  }
  return requireString(requireRecord(parsed, 'TypeScript package').version, 'TypeScript version')
}

/** Must run before the TypeScript process so a toolchain/config change cannot reach comparison. */
export function assertBaselinePrerequisites(
  manifest: TypecheckBaselineManifest,
  projectRoot = DEFAULT_PROJECT_ROOT
): void {
  const actualVersion = readLocalTypeScriptVersion(projectRoot)
  if (actualVersion !== manifest.toolchain.typescript) {
    throw new Error(
      `TypeScript version mismatch: expected ${manifest.toolchain.typescript}, actual ${actualVersion}`
    )
  }

  const actualTsconfigHash = sha256File(resolve(projectRoot, 'tsconfig.json'))
  const expectedTsconfigHash = manifest.hashes['tsconfig.json']
  if (actualTsconfigHash !== expectedTsconfigHash) {
    throw new Error(
      `tsconfig.json SHA-256 mismatch: expected ${expectedTsconfigHash}, actual ${actualTsconfigHash}`
    )
  }
}

export function runTypecheckBaseline(
  options: TypecheckBaselineOptions = {}
): TypecheckBaselineResult {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT)
  const manifestPath = resolve(options.manifestPath ?? DEFAULT_MANIFEST_PATH)
  const manifest = readTypecheckBaselineManifest(manifestPath)

  // These checks intentionally happen before spawning TypeScript.
  assertBaselinePrerequisites(manifest, projectRoot)

  const tscBin = resolve(projectRoot, 'node_modules/typescript/bin/tsc')
  const processResult = spawnSync(
    process.execPath,
    [tscBin, '--noEmit', '--pretty', 'false'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      windowsHide: true
    }
  )
  if (processResult.error) {
    throw new Error(`Cannot run local TypeScript: ${processResult.error.message}`)
  }
  if (processResult.status === null) {
    throw new Error(`Local TypeScript terminated by signal ${processResult.signal ?? 'unknown'}`)
  }

  const output = `${processResult.stdout ?? ''}\n${processResult.stderr ?? ''}`
  const diagnostics = parseTypeScriptDiagnostics(output, projectRoot)
  const comparison = compareDiagnosticMultiset(
    diagnostics,
    manifest.typecheck.fingerprints,
    projectRoot
  )
  const exitMatches = processResult.status === manifest.typecheck.expected_exit_code

  return {
    ok: exitMatches && comparison.ok,
    exitCode: processResult.status,
    expectedExitCode: manifest.typecheck.expected_exit_code,
    diagnostics,
    comparison
  }
}

function formatDeltas(label: string, deltas: readonly DiagnosticDelta[]): string[] {
  if (deltas.length === 0) return []
  return [
    `${label}:`,
    ...deltas.map(
      (item) =>
        `  ${item.file} TS${item.code}: ${item.message} ` +
        `(expected ${item.expected_count}, actual ${item.actual_count})`
    )
  ]
}

export function assertTypecheckBaseline(
  options: TypecheckBaselineOptions = {}
): TypecheckBaselineResult {
  const result = runTypecheckBaseline(options)
  if (result.ok) return result

  const lines = [
    'TypeScript quality baseline mismatch.',
    `Exit code: expected ${result.expectedExitCode}, actual ${result.exitCode}.`,
    ...formatDeltas('Unexpected diagnostics', result.comparison.unexpected),
    ...formatDeltas('Missing diagnostics', result.comparison.missing)
  ]
  throw new Error(lines.join('\n'))
}
