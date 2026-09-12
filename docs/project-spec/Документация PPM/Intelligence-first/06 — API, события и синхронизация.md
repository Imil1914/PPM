---
type: api_spec
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 06 — API, события и синхронизация

## Общий URL-контекст

Все project endpoints имеют форму:

```text
/api/ppm/v1/workspaces/:workspaceId/projects/:projectId/...
```

Сервер не доверяет route IDs и для каждого запроса:

1. проверяет Plane session;
2. загружает membership workspace;
3. проверяет доступ к project;
4. проверяет capability конкретной операции;
5. валидирует payload;
6. выполняет mutation в транзакции;
7. пишет audit/outbox event;
8. возвращает безопасный результат.

## Единый формат ошибок

```json
{
  "error": {
    "code": "CANVAS_VERSION_CONFLICT",
    "message": "Холст был изменён другим участником.",
    "request_id": "uuid",
    "details": {}
  }
}
```

UI показывает локализованное `message`; техническая диагностика связывается через `request_id`.

## Canvas API

```text
GET    /canvas
PUT    /canvas
GET    /canvas/versions
GET    /canvas/versions/:version
POST   /canvas/bindings
DELETE /canvas/bindings/:bindingId
POST   /canvas/semantic-edges
PATCH  /canvas/semantic-edges/:edgeId
DELETE /canvas/semantic-edges/:edgeId
```

### `PUT /canvas`

Запрос:

```json
{
  "schema_version": 1,
  "base_version": 12,
  "snapshot": {},
  "client_operation_id": "uuid"
}
```

Ответ содержит новую `version`, `content_hash`, `saved_at`. Если `base_version` устарел, сервер отвечает `409 CANVAS_VERSION_CONFLICT` и не перезаписывает новую версию.

## Projection API

```text
GET  /projections/search?types=work_item,page,vault_file&q=...
GET  /projections/:type/:entityId
POST /work-items                      создание через Plane service
PATCH /work-items/:id                 allowlisted quick edit
```

Projection response разделяет:

- `identity` — ID/type/source URL;
- `display` — title/status/preview;
- `capabilities` — read/update/delete-source;
- `source_version` — invalidation marker.

## Vault API

```text
GET    /vault/tree
POST   /vault/folders
POST   /vault/files/initiate-upload
POST   /vault/files/:id/complete-upload
GET    /vault/files/:id
GET    /vault/files/:id/content
PUT    /vault/files/:id/content       Markdown/text only
POST   /vault/files/:id/versions/:version/restore
PATCH  /vault/entries/:id             rename/move/index policy
DELETE /vault/entries/:id             move to trash
GET    /vault/files/:id/download
GET    /vault/graph
POST   /vault/export
```

Uploads используют pre-signed URL либо проверенный streaming endpoint. `complete-upload` сверяет размер, hash и MIME до публикации entry.

## Knowledge API

```text
GET  /knowledge/sources
POST /knowledge/sources/:type/:id/index
POST /knowledge/reindex
GET  /knowledge/jobs/:jobId
POST /knowledge/query
GET  /knowledge/health
```

### `POST /knowledge/query`

```json
{
  "query": "Что блокирует испытания?",
  "scope": {
    "canvas_id": "uuid",
    "selected_shape_ids": ["shape:1", "shape:2"],
    "include_neighbors_depth": 1,
    "source_types": ["work_item", "page", "vault_file"]
  },
  "top_k": 12
}
```

Ответ:

```json
{
  "answer": "...",
  "citations": [
    {
      "citation_id": "c1",
      "source_type": "vault_file",
      "source_id": "uuid",
      "title": "Протокол испытаний.pdf",
      "locator": {"page": 7},
      "excerpt": "..."
    }
  ],
  "retrieval": {
    "mode": "hybrid_graph",
    "degraded": false
  }
}
```

## Agent API

```text
POST /agents/runs
GET  /agents/runs/:runId
POST /agents/runs/:runId/cancel
POST /agents/actions/:actionId/approve
POST /agents/actions/:actionId/reject
```

Approval endpoint повторно проверяет права и source versions. Если объект изменился после формирования preview, действие получает `409 ACTION_PRECONDITION_CHANGED`.

## Git API

```text
GET    /git/connections
POST   /git/connections/start
DELETE /git/connections/:id
GET    /git/repositories
POST   /git/repositories/:id/link
GET    /git/repositories/:id/branches
GET    /git/repositories/:id/commits
GET    /git/repositories/:id/pull-requests
POST   /git/repositories/:id/branches
POST   /git/repositories/:id/pull-requests
POST   /git/webhooks/:provider/:connectionId
```

Создание branch/PR — write action. Оно использует idempotency key и показывает preview имени/базы/головы/описания.

## События

Нормализованный envelope:

```json
{
  "event_id": "uuid",
  "event_type": "vault.file.updated",
  "workspace_id": "uuid",
  "project_id": "uuid",
  "actor_id": "uuid-or-service",
  "entity": {"type": "vault_file", "id": "uuid", "version": "5"},
  "occurred_at": "ISO-8601",
  "schema_version": 1
}
```

Минимальные события:

- `plane.work_item.created|updated|deleted`;
- `plane.page.created|updated|deleted`;
- `plane.attachment.created|deleted`;
- `canvas.saved`;
- `canvas.semantic_edge.created|updated|deleted`;
- `vault.file.created|updated|moved|deleted|restored`;
- `knowledge.source.index.requested|ready|failed|deleted`;
- `git.push.received`;
- `git.pull_request.opened|updated|merged|closed`;
- `agent.run.completed|failed`;
- `agent.action.applied|rejected|failed`.

## Outbox и идемпотентность

Mutation canonical data и запись outbox происходят в одной транзакции. Worker:

1. берёт событие по lease;
2. вычисляет idempotency key;
3. выполняет side effect;
4. фиксирует результат;
5. повторяет с backoff при временной ошибке;
6. переводит в dead-letter после лимита попыток.

Повторный webhook, upload completion, Canvas save или action approve не создаёт дубликат.

## Синхронизация источников с индексом

| Событие | Действие индекса |
|---|---|
| source created | enqueue index |
| source updated | mark stale → enqueue requested version |
| source deleted/access revoked | немедленно исключить из retrieval → удалить chunks async |
| parser/model changed | batch reindex по pipeline version |
| rename/move without content change | обновить locator, embedding не пересчитывать |

## Realtime

MVP допускает snapshot save с optimistic concurrency. Realtime Canvas включается после проверки auth bridge. Presence не является правом доступа: подключение к room разрешает сервер на основании Plane membership.

## Таймауты и деградация

- Plane API недоступен: проекции показывают `источник временно недоступен`, Canvas открывается;
- vector search недоступен: keyword-only retrieval;
- LLM недоступен: показываются найденные источники без синтеза;
- Git provider недоступен: cached metadata помечается устаревшей;
- extraction failed: файл остаётся доступным, индекс получает понятную ошибку;
- object storage недоступен: metadata видна, upload/download блокируются без потери записи.
