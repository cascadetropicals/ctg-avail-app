// Start-up: sign-in, first load, background sync.

import * as api from './api.js';
import * as st from './store.js';
import * as ui from './ui.js';

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

function loginMessage(text) {
  const el = $('#loginMsg');
  el.textContent = text || '';
  el.hidden = !text;
}

function showLogin(message) {
  stopPolling();
  started = false;
  $('#app').hidden = true;
  $('#login').hidden = false;
  loginMessage(message);
  if (api.isDemo()) renderDemoLogin();
  else renderGoogleButton();
}

function renderDemoLogin() {
  const box = $('#gsiButton');
  box.innerHTML = '<button class="btn btn-primary btn-lg" type="button" id="demoGo">Open with demo data</button>';
  $('#demoGo').addEventListener('click', async () => {
    startApp(await api.login('demo'));
  });
  $('.login-foot').textContent = 'Demo mode: made-up plants, nothing is sent anywhere. Set API_URL in config.js to use real data.';
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check the connection and reload.'));
    document.head.appendChild(s);
  });
}

async function renderGoogleButton() {
  try {
    if (!CFG.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is missing in config.js.');
    await loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    const box = $('#gsiButton');
    box.innerHTML = '';
    window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 300 });
  } catch (e) {
    loginMessage(e.message);
  }
}

async function onCredential(resp) {
  loginMessage('');
  $('#gsiButton').setAttribute('aria-busy', 'true');
  try {
    const session = await api.login(resp.credential);
    startApp(session);
  } catch (e) {
    loginMessage(e.message || 'Sign-in failed. Try again.');
  } finally {
    $('#gsiButton').removeAttribute('aria-busy');
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
    ui.toast('Data refreshed', { ms: 2000 });
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'FORBIDDEN') showLogin(e.message);
    else if (!st.S.hasData) ui.showLoadError(e.message);
    else ui.toast(e.code === 'NETWORK' ? 'No connection. Showing saved data.' : e.message, { ms: 4000 });
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
      title: 'Sign out and lose changes?',
      body: `${n} ${n === 1 ? 'change has' : 'changes have'} not reached the sheet yet. Signing out now will discard ${n === 1 ? 'it' : 'them'}.`,
      ok: 'Sign out'
    });
    if (!ok) return;
  }
  api.clearSession();
  st.clearLocal(true);
  if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
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
  ui.init({ refresh: refreshNow, signOut, setAdvance: st.setAdvance });
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
