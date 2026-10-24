import {
  auth, db, state, configured, $, $$, esc, icon, isAdmin, feature, initials, toggleTheme, loadPeople, loadSettings,
  watchVersions, clearCache, onAuthStateChanged, signOut, doc, getDoc, setDoc, serverTimestamp, query, col, where, onSnapshot, rows, isUnread, errMsg,
} from './lib.js';
import { logo } from './icons.js';
import { renderAuth, renderPending, signupDone } from './auth.js';

const NAV = [
  { key: '',         label: 'Domov',         icon: 'home',     load: () => import('./views/dashboard.js') },
  { key: 'nastenka', label: 'Nástenka',      icon: 'pin',      load: () => import('./views/board.js') },
  { key: 'rozvrh',   label: 'Rozvrh',        icon: 'calendar', load: () => import('./views/schedule.js') },
  { key: 'prace',    label: 'Moje práce',    icon: 'upload',   load: () => import('./views/submissions.js'), feature: 'uploads_enabled' },
  { key: 'spravy',   label: 'Správy',        icon: 'message',  load: () => import('./views/messages.js'), feature: 'messaging_enabled', badge: true },
  { key: 'register', label: 'Register',      icon: 'users',    load: () => import('./views/register.js'), feature: 'register_enabled' },
  { key: 'profil',   label: 'Môj profil',    icon: 'user',     load: () => import('./views/profile.js') },
  { key: 'admin',    label: 'Administrácia', icon: 'shield',   load: () => import('./views/admin.js'), admin: true },
];

const app = $('#app');
let cleanup = null;
let unsubConvs = null;
let unsubVersions = null;
// Stránky, ktoré sa prekreslia, keď admin niečo zmení (nástenka, rozvrh…)
const LIVE_VIEWS = ['', 'nastenka', 'rozvrh', 'register'];

if (!configured) {
  app.innerHTML = `<div class="auth"><div class="card"><div class="logo big">${logo(40, true)}</div><h2>StudentHUB ešte nie je nastavený</h2>
    <p>Vyplň <code>js/config.js</code> údajmi z Firebase podľa návodu v README.md.</p></div></div>`;
} else {
  onAuthStateChanged(auth, user => handleSession(user));
}

async function handleSession(user) {
  teardown();
  if (!user) {
    state.user = state.profile = null;
    clearCache(); // na zdieľanom počítači po odhlásení nezostanú osobné údaje
    return renderAuth(app);
  }
  state.user = user;
  await signupDone;
  try {
    const ref = doc(db, 'users', user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      // Účet bez profilu (napr. prerušená registrácia) – doplníme neschválený profil
      await setDoc(ref, { full_name: '', email: user.email, phone: '', city: '', role: 'student', approved: false, created_at: serverTimestamp() });
      snap = await getDoc(ref);
    }
    state.profile = { id: user.uid, ...snap.data() };
    if (!state.profile.approved) return renderPending(app, state.profile);
    let shellReady = false;
    const versions = watchVersions(async () => {
      if (!shellReady) return;
      await Promise.all([loadSettings(), loadPeople()]);
      const key = location.hash.replace(/^#\/?/, '').split('/')[0];
      if (LIVE_VIEWS.includes(key) && !document.querySelector('.modal-back')) route();
    });
    unsubVersions = versions.unsub;
    await versions.ready;
    await Promise.all([loadSettings(), loadPeople()]);
    renderShell();
    shellReady = true;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="auth"><div class="card"><h2>Nepodarilo sa načítať portál</h2><p class="err-box">${esc(errMsg(e))}</p>
      <button class="btn ghost" id="out">${icon('logout', 16)} Odhlásiť sa</button></div></div>`;
    $('#out').onclick = () => signOut(auth);
  }
}

function teardown() {
  cleanup?.();
  cleanup = null;
  unsubConvs?.();
  unsubConvs = null;
  unsubVersions?.();
  unsubVersions = null;
  window.onhashchange = null;
}

function renderShell() {
  const p = state.profile;
  const items = NAV.filter(n => (!n.admin || isAdmin()) && (!n.feature || feature(n.feature)));
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="logo">${logo(25, true)}</div>
      <nav class="nav">${items.map(n => `<a href="#/${n.key}" data-key="${n.key}">${icon(n.icon)}<span>${n.label}</span>${n.badge ? '<span class="count hidden" id="unread"></span>' : ''}</a>`).join('')}</nav>
      <div class="side-foot">
        <div class="me"><div class="avatar">${esc(initials(p.full_name))}</div>
          <div class="min0"><div class="strong ellipsis">${esc(p.full_name)}</div><div class="muted small">${isAdmin() ? 'Administrátor' : 'Študent'}</div></div></div>
        <div class="row"><button class="btn ghost sm" id="theme" title="Prepnúť tmavý režim">${icon('moon', 15)} Režim</button>
          <button class="btn ghost sm" id="logout">${icon('logout', 15)} Odhlásiť</button></div>
        <p class="powered left">Powered by <b>DigiStart ADV</b></p>
      </div>
    </aside>
    <div class="min0">
      <div class="topbar"><button class="icon-btn" id="menu" aria-label="Menu">${icon('menu', 22)}</button><div class="logo">${logo(21)}</div></div>
      <main class="main" id="view"></main>
    </div>
  </div>`;
  const shell = $('.shell');
  $('#menu').onclick = () => shell.classList.toggle('nav-open');
  $$('.nav a').forEach(a => a.addEventListener('click', () => shell.classList.remove('nav-open')));
  $('#theme').onclick = toggleTheme;
  $('#logout').onclick = () => signOut(auth);

  // Jeden živý odber konverzácií – odznak neprečítaných aj zoznam v Správach
  if (feature('messaging_enabled')) {
    unsubConvs = onSnapshot(query(col('conversations'), where('members', 'array-contains', state.user.uid)), snap => {
      state.convs = rows(snap);
      const n = state.convs.filter(isUnread).length;
      const el = $('#unread');
      if (el) {
        el.textContent = n;
        el.classList.toggle('hidden', !n);
      }
      window.dispatchEvent(new Event('sh:convs'));
    }, e => console.error(e));
  }

  window.onhashchange = route;
  route();
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const item = NAV.find(n => n.key === parts[0]) || NAV[0];
  const root = $('#view');
  cleanup?.();
  cleanup = null;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.key === item.key));
  if (item.admin && !isAdmin()) return void (location.hash = '#/');
  if (item.feature && !feature(item.feature)) {
    root.innerHTML = `<div class="card">Táto funkcia je momentálne vypnutá administrátorom.</div>`;
    return;
  }
  root.innerHTML = '<p class="muted">Načítavam…</p>';
  try {
    const mod = await item.load();
    cleanup = (await mod.default(root, parts.slice(1))) || null;
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="card err-box">Chyba: ${esc(errMsg(e))}</div>`;
  }
}
