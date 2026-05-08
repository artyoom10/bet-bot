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
- В текущей правке sync дополнительно облегчён: `admin_logs` получает компактный summary вместо полного debug, `sync_runs`/stale update идут с `return=minimal`, а повторный select событий после bulk upsert берёт только нужные поля.
- Для NHL возвращён дефолт `ODDS_API_HOCKEY_REGIONS=us,eu`.
- Добавлен env `ODDS_SYNC_MAX_EVENTS=40`: один sync турнира пишет ближайшие N событий; `0` отключает ограничение, но повышает риск timeout.
- `/api/sports` теперь считает все upcoming-события по виду спорта, а не только события с odds rows.
- Удаление ручных турниров в алиасах работает и для старых `manual_*` sport keys без `source='manual'`; перед удалением чистятся `team_source_aliases` по sport key.
- Кнопки “Назад” в админских страницах заменены на иконки справа.

## Изменённые файлы

- `.env.example`: добавлены/описаны `ODDS_API_MARKETS`, `ODDS_SYNC_BOOKMAKER_KEYS` и `ODDS_SYNC_MAX_EVENTS`.
- `README.md`: описаны base markets, отдельный список регионов для хоккея и лимит ближайших событий на sync.
- `app.py`: клубный доступ, новые endpoints удаления пользователей/ставок и ручного расчёта ставки, `result_note` для ручного результата; удаление ручного соревнования допускает старые `manual_*` ключи и чистит aliases.
- `lib/admin_auth.py`: админка больше не создаёт неизвестных non-env пользователей.
- `lib/admin_users.py`: удаление пользователя.
- `lib/bets.py`: ручной admin settlement ставки, удаление ставки, `result_note` в истории.
- `lib/events.py`: `league_logo_url` и `logo_url` в `/api/sports`; счётчики видов спорта считают upcoming-события без зависимости от `odds_current`.
- `lib/odds_api.py`: NHL odds/event markets используют `ODDS_API_HOCKEY_REGIONS=us,eu` по умолчанию.
- `lib/odds_sync.py`: bulk/minimal sync, bookmaker filter, отключение snapshots в fast sync, компактный admin log, `ODDS_SYNC_MAX_EVENTS`, лёгкий select событий после bulk upsert.
- `lib/settlement.py`: `result_note` для manual/API результатов.
- `lib/supabase_client.py`: `return_rows=False` для insert/upsert/update.
- `lib/admin_aliases.py`: `logo_url` для турниров.
- `static/app.js`: экран не-члена клуба, лого турниров, админские ставки по пользователям, удаление пользователей, более долгая success-анимация ставки, debug timeout содержит `path` и `timeoutMs`.
- `static/styles.css`: стили club denied, league logo, result icons, admin bet user list, confetti вверх, иконка возврата в админских страницах.
- `templates/index.html`: club denied screen, ручной result note, удалён блок удаления турниров из конструктора, админские “Назад” заменены на icon-only.
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
- `ODDS_API_MARKETS` по умолчанию держится на `h2h,spreads,totals`; подробные рынки лучше подтягивать кнопкой “Получить рынок”, чтобы не раздувать общий sync.
- Подробные рынки `h2h_3_way`, `alternate_spreads_h1/h2`, `alternate_totals_h1/h2` русифицируются на backend при новом sync и дополнительно адаптируются на frontend для старых строк.
- Success-анимация ставки реализована через loading modal: spinner превращается в зелёную галочку, добавлен лёгкий confetti.
- Fast sync не пишет `odds_snapshots`, чтобы не упираться в timeout Vercel/Supabase REST. Если история движения кэфов понадобится, лучше вернуть snapshots отдельной фоновой задачей.
- Sync ограничивает число ближайших событий через `ODDS_SYNC_MAX_EVENTS=40`; это сознательный компромисс под Vercel Function timeout. Если нужно забрать больше, лучше запускать отдельные турниры или переносить sync в background job.
- `active=true` у спорта The Odds API означает, что спорт/лига активны для запросов; `has_outrights=false` означает только отсутствие futures/outrights рынков, обычные event odds при этом могут работать.
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
- `node --check .\static\app.js`
- `.\.venv\Scripts\python.exe -m py_compile .\app.py .\lib\events.py .\lib\bets.py .\lib\odds_api.py .\lib\odds_sync.py .\lib\admin_users.py .\lib\admin_aliases.py .\lib\settlement.py .\lib\supabase_client.py .\lib\admin_auth.py`
- `git diff --check`

