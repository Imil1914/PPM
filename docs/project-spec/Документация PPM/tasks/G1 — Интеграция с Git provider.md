---
type: implementation_task
project_id: intellect-ppm
task_id: G1
status: superseded
created: 2026-09-12
updated: 2026-09-12
---

# G1 — Интеграция с Git provider

## Цель

Связать тикеты PPM с существующим GitHub/GitLab без собственного хранения Git-репозиториев.

## Зависимости

P0.8 имеет статус `accepted`; выбран один provider и согласован OAuth/GitHub App подход.

## Scope

- безопасное подключение provider;
- repositories metadata;
- webhook push/PR;
- связь по ключу тикета;
- branch/commit/PR на странице тикета;
- open/merged/closed и CI check status;
- delivery idempotency и аудит.

## Критерии приёмки

1. Подключение можно отозвать.
2. Валидный webhook создаёт одно событие.
3. Невалидная подпись отклоняется.
4. PR с `ROBOT-6` связывается с тикетом ROBOT-6.
5. Токен provider не доступен в браузере.
6. Агент не выполняет merge без отдельного подтверждения.

## Не входит

Git hosting, code browser, full diff engine, CI runners, package registry и secrets management разработчиков.

## Gate

G2 можно планировать только после эксплуатации G1 на одном тестовом проекте.
