---
type: implementation_task
project_id: intellect-ppm
task_id: PF0.1
status: ready
created: 2026-09-12
updated: 2026-09-12
---

# PF0.1 — Fork, pin и лицензия Plane

## Цель

Включить полный исходный код Plane в контролируемой форме, сохранив происхождение, лицензию и возможность обновления.

## Scope

- проверить GitHub-доступ владельца;
- создать fork `makeplane/plane` отдельным внешним действием;
- создать PPM integration branch от `v1.4.2`;
- добавить upstream remote;
- закрепить точный commit;
- подключить fork в PPM как `vendor/plane`;
- сохранить LICENSE/COPYRIGHT/NOTICE;
- создать `THIRD_PARTY_NOTICES.md` и manifest версии;
- задокументировать update/rollback.

## Критерии приёмки

1. `vendor/plane` разрешается в точный commit стабильного релиза.
2. Полный source tree доступен разработчику.
3. Нет плавающего `latest`/`preview`.
4. Лицензия и copyright не изменены.
5. Видно чистый diff PPM относительно upstream.
6. Fresh checkout воспроизводит зависимость одной командой.

## Проверки

- remote/tag/commit audit;
- список license files;
- clean checkout/submodule init;
- diff относительно upstream tag;
- отсутствие секретов.

## Не входит

Запуск Plane, ребрендинг, Canvas и публикация.

## Gate

PF0.2 получает неизменённый Plane `v1.4.2` как baseline.
