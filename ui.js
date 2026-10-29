// Rendering and interaction. All dynamic text goes through esc() before it touches innerHTML.

import {
  S, VIEWS, ORDER_KEYS, list, counts, val, hasPending, edit, on, status,
  setView, setQuery, dismissFailures
} from './store.js';
import {
  esc, fmtNum, fmtMoney, fmtWhen, sizeParts, displayName, firstName, initial, startOfToday, debounce
} from './format.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const ic = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const wide = window.matchMedia('(min-width: 760px)');

const els = {};
let order = [];            // items currently shown in the list, in order
let hooks = {};            // callbacks supplied by main.js (refresh, sign out, ...)

// ----- Setup -----------------------------------------------------------------

export function init(h) {
  hooks = h;
  Object.assign(els, {
    shell: $('#shell'), list: $('#list'), listScroll: $('#listScroll'), tabs: $('#tabs'),
    q: $('#q'), qClear: $('#qClear'), viewNote: $('#viewNote'), detail: $('#detail'),
    toasts: $('#toasts'), pill: $('#syncPill'), pillLabel: $('#syncLabel'), banner: $('#banner'),
    avatar: $('#userBtn'), menu: $('#menu'), menuUser: $('#menuUser')
  });

  // Tabs
  els.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    setView(b.dataset.view);
    renderTabs();
    renderList();
    els.listScroll.scrollTop = 0;
  });

  // Search
  const runSearch = debounce(() => { setQuery(els.q.value); renderList(); els.listScroll.scrollTop = 0; }, 120);
  els.q.addEventListener('input', () => { els.qClear.hidden = !els.q.value; runSearch(); });
  els.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.q.blur(); });
  els.qClear.addEventListener('click', () => { els.q.value = ''; els.qClear.hidden = true; setQuery(''); renderList(); els.q.focus(); });

  // List
  els.list.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="retry"]')) { hooks.refresh(); return; }
    const checkBtn = e.target.closest('[data-act="check"]');
    const li = e.target.closest('li[data-row]');
    if (!li) return;
    const it = S.byRow.get(Number(li.dataset.row));
    if (!it) return;
    if (checkBtn) { setChecked(it, val(it, 'checked') !== true); return; }
    if (e.target.closest('[data-act="open"]')) select(it.row);
  });

  // Detail
  els.detail.addEventListener('click', onDetailClick);
  els.detail.addEventListener('input', onDetailInput);
  els.detail.addEventListener('focusout', (e) => {
    // After typing, tidy the field (e.g. "007" -> "7") once focus leaves it.
    if (e.target.matches('.stepper input, input[data-ctl], textarea[data-ctl]')) setTimeout(syncDetail, 0);
  });
  els.detail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type="text"], .stepper input')) e.target.blur();
  });
  initStepperHold();
  initSwipe();

  // Account menu
  els.avatar.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => { if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });
  els.menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    toggleMenu(false);
    if (b.dataset.act === 'refresh') hooks.refresh();
    if (b.dataset.act === 'signout') hooks.signOut();
  });

  els.pill.addEventListener('click', () => hooks.refresh());

  // Phone back button closes the item page
  window.addEventListener('popstate', () => { if (!wide.matches && els.shell.dataset.pane === 'detail') closeDetail(false); });
  wide.addEventListener('change', () => { els.shell.dataset.pane = 'list'; renderDetail(); });

  // Store events
  on('data', onData);
  on('status', renderStatus);
  on('failure', renderBanner);
  on('view', () => {});
}

export function setUser(me) {
  els.avatar.textContent = initial(me.name || me.email);
  els.menuUser.innerHTML = `<strong>${esc(me.name || '')}</strong><span>Your name on changes</span>`;
}

export function setDemoTag(on) { $('#demoTag').hidden = !on; }

function toggleMenu(open) {
  const show = open === undefined ? els.menu.hidden : open;
  els.menu.hidden = !show;
  els.avatar.setAttribute('aria-expanded', String(show));
}