## Статус тестов

Пройдено:

- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py lib/admin_users.py lib/admin_aliases.py lib/settlement.py lib/supabase_client.py lib/admin_auth.py`
- `git diff --check`
- Flask smoke test через `.\.venv\Scripts\python.exe`: `/`, `/health` вернули `200`.
- В текущей итерации повторно пройдено: `node --check .\static\app.js`, `.\.venv\Scripts\python.exe -m py_compile ...`, `git diff --check`.

## Следующие шаги

- Проверить в production Mini App, что loading modal виден поверх админки во время sync.
- Запустить sync отдельно для `icehockey_nhl` и проверить в debug `request_url` с `regions=us%2Ceu`.
- Запустить sync отдельно для `soccer_epl`.
- Если sync всё ещё упирается во время, временно снизить `ODDS_SYNC_MAX_EVENTS` до `20` и проверить, что `ODDS_SYNC_BOOKMAKER_KEYS` не равен `all`.
- Выполнить SQL migration `supabase/migrations/20260507_sport_logos_and_result_note.sql` в Supabase до использования `logo_url` турниров и `result_note`.
- Проверить, что пользователь без строки в `users` видит только экран “Вы не являетесь членом данного клуба”.
- Проверить админку: удалить тестового пользователя, открыть “Все ставки”, выбрать пользователя, вручную рассчитать pending ставку и удалить pending ставку.
- Подтянуть detailed markets у события и проверить, что в линии отображаются русские названия фор/тоталов.
- После Vercel deploy проверить production Mini App на `betbot-seven.vercel.app`.

## Риски и открытые вопросы

- Vercel Python Functions всё ещё могут завершать долгий sync раньше, чем frontend дождётся ответа, если выбрать слишком много букмекеров/рынков. Более правильное решение для роста объёма: очередь/background job.
- `vercel.json` выставляет `maxDuration: 300`, но доступный лимит зависит от тарифа Vercel.
- Supabase REST операции по ставкам и settlement не являются полноценными транзакциями. Есть риск гонок при параллельных расчётах.
- Удаление уже рассчитанных ставок не делает финансовый reverse начислений; это админское физическое удаление записи.
- The Odds API `/scores` покрывает лиги не одинаково; ручной расчёт остаётся обязательным fallback.
- TODO: проверить реальный ответ The Odds API для NHL odds/event markets на production ключе.
- `ODDS_SYNC_MAX_EVENTS` может скрыть дальние события турнира до следующего sync, если лига отдаёт больше 40 upcoming games. Для полного расписания нужна очередь/background job.

## Обновление 2026-05-07

- Усилено удаление ручных соревнований: теперь backend сканирует все события выбранного manual/manual_* sport key, а не только события с `source='manual'`. События без ставок удаляются вместе со всеми odds rows, события со ставками отменяются и pending selections переводятся в refund через settlement.
- Удаление пользователя стало устойчивее: сначала выполняется физическое удаление `users`, а при FK-ограничениях профиль превращается в tombstone `deleted:*`, скрывается из админского списка и больше не проходит вход по старому Telegram ID.
- В админской странице “Все ставки” ручной расчёт подписан как итог ставки, выплата пересчитывается при выборе выигрыша/возврата/проигрыша/отмены.
- Success-анимация ставки увеличена: конфетти летит выше, галочка держится дольше, текст остаётся только “Ставка принята”.
- Проверить после деплоя: удалить тестовое ручное соревнование в “Алиасы и команды”, удалить тестового пользователя, открыть приложение удалённым Telegram ID и убедиться, что показывается экран “Вы не являетесь членом данного клуба”.
- Проверки текущей правки: `node --check .\static\app.js`, `.\.venv\Scripts\python.exe -m py_compile ...`, `git diff --check`, Flask smoke `/` и `/health`.

## Обновление 2026-05-07: линия и лого турниров

- В линии состояние свернутых турниров теперь хранится в frontend state и не сбрасывается при выборе/удалении позиции в купоне.
- В админке “Алиасы и команды” у турниров отображается превью `logo_url` рядом с названием; сохранение по-прежнему пишет URL в `sports.logo_url`, а линия показывает это лого слева от названия турнира.
- Добавлен cache-busting query к `static/styles.css` и `static/app.js` в `templates/index.html`, чтобы Telegram/Vercel не показывали старые frontend assets после деплоя.

## Обновление 2026-05-07: Vercel deploy config

- Удалён legacy `builds` из `vercel.json`; также убран точечный `functions` pattern, который давал ошибку Vercel “doesn't match any Serverless Functions”.
- Добавлен `api/index.py` как Vercel Python entrypoint. Он импортирует Flask `app` из корневого `app.py`; `vercel.json` теперь только переписывает все пути на `/api/index`.
- Success-анимация ставки переработана: галочка центрирована в крупном зелёном круге, добавлены ring pulse и более аккуратное confetti; Telegram haptic запускается после появления success/confetti, а не до него.

## Обновление 2026-05-07: алиасы, купон и очистка линии

- Сохранение лого турнира в админке стало устойчивее: frontend больше не ищет поля через небезопасный CSS-селектор по `sport_key`, а backend принимает `PATCH /api/admin/sports/<path:sport_key>`.
- Удаление ручного соревнования теперь также доступно через `DELETE /api/admin/sports/<path:sport_key>`; старый endpoint `/api/admin/manual-sports/<sport_key>` оставлен.
- Форма “Создать алиас вручную” валидирует вид спорта: существующую футбольную команду нельзя привязать к хоккейному турниру и наоборот. Для новой команды frontend просит только название и logo URL плюс обязательное raw-название из API.
- При выборе коэффициента frontend сохраняет текущий scroll position после перерендера линии, поэтому экран не должен прыгать наверх.
- На старте Mini App спорт-кнопки не рендерятся с промежуточными счётчиками до загрузки реальной линии; `/api/sports` теперь считает только события, у которых есть доступные odds rows.
- `lib/events.cleanup_expired_line_events()` вызывается перед `/api/events` и `/api/sports`: прошедшие upcoming-события без ставок удаляются вместе с odds, а события со ставками переводятся в `status='closed'`, чтобы они исчезли из линии и не принимали новые ставки.
- Поле суммы в купоне визуально увеличено, быстрые кнопки суммы продолжают считаться от баланса по 10/20/50/100%, включая кнопку на весь доступный баланс.

## Обновление 2026-05-07: cascade FK и купон

- Добавлена migration `supabase/migrations/20260507_cascade_delete_and_sport_logos.sql`: `sports.logo_url`, `teams.logo_url`, `events.result_note`, `events.sport_key on delete cascade`, `events.home_team_id/away_team_id on delete set null`, `bet_selections.event_id on delete set null`, admin/sync/settlement user refs `on delete set null`.
- `supabase/schema.sql` синхронизирован с этими FK-правилами для новых БД.
- Удаление ручного соревнования в коде теперь после refund settlement отвязывает `bet_selections.event_id` и удаляет само событие, чтобы `sports` не блокировался FK даже до применения cascade migration.
- В основной линии для матчей с двумя исходами добавлен класс `market-row two`, чтобы два коэффициента занимали ширину ровно и центрировались.
- Выбор главного рынка теперь пробует `h2h`, затем `h2h_3_way`, затем запасные рынки; это помогает матчам, где Odds API отдаёт обычный исход под `h2h_3_way`.
- Sync при включённом `ODDS_SYNC_BOOKMAKER_KEYS` теперь добавляет до двух fallback-букмекеров с `h2h/h2h_3_way`, если выбранные букмекеры по конкретному событию не дали обычный исход. Это должно уменьшить случаи, когда в линии у футбольного матча видны только тоталы/форы.
- Поле суммы в купоне снова выровнено влево и уменьшено.
- Success-анимация ставки стала спокойнее: зелёный приглушён, галочка анимируется мягче, confetti длится дольше и окно закрывается примерно вместе с окончанием confetti.
- Cache-busting query обновлён до `20260507-cascade-ticket-markets`.

## Обновление 2026-05-08: лига, награды и удаление

- Добавлен backend-модуль `lib/league.py`: считает общий выигрыш игрока по `wallet_transactions.type='bet_win'`, определяет звание, отдаёт прогресс лиги, награды, доступные колёса и рейтинг.
- Добавлены endpoints `GET /api/league`, `POST /api/league/rewards/<threshold>/claim`, `POST /api/league/wheel-spins/<spin_id>/spin`.
- `users.client_status` теперь используется как игровое звание (`Новичок`, `Игрок`, `Аналитик`, `Рисковый`, `Профи`, `Акула`, `Магнат`, `Легенда`, `Босс`), а не как вручную редактируемый админский статус.
- В админке пользователей поле статуса стало read-only званием; ручное редактирование статуса отключено.
- Удаление пользователя теперь перед физическим delete явно чистит его ставки, selections, wallet transactions, кошелёк и новые league/wheel таблицы; если БД всё равно блокирует FK, остаётся fallback tombstone.
- Удаление ставки теперь отвязывает `wallet_transactions.related_bet_id`, удаляет `bet_selections`, затем удаляет `bets`. Pending-ставка перед удалением возвращает сумму.
- Удаление ручного события со связанными ставками теперь после refund settlement отвязывает `bet_selections.event_id` и физически удаляет событие, чтобы ручные соревнования можно было удалить полностью.
- Добавлена миграция `supabase/migrations/20260508_league_and_delete_cleanup.sql`: таблицы `user_league_rewards`, `fortune_wheel_spins`, default `users.client_status='Новичок'`, FK `wallet_transactions.related_bet_id -> bets(id) on delete set null`, повторное закрепление cascade/set-null FK для удаления событий.
- Frontend получил новую нижнюю вкладку `Лига` с прогрессом, вертикальной шкалой наград, кнопками получения награды, доступными колёсами и рейтингом.
- Профиль стал игровой карточкой: баланс, звание/лига, общий выигрыш, прогресс до следующего звания, крупнейший выигрыш/проигрыш, количество прокруток и место в рейтинге.
- Проверки текущей правки: `node --check .\static\app.js`, `.\.venv\Scripts\python.exe -m py_compile .\app.py .\lib\league.py .\lib\admin_users.py .\lib\bets.py .\lib\users.py`.

## Обновление 2026-05-08: прибыль, ежедневные награды и рейтинг

- Логика лиги переведена с общей выплаты на чистую прибыль по выигранным ставкам: `profit = payout - amount`. В старом поле frontend `total_win` временно остаётся тот же показатель для совместимости, но новый смысловой ключ — `total_profit`.
- Шкала рангов заменена на: `Железо`, `Бронза`, `Серебро`, `Золото`, `Платина`, `Изумруд`, `Сапфир`, `Рубин`, `Алмаз` с порогами 0 / 2500 / 7500 / 15000 / 30000 / 50000 / 80000 / 125000 / 200000 чистой прибыли.
- Аватарки рангов теперь берутся напрямую из Supabase Storage bucket по шаблону `.../ranks/rank_1.png` ... `rank_9.png`; таблица `league_rank_aliases` больше не используется.
- Добавлена таблица `daily_login_rewards` и endpoint `POST /api/league/daily-reward/claim`. Награды за серию входов: 100, 150, 200, 250, 300, 350, 500 звёзд. Если день пропущен, серия сбрасывается.
- Вкладка `Лига` теперь показывает ежедневную награду, прогресс с отметками `0 ✦` и ближайшим порогом следующего ранга, описание расчёта прогресса и более понятные карточки наград.
- Рейтинг вынесен в отдельную нижнюю вкладку `Рейтинг`; туда попадают все пользователи, включая игроков с 0 чистой прибыли.
- Получение наград и ежедневного бонуса показывает усиленное confetti и Telegram haptic feedback. Колесо фортуны открывает отдельную анимацию прокрутки с видимыми номиналами, вибрацией и confetti после приза.
- Профиль убран от повторяющегося блока баланса и username; рядом с суммой теперь текст `Текущий баланс`.
- SQL для существующей Supabase остаётся в `supabase/migrations/20260508_league_and_delete_cleanup.sql`, он дополнен `daily_login_rewards`; для удаления старой таблицы алиасов рангов добавлена `supabase/migrations/20260508_drop_rank_aliases.sql`.

## Обновление 2026-05-08: polish лиги и рейтинга

- В рейтинге убран текст про игроков с нулевой прибылью; логика отображения всех игроков сохранена.
- Правая отметка шкалы прогресса теперь показывает ближайший порог следующего ранга, а не максимальные `200 000 ✦`.
- Ежедневные награды визуально сжаты, чтобы вкладка `Лига` не уходила за правую границу телефона.
- В `Шкале прогресса` у рангов показывается крупный круглый аватар ранга слева.
- В профиле убран блок `Колесо`.

## Обновление 2026-05-08: колесо и компактная лига

- Ежедневная награда перестроена в две строки с последовательной линией прогресса; пройденные дни и линия становятся зелёными.
- Награды между рангами сгруппированы под ближайшим рангом в collapsible-блоки `<details>`, чтобы шкала не была слишком длинной.
- У обычных полученных промежуточных наград зелёный кружок уменьшен; у рангов сохранён крупный круглый логотип слева.
- Список доступных колёс сгруппирован по типу и показывает количество доступных прокруток; для админа backend добавляет неограниченные виртуальные колёса всех типов.
- Колесо фортуны теперь открывается сначала как экран с видимыми наградами и кнопкой `Крутить`; backend выбирает приз по весам, frontend докручивает колесо к этому номиналу и затем показывает результат.
- Таблица `league_rank_aliases` удаляется отдельной миграцией, потому что логотипы рангов теперь берутся из публичного bucket.
- Проверки текущей правки: `node --check .\static\app.js`, `.\.venv\Scripts\python.exe -m py_compile ...`, `git diff --check`, Flask smoke `/` и `/health`.

## Обновление 2026-05-08: колесо, рейтинги и карточки ставок

- В окне колеса убраны проценты вероятностей: сектора остаются визуально равными, но backend по-прежнему выбирает приз weighted random из `lib/league.py`.
- Перед запуском колеса показывается крестик закрытия; после нажатия `Крутить` закрытие блокируется, чтобы не прервать уже начатую выдачу.
- Подписи призов на колесе теперь повернуты вместе с окружностью, а финальный поворот фиксируется на реально выпавшем backend-призе без резкого сброса после остановки.
- Шкала прогресса раскрывает награды интервалами между рангами: например, у `Серебро` показывается блок `От Бронза до Серебро`.
- `/api/league` теперь дополнительно отдаёт `leaderboards.overall`, `leaderboards.losers`, `leaderboards.lucky`; frontend показывает переключатели `Общий рейтинг`, `Рейтинг лохов`, `Рейтинг фарта`.
- В профиле добавлен показатель `Крупнейший кэф` по выигранным ставкам.
- В карточках ставок во вкладках `Мои пари` и `История` у каждого события сверху показывается дата и время начала события.
- Cache-busting query для `static/styles.css` и `static/app.js` обновлён до `20260508-wheel-rating-bets`.

## Обновление 2026-05-08: polish уровня и колеса

- В видимых текстах лиги/профиля/админки терминология заменена с `ранг` на `уровень`; в профиле убран отдельный повторяющийся блок `Лига`.
- Окно колеса получило крестик закрытия в правом верхнем углу самой карточки; крестик доступен только до запуска вращения.
- Haptic feedback у колеса перенесён на фазу реального вращения, а не на момент нажатия кнопки.
- Список доступных колёс теперь показывает цветные круглые маркеры без букв.
- Подписи призов на колесе выровнены по центрам равных секторов с учётом `conic-gradient(from -18deg)`.
- У ежедневной награды кнопка получения опущена ниже, а у основных экранов увеличен верхний отступ от панели.
- В рейтинге переключатель режимов перенесён выше заголовка и описания.
- Cache-busting query для `static/styles.css` и `static/app.js` обновлён до `20260508-wheel-level-polish`.
