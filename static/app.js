const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  me: null,
  sports: [],
  activeSport: '',
  events: [],
  adminEvents: [],
  bets: [],
  users: [],
  aliases: null,
  teamAliasRows: [],
  selections: [],
  ticketExpanded: false,
  stake: 100,
};

const labels = { home_win: 'П1', draw: 'X', away_win: 'П2' };
const statusLabels = { pending: 'ожидает', won: 'выиграла', lost: 'проиграла', refund: 'возврат', cancelled: 'отменена' };
const defaultSportKeys = ['soccer_russia_premier_league', 'soccer_spain_la_liga', 'soccer_uefa_champs_league'];
const adminTitles = {
  menu: 'Админка',
  sync: 'Синхронизация линии',
  'api-usage': 'Статистика API',
  users: 'Пользователи',
  aliases: 'Алиасы и команды',
  results: 'Расчёт ставок',
};

function money(value) {
  return `DEMO ${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
}

function status(message) {
  const root = document.querySelector('#status');
  root.textContent = message || '';
  root.hidden = !message;
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg?.initData || '',
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    const error = new Error(`HTTP ${response.status}: сервер вернул не JSON: ${text.slice(0, 1200)}`);
    error.responseText = text;
    error.status = response.status;
    throw error;
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function init() {
  await loadMe().catch((error) => status(`Профиль не загружен: ${error.message}`));
  await loadSports().catch((error) => status(`Турниры не загружены: ${error.message}`));
  await loadEvents().catch((error) => status(`Линия не загружена: ${error.message}`));
  handleHash();
}

async function loadMe() {
  const data = await apiFetch('/api/me');
  state.me = data;
  document.querySelector('#profile-name').textContent = resolveProfileName(data);
  document.querySelector('#balance-value').textContent = money(data.wallet.balance);
  document.querySelectorAll('.admin-only').forEach((item) => {
    item.hidden = !data.user.is_admin;
  });
  status('');
}

function resolveProfileName(data) {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const dbName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ');
  const tgName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ');
  return dbName || tgName || data.user.username || tgUser?.username || 'Игрок';
}

async function loadSports() {
  state.sports = await apiFetch('/api/sports');
  renderSports();
}

function renderSports() {
  const root = document.querySelector('#sports');
  const total = state.sports.reduce((sum, sport) => sum + Number(sport.events_count || 0), 0);
  const items = [{ sport_key: '', title: 'Все', events_count: total }, ...state.sports];
  root.innerHTML = items.map((sport) => `
    <button class="sport-chip ${state.activeSport === sport.sport_key ? 'active' : ''}" data-sport="${sport.sport_key}">
      <span>${escapeHtml(sport.title)}</span><strong>${sport.events_count}</strong>
    </button>
  `).join('');
  document.querySelectorAll('[data-sport]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.activeSport = button.dataset.sport;
      renderSports();
      await loadEvents();
    });
  });
}

async function loadEvents() {
  const query = state.activeSport ? `?sport_key=${encodeURIComponent(state.activeSport)}` : '';
  state.events = await apiFetch(`/api/events${query}`);
  renderEvents();
  renderManualEventOptions();
}

function renderEvents() {
  const root = document.querySelector('#events');
  if (!state.events.length) {
    const league = state.activeSport ? state.sports.find((sport) => sport.sport_key === state.activeSport)?.title || state.activeSport : 'выбранных турниров';
    root.innerHTML = `<article class="empty-state">Нет prematch-событий для ${escapeHtml(league)}. Для Лиги чемпионов это обычно значит, что Odds API не вернул ближайшие матчи с коэффициентами.</article>`;
    return;
  }
  const groups = groupBy(state.events, (event) => event.league_title);
  root.innerHTML = Object.entries(groups).map(([league, events]) => `
    <section class="league-block">
      <div class="league-head"><strong>${escapeHtml(league)}</strong><span>${events.length}</span></div>
      ${events.map(renderEvent).join('')}
    </section>
  `).join('');
  document.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => toggleSelection(button));
  });
}

function renderEvent(event) {
  return `
    <article class="event-row">
      <div class="event-info">
        <time>${formatDate(event.commence_time)}</time>
        ${teamLine(event.home_team)}
        ${teamLine(event.away_team)}
        <span>${escapeHtml(event.odds.bookmaker_title)}</span>
      </div>
      <div class="market-row">
        ${event.odds.outcomes.map((outcome) => {
          const active = state.selections.some((item) => item.event.id === event.id && item.outcome.selection_key === outcome.selection_key);
          return `
            <button class="odd-cell ${active ? 'active' : ''}" data-event="${event.id}" data-bookmaker="${event.odds.bookmaker_key}" data-market="${event.odds.market_key}" data-selection="${outcome.selection_key}">
              <span>${labels[outcome.selection_key] || outcome.label}</span><strong>${Number(outcome.price).toFixed(2)}</strong>
            </button>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

function teamLine(team) {
  return `
    <strong class="team-name">
      ${teamLogo(team)}
      <span>${escapeHtml(team.name)}</span>
    </strong>
  `;
}

function teamLogo(team) {
  if (!team?.logo_url) return `<span class="team-logo placeholder">${escapeHtml((team?.name || 'Ф')[0])}</span>`;
  return `<img class="team-logo" src="${escapeAttr(team.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'team-logo placeholder', textContent: '⚽'}))">`;
}

function toggleSelection(button) {
  const event = state.events.find((item) => item.id === button.dataset.event);
  const outcome = event.odds.outcomes.find((item) => item.selection_key === button.dataset.selection);
  const same = state.selections.some((item) => item.event.id === event.id && item.outcome.selection_key === outcome.selection_key);
  if (same) {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
  } else {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
    state.selections.push({ event, outcome, bookmaker_key: button.dataset.bookmaker, market_key: button.dataset.market });
  }
  renderEvents();
  renderTicket();
}

function totalOdds() {
  return state.selections.reduce((acc, item) => acc * Number(item.outcome.price), 1);
}

function renderTicket() {
  const slip = document.querySelector('#bet-slip');
  if (!state.selections.length) {
    slip.hidden = true;
    state.ticketExpanded = false;
    return;
  }
  slip.hidden = false;
  const odds = totalOdds();
  const type = state.selections.length === 1 ? 'Ординар' : 'Экспресс';
  document.querySelector('#toggle-ticket').textContent = `${state.selections.length} пари · ${type} ${odds.toFixed(2)}`;
  document.querySelector('#ticket-form').hidden = !state.ticketExpanded;
  document.querySelector('#ticket-type').textContent = type;
  document.querySelector('#ticket-odds').textContent = odds.toFixed(2);
  document.querySelector('#ticket-win').textContent = money(state.stake * odds);
  document.querySelector('#ticket-list').innerHTML = state.selections.map((item, index) => `
    <article class="ticket-item">
      <div>
        <strong>${escapeHtml(item.event.home_team.name)} — ${escapeHtml(item.event.away_team.name)}</strong>
        <p>${teamLogo(item.outcome.selection_key === 'away_win' ? item.event.away_team : item.event.home_team)} ${escapeHtml(item.outcome.name)}</p>
      </div>
      <strong>${Number(item.outcome.price).toFixed(2)}</strong>
      <button type="button" data-remove-selection="${index}">×</button>
    </article>
  `).join('');
  document.querySelectorAll('[data-remove-selection]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selections.splice(Number(button.dataset.removeSelection), 1);
      renderEvents();
      renderTicket();
    });
  });
}

function clearTicket() {
  state.selections = [];
  renderEvents();
  renderTicket();
}

async function submitBet() {
  if (!state.selections.length) return;
  const result = await apiFetch('/api/bets', {
    method: 'POST',
    body: JSON.stringify({
      amount: state.stake,
      selections: state.selections.map((item) => ({
        event_id: item.event.id,
        bookmaker_key: item.bookmaker_key,
        market_key: item.market_key,
        selection_key: item.outcome.selection_key,
      })),
    }),
  });
  document.querySelector('#balance-value').textContent = money(result.wallet.balance);
  status('Ставка принята');
  tg?.HapticFeedback?.notificationOccurred('success');
  clearTicket();
  await loadBets();
}

async function loadBets() {
  state.bets = await apiFetch('/api/bets');
  renderBets();
}

function renderBets() {
  const root = document.querySelector('#bets');
  if (!state.bets.length) {
    root.innerHTML = '<article class="empty-state">У вас пока нет ставок.</article>';
    return;
  }
  root.innerHTML = state.bets.map((bet) => `
    <article class="bet-row">
      <div>
        <strong>${bet.bet_type === 'express' ? `Экспресс · ${bet.selections.length} событий` : 'Ординар'} · ${statusLabels[bet.status] || bet.status}</strong>
        <p>Кэф ${Number(bet.total_odds).toFixed(2)} · Сумма ${money(bet.amount)}${bet.payout !== null ? ` · Выплата ${money(bet.payout)}` : ''}</p>
        <div class="selection-list">${bet.selections.map((selection) => `
          <span>${escapeHtml(selection.event_name_ru)} · ${escapeHtml(selection.selection_name_ru || selection.selection_name_raw)} · ${Number(selection.price).toFixed(2)} · ${statusLabels[selection.result_status] || selection.result_status}</span>
        `).join('')}</div>
      </div>
      <strong>${money(bet.possible_win)}</strong>
    </article>
  `).join('');
}

async function loadAdmin() {
  const [dashboard, runs] = await Promise.all([apiFetch('/api/admin/dashboard'), apiFetch('/api/admin/sync-runs')]);
  renderDashboard(dashboard);
  renderSyncRuns(runs);
  renderApiUsage(dashboard.odds_api_usage);
}

function renderDashboard(data) {
  const sync = data.last_sync || {};
  document.querySelector('#admin-dashboard').innerHTML = `
    <div class="stat"><span>Статус</span><strong>${sync.status || 'нет'}</strong></div>
    <div class="stat"><span>Событий</span><strong>${sync.events_count || 0}</strong></div>
    <div class="stat"><span>Коэффициентов</span><strong>${sync.odds_count || 0}</strong></div>
    <div class="stat"><span>Букмекеров</span><strong>${sync.bookmakers_count || 0}</strong></div>
    <div class="stat"><span>Credits потрачено</span><strong>${sync.quota_last ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Credits осталось</span><strong>${sync.quota_remaining ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Завершено</span><strong>${formatDate(sync.finished_at)}</strong></div>
    ${sync.error_message ? `<div class="stat danger"><span>Ошибка</span><strong>${escapeHtml(sync.error_message)}</strong></div>` : ''}
  `;
}

function renderSyncDebug(payload, selector) {
  const root = document.querySelector(selector);
  if (!root) return;
  root.insertAdjacentHTML('beforeend', `
    <details class="debug-box" open>
      <summary>Подробный debug ответа</summary>
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `);
}

function renderActionError(error, selector) {
  renderSyncDebug({
    message: error.message,
    status: error.status,
    data: error.data || null,
    responseText: error.responseText || null,
  }, selector);
}

function renderApiUsage(usage) {
  document.querySelector('#api-usage').innerHTML = usage ? `
    <div class="stat"><span>Осталось</span><strong>${usage.quota_remaining ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Использовано</span><strong>${usage.quota_used ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Последний запрос</span><strong>${usage.quota_last ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Обновлено</span><strong>${formatDate(usage.created_at)}</strong></div>
  ` : '<p class="muted">Данных пока нет.</p>';
}

function renderSyncRuns(runs) {
  document.querySelector('#sync-runs').innerHTML = runs.length ? runs.map((run) => `
    <div class="sync-row"><strong>${escapeHtml(run.status)}</strong><span>${run.events_count || 0} событий · ${run.odds_count || 0} кэфов · ${formatDate(run.finished_at)}</span></div>
  `).join('') : '<p class="muted">Запусков пока нет.</p>';
}

async function syncOdds() {
  status('Синхронизация линии запущена...');
  const responses = [];
  for (const sportKey of syncSportKeys()) {
    status(`Синхронизация линии: ${sportTitle(sportKey)}`);
    try {
      const result = await apiFetch('/api/admin/sync-odds', {
        method: 'POST',
        body: JSON.stringify({ sport_keys: [sportKey] }),
      });
      responses.push({ sport_key: sportKey, ok: true, result });
    } catch (error) {
      responses.push({ sport_key: sportKey, ok: false, message: error.message, data: error.data || null, responseText: error.responseText || null });
    }
  }
  const failed = responses.filter((item) => !item.ok);
  const eventsCount = responses.reduce((sum, item) => sum + Number(item.result?.sync?.events_count || 0), 0);
  const oddsCount = responses.reduce((sum, item) => sum + Number(item.result?.sync?.odds_count || 0), 0);
  status(failed.length ? `Sync завершён с ошибками: ${failed.length}. Событий: ${eventsCount}, кэфов: ${oddsCount}` : `Sync завершён. Событий: ${eventsCount}, кэфов: ${oddsCount}`);
  await loadSports().catch(() => {});
  await loadEvents().catch(() => {});
  await loadAdmin().catch(() => {});
  renderSyncDebug({ kind: 'sync_odds_by_sport', responses }, '#admin-dashboard');
}

async function refreshUsage() {
  const result = await apiFetch('/api/admin/refresh-odds-usage', { method: 'POST', body: JSON.stringify({}) });
  renderApiUsage(result.usage);
  status(`Odds API credits: ${result.usage.quota_remaining ?? 'нет данных'}`);
}

async function loadUsers() {
  state.users = await apiFetch('/api/admin/users');
  renderUsers();
}

function renderUsers() {
  const root = document.querySelector('#admin-users');
  if (!state.users.length) {
    root.innerHTML = '<article class="empty-state">Пользователей пока нет.</article>';
    return;
  }
  root.innerHTML = state.users.map(({ user, wallet }) => `
    <article class="admin-card">
      <div class="card-head"><strong>${escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Без имени')}</strong><span>${escapeHtml(user.tg_id)}</span></div>
      <div class="form-grid">
        <label>Telegram ID <input data-user-tg="${user.id}" value="${escapeAttr(user.tg_id || '')}" autocomplete="off"></label>
        <label>Username <input data-user-username="${user.id}" value="${escapeAttr(user.username || '')}" autocomplete="off"></label>
        <label>Имя <input data-user-first="${user.id}" value="${escapeAttr(user.first_name || '')}" autocomplete="off"></label>
        <label>Фамилия <input data-user-last="${user.id}" value="${escapeAttr(user.last_name || '')}" autocomplete="off"></label>
        <label>Статус <select data-user-status="${user.id}">${['new', 'active', 'vip', 'test', 'restricted', 'suspended'].map((item) => `<option value="${item}" ${item === user.client_status ? 'selected' : ''}>${item}</option>`).join('')}</select></label>
        <label>Баланс <input data-user-balance="${user.id}" type="number" min="0" step="10" value="${Number(wallet?.balance || 0)}"></label>
        <label class="checkbox-row"><input data-user-blocked="${user.id}" type="checkbox" ${user.is_blocked ? 'checked' : ''}> Заблокирован</label>
        <button class="primary" data-save-user="${user.id}">Сохранить</button>
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-save-user]').forEach((button) => button.addEventListener('click', () => saveUser(button.dataset.saveUser)));
}

async function saveUser(userId) {
  await apiFetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tg_id: document.querySelector(`[data-user-tg="${userId}"]`).value,
      username: document.querySelector(`[data-user-username="${userId}"]`).value,
      first_name: document.querySelector(`[data-user-first="${userId}"]`).value,
      last_name: document.querySelector(`[data-user-last="${userId}"]`).value,
      client_status: document.querySelector(`[data-user-status="${userId}"]`).value,
      balance: Number(document.querySelector(`[data-user-balance="${userId}"]`).value),
      is_blocked: document.querySelector(`[data-user-blocked="${userId}"]`).checked,
    }),
  });
  status('Пользователь обновлен');
  await loadUsers();
}

async function createUser(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await apiFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      tg_id: formData.get('tg_id'),
      username: formData.get('username'),
      first_name: formData.get('first_name'),
      last_name: formData.get('last_name'),
      balance: Number(formData.get('balance')),
    }),
  });
  closeCreateUserModal();
  status('Пользователь создан');
  await loadUsers();
}

