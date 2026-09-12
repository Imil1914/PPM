---
type: data_contract
project_id: intellect-ppm
status: superseded
created: 2026-09-12
updated: 2026-09-12
---

# 04 — Модель данных и API

> Историческая редакция v1. Актуальное ТЗ: [Plane-first/README](<Plane-first/README.md>).

## Основные сущности

| Таблица | Назначение | Ключевые поля MVP |
|---|---|---|
| `profiles` | профиль пользователя | `id`, `display_name`, `avatar_url` |
| `workspaces` | проектная школа/организация | `id`, `name`, `slug`, `owner_id` |
| `workspace_members` | членство в пространстве | `workspace_id`, `user_id`, `role` |
| `teams` | команда | `id`, `workspace_id`, `name`, `slug`, `lead_id` |
| `team_members` | состав команды | `team_id`, `user_id`, `role` |
| `projects` | проект команды | `id`, `workspace_id`, `team_id`, `name`, `key`, `summary`, `repo_url`, `status` |
| `boards` | доска проекта | `id`, `project_id`, `name` |
| `board_columns` | статусы/колонки | `id`, `board_id`, `name`, `position`, `category` |
| `tickets` | work items | `id`, `project_id`, `column_id`, `sequence`, `title`, `description_md`, `priority`, `assignee_id`, `due_at`, `position` |
| `ticket_labels` | метки тикета | `ticket_id`, `label_id` |
| `comments` | обсуждение | `id`, `ticket_id`, `author_id`, `body_md` |
| `documents` | Markdown-документы | `id`, `project_id`, `title`, `body_md`, `status`, `created_by`, `updated_by` |
| `document_links` | связи документов и тикетов | `document_id`, `ticket_id` |
| `files` | метаданные файла | `id`, `project_id`, `ticket_id`, `storage_path`, `name`, `mime`, `size`, `uploaded_by` |
| `activity_events` | аудит проекта | `id`, `workspace_id`, `project_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `payload` |
| `agent_runs` | запуск агента | `id`, `project_id`, `requested_by`, `agent_kind`, `status`, `input`, `output`, `error` |
| `agent_actions` | предлагаемые изменения | `id`, `run_id`, `action_kind`, `payload`, `status`, `approved_by` |

## Инварианты

- `projects.team_id` принадлежит тому же `workspace_id`.
- ключ проекта уникален внутри пространства, например `ROBOT`.
- публичный номер тикета формируется как `<PROJECT_KEY>-<sequence>`.
- тикет и колонка относятся к одной доске/проекту.
- документ и файл нельзя связать с тикетом другого проекта.
- пользователь может назначаться только в доступную ему команду.
- `owner` пространства не может быть удалён последним.
- агентное действие не применяется повторно.

## Статусы

### Проект

`planned | active | paused | completed | archived`

### Тикет

Колонки настраиваемые, но каждая относится к категории:

`backlog | planned | started | review | completed | cancelled`

### Агент

`queued | running | awaiting_approval | completed | rejected | failed | cancelled`

## Минимальный API

```text
POST   /api/workspaces
GET    /api/workspaces/:workspaceId

POST   /api/workspaces/:workspaceId/teams
GET    /api/workspaces/:workspaceId/teams
POST   /api/teams/:teamId/members

POST   /api/teams/:teamId/projects
GET    /api/projects/:projectId

GET    /api/projects/:projectId/board
POST   /api/projects/:projectId/tickets
PATCH  /api/tickets/:ticketId
POST   /api/tickets/:ticketId/move

GET    /api/projects/:projectId/documents
POST   /api/projects/:projectId/documents
PATCH  /api/documents/:documentId

POST   /api/projects/:projectId/files/presign
POST   /api/projects/:projectId/files/complete

POST   /api/projects/:projectId/agents/run
POST   /api/agent-runs/:runId/approve
POST   /api/agent-runs/:runId/reject

GET    /api/projects/:projectId/export/tickets.csv
GET    /api/projects/:projectId/export/summary.md
```

## RLS-правила MVP

1. Неавторизованный пользователь не читает продуктовые таблицы.
2. Член пространства видит только строки своего пространства.
3. Член команды видит проекты своей команды.
4. Наблюдатель имеет `select`, но не `insert/update`.
5. Руководитель управляет участниками только своей команды.
6. Agent/service операции выполняются сервером после проверки членства инициатора.
7. Для каждой таблицы есть отдельные allow/deny тесты на `select/insert/update/delete`.

## Документы и файлы

- Текст документа хранится в Postgres как Markdown.
- Загруженный бинарный файл хранится в приватном Storage bucket.
- В БД хранится только metadata и `storage_path`.
- Максимальный размер MVP задаётся конфигурацией; рекомендуемый стартовый лимит — 25 МБ.
- Версионирование документов в двухдневный MVP не входит; `activity_events` хранит факт изменения, но не полный diff.

## Миграции

- `0001_identity_workspaces.sql`
- `0002_teams_projects.sql`
- `0003_boards_tickets.sql`
- `0004_documents_files.sql`
- `0005_agents_activity.sql`
- `0006_rls_policies.sql`
- `seed_demo.sql`

Каждая миграция должна применяться на пустой БД и повторно проверяться на тестовом окружении. Ручные изменения production-схемы без миграции запрещены.
