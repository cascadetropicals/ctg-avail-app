// App state: items, the three views, optimistic edits, the save queue and syncing.
//
// How saving works (this is why the app feels instant):
//  1. A tap changes the value on screen immediately ("pending").
//  2. The change is written to a queue that survives reloads and offline periods.
//  3. A background loop sends the queue to the server in small batches and retries
//     with back-off. The screen never waits for the sheet.

import { call, ApiError } from './api.js';
import { store as ls, uid, startOfToday, debounce } from './format.js';

const CFG = window.CG_CONFIG || {};
const KEY_DATA = 'cg.data.v1';
const KEY_QUEUE = 'cg.queue.v1';
const STAMP_KEYS = ['avail', 'future', 'ctgQty', 'twoWks'];

/** Edits to these fields can change which view an item is in, or its sort position. */
export const ORDER_KEYS = new Set(['checked', 'avail', 'future', 'ctgQty', 'twoWks', 'edited']);

export const S = {
  fields: [],
  items: [],
  byRow: new Map(),
  byName: new Map(),
  seq: 0,
  loadedAt: 0,
  hasData: false,
  queue: [],
  pending: new Map(),   // item name -> merged unsaved values (what the screen shows)
  failures: [],
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  loading: false,
  flushing: false,
  me: null,
  view: 'all',
  q: '',
  sel: null,
  advance: ls.get('cg.opt.advance', true)
};

const listeners = {};
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => fn(payload)); }

// ----- Reading values --------------------------------------------------------

/** The value to show: unsaved local change first, then what the sheet last said. */
export function val(item, key) {
  const p = S.pending.get(item.v.name);
  if (p && key in p) return p[key];
  return item.v[key];
}

export function hasPending(item) {
  return S.pending.has(item.v.name);
}

function isStale(iso) {
  if (!iso) return true; // never edited counts as not edited
  const t = new Date(iso).getTime();
  if (isNaN(t)) return true;
  return t < startOfToday() - (CFG.STALE_DAYS === undefined ? 1 : CFG.STALE_DAYS) * 86400000;
}

const num = (v) => (typeof v === 'number' ? v : 0);

export const VIEWS = [
  {
    id: 'all', label: 'All items', short: 'All items', icon: 'i-list', note: '',
    test: () => true
  },
  {
    id: 'stale', label: 'Not edited in 2 days', short: 'Not edited', icon: 'i-clock',
    note: 'Available items that nobody has edited in the last 2 days.',
    test: (it) => (val(it, 'avail') || val(it, 'future') || num(val(it, 'ctgQty')) > 0 || num(val(it, 'twoWks')) > 0)
      && isStale(val(it, 'edited'))
  },
  {
    id: 'zero', label: 'Available, qty 0', short: 'Qty 0', icon: 'i-alert',
    note: 'Marked available, but CTG avail qty is 0.',
    test: (it) => val(it, 'avail') === true && num(val(it, 'ctgQty')) === 0
  }
];

function hay(item) {
  const v = item.v;
  return [v.name, v.code, v.barcode, v.picking, v.crop, v.feature, v.size].join(' ').toLowerCase();
}

function sizeKey(it) { return String(it.v.size || ''); }

/** Same order as the AppSheet app: unchecked first, then by size, then sheet order. */
function compare(a, b) {
  const ca = val(a, 'checked') ? 1 : 0;
  const cb = val(b, 'checked') ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const sa = sizeKey(a);
  const sb = sizeKey(b);
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.idx - b.idx;
}

export function list(viewId = S.view, q = S.q) {
  const view = VIEWS.find((v) => v.id === viewId) || VIEWS[0];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const it of S.items) {
    if (!view.test(it)) continue;
    if (words.length) {
      let ok = true;
      for (const w of words) if (!it.hay.includes(w)) { ok = false; break; }
      if (!ok) continue;
    }
    out.push(it);
  }
  return out.sort(compare);
}

export function counts() {
  const c = { all: 0, stale: 0, zero: 0, checked: 0 };
  for (const it of S.items) {
    c.all++;
    if (VIEWS[1].test(it)) c.stale++;
    if (VIEWS[2].test(it)) c.zero++;
    if (val(it, 'checked')) c.checked++;
  }
  return c;
}

// ----- Loading and caching ---------------------------------------------------

function indexItems() {
  S.byRow = new Map();
  S.byName = new Map();
  S.items.forEach((it, i) => { it.idx = i; S.byRow.set(it.row, it); S.byName.set(it.v.name, it); });
}