// ----- Rendering: tabs, list -------------------------------------------------

export function renderAll() {
  renderTabs();
  renderList();
  const it = S.sel !== null ? S.byRow.get(S.sel) : null;
  if (it && els.detail.querySelector('[data-ctl]')) syncDetail();
  else renderDetail();
}

export function renderTabs() {
  const c = counts();
  els.tabs.setAttribute('role', 'tablist');
  els.tabs.innerHTML = VIEWS.map((v) => `
    <button class="tab" role="tab" type="button" data-view="${v.id}" aria-selected="${v.id === S.view}" aria-label="${esc(v.label)}, ${fmtNum(c[v.id])} items">
      ${ic(v.icon, 'ic tab-icon')}
      <span class="tab-count">${fmtNum(c[v.id])}</span>
      <span class="tab-label"><span class="l-full">${esc(v.label)}</span><span class="l-short">${esc(v.short)}</span></span>
    </button>`).join('');
  const view = VIEWS.find((v) => v.id === S.view);
  els.viewNote.textContent = view.note;
  els.viewNote.hidden = !view.note;
}

function potHTML(size, big) {
  const p = sizeParts(size);
  if (p.n !== undefined) {
    const t = Math.max(0, Math.min(6, p.n / 2 - 1));
    return `<span class="pot${big ? ' pot-lg' : ''}" style="--t:${t}" aria-hidden="true"><b>${p.n}</b><i>in</i></span>`;
  }
  return `<span class="pot pot-text${big ? ' pot-lg' : ''}" aria-hidden="true"><b>${esc(p.text || '?')}</b></span>`;
}

function isEditedToday(it) {
  const e = val(it, 'edited');
  return !!e && new Date(e).getTime() >= startOfToday();
}

function rowHTML(it) {
  const checked = val(it, 'checked') === true;
  const avail = val(it, 'avail') === true;
  const future = val(it, 'future') === true;
  const qty = val(it, 'ctgQty');
  const two = val(it, 'twoWks');
  const crop = String(val(it, 'crop') || '');
  const assorted = /only/i.test(crop) && /assorted/i.test(crop);
  const name = displayName(it.v.name, it.v.size);

  const tags = [];
  if (val(it, 'walk') === true) tags.push('<span class="tag tag-red">Avail walk</span>');
  if (isEditedToday(it)) tags.push('<span class="tag tag-blue">Edited today</span>');
  if (it.v.ctCheck === true) tags.push('<span class="tag tag-pink">CT check</span>');
  if (it.v.neverOut === true) tags.push('<span class="tag tag-pink">Never out</span>');

  const flash = it.flash && Date.now() - it.flash < 2500 ? ' flash' : '';
  const sel = S.sel === it.row ? ' is-sel' : '';
  const pend = hasPending(it) ? ' is-pending' : '';

  return `<li class="row${checked ? ' is-checked' : ''}${sel}${pend}${flash}" data-row="${it.row}">
    <button class="row-main" type="button" data-act="open" aria-label="${esc(name)}, open details">
      ${potHTML(it.v.size, false)}
      <span class="row-text">
        <span class="row-name">${esc(name)}</span>
        <span class="row-meta">
          <span class="chip ${avail ? 'chip-on' : 'chip-off'}">${avail ? ic('i-check', 'ic chip-ic') : ''}${avail ? 'Available' : 'Not available'}</span>
          ${future ? '<span class="chip chip-future">Future avail</span>' : ''}
          ${(qty !== null && qty !== undefined) && (avail || future || qty > 0) ? `<span class="stat">Qty <b>${fmtNum(qty)}</b></span>` : ''}
          ${two ? `<span class="stat">2wks+ <b>${fmtNum(two)}</b></span>` : ''}
          ${tags.join('')}
        </span>
        ${assorted ? `<span class="row-note">${esc(crop)}</span>` : ''}
      </span>
    </button>
    <button class="row-check" type="button" data-act="check" aria-pressed="${checked}" aria-label="${checked ? 'Checked. Tap to undo' : 'Mark as checked'}">
      <span class="check-dot">${ic('i-check')}</span>
    </button>
  </li>`;
}

