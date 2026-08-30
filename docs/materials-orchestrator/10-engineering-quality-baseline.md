# M0.6 — инженерный baseline качества

Дата фиксации: **2026-08-28**

Normative manifest: [`baselines/M0.6-quality-baseline.json`](./baselines/M0.6-quality-baseline.json)

## 1. Что именно зафиксировано

Этот документ задаёт контрольную точку после защитного эпика E0:

- полный автоматический test-набор проходит;
- production build main, preload и renderer проходит;
- raw TypeScript содержит ровно 13 принятых диагностик технического долга;
- `npm test` автоматически сравнивает реальный typecheck с точным allowlist;
- toolchain, конфигурационные хеши и контекст рабочего дерева известны.

Baseline не означает, что 13 ошибок корректны или должны остаться навсегда. Он означает только: это точное множество технического долга, принятое на момент M0.6. Любая другая диагностика является новой регрессией.

## 2. Идентификация snapshot

| Поле | Значение |
|---|---|
| Git HEAD | `96aa1be31d23182021fafbf861a79560629c02ec` |
| Branch | `feat/t1.1-sqlite` |
| Working tree | dirty |
| Платформа | Windows 11, `win32-x64`, OS `10.0.26200.0` |
| Часовой пояс | `Europe/Moscow` |

HEAD указан только как контекст. Рабочее дерево содержит незакоммиченные, уже принятые результаты M0.1–M0.5, поэтому один commit hash не воспроизводит фактическое состояние. Нормативную идентичность задают manifest, SHA-256 ключевых входов и diagnostic fingerprints.

## 3. Toolchain

| Инструмент | Resolved version |
|---|---:|
| Node.js | `24.5.0` |
| npm | `11.5.1` |
| TypeScript | `5.9.3` |
| Vitest | `4.1.10` |
| Vite | `5.4.21` |
| electron-vite | `2.3.0` |
| Electron | `33.4.11` |
| PowerShell | `7.6.4` |

Смена TypeScript останавливает baseline guard до явного пересмотра manifest: новая версия компилятора может менять коды и формулировки диагностик.

## 4. Конфигурационные SHA-256

| Файл | SHA-256 |
|---|---|
| `package.json` | `f06453587986c82917588fe81f1a694ab308da85926ed103a6e1c0b74270a945` |
| `package-lock.json` | `3a3743f8dc80d3ee65bbdae9d30ac79e6db131b528a0650023c7ecc35a2b1002` |
| `tsconfig.json` | `1e74c194386aa63d4fcfbc4486dda9221fe0a33898c2a72a2d9cb3c45cb15fcf` |
| `electron.vite.config.ts` | `df9d454df71469a2579da0e6e38d65be310eec582c38906dfa3edf6fd755bcbd` |

Guard жёстко проверяет TypeScript version и `tsconfig.json` hash. Остальные hashes фиксируют контекст для ревью и обновляются только с объяснением в соответствующей карточке.

## 5. Автоматические тесты

Итоговый baseline после добавления guard:

| Метрика | Значение |
|---|---:|
| Test-файлы | 12 |
| Suites | 30 |
| Tests | 95 |
| Passed | 95 |
| Failed | 0 |
| Skipped | 0 |

| Test-файл | Tests |
|---|---:|
| `src/main/orchestrator/__tests__/fakeRuntime.test.ts` | 12 |
| `src/main/orchestrator/__tests__/fakeRuntimeEngine.test.ts` | 3 |
| `src/main/orchestrator/__tests__/genericProfileRegression.test.ts` | 3 |
| `src/main/orchestrator/__tests__/materialsLegacyBypass.test.ts` | 4 |
| `src/main/orchestrator/__tests__/orchestratorStartIpc.test.ts` | 3 |
| `src/main/orchestrator/__tests__/typecheckBaseline.test.ts` | 3 |
| `src/main/orchestrator/__tests__/workflowProfilePropagation.test.ts` | 14 |
| `src/main/orchestrator/__tests__/workflowProfileRouting.test.ts` | 13 |
| `src/preload/__tests__/orchestratorProfileBridge.test.ts` | 2 |
| `src/renderer/src/orchestrator/__tests__/buildOrchestratorStartArgs.test.ts` | 10 |
| `src/renderer/src/shapes/schemas/__tests__/migrations.test.ts` | 11 |
| `src/shared/orchestrator/__tests__/workflowProfile.test.ts` | 17 |

