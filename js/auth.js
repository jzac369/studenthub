import {
  auth, db, doc, setDoc, serverTimestamp, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, logout, esc, toast, guard, icon, $,
} from './lib.js';
import { logo } from './icons.js';

// Registrácia zapisuje profil až po vytvorení účtu – main.js naň počká
export let signupDone = Promise.resolve();

export function renderAuth(root) {
  root.innerHTML = `<div class="auth"><div class="card">
    <div class="logo big">${logo(40, true)}</div>
    <div class="tabs"><button data-tab="login" class="active">Prihlásenie</button><button data-tab="signup">Registrácia</button></div>
    <form id="login">
      <label>E-mail</label><input name="email" type="email" required autocomplete="username">
      <label>Heslo</label><input name="password" type="password" required autocomplete="current-password">
      <div class="row" style="margin-top:1rem"><button class="btn">${icon('lock', 16)} Prihlásiť sa</button><span class="spacer"></span>
        <a href="#" id="forgot" class="small">Zabudnuté heslo?</a></div>
    </form>
    <form id="signup" class="hidden">
      <label>Meno a priezvisko</label><input name="full_name" required>
      <label>E-mail</label><input name="email" type="email" required autocomplete="username">
      <div class="row nowrap">
        <div class="grow"><label>Telefón</label><input name="phone" type="tel"></div>
        <div class="grow"><label>Mesto</label><input name="city"></div>
      </div>
      <label>Heslo (min. 8 znakov)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <p class="muted small">Po registrácii musí tvoj účet schváliť administrátor.</p>
      <button class="btn">${icon('userPlus', 16)} Zaregistrovať sa</button>
    </form>
  </div><p class="powered">Powered by <b>DigiStart ADV</b> · <a href="privacy.html">Ochrana súkromia</a></p></div>`;

  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    $('#login', root).classList.toggle('hidden', b.dataset.tab !== 'login');
    $('#signup', root).classList.toggle('hidden', b.dataset.tab !== 'signup');
  });

  $('#login', root).onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { sessionStorage.setItem('sh-login', 'login'); } catch {}
    await signInWithEmailAndPassword(auth, f.email.trim(), f.password);
  });

  $('#signup', root).onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    let finish;
    signupDone = new Promise(r => (finish = r));
    try { sessionStorage.setItem('sh-login', 'signup'); } catch {}
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        full_name: f.full_name.trim(), email: cred.user.email, phone: f.phone.trim(), city: f.city.trim(),
        role: 'student', approved: false, created_at: serverTimestamp(),
      });
    } finally {
      finish();
    }
  });

  $('#forgot', root).onclick = e => guard(async () => {
    e.preventDefault();
    const email = $('#login [name=email]', root).value.trim();
    if (!email) return toast('Najprv vyplň e-mail', 'err');
    await sendPasswordResetEmail(auth, email);
    toast('Ak účet existuje, poslali sme odkaz na obnovenie hesla.');
  });
}

export function renderPending(root, profile) {
  root.innerHTML = `<div class="auth"><div class="card center">
    <div class="logo big">${logo(40, true)}</div>
    <div class="pending-ic">${icon('clock', 34)}</div>
    <h2>Účet čaká na schválenie</h2>
    <p class="muted">Ahoj ${esc(profile?.full_name || '')}, tvoju registráciu ešte musí potvrdiť administrátor. Skús to neskôr.</p>
    <div class="row" style="justify-content:center"><button class="btn ghost" id="reload">${icon('refresh', 16)} Skúsiť znova</button>
      <button class="btn ghost" id="out">${icon('logout', 16)} Odhlásiť sa</button></div>
  </div><p class="powered">Powered by <b>DigiStart ADV</b> · <a href="privacy.html">Ochrana súkromia</a></p></div>`;
  $('#reload', root).onclick = () => location.reload();
  $('#out', root).onclick = () => logout();
}
