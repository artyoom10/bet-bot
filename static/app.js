const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  me: null,
  sports: [],
  activeSportType: 'all',
  allEvents: [],
  events: [],
  adminEvents: [],
  bets: [],
  users: [],
  adminBets: [],
  adminSelectedUserId: '',
  league: null,
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
  collapsedLeagues: new Set(),
  scrollLocks: new Set(),
  lockedScrollY: 0,
};

const labels = { home_win: 'П1', draw: 'X', away_win: 'П2', home_or_draw: '1X', home_or_away: '12', draw_or_away: 'X2' };
const statusLabels = { pending: 'ожидает', won: 'выигрыш', lost: 'проигрыш', refund: 'возврат', cancelled: 'отменена' };
const eventStatusLabels = { upcoming: 'ожидает', finished: 'завершён', cancelled: 'отменён' };
const clientStatusLabels = {
  'Железо': 'Железо',
  'Бронза': 'Бронза',
  'Серебро': 'Серебро',
  'Золото': 'Золото',
  'Платина': 'Платина',
  'Изумруд': 'Изумруд',
  'Сапфир': 'Сапфир',
  'Рубин': 'Рубин',
  'Алмаз': 'Алмаз',
  new: 'Железо',
  active: 'Железо',
  'Новичок': 'Железо',
};
const sportTypeLabels = { soccer: 'Футбол', hockey: 'Хоккей', esports: 'Киберспорт' };
const marketTitles = {
  h2h: 'Исход матча',
  h2h_3_way: 'Исход матча',
  double_chance: 'Двойной шанс',
  totals: 'Тотал',
  alternate_totals: 'Альтернативный тотал',
  alternate_totals_h1: 'Альтернативный тотал 1-го тайма',
  alternate_totals_h2: 'Альтернативный тотал 2-го тайма',
  spreads: 'Фора',
  alternate_spreads: 'Альтернативная фора',
  alternate_spreads_h1: 'Альтернативная фора 1-го тайма',
  alternate_spreads_h2: 'Альтернативная фора 2-го тайма',
  video_review: 'Видеопросмотр',
  player_goal: 'Гол игрока',
  player_assist: 'Передача игрока',
};
const defaultSportKeys = ['soccer_epl', 'soccer_russia_premier_league', 'soccer_spain_la_liga', 'soccer_uefa_champs_league', 'icehockey_nhl'];
const defaultSportTitles = {
  soccer_epl: 'Английская Премьер-лига',
  soccer_russia_premier_league: 'Российская Премьер-Лига',
  soccer_spain_la_liga: 'Ла Лига',
  soccer_uefa_champs_league: 'Лига чемпионов',
  icehockey_nhl: 'НХЛ',
};
const minStake = 30;
const stakePresetPercents = [10, 20, 50, 100];
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
  'all-events': 'Все события',
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

function lockBodyScroll(reason) {
  if (!state.scrollLocks.size) {
    state.lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${state.lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  state.scrollLocks.add(reason);
  document.body.classList.add('no-scroll');
}

function unlockBodyScroll(reason) {
  state.scrollLocks.delete(reason);
  if (!state.scrollLocks.size) {
    document.body.classList.remove('no-scroll');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, state.lockedScrollY || 0);
  }
}

function showLoading(title, text = 'Подождите, операция выполняется.') {
  const modal = document.querySelector('#loading-modal');
  modal.className = 'loading-modal';
  modal.querySelectorAll('.loading-confetti, .wheel-stage').forEach((item) => item.remove());
  document.querySelector('#loading-title').textContent = title;
  document.querySelector('#loading-text').textContent = text;
  modal.hidden = false;
  lockBodyScroll('loading');
}

function updateLoading(text) {
  document.querySelector('#loading-text').textContent = text;
}

function showLoadingSuccess(title = 'Готово', text = '') {
  showLoading(title, text);
  addSuccessConfetti(64);
  triggerSuccessHaptics();
}

function addSuccessConfetti(count = 64) {
  const modal = document.querySelector('#loading-modal');
  modal.classList.add('success');
  const card = modal.querySelector('.loading-card');
  const confetti = document.createElement('div');
  confetti.className = 'loading-confetti';
  const colors = ['#2f80ed', '#16a36a', '#f3b51f', '#9cc8ff', '#f08bb4'];
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('span');
    piece.style.setProperty('--x', `${Math.round((Math.random() * 420) - 210)}px`);
    piece.style.setProperty('--y', `${Math.round(170 + (Math.random() * 230))}px`);
    piece.style.setProperty('--r', `${Math.round((Math.random() * 360) - 180)}deg`);
    piece.style.setProperty('--delay', `${Math.random() * 620}ms`);
    piece.style.setProperty('--confetti-color', colors[index % colors.length]);
    confetti.appendChild(piece);
  }
  card.appendChild(confetti);
}

function triggerSuccessHaptics() {
  tg?.HapticFeedback?.notificationOccurred('success');
  window.setTimeout(() => tg?.HapticFeedback?.impactOccurred('light'), 180);
  window.setTimeout(() => tg?.HapticFeedback?.impactOccurred('medium'), 460);
}

function hideLoading() {
  const modal = document.querySelector('#loading-modal');
  modal.hidden = true;
  modal.className = 'loading-modal';
  modal.querySelectorAll('.loading-confetti, .wheel-stage').forEach((item) => item.remove());
  unlockBodyScroll('loading');
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function showBlockedScreen(reason) {
  window.clearInterval(welcomeMessageTimer);
  welcomeMessageTimer = null;
  document.querySelector('.page').hidden = true;
  document.querySelector('#bet-slip').hidden = true;
  document.querySelector('.bottom-nav').hidden = true;
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-backdrop').hidden = true;
  document.querySelector('#welcome-screen').hidden = true;
  document.querySelector('#blocked-reason').textContent = reason || 'Доступ к приложению временно ограничен.';
  document.querySelector('#blocked-screen').hidden = false;
}

function showClubDeniedScreen(message = 'Вы не являетесь членом данного клуба') {
  window.clearInterval(welcomeMessageTimer);
  welcomeMessageTimer = null;
  document.querySelector('.page').hidden = true;
  document.querySelector('.bottom-nav').hidden = true;
  document.querySelector('#bet-slip').hidden = true;
  document.querySelector('#admin-drawer').classList.remove('open');
  document.querySelector('#admin-backdrop').hidden = true;
  document.querySelector('#welcome-screen').hidden = true;
  document.querySelector('#club-denied-text').textContent = message;
  document.querySelector('#club-denied-screen').hidden = false;
  lockBodyScroll('club-denied');
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
      const timeoutError = new Error('Запрос выполнялся слишком долго. Проверьте последние sync runs и попробуйте ещё раз.');
      timeoutError.timeout = true;
      timeoutError.path = path;
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function init() {
  const canUseApp = await loadMe().catch((error) => {
    if (error.status === 403 || error.data?.error === 'not_member') {
      showClubDeniedScreen(error.data?.message || 'Вы не являетесь членом данного клуба');
      return false;
    }
    status(`Профиль не загружен: ${error.message}`);
    finishWelcome(telegramFallbackName() || 'Игрок');
    return false;
  });
  if (!canUseApp) return;
  await loadLeague({ silent: true }).catch((error) => status(`Лига не загружена: ${error.message}`));
  await loadSports({ render: false }).catch((error) => status(`Турниры не загружены: ${error.message}`));
  await loadEvents().catch((error) => status(`Линия не загружена: ${error.message}`));
  handleHash();
}

async function loadMe() {
  const data = await apiFetch('/api/me');
  if (data.access_denied) {
    showClubDeniedScreen(data.message || 'Вы не являетесь членом данного клуба');
    return false;
  }
  state.me = data;
  const profileName = renderMe();
  setAdminVisibility(Boolean(data.user.is_admin));
  if (data.user.is_blocked) {
    showBlockedScreen(data.user.block_reason);
    return false;
  }
  status('');
  finishWelcome(profileName);
  return true;
}

function renderMe() {
  const profileName = resolveProfileName(state.me);
  document.querySelector('#profile-name').innerHTML = `${escapeHtml(profileName)}${rankAvatarHtml(state.league?.current, profileName)}`;
  document.querySelector('#balance-value').innerHTML = moneyHtml(state.me.wallet.balance);
  renderProfileView();
  return profileName;
}

async function refreshMe() {
  const button = document.querySelector('#refresh-profile');
  button?.classList.add('loading');
  try {
    await reloadMeSilently();
  } finally {
    button?.classList.remove('loading');
  }
}

async function reloadMeSilently() {
  const data = await apiFetch('/api/me', { timeoutMs: 15000 });
  if (data.access_denied) {
    showClubDeniedScreen(data.message || 'Вы не являетесь членом данного клуба');
    return;
  }
  state.me = data;
  renderMe();
  setAdminVisibility(Boolean(state.me.user.is_admin));
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
    unlockBodyScroll('admin');
    if (location.hash.startsWith('#/admin')) history.replaceState(null, '', location.pathname + location.search);
  }
}

function resolveProfileName(data) {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const dbName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ');
  const tgName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ');
  return dbName || tgName || data.user.username || tgUser?.username || 'Игрок';
}

function rankAvatarHtml(rank, fallback = '') {
  const title = rank?.title || rank?.league || '';
  const logo = rank?.rank_logo_url || rank?.logo_url;
  if (logo) {
    return `<img class="rank-avatar" src="${escapeAttr(logo)}" alt="${escapeAttr(title || fallback)}" onerror="this.replaceWith(rankAvatarFallback(this.alt))">`;
  }
  const letter = String(title || fallback || 'И').trim().slice(0, 1).toUpperCase();
  return `<span class="rank-avatar placeholder">${escapeHtml(letter)}</span>`;
}

function rankAvatarFallback(text = '') {
  const span = document.createElement('span');
  span.className = 'rank-avatar placeholder';
  span.textContent = String(text || 'И').trim().slice(0, 1).toUpperCase();
  return span;
}

function telegramFallbackName() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  return [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || tgUser?.username || '';
}

async function loadSports({ render = true } = {}) {
  state.sports = await apiFetch('/api/sports');
  if (render) renderSports();
}

function renderSports() {
  const root = document.querySelector('#sports');
  const items = sportTypeFilters();
  root.innerHTML = items.map((sport) => `
    <button class="sport-chip ${state.activeSportType === sport.key ? 'active' : ''}" data-sport-type="${sport.key}">
      <span class="sport-icon" aria-hidden="true">${sportIcon(sport.iconKey, sport.title)}</span>
      <span class="sport-copy"><span>${escapeHtml(sport.title)}</span><strong>${sport.events_count}</strong></span>
    </button>
  `).join('');
  document.querySelectorAll('[data-sport-type]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.activeSportType = button.dataset.sportType;
      filterEvents();
    });
  });
}

