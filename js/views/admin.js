import {
  db, state, col, doc, query, where, list, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, toDate, byNewest,
  createUserWithEmailAndPassword, signOut, getHelperAuth, downloadFile, loadSettings, DEFAULT_SETTINGS,
  esc, guard, toast, modal, fmtDate, fmtDateTime, fmtSize, safeName, downloadBlob, loadScript, icon,
} from '../lib.js';

const TABS = [
  ['users', 'users', 'Používatelia', renderUsers],
  ['forward', 'archive', 'Práce a preposielanie', renderForward],
  ['subjects', 'book', 'Predmety a termíny', renderSubjects],
  ['settings', 'sliders', 'Nastavenia', renderSettings],
];

export default async function (root, [tab = 'users']) {
  const current = TABS.find(t => t[0] === tab) || TABS[0];
  root.innerHTML = `<div class="title-row"><h1>${icon('shield', 24)} Administrácia</h1></div>
    <div class="tabs">${TABS.map(([k, ic, l]) => `<a href="#/admin/${k}" class="${k === current[0] ? 'active' : ''}">${icon(ic, 15)} ${l}</a>`).join('')}</div>
    <div id="tab"></div>`;
  await current[3](root.querySelector('#tab'));
}

// ---------------------------------------------------------------- Používatelia
async function renderUsers(el) {
  const users = (await list(col('users'))).sort((a, b) => (a.approved - b.approved) || a.full_name.localeCompare(b.full_name, 'sk'));
  const pending = users.filter(u => !u.approved).length;
  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem"><span class="muted">${users.length} účtov · ${pending} čaká na schválenie</span>
      <span class="spacer"></span><input id="q" placeholder="Hľadať…" style="max-width:220px"><button class="btn" id="add">${icon('userPlus', 16)} Pridať študenta</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Meno</th><th>Kontakt</th><th>Mesto</th><th>Rola</th><th>Stav</th><th>Akcie</th></tr></thead>
    <tbody>${users.map(u => `<tr data-n="${esc(`${u.full_name} ${u.email}`.toLowerCase())}">
      <td><strong>${esc(u.full_name || '—')}</strong><div class="muted small">od ${fmtDate(u.created_at)}</div></td>
      <td>${esc(u.email)}<div class="muted small">${esc(u.phone)}</div></td><td>${esc(u.city)}</td>
      <td>${u.role === 'admin' ? '<span class="badge pri">admin</span>' : 'študent'}</td>
      <td>${u.approved ? '<span class="badge ok">aktívny</span>' : '<span class="badge warn">čaká</span>'}</td>
      <td class="nowrap-cell">${u.id === state.user.uid ? '<span class="muted small">to si ty</span>' : `
        <button class="btn sm ${u.approved ? 'ghost' : ''}" data-approve="${u.id}" data-v="${!u.approved}">${u.approved ? 'Deaktivovať' : `${icon('check', 14)} Schváliť`}</button>
        <button class="btn sm ghost" data-role="${u.id}" data-v="${u.role === 'admin' ? 'student' : 'admin'}">${u.role === 'admin' ? 'Odobrať admina' : 'Urobiť adminom'}</button>`}</td>
    </tr>`).join('')}</tbody></table></div></div>`;

  el.querySelector('#q').oninput = e => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('hidden', !tr.dataset.n.includes(q)));
  };
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => guard(async () => {
    await updateDoc(doc(db, 'users', b.dataset.approve), { approved: b.dataset.v === 'true' });
    renderUsers(el);
  }));
  el.querySelectorAll('[data-role]').forEach(b => b.onclick = () => guard(async () => {
    if (b.dataset.v === 'admin' && !confirm('Tento používateľ získa plný prístup k administrácii. Pokračovať?')) return;
    await updateDoc(doc(db, 'users', b.dataset.role), { role: b.dataset.v });
    renderUsers(el);
  }));
  el.querySelector('#add').onclick = () => addStudent(() => renderUsers(el));
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint32Array(10))].map(n => chars[n % chars.length]).join('');
}

function addStudent(done) {
  const m = modal('Pridať študenta', `<form>
    <label>Meno a priezvisko</label><input name="full_name" required>
    <label>E-mail</label><input name="email" type="email" required>
    <div class="row nowrap"><div class="grow"><label>Telefón</label><input name="phone" type="tel"></div><div class="grow"><label>Mesto</label><input name="city"></div></div>
    <p class="muted small">Vygenerujeme dočasné heslo, ktoré študentovi pošleš. Po prihlásení si ho zmení v profile.</p>
    <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">Vytvoriť účet</button></div></form>`);
  m.el.querySelector('form').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const password = randomPassword();
    const helper = getHelperAuth();
    const cred = await createUserWithEmailAndPassword(helper, f.email.trim(), password);
    await signOut(helper);
    await setDoc(doc(db, 'users', cred.user.uid), {
      full_name: f.full_name.trim(), email: cred.user.email, phone: f.phone.trim(), city: f.city.trim(),
      role: 'student', approved: true, created_at: serverTimestamp(),
    });
    m.el.innerHTML = `<p>Účet pre <strong>${esc(f.full_name)}</strong> je vytvorený a schválený.</p>
      <p>E-mail: <strong>${esc(cred.user.email)}</strong><br>Dočasné heslo: <code class="pw">${password}</code></p>
      <p class="muted small">Heslo si teraz skopíruj – neskôr ho už neuvidíš.</p>
      <div class="actions"><button class="btn ghost" id="copy">${icon('copy', 15)} Kopírovať</button><button class="btn" data-close>Hotovo</button></div>`;
    m.el.querySelector('#copy').onclick = () => navigator.clipboard
      .writeText(`StudentHUB: ${location.origin + location.pathname}\nE-mail: ${cred.user.email}\nHeslo: ${password}`)
      .then(() => toast('Skopírované'));
    done();
  });
}