const EMPTY = {
  all: ['No items found', 'Pull down the account menu and choose Refresh data, or check your connection.'],
  stale: ['Nothing to review', 'Every available item was edited in the last 2 days.'],
  zero: ['All good', 'No item is marked available with a qty of 0.']
};

export function renderList() {
  order = list();
  if (!S.hasData) {
    els.list.innerHTML = Array.from({ length: 9 }, () => '<li class="row skeleton" aria-hidden="true"><span class="pot"></span><span class="row-text"><span class="sk sk-1"></span><span class="sk sk-2"></span></span></li>').join('');
    return;
  }
  if (!order.length) {
    const [t, b] = S.q.trim() ? ['No matches', `Nothing matches "${S.q.trim()}" in this view.`] : EMPTY[S.view];
    els.list.innerHTML = `<li class="empty"><strong>${esc(t)}</strong><span>${esc(b)}</span></li>`;
    return;
  }
  let todo = 0;
  for (const it of order) if (val(it, 'checked') !== true) todo++;
  const done = order.length - todo;
  const items = [];
  let section = null;
  for (const it of order) {
    const c = val(it, 'checked') === true;
    if (c !== section) {
      section = c;
      items.push({ k: c ? 's1' : 's0', html: `<li class="sec" role="presentation"><span>${c ? 'Checked' : 'To check'}</span><span class="sec-n">${fmtNum(c ? done : todo)}</span></li>` });
    }
    items.push({ k: 'r' + it.row, html: rowHTML(it) });
  }
  reconcile(items);
}

// Keeps unchanged rows in place and only rebuilds the ones whose markup changed,
// so checking one item does not repaint 1,000 others (matters on tablets).
const tpl = document.createElement('template');
function makeNode(item) {
  tpl.innerHTML = item.html;
  const n = tpl.content.firstElementChild;
  n._k = item.k; n._h = item.html;
  return n;
}

function reconcile(items) {
  const host = els.list;
  const old = new Map();
  for (const n of host.children) if (n._k) old.set(n._k, n);
  if (!old.size) {
    host.innerHTML = items.map((i) => i.html).join('');
    let n = host.firstElementChild;
    for (const i of items) { n._k = i.k; n._h = i.html; n = n.nextElementSibling; }
    return;
  }
  let ref = host.firstElementChild;
  for (const i of items) {
    let n = old.get(i.k);
    if (!n || n._h !== i.html) n = makeNode(i);
    if (n === ref) ref = ref.nextElementSibling;
    else host.insertBefore(n, ref);
  }
  while (ref) { const next = ref.nextElementSibling; ref.remove(); ref = next; }
}

function patchRow(row) {
  const it = S.byRow.get(row);
  const li = els.list.querySelector(`li[data-row="${row}"]`);
  if (!it || !li) return;
  const fresh = makeNode({ k: 'r' + row, html: rowHTML(it) });
  li.replaceWith(fresh);
}

const scheduleList = (() => {
  let t = null;
  return (delay) => {
    clearTimeout(t);
    t = setTimeout(() => { renderTabs(); renderList(); syncPosition(); }, delay);
  };
})();

function onData(p) {
  if (p.all) { renderAll(); return; }
  let needsList = false;
  let urgent = false;
  for (const patch of p.patches || []) {
    patchRow(patch.row);
    if (S.sel === patch.row) syncDetail();
    if (patch.keys.some((k) => ORDER_KEYS.has(k))) { needsList = true; if (patch.urgent) urgent = true; }
  }
  if (needsList) scheduleList(urgent ? 0 : 400);
  else renderTabsSoon();
}
const renderTabsSoon = debounce(renderTabs, 300);

