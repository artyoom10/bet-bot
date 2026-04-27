const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  me: null,
  sports: [],
  activeSport: '',
  events: [],
  bets: [],
  users: [],
  aliases: null,
  selected: null,
  stake: 100,
};

const labels = {
  home_win: 'П1',
  draw: 'X',
  away_win: 'П2',
};

function money(value) {
  return `DEMO ${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
}

function status(message) {
  document.querySelector('#status').textContent = message;
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg?.initData || '',
    ...(options.headers || {}),
  };

  const response = await fetch(path, { ...options, headers });
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function init() {
  try {
    await loadMe();
  } catch (error) {
    status(`Профиль не загружен: ${error.message}`);
  }

  try {
    await loadSports();
    await loadEvents();
  } catch (error) {
    status(`Линия не загружена: ${error.message}`);
  }
}

async function loadMe() {
  const data = await apiFetch('/api/me');
  state.me = data;
  document.querySelector('#profile-name').textContent = data.user.first_name || data.user.username || 'Telegram user';
  document.querySelector('#balance-value').textContent = money(data.wallet.balance);
  document.querySelectorAll('.admin-only').forEach((item) => {
    item.hidden = !data.user.is_admin;
  });
  renderAdminDebug(data.admin_debug);
  status(data.user.is_admin ? 'Admin mode: on' : 'Admin mode: off');
}

function renderAdminDebug(debug) {
  const root = document.querySelector('#admin-debug');
  if (!root || !debug) return;

  root.hidden = false;
  root.innerHTML = `
    <div class="debug-row"><span>Мой tg_id</span><strong>${escapeHtml(debug.tg_id)}</strong></div>
    <div class="debug-row"><span>Админов в env</span><strong>${debug.admin_ids_configured}</strong></div>
    <div class="debug-row"><span>Совпал с ADMIN_TELEGRAM_IDS</span><strong>${debug.matched_admin_env ? 'да' : 'нет'}</strong></div>
    <div class="debug-row"><span>Админ итог</span><strong>${debug.is_admin_final ? 'да' : 'нет'}</strong></div>
  `;
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
      <span>${escapeHtml(sport.title)}</span>
      <strong>${sport.events_count}</strong>
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
}

async function loadBets() {
  state.bets = await apiFetch('/api/bets');
  renderBets();
}

function renderEvents() {
  const root = document.querySelector('#events');
  if (!state.events.length) {
    const league = state.activeSport
      ? state.sports.find((sport) => sport.sport_key === state.activeSport)?.title || state.activeSport
      : 'выбранных турниров';
    root.innerHTML = `<article class="empty-state">Нет активных событий для ${escapeHtml(league)}. Если это Лига чемпионов, Odds API мог не вернуть ближайшие prematch-матчи с коэффициентами.</article>`;
    return;
  }

  const groups = groupBy(state.events, (event) => event.league_title);
  root.innerHTML = Object.entries(groups).map(([league, events]) => `
    <section class="league-block">
      <div class="league-head">
        <strong>${escapeHtml(league)}</strong>
        <span>${events.length}</span>
      </div>
      ${events.map(renderEvent).join('')}
    </section>
  `).join('');

  document.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => selectOutcome(button));
  });
}

function renderEvent(event) {
  return `
    <article class="event-row">
      <div class="event-info">
        <time>${formatDate(event.commence_time)}</time>
        <strong>${escapeHtml(event.home_team.name)}</strong>
        <strong>${escapeHtml(event.away_team.name)}</strong>
        <span>${escapeHtml(event.odds.bookmaker_title)}</span>
      </div>
      <div class="market-row">
        ${event.odds.outcomes.map((outcome) => {
          const active = state.selected?.event.id === event.id && state.selected?.outcome.selection_key === outcome.selection_key;
          return `
            <button class="odd-cell ${active ? 'active' : ''}" data-event="${event.id}" data-bookmaker="${event.odds.bookmaker_key}" data-market="${event.odds.market_key}" data-selection="${outcome.selection_key}">
              <span>${labels[outcome.selection_key] || outcome.label}</span>
              <strong>${Number(outcome.price).toFixed(2)}</strong>
            </button>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

function selectOutcome(button) {
  const event = state.events.find((item) => item.id === button.dataset.event);
  const outcome = event.odds.outcomes.find((item) => item.selection_key === button.dataset.selection);
  const sameSelection = state.selected
    && state.selected.event.id === event.id
    && state.selected.outcome.selection_key === outcome.selection_key;

  if (sameSelection) {
    clearSelection();
    return;
  }

  state.selected = {
    event,
    outcome,
    bookmaker_key: button.dataset.bookmaker,
    market_key: button.dataset.market,
  };
  renderEvents();
  renderTicket();
}

function clearSelection() {
  state.selected = null;
  document.querySelector('#ticket-empty').hidden = false;
  document.querySelector('#ticket-form').hidden = true;
  document.querySelector('#bet-slip').classList.remove('has-selection');
  renderEvents();
}

function renderTicket() {
  if (!state.selected) return;

  document.querySelector('#bet-slip').classList.add('has-selection');
  document.querySelector('#ticket-empty').hidden = true;
  document.querySelector('#ticket-form').hidden = false;
  document.querySelector('#ticket-event').textContent = `${state.selected.event.home_team.name} — ${state.selected.event.away_team.name}`;
  document.querySelector('#ticket-selection').textContent = state.selected.outcome.name;
  document.querySelector('#ticket-price').textContent = Number(state.selected.outcome.price).toFixed(2);
  document.querySelector('#ticket-win').textContent = money(state.stake * state.selected.outcome.price);
}

async function submitBet() {
  if (!state.selected) return;

  const payload = {
    event_id: state.selected.event.id,
    bookmaker_key: state.selected.bookmaker_key,
    market_key: state.selected.market_key,
    selection_key: state.selected.outcome.selection_key,
    amount: state.stake,
  };

  const result = await apiFetch('/api/bets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  document.querySelector('#balance-value').textContent = money(result.wallet.balance);
  status('Ставка принята');
  tg?.HapticFeedback?.notificationOccurred('success');
  clearSelection();
  await loadBets();
}

function renderBets() {
  const root = document.querySelector('#bets');
  if (!state.bets.length) {
    root.innerHTML = '<article class="empty-state">У вас пока нет ставок.</article>';
    return;
  }

  root.innerHTML = state.bets.map((bet) => {
    const selection = bet.selections?.[0] || {};
    return `
      <article class="bet-row">
        <div>
          <strong>${escapeHtml(selection.event_name_ru || 'Ставка')}</strong>
          <p>${escapeHtml(selection.selection_name_ru || selection.selection_name_raw || '')} · ${Number(bet.total_odds).toFixed(2)}</p>
        </div>
        <div>
          <span>${money(bet.amount)}</span>
          <strong>${money(bet.possible_win)}</strong>
        </div>
      </article>
    `;
  }).join('');
}

async function loadAdmin() {
  const [dashboard, runs] = await Promise.all([
    apiFetch('/api/admin/dashboard'),
    apiFetch('/api/admin/sync-runs'),
  ]);
  renderDashboard(dashboard);
  renderSyncRuns(runs);
}

async function loadUsers() {
  state.users = await apiFetch('/api/admin/users');
  renderUsers();
}

async function loadAliases() {
  state.aliases = await apiFetch('/api/admin/aliases');
  renderAliases();
}

function renderDashboard(data) {
  const usage = data.odds_api_usage || {};
  const sync = data.last_sync || {};
  document.querySelector('#admin-dashboard').innerHTML = `
    <div class="stat"><span>Пользователей</span><strong>${data.stats.users_count}</strong></div>
    <div class="stat"><span>Активных событий</span><strong>${data.stats.active_events_count}</strong></div>
    <div class="stat"><span>Pending ставок</span><strong>${data.stats.pending_bets_count}</strong></div>
    <div class="stat"><span>Оборот</span><strong>${money(data.stats.total_demo_turnover)}</strong></div>
    <div class="stat"><span>Последний sync</span><strong>${sync.status || 'нет'}</strong></div>
    <div class="stat"><span>Odds credits</span><strong>${usage.quota_remaining ?? 'нет данных'}</strong></div>
  `;
}

function renderSyncRuns(runs) {
  const root = document.querySelector('#sync-runs');
  if (!runs.length) {
    root.innerHTML = '<p class="muted">Запусков пока нет.</p>';
    return;
  }

  root.innerHTML = runs.map((run) => `
    <div class="sync-row">
      <strong>${escapeHtml(run.status)}</strong>
      <span>${run.events_count || 0} событий · ${run.odds_count || 0} кэфов</span>
      <time>${formatDate(run.started_at)}</time>
    </div>
  `).join('');
}

async function syncOdds() {
  status('Синхронизация запущена...');
  const result = await apiFetch('/api/admin/sync-odds', { method: 'POST', body: JSON.stringify({}) });
  const firstError = result.sync.errors?.[0]?.message;
  status(firstError
    ? `Sync: ${result.sync.status}. Ошибка: ${firstError}`
    : `Sync: ${result.sync.status}, событий: ${result.sync.events_count}, кэфов: ${result.sync.odds_count}`);
  await loadSports();
  await loadEvents();
  await loadAdmin();
}

async function refreshUsage() {
  const result = await apiFetch('/api/admin/refresh-odds-usage', { method: 'POST', body: JSON.stringify({}) });
  status(`Odds API credits: ${result.usage.quota_remaining ?? 'нет данных'}`);
  await loadAdmin();
}

function renderUsers() {
  const root = document.querySelector('#admin-users');
  if (!state.users.length) {
    root.innerHTML = '<article class="empty-state">Пользователей пока нет.</article>';
    return;
  }

  root.innerHTML = state.users.map(({ user, wallet }) => `
    <article class="admin-card">
      <div class="card-head">
        <strong>${escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Без имени')}</strong>
        <span>${escapeHtml(user.tg_id)}</span>
      </div>
      <div class="form-grid">
        <label>
          Статус
          <select data-user-status="${user.id}">
            ${['new', 'active', 'vip', 'test', 'restricted', 'suspended'].map((status) => `
              <option value="${status}" ${status === user.client_status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
        </label>
        <label>
          Баланс
          <input data-user-balance="${user.id}" type="number" min="0" step="10" value="${Number(wallet?.balance || 0)}">
        </label>
        <label class="checkbox-row">
          <input data-user-blocked="${user.id}" type="checkbox" ${user.is_blocked ? 'checked' : ''}>
          Заблокирован
        </label>
        <button class="primary" data-save-user="${user.id}">Сохранить</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-save-user]').forEach((button) => {
    button.addEventListener('click', () => saveUser(button.dataset.saveUser));
  });
}

async function saveUser(userId) {
  const payload = {
    client_status: document.querySelector(`[data-user-status="${userId}"]`).value,
    balance: Number(document.querySelector(`[data-user-balance="${userId}"]`).value),
    is_blocked: document.querySelector(`[data-user-blocked="${userId}"]`).checked,
  };

  await apiFetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  status('Пользователь обновлен');
  await loadUsers();
  await loadAdmin().catch(() => {});
}

function renderAliases() {
  const data = state.aliases;
  renderUnknownAliases(data.unknown_teams || []);
  renderSportAliases(data.sports || []);
  renderTeamAliases(data.teams || []);
}

function renderUnknownAliases(unknown) {
  const root = document.querySelector('#unknown-aliases');
  if (!unknown.length) {
    root.innerHTML = '<p class="muted">Нет пустых команд.</p>';
    return;
  }

  root.innerHTML = unknown.map((item, index) => `
    <article class="admin-card alias-card">
      <div class="card-head">
        <strong>${escapeHtml(item.raw_name)}</strong>
        <span>${escapeHtml(item.sport_key)}</span>
      </div>
      <div class="form-grid">
        <input data-unknown-name="${index}" placeholder="Название на русском">
        <input data-unknown-short="${index}" placeholder="Короткое название">
        <button class="primary" data-create-alias="${index}">Создать алиас</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-create-alias]').forEach((button) => {
    button.addEventListener('click', () => createAlias(Number(button.dataset.createAlias)));
  });
}

function renderSportAliases(sports) {
  const root = document.querySelector('#sport-aliases');
  if (!sports.length) {
    root.innerHTML = '<p class="muted">Турниры появятся после sync.</p>';
    return;
  }

  root.innerHTML = sports.map((sport) => `
    <article class="admin-card">
      <div class="card-head">
        <strong>${escapeHtml(sport.sport_key)}</strong>
        <span>${sport.is_enabled ? 'active' : 'off'}</span>
      </div>
      <div class="form-grid">
        <input data-sport-title="${sport.sport_key}" value="${escapeAttr(sport.title_ru || '')}" placeholder="Название на русском">
        <button class="primary" data-save-sport="${sport.sport_key}">Сохранить</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-save-sport]').forEach((button) => {
    button.addEventListener('click', () => saveSport(button.dataset.saveSport));
  });
}

function renderTeamAliases(teams) {
  const root = document.querySelector('#team-aliases');
  if (!teams.length) {
    root.innerHTML = '<p class="muted">Команды появятся после заполнения алиасов.</p>';
    return;
  }

  root.innerHTML = teams.map(({ team, aliases }) => `
    <article class="admin-card">
      <div class="card-head">
        <strong>${escapeHtml(team.name_en)}</strong>
        <span>${escapeHtml((aliases || []).map((alias) => alias.raw_name).join(', '))}</span>
      </div>
      <div class="form-grid">
        <input data-team-name="${team.id}" value="${escapeAttr(team.name_ru || '')}" placeholder="Название на русском">
        <input data-team-short="${team.id}" value="${escapeAttr(team.short_name_ru || '')}" placeholder="Короткое название">
        <input data-team-logo="${team.id}" value="${escapeAttr(team.logo_url || '')}" placeholder="Logo URL">
        <button class="primary" data-save-team="${team.id}">Сохранить</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-save-team]').forEach((button) => {
    button.addEventListener('click', () => saveTeam(button.dataset.saveTeam));
  });
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
    }),
  });
  status('Алиас создан');
  await loadAliases();
}

