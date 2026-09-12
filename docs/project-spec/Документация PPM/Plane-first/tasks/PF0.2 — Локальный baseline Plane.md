---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.2
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.2 — Локальный baseline Plane

## Цель

Запустить закреплённую Plane Community без PPM-патчей и зафиксировать рабочий baseline.

## Scope

- проверить требования Docker/Linux;
- подготовить безопасный `.env` из example;
- поднять штатный compose/dev stack;
- выполнить migrations;
- создать instance admin и тестового пользователя;
- пройти workspace/project/work item/page/attachment;
- зафиксировать команды, версии, ресурсы и ограничения;
- проверить restart.

## Критерии приёмки

1. Все обязательные сервисы healthy.
2. Регистрация и вход работают.
3. Workspace, project, work item и page создаются.
4. Данные переживают restart.
5. Baseline не содержит PPM code changes.
6. Логи не раскрывают секреты.

## Проверки

- compose config/health;
- Plane tests/build по затронутому способу запуска;
- ручной golden smoke;
- restart и повторный вход.

## Не входит

Ребрендинг, русификация, Canvas и агенты.
