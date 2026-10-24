import {
  app, db, state, col, doc, query, where, orderBy, limit, list, cached, bump, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
  increment, toDate, byNewest, createUserWithEmailAndPassword, signOut, getHelperAuth, downloadFile, removeFile, loadSettings,
  DEFAULT_SETTINGS, quotaUsage, QUOTA, WARN_AT, PROJECT_ID, logActivity,
  esc, guard, toast, modal, fmtDate, fmtDateTime, fmtSize, safeName, downloadBlob, loadScript, icon,
} from '../lib.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';

const TABS = [
  ['overview', 'activity', 'Prehľad', renderOverview],
  ['stats', 'clock', 'Štatistiky', renderStats],
  ['users', 'users', 'Používatelia', renderUsers],
  ['forward', 'archive', 'Práce a preposielanie', renderForward],
  ['subjects', 'book', 'Predmety a termíny', renderSubjects],
  ['settings', 'sliders', 'Nastavenia', renderSettings],
];

export default async function (root, [tab = 'overview']) {
  const current = TABS.find(t => t[0] === tab) || TABS[0];
  root.innerHTML = `<div class="title-row"><h1>${icon('shield', 24)} Administrácia</h1></div>
    <div class="tabs">${TABS.map(([k, ic, l]) => `<a href="#/admin/${k}" class="${k === current[0] ? 'active' : ''}">${icon(ic, 15)} ${l}</a>`).join('')}</div>
    <div id="tab"></div>`;
  await current[3](root.querySelector('#tab'));
}

// ---------------------------------------------------------------- Prehľad spotreby
const CONSOLE = `https://console.firebase.google.com/project/${PROJECT_ID}`;
const CLOUD = `https://console.cloud.google.com`;

function meter(q) {
  const pct = Math.min(1, q.pct);
  const cls = q.pct >= 0.95 ? 'crit' : q.pct >= WARN_AT ? 'warn' : '';
  const fmt = v => (q.limit > 1e6 ? fmtSize(v) : v.toLocaleString('sk-SK'));
  return `<div class="meter ${cls}"><div class="row"><span>${esc(q.label)}${q.exact ? '' : ' <span class="badge">odhad</span>'}</span>
    <span class="muted">${fmt(q.used)} z ${fmt(q.limit)} · <strong>${Math.round(q.pct * 100)} %</strong></span></div>
    <div class="bar"><div style="width:${(pct * 100).toFixed(1)}%"></div></div></div>`;
}

// Prepočíta odhad úložiska zo všetkých odovzdaných prác (číta každú prácu raz)
async function recalcStats() {
  const subs = await list(col('submissions'));
  const stats = { storage_bytes: subs.reduce((a, r) => a + (r.file_size || 0), 0), submissions_count: subs.length };
  await setDoc(doc(db, 'meta', 'stats'), stats);
  return stats;
}