function sportTypeFilters() {
  const counts = { all: 0, soccer: 0, hockey: 0, esports: 0 };
  const source = state.allEvents.length ? state.allEvents : state.sports.flatMap((sport) => (
    Array.from({ length: Number(sport.events_count || 0) }, () => ({ sport_key: sport.sport_key }))
  ));
  source.forEach((item) => {
    const type = sportTypeFromKey(item.sport_key);
    counts.all += 1;
    if (counts[type] !== undefined) counts[type] += 1;
  });
  return [
    { key: 'all', title: 'Все', iconKey: '', events_count: counts.all },
    { key: 'soccer', title: 'Футбол', iconKey: 'soccer', events_count: counts.soccer },
    { key: 'hockey', title: 'Хоккей', iconKey: 'hockey', events_count: counts.hockey },
    { key: 'esports', title: 'Киберспорт', iconKey: 'esports', events_count: counts.esports },
  ];
}

function sportIcon(sportKey = '', title = '') {
  const value = `${sportKey} ${title}`.toLowerCase();
  if (!sportKey) {
    return '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 6v12M16 6v12"/></svg>';
  }
  if (value.includes('hockey') || value.includes('хоккей')) {
    return '<svg viewBox="0 0 24 24"><path d="M7 4l3.2 12.5c.4 1.5 1.7 2.5 3.2 2.5H19"/><path d="M17 4l-3.2 12.5c-.4 1.5-1.7 2.5-3.2 2.5H5"/><path d="M8 20h8"/><path d="M10 15h4"/><path d="M18.5 17.5h2.5"/></svg>';
  }
  if (value.includes('esport') || value.includes('кибер')) {
    return '<svg viewBox="0 0 24 24"><path d="M7 9h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5.2 2l-1.3-1H9.5l-1.3 1A3 3 0 0 1 3 15v-2a4 4 0 0 1 4-4Z"/><path d="M8 12v3M6.5 13.5h3M15 13h.01M18 13h.01"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="M12 7l3 2.2-1.1 3.5h-3.8L9 9.2 12 7Z"/><path d="M12 3v4M4.7 8.1 9 9.2M7.5 19l2.6-6.3M16.5 19l-2.6-6.3M19.3 8.1 15 9.2"/></svg>';
}

async function loadEvents() {
  state.allEvents = await apiFetch('/api/events');
  filterEvents();
}

function filterEvents() {
  state.events = state.activeSportType === 'all'
    ? state.allEvents
    : state.allEvents.filter((event) => sportTypeFromKey(event.sport_key) === state.activeSportType);
  renderSports();
  renderEvents();
  renderManualEventOptions();
}

function renderEvents() {
  const root = document.querySelector('#events');
  if (!state.events.length) {
    const sport = sportTypeFilters().find((item) => item.key === state.activeSportType)?.title || 'выбранного спорта';
    root.innerHTML = `<article class="empty-state">Нет prematch-событий для ${escapeHtml(sport)}. Если матчи есть в Odds API, проверьте регионы и подробный debug синхронизации.</article>`;
    return;
  }
  const groups = groupBy(state.events, (event) => event.sport_key);
  root.innerHTML = Object.entries(groups).map(([sportKey, events]) => {
    const league = events[0]?.league_title || sportTitle(sportKey);
    const isOpen = !state.collapsedLeagues.has(sportKey);
    return `
    <details class="league-block" data-league-key="${escapeAttr(sportKey)}" ${isOpen ? 'open' : ''}>
      <summary class="league-head">${leagueLogo(events[0])}<strong>${escapeHtml(league)}</strong><span>${events.length}</span></summary>
      ${events.map(renderEvent).join('')}
    </details>
  `;
  }).join('');
  document.querySelectorAll('[data-league-key]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        state.collapsedLeagues.delete(details.dataset.leagueKey);
      } else {
        state.collapsedLeagues.add(details.dataset.leagueKey);
      }
    });
  });
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
      </div>
      <div class="market-row ${event.odds.outcomes.length === 2 ? 'two' : ''}">
        ${event.odds.outcomes.map((outcome) => {
          const active = state.selections.some((item) => item.event.id === event.id && item.outcome.selection_key === outcome.selection_key);
          return `
            <button class="odd-cell ${active ? 'active' : ''}" data-event="${event.id}" data-bookmaker="${event.odds.bookmaker_key}" data-market="${event.odds.market_key}" data-selection="${outcome.selection_key}">
              <span>${escapeHtml(shortOutcomeLabel(outcome, event.odds.market_key, event))}</span><strong>${Number(outcome.price).toFixed(2)}</strong>
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

function leagueLogo(event) {
  if (event?.league_logo_url) {
    return `<img class="league-logo" src="${escapeAttr(event.league_logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'league-logo placeholder'}))">`;
  }
  return `<span class="league-logo placeholder">${sportIcon(event?.sport_key || '', event?.league_title || '')}</span>`;
}

function marketTitleFor(marketKey, sportKey = '') {
  if (marketKey === 'h2h' && sportKey.startsWith('icehockey_')) return 'Итоговая победа';
  return marketTitles[marketKey] || marketKey;
}

function shortOutcomeLabel(outcome, marketKey = '', event = null) {
  if (['h2h', 'h2h_3_way', 'double_chance'].includes(marketKey) && labels[outcome.selection_key]) {
    return labels[outcome.selection_key];
  }
  return outcomeNameRu(outcome, marketKey, event);
}

function outcomeNameRu(outcome, marketKey = '', event = null) {
  const key = outcome?.selection_key || '';
  const name = String(outcome?.name || outcome?.label || '').trim();
  if (key === 'home_win') return event?.home_team?.name || 'П1';
  if (key === 'draw') return 'Ничья';
  if (key === 'away_win') return event?.away_team?.name || 'П2';
  if (key === 'home_or_draw') return '1X';
  if (key === 'home_or_away') return '12';
  if (key === 'draw_or_away') return 'X2';
  if (key.startsWith('total_over')) return `ТБ ${formatLineLabel(lineFromSelection(key))}`;
  if (key.startsWith('total_under')) return `ТМ ${formatLineLabel(lineFromSelection(key))}`;
  if (key.startsWith('handicap_home')) return `Ф1 (${formatSignedLineLabel(lineFromSelection(key))})`;
  if (key.startsWith('handicap_away')) return `Ф2 (${formatSignedLineLabel(lineFromSelection(key))})`;

  const lowerName = name.toLowerCase();
  const line = extractLineLabel(name);
  if (isTotalMarketKey(marketKey)) {
    if (lowerName.includes('over')) return `ТБ ${line || ''}`.trim();
    if (lowerName.includes('under')) return `ТМ ${line || ''}`.trim();
  }
  if (isSpreadMarketKey(marketKey)) {
    if (matchesTeamName(name, event?.home_team)) return `Ф1 (${line || '0'})`;
    if (matchesTeamName(name, event?.away_team)) return `Ф2 (${line || '0'})`;
  }
  if (lowerName === 'draw') return 'Ничья';
  if (matchesTeamName(name, event?.home_team)) return event.home_team.name;
  if (matchesTeamName(name, event?.away_team)) return event.away_team.name;
  return name || key || 'Исход';
}

function matchesTeamName(name, team) {
  if (!name || !team) return false;
  const normalized = String(name).trim().toLowerCase();
  return [team.name, team.raw_name].filter(Boolean).some((value) => normalized.includes(String(value).trim().toLowerCase()));
}

function isTotalMarketKey(marketKey = '') {
  return marketKey === 'totals' || marketKey.startsWith('alternate_totals');
}

function isSpreadMarketKey(marketKey = '') {
  return marketKey === 'spreads' || marketKey.startsWith('alternate_spreads');
}

function extractLineLabel(value) {
  const match = String(value || '').match(/[+-]?\s*\d+(?:[.,]\d+)?/);
  return match ? match[0].replace(/\s+/g, '').replace('.', ',') : '';
}

function formatLineLabel(value) {
  return Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1, maximumFractionDigits: 2 });
}

function formatSignedLineLabel(value) {
  const number = Number(value || 0);
  const label = formatLineLabel(Math.abs(number));
  if (number > 0) return `+${label}`;
  if (number < 0) return `-${label}`;
  return '0';
}

function openEventCard(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  state.selectedEventId = eventId;
  document.querySelector('#event-card').innerHTML = `
    <header class="full-page-head">
      <div><p class="label">${escapeHtml(event.league_title)}</p><h2>${escapeHtml(event.home_team.name)} — ${escapeHtml(event.away_team.name)}</h2></div>
      <button class="plain-icon-button modal-back-icon" type="button" id="close-event-card" aria-label="Назад">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
    </header>
    <div class="match-hero">
      <div>${teamLogo(event.home_team)}<strong>${escapeHtml(event.home_team.name)}</strong></div>
      <span>${formatDate(event.commence_time)}</span>
      <div>${teamLogo(event.away_team)}<strong>${escapeHtml(event.away_team.name)}</strong></div>
    </div>
    ${(event.markets?.length ? event.markets : [event.odds]).map((market) => `
      <section class="market-section">
        <h3>${escapeHtml(market.title || marketTitleFor(market.market_key, event.sport_key))}</h3>
        <div class="market-row ${market.outcomes.length === 2 ? 'two' : ''}">
          ${market.outcomes.map((outcome) => {
            const active = state.selections.some((item) => item.event.id === event.id && item.outcome.selection_key === outcome.selection_key && item.market_key === market.market_key);
            return `
              <button class="odd-cell ${active ? 'active' : ''}" data-modal-selection data-event="${event.id}" data-bookmaker="${market.bookmaker_key}" data-market="${market.market_key}" data-selection="${outcome.selection_key}">
                <span>${escapeHtml(outcomeNameRu(outcome, market.market_key, event))}</span><strong>${Number(outcome.price).toFixed(2)}</strong>
              </button>
            `;
          }).join('')}
        </div>
      </section>
    `).join('')}
  `;
  document.querySelector('#event-modal').hidden = false;
  lockBodyScroll('event');
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
  unlockBodyScroll('event');
  state.selectedEventId = null;
}

function toggleSelection(button) {
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const event = state.events.find((item) => item.id === button.dataset.event);
  if (!event) return;
  const market = findEventMarket(event, button.dataset.market, button.dataset.bookmaker);
  if (!market) return;
  const outcome = market.outcomes.find((item) => item.selection_key === button.dataset.selection);
  if (!outcome) return;
  const same = state.selections.some((item) => item.event.id === event.id && item.market_key === market.market_key && item.outcome.selection_key === outcome.selection_key);
  if (same) {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
  } else {
    state.selections = state.selections.filter((item) => item.event.id !== event.id);
    state.selections.push({ event, outcome, bookmaker_key: market.bookmaker_key, market_key: market.market_key, market_title: market.title || marketTitleFor(market.market_key, event.sport_key) });
  }
  renderEvents();
  window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
    unlockBodyScroll('ticket');
    return;
  }
  slip.hidden = false;
  slip.classList.toggle('expanded', state.ticketExpanded);
  if (state.ticketExpanded) {
    lockBodyScroll('ticket');
  } else {
    unlockBodyScroll('ticket');
  }
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
  document.querySelector('#stake-presets').innerHTML = stakePresetsByBalance().map((amount) => `
    <button type="button" class="${Number(state.stake) === amount ? 'active' : ''}" data-stake-preset="${amount}">${moneyHtml(amount)}</button>
  `).join('');
  document.querySelector('#ticket-list').innerHTML = state.selections.map((item, index) => `
    <article class="ticket-item">
      <div>
        <strong>${escapeHtml(item.event.home_team.name)} — ${escapeHtml(item.event.away_team.name)}</strong>
        <p>${ticketSelectionPrefix(item)} ${escapeHtml(item.market_title || marketTitleFor(item.market_key, item.event.sport_key))} · ${escapeHtml(outcomeNameRu(item.outcome, item.market_key, item.event))}</p>
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

function stakePresetsByBalance() {
  const balance = Number(state.me?.wallet?.balance || 0);
  if (balance < minStake) return [];
  const amounts = stakePresetPercents
    .map((percent) => Math.max(minStake, Math.ceil((balance * percent) / 100)))
    .filter((amount) => amount <= balance);
  return [...new Set(amounts)];
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
    clearTicket();
    await loadBets();
    showLoadingSuccess('Ставка принята');
    await delay(4400);
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
    root.innerHTML = renderEmptyState(selector, emptyText);
    return;
  }
  root.innerHTML = bets.map(renderBetCard).join('');
}

function renderEmptyState(selector, emptyText) {
  const titles = {
    '#bets': ['Пари появятся здесь', 'Выберите исход в линии, и купон сразу станет доступен внизу экрана.'],
    '#history': ['История пока пустая', 'После расчёта ставок здесь будут выигрыши, проигрыши и возвраты.'],
  };
  const [title, subtitle] = titles[selector] || [emptyText, ''];
  return `
    <article class="empty-state empty-state-center">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 4h12a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2-3-2V6a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 13h5"/></svg>
      </div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(subtitle || emptyText)}</p>
    </article>
  `;
}

function renderBetCard(bet) {
  const settlement = betSettlementView(bet);
  return `
    <article class="bet-row ${bet.status}">
      <div class="bet-main">
        <div class="bet-top">
          <time>${formatDate(bet.created_at)}</time>
          <strong>${bet.bet_type === 'express' ? `Экспресс · ${bet.selections.length} событий` : 'Ординар'}</strong>
        </div>
        <div class="bet-summary-row">
          <div class="bet-stake">
            <span>Сумма</span>
            <strong>${moneyHtml(bet.amount)}</strong>
          </div>
          <div class="bet-settlement ${settlement.type}">
            <span>${settlement.label}</span>
            <strong>${settlement.value}</strong>
            <small>${Number(bet.total_odds).toFixed(2)}</small>
          </div>
        </div>
        <div class="selection-list">${bet.selections.map(renderBetSelection).join('')}</div>
      </div>
    </article>
  `;
}

function betSettlementView(bet) {
  if (bet.status === 'won') return { type: 'win', label: 'Выигрыш', value: moneyHtml(bet.payout ?? bet.possible_win) };
  if (bet.status === 'lost') return { type: 'loss', label: 'Проигрыш', value: moneyHtml(bet.amount) };
  if (bet.status === 'refund') return { type: 'refund', label: 'Возврат', value: moneyHtml(bet.payout ?? bet.amount) };
  if (bet.status === 'cancelled') return { type: 'refund', label: 'Отмена', value: moneyHtml(bet.payout ?? 0) };
  return { type: 'pending', label: 'Возможный выигрыш', value: moneyHtml(bet.possible_win) };
}

function renderBetSelection(selection) {
  const home = { name: selection.home_team_name_ru || eventNamePart(selection.event_name_ru, 0), logo_url: selection.home_team_logo_url };
  const away = { name: selection.away_team_name_ru || eventNamePart(selection.event_name_ru, 1), logo_url: selection.away_team_logo_url };
  const score = selectionScore(selection);
  const result = selectionResultView(selection);
  return `
    <article class="selection-card ${result.type}">
      <div class="selection-teams">
        <span>${teamLogo(home)}<strong>${escapeHtml(home.name || 'Команда 1')}</strong></span>
        <b>${score}</b>
        <span>${teamLogo(away)}<strong>${escapeHtml(away.name || 'Команда 2')}</strong></span>
      </div>
      <div class="selection-details">
        <span>${escapeHtml(marketTitleFor(selection.market_key))}</span>
        <strong>${escapeHtml(selectionDisplayName(selection, home, away))}</strong>
        <em class="result-icon ${result.type}" title="${escapeAttr(result.label)}" aria-label="${escapeAttr(result.label)}">${resultIcon(result.type)}</em>
      </div>
    </article>
  `;
}

function selectionDisplayName(selection, home, away) {
  const event = {
    home_team: { name: home.name, raw_name: home.name },
    away_team: { name: away.name, raw_name: away.name },
  };
  return outcomeNameRu(
    {
      selection_key: selection.selection_key,
      name: selection.selection_name_ru || selection.selection_name_raw,
      label: selection.selection_name_ru || selection.selection_name_raw,
    },
    selection.market_key,
    event,
  );
}

function eventNamePart(name = '', index = 0) {
  return String(name || '').split(' — ')[index] || '';
}

function selectionScore(selection) {
  if (selection.home_score === null || selection.home_score === undefined || selection.away_score === null || selection.away_score === undefined) {
    return '—';
  }
  return `${selection.home_score}:${selection.away_score}${resultNoteSuffix(selection.result_note)}`;
}

function selectionResultView(selection) {
  const status = selection.result_status;
  if (status === 'won') return { type: 'win', label: 'исход прошёл' };
  if (status === 'lost') return { type: 'loss', label: 'исход не прошёл' };
  if (status === 'refund') return { type: 'refund', label: 'возврат' };
  return { type: 'pending', label: selection.event_status === 'finished' ? 'ожидает расчёта' : 'матч не завершён' };
}

function resultIcon(type) {
  if (type === 'win') return '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  if (type === 'loss') return '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  if (type === 'refund') return '<svg viewBox="0 0 24 24"><path d="M6 8h9a4 4 0 1 1 0 8H8"/><path d="M8 5 5 8l3 3"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><path d="M21 12a9 9 0 1 1-9-9"/></svg>';
}

function resultNoteSuffix(note) {
  if (note === 'ot') return ' (ОТ)';
  if (note === 'so') return ' (Б)';
  return '';
}

function openProfileCard() {
  switchTab('profile');
}

function renderProfileView() {
  const user = state.me?.user;
  const wallet = state.me?.wallet;
  if (!user || !wallet) return;
  const league = state.league?.current || {};
  const profileName = resolveProfileName(state.me);
  const nextTitle = league.next_title ? `До ранга ${league.next_title}` : 'Максимальный ранг';
  const progress = Math.max(0, Math.min(100, Number(league.progress_percent || 0)));
  const content = `
    <div class="profile-rank-card">
      <div class="profile-rank-head">
        <span>${escapeHtml(league.title || clientStatusLabels[user.client_status] || user.client_status || 'Железо')}</span>
        ${rankAvatarHtml(league, profileName)}
      </div>
      <small>Чистая прибыль</small>
      <strong>${moneyHtml(league.total_profit || league.total_win || 0)}</strong>
      <div class="profile-progress"><i style="width:${progress}%"></i></div>
      <em>${escapeHtml(nextTitle)}: ${moneyHtml(league.remaining || 0)}</em>
    </div>
    <div class="profile-stats-grid">
      <div class="profile-stat"><span>Лига</span><strong>${escapeHtml(league.league || league.title || 'Железо')}</strong></div>
      <div class="profile-stat"><span>Крупнейший выигрыш</span><strong>${moneyHtml(league.biggest_win || 0)}</strong></div>
      <div class="profile-stat"><span>Крупнейший проигрыш</span><strong>${moneyHtml(league.biggest_loss || 0)}</strong></div>
      <div class="profile-stat"><span>Место</span><strong>${league.rank ? `#${league.rank}` : 'пока нет'}</strong></div>
    </div>
  `;
  document.querySelector('#profile-view-name').innerHTML = `${escapeHtml(profileName)}${rankAvatarHtml(league, profileName)}`;
  document.querySelector('#profile-view-balance').innerHTML = `<span class="profile-balance-label">Текущий баланс</span>${moneyHtml(wallet.balance)}`;
  document.querySelector('#profile-view-info').innerHTML = content;
  document.querySelector('#profile-card-name').innerHTML = `${escapeHtml(profileName)}${rankAvatarHtml(league, profileName)}`;
  document.querySelector('#profile-card-balance').innerHTML = `<span class="profile-balance-label">Текущий баланс</span>${moneyHtml(wallet.balance)}`;
  document.querySelector('#profile-card-info').innerHTML = content;
}

async function loadLeague({ silent = false } = {}) {
  if (!silent) {
    const root = document.querySelector('#league');
    if (root && !state.league) root.innerHTML = '<article class="empty-state">Загружаю лигу...</article>';
  }
  state.league = await apiFetch('/api/league');
  renderLeague();
  if (state.me) renderMe();
}

function renderLeague() {
  const root = document.querySelector('#league');
  if (!root || !state.league) return;
  const current = state.league.current || {};
  const rewards = state.league.rewards || [];
  const pendingWheels = state.league.pending_wheels || [];
  const daily = state.league.daily_reward || {};
  const scaleEnd = current.next_threshold || current.threshold || 0;
  root.innerHTML = `
    <article class="league-hero-card">
      <p class="label">Лига</p>
      <div class="league-hero-title">
        <h2>${escapeHtml(current.title || 'Железо')}</h2>
        <strong>${moneyHtml(current.total_profit || current.total_win || 0)}</strong>
      </div>
      <div class="profile-progress league-progress"><i style="width:${Number(current.progress_percent || 0)}%"></i></div>
      <div class="league-scale"><span>${moneyHtml(0)}</span><span>${moneyHtml(scaleEnd)}</span></div>
      <p>${current.next_title ? `До ранга ${escapeHtml(current.next_title)} осталось ${moneyHtml(current.remaining || 0)}` : 'Вы достигли максимального ранга'}</p>
    </article>
    <article class="panel daily-panel ${daily.available ? 'claimable' : 'claimed'}">
      <h2>Ежедневная награда</h2>
      <p>Забирайте награду каждый день подряд. Если пропустить день, серия начнётся заново.</p>
      <div class="daily-track">
        ${renderDailyTrack(daily)}
      </div>
      <button class="primary" id="claim-daily-reward" type="button" ${daily.available ? '' : 'disabled'}>${daily.available ? `Получить ${money(daily.amount)}` : 'Сегодня получено'}</button>
    </article>
    ${pendingWheels.length ? `
      <article class="panel wheel-panel">
        <h2>Колесо фортуны</h2>
        <div class="wheel-list">
          ${renderWheelList(pendingWheels)}
        </div>
      </article>
    ` : ''}
    <article class="panel">
      <h2>Шкала прогресса</h2>
      <p class="league-description">Прогресс считается по чистой прибыли: выплата минус сумма ставки. Например, ставка ${money(1000)} с кэфом 1.50 даёт выплату ${money(1500)}, а в прогресс идёт ${money(500)}.</p>
      <div class="league-timeline">
        ${renderLeagueTimeline(rewards)}
      </div>
    </article>
  `;
  document.querySelector('#claim-daily-reward')?.addEventListener('click', claimDailyReward);
  root.querySelectorAll('[data-claim-reward]').forEach((button) => button.addEventListener('click', () => claimReward(Number(button.dataset.claimReward))));
  root.querySelectorAll('[data-spin-wheel]').forEach((button) => button.addEventListener('click', () => spinWheel(button.dataset.spinWheel)));
  renderRating();
}

function renderDailyTrack(daily) {
  const nextDay = Number(daily.next_day || 1);
  const completedUntil = daily.available ? nextDay - 1 : nextDay;
  return (daily.rewards || []).map((item) => {
    const stateClass = item.day <= completedUntil ? 'done' : item.day === nextDay ? 'active' : 'locked';
    const lineClass = item.day > 1 && item.day <= nextDay ? 'line-done' : '';
    return `
      <span class="${stateClass} ${lineClass}" style="${dailyGridPosition(item.day)}">
        <i>${item.day}</i>
        <small>День ${item.day}</small>
        <strong>${money(item.stars)}</strong>
      </span>
    `;
  }).join('');
}

function dailyGridPosition(day) {
  const positions = {
    1: 'grid-column:1;grid-row:1;',
    2: 'grid-column:2;grid-row:1;',
    3: 'grid-column:3;grid-row:1;',
    4: 'grid-column:4;grid-row:1;',
    5: 'grid-column:4;grid-row:2;',
    6: 'grid-column:3;grid-row:2;',
    7: 'grid-column:2;grid-row:2;',
  };
  return positions[day] || '';
}

function renderWheelList(spins) {
  const grouped = Object.values(spins.reduce((groups, spin) => {
    const key = spin.wheel_type || spin.id;
    groups[key] = groups[key] || { ...spin, count: 0, ids: [], unlimited: false };
    groups[key].count += 1;
    groups[key].ids.push(spin.id);
    groups[key].unlimited = groups[key].unlimited || Boolean(spin.unlimited);
    return groups;
  }, {}));
  return grouped.map((spin) => {
    const countText = spin.unlimited ? 'без лимита' : `${spin.count} шт.`;
    return `
      <button class="wheel-button" data-spin-wheel="${escapeAttr(spin.ids[0])}" type="button">
        <span class="wheel-button-icon">${wheelInitial(spin.wheel_type)}</span>
        <span><strong>${escapeHtml(spin.wheel_title || 'Колесо')}</strong><small>${escapeHtml(countText)}</small></span>
        <b>Крутить</b>
      </button>
    `;
  }).join('');
}

function wheelInitial(type = '') {
  return ({ small: 'М', standard: 'О', large: 'Б', elite: 'Э' }[type] || 'К');
}

function renderLeagueTimeline(rewards) {
  const ranks = rewards.filter((reward) => reward.kind === 'rank');
  const bonuses = rewards.filter((reward) => reward.kind !== 'rank');
  let previousThreshold = 0;
  return ranks.map((rank) => {
    const nested = bonuses.filter((reward) => reward.threshold > previousThreshold && reward.threshold <= rank.threshold);
    previousThreshold = rank.threshold;
    const shouldOpen = nested.some((reward) => reward.claimable);
    return `
      <details class="league-rank-group" ${shouldOpen ? 'open' : ''}>
        <summary>${renderLeagueReward(rank, { summary: true })}</summary>
        <div class="league-substeps">
          ${nested.length ? nested.map((reward) => renderLeagueReward(reward, { compact: true })).join('') : '<div class="league-empty-substep">Промежуточных наград нет</div>'}
        </div>
      </details>
    `;
  }).join('');
}

function renderLeagueReward(reward, options = {}) {
  const parts = [];
  if (reward.kind === 'rank') parts.push(`новый ранг ${escapeHtml(reward.title)}`);
  if (reward.stars) parts.push(`награда ${moneyHtml(reward.stars)}`);
  if (reward.wheel_title) parts.push(escapeHtml(reward.wheel_title));
  const compactClass = options.compact ? 'compact' : '';
  const summaryClass = options.summary ? 'summary-step' : '';
  return `
    <div class="league-step ${compactClass} ${summaryClass} ${reward.claimed ? 'claimed' : ''} ${reward.claimable ? 'claimable' : ''}">
      <div class="league-step-dot">${reward.kind === 'rank' ? rankAvatarHtml(reward, reward.title) : ''}</div>
      <div>
        <strong class="reward-threshold">${money(reward.threshold)}</strong>
        <span>${parts.join(' · ')}</span>
      </div>
      ${reward.claimable ? `<button class="primary" data-claim-reward="${reward.threshold}" type="button">Получить</button>` : `<em>${reward.claimed ? 'Получено' : 'Закрыто'}</em>`}
    </div>
  `;
}

function renderRating() {
  const root = document.querySelector('#rating');
  if (!root || !state.league) return;
  const leaderboard = state.league.leaderboard || [];
  root.innerHTML = `
    <article class="league-hero-card">
      <p class="label">Рейтинг</p>
      <div class="league-hero-title">
        <h2>Общий рейтинг</h2>
        <strong>${leaderboard.length}</strong>
      </div>
      <p>Места считаются по чистой прибыли за всё время.</p>
    </article>
    <article class="panel">
      <div class="leaderboard-list">
        ${leaderboard.length ? leaderboard.map((row) => `
          <div class="leaderboard-row">
            <span class="leaderboard-rank rank-${row.rank <= 3 ? row.rank : 'other'}">${row.rank}</span>
            <strong>${rankAvatarHtml(row, row.name)}${escapeHtml(row.name)}</strong>
            <em>${escapeHtml(row.title)}</em>
            <b>${moneyHtml(row.total_profit ?? row.total_win ?? 0)}</b>
          </div>
        `).join('') : '<div class="empty-state">Рейтинг пока пуст.</div>'}
      </div>
    </article>
  `;
}

async function claimReward(threshold) {
  showLoading('Лига', 'Выдаю награду...');
  try {
    state.league = await apiFetch(`/api/league/rewards/${threshold}/claim`, { method: 'POST', body: JSON.stringify({}) });
    await reloadMeSilently().catch(() => {});
    renderLeague();
    showLoadingSuccess('Награда получена');
    addSuccessConfetti(120);
    await delay(2600);
  } finally {
    hideLoading();
  }
}

async function claimDailyReward() {
  showLoading('Ежедневная награда', 'Начисляю звёзды...');
  try {
    state.league = await apiFetch('/api/league/daily-reward/claim', { method: 'POST', body: JSON.stringify({}) });
    await reloadMeSilently().catch(() => {});
    renderLeague();
    showLoadingSuccess('Награда получена');
    addSuccessConfetti(120);
    await delay(2600);
  } finally {
    hideLoading();
  }
}

async function spinWheel(spinId) {
  const spin = (state.league?.pending_wheels || []).find((item) => item.id === spinId);
  const wheel = state.league?.wheels?.[spin?.wheel_type] || null;
  await showWheelLoading(wheel, spin);
  try {
    const result = await apiFetch(`/api/league/wheel-spins/${spinId}/spin`, { method: 'POST', body: JSON.stringify({}) });
    const prizeIndex = wheelPrizeIndex(wheel, result.prize);
    startWheelSpin(prizeIndex, wheel?.segments?.length || 1);
    await delay(2600);
    state.league = result.league;
    await reloadMeSilently().catch(() => {});
    renderLeague();
    finishWheelLoading(result.prize, prizeIndex, wheel?.segments?.length || 1);
    await delay(3600);
  } finally {
    hideLoading();
  }
}

function showWheelLoading(wheel, spin) {
  showLoading(spin?.wheel_title || wheel?.title || 'Колесо фортуны', 'Посмотрите возможные награды и запустите колесо.');
  const modal = document.querySelector('#loading-modal');
  modal.classList.add('wheel-mode', 'wheel-ready');
  const card = modal.querySelector('.loading-card');
  const segments = wheel?.segments || [];
  const stage = document.createElement('div');
  stage.className = 'wheel-stage';
  stage.innerHTML = `
    <div class="wheel-pointer"></div>
    <div class="fortune-wheel">
      ${segments.map((segment, index) => {
        const segmentSize = 360 / Math.max(segments.length, 1);
        const angle = Math.round((segmentSize * index) + (segmentSize / 2));
        return `<span style="--angle:${angle}deg"><b>${money(segment.stars)}</b><small>${segment.chance_percent}%</small></span>`;
      }).join('')}
    </div>
    <div class="wheel-prize" hidden></div>
    <button class="primary wheel-start-button" type="button">Крутить</button>
  `;
  card.appendChild(stage);
  return new Promise((resolve) => {
    stage.querySelector('.wheel-start-button').addEventListener('click', () => {
      stage.querySelector('.wheel-start-button').disabled = true;
      document.querySelector('#loading-text').textContent = 'Колесо набирает скорость...';
      tg?.HapticFeedback?.impactOccurred('light');
      window.setTimeout(() => tg?.HapticFeedback?.impactOccurred('medium'), 650);
      window.setTimeout(() => tg?.HapticFeedback?.impactOccurred('light'), 1250);
      resolve();
    }, { once: true });
  });
}

function startWheelSpin(prizeIndex, totalSegments) {
  const modal = document.querySelector('#loading-modal');
  const wheelNode = modal.querySelector('.fortune-wheel');
  const segmentSize = 360 / Math.max(totalSegments, 1);
  const prizeCenterAngle = (prizeIndex * segmentSize) + (segmentSize / 2);
  const stopRotation = 360 * 5 - prizeCenterAngle;
  wheelNode?.style.setProperty('--stop-rotation', `${Math.round(stopRotation)}deg`);
  modal.classList.remove('wheel-ready');
  modal.classList.add('wheel-spinning');
}

function finishWheelLoading(prize) {
  const modal = document.querySelector('#loading-modal');
  modal.classList.remove('wheel-spinning');
  modal.classList.add('wheel-finished');
  document.querySelector('#loading-text').textContent = `Выпало ${money(prize)}`;
  const prizeNode = modal.querySelector('.wheel-prize');
  if (prizeNode) {
    prizeNode.hidden = false;
    prizeNode.innerHTML = moneyHtml(prize);
  }
  addSuccessConfetti(140);
  triggerSuccessHaptics();
}

function wheelPrizeIndex(wheel, prize) {
  const segments = wheel?.segments || [];
  const index = segments.findIndex((segment) => Number(segment.stars) === Number(prize));
  return index >= 0 ? index : 0;
}

function closeProfileCard() {
  document.querySelector('#profile-modal').hidden = true;
  unlockBodyScroll('profile');
}

async function loadAdmin() {
  const [dashboard, runs] = await Promise.all([apiFetch('/api/admin/dashboard'), apiFetch('/api/admin/sync-runs')]);
  renderDashboard(dashboard);
  renderSyncRuns(runs);
  renderApiUsage(dashboard.odds_api_usage);
  renderSyncSportControls();
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
  const title = payload.sport_title ? `Debug: ${payload.sport_title}` : 'Подробный debug ответа';
  root.insertAdjacentHTML('beforeend', `
    <details class="debug-box" open>
      <summary>${escapeHtml(title)}</summary>
      <button class="copy-debug" type="button" data-copy-debug="${id}">Скопировать debug</button>
      <pre>${escapeHtml(json)}</pre>
    </details>
  `);
  root.querySelector(`[data-copy-debug="${id}"]`)?.addEventListener('click', () => copyDebugReport(id));
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

function renderSyncSportControls() {
  const root = document.querySelector('#sync-sports-list');
  if (!root) return;
  const items = syncSportKeys().map((key) => ({ sport_key: key, title: sportTitle(key) }));
  root.innerHTML = items.map((sport) => `
    <button class="sync-sport-button" data-sync-sport="${escapeAttr(sport.sport_key)}" type="button">
      <span>${sportIcon(sport.sport_key, sport.title)}</span>
      <strong>${escapeHtml(sport.title)}</strong>
      <small>Отдельный sync</small>
    </button>
  `).join('');
  root.querySelectorAll('[data-sync-sport]').forEach((button) => {
    button.addEventListener('click', () => syncOdds(button.dataset.syncSport).catch((error) => {
      status(error.message);
      renderActionError(error, '#sync-debug-list');
    }));
  });
}

async function syncOdds(singleSportKey = '') {
  showLoading('Синхронизация линии', singleSportKey ? `Подготавливаю: ${sportTitle(singleSportKey)}` : 'Подготавливаю турниры...');
  document.querySelector('#sync-debug-list').innerHTML = '';
  const sportKeys = singleSportKey ? [singleSportKey] : syncSportKeys();
  const responses = [];
  try {
    for (const sportKey of sportKeys) {
      updateLoading(`Обновляю: ${sportTitle(sportKey)}`);
      const startedAt = new Date().toISOString();
      try {
        const result = await apiFetch('/api/admin/sync-odds', {
          method: 'POST',
          timeoutMs: 150000,
          body: JSON.stringify({ sport_keys: [sportKey] }),
        });
        responses.push({ sport_key: sportKey, sport_title: sportTitle(sportKey), ok: true, result });
        renderSyncDebug({
          kind: 'sync_odds_sport',
          sport_key: sportKey,
          sport_title: sportTitle(sportKey),
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          response: result,
        }, '#sync-debug-list');
      } catch (error) {
        const errorReport = {
          sport_key: sportKey,
          sport_title: sportTitle(sportKey),
          ok: false,
          message: error.message,
          status: error.status || null,
          data: error.data || null,
          responseText: error.responseText || null,
          timeout: Boolean(error.timeout),
          timeoutMs: error.timeoutMs || null,
          path: error.path || '/api/admin/sync-odds',
          started_at: startedAt,
          finished_at: new Date().toISOString(),
        };
        responses.push(errorReport);
        renderSyncDebug({ kind: 'sync_odds_sport_error', ...errorReport }, '#sync-debug-list');
        if (error.status === 409) break;
      }
    }

    await loadSports().catch(() => {});
    await loadEvents().catch(() => {});
    await loadAdmin().catch(() => {});
    const failed = responses.filter((item) => !item.ok);
    const success = responses.filter((item) => item.ok);
    const eventsCount = success.reduce((sum, item) => sum + Number(item.result?.sync?.events_count || 0), 0);
    const oddsCount = success.reduce((sum, item) => sum + Number(item.result?.sync?.odds_count || 0), 0);
    const adminState = await collectAdminDebugState();
    renderSyncDebug({ kind: 'sync_odds_summary', responses, admin_state: adminState }, '#sync-debug-list');
    status(failed.length ? `Sync остановлен с ошибкой: ${failed[0].message}` : `Sync завершён. Событий: ${eventsCount}, кэфов: ${oddsCount}`);
  } finally {
    hideLoading();
  }
}

async function collectAdminDebugState() {
  const stateReport = {};
  try {
    stateReport.dashboard = await apiFetch('/api/admin/dashboard', { timeoutMs: 15000 });
  } catch (error) {
    stateReport.dashboard_error = { message: error.message, status: error.status || null };
  }
  try {
    stateReport.sync_runs = await apiFetch('/api/admin/sync-runs', { timeoutMs: 15000 });
  } catch (error) {
    stateReport.sync_runs_error = { message: error.message, status: error.status || null };
  }
  return stateReport;
}

async function refreshUsage() {
  const result = await apiFetch('/api/admin/refresh-odds-usage', { method: 'POST', body: JSON.stringify({}) });
  renderApiUsage(result.usage);
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
        <div class="readonly-field"><span>Ранг</span><strong>${escapeHtml(clientStatusLabels[user.client_status] || user.client_status || 'Железо')}</strong></div>
        <label>Баланс <input data-user-balance="${user.id}" type="number" min="0" step="10" value="${Number(wallet?.balance || 0)}"></label>
        <label class="checkbox-row"><input data-user-blocked="${user.id}" type="checkbox" ${user.is_blocked ? 'checked' : ''}> Заблокирован</label>
        <button class="primary" data-save-user="${user.id}">Сохранить</button>
        <button class="back-button danger-button" data-delete-user="${user.id}" type="button">Удалить пользователя</button>
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-save-user]').forEach((button) => button.addEventListener('click', () => saveUser(button.dataset.saveUser)));
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', () => deleteUser(button.dataset.deleteUser)));
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

async function deleteUser(userId) {
  if (!window.confirm('Удалить пользователя и все его данные?')) return;
  showLoading('Пользователь', 'Удаляю пользователя...');
  try {
    await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    await loadUsers();
    if (state.adminBets.length) await loadAdminBets().catch(() => {});
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
  const grouped = groupBy(state.adminBets, (row) => row.user?.id || 'unknown');
  const users = Object.entries(grouped).map(([id, rows]) => ({ id, rows, user: rows[0].user }));
  if (!state.adminSelectedUserId || !grouped[state.adminSelectedUserId]) {
    root.innerHTML = users.map(({ id, rows, user }) => {
      const name = adminUserName(user);
      const latest = rows.slice().sort((a, b) => String(b.bet.created_at).localeCompare(String(a.bet.created_at)))[0];
      const pending = rows.filter((row) => row.bet.status === 'pending').length;
      return `
        <button class="admin-user-bet-row" data-admin-user-bets="${escapeAttr(id)}" type="button">
          <span><strong>${escapeHtml(name)}</strong><small>${rows.length} ставок · ожидает ${pending}</small></span>
          <small>${formatDate(latest?.bet.created_at)}</small>
        </button>
      `;
    }).join('');
    root.querySelectorAll('[data-admin-user-bets]').forEach((button) => button.addEventListener('click', () => {
      state.adminSelectedUserId = button.dataset.adminUserBets;
      renderAdminBets();
    }));
    return;
  }

  const rows = grouped[state.adminSelectedUserId].slice().sort((a, b) => String(b.bet.created_at).localeCompare(String(a.bet.created_at)));
  const user = rows[0]?.user;
  root.innerHTML = `
    <button class="plain-list-back" data-admin-bets-back type="button">Назад к пользователям</button>
    <h3>${escapeHtml(adminUserName(user))}</h3>
    ${rows.map(renderAdminBetCard).join('')}
  `;
  root.querySelector('[data-admin-bets-back]')?.addEventListener('click', () => {
    state.adminSelectedUserId = '';
    renderAdminBets();
  });
  root.querySelectorAll('[data-admin-settle-bet]').forEach((button) => button.addEventListener('click', () => settleAdminBet(button.dataset.adminSettleBet)));
  root.querySelectorAll('[data-admin-delete-bet]').forEach((button) => button.addEventListener('click', () => deleteAdminBet(button.dataset.adminDeleteBet)));
  root.querySelectorAll('[data-admin-bet-status]').forEach((select) => select.addEventListener('change', () => updateAdminBetPayoutInput(select.dataset.adminBetStatus)));
}

function renderAdminBetCard({ bet, selections }) {
  return `
    <article class="admin-card bet-admin-card">
      <div class="card-head">
        <strong>${bet.bet_type === 'express' ? `Экспресс · ${selections.length}` : 'Ординар'}</strong>
        <span>${formatDate(bet.created_at)}</span>
      </div>
      <div class="stat"><span>Статус</span><strong>${escapeHtml(statusLabels[bet.status] || bet.status)}</strong></div>
      <div class="stat"><span>Сумма</span><strong>${moneyHtml(bet.amount)}</strong></div>
      <div class="stat"><span>Итоговый кэф</span><strong>${Number(bet.total_odds || 0).toFixed(2)}</strong></div>
      <div class="stat"><span>Возможный выигрыш</span><strong>${moneyHtml(bet.possible_win)}</strong></div>
      ${bet.payout !== null && bet.payout !== undefined ? `<div class="stat"><span>Выплата</span><strong>${moneyHtml(bet.payout)}</strong></div>` : ''}
      <div class="selection-list">${(selections || []).map((selection) => `
        <span>
          <strong>${escapeHtml(selection.event_name_ru || 'Событие')}</strong>
          <small>${escapeHtml(marketTitles[selection.market_key] || selection.market_key)} · ${escapeHtml(selection.selection_name_ru || selection.selection_name_raw)} · ${escapeHtml(statusLabels[selection.result_status] || selection.result_status || 'ожидает')}</small>
        </span>
      `).join('')}</div>
      <div class="form-grid admin-bet-actions">
        <label class="inline-control">Итог ставки
          <select data-admin-bet-status="${bet.id}" ${bet.status === 'pending' ? '' : 'disabled'}>
            <option value="won">Выигрыш</option>
            <option value="lost">Проигрыш</option>
            <option value="refund">Возврат</option>
            <option value="cancelled">Отменить</option>
          </select>
        </label>
        <label class="inline-control">Выплата
          <input data-admin-bet-payout="${bet.id}" type="number" min="0" step="0.01" value="${Number(bet.possible_win || 0).toFixed(2)}" ${bet.status === 'pending' ? '' : 'disabled'}>
        </label>
        <button class="primary" data-admin-settle-bet="${bet.id}" type="button" ${bet.status === 'pending' ? '' : 'disabled'}>Применить итог</button>
        <button class="back-button danger-button" data-admin-delete-bet="${bet.id}" type="button">Удалить</button>
      </div>
    </article>
  `;
}

function adminUserName(user) {
  return user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.tg_id : 'Пользователь не найден';
}

function updateAdminBetPayoutInput(betId) {
  const row = state.adminBets.find((item) => item.bet.id === betId);
  const statusValue = document.querySelector(`[data-admin-bet-status="${betId}"]`)?.value;
  const payoutInput = document.querySelector(`[data-admin-bet-payout="${betId}"]`);
  if (!row || !statusValue || !payoutInput) return;
  let payout = 0;
  if (statusValue === 'won') payout = Number(row.bet.possible_win || 0);
  if (statusValue === 'refund') payout = Number(row.bet.amount || 0);
  payoutInput.value = payout.toFixed(2);
}

async function settleAdminBet(betId) {
  const statusValue = document.querySelector(`[data-admin-bet-status="${betId}"]`).value;
  const payout = Number(document.querySelector(`[data-admin-bet-payout="${betId}"]`).value);
  showLoading('Ставка', 'Рассчитываю ставку...');
  try {
    const result = await apiFetch(`/api/admin/bets/${betId}/manual-settlement`, {
      method: 'POST',
      body: JSON.stringify({ status: statusValue, payout }),
    });
    state.adminBets = result.bets || state.adminBets;
    renderAdminBets();
    await reloadMeSilently().catch(() => {});
  } finally {
    hideLoading();
  }
}

async function deleteAdminBet(betId) {
  if (!window.confirm('Удалить ставку? Если она ожидает расчёта, сумма ставки будет возвращена.')) return;
  showLoading('Ставка', 'Удаляю ставку...');
  try {
    const result = await apiFetch(`/api/admin/bets/${betId}`, { method: 'DELETE' });
    state.adminBets = result.bets || state.adminBets.filter((row) => row.bet.id !== betId);
    renderAdminBets();
  } finally {
    hideLoading();
  }
}

async function loadAllAdminEvents() {
  state.adminEvents = await apiFetch('/api/admin/events');
  renderAllAdminEvents();
  renderManualEventOptions();
}

function renderAllAdminEvents() {
  const root = document.querySelector('#admin-all-events');
  if (!root) return;
  if (!state.adminEvents.length) {
    root.innerHTML = '<article class="empty-state">Событий пока нет.</article>';
    return;
  }
  root.innerHTML = state.adminEvents.map((event) => `
    <article class="admin-card">
      <div class="card-head">
        <strong>${escapeHtml(event.home_team_raw)} — ${escapeHtml(event.away_team_raw)}</strong>
        <span>${escapeHtml(eventStatusLabels[event.status] || event.status)}</span>
      </div>
      <p class="muted">${escapeHtml(event.league_title || sportTitle(event.sport_key))} · ${formatDate(event.commence_time)}</p>
      <div class="stat"><span>Рынков</span><strong>${Number(event.markets_count || 0)}</strong></div>
      <div class="stat"><span>Коэффициентов</span><strong>${Number(event.odds_count || 0)}</strong></div>
      <div class="admin-actions">
        <button class="primary" data-fetch-event-markets="${event.id}" ${event.can_fetch_markets ? '' : 'disabled'} type="button">Получить рынок</button>
      </div>
    </article>
  `).join('');
  document.querySelectorAll('[data-fetch-event-markets]').forEach((button) => {
    button.addEventListener('click', () => fetchEventMarkets(button.dataset.fetchEventMarkets));
  });
}

async function fetchEventMarkets(eventId) {
  const event = state.adminEvents.find((item) => item.id === eventId);
  showLoading('Рынки события', event ? `Запрашиваю рынки: ${event.home_team_raw} — ${event.away_team_raw}` : 'Запрашиваю рынки события...');
  try {
    const result = await apiFetch(`/api/admin/events/${eventId}/fetch-markets`, {
      method: 'POST',
      timeoutMs: 120000,
      body: JSON.stringify({}),
    });
    state.adminEvents = result.events || state.adminEvents;
    renderAllAdminEvents();
    await loadEvents().catch(() => {});
    notify(`Рынки обновлены: ${result.result.available_markets_count || 0}, коэффициентов: ${result.result.odds_count || 0}`, 'success');
  } finally {
    hideLoading();
  }
}

async function loadAliases() {
  state.aliases = await apiFetch('/api/admin/aliases');
  renderAliases();
}

function renderAliases() {
  renderManualAliasForm(state.aliases);
  renderUnknownAliases(state.aliases.unknown_teams || []);
  renderSportAliases(state.aliases.sports || []);
  renderTeamAliases(state.aliases.teams || []);
}

function renderManualAliasForm(data) {
  const sportSelect = document.querySelector('#manual-alias-sport');
  const teamSelect = document.querySelector('#manual-alias-team');
  if (!sportSelect || !teamSelect) return;

  const sports = data?.sports || [];
  const teams = (data?.teams || []).map((row) => row.team).filter(Boolean);
  state.manualAliasTeams = teams;
  sportSelect.innerHTML = sports.map((sport) => `
    <option value="${escapeAttr(sport.sport_key)}">${escapeHtml(sport.title_ru || sport.title_en || sport.sport_key)}</option>
  `).join('');
  teamSelect.innerHTML = `<option value="">Создать новую команду</option>${teams.map((team) => `
    <option value="${escapeAttr(team.id)}">${escapeHtml(team.name_ru || team.name_en)} · ${escapeHtml(sportTypeLabels[team.sport_type] || team.sport_type || 'спорт')}</option>
  `).join('')}`;
  sportSelect.onchange = syncManualAliasForm;
  teamSelect.onchange = syncManualAliasForm;
  syncManualAliasForm();
  const button = document.querySelector('#create-manual-alias');
  if (button) button.onclick = () => createManualAlias().catch((error) => notify(error.message, 'error'));
}

function syncManualAliasForm() {
  const sportKey = document.querySelector('#manual-alias-sport')?.value || '';
  const teamId = document.querySelector('#manual-alias-team')?.value || '';
  const team = (state.manualAliasTeams || []).find((item) => item.id === teamId);
  const expectedType = sportTypeFromKey(sportKey);
  const sportType = document.querySelector('#manual-alias-sport-type');
  const name = document.querySelector('#manual-alias-name');
  const short = document.querySelector('#manual-alias-short');
  const logo = document.querySelector('#manual-alias-logo');
  if (!sportType || !name || !short || !logo) return;

  sportType.value = team?.sport_type || expectedType;
  sportType.disabled = true;
  sportType.hidden = true;
  short.closest('input, label')?.setAttribute('hidden', '');

  if (team) {
    name.value = team.name_ru || '';
    short.value = team.short_name_ru || '';
    logo.value = team.logo_url || '';
    name.placeholder = 'Название команды';
    logo.placeholder = 'Logo URL команды';
    const mismatched = team.sport_type && team.sport_type !== expectedType;
    document.querySelector('#create-manual-alias').disabled = Boolean(mismatched);
    if (mismatched) {
      notify('Эта команда относится к другому виду спорта. Выберите команду того же вида спорта.', 'error');
    }
    return;
  }

  name.value = '';
  short.value = '';
  logo.value = '';
  name.placeholder = 'Название новой команды';
  logo.placeholder = 'Logo URL команды';
  document.querySelector('#create-manual-alias').disabled = false;
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
  document.querySelectorAll('[data-create-alias]').forEach((button) => {
    button.addEventListener('click', () => createAlias(Number(button.dataset.createAlias)).catch((error) => notify(error.message, 'error')));
  });
}

function renderSportAliases(sports) {
  document.querySelector('#sport-aliases').innerHTML = sports.length ? sports.map((sport) => `
    <article class="admin-card">
      <div class="card-head">
        <span class="sport-alias-title">${sportAliasLogo(sport)}<strong>${escapeHtml(sport.title_ru || sport.title_en || sport.sport_key)}</strong></span>
        <span>${sport.is_enabled ? 'активен' : 'выключен'}</span>
      </div>
      <div class="form-grid">
        <input data-sport-title="${escapeAttr(sport.sport_key)}" value="${escapeAttr(sport.title_ru || '')}" placeholder="Название на русском">
        <input data-sport-logo="${escapeAttr(sport.sport_key)}" value="${escapeAttr(sport.logo_url || '')}" placeholder="Logo URL турнира">
        <button class="primary" data-save-sport="${escapeAttr(sport.sport_key)}">Сохранить</button>
        ${(sport.source === 'manual' || sport.sport_key?.startsWith('manual_')) ? `<button class="back-button danger-button" data-delete-sport="${escapeAttr(sport.sport_key)}" type="button">Удалить соревнование</button>` : ''}
      </div>
    </article>
  `).join('') : '<p class="muted">Турниры появятся после sync.</p>';
  document.querySelectorAll('[data-save-sport]').forEach((button) => button.addEventListener('click', () => saveSport(button.dataset.saveSport)));
  document.querySelectorAll('[data-delete-sport]').forEach((button) => button.addEventListener('click', () => deleteManualSport(button.dataset.deleteSport)));
}

function sportAliasLogo(sport) {
  if (sport?.logo_url) {
    return `<img class="league-logo" src="${escapeAttr(sport.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'league-logo placeholder'}))">`;
  }
  return `<span class="league-logo placeholder">${sportIcon(sport?.sport_key || '', sport?.title_ru || sport?.title_en || '')}</span>`;
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

async function createManualAlias() {
  const sportKey = document.querySelector('#manual-alias-sport').value;
  const rawName = document.querySelector('#manual-alias-raw').value.trim();
  const teamId = document.querySelector('#manual-alias-team').value;
  const team = (state.manualAliasTeams || []).find((item) => item.id === teamId);
  const expectedType = sportTypeFromKey(sportKey);
  const name = document.querySelector('#manual-alias-name').value.trim();
  if (!sportKey || !rawName) {
    notify('Выберите турнир и укажите название из API', 'error');
    return;
  }
  if (team && team.sport_type && team.sport_type !== expectedType) {
    notify('Команда относится к другому виду спорта. Выберите команду того же вида спорта.', 'error');
    return;
  }
  if (!team && !name) {
    notify('Введите название новой команды', 'error');
    return;
  }
  showLoading('Алиас', 'Сохраняю алиас команды...');
  try {
    await apiFetch('/api/admin/team-aliases', {
      method: 'POST',
      body: JSON.stringify({
        raw_name: rawName,
        sport_key: sportKey,
        team_id: teamId,
        name_ru: name,
        short_name_ru: document.querySelector('#manual-alias-short').value || name,
        logo_url: document.querySelector('#manual-alias-logo').value,
      }),
    });
    document.querySelector('#manual-alias-raw').value = '';
    document.querySelector('#manual-alias-name').value = '';
    document.querySelector('#manual-alias-short').value = '';
    document.querySelector('#manual-alias-logo').value = '';
    notify('Алиас создан', 'success');
    await loadAliases();
    await loadEvents();
  } finally {
    hideLoading();
  }
}

async function saveSport(sportKey) {
  const titleInput = findByDataValue('sport-title', sportKey);
  const logoInput = findByDataValue('sport-logo', sportKey);
  if (!titleInput || !logoInput) {
    notify('Не удалось найти поля турнира. Обновите алиасы и попробуйте ещё раз.', 'error');
    return;
  }
  await apiFetch(`/api/admin/sports/${encodeURIComponent(sportKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title_ru: titleInput.value,
      logo_url: logoInput.value,
    }),
  });
  notify('Турнир обновлен', 'success');
  await loadAliases();
  await loadSports();
  await loadEvents();
}

