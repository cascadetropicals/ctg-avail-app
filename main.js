// Start-up: sign-in, first load, background sync.

import * as api from './api.js';
import * as st from './store.js';
import * as ui from './ui.js';
import { store } from './format.js';

const CFG = window.CG_CONFIG || {};
const $ = (s) => document.querySelector(s);

let pollTimer = null;
let started = false;

function registerWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* the app works without it */ });
  }
}

// ----- Sign-in screen --------------------------------------------------------
// Step 1: Google account. Step 2: "Who is working?" (tablets are shared); that
// name is saved as "Last edited by".

const NAME_KEY = 'cg.name.v1';
let googleCredential = null;   // Google ID token, kept in memory between the two steps

function loginMessage(text) {
  const el = $('#loginMsg');
  el.textContent = text || '';
  el.hidden = !text;
}

function loadGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.onload = ok; s.onerror = no;
    document.head.append(s);
  });
}

function showNameStep() {
  $('#gbtn').hidden = true;
  $('#loginForm').hidden = false;
  $('#loginSub').textContent = 'Who is working? Your name is saved with each change.';
  const name = $('#loginName');
  name.value = store.get(NAME_KEY) || '';
  setTimeout(() => name.focus({ preventScroll: true }), 50);
}

async function showLogin(message) {
  stopPolling();
  started = false;
  googleCredential = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginForm').hidden = true;
  $('#gbtn').hidden = false;
  $('#loginSub').textContent = 'Sign in with Google to see and update availability.';
  loginMessage(message);
  $('#loginFoot').textContent = api.isDemo()
    ? 'Demo mode: made-up plants, nothing is sent anywhere. Set API_URL in config.js to use real data.'
    : 'Use the Google account your manager gave you.';

  if (api.isDemo()) { showNameStep(); return; }   // no Google in demo mode

  try {
    const { googleClientId } = await api.info();
    if (!googleClientId) { loginMessage('Sign-in is not set up yet. Ask your manager.'); return; }
    await loadGoogle();
    window.google.accounts.id.initialize({
      client_id: googleClientId, auto_select: false, cancel_on_tap_outside: false,
      callback: (r) => { googleCredential = r.credential; loginMessage(''); showNameStep(); }
    });
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    window.google.accounts.id.renderButton($('#gbtn'),
      { theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: 320 });
  } catch (e) {
    loginMessage('Could not reach Google or the server. Check the connection and reload.');
  }
}

async function onLoginSubmit(ev) {
  ev.preventDefault();
  const name = $('#loginName').value.trim();
  if (name.length < 2) { loginMessage('Please enter your name (at least 2 letters).'); $('#loginName').focus(); return; }
  loginMessage('');
  const btn = $('#loginGo');
  btn.disabled = true;
  btn.textContent = 'One moment…';
  try {
    const session = await api.login(googleCredential, name);
    store.set(NAME_KEY, session.name);
    startApp(session);
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'FORBIDDEN') { showLogin(e.message); return; }
    loginMessage(e.message || 'Could not continue. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

// ----- App -------------------------------------------------------------------

async function startApp(session) {
  if (started) return;
  started = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  st.setMe(session);
  ui.setUser(session);
  ui.setDemoTag(api.isDemo());

  const cached = st.restore();
  ui.renderAll();
  ui.renderStatus();

  try {
    await st.refresh();
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'FORBIDDEN') { showLogin(e.message); return; }
    if (!cached) ui.showLoadError(e.code === 'NETWORK' ? 'The server could not be reached. Check the connection and try again.' : e.message);
  }
  st.flush();
  startPolling();
}

function startPolling() {
  stopPolling();
  const every = Math.max(10, Number(CFG.POLL_SECONDS) || 25) * 1000;
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !st.S.online) return;
    if (Date.now() - st.S.loadedAt > 5 * 60 * 1000 && !st.S.queue.length) st.refresh(false).catch(() => {});
    else st.poll();
  }, every);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshNow() {
  try {
    await st.refresh(true);
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'FORBIDDEN') showLogin(e.message);
    else if (!st.S.hasData) ui.showLoadError(e.message);
    // Offline or failed refresh: the sync pill already shows the state, no popup.
  }
}

function confirmDialog({ title, body, ok }) {
  const d = $('#confirm');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  $('#confirmOk').textContent = ok;
  return new Promise((resolve) => {
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

async function signOut() {
  const n = st.S.queue.length;
  if (n) {
    const ok = await confirmDialog({
      title: 'Switch user and lose changes?',
      body: `${n} ${n === 1 ? 'change has' : 'changes have'} not reached the sheet yet. Switching user now will discard ${n === 1 ? 'it' : 'them'}.`,
      ok: 'Switch user'
    });
    if (!ok) return;
  }
  api.clearSession();
  st.clearLocal(true);
  location.reload();
}

function onAuthLost(e) {
  // Keep unsaved changes; they are sent after the next sign-in.
  api.clearSession();
  showLogin(e && e.message ? e.message : 'Please sign in again.');
}

// ----- Boot ------------------------------------------------------------------

function boot() {
  registerWorker();
  $('#loginForm').addEventListener('submit', onLoginSubmit);
  $('#loginBack').addEventListener('click', () => showLogin());
  ui.init({ refresh: refreshNow, signOut });
  st.on('auth', onAuthLost);
  window.addEventListener('online', () => st.setOnline(true));
  window.addEventListener('offline', () => st.setOnline(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && started) { st.poll(); st.flush(); }
  });
  const session = api.getSession();
  if (session) startApp(session);
  else showLogin();
}

boot();