// ----- Detail ----------------------------------------------------------------

const stepper = (key, label) => `
  <div class="stepper" data-ctl="num" data-key="${key}">
    <span class="field-label" id="lbl-${key}">${label}</span>
    <div class="stepper-box">
      <button class="step" type="button" data-step="-1" aria-label="Decrease ${esc(label)}">${ic('i-minus')}</button>
      <input type="text" inputmode="numeric" autocomplete="off" aria-labelledby="lbl-${key}" placeholder="0" enterkeyhint="done">
      <button class="step" type="button" data-step="1" aria-label="Increase ${esc(label)}">${ic('i-plus')}</button>
    </div>
  </div>`;

const tile = (key, label) => `
  <button class="tile" type="button" role="switch" aria-checked="false" data-ctl="bool" data-key="${key}">
    <span class="tile-top"><span class="tile-box">${ic('i-check')}</span><span class="tile-state">No</span></span>
    <span class="tile-label">${label}</span>
  </button>`;

const toggleChip = (key, label) => `
  <button class="tchip" type="button" role="switch" aria-checked="false" data-ctl="bool" data-key="${key}">
    <span class="tchip-box">${ic('i-check')}</span><span>${label}</span>
  </button>`;

const textField = (key, label, ph = '') => `
  <label class="field"><span class="field-label">${label}</span>
    <input type="text" data-ctl="text" data-key="${key}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="done">
  </label>`;

const kv = (label, key, fmt) => `<div class="kv"><dt>${label}</dt><dd data-ro="${key}" data-fmt="${fmt}"></dd></div>`;

function detailHTML() {
  return `
  <div class="d-head">
    <button class="icon-btn d-back" type="button" data-act="back" aria-label="Back to list">${ic('i-chev-l')}<span>Items</span></button>
    <div class="d-nav" role="group" aria-label="Browse items">
      <button class="icon-btn" type="button" data-act="prev" aria-label="Previous item">${ic('i-chev-u')}</button>
      <span class="d-pos" id="dPos" aria-live="polite"></span>
      <button class="icon-btn" type="button" data-act="next" aria-label="Next item">${ic('i-chev-d')}</button>
    </div>
  </div>
  <div class="d-scroll" id="dScroll">
    <div class="d-title">
      <span id="dPot"></span>
      <div class="d-title-text">
        <h2 id="dName" tabindex="-1"></h2>
        <p class="d-sub" id="dSub"></p>
      </div>
    </div>

    <section class="grp grp-top">
      <div class="tiles tiles-1">${tile('checked', 'Item checked')}</div>
    </section>

    <section class="grp">
      <label class="field field-note"><span class="field-label">Picking notes</span>
        <textarea data-ctl="text" data-key="picking" rows="2" placeholder="Add a picking note"></textarea>
      </label>
    </section>

    <section class="grp" aria-labelledby="g-avail">
      <h3 id="g-avail">Availability</h3>
      <div class="tiles">${tile('avail', 'Available')}${tile('future', 'Future avail')}</div>
      <div class="pair">${stepper('ctgQty', 'CTG avail qty')}${stepper('twoWks', '2wks+ avail')}</div>
      ${textField('crop', 'Crop notes / future')}
      ${textField('back', 'Back in stock')}
    </section>

    <section class="grp" aria-labelledby="g-flags">
      <h3 id="g-flags">Flags</h3>
      <div class="tchips">${toggleChip('walk', 'Avail walk')}${toggleChip('watch', 'Watch')}${toggleChip('ast', 'Ast Flats')}${toggleChip('count', 'Count')}</div>
    </section>

    <section class="grp" aria-labelledby="g-zam">
      <h3 id="g-zam">Zamzows</h3>
      <div class="pair">${stepper('zam', 'Zamzows qty')}${textField('lastZam', 'Last Zamzows')}</div>
    </section>

    <section class="grp" aria-labelledby="g-stock">
      <h3 id="g-stock">Stock and sales</h3>
      <dl class="kvs">
        ${kv('CT on hand', 'onHand', 'num')}${kv('CT qty avail', 'ctAvail', 'num')}
        ${kv('Received, last 7 days', 'recv7', 'num')}${kv('Sold last week', 'soldLast', 'num')}
        ${kv('Average sold', 'avgSold', 'num')}${kv('Weeks available', 'wks', 'num')}
        ${kv('Previous order qty', 'prevOrder', 'num')}${kv('Suggested order qty', 'suggested', 'num')}
        ${kv('CG inventory qty', 'cgInv', 'num')}${kv('CT special orders, 8 weeks', 'special', 'num')}
        ${kv('CT price', 'price', 'money')}${kv('On sale', 'onSale', 'bool')}
      </dl>
    </section>

    <details class="grp more">
      <summary><span>More details</span>${ic('i-chev-d', 'ic more-ic')}</summary>
      <dl class="kvs">
        ${kv('Item code', 'code', 'text')}${kv('CT barcode', 'barcode', 'text')}
        ${kv('Max 4-week avg sales last year', 'max4', 'money')}${kv('Low inventory threshold', 'lowThr', 'num')}
        ${kv('Part', 'part', 'num')}${kv('Item list row', 'listRow', 'num')}
        ${kv('Received by CT', 'recvCT', 'num')}${kv('CT avail check', 'ctCheck', 'bool')}
        ${kv('Never out plant', 'neverOut', 'bool')}${kv('Last edited', 'edited', 'when')}
        ${kv('Last edited by', 'by', 'email')}
      </dl>
    </details>
    <div class="d-spacer"></div>
  </div>
  `;
}