function findByDataValue(name, value) {
  return Array.from(document.querySelectorAll(`[data-${name}]`)).find((item) => item.dataset[toDatasetKey(name)] === value) || null;
}

function toDatasetKey(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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
    await reloadMeSilently().catch(() => {});
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
    const result = await apiFetch(`/api/admin/sports/${encodeURIComponent(sportKey)}`, { method: 'DELETE' });
    state.manualData = result;
    if (document.querySelector('#admin-page-constructor')?.classList.contains('active')) renderManualConstructor();
    if (state.aliases) await loadAliases().catch(() => {});
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
    const note = document.querySelector(`[data-manual-result-note="${eventId}"]`)?.value || '';
    const result = await apiFetch(`/api/admin/events/${eventId}/manual-result`, {
      method: 'POST',
      body: JSON.stringify({ home_score: home, away_score: away, result_note: note }),
    });
    notify(`Рассчитано ставок: ${result.result.bets_settled}`, 'success');
    await loadManualConstructor();
    await loadSettlementRuns().catch(() => {});
    await loadBets().catch(() => {});
    await reloadMeSilently().catch(() => {});
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
  const resultNote = document.querySelector('#manual-result-note').value;
  showLoading('Ручной расчёт', 'Сохраняю результат...');
  try {
    const result = await apiFetch(`/api/admin/events/${eventId}/manual-result`, {
      method: 'POST',
      body: JSON.stringify({ home_score: home, away_score: away, result_note: resultNote }),
    });
    notify(`Рассчитано ставок: ${result.result.bets_settled}`, 'success');
    await loadSettlementRuns();
    await loadBets().catch(() => {});
    await reloadMeSilently().catch(() => {});
  } finally {
    hideLoading();
  }
}

