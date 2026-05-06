# Handoff

## Текущая цель

Доработать Telegram Mini App демо-букмекерки: синхронизация линии по турнирам с копируемым debug-отчётом, EPL/NHL настройки, русификация подробных рынков, блокировка фонового скролла в купоне/карточке матча и улучшение состояния принятия ставки.

## Текущий статус

- Проект работает как Flask backend на Vercel Python runtime.
- Frontend находится в `templates/index.html`, `static/app.js`, `static/styles.css`.
- Хранилище данных: Supabase через REST client на service role key.
- Telegram Mini App auth использует `initData`.
- The Odds API используется для prematch-коэффициентов, подробных рынков события и результатов.
- В текущей итерации исправлена синхронизация по отдельным sport key, добавлен EPL, для NHL выделены регионы `ODDS_API_HOCKEY_REGIONS=us,eu`.
- На странице синхронизации админ видит отдельные кнопки турниров и после каждого запроса получает debug-блок с кнопкой копирования.
- Loading modal теперь выше админки по слоям, поэтому виден во время sync.
- Купон и карточка матча используют отдельные scroll lock'и и не дают листать основной экран.

## Изменённые файлы

- `.env.example`: добавлен `ODDS_API_HOCKEY_REGIONS`.
- `README.md`: описан отдельный список регионов для хоккея.
- `lib/config.py`: добавлен `soccer_epl` в базовые турниры.
- `lib/events.py`: добавлены русские названия detailed markets и EPL fallback.
- `lib/odds_api.py`: NHL odds/event markets используют `ODDS_API_HOCKEY_REGIONS`.
- `lib/odds_sync.py`: EPL seed title, `h2h_3_way`, `alternate_totals_*`, `alternate_spreads_*` нормализуются в русские исходы.
- `static/app.js`: sync по турнирам, копируемый debug после каждого sync, scroll locks, success-анимация ставки, русификация outcome labels.
- `static/styles.css`: стили sync-кнопок, loading success/confetti, empty-state, alignment карточек, z-index loading.
- `templates/index.html`: блок sync по турнирам и отдельный debug-блок.
- `supabase/seed.sql`: добавлены EPL и NHL в seed.
- `docs/HANDOFF.md`: текущий handoff.
- `docs/ARCHITECTURE.md`: описание архитектуры.

## Важные решения

- Линия сначала фильтруется по виду спорта: все, футбол, хоккей, киберспорт.
- Турниры внутри выбранного спорта отображаются сворачиваемыми блоками.
- История ставок не дублирует общий статус рядом с типом ставки; результат показывается справа как выплата/проигрыш/возврат.
- Кэф в карточке истории показывается числом без слова `Кэф` под суммой справа.
- Подробный debug синхронизации должен появляться даже при timeout или HTML-ошибке от Vercel.
- Для долгого sync фронт запускает синхронизацию по одному sport key, чтобы каждый турнир дал отдельный ответ и отдельный debug.
- Если отдельный турнир упал не из-за `409 sync_already_running`, общий sync продолжает следующие турниры и сохраняет error debug по упавшему турниру.
- NHL odds/event markets запрашиваются с регионами `us,eu` по умолчанию, потому что европейский регион часто не отдаёт хоккейную линию.
- Подробные рынки `h2h_3_way`, `alternate_spreads_h1/h2`, `alternate_totals_h1/h2` русифицируются на backend при новом sync и дополнительно адаптируются на frontend для старых строк.
- Success-анимация ставки реализована через loading modal: spinner превращается в зелёную галочку, добавлен лёгкий confetti.

## Выполненные команды

- `Get-ChildItem -Force`
- `Get-ChildItem -Recurse -File -Depth 2`
- `git status --short`
- Чтение `README.md`, `requirements.txt`, `vercel.json`, `.env.example`.
- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py`
- `git diff --check`
- `Get-Content -Raw -Encoding UTF8 .\static\app.js`
- `Get-Content -Raw -Encoding UTF8 .\static\styles.css`
- `Get-Content -Raw -Encoding UTF8 .\lib\odds_api.py`
- `Get-Content -Raw -Encoding UTF8 .\templates\index.html`
- `Select-String -Path .\static\app.js -Pattern "..."`
- `Select-String -Path .\static\styles.css -Pattern "..."`
- `git diff --stat`
- `$env:PYTHONIOENCODING='utf-8'; @' ... '@ | .\.venv\Scripts\python -` Flask smoke test для `/`, `/health`, `/api/sports`.

## Статус тестов

Пройдено:

- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py`
- `git diff --check`
- Flask smoke test: `/`, `/health`, `/api/sports` вернули `200`.

## Следующие шаги

- Проверить в production Mini App, что loading modal виден поверх админки во время sync.
- Запустить sync отдельно для `icehockey_nhl` и проверить в debug `request_url` с `regions=us%2Ceu`.
- Запустить sync отдельно для `soccer_epl`.
- Подтянуть detailed markets у события и проверить, что в линии отображаются русские названия фор/тоталов.
- Сделать commit и push в `main`, если пользователь попросит деплой.

## Риски и открытые вопросы

- Vercel Python Functions могут завершать долгий sync раньше, чем frontend дождётся ответа. Нужна более надёжная очередь/background job, если объём лиг вырастет.
- Supabase REST операции по ставкам и settlement не являются полноценными транзакциями. Есть риск гонок при параллельных расчётах.
- The Odds API `/scores` покрывает лиги не одинаково; ручной расчёт остаётся обязательным fallback.
- TODO: проверить реальный ответ The Odds API для NHL odds/event markets на production ключе.
