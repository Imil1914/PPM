---
type: vault_spec
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 09 — Project Vault в стиле Obsidian

## Что уже есть в desktop AntyFlow

Проверено в ветке `feat/t1.1-sqlite`:

- выбор реальной папки на диске;
- дерево папок и `.md`-файлов;
- создание, чтение, запись, rename и move;
- безопасное разрешение относительных путей внутри root;
- Markdown editor/live preview;
- wiki-links;
- backlinks/graph view;
- file watcher для внешних изменений;
- возможность открыть ту же папку в настоящем Obsidian.

Эта реализация является функциональным прототипом и источником UX, но она Electron-only. Для web-продукта файловые операции переносятся в server API и object storage.

## Целевая модель

У каждого Plane project один Project Vault:

```text
Project Vault
├── 00 Входящие/
├── 10 Требования/
├── 20 Исследования/
├── 30 Проектирование/
├── 40 Реализация/
├── 50 Испытания/
├── 60 Отчёты/
└── Вложения/
```

Шаблон папок является предложением при создании, а не жёстким ограничением.

## Поддерживаемые операции MVP

- создать folder;
- создать `.md` note;
- загрузить file;
- открыть/preview;
- редактировать Markdown;
- rename/move;
- soft delete в trash;
- восстановить;
- просмотреть versions;
- получить download link;
- построить wiki-link;
- увидеть backlinks;
- включить/исключить индексацию;
- перетащить на Canvas;
- экспортировать Vault в ZIP.

## Типы файлов

### MVP

- `.md`, `.txt` — просмотр и редактирование;
- `.pdf` — просмотр и extraction text layer;
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` — preview с безопасной обработкой SVG;
- остальные типы — хранение/download по allowlist.

### После MVP

- `.docx`, `.pptx`, `.xlsx`, `.csv`, `.rtf` extraction/preview;
- OCR изображений и scanned PDF;
- media transcription;
- source code preview;
- WebDAV/desktop sync.

## Хранение

Логическое дерево хранится в Postgres, blobs — в private S3-compatible storage. Object key не включает исходное имя:

```text
vault/<vault_uuid>/<entry_uuid>/<version>
```

Это предотвращает path traversal, collisions и утечку пользовательских путей.

## Markdown и wiki-links

Поддерживаемый синтаксис:

```text
[[Название заметки]]
[[Папка/Заметка]]
[[Папка/Заметка#Раздел]]
[[Папка/Заметка|Отображаемый текст]]
```

Каждый файл имеет UUID. Человек видит path-based link, а индекс разрешает его в UUID. После rename/move:

1. target UUID остаётся прежним;
2. новые открытия используют новый путь;
3. inbound links либо обновляются атомарной job, либо сохраняется redirect alias;
4. неоднозначные links показываются как unresolved/ambiguous.

## Версии и конфликты

- каждое сохранение Markdown передаёт `base_version`;
- stale edit получает `409`;
- новая версия blob создаётся до переключения `current_version_id`;
- history показывает автора, время, размер и hash;
- restore создаёт новую текущую версию на основе старой, а не удаляет промежуточные;
- binary overwrite также создаёт новую version.

## Связь с Plane

### С Work Item

Действие `Связать с задачей` создаёт reference link. Work Item показывает Vault metadata и signed open link; файл физически не копируется в attachment.

### С Plane Page

Действия `Экспортировать Page в Markdown` и `Создать Page из Markdown` являются явными импортами. Результат получает provenance link, но автоматическая двусторонняя синхронизация не входит в MVP.

### С Canvas

Drag/drop создаёт `vault_file_ref`. Удаление ноды не удаляет Vault entry.

## Индексация в Project Brain

Policy вычисляется по цепочке:

```text
workspace policy
→ project policy
→ nearest folder policy
→ file policy
```

`exclude` имеет приоритет. UI показывает `не индексируется / ожидает / индексируется / готово / устарело / ошибка`.

Файл остаётся доступным даже при ошибке RAG.

## Импорт и экспорт

### Import folder/ZIP

- проверить число файлов, общий размер и depth;
- нормализовать пути;
- отвергнуть `..`, absolute paths, device names и symlinks;
- не исполнять содержимое;
- дедуплицировать blobs по hash при сохранении логических entries;
- вывести отчёт конфликтов имён.

### Export ZIP

- сохранить папочную структуру и имена;
- Markdown остаётся читаемым;
- включить `.ppm/export-manifest.json` с UUID, versions и links;
- не включать trash, secrets и excluded internal metadata по умолчанию;
- экспорт должен открываться как обычная папка и может быть открыт Obsidian.

## Поиск и граф

- filename/path search;
- full-text по Markdown/text;
- backlinks panel;
- graph view по wiki-links;
- optional overlay semantic edges Canvas;
- filters по типу, автору, дате и index state.

## Безопасность

- server-side permission на каждую операцию;
- MIME sniffing, size limits, antivirus/quarantine hook;
- SVG не исполняется как произвольный HTML;
- Office macros не выполняются;
- signed URL короткоживущий;
- original filename не используется как storage key;
- archive extraction защищён от zip bomb/path traversal;
- parser запускается с resource/time limits;
- содержимое считается недоверенным prompt input.

## Acceptance MVP

1. У каждого project отдельное дерево.
2. Markdown сохраняется, версионируется и переживает restart.
3. Wiki-link создаёт backlink и edge графа.
4. PDF загружается, открывается и при разрешении индексируется.
5. Outsider не читает metadata, content, signed URL или chunks.
6. Rename/move не ломает stable entry ID.
7. Export ZIP содержит обычные папки и `.md`.
8. Canvas projection открывает тот же Vault entry.
9. Ошибка extraction не приводит к потере файла.