// ---------------------------------------------------------------- Práce a preposielanie
async function renderForward(el) {
  const [subjects, assignments, all] = await Promise.all([list(col('subjects')), list(col('assignments')), list(col('submissions'))]);
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  all.sort(byNewest);

  el.innerHTML = `<div class="card">
    <div class="row">
      <select id="fs" style="max-width:220px"><option value="">Všetky predmety</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <select id="fa" style="max-width:220px"><option value="">Všetky zadania</option></select>
      <select id="fst" style="max-width:200px"><option value="submitted">Neodoslané lektorovi</option><option value="forwarded">Odoslané lektorovi</option><option value="">Všetky stavy</option></select>
    </div>
    <div class="row" style="margin-top:.75rem">
      <span class="muted small" id="selinfo"></span><span class="spacer"></span>
      <button class="btn ghost" id="zip" disabled>${icon('download', 16)} Stiahnuť ZIP</button>
      <button class="btn ghost" id="mail" disabled>${icon('mail', 16)} E-mail lektorovi</button>
      <button class="btn" id="mark" disabled>${icon('check', 16)} Označiť ako odoslané</button>
    </div>
    <div class="progress hidden" id="prog"><div></div></div>
    <div class="table-wrap" id="list" style="margin-top:.75rem"></div>
  </div>
  <p class="muted small">Postup: vyfiltruj práce, označ ich, stiahni ZIP, pošli ho lektorovi (e-mailom alebo cez úschovňu) a označ ich ako odoslané. Študenti uvidia zmenu stavu.</p>`;

  const fs = el.querySelector('#fs'), fa = el.querySelector('#fa'), fst = el.querySelector('#fst');
  let shown = [];
  const selected = () => shown.filter(r => el.querySelector(`[data-pick="${r.id}"]`)?.checked);

  fs.onchange = () => {
    fa.innerHTML = '<option value="">Všetky zadania</option>' + assignments.filter(a => a.subject_id === fs.value).map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
    draw();
  };
  fa.onchange = fst.onchange = draw;

  function draw() {
    shown = all.filter(r => (!fs.value || r.subject_id === fs.value) && (!fa.value || r.assignment_id === fa.value) && (!fst.value || r.status === fst.value));
    const box = el.querySelector('#list');
    box.innerHTML = shown.length ? `<table><thead><tr><th><input type="checkbox" id="pickall" style="width:auto"></th><th>Študent</th><th>Práca</th><th>Predmet / zadanie</th><th>Odovzdané</th><th>Stav</th><th></th></tr></thead><tbody>
      ${shown.map(r => `<tr><td><input type="checkbox" data-pick="${r.id}" style="width:auto"></td>
        <td><strong>${esc(r.student_name)}</strong><div class="muted small">${esc(r.student_email)}</div></td>
        <td>${esc(r.title)}<div class="muted small">${esc(r.file_name)} · ${fmtSize(r.file_size)}</div>${r.note ? `<div class="small muted">Poznámka: ${esc(r.note)}</div>` : ''}</td>
        <td>${esc(r.subject_name || '—')}<div class="muted small">${esc(r.assignment_title)}</div></td>
        <td>${fmtDateTime(r.created_at)}${r.due_date && toDate(r.created_at).toLocaleDateString('sv-SE') > r.due_date ? '<br><span class="badge warn">po termíne</span>' : ''}</td>
        <td>${r.status === 'forwarded' ? `<span class="badge ok">odoslané ${fmtDate(r.forwarded_at)}</span>` : '<span class="badge pri">nové</span>'}</td>
        <td><button class="icon-btn" data-dl="${r.id}" title="Stiahnuť">${icon('download', 17)}</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Žiadne práce pre zvolený filter.</p>';
    box.querySelector('#pickall')?.addEventListener('change', e => {
      box.querySelectorAll('[data-pick]').forEach(c => (c.checked = e.target.checked));
      updateSel();
    });
    box.querySelectorAll('[data-pick]').forEach(c => (c.onchange = updateSel));
    box.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => guard(async () => {
      const r = shown.find(x => x.id === b.dataset.dl);
      downloadBlob(await downloadFile(r.file_path), r.file_name);
    }));
    updateSel();
  }

  function updateSel() {
    const s = selected();
    el.querySelector('#selinfo').textContent = s.length ? `Vybraných: ${s.length} (${fmtSize(s.reduce((a, r) => a + r.file_size, 0))})` : `${shown.length} prác`;
    ['zip', 'mail', 'mark'].forEach(id => (el.querySelector('#' + id).disabled = !s.length));
  }

  el.querySelector('#zip').onclick = () => guard(async () => {
    const s = selected();
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = new window.JSZip();
    const prog = el.querySelector('#prog');
    prog.classList.remove('hidden');
    try {
      for (const [i, r] of s.entries()) {
        zip.file(`${safeName(r.subject_name || 'bez_predmetu')}/${safeName(r.student_name)}_${safeName(r.file_name)}`, await downloadFile(r.file_path));
        prog.firstElementChild.style.width = `${((i + 1) / s.length) * 100}%`;
      }
      const rowsTxt = s.map(r => `${r.student_name}\t${r.title}\t${r.file_name}\t${fmtDateTime(r.created_at)}`).join('\r\n');
      zip.file('zoznam_prac.txt', `Študent\tNázov práce\tSúbor\tOdovzdané\r\n${rowsTxt}`);
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `studenthub_prace_${new Date().toISOString().slice(0, 10)}.zip`);
    } finally {
      prog.classList.add('hidden');
      prog.firstElementChild.style.width = '0';
    }
  });

  el.querySelector('#mail').onclick = () => {
    const s = selected();
    const subj = subjects.find(x => x.id === s[0].subject_id) || {};
    const body = `Dobrý deň${subj.lecturer_name ? ' ' + subj.lecturer_name : ''},\n\nv prílohe posielam odovzdané práce (${s.length}) z predmetu ${s[0].subject_name || ''}:\n\n` +
      s.map((r, i) => `${i + 1}. ${r.student_name} – ${r.title}`).join('\n') + '\n\nS pozdravom';
    location.href = `mailto:${encodeURIComponent(subj.lecturer_email || '')}?subject=${encodeURIComponent(`Odovzdané práce – ${s[0].subject_name || ''}`)}&body=${encodeURIComponent(body)}`;
  };

  el.querySelector('#mark').onclick = () => guard(async () => {
    const s = selected();
    if (!confirm(`Označiť ${s.length} prác ako odoslané lektorovi?`)) return;
    for (let i = 0; i < s.length; i += 400) {
      const batch = writeBatch(db);
      s.slice(i, i + 400).forEach(r => batch.update(doc(db, 'submissions', r.id), { status: 'forwarded', forwarded_at: serverTimestamp() }));
      await batch.commit();
    }
    const now = new Date();
    s.forEach(r => Object.assign(r, { status: 'forwarded', forwarded_at: now }));
    toast('Označené ako odoslané');
    draw();
  });

  draw();
}

