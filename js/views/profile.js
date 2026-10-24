import {
  auth, db, state, doc, updateDoc, bump, logActivity, updatePassword, reauthenticateWithCredential, EmailAuthProvider, esc, guard, toast, icon,
} from '../lib.js';

export default async function (root) {
  const p = state.profile;
  root.innerHTML = `<div class="title-row"><h1>${icon('user', 24)} Môj profil</h1></div>
  <div class="grid">
    <form class="card" id="info"><h2>Kontaktné údaje</h2>
      <label>Meno a priezvisko</label><input name="full_name" required value="${esc(p.full_name)}">
      <label>E-mail</label><input value="${esc(p.email)}" disabled>
      <label>Telefón</label><input name="phone" type="tel" value="${esc(p.phone)}">
      <label>Mesto</label><input name="city" value="${esc(p.city)}">
      <button class="btn" style="margin-top:1rem">${icon('check', 16)} Uložiť</button>
    </form>
    <form class="card" id="pw"><h2>${icon('lock')} Zmena hesla</h2>
      <label>Súčasné heslo</label><input name="current" type="password" required autocomplete="current-password">
      <label>Nové heslo (min. 8 znakov)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <label>Nové heslo znova</label><input name="password2" type="password" minlength="8" required autocomplete="new-password">
      <button class="btn" style="margin-top:1rem">Zmeniť heslo</button>
    </form>
  </div>`;

  root.querySelector('#info').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const row = { full_name: f.full_name.trim(), phone: f.phone.trim(), city: f.city.trim() };
    await updateDoc(doc(db, 'users', p.id), row);
    await bump('users');
    Object.assign(p, row);
    Object.assign(state.people.get(p.id) || {}, row);
    logActivity('Úprava profilu', 'meno, telefón alebo mesto');
    toast('Profil uložený');
  });

  root.querySelector('#pw').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.password2) throw new Error('Nové heslá sa nezhodujú');
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, f.current));
    await updatePassword(user, f.password);
    e.target.reset();
    logActivity('Zmena hesla');
    toast('Heslo zmenené');
  });
}