async function loadAliases() {
  state.aliases = await apiFetch('/api/admin/aliases');
  renderAliases();
}

function renderAliases() {
  renderUnknownAliases(state.aliases.unknown_teams || []);
  renderSportAliases(state.aliases.sports || []);
  renderTeamAliases(state.aliases.teams || []);
}

function renderUnknownAliases(unknown) {
  const root = document.querySelector('#unknown-aliases');
  const indexed = unknown.map((item, index) => ({ ...item, index }));
  const groups = groupBy(indexed, (item) => item.sport_key || 'Без турнира');
  root.innerHTML = indexed.length ? Object.entries(groups).map(([sportKey, items]) => `
    <section class="alias-group">
      <h3>${escapeHtml(sportTitle(sportKey))}</h3>
      ${items.map((item) => `
        <article class="admin-card">
          <div class="card-head"><strong>${escapeHtml(item.raw_name)}</strong><span>${escapeHtml(item.sport_key)}</span></div>
          <div class="form-grid">
            <input data-unknown-name="${item.index}" placeholder="Название на русском">
            <input data-unknown-short="${item.index}" placeholder="Короткое название">
            <input data-unknown-logo="${item.index}" placeholder="Logo URL">
            <button class="primary" data-create-alias="${item.index}">Создать алиас</button>
          </div>
        </article>
      `).join('')}
    </section>
  `).join('') : '<p class="muted">Нет пустых команд.</p>';
  document.querySelectorAll('[data-create-alias]').forEach((button) => button.addEventListener('click', () => createAlias(Number(button.dataset.createAlias))));
}

