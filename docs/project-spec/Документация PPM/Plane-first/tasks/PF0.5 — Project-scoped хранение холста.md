---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.5
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.5 — Project-scoped хранение холста

## Цель

Сохранять общий холст отдельно для каждого Plane project с проверкой доступа и конфликтов.

## Scope

- изолированный PPM backend app/schema;
- project canvas и версии;
- create/read/update API;
- optimistic concurrency;
- autosave с debounce;
- audit metadata;
- reload/restart/second-member smoke.

## Критерии приёмки

1. Первый вход создаёт canvas один раз.
2. Snapshot сохраняется после reload и server restart.
3. Два projects не смешиваются.
4. Outsider и viewer write получают deny.
5. Stale writer не перезаписывает новую версию молча.
6. Повреждённый snapshot не роняет весь Plane project.

## Не входит

CRDT/realtime merge, offline mode и история восстановления UI.