function applyRows(fields, rows) {
  S.fields = fields;
  S.items = rows.map((r) => {
    const v = {};
    for (let j = 0; j < fields.length; j++) v[fields[j]] = r[j + 1];
    const it = { row: r[0], idx: 0, v, hay: '', flash: 0 };
    it.hay = hay(it);
    return it;
  });
  indexItems();
  // Pending edits follow their item (by name) if its row number changed.
  for (const op of S.queue) {
    const it = S.byName.get(op.name);
    if (it) op.row = it.row;
  }
  recomputePending();
  S.hasData = true;
}

const persistData = debounce(() => {
  ls.set(KEY_DATA, {
    ts: S.loadedAt, seq: S.seq, fields: S.fields,
    rows: S.items.map((it) => [it.row, ...S.fields.map((k) => it.v[k])])
  });
}, 900);

function persistQueue() {
  ls.set(KEY_QUEUE, S.queue.map((o) => ({ id: o.id, row: o.row, name: o.name, set: o.set, ts: o.ts, tries: o.tries })));
}

/** Restore the last known data and any unsaved edits, so the app opens instantly. */
export function restore() {
  const q = ls.get(KEY_QUEUE, []);
  S.queue = Array.isArray(q) ? q.map((o) => ({ ...o, sending: false, nextTry: 0 })) : [];
  const d = ls.get(KEY_DATA);
  if (d && Array.isArray(d.rows) && d.rows.length) {
    S.seq = d.seq || 0;
    S.loadedAt = d.ts || 0;
    applyRows(d.fields, d.rows);
  } else {
    recomputePending();
  }
  emit('data', { all: true });
  updateStatus();
  return S.hasData;
}

export function setMe(me) { S.me = me; recomputePending(); }

export async function refresh(force = false) {
  if (S.loading) return;
  S.loading = true;
  updateStatus();
  try {
    const res = await call('load', { force });
    S.seq = res.seq || 0;
    S.loadedAt = Date.now();
    applyRows(res.fields, res.rows);
    persistData();
    emit('data', { all: true, fresh: true });
  } finally {
    S.loading = false;
    updateStatus();
  }
}

// ----- Syncing changes from other people ------------------------------------

export async function poll() {
  if (!S.online || S.loading || !S.hasData) return;
  try {
    const res = await call('changes', { since: S.seq });
    if (res.reload) { await refresh(true); return; }
    if (!res.changes.length) { S.seq = res.seq; return; }
    const touched = [];
    for (const c of res.changes) {
      const it = S.byName.get(c.name);
      if (!it) continue;
      Object.assign(it.v, c.f);
      it.hay = hay(it);
      const mine = S.me && c.by === S.me.email;
      if (!mine) it.flash = Date.now();
      touched.push({ row: it.row, keys: Object.keys(c.f), external: !mine });
    }
    S.seq = res.seq;
    persistData();
    emit('data', { patches: touched });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'AUTH') emit('auth', e);
    else if (e instanceof ApiError && e.code === 'FORBIDDEN') emit('auth', e);
    // network errors are fine; the next poll tries again
  }
}

// ----- Editing ---------------------------------------------------------------

function recomputePending() {
  const map = new Map();
  const me = S.me ? S.me.email : '';
  for (const op of S.queue) {
    const cur = map.get(op.name) || {};
    Object.assign(cur, op.set);
    if (Object.keys(op.set).some((k) => STAMP_KEYS.includes(k))) cur.edited = new Date(op.ts).toISOString();
    if (me) cur.by = me;
    map.set(op.name, cur);
  }
  S.pending = map;
}

/**
 * Change one field on an item. Shows immediately; saves in the background.
 * Returns the previous value (handy for "Undo").
 */
export function edit(item, key, value, { quick = false } = {}) {
  const before = val(item, key);
  if (before === value) return before;
  let op = null;
  for (let i = S.queue.length - 1; i >= 0; i--) {
    const o = S.queue[i];
    if (o.name === item.v.name) { if (!o.sending) op = o; break; }
  }
  if (!op) {
    op = { id: uid(), row: item.row, name: item.v.name, set: {}, ts: Date.now(), tries: 0, sending: false, nextTry: 0 };
    S.queue.push(op);
  }
  op.set[key] = value;
  op.ts = Date.now();
  persistQueue();
  recomputePending();
  emit('data', { patches: [{ row: item.row, keys: [key, ...(STAMP_KEYS.includes(key) ? ['edited', 'by'] : ['by'])], urgent: !quick }] });
  updateStatus();
  scheduleFlush(quick ? 700 : 150);
  return before;
}