function renderSportAliases(sports) {
  document.querySelector('#sport-aliases').innerHTML = sports.length ? sports.map((sport) => `
    <article class="admin-card">
      <div class="card-head"><strong>${escapeHtml(sport.sport_key)}</strong><span>${sport.is_enabled ? 'active' : 'off'}</span></div>
      <div class="form-grid">
        <input data-sport-title="${sport.sport_key}" value="${escapeAttr(sport.title_ru || '')}" placeholder="Название на русском">
        <button class="primary" data-save-sport="${sport.sport_key}">Сохранить</button>
      </div>
    </article>
  `).join('') : '<p class="muted">Турниры появятся после sync.</p>';
  document.querySelectorAll('[data-save-sport]').forEach((button) => button.addEventListener('click', () => saveSport(button.dataset.saveSport)));
}

function renderTeamAliases(teams) {
  const rows = [];
  teams.forEach(({ team, aliases }) => {
    const list = aliases || [];
    const sportKey = list[0]?.sport_key || 'Без турнира';
    rows.push({ team, aliases: list, sport_key: sportKey });
  });
  state.teamAliasRows = rows;
  const groups = groupBy(rows.map((row, index) => ({ ...row, index })), (row) => row.sport_key);
  document.querySelector('#team-aliases').innerHTML = rows.length ? Object.entries(groups).map(([sportKey, items]) => `
    <section class="alias-group">
      <h3>${escapeHtml(sportTitle(sportKey))}</h3>
      ${items.map(({ team, aliases, index }) => `
        <article class="admin-card">
          <div class="card-head"><strong>${escapeHtml(team.name_en)}</strong><span>${escapeHtml((aliases || []).map((alias) => alias.raw_name).join(', '))}</span></div>
          <div class="form-grid">
            <input data-team-name="${index}" value="${escapeAttr(team.name_ru || '')}" placeholder="Название на русском">
            <input data-team-short="${index}" value="${escapeAttr(team.short_name_ru || '')}" placeholder="Короткое название">
            <input data-team-logo="${index}" value="${escapeAttr(team.logo_url || '')}" placeholder="Logo URL">
            <button class="primary" data-save-team-index="${index}">Сохранить</button>
          </div>
        </article>
      `).join('')}
    </section>
  `).join('') : '<p class="muted">Команды появятся после заполнения алиасов.</p>';
  document.querySelectorAll('[data-save-team-index]').forEach((button) => button.addEventListener('click', () => saveTeam(Number(button.dataset.saveTeamIndex))));
}

