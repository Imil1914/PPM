---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.7
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.7 — Единый deploy и release gate

## Цель

Опубликовать Plane-first PPM как одну систему: один домен, один логин, штатный Plane и project Canvas.

## Scope

- unified Docker Compose;
- reverse proxy и HTTPS;
- production migrations;
- persistent volumes/external services согласно среде;
- backup/restore smoke;
- source/legal page;
- E2E A1–A9;
- rollback на предыдущий Plane pin/PPM image;
- известные ограничения.

## Критерии приёмки

1. После регистрации открывается Plane.
2. Project содержит рабочую вкладку «Холст».
3. Work-item bridge проходит в обе стороны.
4. Второго логина нет.
5. Cross-project/workspace доступ закрыт.
6. Source code используемой Plane-модификации доступен.
7. Restart не теряет Plane или Canvas данные.

## Не входит

Production SLA, autoscaling, полный pentest, агенты, Git integration и полный перенос AntyFlow.

## Gate

Только владелец переводит PF0.7 в `accepted` и разрешает PF1.