let flushTimer = null;
function scheduleFlush(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

const backoff = (tries) => Math.min(30000, 1000 * 2 ** Math.min(tries, 5));

export async function flush() {
  if (S.flushing) return;
  if (!S.online) { updateStatus(); return; }
  const now = Date.now();
  const ready = S.queue.filter((o) => !o.sending && o.nextTry <= now).slice(0, 40);
  if (!ready.length) { rearm(); updateStatus(); return; }

  S.flushing = true;
  ready.forEach((o) => { o.sending = true; });
  updateStatus();
  try {
    const res = await call('save', { ops: ready.map((o) => ({ id: o.id, row: o.row, name: o.name, set: o.set })) });
    const touched = [];
    for (const r of res.results) {
      const op = ready.find((o) => o.id === r.id);
      if (!op) continue;
      if (r.ok) {
        S.queue = S.queue.filter((o) => o !== op);
        const it = S.byName.get(op.name);
        if (it) {
          if (r.row && r.row !== it.row) { S.byRow.delete(it.row); it.row = r.row; S.byRow.set(it.row, it); }
          Object.assign(it.v, r.fields);
          it.hay = hay(it);
          touched.push({ row: it.row, keys: Object.keys(r.fields) });
        }
      } else if (r.error === 'BUSY' || r.error === 'SERVER') {
        op.sending = false; op.tries++; op.nextTry = Date.now() + backoff(op.tries);
      } else {
        // The server refused this change for good (item moved, sheet changed, bad value).
        S.queue = S.queue.filter((o) => o !== op);
        S.failures.push({ name: op.name, message: r.message || 'This change could not be saved.' });
        touched.push({ row: op.row, keys: Object.keys(op.set) });
      }
    }
    // Anything the server did not answer for goes back in the queue.
    ready.forEach((o) => { o.sending = false; });
    recomputePending();
    persistQueue();
    persistData();
    emit('data', { patches: touched, urgent: true });
    if (S.failures.length) emit('failure');
  } catch (e) {
    ready.forEach((o) => { o.sending = false; o.tries++; o.nextTry = Date.now() + backoff(o.tries); });
    persistQueue();
    if (e instanceof ApiError && (e.code === 'AUTH' || e.code === 'FORBIDDEN')) emit('auth', e);
    else if (e instanceof ApiError && e.code === 'SHEET_CHANGED') {
      S.queue = S.queue.filter((o) => !ready.includes(o));
      S.failures.push({ name: 'Sheet', message: e.message });
      recomputePending(); persistQueue();
      emit('data', { all: true });
      emit('failure');
    }
  } finally {
    S.flushing = false;
    updateStatus();
    rearm();
  }
}

function rearm() {
  const waiting = S.queue.filter((o) => !o.sending);
  if (!waiting.length) return;
  const next = Math.min(...waiting.map((o) => o.nextTry));
  scheduleFlush(Math.max(100, next - Date.now()));
}

export function dismissFailures() {
  S.failures = [];
  updateStatus();
}

// ----- Status ----------------------------------------------------------------

export function status() {
  const waiting = S.queue.length;
  if (S.failures.length) return { state: 'error', waiting, failed: S.failures.length };
  if (!S.online) return { state: 'offline', waiting };
  if (S.flushing) return { state: 'saving', waiting };
  if (waiting) {
    const retrying = S.queue.some((o) => o.tries > 0);
    return { state: retrying ? 'retry' : 'saving', waiting };
  }
  if (S.loading) return { state: 'loading', waiting: 0 };
  return { state: 'idle', waiting: 0 };
}

export function updateStatus() { emit('status', status()); }

export function setOnline(v) {
  S.online = v;
  updateStatus();
  if (v) { scheduleFlush(300); poll(); }
}

export function setView(id) { S.view = id; emit('view'); }
export function setQuery(q) { S.q = q; emit('view'); }
export function setAdvance(v) { S.advance = v; ls.set('cg.opt.advance', v); }

/** Forget local data (used when signing out). Unsaved edits are kept unless discard is true. */
export function clearLocal(discard = false) {
  ls.remove(KEY_DATA);
  if (discard) { ls.remove(KEY_QUEUE); S.queue = []; }
  S.items = []; S.byRow = new Map(); S.byName = new Map(); S.hasData = false; S.seq = 0;
  recomputePending();
}
