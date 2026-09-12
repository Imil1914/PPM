# PPM — система интеллекта проекта

PPM объединяет управление работой, визуальный холст, проектные знания, AI-поиск и разработку в одной среде для команд.

```text
Plane-powered · AntyFlow-faced · Vault-backed · Graph/RAG-assisted · Git-connected
```

## Состояние проекта

Репозиторий находится в переходной фазе:

- **в коде сейчас** — рабочий desktop-прототип AntyFlow на Electron, React и tldraw;
- **целевая система** — многокомандный web-продукт PPM с Plane Community как внутренним движком;
- **актуальное ТЗ** — редакция Intelligence-first v3;
- **I0.1 готова к review владельца** — чистый Plane `v1.4.2` закреплён, а golden path и persistence после restart подтверждены CI;
- **следующая задача после приёмки I0.1** — PPM brand foundation и token bridge по карточке I0.2.

Это важно: существующий Electron-код не выдаётся за готовую web-платформу. Он служит проверенным источником Canvas, Vault, графа, AI-нод и других функций, которые будут переноситься поэтапно.

## Что должно получиться

| Подсистема | Назначение | Источник истины |
|---|---|---|
| PPM Shell | единый интерфейс, навигация и бренд | PPM |
| Plane Engine | пользователи, проекты, Work Items, Cycles, Modules, Views и Pages | Plane |
| Project Canvas | визуальные проекции объектов и смысловые связи | PPM |
| Project Vault | папки, Markdown, PDF и файлы | PPM Vault |
| Project Brain | hybrid RAG, граф знаний, память и ответы с источниками | производный индекс PPM |
| Git contour | repositories, branches, commits и pull requests | Git provider |
| Agents | анализ и предложения изменений через preview/approve | PPM orchestration |

Ключевой принцип: одна сущность имеет одного владельца. Canvas показывает проекцию задачи или файла, но не создаёт их вторую независимую копию.

## Что уже реализовано в прототипе

- бесконечный Canvas на tldraw;
- заметки, Markdown и Project Vault с реальными `.md`;
- дерево файлов, wiki-links, backlinks и граф;
- Kanban/backlog-ноды;
- AI-chat и связи контекста между нодами;
- PDF Q&A и локальный RAG;
- презентации, Mermaid, Jupyter и голосовой ввод;
- локальные агенты и оркестратор;
- файловая и real-time синхронизация Canvas.

Подробный технический снимок: [что реализовано](<docs/РЕАЛИЗОВАНО.md>).

## Документация

Начинать следует отсюда:

1. [Каноническое ТЗ Intelligence-first v3](<docs/project-spec/Документация PPM/Intelligence-first/README.md>)
2. [Принятое архитектурное решение](<docs/project-spec/Документация PPM/Intelligence-first/Решение — AntyFlow-first система интеллекта проекта.md>)
3. [План реализации и релизы](<docs/project-spec/Документация PPM/Intelligence-first/15 — План реализации и релизы.md>)
4. [Очередь исполнимых задач](<docs/project-spec/Документация PPM/Intelligence-first/tasks/README.md>)
5. [Руководство исполнения для Codex](<docs/project-spec/Документация PPM/Intelligence-first/17 — Руководство исполнения для Codex.md>)
6. [Матрица требований и тестов](<docs/project-spec/Документация PPM/Intelligence-first/20 — Матрица требований и трассировка.md>)

Полный архив документации, включая исторические редакции: [docs/project-spec](<docs/project-spec/README.md>).

## Быстрый запуск текущего desktop-прототипа

### Требования

- Windows 10/11;
- Node.js 20 LTS или 22 LTS;
- Git;
- опционально: Python 3, LM Studio/Ollama и ComfyUI.

### Установка

```bash
git clone https://github.com/Imil1914/PPM.git
cd PPM
npm ci
npm run dev
```

Node.js 24 пока не используется: для закреплённой версии `better-sqlite3` нет подходящего prebuilt binary в проверенном окружении. Ограничение зафиксировано также в `package.json`.

### Проверки

```bash
npm test
npm run build
```

### Windows-установщик

```bash
npm run dist
```

Перед `npm run dist` закройте запущенный `Flow.exe`: Windows может заблокировать замену файлов в `release/`.

## Запуск Plane baseline

Plane Community подключён отдельным Git submodule и закреплён на release `v1.4.2`, commit `5f7d92784c403f76284f0f16718f320221dc7fec`. Для получения исходников после обычного clone выполните:

```bash
git submodule update --init --recursive
npm run plane:bootstrap
npm run plane:verify
```

Полный безопасный запуск, golden smoke и restart-проверка: [infra/plane/README.md](infra/plane/README.md). Лицензия и происхождение Plane зафиксированы в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Настройка AI в прототипе

1. Откройте командное меню `Ctrl+K`.
2. Выберите `Настройки провайдеров`.
3. Укажите OpenAI-compatible `baseURL`, модель и собственный API-ключ.

Для локального LM Studio обычно используется `http://127.0.0.1:1234/v1`. Секреты хранятся локально в профиле приложения и не должны попадать в Git.

## Структура репозитория

```text
src/main/                 Electron main, IPC, Vault, AI и orchestration
src/preload/              безопасный bridge между main и renderer
src/renderer/src/         React UI, Canvas, shapes, Vault и инструменты
sync-server/              Cloudflare Worker для tldraw real-time sync
scripts/                  подготовка sidecars и сборочные утилиты
plane-fork/               чистый Plane Community v1.4.2 (Git submodule)
infra/plane/              manifest, runbook и runtime-проверки Plane
docs/                     техническая и продуктовая документация
docs/project-spec/        полный экспорт документации PPM
AGENTS.md                  обязательные правила для Codex и других агентов
```

## Как выполнять задачи

1. Прочитать [AGENTS.md](AGENTS.md).
2. Открыть [очередь](<docs/project-spec/Документация PPM/Intelligence-first/tasks/README.md>).
3. Выбрать одну карточку с выполненными зависимостями.
4. Не расширять её scope без решения владельца.
5. Реализовать изменение, выполнить указанные проверки и оформить небольшой reviewable commit.
6. Не ставить `accepted` самостоятельно: финальную приёмку делает владелец.

Первая исполнительная карточка: [I0.1 — Fork, pin, лицензия и чистый baseline Plane](<docs/project-spec/Документация PPM/Intelligence-first/tasks/I0.1 — Fork, pin, лицензия и чистый baseline Plane.md>).

## Безопасность

- не коммитьте `.env`, API keys, tokens, cookies и пользовательские данные;
- не помещайте secrets в Canvas snapshots, логи или тестовые fixtures;
- любые AI-записи в задачи, документы и Git требуют preview, подтверждения и аудита;
- доступ к Vault, RAG и Git всегда ограничивается текущим workspace/project.

## Лицензирование

Лицензия собственного кода PPM пока не зафиксирована отдельным решением. Не добавляйте и не меняйте лицензию без согласования с владельцем.

Plane Community используется поэтапно через контролируемый fork. Модифицированная сетевая поставка должна соблюдать AGPL-3.0, сохранять необходимые notices и предоставлять соответствующий исходный код. Перед публичным коммерческим запуском требуется юридическая проверка конкретной сборки.

## Для агентов

Корневой [AGENTS.md](AGENTS.md) является рабочим контрактом проекта. Для новых репозиториев используйте [универсальный шаблон](<docs/agent-guides/AGENTS.template.md>) и [инструкцию по адаптации](<docs/agent-guides/README.md>).