// ---------------------------------------------------------------- Predmety a termíny
async function renderSubjects(el) {
  const [subjects, assignments] = await Promise.all([list(col('subjects')), list(col('assignments'))]);
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  assignments.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));

  el.innerHTML = `<div class="grid">
    <div class="card"><h2>${icon('book')} Predmety</h2>
      <form id="fsub"><input name="name" placeholder="Názov predmetu" required>
        <div class="row nowrap" style="margin-top:.5rem"><input name="lecturer_name" placeholder="Lektor / profesor"><input name="lecturer_email" type="email" placeholder="E-mail lektora"></div>
        <button class="btn sm" style="margin-top:.5rem">${icon('plus', 14)} Pridať predmet</button></form>
      <table style="margin-top:1rem">${subjects.map(s => `<tr><td><strong>${esc(s.name)}</strong><div class="muted small">${esc(s.lecturer_name)} ${esc(s.lecturer_email)}</div></td>
        <td style="text-align:right"><button class="icon-btn" data-dsub="${s.id}" title="Zmazať">${icon('trash', 16)}</button></td></tr>`).join('') || '<tr><td class="muted">Zatiaľ žiadne predmety.</td></tr>'}</table>
    </div>
    <div class="card"><h2>${icon('clock')} Zadania a termíny odovzdania</h2>
      <form id="fas"><select name="subject_id" required><option value="">— predmet —</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <div class="row nowrap" style="margin-top:.5rem"><input name="title" placeholder="Názov zadania" required><input name="due_date" type="date" style="max-width:170px"></div>
        <button class="btn sm" style="margin-top:.5rem">${icon('plus', 14)} Pridať zadanie</button></form>
      <table style="margin-top:1rem">${assignments.map(a => `<tr><td><strong>${esc(a.title)}</strong><div class="muted small">${esc(a.subject_name)}</div></td>
        <td>${fmtDate(a.due_date)}</td><td style="text-align:right"><button class="icon-btn" data-das="${a.id}" title="Zmazať">${icon('trash', 16)}</button></td></tr>`).join('') || '<tr><td class="muted">Zatiaľ žiadne zadania.</td></tr>'}</table>
    </div></div>
    <p class="muted small">Rozvrh hodín upravuješ priamo na stránke <a href="#/rozvrh">Rozvrh</a>.</p>`;

  el.querySelector('#fsub').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await addDoc(col('subjects'), { name: f.name.trim(), lecturer_name: f.lecturer_name.trim(), lecturer_email: f.lecturer_email.trim() });
    renderSubjects(el);
  });
  el.querySelector('#fas').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const subject = subjects.find(s => s.id === f.subject_id);
    await addDoc(col('assignments'), { subject_id: subject.id, subject_name: subject.name, title: f.title.trim(), due_date: f.due_date || '' });
    renderSubjects(el);
  });
  el.querySelectorAll('[data-dsub]').forEach(b => b.onclick = () => guard(async () => {
    if (!confirm('Zmazať predmet aj všetky jeho zadania? Odovzdané práce zostanú.')) return;
    const batch = writeBatch(db);
    (await list(query(col('assignments'), where('subject_id', '==', b.dataset.dsub)))).forEach(a => batch.delete(doc(db, 'assignments', a.id)));
    batch.delete(doc(db, 'subjects', b.dataset.dsub));
    await batch.commit();
    renderSubjects(el);
  }));
  el.querySelectorAll('[data-das]').forEach(b => b.onclick = () => guard(async () => {
    if (!confirm('Zmazať zadanie?')) return;
    await deleteDoc(doc(db, 'assignments', b.dataset.das));
    renderSubjects(el);
  }));
}

