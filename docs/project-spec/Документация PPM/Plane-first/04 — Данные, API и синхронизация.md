---
type: data_contract
project_id: intellect-ppm
status: draft
version: 2
created: 2026-09-12
updated: 2026-09-12
---

# 04 — Данные, API и синхронизация

## Главное правило

PPM не дублирует в собственной схеме сущности, которые уже принадлежат Plane.

| Данные | Источник истины |
|---|---|
| пользователи и auth | Plane |
| workspace и memberships | Plane |
| projects и project roles | Plane |
| work items, states, labels, assignees | Plane |
| cycles, modules и views | Plane |
| pages и attachments | Plane |
| canvas snapshot и визуальные координаты | PPM Canvas |
| связи node ↔ Plane entity | PPM Canvas |
| agent runs/actions | PPM extension |

## Новые сущности PPM

### `ppm_project_canvases`

- `id` UUID;
- `workspace_id` Plane UUID;
- `project_id` Plane UUID, unique для активного canvas MVP;
- `created_by` Plane user UUID;
- `created_at`, `updated_at`;
- `current_version` integer;
- `status active|archived`.

### `ppm_canvas_versions`

- `id` UUID;
- `canvas_id` UUID;
- `version` integer;
- `snapshot_json` JSON/JSONB или object storage pointer;
- `content_hash`;
- `created_by`;
- `created_at`;
- unique `(canvas_id, version)`.

### `ppm_canvas_bindings`

- `canvas_id`;
- `shape_id`;
- `entity_type work_item|page|attachment|module|cycle`;
- `entity_id` Plane UUID;
- `created_at`;
- unique `(canvas_id, shape_id, entity_type, entity_id)`.

### `ppm_agent_runs` — после canvas gate

Хранит тип агента, инициатора, project context, status, input/output refs и audit.

## Canvas API

```text
GET  /api/ppm/workspaces/:workspaceId/projects/:projectId/canvas
PUT  /api/ppm/workspaces/:workspaceId/projects/:projectId/canvas
GET  /api/ppm/.../canvas/versions
POST /api/ppm/.../canvas/bindings
DELETE /api/ppm/.../canvas/bindings/:bindingId
POST /api/ppm/.../work-items
GET  /api/ppm/.../work-items
```

Каждый endpoint:

1. проверяет Plane session;
2. разрешает workspace/project;
3. проверяет permission пользователя;
4. валидирует payload;
5. выполняет операцию;
6. пишет audit без секретов и полного snapshot.

## Синхронизация work item

- карточка на холсте хранит только `work_item_id` и локальные визуальные свойства;
- title/state/priority/assignee читаются из Plane;
- изменение структурных полей вызывает Plane API;
- при удалении shape work item в Plane не удаляется;
- архивированный/удалённый work item показывается как недоступная ссылка, а shape не исчезает молча;
- один work item допускает несколько shapes, но каждый shape имеет стабильный binding.

## Конфликты canvas

Для MVP:

- optimistic concurrency по `current_version` или ETag;
- stale update получает conflict, а не перезаписывает чужой snapshot;
- realtime collaboration AntyFlow включается только после проверки проектных прав;
- merge canvas snapshots не изобретается в двухдневной карточке.

## Pages и файлы

Используются штатные Plane Pages и attachments. На холсте хранится binding на `page_id` или attachment metadata. Отдельное Supabase Storage не создаётся.

## Миграции

Новые PPM-таблицы должны жить в изолированном Django app/schema и не менять существующие таблицы Plane напрямую, кроме минимально необходимой регистрации route/navigation. Это снижает конфликты при обновлении upstream.
