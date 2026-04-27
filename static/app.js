const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  events: [],
  selected: null,
  balance: 10000,
  stake: 500,
};

const labels = {
  home: 'П1',
  draw: 'X',
  away: 'П2',
};

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg?.initData || '',
    ...options.headers,
  };

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function init() {
  try {
    const [me, events] = await Promise.all([api('/api/me'), api('/api/events')]);
    state.balance = me.balance;
    state.events = events;
    document.querySelector('#user-name').textContent = me.user.first_name || me.user.username || 'Demo';
    document.querySelector('#balance').textContent = money(state.balance);
    document.querySelector('#status').textContent = me.supabase
      ? 'Backend запущен, Supabase настроен'
      : 'Backend запущен, Supabase ключи пока не заданы';
    renderEvents();
  } catch (error) {
    document.querySelector('#status').textContent = `Ошибка загрузки: ${error.message}`;
  }
}

function renderEvents() {
  document.querySelector('#events').innerHTML = state.events.map((event) => `
    <article class="event">
      <div class="event-head">
        <span>${event.league}</span>
        <time>${event.time}</time>
      </div>
      <h2>${event.title}</h2>
      <div class="odds">
        ${Object.entries(event.odds).map(([outcome, odd]) => `
          <button data-event="${event.id}" data-outcome="${outcome}">
            <span>${labels[outcome] || 'Победа'}</span>
            <strong>${Number(odd).toFixed(2)}</strong>
          </button>
        `).join('')}
      </div>
    </article>
  `).join('');

  document.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => {
      const event = state.events.find((item) => item.id === button.dataset.event);
      state.selected = {
        event,
        outcome: button.dataset.outcome,
        odd: event.odds[button.dataset.outcome],
      };
      document.querySelectorAll('[data-event]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderTicket();
    });
  });
}

function renderTicket() {
  if (!state.selected) return;

  document.querySelector('#ticket-empty').hidden = true;
  document.querySelector('#ticket-form').hidden = false;
  document.querySelector('#ticket-event').textContent = state.selected.event.title;
  document.querySelector('#ticket-outcome').textContent = labels[state.selected.outcome] || 'Победа';
  document.querySelector('#ticket-odd').textContent = Number(state.selected.odd).toFixed(2);
  document.querySelector('#possible-win').textContent = money(state.stake * state.selected.odd);
}

document.querySelector('#stake').addEventListener('input', (event) => {
  state.stake = Number(event.target.value);
  renderTicket();
});

document.querySelector('#place-bet').addEventListener('click', async () => {
  if (!state.selected || state.stake <= 0 || state.stake > state.balance) return;

  const payload = {
    event_id: state.selected.event.id,
    outcome: state.selected.outcome,
    odd: state.selected.odd,
    stake: state.stake,
  };

  await api('/api/bets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.balance -= state.stake;
  document.querySelector('#balance').textContent = money(state.balance);
  document.querySelector('#status').textContent = 'Ставка принята в демо режиме';
  tg?.HapticFeedback?.notificationOccurred('success');
});

init();
