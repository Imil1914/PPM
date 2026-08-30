# Журнал изменений материаловедческого оркестратора

## 2026-08-28 — M1.4: неизменяемый Materials Version Repository

- Владелец принял M1.3 и поручил продолжить работу.
- M1.4 ограничена синхронным project-scoped Version Repository поверх существующей SQLite-схемы v4: `create`, exact `read`, cursor `list` и атомарный `supersede`.
- Единый реестр 44 Zod-контрактов объявлен persistable manifest. Обязательные `schema_version/id/version/created_at/created_by` живут во внешнем storage envelope; одноимённые поля payload, если они объявлены контрактом, обязаны совпадать.
- Зафиксированы fail-closed повторная проверка Zod/hash/envelope при чтении, запрет ветвления и только `N+1`, обязательный project context и отсутствие IPC, project CRUD, events M1.5 и mapping ошибок M1.6.
- После независимого review write API получил явный optional `createdAt`: контракты с обязательным timestamp согласуют payload и envelope без угадывания внутренних часов.
- `list` валидирует полную lineage один раз от самой новой строки страницы, а не повторяет тот же проход для каждого элемента.
- Полная lineage и все child-связи загружаются двумя пакетными SQLite-запросами; число синхронных round-trips больше не растёт с глубиной истории.
- Реализованы `create`, exact `read`, bounded cursor `list` и атомарный `supersede N+1` для внешнего envelope всех 44 контрактов без подключения к generic runtime.
- Read path заново проверяет canonical JSON, SHA-256, Zod, envelope, safe SQLite int64 и полную lineage; corruption не пропускается молча.
- Финал: M1.4 45/45, весь проект 20 test-файлов и 652/652 теста, baseline 3/3, production build и diff check прошли. После исправления `createdAt` и bulk-lineage три независимых read-only аудита не нашли P1/P2.
- Native Electron/`better-sqlite3` smoke отложен из-за отсутствующих binary/binding; скрытый ABI rebuild не выполнялся. Карточка переведена в `review`, M1.5 не запускалась.

## 2026-08-28 — M1.3: SQLite-фундамент Materials Version Store

- Единый manifest миграций продолжен до версии 4; SQL legacy-миграций 1–3 сохранён без изменений.
- Добавлены `materials_projects` и append-only `materials_object_versions` с JSON/hash/revision constraints, project и same-project predecessor FK, индексами и immutable triggers.
- Migration runner стал чистым и тестируемым: continuous history, future-version gate, `BEGIN IMMEDIATE`, атомарный marker и полный rollback.
- Ошибка миграции отделена от физической порчи: `quick_check` выполняется до и после миграций, а логический migration failure больше не запускает backup/recreate исходной БД.
- Реальная SQLite проверила fresh 1–4, upgrade физической v3-копии, legacy preservation, idempotence, constraints и rollback DDL/DML/marker с неизменным source SHA-256.
- Первое независимое ревью выявило fractional revision и поздний integrity gate; обе проблемы исправлены. Финальный аудит P1/P2-блокеров не нашёл.
- Финал: M1.3 12/12, полный набор 607/607, baseline guard без новых fingerprints, production build прошёл. Native Electron smoke отложен из-за отсутствующих binary/binding в checkout; карточка переведена в `review`, M1.4 не запускалась.

## 2026-08-28 — начало M1.3

- Владелец принял M1.2 и поручил продолжить работу.
- M1.3 ограничена глобальной SQLite-миграцией 4, двумя фундаментальными таблицами Version Store и безопасным транзакционным runner.
- Нормативных V0-контрактов нет, поэтому payload migration `V0 → V1` не изобретается; M1.4 CRUD, M1.5 events и Knowledge Plane остаются отдельными карточками.
- Зафиксировано окружение: общий SQL проверяется настоящей test-only `node:sqlite`, а отсутствующий native binding `better-sqlite3` не пересобирается скрыто и остаётся ручным Electron smoke gate.

## 2026-08-28 — M1.2: детерминированный экспорт JSON Schema

