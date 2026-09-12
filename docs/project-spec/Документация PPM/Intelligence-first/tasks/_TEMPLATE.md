---
type: implementation_task_template
project_id: intellect-ppm
status: template
created: 2026-09-12
updated: 2026-09-12
---

# TASK-ID — Название

## Пользовательский результат

Что человек сможет сделать после задачи.

## Зависимости и входы

- предыдущие gates;
- документы;
- внешние решения/secrets.

## Scope

- точные компоненты/модели/экраны.

## Не входит

- явно исключённая работа.

## Порядок реализации

1. Inspect.
2. Contract/schema.
3. Backend/core.
4. UI.
5. Tests.
6. Documentation.

## Контракты и инварианты

- source of truth;
- permission;
- idempotency/version;
- failure behavior.

## Критерии приёмки

1. Проверяемый критерий.

## Проверки

- unit;
- integration;
- negative/security;
- build;
- manual smoke.

## Rollback

- feature flag/revert/data behavior.

## Stop rules

- условия, при которых нельзя угадывать.

## Отчёт Codex

- результат;
- изменённые файлы;
- команды и результаты проверок;
- невыполненные проверки;
- риски;
- следующий gate.