async function renderOverview(el) {
  const [statsSnap, usageSnap] = await Promise.all([getDoc(doc(db, 'meta', 'stats')), getDoc(doc(db, 'meta', 'usage'))]);
  const stats = statsSnap.exists() ? statsSnap.data() : await recalcStats();
  const usage = usageSnap.data() || {};
  const quotas = quotaUsage(stats, usage);
  const students = [...state.people.values()].filter(p => p.role !== 'admin').length;

  el.innerHTML = `<div class="grid">
    <div class="card"><h2>${icon('activity')} Bezplatné limity Firebase</h2>
      ${quotas.map(meter).join('')}
      ${usageSnap.exists()
        ? `<p class="muted small">Presné čísla z Google Cloud, aktualizované ${fmtDateTime(usage.updated_at)}. Denné limity databázy sa nulujú o 9:00 nášho času (polnoc v Kalifornii).</p>
           <button class="btn ghost sm" id="refresh">${icon('refresh', 14)} Obnoviť teraz</button>`
        : `<p class="muted small">Zatiaľ sa zobrazuje iba odhad úložiska. Presné čísla (čítania a zápisy v databáze, sťahovanie) sa objavia po nasadení Cloud Function – návod je v README, časť 9.</p>`}
      <button class="btn ghost sm" id="recalc">${icon('refresh', 14)} Prepočítať odhad úložiska</button>
    </div>
    <div class="card"><h2>${icon('file')} Obsah portálu</h2>
      <div class="meter"><div class="row"><span>Študenti</span><strong>${students}</strong></div></div>
      <div class="meter"><div class="row"><span>Odovzdané práce</span><strong>${stats.submissions_count ?? 0}</strong></div></div>
      <div class="meter"><div class="row"><span>Konverzácie, v ktorých si členom</span><strong>${state.convs.length}</strong></div></div>
      <p class="muted small">Keď sa úložisko blíži k limitu, v časti Práce a preposielanie si práce stiahni ako ZIP a potom ich zmaž tlačidlom Zmazať vybrané.</p>
    </div>
    <div class="card"><h2>${icon('external')} Podrobnosti vo Firebase a Google Cloud</h2>
      <div class="links">
        <a href="${CONSOLE}/firestore/databases/-default-/usage" target="_blank" rel="noopener">${icon('external', 14)} Spotreba databázy (Firestore Usage)</a>
        <a href="${CONSOLE}/storage" target="_blank" rel="noopener">${icon('external', 14)} Úložisko súborov (Storage)</a>
        <a href="${CONSOLE}/usage" target="_blank" rel="noopener">${icon('external', 14)} Prehľad spotreby a fakturácie projektu</a>
        <a href="${CLOUD}/billing?project=${PROJECT_ID}" target="_blank" rel="noopener">${icon('external', 14)} Fakturácia a rozpočty (Google Cloud)</a>
      </div>
      <p class="muted small">Upozornenie e-mailom pri prekročení rozpočtu nastavíš v Google Cloud → Billing → Budgets &amp; alerts.</p>
    </div>
  </div>`;

  el.querySelector('#recalc').onclick = e => guard(async () => {
    e.currentTarget.disabled = true;
    await recalcStats();
    toast('Odhad úložiska prepočítaný');
    renderOverview(el);
  });
  el.querySelector('#refresh')?.addEventListener('click', e => guard(async () => {
    e.currentTarget.disabled = true;
    await httpsCallable(getFunctions(app, 'europe-west1'), 'refreshUsage')();
    toast('Spotreba aktualizovaná');
    renderOverview(el);
  }));
}

