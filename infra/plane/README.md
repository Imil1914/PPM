# Plane Community baseline для PPM

Этот каталог фиксирует неизменяемый Plane Community `v1.4.2` как первый строительный блок PPM и отдельно описывает проверяемую цепочку PPM-патчей. Исходники подключены Git submodule в `plane-fork`; исходный release/tag и его контрольные суммы остаются самостоятельным audit boundary.

## Зафиксированный источник

| Поле | Значение |
|---|---|
| Upstream | `https://github.com/makeplane/plane.git` |
| Fork | `https://github.com/Imil1914/plane.git` |
| Integration branch | `ppm/integration-v1.4.2` |
| Release | `v1.4.2` |
| Baseline commit | `5f7d92784c403f76284f0f16718f320221dc7fec` |
| Integration commit | `7e6aa54d5130c3c6d00f6b5392750f916ad4303d` |
| License | AGPL-3.0-only |

Машиночитаемая фиксация находится в `baseline-manifest.json`: поле `commit` хранит upstream baseline, `integrationCommit` — точную ревизию поставки, а `ppmPatches` — обозримую цепочку PPM-изменений. Первая запись относится к I0.2; её можно визуально отключить через `PPM_BRAND_ENABLED=0` без изменения данных.

## Требования

- Git с поддержкой submodules;
- Docker Engine или Docker Desktop с Compose v2;
- Node.js 22.18+ для служебных проверок baseline;
- свободные порты `8080` и `8443`.

## Запуск закреплённой интеграции

```bash
git clone --recurse-submodules https://github.com/Imil1914/PPM.git
cd PPM
npm run plane:bootstrap
npm run plane:verify
npm run plane:env
npm run plane:env:check
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml config --quiet
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml up -d
```

Откройте `http://127.0.0.1:8080`. Первый запуск загружает контейнеры и выполняет миграции, поэтому готовность интерфейса может занять несколько минут.

Официальный Compose в release `v1.4.2` всё ещё ссылается на недоступный `minio/minio:latest` в Docker Hub. Маленький compatibility overlay не меняет код или конфигурацию Plane: он заменяет только образ этого S3-совместимого сервиса на официальный Quay registry и закрепляет последний open-source release MinIO `RELEASE.2025-09-07T16-13-09Z`. Основание: [официальная инструкция MinIO](https://min.io/docs/minio/container/index.html) и [release upstream](https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z).

`npm run plane:env` один раз создаёт локальный `infra/plane/.runtime/plane.env` из официального шаблона, закрепляет `APP_RELEASE=v1.4.2` и генерирует случайные локальные секреты. Файл игнорируется Git, значения секретов не выводятся. Повторная генерация возможна только явно: `node scripts/plane-baseline/prepare-env.mjs --force`.

## Автоматический golden smoke

После запуска сервисов:

```bash
npm run plane:smoke
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml restart
npm run plane:smoke:verify
```

Проверка выполняет пользовательскую цепочку через те же HTTP endpoints, которые использует web-клиент:

```text
instance setup → sign up → workspace → project → Work Item → Page
→ attachment upload → logout/login → read → restart → повторный read
```

Тестовые данные и учётные данные сохраняются только в игнорируемом `infra/plane/.runtime/smoke-state.json`. Не используйте smoke-команду против общего или production-инстанса: она создаёт реальные данные.

## Ручная проверка интерфейса

1. Зарегистрируйте тестового пользователя.
2. Создайте workspace и проект.
3. Создайте Work Item и откройте его после обновления страницы.
4. Создайте Page и добавьте изображение как attachment.
5. Выйдите и войдите снова; проверьте все созданные сущности.
6. Перезапустите Compose без удаления volumes и повторите чтение.
7. Зафиксируйте дату, среду и результат в `verification-record.md`.

## Диагностика

```bash
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml ps
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml logs --tail=200
```

Секреты из `plane.env` не копируются в issue, pull request или логи. Если заняты порты, измените только `LISTEN_HTTP_PORT`, `LISTEN_HTTPS_PORT`, `WEB_URL` и `CORS_ALLOWED_ORIGINS` согласованно.

## Остановка и rollback

Без удаления данных:

```bash
docker compose --env-file infra/plane/.runtime/plane.env \
  -f plane-fork/deployments/cli/community/docker-compose.yml \
  -f infra/plane/docker-compose.compat.yml stop
```

Команда `down --volumes` удаляет тестовые данные. Её нельзя запускать автоматически или без явного решения владельца и проверки точного Compose project.

Для отката исходников верните gitlink `plane-fork` на commit из `baseline-manifest.json`. Не переключайте baseline на `stable`, `latest` или плавающую upstream-ветку.
