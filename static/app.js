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
  adminBets: [],
  aliases: null,
  teamAliasRows: [],
  manualData: { sports: [], teams: [], events: [] },
  debugReports: {},
  debugReportSeq: 0,
  manualStep: 1,
  editingManualEventId: null,
  selectedEventId: null,
  selections: [],
  ticketExpanded: false,
  stake: 100,
  activeTab: 'events',
};

const labels = { home_win: 'П1', draw: 'X', away_win: 'П2', home_or_draw: '1X', home_or_away: '12', draw_or_away: 'X2' };
const statusLabels = { pending: 'ожидает', won: 'выиграла', lost: 'проиграла', refund: 'возврат', cancelled: 'отменена' };
const eventStatusLabels = { upcoming: 'ожидает', finished: 'завершён', cancelled: 'отменён' };
const clientStatusLabels = { new: 'новый', active: 'активный', vip: 'VIP', test: 'тестовый', restricted: 'ограничен', suspended: 'приостановлен' };
const sportTypeLabels = { soccer: 'Футбол', hockey: 'Хоккей', esports: 'Киберспорт' };
const marketTitles = { h2h: 'Исход матча', double_chance: 'Двойной шанс', totals: 'Тотал', spreads: 'Фора', video_review: 'Видеопросмотр', player_goal: 'Гол игрока', player_assist: 'Передача игрока' };
const defaultSportKeys = ['soccer_russia_premier_league', 'soccer_spain_la_liga', 'soccer_uefa_champs_league', 'icehockey_nhl'];
const defaultSportTitles = {
  soccer_russia_premier_league: 'Российская Премьер-Лига',
  soccer_spain_la_liga: 'Ла Лига',
  soccer_uefa_champs_league: 'Лига чемпионов',
  icehockey_nhl: 'НХЛ',
};
const minStake = 30;
const stakePresets = [30, 50, 100, 200, 500];
const fetchTimeoutMs = 45000;
const minWelcomeMs = 4000;
let welcomeStartedAt = Date.now();
const welcomeMessages = [
  'Собираем лучшие матчи...',
  'Сейчас всё красиво откроется...',
  'Судья добавил пару секунд...',
  'Обновляем линию...',
  'Экспресс готовится к взлёту...',
  'VAR проверяет загрузку...',
];
let welcomeMessageTimer = null;
const adminTitles = {
  menu: 'Админка',
  sync: 'Синхронизация линии',
  'api-usage': 'Статистика API',
  users: 'Пользователи',
  'all-bets': 'Все ставки',
  aliases: 'Алиасы и команды',
  constructor: 'Конструктор событий',
  results: 'Расчёт ставок',
};

function money(value) {
  return `${moneyValue(value)} ✦`;
}

function moneyHtml(value) {
  return `${moneyValue(value)} <span class="currency-star">✦</span>`;
}