export function renderDetail() {
  const it = S.sel !== null ? S.byRow.get(S.sel) : null;
  if (!it) {
    const c = counts();
    const pct = c.all ? Math.round((c.checked / c.all) * 100) : 0;
    els.detail.classList.add('is-empty');
    els.detail.innerHTML = `
      <div class="d-empty">
        <svg class="mark mark-md" viewBox="0 0 48 48" aria-hidden="true"><use href="#mark"/></svg>
        <h2>Select an item</h2>
        <p>Tap an item in the list to update its availability.</p>
        <div class="progress" role="img" aria-label="${fmtNum(c.checked)} of ${fmtNum(c.all)} items checked">
          <div class="progress-bar"><span style="width:${pct}%"></span></div>
          <p><strong>${fmtNum(c.checked)}</strong> of ${fmtNum(c.all)} items checked</p>
        </div>
      </div>`;
    return;
  }
  els.detail.classList.remove('is-empty');
  els.detail.innerHTML = detailHTML();
  syncDetail();
  const area = $('#dScroll');
  if (area) area.scrollTop = 0;
}

function syncPosition() {
  const pos = $('#dPos');
  if (!pos) return;
  const it = S.byRow.get(S.sel);
  const i = it ? order.indexOf(it) : -1;
  pos.textContent = i >= 0 ? `${fmtNum(i + 1)} of ${fmtNum(order.length)}` : '';
  const prev = $('[data-act="prev"]', els.detail);
  const next = $('[data-act="next"]', els.detail);
  if (prev) prev.disabled = i <= 0;
  if (next) next.disabled = i < 0 || i >= order.length - 1;
}

