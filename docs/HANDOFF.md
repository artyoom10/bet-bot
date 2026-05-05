# Handoff

## Текущая цель

Доработать Telegram Mini App демо-букмекерки: улучшить линию, историю ставок, админский debug синхронизации и сохранить проектный контекст для следующих сессий Codex.

## Текущий статус

- Проект работает как Flask backend на Vercel Python runtime.
- Frontend находится в `templates/index.html`, `static/app.js`, `static/styles.css`.
- Хранилище данных: Supabase через REST client на service role key.
- Telegram Mini App auth использует `initData`.
- The Odds API используется для prematch-коэффициентов, подробных рынков события и результатов.
- В текущей итерации исправляются UI истории, группировка линии по виду спорта и подробный debug sync timeout.

## Изменённые файлы

- `lib/events.py`: исправлен подсчёт событий для `/api/sports`.
- `lib/bets.py`: история ставок обогащается текущими данными события, счётом и логотипами команд.
- `static/app.js`: обновляется UI линии, истории ставок, refresh баланса, sync debug.
- `static/styles.css`: обновляются стили баланса, sport chips, league blocks и bet cards.
- `templates/index.html`: добавляется кнопка обновления баланса в верхнюю плашку.
- `AGENTS.md`: постоянные инструкции для Codex.
- `docs/HANDOFF.md`: текущий handoff.
- `docs/ARCHITECTURE.md`: описание архитектуры.

## Важные решения

- Линия сначала фильтруется по виду спорта: все, футбол, хоккей, киберспорт.
- Турниры внутри выбранного спорта отображаются сворачиваемыми блоками.
- История ставок не дублирует общий статус рядом с типом ставки; результат показывается справа как выплата/проигрыш/возврат.
- Кэф в карточке истории показывается числом без слова `Кэф` под суммой справа.
- Подробный debug синхронизации должен появляться даже при timeout или HTML-ошибке от Vercel.
- Для долгого sync фронт снова запускает синхронизацию по одному sport key, но останавливается при первой ошибке, чтобы не плодить `sync_already_running`.

## Выполненные команды

- `Get-ChildItem -Force`
- `Get-ChildItem -Recurse -File -Depth 2`
- `git status --short`
- Чтение `README.md`, `requirements.txt`, `vercel.json`, `.env.example`.
- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py`
- `git diff --check`
- Flask smoke test через `app.test_client()` для `/`, `/health`, `/api/sports`.

## Статус тестов

Пройдено:

- `node --check static/app.js`
- `py -m py_compile app.py lib/events.py lib/bets.py lib/odds_api.py lib/odds_sync.py`
- `git diff --check`
- Flask smoke test: `/`, `/health`, `/api/sports` вернули `200`.

## Следующие шаги

- Проверить, что frontend не ломается после новой группировки линии.
- Проверить, что `/api/sports` больше не возвращает нули при наличии событий с odds.
- Проверить, что при timeout sync в админке появляется блок `Подробный debug ответа`.
- Сделать commit и push в `main`.

## Риски и открытые вопросы

- Vercel Python Functions могут завершать долгий sync раньше, чем frontend дождётся ответа. Нужна более надёжная очередь/background job, если объём лиг вырастет.
- Supabase REST операции по ставкам и settlement не являются полноценными транзакциями. Есть риск гонок при параллельных расчётах.
- The Odds API `/scores` покрывает лиги не одинаково; ручной расчёт остаётся обязательным fallback.
- TODO: проверить реальный ответ The Odds API для detailed event markets на production ключе.
