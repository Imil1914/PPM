---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.3
status: planned
created: 2026-09-12
updated: 2026-09-12
---

# PF0.3 — PPM branding и первый вход

## Цель

Сделать Plane первым экраном PPM после регистрации и добавить минимальный бренд без ломки upstream.

## Scope

- название PPM и разрешённые assets;
- onboarding проектной школы;
- redirect после auth в workspace/projects Plane;
- ссылка на legal/source;
- feature flag PPM Canvas выключен до PF0.4;
- документированная patch surface.

## Критерии приёмки

1. После регистрации пользователь видит Plane workspace flow.
2. Нет второго PPM dashboard и второго логина.
3. Все штатные разделы Plane доступны.
4. AGPL/legal notices доступны.
5. Отключение PPM flag возвращает чистый Plane flow.

## Не входит

Полная локализация, дизайн-система PPM и изменение продуктовой модели Plane.
