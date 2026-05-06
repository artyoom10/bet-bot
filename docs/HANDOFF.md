# Handoff

## Текущая цель

Доработать Telegram Mini App демо-букмекерки после production debug: ускорить sync EPL/NHL, добавить клубный доступ только для заранее созданных пользователей, расширить админку пользователями/ставками/турнирами и улучшить отображение результатов.

## Текущий статус

- Проект работает как Flask backend на Vercel Python runtime.
- Frontend находится в `templates/index.html`, `static/app.js`, `static/styles.css`.
- Хранилище данных: Supabase через REST client на service role key.
- Telegram Mini App auth использует `initData`.
- The Odds API используется для prematch-коэффициентов, подробных рынков события и результатов.
- В текущей итерации причина timeout по EPL/NHL локализована в большом количестве Supabase REST операций на каждый коэффициент.
- `lib/odds_sync.py` переведён на bulk upsert букмекеров/коэффициентов с `return=minimal`; snapshots в обычном fast sync отключены и помечаются в debug как `disabled_for_fast_sync`.
- Добавлен env `ODDS_SYNC_BOOKMAKER_KEYS=pinnacle,onexbet,marathonbet`; `all` вернёт обработку всех букмекеров.
- Для одиночного sync в `sync_runs.sport_key` сохраняется sport key.
- Пользователь без созданного профиля теперь видит отдельный экран “Вы не являетесь членом данного клуба”; auto-create для обычных пользователей отключён на `/api/me` и обычных API.
- В админке добавлены удаление пользователя, список ставок по пользователям, ручной расчёт pending ставки и удаление ставки.
- У турниров появился `logo_url`; линия показывает лого турнира слева от названия.
- Ручной расчёт результата принимает `result_note=ot|so`; история показывает хоккейный счёт вроде `3:2 (ОТ)`.
- На странице синхронизации админ видит отдельные кнопки турниров и после каждого запроса получает debug-блок с кнопкой копирования.
- Loading modal теперь выше админки по слоям, поэтому виден во время sync.
- Купон и карточка матча используют отдельные scroll lock'и и не дают листать основной экран.

## Изменённые файлы

- `.env.example`: добавлен `ODDS_SYNC_BOOKMAKER_KEYS`.
- `README.md`: описан отдельный список регионов для хоккея.
- `app.py`: клубный доступ, новые endpoints удаления пользователей/ставок и ручного расчёта ставки, `result_note` для ручного результата.
- `lib/admin_auth.py`: админка больше не создаёт неизвестных non-env пользователей.
- `lib/admin_users.py`: удаление пользователя.
- `lib/bets.py`: ручной admin settlement ставки, удаление ставки, `result_note` в истории.
- `lib/events.py`: `league_logo_url` и `logo_url` в `/api/sports`.
- `lib/odds_api.py`: NHL odds/event markets используют `ODDS_API_HOCKEY_REGIONS`.
- `lib/odds_sync.py`: bulk/minimal sync, bookmaker filter, отключение snapshots в fast sync.
- `lib/settlement.py`: `result_note` для manual/API результатов.
- `lib/supabase_client.py`: `return_rows=False` для insert/upsert/update.
- `lib/admin_aliases.py`: `logo_url` для турниров.
- `static/app.js`: экран не-члена клуба, лого турниров, админские ставки по пользователям, удаление пользователей, более долгая success-анимация ставки.
- `static/styles.css`: стили club denied, league logo, result icons, admin bet user list, confetti вверх.
- `templates/index.html`: club denied screen, ручной result note, удалён блок удаления турниров из конструктора.
- `supabase/schema.sql`: `sports.logo_url`, `events.result_note`.
- `supabase/migrations/20260507_sport_logos_and_result_note.sql`: миграция для существующей БД.
- `vercel.json`: `maxDuration` для `app.py`.
- `.env.example`, `README.md`, `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`: документация.
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
- Fast sync не пишет `odds_snapshots`, чтобы не упираться в timeout Vercel/Supabase REST. Если история движения кэфов понадобится, лучше вернуть snapshots отдельной фоновой задачей.
- Неизвестный Telegram user больше не создаётся автоматически; админ должен создать пользователя заранее или указать его `tg_id`.
- Удаление pending ставки возвращает сумму ставки пользователю перед физическим удалением записи. Удаление уже рассчитанной ставки не откатывает ранее начисленные wallet transactions.

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
- `Get-Content -Path .\docs\HANDOFF.md -Encoding UTF8`
- `Get-Content -Path .\docs\ARCHITECTURE.md -Encoding UTF8`
- `node --check .\static\app.js`
- `py -m py_compile .\app.py .\lib\events.py .\lib\bets.py .\lib\odds_api.py .\lib\odds_sync.py .\lib\admin_users.py .\lib\admin_aliases.py .\lib\settlement.py .\lib\supabase_client.py .\lib\admin_auth.py`
- `@' ... '@ | py -` Flask smoke attempt failed: global Python has no `flask`.
- `@' ... '@ | .\.venv\Scripts\python.exe -` Flask smoke test для `/`, `/health`.
- `git diff --stat`
- `$env:PYTHONIOENCODING='utf-8'; @' ... '@ | .\.venv\Scripts\python -` Flask smoke test для `/`, `/health`, `/api/sports`.

## Статус тестов

Пройдено:

- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py lib/admin_users.py lib/admin_aliases.py lib/settlement.py lib/supabase_client.py lib/admin_auth.py`
- `git diff --check`
- Flask smoke test через `.\.venv\Scripts\python.exe`: `/`, `/health` вернули `200`.

## Следующие шаги

- Проверить в production Mini App, что loading modal виден поверх админки во время sync.
- Запустить sync отдельно для `icehockey_nhl` и проверить в debug `request_url` с `regions=us%2Ceu`.
- Запустить sync отдельно для `soccer_epl`.
- Выполнить SQL migration `supabase/migrations/20260507_sport_logos_and_result_note.sql` в Supabase до использования `logo_url` турниров и `result_note`.
- Проверить, что пользователь без строки в `users` видит только экран “Вы не являетесь членом данного клуба”.
- Проверить админку: удалить тестового пользователя, открыть “Все ставки”, выбрать пользователя, вручную рассчитать pending ставку и удалить pending ставку.
- Подтянуть detailed markets у события и проверить, что в линии отображаются русские названия фор/тоталов.
- Сделать commit и push в `main`, если пользователь попросит деплой.

## Риски и открытые вопросы

- Vercel Python Functions всё ещё могут завершать долгий sync раньше, чем frontend дождётся ответа, если выбрать слишком много букмекеров/рынков. Более правильное решение для роста объёма: очередь/background job.
- `vercel.json` выставляет `maxDuration: 300`, но доступный лимит зависит от тарифа Vercel.
- Supabase REST операции по ставкам и settlement не являются полноценными транзакциями. Есть риск гонок при параллельных расчётах.
- Удаление уже рассчитанных ставок не делает финансовый reverse начислений; это админское физическое удаление записи.
- The Odds API `/scores` покрывает лиги не одинаково; ручной расчёт остаётся обязательным fallback.
- TODO: проверить реальный ответ The Odds API для NHL odds/event markets на production ключе.