function moneyValue(value) {
  return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function status(message) {
  if (message) notify(message);
}

function notify(message, type = 'info') {
  const modal = document.querySelector('#notice-modal');
  if (!modal || !message) return;
  const titles = { success: 'Готово', error: 'Ошибка', info: 'Сообщение' };
  modal.className = `notice-modal ${type}`;
  document.querySelector('#notice-title').textContent = titles[type] || titles.info;
  document.querySelector('#notice-text').textContent = message;
  modal.hidden = false;
}

function closeNotice() {
  document.querySelector('#notice-modal').hidden = true;
}

function showLoading(title, text = 'Подождите, операция выполняется.') {
  document.querySelector('#loading-title').textContent = title;
  document.querySelector('#loading-text').textContent = text;
  document.querySelector('#loading-modal').hidden = false;
}

function updateLoading(text) {
  document.querySelector('#loading-text').textContent = text;
}

function hideLoading() {
  document.querySelector('#loading-modal').hidden = true;
}

function showBlockedScreen(reason) {
  window.clearInterval(welcomeMessageTimer);
  welcomeMessageTimer = null;
  document.querySelector('.page').hidden = true;
  document.querySelector('#bet-slip').hidden = true;
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-backdrop').hidden = true;
  document.querySelector('#welcome-screen').hidden = true;
  document.querySelector('#blocked-reason').textContent = reason || 'Доступ к приложению временно ограничен.';
  document.querySelector('#blocked-screen').hidden = false;
}

function prepareWelcome() {
  welcomeStartedAt = Date.now();
  document.querySelector('#welcome-greeting').textContent = `${moscowGreeting()},`;
  document.querySelector('#welcome-name').textContent = localStorage.getItem('betbot_profile_name') || telegramFallbackName() || 'Игрок';
  updateWelcomeMessage(true);
  window.clearInterval(welcomeMessageTimer);
  welcomeMessageTimer = window.setInterval(() => updateWelcomeMessage(false), 1550);
}

function finishWelcome(name) {
  if (name) {
    localStorage.setItem('betbot_profile_name', name);
    document.querySelector('#welcome-name').textContent = name;
  }
  window.clearInterval(welcomeMessageTimer);
  welcomeMessageTimer = null;
  const delay = Math.max(0, minWelcomeMs - (Date.now() - welcomeStartedAt));
  window.setTimeout(() => {
    document.querySelector('#welcome-screen').classList.add('hidden');
    window.setTimeout(() => {
      document.querySelector('#welcome-screen').hidden = true;
    }, 360);
  }, delay);
}

function updateWelcomeMessage(initial = false) {
  const target = document.querySelector('#welcome-status');
  if (!target) return;
  if (initial) {
    target.textContent = randomWelcomeMessage();
    target.classList.add('is-visible');
    return;
  }
  target.classList.remove('is-visible');
  window.setTimeout(() => {
    target.textContent = randomWelcomeMessage(target.textContent);
    target.classList.add('is-visible');
  }, 140);
}

function randomWelcomeMessage(current = '') {
  const pool = welcomeMessages.filter((message) => message !== current);
  return pool[Math.floor(Math.random() * pool.length)] || welcomeMessages[0];
}

function moscowGreeting() {
  const hour = Number(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

async function apiFetch(path, options = {}) {
  const { timeoutMs = fetchTimeoutMs, headers: optionHeaders = {}, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg?.initData || '',
    ...optionHeaders,
  };
  try {
    const response = await fetch(path, { ...fetchOptions, headers, signal: controller.signal });
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
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Запрос выполнялся слишком долго. Проверьте последние sync runs и попробуйте ещё раз.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function init() {
  const canUseApp = await loadMe().catch((error) => {
    status(`Профиль не загружен: ${error.message}`);
    finishWelcome(telegramFallbackName() || 'Игрок');
    return false;
  });
  if (!canUseApp) return;
  await loadSports().catch((error) => status(`Турниры не загружены: ${error.message}`));
  await loadEvents().catch((error) => status(`Линия не загружена: ${error.message}`));
  handleHash();
}

async function loadMe() {
  const data = await apiFetch('/api/me');
  state.me = data;
  const profileName = resolveProfileName(data);
  document.querySelector('#profile-name').textContent = profileName;
  document.querySelector('#balance-value').innerHTML = moneyHtml(data.wallet.balance);
  renderProfileView();
  setAdminVisibility(Boolean(data.user.is_admin));
  if (data.user.is_blocked) {
    showBlockedScreen(data.user.block_reason);
    return false;
  }
  status('');
  finishWelcome(profileName);
  return true;
}

function setAdminVisibility(isAdmin) {
  document.querySelectorAll('.admin-only').forEach((item) => {
    item.hidden = !isAdmin;
    item.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
  });
  if (!isAdmin) {
    document.querySelector('#open-admin')?.classList.remove('active');
    document.querySelector('#admin-drawer')?.classList.remove('open');
    document.querySelector('#admin-drawer')?.setAttribute('aria-hidden', 'true');
    document.querySelector('#admin-backdrop').hidden = true;
    if (location.hash.startsWith('#/admin')) history.replaceState(null, '', location.pathname + location.search);
  }
}

function resolveProfileName(data) {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const dbName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ');
  const tgName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ');
  return dbName || tgName || data.user.username || tgUser?.username || 'Игрок';
}

function telegramFallbackName() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  return [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || tgUser?.username || '';
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
      <span class="sport-icon" aria-hidden="true">${sportIcon(sport.sport_key, sport.title)}</span>
      <span class="sport-copy"><span>${escapeHtml(sport.title)}</span><strong>${sport.events_count}</strong></span>
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

function sportIcon(sportKey = '', title = '') {
  const value = `${sportKey} ${title}`.toLowerCase();
  if (!sportKey) {
    return '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 6v12M16 6v12"/></svg>';
  }
  if (value.includes('hockey') || value.includes('хоккей')) {
    return '<svg viewBox="0 0 24 24"><path d="M6 4v8.5c0 2.5 1.8 4.5 4.3 4.5H16"/><path d="M18 4v8.5c0 2.5-1.8 4.5-4.3 4.5H8"/><path d="M4 20h16"/><path d="M16 17l4 3"/></svg>';
  }
  if (value.includes('esport') || value.includes('кибер')) {
    return '<svg viewBox="0 0 24 24"><path d="M7 9h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5.2 2l-1.3-1H9.5l-1.3 1A3 3 0 0 1 3 15v-2a4 4 0 0 1 4-4Z"/><path d="M8 12v3M6.5 13.5h3M15 13h.01M18 13h.01"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="M12 7l3 2.2-1.1 3.5h-3.8L9 9.2 12 7Z"/><path d="M12 3v4M4.7 8.1 9 9.2M7.5 19l2.6-6.3M16.5 19l-2.6-6.3M19.3 8.1 15 9.2"/></svg>';
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
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSelection(button);
    });
  });
  document.querySelectorAll('[data-open-event]').forEach((row) => {
    row.addEventListener('click', () => openEventCard(row.dataset.openEvent));
  });
}

function renderEvent(event) {
  return `
    <article class="event-row" data-open-event="${event.id}">
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
  return `<img class="team-logo" src="${escapeAttr(team.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'team-logo placeholder', textContent: '${escapeAttr((team?.name || 'Ф')[0])}'}))">`;
}

function openEventCard(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  state.selectedEventId = eventId;
  document.querySelector('#event-card').innerHTML = `
    <header class="full-page-head">
      <button class="modal-close" type="button" id="close-event-card">Назад</button>
      <div><p class="label">${escapeHtml(event.league_title)}</p><h2>${escapeHtml(event.home_team.name)} — ${escapeHtml(event.away_team.name)}</h2></div>
    </header>
    <div class="match-hero">
      <div>${teamLogo(event.home_team)}<strong>${escapeHtml(event.home_team.name)}</strong></div>
      <span>${formatDate(event.commence_time)}</span>
      <div>${teamLogo(event.away_team)}<strong>${escapeHtml(event.away_team.name)}</strong></div>
    </div>
    ${(event.markets?.length ? event.markets : [event.odds]).map((market) => `
      <section class="market-section">
        <h3>${escapeHtml(market.title || marketTitles[market.market_key] || market.market_key)}</h3>
        <div class="market-row ${market.outcomes.length === 2 ? 'two' : ''}">
          ${market.outcomes.map((outcome) => {
            const active = state.selections.some((item) => item.event.id === event.id && item.outcome.selection_key === outcome.selection_key && item.market_key === market.market_key);
            return `
              <button class="odd-cell ${active ? 'active' : ''}" data-modal-selection data-event="${event.id}" data-bookmaker="${market.bookmaker_key}" data-market="${market.market_key}" data-selection="${outcome.selection_key}">
                <span>${escapeHtml(labels[outcome.selection_key] || outcome.label || outcome.name)}</span><strong>${Number(outcome.price).toFixed(2)}</strong>
              </button>
            `;
          }).join('')}
        </div>
      </section>
    `).join('')}
  `;
  document.querySelector('#event-modal').hidden = false;
  document.body.classList.add('no-scroll');
  document.querySelector('#close-event-card').addEventListener('click', closeEventCard);
  document.querySelectorAll('[data-modal-selection]').forEach((button) => {
    button.addEventListener('click', (eventClick) => {
      eventClick.stopPropagation();
      toggleSelection(button);
      openEventCard(eventId);
    });
  });
}

function closeEventCard() {
  document.querySelector('#event-modal').hidden = true;
  document.body.classList.remove('no-scroll');
  state.selectedEventId = null;
}

function toggleSelection(button) {
  const event = state.events.find((item) => item.id === button.dataset.event);
  const market = findEventMarket(event, button.dataset.market, button.dataset.bookmaker);
  const outcome = market.outcomes.find((item) => item.selection_key === button.dataset.selection);
  const same = state.selections.some((item) => item.event.id === event.id && item.market_key === market.market_key && item.outcome.selection_key === outcome.selection_key);
  if (same) {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
  } else {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
    state.selections.push({ event, outcome, bookmaker_key: market.bookmaker_key, market_key: market.market_key, market_title: market.title || marketTitles[market.market_key] });
  }
  renderEvents();
  renderTicket();
}

function findEventMarket(event, marketKey, bookmakerKey) {
  const markets = event.markets?.length ? event.markets : [event.odds];
  return markets.find((market) => market.market_key === marketKey && market.bookmaker_key === bookmakerKey)
    || markets.find((market) => market.market_key === marketKey)
    || event.odds;
}

function totalOdds() {
  return state.selections.reduce((acc, item) => acc * Number(item.outcome.price), 1);
}

function ticketValidation() {
  const balance = Number(state.me?.wallet?.balance || 0);
  if (state.stake < minStake) return { ok: false, message: `Минимальная ставка ${money(minStake)}` };
  if (state.stake > balance) return { ok: false, message: 'Недостаточный баланс' };
  return { ok: true, message: '' };
}

function renderTicket() {
  const slip = document.querySelector('#bet-slip');
  if (!state.selections.length) {
    slip.hidden = true;
    slip.classList.remove('expanded');
    state.ticketExpanded = false;
    return;
  }
  slip.hidden = false;
  slip.classList.toggle('expanded', state.ticketExpanded);
  const odds = totalOdds();
  const type = state.selections.length === 1 ? 'Ординар' : 'Экспресс';
  const validation = ticketValidation();
  document.querySelector('#toggle-ticket').textContent = `${state.selections.length} пари · ${type} ${odds.toFixed(2)}`;
  document.querySelector('#ticket-form').hidden = !state.ticketExpanded;
  document.querySelector('#ticket-type').textContent = type;
  document.querySelector('#ticket-odds').textContent = odds.toFixed(2);
  document.querySelector('#ticket-win').innerHTML = moneyHtml(state.stake * odds);
  document.querySelector('#stake').classList.toggle('invalid', !validation.ok);
  document.querySelector('#place-bet').disabled = !validation.ok;
  document.querySelector('#stake-error').hidden = validation.ok;
  document.querySelector('#stake-error').textContent = validation.message;
  document.querySelector('#stake-presets').innerHTML = stakePresets.map((amount) => `
    <button type="button" class="${Number(state.stake) === amount ? 'active' : ''}" data-stake-preset="${amount}">${moneyHtml(amount)}</button>
  `).join('');
  document.querySelector('#ticket-list').innerHTML = state.selections.map((item, index) => `
    <article class="ticket-item">
      <div>
        <strong>${escapeHtml(item.event.home_team.name)} — ${escapeHtml(item.event.away_team.name)}</strong>
        <p>${ticketSelectionPrefix(item)} ${escapeHtml(item.market_title || marketTitles[item.market_key] || item.market_key)} · ${escapeHtml(item.outcome.name)}</p>
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
  document.querySelectorAll('[data-stake-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      state.stake = Number(button.dataset.stakePreset);
      document.querySelector('#stake').value = state.stake;
      renderTicket();
    });
  });
}

