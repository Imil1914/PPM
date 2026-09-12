---
component: plane-community-baseline
release: v1.4.2
commit: 5f7d92784c403f76284f0f16718f320221dc7fec
updated: 2026-09-12
status: passed
---

# Проверка чистого Plane baseline

## Идентичность исходников

- [x] Fork создан: `Imil1914/plane`.
- [x] Integration branch создан от release commit: `ppm/integration-v1.4.2`.
- [x] Submodule указывает на `v1.4.2` / `5f7d92784c403f76284f0f16718f320221dc7fec`.
- [x] Upstream URL сохранён в manifest и восстанавливается bootstrap-командой.
- [x] `LICENSE.txt` и `COPYRIGHT.txt` присутствуют и проверяются по SHA-256.
- [x] Изменений внутри Plane baseline нет; `ppmPatches` пуст.

## Воспроизводимость

- [x] Локальный env создаётся из официального `variables.env`.
- [x] `APP_RELEASE` закреплён на `v1.4.2`.
- [x] Runtime-файлы и smoke credentials исключены из Git.
- [x] Compose config и source integrity проверяются в CI.
- [x] CI содержит полный HTTP smoke и повторное чтение после restart.
- [x] CI фиксирует snapshot CPU/RAM контейнеров без вывода environment/secrets.
- [x] Недоступный `minio/minio:latest` заменён отдельным overlay на официальный Quay image с точным release tag; Plane source не изменён.

## Выполнение

Локальная Windows-машина, 2026-09-12:

- source identity и контрольные суммы: пройдено;
- подготовка и проверка env без раскрытия секретов: пройдено;
- Docker/WSL: недоступны на host, поэтому локальный runtime smoke не выполнялся;
- runtime/golden/restart: пройдены в Linux runner, [run 34691377890](https://github.com/Imil1914/PPM/actions/runs/34691377890), 2026-09-12;
- результат: registration → workspace → project → Work Item → Page → attachment → logout/login → restart → read — пройдено;
- resource snapshot после restart: около `1.14 GiB` RAM суммарно по 12 запущенным контейнерам; наибольший потребитель — worker, `356.2 MiB`; моментальный суммарный CPU около `2.9%` на runner.

Ручной UI smoke остаётся отдельной проверкой владельца перед статусом `accepted`. Карточка переведена в `review`, но не в `accepted`.
