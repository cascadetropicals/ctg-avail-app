// Small formatting helpers shared by the UI.

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 -> "1,234.5". Blank values show an em dash. */
export function fmtNum(v) {
  return v === null || v === undefined || v === '' ? '—' : nf.format(v);
}

export function fmtMoney(v) {
  return v === null || v === undefined || v === '' ? '—' : '$' + money.format(v);
}

export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** "4in" -> { n: 4, unit: 'in' }.  Anything else -> { text }. */
export function sizeParts(size) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*in\s*$/i.exec(String(size || ''));
  if (m) return { n: parseFloat(m[1]), unit: 'in' };
  const t = String(size || '').trim();
  return { text: t.length > 4 ? t.slice(0, 4) : t };
}

/** Item names end with the pot size ("Aglaonema maria - 10in"); the size badge already shows it. */
export function displayName(name, size) {
  const n = String(name || '');
  const s = String(size || '').trim();
  if (s) {
    const suffix = ' - ' + s;
    if (n.toLowerCase().endsWith(suffix.toLowerCase())) return n.slice(0, n.length - suffix.length);
  }
  return n;
}

export function firstName(emailOrName) {
  const s = String(emailOrName || '');
  return s.includes('@') ? s.split('@')[0] : s;
}

export function initial(s) {
  const t = String(s || '?').trim();
  return (t[0] || '?').toUpperCase();
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today, 9:41 AM", "Yesterday, 4:05 PM", "Tuesday", "Oct 2, 2026". */
export function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const sod = startOfToday();
  const day = 86400000;
  if (d.getTime() >= sod) return 'Today, ' + timeFmt.format(d);
  if (d.getTime() >= sod - day) return 'Yesterday, ' + timeFmt.format(d);
  if (d.getTime() >= sod - 5 * day) return weekdayFmt.format(d) + ', ' + timeFmt.format(d);
  return dayFmt.format(d);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Safe localStorage helpers (storage can be blocked or full). */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};