async function createAlias(index) {
  const item = state.aliases.unknown_teams[index];
  await apiFetch('/api/admin/team-aliases', {
    method: 'POST',
    body: JSON.stringify({
      raw_name: item.raw_name,
      sport_key: item.sport_key,
      name_ru: document.querySelector(`[data-unknown-name="${index}"]`).value,
      short_name_ru: document.querySelector(`[data-unknown-short="${index}"]`).value,
      logo_url: document.querySelector(`[data-unknown-logo="${index}"]`).value,
    }),
  });
  status('Алиас создан');
  await loadAliases();
  await loadEvents();
}

async function saveSport(sportKey) {
  await apiFetch(`/api/admin/sports/${encodeURIComponent(sportKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title_ru: document.querySelector(`[data-sport-title="${sportKey}"]`).value }),
  });
  status('Турнир обновлен');
  await loadAliases();
  await loadSports();
}

async function saveTeam(index) {
  const row = state.teamAliasRows[index];
  await apiFetch(`/api/admin/teams/${row.team.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name_ru: document.querySelector(`[data-team-name="${index}"]`).value,
      short_name_ru: document.querySelector(`[data-team-short="${index}"]`).value,
      logo_url: document.querySelector(`[data-team-logo="${index}"]`).value,
    }),
  });
  status('Команда обновлена');
  await loadAliases();
  await loadEvents();
}