function openAdminDrawer(route = 'menu') {
  if (!state.me?.user?.is_admin) return;
  lockBodyScroll('admin');
  document.querySelector('#open-admin')?.classList.add('active');
  document.querySelector('#admin-drawer').classList.add('open');
  document.querySelector('#admin-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('#admin-backdrop').hidden = true;
  navigateAdmin(route);
}

function closeAdminDrawer() {
  unlockBodyScroll('admin');
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
  if (route === 'all-events') loadAllAdminEvents().catch((error) => status(error.message));
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
  if (tab === 'league') loadLeague().catch((error) => status(error.message));
  if (tab === 'rating') {
    if (state.league) renderRating();
    loadLeague({ silent: true }).catch((error) => status(error.message));
  }
  if (tab === 'profile') {
    renderProfileView();
    loadLeague({ silent: true }).catch(() => {});
  }
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
  const ticketForm = document.querySelector('#ticket-form');
  let ticketStartY = 0;
  let ticketSwipeActive = false;

  const startTicketSwipe = (event) => {
    const touch = event.touches[0];
    const rect = ticketForm.getBoundingClientRect();
    ticketSwipeActive = event.target === handle || touch.clientY - rect.top < 72;
    ticketStartY = event.touches[0].clientY;
  };
  const endTicketSwipe = (event) => {
    if (ticketSwipeActive && event.changedTouches[0].clientY - ticketStartY > 42) {
      state.ticketExpanded = false;
      renderTicket();
    }
    ticketSwipeActive = false;
  };

  ticketForm.addEventListener('touchstart', startTicketSwipe, { passive: true });
  ticketForm.addEventListener('touchend', endTicketSwipe, { passive: true });
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
document.querySelector('#refresh-profile').addEventListener('click', (event) => {
  event.stopPropagation();
  refreshMe().catch((error) => notify(error.message, 'error'));
});
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
document.querySelector('#reload-admin-events').addEventListener('click', () => loadAllAdminEvents().catch((error) => status(error.message)));
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