async function saveSport(sportKey) {
  await apiFetch(`/api/admin/sports/${encodeURIComponent(sportKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title_ru: document.querySelector(`[data-sport-title="${sportKey}"]`).value }),
  });
  status('Турнир обновлен');
  await loadAliases();
  await loadSports().catch(() => {});
}

async function saveTeam(teamId) {
  await apiFetch(`/api/admin/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name_ru: document.querySelector(`[data-team-name="${teamId}"]`).value,
      short_name_ru: document.querySelector(`[data-team-short="${teamId}"]`).value,
      logo_url: document.querySelector(`[data-team-logo="${teamId}"]`).value,
    }),
  });
  status('Команда обновлена');
  await loadAliases();
  await loadEvents().catch(() => {});
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#view-${tab}`).classList.add('active');

  if (tab === 'bets') loadBets().catch((error) => status(error.message));
}

function switchAdminView(view) {
  document.querySelectorAll('.drawer-tab').forEach((button) => button.classList.toggle('active', button.dataset.adminView === view));
  document.querySelectorAll('.drawer-view').forEach((item) => item.classList.remove('active'));
  document.querySelector(`#admin-view-${view}`).classList.add('active');

  if (view === 'overview') loadAdmin().catch((error) => status(error.message));
  if (view === 'users') loadUsers().catch((error) => status(error.message));
  if (view === 'aliases') loadAliases().catch((error) => status(error.message));
}

