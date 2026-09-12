---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.4
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.4 — Вкладка Холст в Plane project

## Цель

Добавить в каждый Plane project browser-safe холст AntyFlow без Electron-only зависимостей.

## Scope

- project navigation item `Холст`;
- route с workspace/project context;
- минимальный tldraw Canvas;
- note-нода и связи;
- feature flag;
- read/write permission mapping Plane;
- loading/error/empty states.

## Критерии приёмки

1. Холст открывается из конкретного project.
2. Другой project получает другой canvas context.
3. Посторонний пользователь получает deny.
4. Electron IPC/native modules не попадают в web bundle.
5. Остальные Plane routes не регрессируют.

## Не входит

Все AntyFlow-ноды, сохранение snapshot, work-item bridge, realtime и агенты.