- Создан типизированный реестр 44 нормативных Zod-контрактов и автономный экспорт JSON Schema Draft 2020-12 без ручного дублирования shapes.
- Добавлены API одного документа, полного отсортированного каталога и канонической сериализации; параметры Zod fail-closed зафиксированы и покрыты тестами.
- Structural round-trip переиспользует единую матрицу M1.1 и проверяет full/minimal fixtures, required fields, типы и strict root objects для всех 44 контрактов.
- Зафиксирована граница: custom refinements остаются в исходной Zod-валидации, а JSON Schema служит только структурной обменной проекцией.
- Generated snapshot каталога стабилен: 173380 байт, SHA-256 `34F8AAA1EC294160CD4B1C6DD92410C140AF37330EE8C82EC27FE3B6095B7DA0`.
- После независимого ревью канонизация усилена против тихой порчи `__proto__`, нечисловых значений, `undefined` и циклов; повторное ревью блокеров не выявило.
- Финал: JSON Schema 185/185, contracts 500/500, полный набор 595/595, baseline guard без новых fingerprints, production build прошёл. Карточка переведена в `review`; M1.3 не запускалась.

## 2026-08-28 — начало M1.2

- Владелец принял M1.1 и поручил продолжить работу.
- Начата отдельная карточка экспорта стабильных JSON Schema Draft 2020-12 из нормативных Zod-схем без ручного дублирования shapes.

## 2026-08-28 — M1.1: нормативные Zod-контракты V1

- Создан изолированный `materials/contracts` из десяти модулей без production wiring и без изменения generic-пути.
- Реализованы strict runtime-схемы и выведенные TypeScript-типы для common, goal, graph, agents, tools, evidence, materials, package и feedback.
- Golden goal фиксирует `200 degC / 100 h / 250 degC`, четыре маршрута и максимум 8 будущих опытов; все материалы в fixtures символические.
- Динамическая матрица покрывает все 44 экспортированные `*V1Schema`: full/minimal, отсутствие required root fields и неверные типы; отдельные tests проверяют вложенную strict-валидацию и локальные инварианты.
- Исправлены три finding первого независимого ревью: обязательный locator фрагмента, generic `AgentResultV1<T>` и полная test matrix. Повторное ревью P1/P2-блокеров не нашло.
- Финал: contract 315/315, полный набор 410/410, baseline guard без новых fingerprints, production build прошёл. Карточка переведена в `review`; M1.2 не запускалась.

## 2026-08-28 — начало M1.1

- M0.6 принята владельцем; точный TypeScript baseline становится обязательной входной проверкой.
- Зафиксирована карточка M1.1 на нормативные строгие Zod-контракты V1 в `materials/contracts`.
- Scope ограничен runtime-схемами и контрактными тестами; JSON Schema, миграции, repository resolution, IPC, компилятор графа и доменная физика остаются следующими карточками.

## 2026-08-28 — M0.6: проверяемый baseline качества

- Созданы normative JSON manifest и человекочитаемый инженерный baseline окружения, тестов, build и TypeScript debt.
- Зафиксированы 13 диагностик в трёх файлах как девять точных fingerprints без file/code wildcard.
- Добавлен test-only parser/comparator и автоматический guard с прямым локальным запуском TypeScript без shell или сети.
- Guard проверяет TypeScript version и hash `tsconfig.json`, учитывает файловые и глобальные diagnostics, отклоняет added/changed и missing ошибки.
- `CLAUDE.md` и Codex playbook переведены с расплывчатого списка «старых ошибок» на точный M0.6 gate.
- Итоговый набор: 12 test-файлов, 30 suites, 95/95 tests; production build прошёл.
- Независимое ревью не обнаружило блокеров; production-код не менялся, карточка впоследствии принята владельцем.

## 2026-08-28 — начало M0.6

- Владелец поручил продолжить работу после технического отчёта M0.5.
- M0.5 переведена из `review` в `accepted`.
- Подготовлена и запущена карточка M0.6: машинно проверяемый baseline тестов, build, toolchain и TypeScript-диагностик без изменения production-кода.

## 2026-08-28 — M0.5: детерминированный FakeRuntime