`fakeRuntime.ts`, `fakeFixtures.ts` и `typecheckBaseline.ts` — test-only helpers, а не самостоятельные test-файлы.

## 6. Production build

Команда `npm run build` завершилась с exit code `0`:

| Стадия | Результат |
|---|---|
| Electron main | passed |
| Preload | passed |
| Renderer | passed, 4194 modules transformed |

Сборка установщика, запуск упакованного Flow и интерактивный UI smoke не входили в M0.6.

## 7. TypeScript baseline

Два последовательных запуска дали одинаковые **13 диагностик в трёх файлах**, сгруппированные в **9 fingerprints**.

| ID | File / semantic anchor | Code | Allowed count | Primary message |
|---|---|---:|---:|---|
| TSC-001 | `research.ts` / `researchPhase: plan.facets` | TS18048 | 2 | `'plan.facets' is possibly 'undefined'.` |
| TSC-002 | `pdfjs.ts` / worker URL import | TS2307 | 1 | Vite `?url` module declaration не найден |
| TSC-003 | `FlowNodeShapeUtil.tsx` / три `aiChat.timeoutMs` | TS2353 | 3 | `timeoutMs` отсутствует в renderer aiChat input type |
| TSC-004 | `FlowNodeShapeUtil.tsx` / `CodeRequestBody` updater | TS2345 | 1 | updater function передана параметру `string` |
| TSC-005 | `FlowNodeShapeUtil.tsx` / updater parameter | TS7006 | 1 | параметр `p` имеет implicit `any` |
| TSC-006 | `FlowNodeShapeUtil.tsx` / `DeckBody.collectSlides` | TS2322 | 1 | массив с `null` несовместим с `ExportItem[]` |
| TSC-007 | `FlowNodeShapeUtil.tsx` / slide filter | TS2677 | 1 | type predicate несовместим с mapped item type |
| TSC-008 | `FlowNodeShapeUtil.tsx` / `NotebookBody.persist`, `PdfNodeBody.setEx` | TS2322 | 2 | `Editor` несовместим с `void` |
| TSC-009 | `FlowNodeShapeUtil.tsx` / orchestrator status | TS2339 | 1 | `depth` отсутствует в `OStatus` |

Полные сообщения, review locations, columns и source anchors находятся в JSON manifest. Source hashes диагностических файлов также сохранены там.

### Почему в shell виден code 1, а в manifest code 2

`npx tsc --noEmit --pretty false` из PowerShell в текущем окружении отображает общий failed-command code `1`. Guard не зависит от shell: он запускает локальный `node_modules/typescript/bin/tsc` через `process.execPath`. Сам TypeScript CLI возвращает code `2` при compile diagnostics; именно `2` записан как нормативный raw exit code.

## 8. Как работает guard

```text
actual fingerprint
  = normalized project-relative file
  + TypeScript diagnostic code
  + normalized primary one-line message

actual multiset == manifest multiset
```

Line и column намеренно не входят в ключ: добавление строк выше ошибки не превращает старый долг в новую проблему. Semantic anchor и capture location нужны человеку при ревью.

Guard падает, если:

- появился новый fingerprint;
- увеличилось разрешённое количество;
- изменилось primary message или TS code;
- разрешённая ошибка исчезла, но manifest не был сокращён;
- изменилась версия TypeScript;
- изменился `tsconfig.json`.

Последнее правило про исчезнувшую ошибку намеренно строгое: исправление должно уменьшить manifest в той же карточке, иначе старое разрешение позволило бы долгу вернуться.

## 9. Правило для следующих карточек

1. Запустить `npm test`: baseline guard входит в общий набор.
2. Запустить `npm run build`.
3. При падении guard посмотреть отчёт `unexpected` и `missing`.
4. `unexpected` всегда считается регрессией; добавлять его в manifest в обычной implementation-карточке нельзя.
5. `missing` означает улучшение: удалить fingerprint или уменьшить `allowed_count`, обновить capture locations/hashes и зафиксировать это в отчёте карточки.
6. Падающие tests/build не могут быть объявлены baseline.

## 10. Граница достоверности

Baseline относится к фактическому dirty working tree на момент M0.6, а не только к Git HEAD. Он не доказывает, что все 13 долгов существовали до M0.1, и не заменяет commit истории. Он делает другое: точно фиксирует принятый набор на границе E0 и автоматически запрещает его незаметное расширение.
