---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.6
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.6 — Bridge work items и canvas

## Цель

Доказать, что Plane и AntyFlow работают с одной проектной сущностью, а не как два независимых приложения.

## Scope

- список work items текущего project;
- work-item shape с live title/state/priority;
- binding shape → Plane work item;
- создание work item из Canvas через Plane service/API;
- переход из shape в штатный Plane screen;
- обновление после изменения work item;
- безопасное поведение архивной/удалённой сущности.

## Критерии приёмки

1. Work item из Plane добавляется на Canvas.
2. Work item из Canvas появляется в Plane.
3. Нет второй таблицы tickets.
4. Удаление shape не удаляет work item.
5. Cross-project binding отклоняется.
6. Права совпадают со штатными правами Plane.

## Не входит

Comments, cycles, modules, Pages, attachments, realtime events и массовая синхронизация.
