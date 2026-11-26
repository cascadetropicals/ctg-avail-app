// Anonymous monthly feedback. Three short questions, never blocks the work.
// Nothing here knows or sends who the person is: the server stores answers only.

import * as api from './api.js';
import * as st from './store.js';
import { store } from './format.js';

// ----- Settings (change here) ------------------------------------------------
const APP_ID = 'cg-avail';
const APP_VERSION = 'v14';
const LANGUAGE = 'en';
const MIN_DAYS_OF_USE = 3;        // different days before the first ask
const COOLDOWN_DAYS = 30;         // after an answer
const SNOOZE_DAYS = 7;            // after "Not now", the X or Escape
const MAX_DISMISSALS_PER_MONTH = 2;
const SHOW_DELAY_MIN_MS = 5000;   // wait after a finished task before asking
const SHOW_DELAY_MAX_MS = 10000;
const MAX_TEXT = 500;
const THANKS_MS = 3000;
const ROTATION_START = '2026-11'; // first month of the rotating question

const Q1 = { id: 'ease', text: 'The app is easy to use.' };
const Q2_ROTATION = [
  { id: 'speed', text: 'The list is fast enough.' },
  { id: 'counts', text: 'The red and amber counts help me find what to fix.' },
  { id: 'scan', text: 'Scanning a barcode finds the item quickly.' }
];
const Q3 = { id: 'open', text: 'Is there anything that annoys you, or any suggestion to improve the app? (optional)' };
const SCALE = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

// localStorage keys
const K_ANSWERED = 'feedbackLastAnswered';
const K_SNOOZE = 'feedbackSnoozeUntil';
const K_DISMISS = 'feedbackDismissCount';
const K_DAYS = 'daysUsed';

const DAY = 86400000;
const $ = (s, r = document) => r.querySelector(s);

let shownThisSession = false;
let timer = null;
let box = null;       // the open card
let opener = null;    // element to give focus back to
let busy = false;

// ----- Small helpers ---------------------------------------------------------

function monthKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function dayKey(d = new Date()) { return monthKey(d) + '-' + String(d.getDate()).padStart(2, '0'); }
function monthIndex(key) { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1); }
function q2For(round) {
  const n = (monthIndex(round) - monthIndex(ROTATION_START)) % Q2_ROTATION.length;
  return Q2_ROTATION[(n + Q2_ROTATION.length) % Q2_ROTATION.length];
}
function storageWorks() {
  try { localStorage.setItem('cg.fb.probe', '1'); localStorage.removeItem('cg.fb.probe'); return true; } catch (e) { return false; }
}
function startOfNextMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); }

// ----- Eligibility -----------------------------------------------------------

function countToday() {
  const days = store.get(K_DAYS, []);
  const list = Array.isArray(days) ? days : [];
  const today = dayKey();
  if (!list.includes(today)) { list.push(today); store.set(K_DAYS, list.slice(-60)); }
}

function eligible() {
  if (shownThisSession) return false;
  if (!storageWorks()) return true; // cannot remember anything: ask at most once per session
  const days = store.get(K_DAYS, []);
  if (!Array.isArray(days) || days.length < MIN_DAYS_OF_USE) return false;
  const now = Date.now();
  const answered = Number(store.get(K_ANSWERED, 0)) || 0;
  if (answered && now - answered < COOLDOWN_DAYS * DAY) return false;
  const snooze = Number(store.get(K_SNOOZE, 0)) || 0;
  if (snooze && now < snooze) return false;
  return true;
}

function noteDismissal() {
  const round = monthKey();
  const cur = store.get(K_DISMISS, null);
  const n = (cur && cur.round === round ? Number(cur.n) || 0 : 0) + 1;
  store.set(K_DISMISS, { round, n });
  const until = n >= MAX_DISMISSALS_PER_MONTH ? startOfNextMonth() : Date.now() + SNOOZE_DAYS * DAY;
  store.set(K_SNOOZE, until);
}

function calmMoment() {
  if (document.visibilityState !== 'visible') return false;
  if (box || busy) return false;
  if (st.status().state !== 'idle') return false;
  if ($('dialog[open]')) return false;
  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  return true;
}

