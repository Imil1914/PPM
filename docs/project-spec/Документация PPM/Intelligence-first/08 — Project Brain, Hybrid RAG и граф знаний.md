---
type: rag_spec
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 08 — Project Brain, Hybrid RAG и граф знаний

## Терминологическое решение

«Собственный embedding проекта» означает отдельный namespace/index и набор vectors проекта, а не отдельную обученную модель. Одна проверенная embedding model может обслуживать много проектов. Project configuration хранит её профиль и pipeline version.

## Цели

- отвечать по данным конкретного проекта;
- учитывать выбранные Canvas nodes и связи;
- всегда показывать источники;
- не смешивать команды;
- находить и точные термины, и смысловые совпадения;
- работать в деградированном keyword-only режиме;
- предлагать действия с preview, а не скрыто менять проект.

## Источники MVP

| Источник | Представление для индекса |
|---|---|
| Work Item | identifier, title, description, state, priority, assignee names, dates |
| Plane Page | title, headings, rich-text converted to normalized text |
| Vault Markdown/text | headings, blocks, wiki-links, path |
| Vault PDF | текст по страницам; OCR позже |
| Canvas note | title/body + neighboring semantic edges |

После MVP: comments, attachments, DOCX/PPTX/XLSX, repositories, code, commits, PR, external connectors.

## Индексационный pipeline

### 1. Обнаружение изменения

Источник создаёт outbox event или периодический reconciler обнаруживает новую `source_version`.

### 2. Проверка политики

- source доступен project;
- тип разрешён;
- folder/source не имеет `exclude`;
- размер не превышает лимит;
- файл прошёл malware/quarantine gate;
- MIME определён сервером.

### 3. Извлечение

- Work Item/Page: server-side serializer;
- Markdown/TXT: UTF-8 с контролем encoding;
- PDF: text layer с page locators;
- другие типы: отдельные parsers после MVP.

### 4. Нормализация

- сохранить заголовки и структурные границы;
- убрать повторяющиеся headers/footers PDF по эвристике;
- не включать signed URLs, tokens, hidden form fields;
- сохранить source locator.
### 5. Chunking

Стартовая политика:

- 600–1000 tokens;
- overlap 80–120 tokens;
- не разрывать короткий Markdown section;
- Work Item обычно один chunk, длинное description делится по блокам;
- PDF chunk не пересекает страницы без locator на обе страницы;
- каждый chunk имеет content hash.

Точные значения являются конфигурацией pipeline и фиксируются в evaluation report.

### 6. Keyword index

Postgres full-text search с русской и простой конфигурацией. Для identifiers, filenames, branch names и кодовых символов сохраняется отдельное exact/trigram поле.

### 7. Embeddings

Embedding provider получает только разрешённый нормализованный текст. Результат хранится с точным model ID, dimension и pipeline version.

### 8. Публикация

Новая версия chunks становится видимой retrieval атомарно. До этого используется предыдущая ready-версия либо источник помечается stale.

## Retrieval pipeline

```text
Question
→ permission-scoped project filter
→ selected Canvas sources
→ graph neighbor expansion
→ exact/keyword search
→ dense vector search
→ rank fusion
→ optional reranker
→ diversity and token budget
→ source text fetch
→ model answer with citations
```

### Rank fusion

MVP использует Reciprocal Rank Fusion либо другой детерминированный способ объединить keyword и dense ranks. Не складывать несопоставимые raw scores напрямую.

### Graph expansion

Typed edges дают bonus источникам, связанным с выделенными нодами. Глубина по умолчанию `1`; глубина больше `2` требует явного выбора, чтобы не размывать контекст.

### Structured augmentation

Для вопросов о статусах, сроках, исполнителях и counts система запрашивает Plane структурированно. Embeddings не используются как источник актуального состояния задачи.

## Ответ и citations

Ответ содержит:

- краткий вывод;
- факты со ссылками;
- явно обозначенные предположения;
- противоречия/пробелы;
- следующие действия;
- список использованных источников;
- признак degraded retrieval.

Citation указывает точный объект и locator: Work Item, Page section, Vault path+heading, PDF page, Canvas node или Git path+commit.

Если надёжных источников нет, модель должна сказать об этом и не выдавать общий ответ за знание проекта.

## Project memory

Память делится на:

1. **Фактические источники** — Plane/Vault/Git/Canvas.
2. **Подтверждённые решения** — созданные человеком либо принятые AI proposals.
3. **История запросов** — диалоги и ответы.
4. **Периодические summaries** — производные дневные/недельные/релизные выжимки.

Summary всегда хранит ссылки на source versions. После изменения источников оно помечается `possibly_stale`, но не переписывается молча.

## Безопасность RAG

- permission filter применяется до retrieval и повторно до source fetch;
- запрещён global vector search с последующей фильтрацией результатов в browser;
- chunks удалённого/закрытого источника немедленно исключаются;
- содержимое файлов считается недоверенным и не может переопределить system/tool policy;
- инструкции из источника цитируются как данные, а не исполняются;
- secrets detector исключает вероятные credentials;
- модель не получает provider tokens и signed URLs;
- agent tool permissions совпадают с правами инициатора.

## Настройки проекта

- включён ли Project Brain;
- допустимые source types;
- folder-level include/exclude;
- embedding profile;
- completion profile;
- maximum retrieval scope;
- хранение query history;
- разрешён ли code indexing;
- background summaries;
- лимиты размера и токенов.

Настройки workspace могут задавать верхние ограничения, которые project не способен ослабить.

## MVP-команды

- `Спросить проект`;
- `Объяснить выделенные ноды`;
- `Найти противоречия`;
- `Что блокирует работу?`;
- `Предложить следующие шаги`;
- `Создать черновик сводки`;
- `Предложить связи`.

## Evaluation

Для тестового проекта создаётся фиксированный набор источников и минимум 20 запросов:

- exact identifier;
- русский термин;
- смысловой перефраз;
- вопрос по PDF page;
- вопрос по связи двух нод;
- вопрос без ответа;
- конфликтующие источники;
- попытка prompt injection в документе;
- запрос пользователя другой команды.

Метрики:

- Recall@K источников;
- citation correctness;
- groundedness;
- cross-project leakage = 0;
- stale source exclusion;
- latency p50/p95;
- degraded fallback success.

## Acceptance MVP

1. Work Item, Page, Markdown и PDF индексируются отдельно по project.
2. Ответ содержит кликабельные citations.
3. Выделенные Canvas nodes влияют на retrieval.
4. Удалённый источник перестаёт использоваться.
5. Без vector provider работает keyword fallback.
6. Без LLM UI показывает найденные источники.
7. Документ с инструкцией «игнорируй правила» не получает tool execution.
8. Пользователь другого project не получает чужие chunks ни по API, ни в ответе.
