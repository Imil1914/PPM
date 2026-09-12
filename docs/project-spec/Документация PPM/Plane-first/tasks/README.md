---
type: implementation_queue
project_id: intellect-ppm
status: superseded
version: 2
created: 2026-09-12
updated: 2026-09-12
---

# Очередь карточек Plane-first

> Очередь PF0.1–PF0.7 заменена [очередью Intelligence-first](<../../Intelligence-first/tasks/README.md>). Карточки сохранены как история и не должны запускаться.

## Правила

- Исторически эта очередь заменяла старые P0.1–P0.8.
- Сначала доказывается чистый Plane baseline, затем добавляется PPM Canvas.
- Одна карточка — одна ветка/проверяемый результат.
- Следующая карточка не стартует до gate зависимости.
- `accepted` ставит владелец.

## Очередь

| Карточка | Приоритет | Статус | Зависимости | Результат |
|---|---:|---|---|---|
| [PF0.1 — Fork, pin и лицензия Plane](<PF0.1 — Fork, pin и лицензия Plane.md>) | P0 | `ready` | решение владельца | контролируемый полный исходный код Plane |
| [PF0.2 — Локальный baseline Plane](<PF0.2 — Локальный baseline Plane.md>) | P0 | `planned` | PF0.1 | регистрация и штатный Plane работают |
| [PF0.3 — PPM branding и первый вход](<PF0.3 — PPM branding и первый вход.md>) | P0 | `planned` | PF0.2 | пользователь сначала видит Plane под брендом PPM |
| [PF0.4 — Вкладка Холст в Plane project](<PF0.4 — Вкладка Холст в Plane project.md>) | P0 | `planned` | PF0.3 | browser-safe AntyFlow Canvas в project |
| [PF0.5 — Project-scoped хранение холста](<PF0.5 — Project-scoped хранение холста.md>) | P0 | `planned` | PF0.4 | общий персистентный canvas проекта |
| [PF0.6 — Bridge work items и canvas](<PF0.6 — Bridge work items и canvas.md>) | P0 | `planned` | PF0.5 | единые work items в Plane и на холсте |
| [PF0.7 — Единый deploy и release gate](<PF0.7 — Единый deploy и release gate.md>) | P0 | `planned` | PF0.6 | один домен, один логин, Plane + Canvas |
| PF1.1 — Agents over Plane API | P1 | `planned` | PF0.7 accepted | сводки и декомпозиция |
| PF1.2 — Git provider | P1 | `planned` | PF0.7 accepted | commits/PR ↔ work items |

## Исторически следующая карточка

PF0.1 была следующей карточкой этой редакции. Её применимые требования перенесены в [I0.1](<../../Intelligence-first/tasks/I0.1 — Fork, pin, лицензия и чистый baseline Plane.md>).
