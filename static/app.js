const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  me: null,
  events: [],
  bets: [],
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
  document.querySelector('.admin-only').hidden = !data.user.is_admin;
  status('Готово');
}

async function loadEvents() {
  state.events = await apiFetch('/api/events');
  renderEvents();
}

async function loadBets() {
  state.bets = await apiFetch('/api/bets');
  renderBets();
}

function renderEvents() {
  const root = document.querySelector('#events');
  if (!state.events.length) {
    root.innerHTML = '<article class="panel muted">Пока нет активных событий. Админ может обновить линию в админке.</article>';
    return;
  }

  root.innerHTML = state.events.map((event) => `
    <article class="event">
      <div class="meta">
        <span>${escapeHtml(event.league_title)}</span>
        <time>${formatDate(event.commence_time)}</time>
      </div>
      <h2>${escapeHtml(event.home_team.name)} — ${escapeHtml(event.away_team.name)}</h2>
      <p class="muted">${escapeHtml(event.odds.bookmaker_title)}</p>
      <div class="odds">
        ${event.odds.outcomes.map((outcome) => `
          <button data-event="${event.id}" data-bookmaker="${event.odds.bookmaker_key}" data-market="${event.odds.market_key}" data-selection="${outcome.selection_key}">
            <span>${labels[outcome.selection_key] || outcome.label}</span>
            <strong>${Number(outcome.price).toFixed(2)}</strong>
          </button>
        `).join('')}
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => selectOutcome(button));
  });
}

function selectOutcome(button) {
  const event = state.events.find((item) => item.id === button.dataset.event);
  const outcome = event.odds.outcomes.find((item) => item.selection_key === button.dataset.selection);
  state.selected = {
    event,
    outcome,
    bookmaker_key: button.dataset.bookmaker,
    market_key: button.dataset.market,
  };

  document.querySelectorAll('[data-event]').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  renderTicket();
}

function renderTicket() {
  if (!state.selected) return;

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
  await loadBets();
}

function renderBets() {
  const root = document.querySelector('#bets');
  if (!state.bets.length) {
    root.innerHTML = '<article class="panel muted">У вас пока нет ставок.</article>';
    return;
  }

  root.innerHTML = state.bets.map((bet) => {
    const selection = bet.selections?.[0] || {};
    return `
      <article class="event">
        <div class="meta">
          <span>${escapeHtml(bet.status)}</span>
          <time>${formatDate(bet.created_at)}</time>
        </div>
        <h2>${escapeHtml(selection.event_name_ru || 'Ставка')}</h2>
        <p class="muted">${escapeHtml(selection.selection_name_ru || selection.selection_name_raw || '')} · ${Number(bet.total_odds).toFixed(2)}</p>
        <div class="ticket-row">
          <span>Сумма</span>
          <strong>${money(bet.amount)}</strong>
        </div>
        <div class="ticket-row">
          <span>Возможный выигрыш</span>
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
  status(`Sync: ${result.sync.status}, событий: ${result.sync.events_count}, кэфов: ${result.sync.odds_count}`);
  await loadEvents();
  await loadAdmin();
}

async function refreshUsage() {
  const result = await apiFetch('/api/admin/refresh-odds-usage', { method: 'POST', body: JSON.stringify({}) });
  status(`Odds API credits: ${result.usage.quota_remaining ?? 'нет данных'}`);
  await loadAdmin();
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#view-${tab}`).classList.add('active');

  if (tab === 'bets') loadBets().catch((error) => status(error.message));
  if (tab === 'admin') loadAdmin().catch((error) => status(error.message));
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

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

document.querySelector('#stake').addEventListener('input', (event) => {
  state.stake = Number(event.target.value);
  renderTicket();
});

document.querySelector('#place-bet').addEventListener('click', () => {
  submitBet().catch((error) => status(error.message));
});

document.querySelector('#sync-odds').addEventListener('click', () => {
  syncOdds().catch((error) => status(error.message));
});

document.querySelector('#refresh-usage').addEventListener('click', () => {
  refreshUsage().catch((error) => status(error.message));
});

init();
