# CLAUDE.md — playbook для ИИ-агента

Этот файл читается автоматически. Следуй ему, чтобы поднять и собрать проект.

## Что это

**AntyFlow** — десктопное приложение (Electron + React + tldraw): бесконечный AI-холст
с нодами (заметки, ИИ-чаты, канбан, бэклог, PDF, Jupyter, презентации, агенты).
- `src/main/` — Electron main (IPC, провайдеры моделей, агенты, notebook, vault, canvas-sync).
- `src/preload/index.ts` — мост `window.flow` (все IPC-методы объявлять И тут, И в типах
  `src/renderer/src/flow-api.d.ts`).
- `src/renderer/src/App.tsx` — холст, доски, сайдбар, синхронизация.
- `src/renderer/src/shapes/FlowNodeShapeUtil.tsx` — **все виды нод** (большой файл).
- `sync-server/` — Cloudflare Worker для real-time совместной работы (отдельный проект).

## Окружение

- **Windows**, оболочка — **PowerShell** (есть и Bash). Node.js 18+.
- Пользователь запускает **упакованный `Flow.exe`**. Чтобы он увидел правки —
  нужен `npm run dist` (пересобирает `.exe`), а НЕ просто `npm run build`.

## Установка и запуск

```bash
npm install          # один раз
npm run dev          # разработка с hot-reload
```

## Сборка

```bash
npm run build        # только веб-часть в out/ (быстро, для проверки, .exe НЕ трогает)
npm run dist         # полный установщик + release/win-unpacked/Flow.exe
```

**КРИТИЧНО перед `npm run dist`:** закрой запущенный Flow, иначе `EBUSY` на
`release/win-unpacked`:
```powershell
Get-Process -Name Flow -ErrorAction SilentlyContinue | Stop-Process -Force
```
Затем `rm -rf release/win-unpacked` (если осталось) и `npm run dist`.

## Проверка типов

```bash
npx tsc --noEmit
```
Raw typecheck пока содержит ровно **13 принятых диагностик технического долга**.
Единственный нормативный список находится в
[`docs/materials-orchestrator/baselines/M0.6-quality-baseline.json`](docs/materials-orchestrator/baselines/M0.6-quality-baseline.json),
а правила сравнения — в
[`docs/materials-orchestrator/10-engineering-quality-baseline.md`](docs/materials-orchestrator/10-engineering-quality-baseline.md).

`npm test` запускает baseline guard и сравнивает точное мультимножество
`project-relative file + TS code + primary message`. Нельзя игнорировать ошибку только
потому, что она находится в старом файле или имеет знакомый код. Новый/изменённый
fingerprint — регрессия. Исчезнувшую ошибку нужно удалить из manifest в той же карточке,
чтобы её возврат не остался разрешённым. Смена TypeScript или `tsconfig.json` требует
явного пересмотра baseline.

## Добавить новый вид ноды (частый паттерн)

Ноды — единый shape `flow-node` с полем `kind`; данные в `props.extra` (JSON).
Регистрировать новый kind в:
1. `FlowNodeShapeUtil.tsx`: `KINDS`, `KIND_NAME`, `NodeBodySwitch`, при необходимости
   `extractNodeContext` (чтобы ИИ видел содержимое по стрелке).
2. `os/nodeIcons.tsx`: иконка в `NodeIcon`.
3. `App.tsx`: `SIDEBAR_CHIPS`, группа в `NODE_GROUPS`, размеры в `sizeFor`.

## Соглашения проекта

- Горячие клавиши — только через `e.code` (не `e.key`): у пользователя русская раскладка.
- Отвечать/комментировать по-русски.
- IPC: метод добавляется в `src/main/*.ts` (handler) + `src/preload/index.ts` (проброс)
  + `src/renderer/src/flow-api.d.ts` (тип).

## Real-time sync-сервер (Cloudflare)

Только если нужно поднять/переразвернуть совместную работу. Требует интерактива юзера.

```bash
cd sync-server
npm install
npx wrangler login        # откроет браузер — вход в Cloudflare (делает ЮЗЕР)
npx wrangler deploy       # выведет https://flow-sync.<subdomain>.workers.dev
```
Гочи:
- Перед первым `deploy` в дашборде Cloudflare открой **Workers & Pages**, чтобы
  создался `workers.dev` субдомен (иначе ошибка `code: 10063`).
- Используется **SQLite Durable Object** (`new_sqlite_classes` в `wrangler.toml`) —
  работает на **бесплатном** плане, R2 НЕ нужен.
- Свежий субдомен несколько минут поднимает SSL (curl вернёт `000`/exit 35 — это ок).

Подключение в приложении: меню доски → **⚙ Сервер синхронизации** (`wss://…`) →
**🌐 Сделать общей** / **🔗 Подключиться**. Дефолтный адрес прошит в
`App.tsx` (`syncServer` initial) — при необходимости замени на свой воркер.

## Пакет улучшений (v1) — как работать

Полное ТЗ: [`docs/TZ-improvements.md`](docs/TZ-improvements.md) (26 задач, 5 эпиков).
Журнал выполнения: [`docs/CHANGELOG-improvements.md`](docs/CHANGELOG-improvements.md).
**Одна задача — одна ветка/сессия.** Порядок и жёсткие зависимости — в §0.2 ТЗ
(старт: `T1.1 → T1.2 → T4.1 → …`).

Ключевые правила (§0.1 ТЗ, кратко):

1. **Обратная совместимость.** Старые доски/память/ключи/настройки не ломать. Смена
   формата данных — только через миграцию с бэкапом исходника в `%APPDATA%/flow/backup/`.
2. **Фиче-флаги** в `settings.json`: инфраструктура (БД, логи) — вкл по умолчанию;
   поведенческие фичи — с дефолтами из задачи. Мягкая деградация при отсутствии зависимости.
3. **TypeScript strict + zod** для всех новых структур данных; валидация IPC-пейлоадов — в main.
4. **Безопасность.** Не ослаблять `contextIsolation`/`sandbox`; ключи провайдеров не логировать
   и не отдавать в renderer в открытом виде.
5. **Без телеметрии.** Исходящие запросы — только к настроенным провайдерам и API из задач.
6. **UI-строки — по-русски**, в стиле существующего интерфейса.
7. **После каждой задачи:** baseline guard чистый, raw typecheck не содержит ничего сверх
   M0.6 manifest, `npm run build` проходит, smoke (открыть старую доску, создать по ноде
   основных kind, простой ран оркестратора, дроп PDF), запись в CHANGELOG.

Вопросы «на выбор исполнителя» — решать самому и фиксировать в CHANGELOG; «согласовать с
владельцем» — останавливаться и спрашивать.

### Нативные модули (напоминание для T1.1+)

`better-sqlite3` — нативный модуль. После `npm install` пересобрать под Electron:
`npx electron-rebuild -f --only better-sqlite3` (НЕ `-w` — оно цепляет и `node-pty`,
который без MSVC не собирается). Для `dist`: `npmRebuild:false` пакует уже пересобранный
бинарник; модуль должен быть в `asarUnpack`.

## Как убедиться, что всё работает

1. `npm install` без ошибок.
2. `npm run build` завершается `✓ built`.
3. `npm run dev` — открывается окно с холстом; можно добавить ноду из сайдбара.
4. Для проверки в упакованном виде — `npm run dist`, затем запустить
   `release/win-unpacked/Flow.exe`.