export function syncDetail() {
  const it = S.byRow.get(S.sel);
  if (!it || !els.detail.querySelector('[data-ctl]')) return;
  const active = document.activeElement;

  $('#dPot').innerHTML = potHTML(it.v.size, true);
  $('#dName').textContent = displayName(it.v.name, it.v.size);
  const by = val(it, 'by');
  const edited = val(it, 'edited');
  const sub = [`Code ${it.v.code || '—'}`];
  if (edited) sub.push(`Edited ${fmtWhen(edited)}${by ? ' by ' + firstName(by) : ''}`);
  $('#dSub').innerHTML = sub.map((s) => `<span>${esc(s)}</span>`).join('');

  $$('[data-ctl]', els.detail).forEach((el) => {
    const key = el.dataset.key;
    const v = val(it, key);
    const kind = el.dataset.ctl;
    if (kind === 'bool') {
      const on = v === true;
      el.setAttribute('aria-checked', String(on));
      el.classList.toggle('is-on', on);
      const st = $('.tile-state', el);
      if (st) st.textContent = on ? 'Yes' : 'No';
    } else if (kind === 'num') {
      const inp = $('input', el);
      if (active !== inp) inp.value = v === null || v === undefined ? '' : String(v);
      const minus = $('[data-step="-1"]', el);
      minus.disabled = !(typeof v === 'number' && v > 0);
    } else if (kind === 'text') {
      if (active !== el) { el.value = v || ''; if (el.tagName === 'TEXTAREA') autosize(el); }
    }
  });

  $$('[data-ro]', els.detail).forEach((el) => {
    const v = val(it, el.dataset.ro);
    const f = el.dataset.fmt;
    if (f === 'num') el.textContent = fmtNum(v);
    else if (f === 'money') el.textContent = fmtMoney(v);
    else if (f === 'when') el.textContent = fmtWhen(v);
    else if (f === 'bool') el.innerHTML = v ? '<span class="yes">Yes</span>' : '<span class="no">No</span>';
    else if (f === 'email') el.innerHTML = v ? `<a href="mailto:${esc(v)}">${ic('i-mail', 'ic ic-sm')}${esc(v)}</a>` : '—';
    else el.textContent = v === null || v === undefined || v === '' ? '—' : String(v);
  });

  syncPosition();
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 220) + 'px';
}

// ----- Detail interactions ---------------------------------------------------

function current() { return S.byRow.get(S.sel) || null; }

function onDetailClick(e) {
  const it = current();
  if (!it) return;
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'back') { closeDetail(true); return; }
    if (a === 'prev') { go(-1); return; }
    if (a === 'next') { go(1); return; }
  }
  const bool = e.target.closest('[data-ctl="bool"]');
  if (bool) { edit(it, bool.dataset.key, val(it, bool.dataset.key) !== true); return; }
  const stepBtn = e.target.closest('.step');
  if (stepBtn && e.detail === 0) stepBy(stepBtn.closest('[data-key]').dataset.key, Number(stepBtn.dataset.step)); // keyboard / assistive tech
}

function onDetailInput(e) {
  const it = current();
  if (!it) return;
  const t = e.target;
  if (t.matches('textarea[data-ctl]')) { autosize(t); edit(it, t.dataset.key, t.value, { quick: true }); return; }
  if (t.matches('input[data-ctl="text"]')) { edit(it, t.dataset.key, t.value, { quick: true }); return; }
  const box = t.closest('[data-ctl="num"]');
  if (box && t.matches('input')) {
    const cleaned = t.value.replace(/[^\d.\-]/g, '');
    if (cleaned !== t.value) t.value = cleaned;
    if (cleaned === '') { edit(it, box.dataset.key, null, { quick: true }); return; }
    const n = Number(cleaned);
    if (Number.isFinite(n)) edit(it, box.dataset.key, n, { quick: true });
  }
}

function stepBy(key, dir) {
  const it = current();
  if (!it) return;
  const cur = val(it, key);
  const base = typeof cur === 'number' ? cur : 0;
  const next = Math.max(0, base + dir);
  if (next === cur) return;
  edit(it, key, next, { quick: true });
}

function initStepperHold() {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  els.detail.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.step');
    if (!b || e.button > 0) return;
    e.preventDefault();
    const key = b.closest('[data-key]').dataset.key;
    const dir = Number(b.dataset.step);
    stepBy(key, dir);
    let delay = 380;
    const repeat = () => { stepBy(key, dir); delay = Math.max(55, delay * 0.82); timer = setTimeout(repeat, delay); };
    timer = setTimeout(repeat, delay);
  });
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, stop));
}