function ticketSelectionPrefix(item) {
  if (item.outcome.selection_key === 'home_win') return teamLogo(item.event.home_team);
  if (item.outcome.selection_key === 'away_win') return teamLogo(item.event.away_team);
  return '';
}

function clearTicket() {
  state.selections = [];
  renderEvents();
  renderTicket();
}

async function submitBet() {
  if (!state.selections.length) return;
  const validation = ticketValidation();
  if (!validation.ok) {
    notify(validation.message, 'error');
    renderTicket();
    return;
  }
  showLoading('Ставка', 'Проверяю купон и баланс...');
  try {
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
    state.me.wallet = result.wallet;
    document.querySelector('#balance-value').innerHTML = moneyHtml(result.wallet.balance);
    renderProfileView();
    notify('Ставка принята', 'success');
    tg?.HapticFeedback?.notificationOccurred('success');
    clearTicket();
    await loadBets();
  } finally {
    hideLoading();
  }
}

async function loadBets() {
  state.bets = await apiFetch('/api/bets');
  renderBets();
}

function renderBets() {
  const pending = state.bets.filter((bet) => bet.status === 'pending');
  const history = state.bets.filter((bet) => bet.status !== 'pending');
  renderBetCollection('#bets', pending, 'Активных пари пока нет.');
  renderBetCollection('#history', history, 'История пока пустая.');
}

function renderBetCollection(selector, bets, emptyText) {
  const root = document.querySelector(selector);
  if (!root) return;
  if (!bets.length) {
    root.innerHTML = `<article class="empty-state">${emptyText}</article>`;
    return;
  }
  root.innerHTML = bets.map(renderBetCard).join('');
}

function renderBetCard(bet) {
  return `
    <article class="bet-row ${bet.status}">
      <div class="bet-main">
        <div class="card-head">
          <strong>${bet.bet_type === 'express' ? `Экспресс · ${bet.selections.length} событий` : 'Ординар'}</strong>
          <span>${statusLabels[bet.status] || bet.status}</span>
        </div>
        <div class="bet-money">${betMoneyLine(bet)}</div>
        <p>Кэф ${Number(bet.total_odds).toFixed(2)} · ${formatDate(bet.created_at)}</p>
        <div class="selection-list">${bet.selections.map((selection) => `
          <span>
            <strong>${escapeHtml(selection.event_name_ru)}</strong>
            <small>${escapeHtml(marketTitles[selection.market_key] || selection.market_key)} · ${escapeHtml(selection.selection_name_ru || selection.selection_name_raw)} · ${Number(selection.price).toFixed(2)} · ${statusLabels[selection.result_status] || selection.result_status}</small>
          </span>
        `).join('')}</div>
      </div>
    </article>
  `;
}