- Добавлен полный test-only `FakeRuntime implements Runtime` без production-зависимостей и неполных runtime-заглушек.
- Добавлены общий in-memory backend, изоляция проектов, детерминированные ID, отмена, Vault, журналы вызовов и sticky-проверка неожиданных эффектов.
- AI, retrieval, registry, human, sub-orchestrator, research, AnythingLLM, board и web boundaries работают только через явные fixtures с matcher.
- Добавлены синтетические builders и self-tests, включая model usage и scripted `budget_exceeded` без копирования BudgetManager.
- Реальный materials engine прошёл DAG `t1 → t2`, повторный детерминированный запуск и Actor–Critic с human approve при независимой sibling-ветви.
- Полный набор из 92 тестов и production build прошли; новых TypeScript-ошибок нет.
- Production-код в scope M0.5 не изменялся; карточка переведена в `review`, M0.6 не запускалась.

## 2026-08-28 — начало M0.5

- Владелец принял M0.4 и поручил продолжить работу.
- M0.4 переведена из `review` в `accepted`.
- Подготовлена и запущена карточка M0.5: единый детерминированный FakeRuntime без изменений production-кода.

## 2026-08-28 — M0.4: закрытие legacy bypass

- Владелец принял M0.3 и явно поручил начать M0.4.
- M0.3 переведена из `review` в `accepted`.
- В engine добавлены две фиксированные внутренние политики legacy-фаз без расширения внешних контрактов.
- Production-маршрут `materials_rnd` больше не вызывает `webBuildPhase` и `assembleLecture`.
- Generic сохранил ранний webBuild-return и финальную scientific lecture-сборку.
- Production spy-тесты подтверждают отсутствие fallback при ошибке materials planner.
- Полный набор из 77 тестов и production build прошли успешно; новых TypeScript-ошибок нет.
- Карточка M0.4 переведена в `review`; полноценный доменный engine не входит в этот этап.

## 2026-08-28 — M0.3: раздельные точки входа профилей

- Владелец явно подтвердил продолжение реализации после отчёта M0.2.
- M0.2 переведена из `review` в `accepted`.
- Добавлен исчерпывающий замороженный router профилей между worker и engine.
- `generic` оставлен на прежнем engine, а `materials_rnd` направлен в отдельную начальную state machine.
- Добавлены строгие переходы состояния, системный trace и временный legacy bridge без подмены результата или ошибки.
- Неизвестный внутренний профиль завершается fail-closed без fallback.
- Полный набор из 74 тестов и production build прошли успешно; новых TypeScript-ошибок нет.
- Карточка M0.3 переведена в `review`; отключение webBuild/lecture остаётся отдельной M0.4.

## 2026-08-28 — M0.2: сквозная передача WorkflowProfile

- Владелец подтвердил переход от M0.1 к непосредственной реализации по ТЗ.
- M0.1 переведена из `review` в `accepted`.
- Добавлен выбор обычного и материаловедческого профилей в orchestrator-ноде.
- Профиль пронесён через renderer, preload, main IPC, root/child WorkerData, worker и engine.
- Недопустимый профиль отклоняется до создания run и любых побочных эффектов.
- Профиль добавлен в начальный и последующие trace, а также в новое дерево задач.
- Подтверждена совместимость старых нод и отсутствие новой маршрутизации.
- Полный набор из 61 теста, production build и строгая проверка новых файлов прошли успешно.
- Карточка M0.2 переведена в `review`; интерактивный Electron smoke остаётся шагом ревьюера.

## 2026-08-28 — M0.1: единый контракт WorkflowProfile

- Добавлен общий Zod-контракт профилей `generic | materials_rnd`.
- Добавлены тип, значение по умолчанию и строгая функция разбора.
- Добавлены unit-тесты допустимых, отсутствующих и ошибочных значений.
- Подтверждено отсутствие изменений существующего runtime-поведения.
- Целевые и полные тесты, production build и строгая проверка новых файлов прошли успешно.
- После технической проверки и подтверждения владельца карточка M0.1 принята.
