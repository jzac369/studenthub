import {
  auth, db, state, doc, updateDoc, deleteField, bump, startPresence, goOffline, soundEnabled, setSoundEnabled, playChime, logActivity, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  avatar, resizePhoto, esc, guard, toast, icon,
} from '../lib.js';

export default async function (root) {
  const p = state.profile;
  root.innerHTML = `<div class="title-row"><h1>${icon('user', 24)} Môj profil</h1></div>
  <div class="card" style="margin-bottom:1rem"><h2>Profilová fotka <span class="badge">nepovinná</span></h2>
    <div class="photo-edit"><div id="ph">${avatar(p, 88)}</div>
      <div><p class="muted small" style="margin:0 0 .6rem">Fotka sa zobrazí v Registri študentov a v správach. Automaticky ju orežeme na štvorec a zmenšíme.</p>
        <div class="row"><label class="btn ghost" style="margin:0">${icon('upload', 16)} ${p.photo ? 'Zmeniť fotku' : 'Nahrať fotku'}<input type="file" id="photo" accept="image/*" hidden></label>
          ${p.photo ? `<button class="btn ghost" id="nophoto">${icon('trash', 16)} Odstrániť</button>` : ''}</div></div></div>
  </div>
  <div class="grid">
    <form class="card" id="info"><h2>Kontaktné údaje</h2>
      <label>Meno a priezvisko</label><input name="full_name" required value="${esc(p.full_name)}">
      <label>E-mail</label><input value="${esc(p.email)}" disabled>
      <label>Telefón</label><input name="phone" type="tel" value="${esc(p.phone)}">
      <label>Mesto</label><input name="city" value="${esc(p.city)}">
      <label class="check" style="margin-top:.9rem"><input type="checkbox" name="show_online" ${p.hide_online ? '' : 'checked'}> Zobrazovať ostatným, keď som online</label>
      <label class="check"><input type="checkbox" id="sound" ${soundEnabled() ? 'checked' : ''}> Zvuk pri novej správe (na tomto zariadení)</label>
      <button class="btn" style="margin-top:1rem">${icon('check', 16)} Uložiť</button>
    </form>
    <form class="card" id="pw"><h2>${icon('lock')} Zmena hesla</h2>
      <label>Súčasné heslo</label><input name="current" type="password" required autocomplete="current-password">
      <label>Nové heslo (min. 8 znakov)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <label>Nové heslo znova</label><input name="password2" type="password" minlength="8" required autocomplete="new-password">
      <button class="btn" style="margin-top:1rem">Zmeniť heslo</button>
    </form>
  </div>`;

  async function savePhoto(photo) {
    await updateDoc(doc(db, 'users', p.id), { photo: photo ?? deleteField() });
    await bump('users');
    if (photo) p.photo = photo; else delete p.photo;
    const person = state.people.get(p.id);
    if (person) { if (photo) person.photo = photo; else delete person.photo; }
    document.querySelector('.me .avatar')?.replaceWith(document.createRange().createContextualFragment(avatar(p, 34)));
    logActivity(photo ? 'Nahranie profilovej fotky' : 'Odstránenie profilovej fotky');
    toast(photo ? 'Fotka uložená' : 'Fotka odstránená');
    (await import('./profile.js')).default(root);
  }
  root.querySelector('#photo').onchange = e => guard(async () => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1048576) throw new Error('Obrázok je príliš veľký (max. 15 MB)');
    await savePhoto(await resizePhoto(file));
  });
  root.querySelector('#nophoto')?.addEventListener('click', () => guard(async () => {
    if (confirm('Odstrániť profilovú fotku?')) await savePhoto(null);
  }));

  root.querySelector('#sound').onchange = e => {
    setSoundEnabled(e.target.checked);
    if (e.target.checked) playChime();
  };

  root.querySelector('#info').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const row = { full_name: f.full_name.trim(), phone: f.phone.trim(), city: f.city.trim(), hide_online: !f.show_online };
    await updateDoc(doc(db, 'users', p.id), row);
    await bump('users');
    Object.assign(p, row);
    Object.assign(state.people.get(p.id) || {}, row);
    if (row.hide_online) await goOffline(); else startPresence();
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
