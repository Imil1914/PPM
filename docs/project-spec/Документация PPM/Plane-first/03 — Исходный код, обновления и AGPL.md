---
type: compliance_spec
project_id: intellect-ppm
status: draft
version: 2
created: 2026-09-12
updated: 2026-09-12
---

# 03 — Исходный код, обновления и AGPL

## Проверенные факты

- официальный репозиторий: `makeplane/plane`;
- default branch: `preview`;
- лицензия репозитория: GNU AGPL-3.0;
- выбранная стабильная версия: `v1.4.2`, опубликована 2026-08-23;
- commit ветки `preview`, проверенный 2026-09-12: `2f895b82dad839c730c36a5c0cbc046f1e5d6b56`;
- для реализации закрепляется release tag, а не preview head.

Источники:

- [Plane repository](https://github.com/makeplane/plane)
- [Plane v1.4.2](https://github.com/makeplane/plane/releases/tag/v1.4.2)
- [Plane LICENSE.txt](https://github.com/makeplane/plane/blob/preview/LICENSE.txt)
- [Официальный self-hosting guide](https://developers.plane.so/self-hosting/methods/docker-compose)

## Стратегия включения кода

### Нормативно

1. Создать fork Plane в аккаунте/организации владельца.
2. Создать интеграционную ветку от `v1.4.2`.
3. Сохранить `LICENSE.txt`, copyright и legal notices.
4. В PPM закрепить fork commit как submodule/vendor reference.
5. Изменения Plane вести отдельными маленькими коммитами.
6. Публиковать исходный код той версии Plane, которая доступна пользователям по сети.

### Не допускается

- скачать zip и потерять происхождение;
- удалить лицензию или attribution;
- смешать весь код в один коммит «добавлен Plane»;
- использовать `preview`/`latest` без pin;
- автоматически подтягивать upstream в production;
- заявлять, что AGPL автоматически разрешает закрыть весь объединённый продукт.

## AGPL-гейт перед публикацией

До публичного запуска должны существовать:

- страница `Открытый исходный код`;
- ссылка на используемый fork и точный commit;
- текст AGPL-3.0;
- инструкции сборки и запуска модифицированного Plane;
- список PPM-патчей;
- сохранённые copyright notices;
- юридическое решение о границе лицензирования PPM Canvas/bridge.

Это инженерный план соблюдения лицензии, а не юридическое заключение.

## Обновления upstream

На каждое обновление создаётся отдельный отчёт:

- текущий Plane tag/commit;
- целевой tag/commit;
- security fixes;
- изменения migrations;
- конфликты PPM patches;
- автоматические тесты;
- backup/restore проверка;
- решение release/rollback.

## Почему fork + pin лучше прямой копии

- весь код по-прежнему находится внутри поставки;
- сохраняется история происхождения;
- виден точный diff PPM;
- можно получать security fixes;
- проще выполнить требования по исходному коду;
- rollback выполняется возвратом pin на предыдущий commit.