function betMoneyLine(bet) {
  if (bet.status === 'won') {
    return `<span>${moneyHtml(bet.amount)}</span><b class="arrow">→</b><strong class="win">${moneyHtml(bet.payout ?? bet.possible_win)}</strong>`;
  }
  if (bet.status === 'lost') {
    return `<strong class="loss">-${moneyHtml(bet.amount)}</strong>`;
  }
  if (bet.status === 'refund') {
    return `<strong class="refund">${moneyHtml(bet.payout ?? bet.amount)}</strong>`;
  }
  return `<span>${moneyHtml(bet.amount)}</span><b class="arrow">→</b><strong>${moneyHtml(bet.possible_win)}</strong>`;
}

function openProfileCard() {
  switchTab('profile');
}

function renderProfileView() {
  const user = state.me?.user;
  const wallet = state.me?.wallet;
  if (!user || !wallet) return;
  const content = `
    <div class="stat"><span>Telegram ID</span><strong>${escapeHtml(user.tg_id)}</strong></div>
    <div class="stat"><span>Username</span><strong>${escapeHtml(user.username || 'не указан')}</strong></div>
    <div class="stat"><span>Статус</span><strong>${escapeHtml(clientStatusLabels[user.client_status] || user.client_status || 'не указан')}</strong></div>
    <div class="stat"><span>Баланс</span><strong>${moneyHtml(wallet.balance)}</strong></div>
  `;
  document.querySelector('#profile-view-name').textContent = resolveProfileName(state.me);
  document.querySelector('#profile-view-balance').innerHTML = moneyHtml(wallet.balance);
  document.querySelector('#profile-view-info').innerHTML = content;
  document.querySelector('#profile-card-name').textContent = resolveProfileName(state.me);
  document.querySelector('#profile-card-balance').innerHTML = moneyHtml(wallet.balance);
  document.querySelector('#profile-card-info').innerHTML = content;
}

function closeProfileCard() {
  document.querySelector('#profile-modal').hidden = true;
  document.body.classList.remove('no-scroll');
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
  const id = `debug-${++state.debugReportSeq}`;
  const json = JSON.stringify(payload, null, 2);
  state.debugReports[id] = json;
  root.insertAdjacentHTML('beforeend', `
    <details class="debug-box" open>
      <summary>Подробный debug ответа</summary>
      <button class="copy-debug" type="button" data-copy-debug="${id}">Скопировать debug</button>
      <pre>${escapeHtml(json)}</pre>
    </details>
  `);
  root.querySelectorAll('[data-copy-debug]').forEach((button) => {
    button.addEventListener('click', () => copyDebugReport(button.dataset.copyDebug));
  });
}

function renderActionError(error, selector) {
  renderSyncDebug({
    message: error.message,
    status: error.status,
    data: error.data || null,
    responseText: error.responseText || null,
  }, selector);
}