// ---------------------------------------------------------------- Nastavenia
async function renderSettings(el) {
  await loadSettings();
  const s = state.settings;
  const toggle = (key, label, hint) => `<label class="check"><input type="checkbox" name="${key}" ${s[key] !== false ? 'checked' : ''}> ${label}</label><p class="muted small" style="margin:0 0 .5rem 1.6rem">${hint}</p>`;
  el.innerHTML = `<form class="card" style="max-width:560px"><h2>${icon('sliders')} Funkcie portálu</h2>
    ${toggle('uploads_enabled', 'Odovzdávanie prác', 'Študenti môžu nahrávať nové práce.')}
    ${toggle('messaging_enabled', 'Správy', 'Súkromné a skupinové správy medzi študentmi.')}
    ${toggle('register_enabled', 'Register študentov', 'Zoznam kontaktov viditeľný pre všetkých študentov.')}
    <label>Maximálna veľkosť súboru (MB)</label><input name="max_file_mb" type="number" min="1" max="50" value="${Number(s.max_file_mb) || DEFAULT_SETTINGS.max_file_mb}" style="max-width:120px">
    <p class="muted small">Technický limit úložiska je 50 MB na súbor.</p>
    <button class="btn" style="margin-top:.5rem">${icon('check', 16)} Uložiť nastavenia</button></form>`;
  el.querySelector('form').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = new FormData(e.target);
    await setDoc(doc(db, 'settings', 'app'), {
      uploads_enabled: f.has('uploads_enabled'),
      messaging_enabled: f.has('messaging_enabled'),
      register_enabled: f.has('register_enabled'),
      max_file_mb: Math.min(50, Math.max(1, Number(f.get('max_file_mb')) || DEFAULT_SETTINGS.max_file_mb)),
    });
    toast('Nastavenia uložené – menu sa obnoví');
    setTimeout(() => location.reload(), 800);
  });
}