async function syncResults() {
  status('Обновляю результаты...');
  const responses = [];
  for (const sportKey of syncSportKeys()) {
    status(`Результаты: ${sportTitle(sportKey)}`);
    try {
      const result = await apiFetch('/api/admin/sync-scores-and-settle', {
        method: 'POST',
        body: JSON.stringify({ days_from: 3, sport_keys: [sportKey] }),
      });
      responses.push({ sport_key: sportKey, ok: true, result });
    } catch (error) {
      responses.push({ sport_key: sportKey, ok: false, message: error.message, data: error.data || null, responseText: error.responseText || null });
    }
  }
  const summary = summarizeSettlementResponses(responses);
  renderSettlementReport(summary);
  renderSyncDebug({ kind: 'sync_scores_by_sport', responses }, '#settlement-report');
  const failed = responses.filter((item) => !item.ok);
  status(failed.length ? `Расчёт завершён с ошибками: ${failed.length}` : 'Расчёт результатов завершён');
  await loadSettlementRuns().catch(() => {});
  await loadBets().catch(() => {});
}

function renderSettlementReport(report) {
  const run = report.run || report;
  document.querySelector('#settlement-report').innerHTML = `
    <div class="stat"><span>Статус</span><strong>${run.status || report.status}</strong></div>
    <div class="stat"><span>Проверено событий</span><strong>${run.events_checked ?? report.events_checked ?? 0}</strong></div>
    <div class="stat"><span>Завершено событий</span><strong>${run.events_completed ?? report.events_completed ?? 0}</strong></div>
    <div class="stat"><span>Рассчитано ставок</span><strong>${run.bets_settled ?? report.bets_settled ?? 0}</strong></div>
    <div class="stat"><span>Credits потрачено</span><strong>${run.quota_last ?? report.quota_last ?? 'нет данных'}</strong></div>
    <div class="stat"><span>Credits осталось</span><strong>${run.quota_remaining ?? report.quota_remaining ?? 'нет данных'}</strong></div>
    ${run.error_message ? `<div class="stat danger"><span>Ошибка</span><strong>${escapeHtml(run.error_message)}</strong></div>` : ''}
  `;
}

