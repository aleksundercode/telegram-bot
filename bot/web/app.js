const tg = window.Telegram?.WebApp;
const byId = id => document.getElementById(id);
const kinds = {
    products: { title: 'Покупки', symbol: '🛒', placeholder: 'Что купить?', empty: 'Список покупок пуст.' },
    tasks: { title: 'Дела', symbol: '📋', placeholder: 'Что сделать?', empty: 'Открытых дел нет.' },
};
const state = {
    kind: new URLSearchParams(location.search).get('tab') === 'tasks' ? 'tasks' : 'products',
    status: 'open',
    page: 0,
    revision: 0,
    pending: false,
};
const workspace = byId('workspace');
const form = byId('add-form');
const entry = byId('entry');
const reminders = byId('reminders');
const records = byId('list');
const navButtons = [...document.querySelectorAll('[data-kind], [data-status]')];

function showError(message = '') {
    byId('error').textContent = message;
    byId('error').hidden = !message;
}
function theme() {
    document.documentElement.dataset.theme = tg?.colorScheme === 'dark' ? 'dark' : 'light';
}
async function api(path, body) {
    const headers = { 'X-Telegram-Init-Data': tg?.initData || '' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/' + path, {
        headers,
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout?.(12000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить список.');
    return result;
}
function controls() {
    const kind = kinds[state.kind];
    byId('title').textContent = kind.title;
    byId('symbol').textContent = kind.symbol;
    entry.placeholder = kind.placeholder;
    byId('reminder-settings').hidden = state.kind !== 'tasks';
    for (const button of navButtons) {
        const active = button.dataset.kind ? button.dataset.kind === state.kind : button.dataset.status === state.status;
        button.setAttribute('aria-pressed', active);
    }
}
function makeItem(item, open, kind) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    const mark = document.createElement('span');
    mark.className = 'check';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = open ? '' : '↶';
    const label = document.createElement('span');
    label.textContent = item.text;
    button.setAttribute('aria-label', (open ? 'Завершить: ' : 'Восстановить: ') + item.text);
    button.append(mark, label);
    button.addEventListener('click', () => mutate(() => api(`${kind}/${item.id}/${open ? 'close' : 'restore'}`, {})));
    row.append(button);
    if (!open) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Удалить: ' + item.text);
        remove.addEventListener('click', () => {
            if (window.confirm('Удалить запись окончательно?')) void mutate(() => api(`${kind}/${item.id}/delete`, {}));
        });
        row.append(remove);
    }
    return row;
}
async function refresh() {
    const revision = ++state.revision;
    const { kind, status, page } = state;
    controls();
    const tasks = kind === 'tasks';
    const [list, preference] = await Promise.all([
        api(`${kind}?status=${status}&page=${page}`),
        tasks ? api('reminders') : null,
    ]);
    if (revision !== state.revision) return;
    state.page = list.page;
    records.replaceChildren(...list.items.map(item => makeItem(item, status === 'open', kind)));
    byId('empty').hidden = list.items.length > 0;
    byId('empty').textContent = status === 'open' ? kinds[kind].empty : 'Завершённых записей пока нет.';
    byId('summary').textContent = `${status === 'open' ? 'Открыто' : 'Завершено'} · ${list.count}`;
    byId('pagination').hidden = list.pages < 2;
    byId('page').textContent = `${list.page + 1} / ${list.pages}`;
    byId('prev').disabled = list.page === 0;
    byId('next').disabled = list.page + 1 >= list.pages;
    if (preference) {
        reminders.checked = preference.enabled;
        reminders.disabled = false;
    }
}
async function load(clear = false) {
    showError();
    if (clear) {
        records.replaceChildren();
        byId('empty').hidden = true;
        byId('pagination').hidden = true;
        byId('summary').textContent = 'Загрузка…';
        reminders.disabled = true;
    }
    const request = refresh();
    const revision = state.revision;
    try { await request; }
    catch (error) {
        if (revision === state.revision) {
            byId('summary').textContent = '';
            showError(error.message || 'Ошибка загрузки.');
        }
    }
}
async function mutate(action, onSuccess = () => {}) {
    if (state.pending) return;
    state.pending = true;
    workspace.setAttribute('aria-busy', 'true');
    for (const button of navButtons) button.disabled = true;
    form.querySelector('button').disabled = true;
    showError();
    try {
        await action();
        onSuccess();
        byId('announcement').textContent = 'Изменения сохранены.';
        await load();
    } catch (error) { showError(error.message || 'Ошибка сохранения.'); }
    finally {
        state.pending = false;
        workspace.removeAttribute('aria-busy');
        for (const button of navButtons) button.disabled = false;
        form.querySelector('button').disabled = false;
    }
}

for (const button of navButtons) button.addEventListener('click', () => {
    if (!tg?.initData || state.pending) return;
    if (button.dataset.kind) {
        if (state.kind !== button.dataset.kind) {
            entry.value = '';
            state.kind = button.dataset.kind;
            state.status = 'open';
        }
    } else state.status = button.dataset.status;
    state.page = 0;
    void load(true);
});
byId('prev').addEventListener('click', () => { if (!state.pending) { state.page--; void load(true); } });
byId('next').addEventListener('click', () => { if (!state.pending) { state.page++; void load(true); } });
form.addEventListener('submit', event => {
    event.preventDefault();
    if (!entry.value.trim()) return;
    const text = entry.value;
    void mutate(() => api(state.kind, { text }), () => {
        if (entry.value === text) entry.value = '';
        state.status = 'open';
        state.page = 9999999;
    });
});
reminders.addEventListener('change', async () => {
    const enabled = reminders.checked;
    if (state.pending) { reminders.checked = !enabled; return; }
    reminders.disabled = true;
    await mutate(async () => {
        try { await api('reminders', { enabled }); }
        catch (error) { reminders.checked = !enabled; throw error; }
    });
    reminders.disabled = false;
});
theme();
tg?.onEvent('themeChanged', theme);
tg?.ready();
tg?.expand();
controls();
if (!tg?.initData) {
    showError('Откройте «Мои списки» из личного чата с ботом в Telegram.');
    for (const button of navButtons) button.disabled = true;
} else {
    workspace.hidden = false;
    void load(true);
}