function initSwipe() {
  let sx = 0; let sy = 0; let tracking = false;
  els.detail.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || wide.matches) return;
    if (e.target.closest('input, textarea, .stepper, button, a')) { tracking = false; return; }
    tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  els.detail.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ----- Selection and navigation ---------------------------------------------

export function select(row) {
  const it = S.byRow.get(row);
  if (!it) return;
  const prev = S.sel;
  S.sel = row;
  if (prev !== null && prev !== row) {
    const old = els.list.querySelector(`li[data-row="${prev}"]`);
    if (old) old.classList.remove('is-sel');
  }
  const li = els.list.querySelector(`li[data-row="${row}"]`);
  if (li) { li.classList.add('is-sel'); li.scrollIntoView({ block: 'nearest' }); }
  renderDetail();
  if (!wide.matches) {
    if (els.shell.dataset.pane !== 'detail') history.pushState({ d: row }, '');
    els.shell.dataset.pane = 'detail';
    const h = $('#dName');
    if (h) h.focus({ preventScroll: true });
  }
}

function closeDetail(viaButton) {
  if (!wide.matches) {
    els.shell.dataset.pane = 'list';
    if (viaButton && history.state && history.state.d !== undefined) history.back();
    const li = S.sel !== null ? els.list.querySelector(`li[data-row="${S.sel}"]`) : null;
    if (li) li.scrollIntoView({ block: 'nearest' });
  } else {
    S.sel = null;
    renderList();
    renderDetail();
  }
}

function go(dir) {
  const it = current();
  if (!it) return;
  const i = order.indexOf(it);
  const next = order[i + dir];
  if (next) select(next.row);
}

// ----- Checking items --------------------------------------------------------

function setChecked(it, value) {
  edit(it, 'checked', value);
}

// ----- Toasts, banner, status ------------------------------------------------

export function toast(text, { action = null, ms = 5000 } = {}) {
  while (els.toasts.children.length >= 2) els.toasts.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = text;
  t.appendChild(span);
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); close(); });
    t.appendChild(b);
  }
  els.toasts.appendChild(t);
  setTimeout(close, ms);
}

export function renderBanner() {
  if (!S.failures.length) { els.banner.hidden = true; els.banner.innerHTML = ''; return; }
  const n = S.failures.length;
  const first = S.failures[0];
  els.banner.hidden = false;
  els.banner.innerHTML = `
    <div class="banner-text"><strong>${n === 1 ? 'A change was not saved.' : `${fmtNum(n)} changes were not saved.`}</strong>
      <span>${esc(first.name)}: ${esc(first.message)}</span></div>
    <div class="banner-actions">
      <button type="button" class="btn btn-sm" data-b="refresh">Refresh data</button>
      <button type="button" class="btn btn-sm btn-ghost" data-b="dismiss">Dismiss</button>
    </div>`;
  els.banner.onclick = (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    dismissFailures();
    renderBanner();
    if (b.dataset.b === 'refresh') hooks.refresh();
  };
}

export function renderStatus(s = status()) {
  const w = s.waiting;
  const map = {
    idle: 'Saved',
    loading: 'Updating…',
    saving: 'Saving…',
    retry: `Retrying, ${fmtNum(w)} waiting`,
    offline: w ? `Offline, ${fmtNum(w)} waiting` : 'Offline',
    error: `${fmtNum(s.failed || 0)} not saved`
  };
  els.pill.dataset.state = s.state;
  els.pillLabel.textContent = map[s.state] || 'Saved';
  els.pill.title = s.state === 'idle' ? 'All changes saved. Tap to refresh.' : '';
}

export function showLoadError(message) {
  els.list.innerHTML = `<li class="empty"><strong>Can't load items</strong><span>${esc(message)}</span>
    <button class="btn btn-primary" type="button" data-act="retry">Try again</button></li>`;
}