function scheduleAsk() {
  if (timer || !eligible()) return;
  const wait = SHOW_DELAY_MIN_MS + Math.random() * (SHOW_DELAY_MAX_MS - SHOW_DELAY_MIN_MS);
  timer = setTimeout(() => {
    timer = null;
    if (eligible() && calmMoment()) open(false);
  }, wait);
}

// ----- Popup -----------------------------------------------------------------

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
}

function open(manual) {
  if (box) return;
  if (!manual) shownThisSession = true;
  if (timer) { clearTimeout(timer); timer = null; }
  opener = manual ? $('#userBtn') : document.activeElement;

  const round = monthKey();
  const q2 = q2For(round);
  const answers = {
    q1: { id: Q1.id, s: 0, n: '' },
    q2: { id: q2.id, s: 0, n: '' },
    q3: ''
  };
  const steps = [
    { key: 'q1', q: Q1, kind: 'scale' },
    { key: 'q2', q: q2, kind: 'scale' },
    { key: 'q3', q: Q3, kind: 'text' }
  ];
  let step = 0;

  box = el('div', { class: 'fb', role: 'dialog', 'aria-labelledby': 'fbTitle', 'aria-modal': 'false' });
  document.body.append(box);
  requestAnimationFrame(() => box && box.classList.add('in'));

  function close(dismissed) {
    if (!box) return;
    if (dismissed) noteDismissal();
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    box = null;
    busy = false;
    if (opener && opener.isConnected && opener.focus) { try { opener.focus(); } catch (e) { /* ignore */ } }
    opener = null;
  }

  function onKey(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) close(true); return; }
    if (e.key !== 'Tab' || !box.contains(document.activeElement)) return;
    const f = [...box.querySelectorAll('button:not([disabled]), textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);

  function head(titleText) {
    const x = el('button', { class: 'fb-x', type: 'button', 'aria-label': 'Close' });
    x.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>';
    x.addEventListener('click', () => { if (!busy) close(true); });
    const title = el('h2', { id: 'fbTitle', tabindex: '-1', text: titleText });
    return el('div', { class: 'fb-head' }, [title, x]);
  }

  function render(focusFirst) {
    box.replaceChildren();
    const s = steps[step];
    const last = step === steps.length - 1;
    box.append(head('Quick feedback'));
    box.append(el('p', { class: 'fb-step', text: `Question ${step + 1} of ${steps.length}` }));
    const q = el('p', { class: 'fb-q', id: 'fbQ', text: s.q.text });
    box.append(q);

    let focusTarget = null;
    let next;

    if (s.kind === 'scale') {
      const a = answers[s.key];
      const group = el('div', { class: 'fb-scale', role: 'radiogroup', 'aria-labelledby': 'fbQ' });
      SCALE.forEach((label, i) => {
        const v = i + 1;
        const b = el('button', {
          class: 'fb-opt', type: 'button', role: 'radio', 'aria-checked': String(a.s === v),
          'aria-label': `${v}, ${label}`, tabindex: (a.s === v || (!a.s && v === 1)) ? '0' : '-1'
        }, [el('b', { text: String(v) }), el('span', { text: label })]);
        b.addEventListener('click', () => { a.s = v; sync(); });
        group.append(b);
      });
      group.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const v = Math.min(5, Math.max(1, (a.s || (d > 0 ? 0 : 6)) + d));
        a.s = v; sync();
        group.children[v - 1].focus();
      });
      box.append(group);

      const noteWrap = el('div', { class: 'fb-note' });
      const toggle = el('button', { class: 'fb-link', type: 'button', 'aria-expanded': String(!!a.n || false), text: '+ Add a note' });
      const ta = el('textarea', { class: 'fb-text', rows: '3', maxlength: String(MAX_TEXT), 'aria-label': 'Note (optional)', placeholder: 'Optional note' });
      ta.value = a.n;
      ta.hidden = !a.n;
      if (a.n) toggle.textContent = '− Hide note';
      toggle.addEventListener('click', () => {
        ta.hidden = !ta.hidden;
        toggle.setAttribute('aria-expanded', String(!ta.hidden));
        toggle.textContent = ta.hidden ? '+ Add a note' : '− Hide note';
        if (!ta.hidden) ta.focus();
      });
      ta.addEventListener('input', () => { a.n = ta.value; });
      noteWrap.append(toggle, ta);
      box.append(noteWrap);

      next = el('button', { class: 'btn btn-primary', type: 'button', text: 'Next' });
      next.addEventListener('click', () => { if (a.s) { step += 1; render(true); } });
      function sync() {
        [...group.children].forEach((b, i) => {
          b.setAttribute('aria-checked', String(a.s === i + 1));
          b.tabIndex = a.s === i + 1 ? 0 : -1;
        });
        next.disabled = !a.s;
        err.hidden = true;
      }
      var err = el('p', { class: 'fb-err', role: 'alert', hidden: '' });
      next.disabled = !a.s;
      focusTarget = a.s ? group.children[a.s - 1] : group.children[0];
    } else {
      const ta = el('textarea', { class: 'fb-text fb-open', rows: '5', maxlength: String(MAX_TEXT), 'aria-labelledby': 'fbQ' });
      ta.value = answers.q3;
      const count = el('p', { class: 'fb-count', 'aria-live': 'off' });
      const upd = () => { count.textContent = `${ta.value.length.toLocaleString('en-US')} / ${MAX_TEXT.toLocaleString('en-US')}`; };
      ta.addEventListener('input', () => { answers.q3 = ta.value; upd(); err.hidden = true; });
      upd();
      box.append(ta, count);
      next = el('button', { class: 'btn btn-primary', type: 'button', text: 'Send' });
      next.addEventListener('click', send);
      var err = el('p', { class: 'fb-err', role: 'alert', hidden: '' });
      focusTarget = ta;
    }

    box.append(err);

    const actions = el('div', { class: 'fb-actions' });
    if (step > 0) {
      const back = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Back' });
      back.addEventListener('click', () => { step -= 1; render(true); });
      actions.append(back);
    } else {
      const later = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Not now' });
      later.addEventListener('click', () => close(true));
      actions.append(later);
    }
    if (last) {
      const skip = el('button', { class: 'btn btn-ghost fb-skip', type: 'button', text: 'Skip' });
      skip.addEventListener('click', () => { answers.q3 = ''; send(); });
      actions.append(skip);
    }
    actions.append(next);
    box.append(actions);

    if (focusFirst || !box.dataset.focused) {
      box.dataset.focused = '1';
      // The first screen puts focus on the heading, so a screen reader reads the card.
      (focusFirst ? focusTarget : $('#fbTitle', box)).focus({ preventScroll: true });
    }

    async function send() {
      if (busy) return;
      busy = true;
      const buttons = [...box.querySelectorAll('button')];
      buttons.forEach((b) => { b.disabled = true; });
      next.textContent = 'Sending…';
      err.hidden = true;
      try {
        await api.call('feedback', {
          app: APP_ID, v: APP_VERSION, lang: LANGUAGE, round,
          q1: answers.q1, q2: answers.q2, q3: answers.q3
        });
      } catch (e) {
        busy = false;
        buttons.forEach((b) => { b.disabled = false; });
        next.textContent = 'Send';
        err.textContent = 'Could not send. Try again';
        err.hidden = false;
        next.focus();
        return;
      }
      busy = false;
      store.set(K_ANSWERED, Date.now());
      store.remove(K_SNOOZE);
      store.remove(K_DISMISS);
      thanks();
    }
  }

  function thanks() {
    box.replaceChildren();
    box.append(el('p', { class: 'fb-thanks', id: 'fbTitle', tabindex: '-1', role: 'status', text: 'Thank you. This helps us improve the app.' }));
    $('#fbTitle', box).focus({ preventScroll: true });
    setTimeout(() => close(false), THANKS_MS);
  }

  render(false);
}

// ----- Start -----------------------------------------------------------------

export function init() {
  countToday();

  // A finished task: saving or retrying ended and the app is calm again.
  let prev = st.status().state;
  st.on('status', (s) => {
    const was = prev;
    prev = s.state;
    if (s.state === 'idle' && (was === 'saving' || was === 'retry')) scheduleAsk();
  });

  // Back on the list after looking at an item.
  const shell = document.querySelector('.shell');
  if (shell && window.MutationObserver) {
    let pane = shell.dataset.pane;
    new MutationObserver(() => {
      const was = pane;
      pane = shell.dataset.pane;
      if (was === 'detail' && pane === 'list') scheduleAsk();
    }).observe(shell, { attributes: true, attributeFilter: ['data-pane'] });
  }
}

/** The "Give feedback" menu item. Works at any time. */
export function openManually() { open(true); }
