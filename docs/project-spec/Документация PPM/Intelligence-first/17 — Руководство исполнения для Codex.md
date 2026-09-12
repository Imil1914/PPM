---
type: codex_playbook
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 17 — Руководство исполнения для Codex

## Назначение

Этот документ задаёт повторяемый способ реализации PPM агентом Codex или разработчиком. Карточка задачи определяет scope; этот playbook — порядок работы.

## Перед началом

1. Прочитать repository `AGENTS.md`/`CLAUDE.md` и локальные инструкции.
2. Прочитать [индекс ТЗ](<README.md>).
3. Прочитать документы, указанные карточкой.
4. Проверить status/dependencies карточки.
5. Проверить branch, commit, dirty tree и не перезаписывать чужие изменения.
6. Зафиксировать версии toolchain и способ запуска baseline.
7. Не начинать следующую карточку вместе с текущей.

## Формат одной реализации

```text
Understand
→ inspect existing code
→ state assumptions
→ implement smallest vertical change
→ add/update tests
→ run targeted checks
→ run regression gate
→ inspect diff
→ update docs/changelog
→ report result and unresolved risks
```

## Правило upstream

- сначала сохранить clean Plane baseline ref;
- PPM изменения — отдельные тематические commits;
- не форматировать несвязанные upstream files;
- не переименовывать `@plane/*` packages ради бренда;
- новые PPM-модели помещать в isolated apps;
- upstream update выполняется отдельной задачей;
- любой обход Plane permission service требует объяснения и security test.

## Правило web-порта AntyFlow

Перед переносом модуля классифицировать зависимости:

| Зависимость | Действие |
|---|---|
| React/tldraw/pure TS | можно адаптировать |
| Electron IPC | заменить HTTP/service abstraction |
| Node `fs/path` | перенести в server-side Vault service |
| `better-sqlite3` | заменить server persistence |
| localStorage canonical data | заменить API; local cache не canonical |
| webview/terminal/kernel | исключить из web MVP |
| local API key | заменить server secret/model gateway |
| local file path | заменить Vault entry/object reference |

Нельзя временно протащить unsafe desktop dependency в production bundle.

## Контракт-first

Для новой функции сначала:

1. определить source of truth;
2. определить permission capability;
3. добавить тип/schema;
4. определить API/event;
5. написать negative/contract test;
6. затем писать UI и implementation.

Для JSON обязательно schema version. Для mutation — idempotency/precondition. Для derived data — source version/hash.

## Работа с миграциями

- migration additive по умолчанию;
- destructive migration требует отдельного решения/backup plan;
- уникальные constraints и indexes фиксируются явно;
- backfill отделён от schema migration при большом объёме;
- migration тестируется на пустой и восстановленной базе;
- rollback описывает поведение данных.

## Работа с UI

Каждый новый экран имеет:

- loading;
- empty;
- success;
- validation error;
- permission denied;
- dependency unavailable;
- stale/conflict, если редактируемый;
- keyboard/focus behavior;
- русские строки через i18n;
- visual screenshot fixture.

Никаких hardcoded user-facing strings, если экран уже подключён к i18n.

## Работа с AI/RAG

- не отправлять источник до ACL/filter;
- хранить точный source/version/locator;
- тестировать отсутствие источника;
- предоставлять keyword fallback;
- отделять retrieved content от tool instructions;
- не добавлять write tool без action schema/preview/approval/idempotency;
- не использовать качество одного ручного ответа как единственную проверку.

## Работа с Git provider

- использовать API adapter, не shell interpolation;
- verify webhook raw body/signature;
- encrypt/store token вне browser;
- минимальные provider scopes;
- normalized models не содержат provider-specific fields без `provider_data` namespace;
- никакого merge/delete repository без отдельной задачи и подтверждения.

## Минимальные проверки до отчёта

1. Format/lint затронутого пакета.
2. Typecheck.
3. Targeted unit/integration tests.
4. Permission negative test.
5. Production build затронутого web/service.
6. Manual golden path карточки.
7. `git diff --check` и review изменённых файлов.
8. Проверка отсутствия secrets/generated artifacts.

Точные команды берутся из фактического repository и фиксируются в I0.1/I0.2; нельзя выдумывать команды, которых нет в package/scripts.

## Отчёт Codex

```markdown
## Результат

## Изменённые файлы

## Выполненные проверки

## Критерии приёмки

## Ограничения и риски

## Как воспроизвести

## Следующая карточка
```

Отчёт не объявляет задачу `accepted`. Если тест не запускался, это указывается прямо.

## Stop rules

Codex прекращает mutation и сообщает владельцу, если:

- требуется удалить/переписать чужие изменения;
- source of truth неоднозначен;
- задача требует нового внешнего provider/платной функции без решения;
- migration может потерять данные;
- permission невозможно проверить;
- требуется secret, которого нет;
- scope расширился на следующую фазу;
- AGPL/legal требование конфликтует с запланированной публикацией.

## Признак хорошей карточки

Другой разработчик способен:

1. понять пользовательский результат;
2. найти разрешённые компоненты;
3. выполнить шаги без устной расшифровки;
4. проверить результат указанными тестами;
5. откатить функцию;
6. не принять случайно следующую архитектурную задачу.
