import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, setPersistence, browserLocalPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where,
  orderBy, limit, onSnapshot, serverTimestamp, writeBatch, increment, deleteField,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getStorage, ref, uploadBytesResumable, getBlob, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { firebaseConfig } from './config.js';

export {
  setPersistence, browserLocalPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, increment, deleteField,
};
export { icon } from './icons.js';

export const configured = !firebaseConfig.apiKey.startsWith('YOUR');
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Lokálna cache Firestore – opätovné odbery do 30 minút účtujú len zmenené dokumenty
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const storage = getStorage(app);

export const state = { user: null, profile: null, settings: {}, people: new Map(), convs: [] };
export const isAdmin = () => state.profile?.role === 'admin';
export const isLecturer = () => state.profile?.role === 'lecturer';
// Študent = ani admin, ani lektor (starší účty nemusia mať rolu vyplnenú)
export const isStudent = u => (u?.role || 'student') === 'student';
export const ROLE_LABEL = { student: 'Študent', lecturer: 'Lektor', admin: 'Administrátor' };
export const feature = key => state.settings[key] !== false;

// Druhá inštancia Firebase len na zakladanie účtov adminom – admin sa tým neodhlási
let helperAuth = null;
export function getHelperAuth() {
  if (!helperAuth) {
    const helper = getApps().find(a => a.name === 'admin-helper') || initializeApp(firebaseConfig, 'admin-helper');
    helperAuth = initializeAuth(helper, { persistence: inMemoryPersistence });
  }
  return helperAuth;
}

// ---------- Firestore pomocníci ----------
export const col = name => collection(db, name);
export const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
export const list = async q => rows(await getDocs(q));
export const toDate = v => (v?.toDate ? v.toDate() : v?.seconds !== undefined ? new Date(v.seconds * 1000) : v ? new Date(v) : null);
export const byNewest = (a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0);

// ---------- Súbory ----------
export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' });
    task.on('state_changed', s => onProgress?.(s.bytesTransferred / s.totalBytes), reject, resolve);
  });
}
export const downloadFile = path => getBlob(ref(storage, path));
export const removeFile = path => deleteObject(ref(storage, path));

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

const ERRORS = {
  'auth/invalid-credential': 'Nesprávny e-mail alebo heslo',
  'auth/wrong-password': 'Nesprávne heslo',
  'auth/user-not-found': 'Účet s týmto e-mailom neexistuje',
  'auth/email-already-in-use': 'Účet s týmto e-mailom už existuje',
  'auth/weak-password': 'Heslo je príliš slabé (min. 8 znakov)',
  'auth/invalid-email': 'Neplatný e-mail',
  'auth/too-many-requests': 'Príliš veľa pokusov, skús to o chvíľu',
  'auth/requires-recent-login': 'Z bezpečnostných dôvodov sa odhlás a prihlás znova',
  'permission-denied': 'Na túto akciu nemáš oprávnenie',
  'storage/unauthorized': 'Na tento súbor nemáš oprávnenie',
  'storage/object-not-found': 'Súbor sa nenašiel',
  'storage/quota-exceeded': 'Úložisko je plné – kontaktuj administrátora',
};
export const errMsg = e => ERRORS[e?.code] || e?.message || String(e);

export async function guard(fn) {
  try { return await fn(); }
  catch (e) { console.error(e); toast(errMsg(e), 'err'); }
}

export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3000);
}

export function modal(title, bodyHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <header><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Zavrieť"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header>
      <div class="modal-body">${bodyHtml}</div></div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(wrap);
  wrap.querySelector('input, textarea, select')?.focus();
  return { el: wrap.querySelector('.modal-body'), close };
}

