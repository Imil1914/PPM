---
type: design_system_spec
project_id: intellect-ppm
status: current
version: 3
created: 2026-09-12
updated: 2026-09-12
---

# 11 — AntyFlow дизайн-система и полный ребрендинг Plane

## Цель

Пользователь должен воспринимать PPM как самостоятельную систему интеллекта проекта. Название Plane, его логотип, фирменная палитра, иконки и характерная оболочка не должны появляться в основном пользовательском опыте.

## Стратегия

Не переписывать бизнес-функции Plane. Создать изолированный design/experience layer:

```text
packages/ppm-brand/
├── tokens/
│   ├── colors.css
│   ├── spacing.css
│   ├── typography.css
│   ├── radius.css
│   └── motion.css
├── assets/
│   ├── logo.svg
│   ├── mark.svg
│   ├── favicon.*
│   └── illustrations/
├── icons/
├── components/
├── terminology/
│   ├── ru.json
│   └── en.json
└── theme-provider.tsx
```

Точный путь подстраивается под monorepo Plane, но все PPM tokens/assets должны иметь единый источник.

## Исходная палитра AntyFlow

Проверенные значения desktop-прототипа:

| Token | Графит | Обсидиан | Тёплый уголь | Светлая |
|---|---:|---:|---:|---:|
| background | `#0E0F12` | `#0C0D18` | `#121110` | `#EEF0F3` |
| panel | `#15171C` | `#131527` | `#181512` | `#FFFFFF` |
| panel 2 | `#1B1E24` | `#181B31` | `#1E1A16` | `#F4F6F9` |
| border | `#272B34` | `#272B4A` | `#2E2822` | `#D5DAE1` |
| text | `#E7EAF0` | `#E6E8F5` | `#EDE9E3` | `#1A1D23` |
| muted | `#8B93A3` | `#8D93B8` | `#A29A8E` | `#6B7280` |

Базовый accent: `#22D3EE`. Типографика прототипа: IBM Plex Sans, для code — JetBrains Mono.

Перед production эти значения проходят contrast/a11y проверку. Опечатки и несогласованные токены прототипа не копируются автоматически.

## Семантические токены

Компоненты используют не raw hex, а роли:

```text
--ppm-bg-canvas
--ppm-bg-surface-1
--ppm-bg-surface-2
--ppm-bg-elevated
--ppm-border-subtle
--ppm-border-strong
--ppm-text-primary
--ppm-text-secondary
--ppm-text-disabled
--ppm-accent
--ppm-accent-hover
--ppm-focus-ring
--ppm-status-success
--ppm-status-warning
--ppm-status-danger
--ppm-node-note
--ppm-node-ai
--ppm-node-code
--ppm-node-media
```

Адаптер отображает существующие semantic tokens Plane/Propel на PPM tokens. Запрещено массово заменять hex по всему репозиторию.

## Визуальные принципы

- холст и граф — центральная метафора;
- интерфейс тёмный по умолчанию, светлая тема равноценна;
- панели выглядят как части единой рабочей поверхности;
- яркий cyan accent используется умеренно;
- тип объекта различается цветом, иконкой и текстом;
- состояния задачи остаются читаемыми независимо от темы;
- motion помогает понять связь и изменение, но отключается;
- плотность UI подходит для 5–20 команд и сотен задач.

## Новая оболочка

### Global shell

- собственный логотип/wordmark;
- workspace/project switcher;
- глобальный поиск;
- command palette;
- уведомления;
- профиль пользователя;
- индикатор состояния Project Brain.

### Project shell

- левая навигация из документа 02;
- breadcrumbs без Plane terminology;
- contextual create button;
- правый inspector для выбранной сущности;
- быстрый переход `Работа ↔ Мозг проекта ↔ Знания ↔ Код`.

## Порядок ребрендинга

### B0. Инвентаризация
Найти все:

- `Plane`, `plane.so`, `@plane` в user-facing strings;
- logo components и images;
- favicon/PWA assets;
- page titles/meta;
- email templates;
- loading spinners;
- empty states;
- public/shared pages;
- admin/God mode;
- help/docs/community links;
- colors/fonts/icons outside tokens.

Импортные package names `@plane/*` не переименовываются только ради маскировки: пользователь их не видит, а изменение создаст огромный fork diff.

### B1. Brand foundation

- PPM name/mark/logo;
- favicon/PWA icons;
- app title/meta;
- theme tokens;
- typography;
- base Button/Input/Dialog/Card/Toast;
- legal/source link.

### B2. Первый пользовательский путь

- sign in/sign up;
- invitations;
- create workspace;
- create project;
- home/project overview;
- main navigation.

### B3. Главные рабочие экраны

- Work Items list/board/detail;
- Cycles/Modules/Views;
- Pages;
- Canvas;
- Vault;
- Project Brain;
- Code.

### B4. Хвостовые поверхности

- settings;
- import/export;
- notifications;
- email templates;
- errors/offline;
- public pages;
- admin screens;
- mobile/responsive states.

## Терминология

| Внутреннее Plane | Русский PPM | Английский PPM |
|---|---|---|
| Workspace | Пространство | Space |
| Project | Проект | Project |
| Work Item | Задача | Work item |
| Cycle | Этап | Cycle |
| Module | Направление | Module |
| Page | Совместная страница | Page |
| Attachment | Вложение | Attachment |
| Canvas | Мозг проекта | Project Brain Canvas |

Технические API/model names не обязаны повторять UI translation.

## Лицензия и attribution

- LICENSE/copyright headers в source сохраняются;
- пользователь получает страницу `О системе → Открытый исходный код`;
- страница содержит Plane upstream, точный fork commit, AGPL text, source offer/link и инструкции сборки;
- обязательные legal notices не маскируются;
- логотип Plane не используется как логотип PPM;
- перед публичным коммерческим выпуском выполняется legal review.

## Visual regression

Для каждой темы сохраняются screenshots:

- auth;
- home;
- project navigation;
- Work Items board/list/detail;
- Pages editor;
- Canvas;
- Vault;
- Brain answer with citations;
- Code/PR;
- settings;
- error/empty/loading.

Автотест проверяет отсутствие user-facing `Plane` на основном маршруте, но allowlist разрешает legal/source page и технические license notices.

## Acceptance

1. На основных маршрутах нет названия/логотипа/ссылок Plane.
2. Цвета и typography берутся из PPM tokens.
3. Пользователь проходит регистрацию и project flow в единой оболочке.
4. Light/dark темы читаемы.
5. Основные действия доступны с клавиатуры и имеют focus state.
6. Legal/source notice доступен в два клика.
7. Upstream packages не переименованы без функциональной необходимости.
8. Visual snapshot suite не имеет неожиданных отличий.