function openAdminDrawer() {
  document.querySelector('#admin-drawer').classList.add('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('#admin-backdrop').hidden = false;
  switchAdminView('overview');
}

function closeAdminDrawer() {
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'true');
  document.querySelector('#admin-backdrop').hidden = true;
}

function openCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = false;
}

function closeCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = true;
  document.querySelector('#create-user-form').reset();
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
  await loadAdmin().catch(() => {});
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
    if (startX > window.innerWidth - 48 && dx < -60 && state.me?.user?.is_admin) openAdminDrawer();
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

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

document.querySelectorAll('.drawer-tab').forEach((button) => {
  button.addEventListener('click', () => switchAdminView(button.dataset.adminView));
});

document.querySelector('#stake').addEventListener('input', (event) => {
  state.stake = Number(event.target.value);
  renderTicket();
});

document.querySelector('#place-bet').addEventListener('click', () => {
  submitBet().catch((error) => status(error.message));
});

document.querySelector('#open-admin').addEventListener('click', openAdminDrawer);
document.querySelector('#close-admin').addEventListener('click', closeAdminDrawer);
document.querySelector('#admin-backdrop').addEventListener('click', closeAdminDrawer);

document.querySelector('#sync-odds').addEventListener('click', () => {
  syncOdds().catch((error) => status(error.message));
});

document.querySelector('#refresh-usage').addEventListener('click', () => {
  refreshUsage().catch((error) => status(error.message));
});

document.querySelector('#reload-aliases').addEventListener('click', () => {
  loadAliases().catch((error) => status(error.message));
});

document.querySelector('#open-create-user').addEventListener('click', openCreateUserModal);
document.querySelector('#close-create-user').addEventListener('click', closeCreateUserModal);
document.querySelector('#create-user-form').addEventListener('submit', (event) => {
  createUser(event).catch((error) => status(error.message));
});

setupSwipe();
init();