async function copyDebugReport(id) {
  const text = state.debugReports[id];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify('Debug-отчёт скопирован', 'success');
  } catch (error) {
    fallbackCopy(text);
    notify('Debug-отчёт скопирован', 'success');
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
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
  showLoading('Синхронизация линии', 'Подготавливаю турниры...');
  const responses = [];
  try {
    for (const sportKey of syncSportKeys()) {
      updateLoading(`Обновляю: ${sportTitle(sportKey)}`);
      try {
        const result = await apiFetch('/api/admin/sync-odds', {
          method: 'POST',
          timeoutMs: 45000,
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
  } finally {
    hideLoading();
  }
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
        <label>Статус <select data-user-status="${user.id}">${Object.entries(clientStatusLabels).map(([value, label]) => `<option value="${value}" ${value === user.client_status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Баланс <input data-user-balance="${user.id}" type="number" min="0" step="10" value="${Number(wallet?.balance || 0)}"></label>
        <label class="checkbox-row"><input data-user-blocked="${user.id}" type="checkbox" ${user.is_blocked ? 'checked' : ''}> Заблокирован</label>
        <button class="primary" data-save-user="${user.id}">Сохранить</button>
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-save-user]').forEach((button) => button.addEventListener('click', () => saveUser(button.dataset.saveUser)));
}

async function saveUser(userId) {
  showLoading('Пользователь', 'Сохраняю изменения...');
  try {
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
    notify('Пользователь обновлен', 'success');
    await loadUsers();
  } finally {
    hideLoading();
  }
}

async function createUser(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  showLoading('Пользователь', 'Создаю профиль...');
  try {
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
    notify('Пользователь создан', 'success');
    await loadUsers();
  } finally {
    hideLoading();
  }
}

async function loadAdminBets() {
  const sort = document.querySelector('#admin-bets-sort')?.value || 'created_desc';
  const data = await apiFetch(`/api/admin/bets?sort=${encodeURIComponent(sort)}&limit=250`);
  state.adminBets = data.bets || [];
  renderAdminBets();
}

function renderAdminBets() {
  const root = document.querySelector('#admin-all-bets');
  if (!root) return;
  if (!state.adminBets.length) {
    root.innerHTML = '<article class="empty-state">Ставок пока нет.</article>';
    return;
  }
  root.innerHTML = state.adminBets.map(({ bet, user, selections }) => {
    const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.tg_id : 'Пользователь не найден';
    return `
      <article class="admin-card bet-admin-card">
        <div class="card-head">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatDate(bet.created_at)}</span>
        </div>
        <div class="stat"><span>Тип</span><strong>${bet.bet_type === 'express' ? `Экспресс · ${selections.length}` : 'Ординар'}</strong></div>
        <div class="stat"><span>Статус</span><strong>${escapeHtml(statusLabels[bet.status] || bet.status)}</strong></div>
        <div class="stat"><span>Сумма</span><strong>${moneyHtml(bet.amount)}</strong></div>
        <div class="stat"><span>Коэффициент</span><strong>${Number(bet.total_odds || 0).toFixed(2)}</strong></div>
        <div class="stat"><span>Потенциально</span><strong>${moneyHtml(bet.possible_win)}</strong></div>
        ${bet.payout !== null && bet.payout !== undefined ? `<div class="stat"><span>Выплата</span><strong>${moneyHtml(bet.payout)}</strong></div>` : ''}
        <div class="selection-list">${(selections || []).map((selection) => `
          <span>
            <strong>${escapeHtml(selection.event_name_ru || 'Событие')}</strong>
            <small>${escapeHtml(marketTitles[selection.market_key] || selection.market_key)} · ${escapeHtml(selection.selection_name_ru || selection.selection_name_raw)} · ${Number(selection.price || 0).toFixed(2)} · ${escapeHtml(statusLabels[selection.result_status] || selection.result_status || 'ожидает')}</small>
          </span>
        `).join('')}</div>
      </article>
    `;
  }).join('');
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
  const teams = (state.aliases?.teams || []).map((row) => row.team).filter(Boolean);
  const teamOptions = `<option value="">Создать новую команду</option>${teams.map((team) => `
    <option value="${escapeAttr(team.id)}">${escapeHtml(team.name_ru || team.name_en)} · ${escapeHtml(sportTypeLabels[team.sport_type] || team.sport_type || 'спорт')}</option>
  `).join('')}`;
  root.innerHTML = indexed.length ? Object.entries(groups).map(([sportKey, items]) => `
    <details class="alias-group" open>
      <summary><strong>${escapeHtml(sportTitle(sportKey))}</strong><span>${items.length}</span></summary>
      ${items.map((item) => `
        <article class="admin-card">
          <div class="card-head"><strong>${escapeHtml(item.raw_name)}</strong></div>
          <div class="form-grid">
            <select data-unknown-team="${item.index}">${teamOptions}</select>
            <select data-unknown-sport-type="${item.index}">${sportTypeOptions(sportTypeFromKey(item.sport_key))}</select>
            <input data-unknown-name="${item.index}" placeholder="Название на русском">
            <input data-unknown-short="${item.index}" placeholder="Короткое название">
            <input data-unknown-logo="${item.index}" placeholder="Logo URL">
            <button class="primary" data-create-alias="${item.index}">Создать алиас</button>
          </div>
        </article>
      `).join('')}
    </details>
  `).join('') : '<p class="muted">Нет пустых команд.</p>';
  document.querySelectorAll('[data-create-alias]').forEach((button) => button.addEventListener('click', () => createAlias(Number(button.dataset.createAlias))));
}

function renderSportAliases(sports) {
  document.querySelector('#sport-aliases').innerHTML = sports.length ? sports.map((sport) => `
    <article class="admin-card">
      <div class="card-head"><strong>${escapeHtml(sport.title_ru || sport.title_en || sport.sport_key)}</strong><span>${sport.is_enabled ? 'активен' : 'выключен'}</span></div>
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
    <details class="alias-group" open>
      <summary><strong>${escapeHtml(sportTitle(sportKey))}</strong><span>${items.length}</span></summary>
      ${items.map(({ team, aliases, index, sport_key }) => `
        <article class="admin-card">
          <div class="card-head"><strong>${escapeHtml(team.name_en)}</strong><span>${escapeHtml((aliases || []).map((alias) => alias.raw_name).join(', '))}</span></div>
          <div class="form-grid">
            <select data-team-sport-type="${index}">${sportTypeOptions(team.sport_type || sportTypeFromKey(sport_key))}</select>
            <input data-team-name="${index}" value="${escapeAttr(team.name_ru || '')}" placeholder="Название на русском">
            <input data-team-short="${index}" value="${escapeAttr(team.short_name_ru || '')}" placeholder="Короткое название">
            <input data-team-logo="${index}" value="${escapeAttr(team.logo_url || '')}" placeholder="Logo URL">
            <button class="primary" data-save-team-index="${index}">Сохранить</button>
          </div>
        </article>
      `).join('')}
    </details>
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
      team_id: document.querySelector(`[data-unknown-team="${index}"]`).value,
      sport_type: document.querySelector(`[data-unknown-sport-type="${index}"]`).value,
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
      sport_type: document.querySelector(`[data-team-sport-type="${index}"]`).value,
    }),
  });
  status('Команда обновлена');
  await loadAliases();
  await loadEvents();
}

async function syncResults() {
  showLoading('Расчёт результатов', 'Запрашиваю результаты матчей...');
  const responses = [];
  try {
    for (const sportKey of syncSportKeys()) {
      updateLoading(`Проверяю: ${sportTitle(sportKey)}`);
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
  } finally {
    hideLoading();
  }
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

async function loadManualConstructor() {
  state.manualData = await apiFetch('/api/admin/manual-events');
  renderManualConstructor();
}

function renderManualConstructor() {
  const sportSelect = document.querySelector('#manual-event-sport');
  const homeSelect = document.querySelector('#manual-event-home');
  const awaySelect = document.querySelector('#manual-event-away');
  if (!sportSelect || !homeSelect || !awaySelect) return;

  const sportType = document.querySelector('#manual-event-type').value || 'soccer';
  const sports = state.manualData.sports.filter((sport) => manualSportMatches(sport, sportType));
  const teams = state.manualData.teams.filter((team) => (team.sport_type || 'soccer') === sportType);
  sportSelect.innerHTML = `<option value="">Выберите соревнование</option>${sports.map((sport) => `
    <option value="${escapeAttr(sport.sport_key)}">${escapeHtml(sport.title_ru || sport.title_en || sport.sport_key)}</option>
  `).join('')}`;
  const teamOptions = `<option value="">Выберите команду</option>${teams.map((team) => `
    <option value="${escapeAttr(team.id)}">${escapeHtml(team.name_ru || team.name_en)}</option>
  `).join('')}`;
  homeSelect.innerHTML = teamOptions;
  awaySelect.innerHTML = teamOptions;
  setManualWizardStep(state.manualStep || 1);

  const manualSportsRoot = document.querySelector('#manual-sports-list');
  const manualSports = state.manualData.sports.filter((sport) => sport.source === 'manual' && manualSportMatches(sport, sportType));
  if (manualSportsRoot) {
    manualSportsRoot.innerHTML = manualSports.length ? manualSports.map((sport) => `
      <article class="admin-card">
        <div class="card-head">
          <strong>${escapeHtml(sport.title_ru || sport.title_en || sport.sport_key)}</strong>
          <span>${escapeHtml(sportTypeLabels[sport.group_name] || sport.group_name || 'спорт')}</span>
        </div>
        <div class="admin-actions">
          <button class="back-button danger-button" data-manual-sport-delete="${escapeAttr(sport.sport_key)}" type="button">Удалить соревнование</button>
        </div>
      </article>
    `).join('') : '<p class="muted">Ручных соревнований для выбранного спорта пока нет.</p>';
    document.querySelectorAll('[data-manual-sport-delete]').forEach((button) => button.addEventListener('click', () => deleteManualSport(button.dataset.manualSportDelete)));
  }

  const list = document.querySelector('#manual-events-list');
  list.innerHTML = state.manualData.events.length ? state.manualData.events.map((event) => `
    <article class="admin-card">
      <div class="card-head">
        <strong>${escapeHtml(event.home_team_raw)} — ${escapeHtml(event.away_team_raw)}</strong>
        <span>${escapeHtml(eventStatusLabels[event.status] || event.status)}</span>
      </div>
      <p class="muted">${escapeHtml(sportTitle(event.sport_key))} · ${formatDate(event.commence_time)}</p>
      <p class="muted">Рынков: ${new Set((event.odds || []).map((odd) => odd.market_key)).size || 0} · Исходов: ${(event.odds || []).length}</p>
      <div class="admin-actions">
        <button class="primary" data-manual-edit="${event.id}" type="button">Изменить</button>
        <button class="back-button danger-button" data-manual-delete="${event.id}" type="button">Удалить</button>
      </div>
    </article>
  `).join('') : '<p class="muted">Ручных матчей пока нет.</p>';
  document.querySelectorAll('[data-manual-edit]').forEach((button) => button.addEventListener('click', () => editManualEvent(button.dataset.manualEdit)));
  document.querySelectorAll('[data-manual-delete]').forEach((button) => button.addEventListener('click', () => deleteManualEvent(button.dataset.manualDelete)));
}

async function createManualEvent(event) {
  event.preventDefault();
  const isEditing = Boolean(state.editingManualEventId);
  showLoading(isEditing ? 'Событие' : 'Создание события', 'Сохраняю событие и рынки...');
  try {
    const path = state.editingManualEventId ? `/api/admin/manual-events/${state.editingManualEventId}` : '/api/admin/manual-events';
    const result = await apiFetch(path, {
      method: state.editingManualEventId ? 'PATCH' : 'POST',
      body: JSON.stringify(manualFormPayload()),
    });
    state.manualData = result;
    resetManualWizard();
    renderManualConstructor();
    await loadSports().catch(() => {});
    await loadEvents().catch(() => {});
    notify(isEditing ? 'Событие обновлено' : 'Событие создано', 'success');
  } finally {
    hideLoading();
  }
}

function setManualWizardStep(step) {
  state.manualStep = Math.min(3, Math.max(1, Number(step) || 1));
  document.querySelectorAll('[data-wizard-step]').forEach((item) => item.classList.toggle('active', Number(item.dataset.wizardStep) === state.manualStep));
  document.querySelectorAll('[data-wizard-dot]').forEach((item) => item.classList.toggle('active', Number(item.dataset.wizardDot) <= state.manualStep));
  document.querySelector('#manual-wizard-prev').disabled = state.manualStep === 1;
  document.querySelector('#manual-wizard-next').hidden = state.manualStep === 3;
  document.querySelector('#manual-wizard-submit').hidden = state.manualStep !== 3;
  document.querySelector('#manual-wizard-submit').textContent = state.editingManualEventId ? 'Сохранить событие' : 'Создать событие';
  document.querySelector('#manual-wizard-cancel').hidden = !state.editingManualEventId;
}

function manualFormPayload() {
  return {
    sport_type: document.querySelector('#manual-event-type').value,
    sport_key: document.querySelector('#manual-event-sport').value,
    sport_title: document.querySelector('#manual-event-sport-new').value,
    home_team_id: document.querySelector('#manual-event-home').value,
    home_team_name: document.querySelector('#manual-event-home-new').value,
    away_team_id: document.querySelector('#manual-event-away').value,
    away_team_name: document.querySelector('#manual-event-away-new').value,
    commence_time: document.querySelector('#manual-event-time').value,
    status: document.querySelector('#manual-event-status').value,
    home_price: document.querySelector('#manual-odd-home').value,
    draw_price: document.querySelector('#manual-odd-draw').value,
    away_price: document.querySelector('#manual-odd-away').value,
    totals_enabled: document.querySelector('#manual-total-enabled').checked,
    total_line: document.querySelector('#manual-total-line').value,
    total_over_price: document.querySelector('#manual-total-over').value,
    total_under_price: document.querySelector('#manual-total-under').value,
    handicap_enabled: document.querySelector('#manual-handicap-enabled').checked,
    handicap_line: document.querySelector('#manual-handicap-line').value,
    handicap_home_price: document.querySelector('#manual-handicap-home').value,
    handicap_away_price: document.querySelector('#manual-handicap-away').value,
    video_enabled: document.querySelector('#manual-video-enabled').checked,
    video_yes_price: document.querySelector('#manual-video-yes').value,
    video_no_price: document.querySelector('#manual-video-no').value,
    player_name: document.querySelector('#manual-player-name').value,
    player_goal_enabled: document.querySelector('#manual-player-goal-enabled').checked,
    player_goal_yes_price: document.querySelector('#manual-player-goal-yes').value,
    player_goal_no_price: document.querySelector('#manual-player-goal-no').value,
    player_assist_enabled: document.querySelector('#manual-player-assist-enabled').checked,
    player_assist_yes_price: document.querySelector('#manual-player-assist-yes').value,
    player_assist_no_price: document.querySelector('#manual-player-assist-no').value,
  };
}

function editManualEvent(eventId) {
  const event = state.manualData.events.find((item) => item.id === eventId);
  if (!event) return;
  const config = event.raw_payload?.market_config || {};
  state.editingManualEventId = eventId;
  document.querySelector('#manual-event-type').value = config.sport_type || sportTypeFromKey(event.sport_key);
  renderManualConstructor();
  document.querySelector('#manual-event-sport').value = event.sport_key;
  document.querySelector('#manual-event-sport-new').value = '';
  document.querySelector('#manual-event-home').value = event.home_team_id || '';
  document.querySelector('#manual-event-home-new').value = event.home_team_id ? '' : event.home_team_raw;
  document.querySelector('#manual-event-away').value = event.away_team_id || '';
  document.querySelector('#manual-event-away-new').value = event.away_team_id ? '' : event.away_team_raw;
  document.querySelector('#manual-event-time').value = toDatetimeLocal(event.commence_time);
  document.querySelector('#manual-event-status').value = event.status || 'upcoming';
  populateManualOdds(event);
  setManualWizardStep(1);
  document.querySelector('#manual-event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateManualOdds(event) {
  const odds = event.odds || [];
  const byKey = Object.fromEntries(odds.map((odd) => [odd.selection_key, odd]));
  document.querySelector('#manual-odd-home').value = byKey.home_win?.price || '1.80';
  document.querySelector('#manual-odd-draw').value = byKey.draw?.price || '3.20';
  document.querySelector('#manual-odd-away').value = byKey.away_win?.price || '2.10';

  const totalOver = odds.find((odd) => odd.selection_key.startsWith('total_over'));
  const totalUnder = odds.find((odd) => odd.selection_key.startsWith('total_under'));
  document.querySelector('#manual-total-enabled').checked = Boolean(totalOver && totalUnder);
  document.querySelector('#manual-total-line').value = totalOver ? lineFromSelection(totalOver.selection_key) : '2.5';
  document.querySelector('#manual-total-over').value = totalOver?.price || '1.90';
  document.querySelector('#manual-total-under').value = totalUnder?.price || '1.90';

  const handicapHome = odds.find((odd) => odd.selection_key.startsWith('handicap_home'));
  const handicapAway = odds.find((odd) => odd.selection_key.startsWith('handicap_away'));
  document.querySelector('#manual-handicap-enabled').checked = Boolean(handicapHome && handicapAway);
  document.querySelector('#manual-handicap-line').value = handicapHome ? lineFromSelection(handicapHome.selection_key) : '-1.5';
  document.querySelector('#manual-handicap-home').value = handicapHome?.price || '1.90';
  document.querySelector('#manual-handicap-away').value = handicapAway?.price || '1.90';

  document.querySelector('#manual-video-enabled').checked = Boolean(byKey.video_review_yes && byKey.video_review_no);
  document.querySelector('#manual-video-yes').value = byKey.video_review_yes?.price || '2.40';
  document.querySelector('#manual-video-no').value = byKey.video_review_no?.price || '1.50';

  const playerName = event.raw_payload?.market_config?.player_name || '';
  document.querySelector('#manual-player-name').value = playerName;
  document.querySelector('#manual-player-goal-enabled').checked = Boolean(byKey.player_goal_yes && byKey.player_goal_no);
  document.querySelector('#manual-player-goal-yes').value = byKey.player_goal_yes?.price || '2.20';
  document.querySelector('#manual-player-goal-no').value = byKey.player_goal_no?.price || '1.60';
  document.querySelector('#manual-player-assist-enabled').checked = Boolean(byKey.player_assist_yes && byKey.player_assist_no);
  document.querySelector('#manual-player-assist-yes').value = byKey.player_assist_yes?.price || '2.80';
  document.querySelector('#manual-player-assist-no').value = byKey.player_assist_no?.price || '1.35';
}

async function deleteManualEvent(eventId) {
  if (!window.confirm('Удалить событие? Если по нему есть ставки, оно будет отменено.')) return;
  showLoading('Событие', 'Удаляю событие...');
  try {
    const result = await apiFetch(`/api/admin/manual-events/${eventId}`, { method: 'DELETE' });
    state.manualData = result;
    renderManualConstructor();
    await loadSports().catch(() => {});
    await loadEvents().catch(() => {});
    notify(result.cancelled ? 'Событие отменено, потому что по нему есть ставки' : 'Событие удалено', 'success');
  } finally {
    hideLoading();
  }
}

async function deleteManualSport(sportKey) {
  if (!window.confirm('Удалить соревнование? Если внутри есть события со ставками, они будут отменены, а соревнование будет отключено.')) return;
  showLoading('Соревнование', 'Удаляю ручное соревнование и связанные события...');
  try {
    const result = await apiFetch(`/api/admin/manual-sports/${encodeURIComponent(sportKey)}`, { method: 'DELETE' });
    state.manualData = result;
    renderManualConstructor();
    await loadSports().catch(() => {});
    await loadEvents().catch(() => {});
    notify(result.disabled ? 'Соревнование отключено, потому что внутри есть ставки' : 'Соревнование удалено', 'success');
  } finally {
    hideLoading();
  }
}

function resetManualWizard() {
  document.querySelector('#manual-event-form').reset();
  state.editingManualEventId = null;
  state.manualStep = 1;
  renderManualConstructor();
}

function manualSportMatches(sport, sportType) {
  if (sportType === 'soccer') {
    return sport.sport_key?.startsWith('soccer_')
      || sport.sport_key?.startsWith('manual_soccer_')
      || sport.group_name === 'soccer'
      || sport.group_name === 'Manual'
      || (sport.source === 'manual' && !sport.sport_key?.includes('hockey') && !sport.sport_key?.includes('esports'));
  }
  return sport.sport_key?.startsWith(`manual_${sportType}_`) || sport.group_name === sportType;
}

function sportTypeFromKey(sportKey) {
  if (sportKey?.includes('hockey')) return 'hockey';
  if (sportKey?.includes('esports')) return 'esports';
  return 'soccer';
}

function sportTypeOptions(selected = 'soccer') {
  return Object.entries(sportTypeLabels).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function lineFromSelection(selectionKey) {
  const parts = selectionKey.split('_');
  const marker = parts[parts.length - 1] || '';
  const sign = marker.startsWith('m') ? -1 : 1;
  const raw = marker.replace(/^[mp]/, '').replaceAll('p', '.');
  return sign * Number(raw || 0);
}

async function settleManualListEvent(eventId) {
  const home = Number(document.querySelector(`[data-manual-home-score="${eventId}"]`).value);
  const away = Number(document.querySelector(`[data-manual-away-score="${eventId}"]`).value);
  if (Number.isNaN(home) || Number.isNaN(away)) {
    notify('Введите счёт матча', 'error');
    return;
  }
  showLoading('Ручной расчёт', 'Сохраняю результат...');
  try {
    const result = await apiFetch(`/api/admin/events/${eventId}/manual-result`, {
      method: 'POST',
      body: JSON.stringify({ home_score: home, away_score: away }),
    });
    notify(`Рассчитано ставок: ${result.result.bets_settled}`, 'success');
    await loadManualConstructor();
    await loadSettlementRuns().catch(() => {});
  } finally {
    hideLoading();
  }
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
  showLoading('Ручной расчёт', 'Сохраняю результат...');
  try {
    const result = await apiFetch(`/api/admin/events/${eventId}/manual-result`, {
      method: 'POST',
      body: JSON.stringify({ home_score: home, away_score: away }),
    });
    notify(`Рассчитано ставок: ${result.result.bets_settled}`, 'success');
    await loadSettlementRuns();
  } finally {
    hideLoading();
  }
}

function openAdminDrawer(route = 'menu') {
  if (!state.me?.user?.is_admin) return;
  document.body.classList.add('no-scroll');
  document.querySelector('#open-admin')?.classList.add('active');
  document.querySelector('#admin-drawer').classList.add('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('#admin-backdrop').hidden = true;
  navigateAdmin(route);
}

function closeAdminDrawer() {
  document.body.classList.remove('no-scroll');
  document.querySelector('#open-admin')?.classList.remove('active');
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'true');
  document.querySelector('#admin-backdrop').hidden = true;
  if (location.hash.startsWith('#/admin')) history.replaceState(null, '', location.pathname + location.search);
  switchTab('events');
}

function navigateAdmin(route = 'menu') {
  if (!state.me?.user?.is_admin) return;
  if (!document.querySelector(`#admin-page-${route}`)) route = 'menu';
  document.querySelectorAll('.admin-page').forEach((page) => page.classList.remove('active'));
  document.querySelector(`#admin-page-${route}`).classList.add('active');
  document.querySelector('#admin-title').textContent = adminTitles[route] || 'Админка';
  if (location.hash !== `#/admin${route === 'menu' ? '' : `/${route}`}`) {
    history.replaceState(null, '', `#/admin${route === 'menu' ? '' : `/${route}`}`);
  }
  if (route === 'sync') loadAdmin().catch((error) => status(error.message));
  if (route === 'api-usage') loadAdmin().catch((error) => status(error.message));
  if (route === 'users') loadUsers().catch((error) => status(error.message));
  if (route === 'all-bets') loadAdminBets().catch((error) => status(error.message));
  if (route === 'aliases') loadAliases().catch((error) => status(error.message));
  if (route === 'results') {
    loadSettlementRuns().catch((error) => status(error.message));
    loadAdminEvents().catch((error) => status(error.message));
  }
  if (route === 'constructor') {
    loadManualConstructor().catch((error) => status(error.message));
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
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#view-${tab}`).classList.add('active');
  if (tab === 'bets' || tab === 'history') loadBets().catch((error) => status(error.message));
  if (tab === 'profile') renderProfileView();
}

function openCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = false;
}

function closeCreateUserModal() {
  document.querySelector('#create-user-modal').hidden = true;
  document.querySelector('#create-user-form').reset();
}

function setupSwipe() {
  const handle = document.querySelector('#ticket-handle');
  let ticketStartY = 0;
  handle.addEventListener('touchstart', (event) => {
    ticketStartY = event.touches[0].clientY;
  }, { passive: true });
  handle.addEventListener('touchend', (event) => {
    if (event.changedTouches[0].clientY - ticketStartY > 36) {
      state.ticketExpanded = false;
      renderTicket();
    }
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
  const sport = [...(state.aliases?.sports || []), ...(state.manualData?.sports || []), ...(state.sports || [])].find((item) => item.sport_key === sportKey);
  return sport?.title_ru || sport?.title || sport?.title_en || defaultSportTitles[sportKey] || sportKey;
}

function syncSportKeys() {
  const keys = state.sports.map((sport) => sport.sport_key).filter((key) => key && !key.startsWith('manual_'));
  return [...new Set([...defaultSportKeys, ...keys])];
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

document.querySelectorAll('.tab[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelector('#toggle-ticket').addEventListener('click', () => {
  state.ticketExpanded = !state.ticketExpanded;
  renderTicket();
});
document.querySelector('#ticket-handle').addEventListener('click', () => {
  state.ticketExpanded = false;
  renderTicket();
});
document.querySelector('#clear-ticket').addEventListener('click', clearTicket);
document.querySelector('#stake').addEventListener('input', (event) => {
  state.stake = Number(event.target.value);
  renderTicket();
});
document.querySelector('#place-bet').addEventListener('click', () => submitBet().catch((error) => status(error.message)));
document.querySelector('#notice-close').addEventListener('click', closeNotice);
document.querySelector('#notice-modal').addEventListener('click', (event) => {
  if (event.target.id === 'notice-modal') closeNotice();
});
document.querySelector('#open-profile').addEventListener('click', openProfileCard);
document.querySelector('#close-profile').addEventListener('click', closeProfileCard);
document.querySelector('#profile-modal').addEventListener('click', (event) => {
  if (event.target.id === 'profile-modal') closeProfileCard();
});
document.querySelector('#event-modal').addEventListener('click', (event) => {
  if (event.target.id === 'event-modal') closeEventCard();
});
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
document.querySelector('#reload-admin-bets').addEventListener('click', () => loadAdminBets().catch((error) => status(error.message)));
document.querySelector('#admin-bets-sort').addEventListener('change', () => loadAdminBets().catch((error) => status(error.message)));
document.querySelector('#reload-aliases').addEventListener('click', () => loadAliases().catch((error) => status(error.message)));
document.querySelector('#sync-results').addEventListener('click', () => syncResults().catch((error) => {
  status(error.message);
  renderActionError(error, '#settlement-report');
}));
document.querySelector('#manual-settle').addEventListener('click', () => manualSettle().catch((error) => status(error.message)));
document.querySelector('#manual-event-form').addEventListener('submit', (event) => createManualEvent(event).catch((error) => {
  notify(error.message, 'error');
  hideLoading();
}));
document.querySelector('#manual-wizard-next').addEventListener('click', () => setManualWizardStep(state.manualStep + 1));
document.querySelector('#manual-wizard-prev').addEventListener('click', () => setManualWizardStep(state.manualStep - 1));
document.querySelector('#manual-wizard-cancel').addEventListener('click', resetManualWizard);
document.querySelector('#manual-event-type').addEventListener('change', () => renderManualConstructor());
document.querySelector('#open-create-user').addEventListener('click', openCreateUserModal);
document.querySelector('#close-create-user').addEventListener('click', closeCreateUserModal);
document.querySelector('#create-user-form').addEventListener('submit', (event) => createUser(event).catch((error) => status(error.message)));
window.addEventListener('hashchange', handleHash);

prepareWelcome();
setupSwipe();
init();
