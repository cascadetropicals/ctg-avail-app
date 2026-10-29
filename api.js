// Talks to the Apps Script web app. Falls back to the built-in demo backend when
// no API_URL is configured (or when the page is opened with ?demo).

import { store } from './format.js';

const CFG = window.CG_CONFIG || {};
const SESSION_KEY = 'cg.session.v1';

export const isDemo = () => !CFG.API_URL || new URLSearchParams(location.search).has('demo');

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function getSession() {
  const s = store.get(SESSION_KEY);
  if (!s || !s.token) return null;
  if (s.exp && s.exp * 1000 < Date.now()) return null;
  return s;
}

function setSession(s) { store.set(SESSION_KEY, s); }
export function clearSession() { store.remove(SESSION_KEY); }

let demoModule = null;
async function demo() {
  if (!demoModule) demoModule = await import('./demo.js');
  return demoModule;
}

async function post(body, timeoutMs = 45000) {
  if (isDemo()) return (await demo()).handle(body);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight
    // that Apps Script web apps cannot answer.
    res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError('NETWORK', 'No connection to the server.');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await res.json(); } catch (e) {
    throw new ApiError('NETWORK', 'The server sent an unexpected reply.');
  }
  if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'SERVER', (data && data.message) || 'Something went wrong.');
  return data;
}

/** Authenticated call. Keeps the session token fresh when the server renews it. */
export async function call(action, extra = {}) {
  const session = getSession();
  if (!session) throw new ApiError('AUTH', 'Please sign in.');
  const data = await post({ a: action, token: session.token, ...extra });
  if (data.session && data.session.token) {
    setSession({ ...session, token: data.session.token, exp: data.session.exp });
  }
  return data;
}

export async function login(idToken) {
  const data = await post({ a: 'login', idToken });
  const session = { token: data.session.token, exp: data.session.exp, email: data.user.email, name: data.user.name };
  setSession(session);
  return session;
}
