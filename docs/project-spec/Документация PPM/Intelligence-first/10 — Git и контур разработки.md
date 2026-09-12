---
type: git_architecture
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 10 — Git и контур разработки

## Цель

Разработчик использует обычный Git из VS Code, Codex или терминала, а PPM связывает код с проектом, задачами, Canvas и Project Brain.

## Основной принцип

PPM не реализует Git object database, pack protocol, SSH server, pull request engine, code review или CI runner самостоятельно.

```text
Plane             владеет задачами
Git provider      владеет кодом, branches, commits, PR
PPM               связывает, отображает, индексирует и оркестрирует
```

## Режимы

### G0 — ссылка на repository

- project хранит canonical repository URL;
- пользователь копирует clone URL;
- branch/commit/PR можно связать вручную;
- credential flow остаётся у provider.

### G1 — внешний provider

Первый adapter поддерживает один утверждённый provider. Рекомендуемый порядок оценки: GitHub, затем GitLab. Функции:

- OAuth/App installation;
- выбор repositories;
- read branches/commits/PR/checks;
- подписанные webhooks;
- auto-link по ключу Work Item;
- создание branch и draft PR с подтверждением;
- projection на Canvas;
- индексирование разрешённого кода/документации.

### G2 — self-hosted provider

После отдельного ADR разворачивается Forgejo либо другой утверждённый open-source Git provider:

- отдельный service/domain;
- SSO/OAuth с PPM;
- repositories и pull requests;
- SSH/HTTPS clone;
- LFS при необходимости;
- backups;
- PPM skin/API integration.

Даже в bundled режиме Forgejo остаётся владельцем Git data.

## Пользовательский поток

```text
PPM project → Код → Подключить repository
→ получить clone URL
→ clone в VS Code/Codex
→ branch с ключом задачи
→ commit с ключом задачи
→ push
→ pull request
→ webhook
→ связь с Work Item и Canvas
→ опциональная индексация Project Brain
```

## Соглашение имён

Рекомендуемый branch:

```text
<WORK_ITEM_KEY>/<short-slug>
ROBOT-12/sensor-calibration
```

Commit:

```text
ROBOT-12: add calibration validation
```

PR title:

```text
ROBOT-12 — Проверка калибровки датчика
```

Parser ищет ключ по регулярному выражению проекта и затем проверяет, что Work Item принадлежит связанному project. Простого совпадения текста недостаточно для cross-project link.

## Интерфейс «Код»

### Репозитории

- имя и provider;
- visibility;
- default branch;
- clone HTTPS/SSH;
- последняя синхронизация;
- health/permission state.

### Commits

- hash, author, time, message;
- связанные Work Items;
- changed paths summary;
- ссылка на provider;
- index state.

### Pull requests

- номер/title;
- author/reviewers;
- base/head;
- open/draft/merged/closed;
- checks summary;
- связанные Work Items;
- безопасная ссылка на diff у provider.

Полноценный diff/review внутри PPM не входит в первый Git-релиз. Сначала UI ведёт на provider.

## Webhooks

1. Считать raw body до JSON parsing.
2. Проверить provider signature и timestamp.
3. Найти connection/repository.
4. Проверить delivery ID на повтор.
5. Сохранить минимальный normalized event и payload hash.
6. Поставить обработку в очередь.
7. Обновить cache и links.
8. Запустить index job только для разрешённых sources.

Невалидный webhook получает `401/403`, не создаёт event и логируется без body/secrets.

## Создание branch/PR из PPM

Любая операция проходит preview:

- repository;
- base branch;
- новое имя branch;
- Work Item;
- PR title/body;
- provider account, от имени которого выполняется действие.

Повторное подтверждение с тем же idempotency key не создаёт второй branch/PR.

## Работа Codex

PPM не требует специального расширения Codex. Пользователь:

1. клонирует стандартный remote;
2. открывает локальный repository как проект Codex;
3. работает с файлами;
4. выполняет обычный commit/push после явного решения пользователя;
5. создаёт PR через provider или PPM.

Будущий PPM bridge может сформировать task context bundle: Work Item description, связанные Vault docs, Canvas neighborhood и acceptance criteria. Он не передаёт секреты и не запускает Codex от имени пользователя без явного действия.

## Индексация кода

По умолчанию выключена. При включении:

- индексируется выбранная branch/commit SHA;
- исключаются `.git`, binaries, generated directories, vendored dependencies, lockfiles по policy;
- `.env`, keys, certificates и secret-like content блокируются;
- chunk locator содержит repository, commit SHA, path и lines;
- ответ всегда цитирует неизменяемый commit SHA;
- private repository chunks доступны только пользователям с project и repository permission.

README/docs можно индексировать отдельно от source code.

## Связь с Canvas

На Canvas доступны projections:

- repository;
- branch;
- commit;
- pull request.

Semantic relations:

- Work Item `implemented_by` PR;
- requirement `implemented_by` commit/PR;
- PR `depends_on` another PR;
- test report `evidence_for` Work Item/PR.

## Что не делать

- хранить private SSH keys в browser/localStorage;
- выводить provider token в logs;
- выполнять `git` с пользовательскими аргументами в API shell;
- автоматически merge PR по ответу LLM;
- создавать вторые Issues в Git provider;
- считать commit message надёжным разрешением доступа;
- индексировать весь private repository без opt-in;
- сохранять полный webhook body бессрочно.

## Acceptance G1
1. Connection можно подключить и отозвать.
2. Repository виден только участникам project.
3. Commit/PR с корректным ключом связывается один раз.
4. Невалидная подпись webhook отклоняется.
5. Токен не доступен browser.
6. Branch/PR создаются только после preview/approve.
7. VS Code и Codex работают через обычный clone URL.
8. Canvas projection ведёт к canonical Git object.
9. Code RAG цитирует commit SHA и path.
