import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where,
  orderBy, limit, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getStorage, ref, uploadBytesResumable, getBlob, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { firebaseConfig } from './config.js';

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch,
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
  return `${(b / 1048576).toFixed(1)} MB`;
}
export const initials = name => (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
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

export function isUnread(c) {
  const read = toDate(c.reads?.[state.user.uid]);
  return !!c.last_sender && c.last_sender !== state.user.uid && (!read || toDate(c.last_message_at) > read);
}

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

export function toggleTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('sh-theme', next); } catch {}
}