async function loadSettlementRuns() {
  const runs = await apiFetch('/api/admin/settlement-runs');
  document.querySelector('#settlement-runs').innerHTML = runs.length ? runs.map((run) => `
    <div class="sync-row"><strong>${escapeHtml(run.status)}</strong><span>${run.events_completed || 0} событий · ${run.bets_settled || 0} ставок · ${formatDate(run.finished_at)}</span></div>
  `).join('') : '<p class="muted">Расчётов пока нет.</p>';
}

async function loadAdminEvents() {
  state.adminEvents = await apiFetch('/api/admin/events');
  renderManualEventOptions();
}

function renderManualEventOptions() {
  const select = document.querySelector('#manual-event');
  if (!select) return;
  const events = state.adminEvents.length ? state.adminEvents : state.events.map((event) => ({
    id: event.id,
    home_team_raw: event.home_team.name,
    away_team_raw: event.away_team.name,
    commence_time: event.commence_time,
  }));
  select.innerHTML = events.map((event) => `<option value="${event.id}">${escapeHtml(event.home_team_raw)} — ${escapeHtml(event.away_team_raw)} · ${formatDate(event.commence_time)}</option>`).join('');
}

async function manualSettle() {
  const eventId = document.querySelector('#manual-event').value;
  const home = Number(document.querySelector('#manual-home-score').value);
  const away = Number(document.querySelector('#manual-away-score').value);
  const result = await apiFetch(`/api/admin/events/${eventId}/manual-result`, {
    method: 'POST',
    body: JSON.stringify({ home_score: home, away_score: away }),
  });
  status(`Рассчитано ставок: ${result.result.bets_settled}`);
  await loadSettlementRuns();
}

