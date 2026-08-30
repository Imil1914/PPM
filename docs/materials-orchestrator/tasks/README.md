# Карточки реализации Materials R&D

Эта папка содержит самодостаточные задания для Codex.

## Правила

- Одна карточка — один проверяемый результат.
- Выполнять можно только карточку со статусом `ready` и принятыми зависимостями.
- Статус меняется в репозитории и затем зеркалируется в Obsidian.
- Выполнение соседней карточки не подразумевается автоматически.
- Общие правила находятся в [09-codex-execution-playbook.md](../09-codex-execution-playbook.md).

## Очередь

| Карточка | Статус | Зависимости | Результат |
|---|---|---|---|
| [M0.1](./M0.1-workflow-profile.md) | `accepted` | — | Единая Zod-схема WorkflowProfile |
| [M0.2](./M0.2-workflow-profile-propagation.md) | `accepted` | M0.1 | Передача профиля через UI/IPC/worker |
| [M0.3](./M0.3-workflow-profile-routing.md) | `accepted` | M0.2 | Раздельные точки входа generic/materials |
| [M0.4](./M0.4-block-legacy-bypasses.md) | `accepted` | M0.3 | Запрет обходных webBuild/lecture путей |
| [M0.5](./M0.5-fake-runtime.md) | `accepted` | — | FakeRuntime и deterministic fixtures |
| [M0.6](./M0.6-quality-baseline.md) | `accepted` | M0.5 | Проверяемый baseline качества |
| [M1.1](./M1.1-zod-contracts.md) | `accepted` | M0.6 | Нормативные runtime Zod-контракты V1 |
| [M1.2](./M1.2-json-schema-export.md) | `accepted` | M1.1 | JSON Schema Draft 2020-12 из Zod |
| [M1.3](./M1.3-sqlite-materials-migrations.md) | `accepted` | M1.1 | Транзакционная SQLite-схема Materials Version Store |
| [M1.4](./M1.4-materials-version-repository.md) | `review` | M1.3 | Неизменяемый project-scoped Version Repository |

Следующая карточка переводится в `ready` только после уточнения её точных файлов, тестов и критериев. В каждый момент выполняется не более одной карточки. M1.3 принята владельцем; M1.4 завершена технически и ожидает приёмки. Соседние M1.5/M1.6 автоматически не запускаются.