// ---------------------------------------------------------------- Štatistiky
async function renderStats(el) {
  const [users, subjects, assignments, subs, pendingMat, market] = await Promise.all([
    cached('users'), cached('subjects'), cached('assignments'), list(col('submissions')),
    list(query(col('materials'), where('status', '==', 'pending'))), list(query(col('market'), where('status', '==', 'active'))),
  ]);
  const students = users.filter(u => u.approved && u.role !== 'admin').sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  const todayIso = new Date().toLocaleDateString('sv-SE');
  const dayOf = r => toDate(r.created_at)?.toLocaleDateString('sv-SE') || '';
  const late = subs.filter(r => r.due_date && dayOf(r) > r.due_date);
  const withSub = new Set(subs.map(r => r.student_id));
  assignments.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));

  // Pre každé zadanie: kto odovzdal, kto nie, kto po termíne
  const perAssignment = assignments.map(a => {
    const got = subs.filter(r => r.assignment_id === a.id);
    const ids = new Set(got.map(r => r.student_id));
    return {
      a, count: ids.size, late: got.filter(r => a.due_date && dayOf(r) > a.due_date).length,
      missing: students.filter(s => !ids.has(s.id)), overdue: a.due_date && a.due_date < todayIso,
    };
  });
  const tile = (label, value, sub = '') => `<div class="card"><div class="muted small">${label}</div><div class="stat">${value}</div><div class="muted small">${sub}</div></div>`;

  el.innerHTML = `<div class="stat-grid">
      ${tile('Študenti', students.length, `${students.length - withSub.size} bez jedinej práce`)}
      ${tile('Odovzdané práce', subs.length, `odoslané lektorovi: ${subs.filter(r => r.status === 'forwarded').length}`)}
      ${tile('Po termíne', late.length, subs.length ? `${Math.round(late.length / subs.length * 100)} % prác` : '')}
      ${tile('Materiály na schválenie', pendingMat.length, '<a href="#/materialy/schvalovanie">schváliť</a>')}
      ${tile('Inzeráty v burze', market.length, 'aktívne')}
    </div>
    <div class="card"><div class="row"><h2 style="margin:0">${icon('clock')} Odovzdávanie podľa zadaní</h2><span class="spacer"></span>
      <button class="btn ghost sm" id="csv">${icon('download', 14)} Export chýbajúcich (CSV)</button></div>
      ${perAssignment.length ? perAssignment.map((p, i) => {
        const pct = students.length ? p.count / students.length : 0;
        return `<details class="assign"><summary>
          <strong>${esc(p.a.title)}</strong><span class="muted small">${esc(p.a.subject_name)} · termín ${fmtDate(p.a.due_date)}</span><span class="spacer"></span>
          <span class="badge ${pct >= 0.9 ? 'ok' : p.overdue ? 'err' : 'warn'}">${p.count} / ${students.length}</span>
          ${p.late ? `<span class="badge warn">${p.late} po termíne</span>` : ''}</summary>
          ${p.missing.length ? `<div class="muted small" style="margin-top:.5rem">Neodovzdali (${p.missing.length}):</div>
            <div class="missing">${p.missing.map(s => `<span>${esc(s.full_name)}</span>`).join('')}</div>
            <button class="btn ghost sm" data-remind="${i}" style="margin-top:.6rem">${icon('mail', 14)} Pripomenúť e-mailom</button>`
          : '<p class="muted small">Všetci odovzdali.</p>'}
        </details>`;
      }).join('') : '<p class="muted">Zatiaľ nie sú zadané žiadne zadania. Pridáš ich v časti Predmety a termíny.</p>'}
    </div>
    <div class="card"><h2>${icon('book')} Práce podľa predmetov</h2>
      <table>${subjects.map(s => {
        const n = subs.filter(r => r.subject_id === s.id).length;
        return `<tr><td>${esc(s.name)}</td><td style="text-align:right"><strong>${n}</strong></td></tr>`;
      }).join('') || '<tr><td class="muted">Žiadne predmety.</td></tr>'}</table>
    </div>
    <div class="card"><div class="row"><h2 style="margin:0">${icon('activity')} Aktivita študentov za 7 dní</h2><span class="spacer"></span>
      <button class="btn ghost sm" id="activity">${icon('refresh', 14)} Načítať z logu</button></div>
      <div id="act" class="muted small" style="margin-top:.5rem">Aktivitu načítame z Logu až na požiadanie, aby sme šetrili čítania z databázy.</div>
    </div>`;

  el.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => {
    const p = perAssignment[Number(b.dataset.remind)];
    const body = `Dobrý deň,\n\nprosím o odovzdanie práce „${p.a.title}“ (${p.a.subject_name}) cez StudentHUB${p.a.due_date ? ` do ${fmtDate(p.a.due_date)}` : ''}.\n\n${location.origin + location.pathname}\n\nĎakujem`;
    location.href = `mailto:?bcc=${encodeURIComponent(p.missing.map(s => s.email).join(','))}&subject=${encodeURIComponent(`Pripomienka: ${p.a.title}`)}&body=${encodeURIComponent(body)}`;
    logActivity('Pripomienka neodovzdanej práce', `${p.a.title} – ${p.missing.length} študentov`);
  });

  el.querySelector('#csv').onclick = () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = perAssignment.flatMap(p => p.missing.map(s => [p.a.subject_name, p.a.title, p.a.due_date, s.full_name, s.email].map(cell).join(';')));
    downloadBlob(new Blob(['﻿' + ['Predmet;Zadanie;Termín;Študent;E-mail', ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'studenthub-neodovzdane.csv');
  };

  el.querySelector('#activity').onclick = e => guard(async () => {
    e.currentTarget.disabled = true;
    const since = new Date(Date.now() - 7 * 864e5);
    const logs = await list(query(col('logs'), where('at', '>=', since), orderBy('at', 'desc'), limit(3000)));
    const last = new Map();
    const count = new Map();
    logs.forEach(l => {
      if (!last.has(l.uid)) last.set(l.uid, l.at);
      count.set(l.uid, (count.get(l.uid) || 0) + 1);
    });
    const active = students.filter(s => last.has(s.id)).sort((a, b) => count.get(b.id) - count.get(a.id));
    const inactive = students.filter(s => !last.has(s.id));
    el.querySelector('#act').classList.remove('muted', 'small');
    el.querySelector('#act').innerHTML = `<div class="stat-grid">
        ${tile('Aktívni za 7 dní', active.length, students.length ? `${Math.round(active.length / students.length * 100)} % študentov` : '')}
        ${tile('Neprihlásili sa', inactive.length, '')}
        ${tile('Záznamov v logu', logs.length, logs.length >= 3000 ? 'zobrazených prvých 3 000' : '')}
      </div>
      <table><thead><tr><th>Najaktívnejší</th><th>Akcií</th><th>Naposledy</th></tr></thead><tbody>
      ${active.slice(0, 10).map(s => `<tr><td>${esc(s.full_name)}</td><td>${count.get(s.id)}</td><td>${fmtDateTime(last.get(s.id))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nikto</td></tr>'}
      </tbody></table>
      ${inactive.length ? `<div class="muted small" style="margin-top:.75rem">Neprihlásili sa ani raz za 7 dní (${inactive.length}):</div>
        <div class="missing">${inactive.map(s => `<span>${esc(s.full_name)}</span>`).join('')}</div>` : ''}`;
  });
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
      <td>${u.role === 'admin' ? '<span class="badge pri">admin</span>' : 'študent'}${u.demo ? ' <span class="badge">ukážka</span>' : ''}</td>
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
    const who = users.find(x => x.id === b.dataset.approve);
    logActivity(b.dataset.v === 'true' ? 'Schválenie používateľa' : 'Deaktivácia používateľa', `${who?.full_name} (${who?.email})`);
    await bump('users');
    renderUsers(el);
  }));
  el.querySelectorAll('[data-role]').forEach(b => b.onclick = () => guard(async () => {
    if (b.dataset.v === 'admin' && !confirm('Tento používateľ získa plný prístup k administrácii. Pokračovať?')) return;
    await updateDoc(doc(db, 'users', b.dataset.role), { role: b.dataset.v });
    const who = users.find(x => x.id === b.dataset.role);
    logActivity(b.dataset.v === 'admin' ? 'Pridelenie roly admin' : 'Odobratie roly admin', `${who?.full_name} (${who?.email})`);
    await bump('users');
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
    logActivity('Pridanie študenta', `${f.full_name.trim()} (${cred.user.email})`);
    await bump('users');
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
  const [subjects, assignments] = await Promise.all([cached('subjects'), cached('assignments')]);
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  // Práce sa načítavajú podľa stavu – bežne len tie, ktoré ešte neboli odoslané
  const byStatus = {};
  const load = async status => (byStatus[status] ??= (await list(status ? query(col('submissions'), where('status', '==', status)) : col('submissions'))).sort(byNewest));
  let all = await load('submitted');

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
      <button class="btn danger" id="del" disabled>${icon('trash', 16)} Zmazať vybrané</button>
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
  fa.onchange = draw;
  fst.onchange = () => guard(async () => {
    all = await load(fst.value);
    draw();
  });

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
      logActivity('Stiahnutie práce', `${r.student_name} – ${r.file_name}`);
    }));
    updateSel();
  }

  function updateSel() {
    const s = selected();
    el.querySelector('#selinfo').textContent = s.length ? `Vybraných: ${s.length} (${fmtSize(s.reduce((a, r) => a + r.file_size, 0))})` : `${shown.length} prác`;
    ['zip', 'mail', 'mark', 'del'].forEach(id => (el.querySelector('#' + id).disabled = !s.length));
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
      logActivity('Stiahnutie ZIP s prácami', `${s.length} prác`);
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
    delete byStatus.forwarded;
    delete byStatus[''];
    logActivity('Práce označené ako odoslané lektorovi', `${s.length} prác`);
    toast('Označené ako odoslané');
    draw();
  });

  // Uvoľnenie úložiska: zmaže súbory aj záznamy (najprv si ich stiahni cez ZIP)
  el.querySelector('#del').onclick = () => guard(async () => {
    const s = selected();
    const bytes = s.reduce((a, r) => a + r.file_size, 0);
    if (!confirm(`Natrvalo zmazať ${s.length} prác (${fmtSize(bytes)})?\n\nSúbory sa odstránia z úložiska a študenti ich už neuvidia. Ak si ich chceš ponechať, najprv ich stiahni ako ZIP.`)) return;
    const prog = el.querySelector('#prog');
    prog.classList.remove('hidden');
    try {
      for (const [i, r] of s.entries()) {
        await removeFile(r.file_path).catch(e => { if (e.code !== 'storage/object-not-found') throw e; });
        await deleteDoc(doc(db, 'submissions', r.id));
        prog.firstElementChild.style.width = `${((i + 1) / s.length) * 100}%`;
      }
    } finally {
      prog.classList.add('hidden');
      prog.firstElementChild.style.width = '0';
    }
    await updateDoc(doc(db, 'meta', 'stats'), { storage_bytes: increment(-bytes), submissions_count: increment(-s.length) }).catch(() => {});
    const ids = new Set(s.map(r => r.id));
    Object.keys(byStatus).forEach(k => (byStatus[k] = byStatus[k].filter(r => !ids.has(r.id))));
    all = all.filter(r => !ids.has(r.id));
    logActivity('Hromadné zmazanie prác', `${s.length} prác, ${fmtSize(bytes)}`);
    toast(`Zmazaných ${s.length} prác, uvoľnených ${fmtSize(bytes)}`);
    draw();
  });

  draw();
}

// ---------------------------------------------------------------- Predmety a termíny
async function renderSubjects(el) {
  const [subjects, assignments] = await Promise.all([cached('subjects'), cached('assignments')]);
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
    logActivity('Nový predmet', f.name.trim());
    await bump('subjects');
    renderSubjects(el);
  });
  el.querySelector('#fas').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const subject = subjects.find(s => s.id === f.subject_id);
    await addDoc(col('assignments'), { subject_id: subject.id, subject_name: subject.name, title: f.title.trim(), due_date: f.due_date || '' });
    logActivity('Nové zadanie', `${f.title.trim()} – ${subject.name}${f.due_date ? `, termín ${f.due_date}` : ''}`);
    await bump('assignments');
    renderSubjects(el);
  });
  el.querySelectorAll('[data-dsub]').forEach(b => b.onclick = () => guard(async () => {
    if (!confirm('Zmazať predmet aj všetky jeho zadania? Odovzdané práce zostanú.')) return;
    const batch = writeBatch(db);
    assignments.filter(a => a.subject_id === b.dataset.dsub).forEach(a => batch.delete(doc(db, 'assignments', a.id)));
    batch.delete(doc(db, 'subjects', b.dataset.dsub));
    logActivity('Predmet zmazaný', subjects.find(x => x.id === b.dataset.dsub)?.name || '');
    await batch.commit();
    await Promise.all([bump('subjects'), bump('assignments')]);
    renderSubjects(el);
  }));
  el.querySelectorAll('[data-das]').forEach(b => b.onclick = () => guard(async () => {
    if (!confirm('Zmazať zadanie?')) return;
    await deleteDoc(doc(db, 'assignments', b.dataset.das));
    logActivity('Zadanie zmazané', assignments.find(x => x.id === b.dataset.das)?.title || '');
    await bump('assignments');
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
    <button class="btn" style="margin-top:.5rem">${icon('check', 16)} Uložiť nastavenia</button></form>
    <div class="card" style="max-width:560px"><h2>${icon('users')} Ukážkové dáta</h2>
      <p class="muted small">Naplní portál vymyslenými údajmi, aby si videl, ako bude vyzerať. Ukážkoví študenti nemajú prihlasovacie účty. Všetky ukážkové dáta jedným klikom zase zmažeš.</p>
      <div class="row"><button class="btn ghost" id="demo-add">${icon('userPlus', 16)} Pridať 50 ukážkových študentov</button>
        <button class="btn ghost" id="demo-notes">${icon('pin', 16)} Pridať 6 ukážkových oznamov</button>
        <button class="btn ghost" id="demo-mat">${icon('book', 16)} Pridať 5 materiálov a 5 inzerátov</button>
        <button class="btn ghost" id="demo-del">${icon('trash', 16)} Zmazať ukážkové dáta</button></div></div>`;
  const run = (btn, fn) => guard(async () => {
    btn.disabled = true;
    try { await fn(await import('./demo.js')); } finally { btn.disabled = false; }
  });
  el.querySelector('#demo-add').onclick = e => run(e.currentTarget, async m => {
    await m.createDemoStudents(50);
    logActivity('Ukážkové dáta', 'pridaných 50 študentov');
    toast('Pridaných 50 ukážkových študentov – nájdeš ich v Registri');
  });
  el.querySelector('#demo-mat').onclick = e => run(e.currentTarget, async m => {
    await m.createDemoMaterials();
    logActivity('Ukážkové dáta', 'pridaných 5 materiálov a 5 inzerátov');
    toast('Pridaných 5 materiálov a 5 inzerátov – pozri Materiály');
  });
  el.querySelector('#demo-notes').onclick = e => run(e.currentTarget, async m => {
    await m.createDemoAnnouncements(state.user.uid);
    logActivity('Ukážkové dáta', 'pridaných 6 oznamov');
    toast('Pridaných 6 ukážkových oznamov – pozri Domov');
  });
  el.querySelector('#demo-del').onclick = e => {
    if (!confirm('Zmazať všetky ukážkové dáta (študentov, oznamy, materiály a inzeráty)?')) return;
    run(e.currentTarget, async m => {
      const { users, notes, materials, market } = await m.deleteDemoData();
      logActivity('Ukážkové dáta', `zmazaných ${users} študentov, ${notes} oznamov, ${materials} materiálov, ${market} inzerátov`);
      toast(`Zmazané ukážkové dáta: ${users} študentov, ${notes} oznamov, ${materials} materiálov, ${market} inzerátov`);
    });
  };
  el.querySelector('form').onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = new FormData(e.target);
    await setDoc(doc(db, 'settings', 'app'), {
      uploads_enabled: f.has('uploads_enabled'),
      messaging_enabled: f.has('messaging_enabled'),
      register_enabled: f.has('register_enabled'),
      max_file_mb: Math.min(50, Math.max(1, Number(f.get('max_file_mb')) || DEFAULT_SETTINGS.max_file_mb)),
    });
    await bump('settings');
    await logActivity('Nastavenia portálu', `práce ${f.has('uploads_enabled') ? 'zap.' : 'vyp.'}, správy ${f.has('messaging_enabled') ? 'zap.' : 'vyp.'}, register ${f.has('register_enabled') ? 'zap.' : 'vyp.'}, limit ${f.get('max_file_mb')} MB`);
    toast('Nastavenia uložené – menu sa obnoví');
    setTimeout(() => location.reload(), 800);
  });
}