function openAdminDrawer(route = 'menu') {
  if (!state.me?.user?.is_admin) return;
  document.querySelector('#admin-drawer').classList.add('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('#admin-backdrop').hidden = false;
  navigateAdmin(route);
}

function closeAdminDrawer() {
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'true');
  document.querySelector('#admin-backdrop').hidden = true;
  if (location.hash.startsWith('#/admin')) history.replaceState(null, '', location.pathname + location.search);
}

function navigateAdmin(route = 'menu') {
  if (!state.me?.user?.is_admin) return;
  document.querySelectorAll('.admin-page').forEach((page) => page.classList.remove('active'));
  document.querySelector(`#admin-page-${route}`).classList.add('active');
  document.querySelector('#admin-title').textContent = adminTitles[route] || 'Админка';
  if (location.hash !== `#/admin${route === 'menu' ? '' : `/${route}`}`) {
    history.replaceState(null, '', `#/admin${route === 'menu' ? '' : `/${route}`}`);
  }
  if (route === 'sync') loadAdmin().catch((error) => status(error.message));
  if (route === 'api-usage') loadAdmin().catch((error) => status(error.message));
  if (route === 'users') loadUsers().catch((error) => status(error.message));
  if (route === 'aliases') loadAliases().catch((error) => status(error.message));
  if (route === 'results') {
    loadSettlementRuns().catch((error) => status(error.message));
    loadAdminEvents().catch((error) => status(error.message));
  }
}

function handleHash() {
  if (!location.hash.startsWith('#/admin')) return;
  if (!state.me?.user?.is_admin) {
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  const route = location.hash.split('/')[2] || 'menu';
  openAdminDrawer(route);
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#view-${tab}`).classList.add('active');
  if (tab === 'bets') loadBets().catch((error) => status(error.message));
}

function openCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = false;
}

function closeCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = true;
  document.querySelector('#create-user-form').reset();
}

function setupSwipe() {
  let startX = 0;
  let startY = 0;
  document.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dy) > 80) return;
    if (startX > window.innerWidth - 48 && dx < -60 && state.me?.user?.is_admin) openAdminDrawer('menu');
    if (document.querySelector('#admin-drawer').classList.contains('open') && dx > 70) closeAdminDrawer();
  }, { passive: true });
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function sportTitle(sportKey) {
  const sport = [...(state.aliases?.sports || []), ...(state.sports || [])].find((item) => item.sport_key === sportKey);
  return sport?.title_ru || sport?.title || sport?.title_en || sportKey;
}

function syncSportKeys() {
  const keys = state.sports.map((sport) => sport.sport_key).filter(Boolean);
  return keys.length ? keys : defaultSportKeys;
}

function summarizeSettlementResponses(responses) {
  const settlements = responses.map((item) => item.result?.settlement).filter(Boolean);
  const failed = responses.filter((item) => !item.ok);
  const lastSettlement = settlements[settlements.length - 1];
  return {
    status: failed.length ? (settlements.length ? 'partial_success' : 'error') : 'success',
    events_checked: settlements.reduce((sum, item) => sum + Number(item.events_checked || item.run?.events_checked || 0), 0),
    events_completed: settlements.reduce((sum, item) => sum + Number(item.events_completed || item.run?.events_completed || 0), 0),
    bets_settled: settlements.reduce((sum, item) => sum + Number(item.bets_settled || item.run?.bets_settled || 0), 0),
    quota_last: settlements.reduce((sum, item) => sum + Number(item.quota_last || item.run?.quota_last || 0), 0),
    quota_remaining: lastSettlement?.quota_remaining ?? lastSettlement?.run?.quota_remaining ?? 'нет данных',
    error_message: failed.map((item) => `${sportTitle(item.sport_key)}: ${item.message}`).join('; '),
    responses,
  };
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelector('#toggle-ticket').addEventListener('click', () => {
  state.ticketExpanded = !state.ticketExpanded;
  renderTicket();
});
document.querySelector('#clear-ticket').addEventListener('click', clearTicket);
document.querySelector('#stake').addEventListener('input', (event) => {
  state.stake = Number(event.target.value);
  renderTicket();
});
document.querySelector('#place-bet').addEventListener('click', () => submitBet().catch((error) => status(error.message)));
document.querySelector('#open-admin').addEventListener('click', () => openAdminDrawer('menu'));
document.querySelector('#close-admin').addEventListener('click', closeAdminDrawer);
document.querySelector('#admin-backdrop').addEventListener('click', closeAdminDrawer);
document.querySelectorAll('[data-admin-link]').forEach((button) => button.addEventListener('click', () => navigateAdmin(button.dataset.adminLink)));
document.querySelectorAll('[data-admin-back]').forEach((button) => button.addEventListener('click', () => navigateAdmin('menu')));
document.querySelector('#sync-odds').addEventListener('click', () => syncOdds().catch((error) => {
  status(error.message);
  renderActionError(error, '#admin-dashboard');
}));
document.querySelector('#refresh-usage').addEventListener('click', () => refreshUsage().catch((error) => status(error.message)));
document.querySelector('#reload-aliases').addEventListener('click', () => loadAliases().catch((error) => status(error.message)));
document.querySelector('#sync-results').addEventListener('click', () => syncResults().catch((error) => {
  status(error.message);
  renderActionError(error, '#settlement-report');
}));
document.querySelector('#manual-settle').addEventListener('click', () => manualSettle().catch((error) => status(error.message)));
document.querySelector('#open-create-user').addEventListener('click', openCreateUserModal);
document.querySelector('#close-create-user').addEventListener('click', closeCreateUserModal);
document.querySelector('#create-user-form').addEventListener('submit', (event) => createUser(event).catch((error) => status(error.message)));
window.addEventListener('hashchange', handleHash);

setupSwipe();
init();