export const fmtDate = d => (d ? toDate(d).toLocaleDateString('sk-SK') : '—');
export const fmtDateTime = d => (d ? toDate(d).toLocaleString('sk-SK', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} kB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
export const initials = name => (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

// ---------- Profilové fotky ----------
// Fotka je malý JPEG uložený priamo v profile (pole photo) – nepotrebuje Storage ani plán Blaze
const PHOTO_PREFIX = 'data:image/jpeg;base64,';
const AVATAR_TONES = 6;
const tone = s => [...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES;

export function avatar(person, size = 34) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`;
  if (typeof person?.photo === 'string' && person.photo.startsWith(PHOTO_PREFIX)) {
    return `<img class="avatar photo" style="${style}" src="${person.photo}" alt="">`;
  }
  return `<div class="avatar tone-${tone(person?.id || person?.full_name)}" style="${style}">${esc(initials(person?.full_name))}</div>`;
}

// Zmenší obrázok na štvorec (orez na stred) a vráti JPEG ako data URL, typicky 5–10 kB
export function resizePhoto(file, px = 160, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Vyber obrázok (JPG, PNG…)'));
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, px, px);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Obrázok sa nepodarilo načítať'));
    img.src = URL.createObjectURL(file);
  });
}
export const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD v miestnom čase

// Bez diakritiky a špeciálnych znakov – bezpečné pre cesty v úložisku a v ZIP
export const safeName = s => String(s || 'subor').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 120);

// ---------- Šetrenie čítaní ----------
// Málo meniace sa zbierky si pamätáme v prehliadači. Dokument meta/versions drží čas poslednej
// zmeny každej zbierky; ak sa nezmenil, údaje sa berú z cache a databáza sa vôbec nečíta.
const CACHE_PREFIX = 'sh-cache:';
const LOADERS = {
  users: () => list(isAdmin() ? col('users') : query(col('users'), where('approved', '==', true))),
  announcements: () => list(col('announcements')),
  schedule: () => list(col('schedule')),
  subjects: () => list(col('subjects')),
  assignments: () => list(col('assignments')),
  materials: () => list(query(col('materials'), where('status', '==', 'approved'))),
  settings: async () => (await getDoc(doc(db, 'settings', 'app'))).data() || {},
};
let versions = {};
const versionOf = name => toDate(versions[name])?.getTime() || 0;
const cacheKey = name => `${CACHE_PREFIX}${state.user.uid}:${name}`;

// Živý odber verzií – 1 čítanie pri štarte a 1 pri každej zmene. `ready` počká na prvé údaje.
export function watchVersions(onChange) {
  let resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  const unsub = onSnapshot(doc(db, 'meta', 'versions'), snap => {
    if (!snap.exists() && !snap.metadata.fromCache && isAdmin()) {
      setDoc(doc(db, 'meta', 'versions'), Object.fromEntries(Object.keys(LOADERS).map(k => [k, serverTimestamp()])));
    }
    const before = JSON.stringify(Object.keys(LOADERS).map(versionOf));
    versions = snap.data({ serverTimestamps: 'estimate' }) || {};
    const changed = before !== JSON.stringify(Object.keys(LOADERS).map(versionOf));
    resolveReady();
    if (changed) onChange?.();
  }, e => { console.error(e); resolveReady(); });
  return { unsub, ready };
}

export async function cached(name) {
  const v = versionOf(name);
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(name)));
    if (c && c.v === v) return structuredClone(c.data);
  } catch {}
  const data = await LOADERS[name]();
  try { localStorage.setItem(cacheKey(name), JSON.stringify({ v, data })); } catch {}
  return data;
}

// Po zápise: označ zbierku ako zmenenú pre všetkých a zahoď vlastnú cache
export async function bump(name) {
  try { localStorage.removeItem(cacheKey(name)); } catch {}
  await setDoc(doc(db, 'meta', 'versions'), { [name]: serverTimestamp() }, { merge: true });
}

// ---------- Log aktivít (vidia ho iba admini) ----------
// Zapisuje kto, čo a kedy urobil. Obsah správ ani heslá sa nikdy nezapisujú.
export function logActivity(action, detail = '') {
  const user = auth.currentUser;
  if (!user) return Promise.resolve();
  const p = state.profile || {};
  return addDoc(col('logs'), {
    uid: user.uid, name: p.full_name || '', email: p.email || user.email || '', role: p.role || 'student',
    action, detail: String(detail).slice(0, 300), page: location.hash || '#/', at: serverTimestamp(),
    device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobil' : 'počítač',
  }).catch(e => console.warn('Záznam do logu sa nepodaril', e));
}

// Prvý záznam v relácii prehliadača: prihlásenie, registrácia alebo len otvorenie portálu
export function logSessionStart() {
  const key = `sh-session:${auth.currentUser?.uid}`;
  try {
    if (sessionStorage.getItem(key)) return;
    const how = sessionStorage.getItem('sh-login');
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem('sh-login');
    logActivity(how === 'signup' ? 'Registrácia' : how === 'login' ? 'Prihlásenie' : 'Otvorenie portálu',
      state.profile?.approved ? '' : 'účet čaká na schválenie');
  } catch {}
}

// ---------- Online stav ----------
// Kým je portál otvorený a viditeľný, raz za 2 minúty zapíšeme čas aktivity do presence/{uid}.
// Za online považujeme toho, kto bol aktívny za posledné 3 minúty.
const BEAT_MS = 120000;
export const ONLINE_MS = 180000;
let beatTimer = null;
const beat = () => setDoc(doc(db, 'presence', auth.currentUser.uid), { last_seen: serverTimestamp() }).catch(() => {});
const onVisibility = () => { if (document.visibilityState === 'visible') beat(); };

export function startPresence() {
  stopPresence();
  if (!auth.currentUser || state.profile?.hide_online) return;
  beat();
  beatTimer = setInterval(() => { if (document.visibilityState === 'visible') beat(); }, BEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
}
export function stopPresence() {
  clearInterval(beatTimer);
  beatTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}
export async function goOffline() {
  stopPresence();
  if (auth.currentUser) await deleteDoc(doc(db, 'presence', auth.currentUser.uid)).catch(() => {});
}
// Načíta iba práve aktívnych používateľov – počet čítaní = počet ľudí online
export async function onlineIds() {
  const rows = await list(query(col('presence'), where('last_seen', '>', new Date(Date.now() - ONLINE_MS))));
  return new Set(rows.map(r => r.id));
}

export async function logout() {
  await goOffline();
  await logActivity('Odhlásenie');
  try { sessionStorage.removeItem(`sh-session:${auth.currentUser?.uid}`); } catch {}
  await signOut(auth);
}

// ---------- Spotreba a bezplatné limity ----------
export const PROJECT_ID = firebaseConfig.projectId;
export const QUOTA = {
  storage_bytes: 5 * 1024 ** 3,        // Storage: 5 GB uložených
  downloaded_bytes: 100 * 1024 ** 3,   // Storage: 100 GB stiahnutých za mesiac
  reads: 50000, writes: 20000, deletes: 20000, // Firestore: za deň
};
export const WARN_AT = 0.75;

// Odhad obsadeného úložiska – mení sa pri nahratí a zmazaní práce
export function adjustStats(bytes, count) {
  return updateDoc(doc(db, 'meta', 'stats'), { storage_bytes: increment(bytes), submissions_count: increment(count) })
    .catch(e => console.warn('Štatistiku úložiska sa nepodarilo aktualizovať', e));
}

// Zoznam limitov s percentom využitia; presné čísla z Cloud Function majú prednosť pred odhadom
export function quotaUsage(stats = {}, usage = {}) {
  const items = [];
  const add = (label, used, limit, exact) => used != null && items.push({ label, used, limit, pct: used / limit, exact });
  add('Úložisko prác', usage.storage?.bytes ?? stats.storage_bytes, QUOTA.storage_bytes, usage.storage?.bytes != null);
  if (usage.storage) add('Stiahnuté zo Storage (mesiac)', usage.storage.downloaded_bytes_month, QUOTA.downloaded_bytes, true);
  if (usage.firestore) {
    add('Čítania z databázy (dnes)', usage.firestore.reads, QUOTA.reads, true);
    add('Zápisy do databázy (dnes)', usage.firestore.writes, QUOTA.writes, true);
    add('Mazania v databáze (dnes)', usage.firestore.deletes, QUOTA.deletes, true);
  }
  return items;
}

export function clearCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch {}
}

export async function loadPeople() {
  const people = (await cached('users')).filter(p => p.approved);
  state.people = new Map(people.map(p => [p.id, p]));
  return people;
}

export const DEFAULT_SETTINGS = { uploads_enabled: true, messaging_enabled: true, register_enabled: true, max_file_mb: 30 };
export async function loadSettings() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await cached('settings')) };
}

// Počet neprečítaných správ v konverzácii – odosielateľ zvyšuje počítadlo ostatným členom
export function unreadCount(c) {
  const n = c.unread?.[state.user.uid];
  if (n != null) return n;
  const read = toDate(c.reads?.[state.user.uid]);
  return c.last_sender && c.last_sender !== state.user.uid && (!read || toDate(c.last_message_at) > read) ? 1 : 0;
}
export const isUnread = c => unreadCount(c) > 0;

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Nepodarilo sa načítať knižnicu'));
    document.head.appendChild(s);
  });
}

// ---------- Zvuk pri novej správe ----------
// Krátky príjemný dvojtón generovaný prehliadačom (bez zvukového súboru). Nastavenie platí pre toto zariadenie.
export const soundEnabled = () => { try { return localStorage.getItem('sh-sound') !== 'off'; } catch { return true; } };
export const setSoundEnabled = on => { try { localStorage.setItem('sh-sound', on ? 'on' : 'off'); } catch {} };
let audioCtx = null;
export function playChime() {
  if (!soundEnabled()) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    [[880, 0], [1318.5, 0.13]].forEach(([freq, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.45);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.5);
    });
  } catch {}
}

export function toggleTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('sh-theme', next); } catch {}
}
