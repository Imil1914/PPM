---
type: implementation_queue
project_id: intellect-ppm
status: active
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# Очередь задач Intelligence-first

## Правила исполнения

- одна карточка — одна reviewable ветка/изменение;
- `accepted` выставляет только владелец после демонстрации;
- зависимость должна иметь фактический результат, а не только отметку;
- при блокировке не расширять scope молча;
- новые обязательные требования добавляются в [../20 — Матрица требований и трассировка](<../20 — Матрица требований и трассировка.md>);
- старая очередь PF0 сохранена как история и не исполняется параллельно.

## Этап I0 — демонстрационное ядро

| Задача | P | Статус | Зависит от | Результат |
|---|---:|---|---|---|
| [I0.1 — Fork, pin, лицензия и чистый baseline Plane](<I0.1 — Fork, pin, лицензия и чистый baseline Plane.md>) | P0 | `review` | решение владельца | Plane v1.4.2 и golden/restart gate подтверждены CI |
| [I0.2 — PPM brand foundation и token bridge](<I0.2 — PPM brand foundation и token bridge.md>) | P0 | `planned` | I0.1 | темы/assets/components PPM |
| [I0.3 — PPM shell, русская локализация и первый вход](<I0.3 — PPM shell, русская локализация и первый вход.md>) | P0 | `planned` | I0.2 | пользователь не видит Plane на основном пути |
| [I0.4 — Web Canvas route и browser-safe AntyFlow core](<I0.4 — Web Canvas route и browser-safe AntyFlow core.md>) | P0 | `planned` | I0.3 | открывается `Мозг проекта` |
| [I0.5 — Canvas persistence, версии и права](<I0.5 — Canvas persistence, версии и права.md>) | P0 | `planned` | I0.4 | общий сохраняемый Canvas project |
| [I0.6 — Проекция Plane Work Item на Canvas](<I0.6 — Проекция Plane Work Item на Canvas.md>) | P0 | `planned` | I0.5 | одна задача в двух представлениях |
| [I0.7 — Project Vault Markdown и PDF MVP](<I0.7 — Project Vault Markdown и PDF MVP.md>) | P0 | `planned` | I0.3 | папки, Markdown, PDF, versions |
| [I0.8 — Project Brain ingestion и изолированный индекс](<I0.8 — Project Brain ingestion и изолированный индекс.md>) | P0 | `planned` | I0.6, I0.7 | источники готовы для retrieval |
| [I0.9 — Ask Project, citations и answer node](<I0.9 — Ask Project, citations и answer node.md>) | P0 | `planned` | I0.8 | grounded answer на Canvas |
| [I0.10 — Единый demo deploy и release gate](<I0.10 — Единый demo deploy и release gate.md>) | P0 | `planned` | I0.9 | проверяемый D0 результат |

## Этап I1 — устойчивый интеллект

| Задача | P | Статус | Зависит от | Результат |
|---|---:|---|---|---|
| [I1.1 — Vault backlinks, export и расширенные проекции](<I1.1 — Vault backlinks, export и расширенные проекции.md>) | P1 | `planned` | I0.10 | полноценнее знания и файлы |
| [I1.2 — Semantic GraphRAG и память проекта](<I1.2 — Semantic GraphRAG и память проекта.md>) | P1 | `planned` | I1.1 | связи участвуют в retrieval |
| [I1.3 — Проектные агенты и approval actions](<I1.3 — Проектные агенты и approval actions.md>) | P1 | `planned` | I1.2 | безопасные предложения изменений |
| [I1.4 — Внешние источники знаний](<I1.4 — Внешние источники знаний.md>) | P2 | `planned` | I1.2 | connector framework |

## Этап G — Git

| Задача | P | Статус | Зависит от | Результат |
|---|---:|---|---|---|
| [G0.1 — Repository links и ручные связи с Work Items](<G0.1 — Repository links и ручные связи с Work Items.md>) | P1 | `planned` | I0.10 | стандартный Git уже связан с project |
| [G1.1 — Первый внешний Git provider и webhooks](<G1.1 — Первый внешний Git provider и webhooks.md>) | P1 | `planned` | G0.1 | commits/PR синхронизируются |
| [G1.2 — Git projections и code RAG](<G1.2 — Git projections и code RAG.md>) | P1 | `planned` | G1.1, I1.2 | код входит в Мозг проекта |
| [G2.1 — ADR и внедрение self-hosted Git provider](<G2.1 — ADR и внедрение self-hosted Git provider.md>) | P2 | `planned` | G1.2 | собственный Git-контур без самописного Git |

## Следующее действие

Проверить pull request I0.1 и при желании вручную пройти UI smoke. После решения владельца принять I0.1 либо вернуть замечания; до этого I0.2 не начинать.
