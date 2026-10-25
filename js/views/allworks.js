import {
  app, db, state, col, doc, list, cached, writeBatch, updateDoc, serverTimestamp, modal, fmtDate, PROJECT_ID, toDate, byNewest, downloadFile, logActivity, esc, guard, toast, fmtDateTime, fmtSize, safeName, downloadBlob, loadScript, icon, avatar, isStudent, isAdmin,
} from '../lib.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';

const SHARE_URL = `https://europe-west1-${PROJECT_ID}.cloudfunctions.net/share`;
const shareUrl = token => `${SHARE_URL}?t=${token}`;

// Všetky práce: študenti × predmety, zelená fajka = študent z predmetu odovzdal prácu.
// Študenti vidia iba fajky (zo zbierky submitted), admini navyše práce otvoria a stiahnu jednotlivo aj hromadne.
export default async function renderAllWorks(el) {
  if (!isAdmin()) return renderStudentView(el);
  const [users, subjects, subs, marks, shares] = await Promise.all([cached('users'), cached('subjects'), list(col('submissions')), list(col('submitted')), list(col('shares')).catch(() => [])]);
  syncMarks(subs, marks);
  const students = users.filter(u => u.approved && isStudent(u)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  subs.sort(byNewest);
  // Posledná práca každého študenta v každom predmete
  const latest = new Map();
  const count = new Map();
  for (const r of subs) {
    const key = `${r.student_id}|${r.subject_id}`;
    if (!latest.has(key)) latest.set(key, r);
    count.set(key, (count.get(key) || 0) + 1);
  }
  const done = (s, subj) => latest.has(`${s.id}|${subj.id}`);

  el.innerHTML = `<div class="card">
      <div class="row" style="margin-bottom:.75rem">
        <input id="q" placeholder="Hľadať študenta…" style="max-width:260px">
        <label class="check" style="margin:0"><input type="checkbox" id="missing"> Iba s chýbajúcimi prácami</label>
        <span class="spacer"></span><span class="muted small">${students.length} študentov · ${subs.length} prác</span>
      </div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th class="sticky-col">Študent</th>${subjects.map(s => {
        const n = students.filter(st => done(st, s)).length;
        return `<th title="${esc(s.lecturer_name || '')}"><div class="mx-head">${esc(s.name)}</div>
          <div class="mx-sub"><span class="badge ${n === students.length && n ? 'ok' : n ? 'warn' : ''}">${n}/${students.length}</span>
          ${n ? `<button class="icon-btn" data-zip="${s.id}" title="Stiahnuť všetky práce z predmetu ako ZIP">${icon('download', 15)}</button>
            <button class="icon-btn" data-share="${s.id}" title="Vytvoriť odkaz pre lektora na stiahnutie všetkých prác">${icon('link', 15)}</button>` : ''}</div></th>`;
      }).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
      ${subjects.length ? '' : '<p class="muted">Zatiaľ nie sú zadané žiadne predmety.</p>'}
      <div class="progress hidden" id="prog"><div></div></div>
      <div id="shares"></div>
      <p class="muted small" style="margin:.75rem 0 0">${icon('check', 13)} = práca odovzdaná (kliknutím ju stiahneš), fajka v krúžku = už odoslaná lektorovi, písmeno = známka od lektora, oranžová = vrátená na prepracovanie, – = chýba. Hromadné preposlanie lektorovi a označenie ako odoslané nájdeš v Administrácia → Práce a preposielanie.</p>
    </div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function draw() {
    const q = norm(el.querySelector('#q').value);
    const onlyMissing = el.querySelector('#missing').checked;
    const shown = students.filter(s => norm(s.full_name).includes(q) && (!onlyMissing || subjects.some(subj => !done(s, subj))));
    el.querySelector('#rows').innerHTML = shown.map(s => `<tr>
      <td class="sticky-col"><div class="mx-student">${avatar(s, 26)}<span class="ellipsis">${esc(s.full_name)}</span></div></td>
      ${subjects.map(subj => {
        const r = latest.get(`${s.id}|${subj.id}`);
        if (!r) return '<td class="mx-cell"><span class="mx-miss">–</span></td>';
        const n = count.get(`${s.id}|${subj.id}`);
        const graded = r.review_status === 'reviewed' && r.grade;
        return `<td class="mx-cell"><button class="mx-ok ${r.status === 'forwarded' ? 'sent' : ''} ${graded ? 'graded' : ''} ${r.review_status === 'returned' ? 'returned' : ''}" data-dl="${r.id}"
          title="${esc(r.title)} · ${esc(r.file_name)} · ${fmtDateTime(r.created_at)}${r.status === 'forwarded' ? ' · odoslané lektorovi' : ''}${r.review_status ? ` · ${r.review_status === 'returned' ? 'vrátené na prepracovanie' : 'ohodnotené'}${r.grade ? ' ' + esc(r.grade) : ''}` : ''}${n > 1 ? ` · spolu ${n} práce` : ''}">${graded ? esc(r.grade.length > 2 ? r.grade[0].toUpperCase() : r.grade) : icon('check', 16)}</button></td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${subjects.length + 1}" class="muted">Nikto nevyhovuje filtru.</td></tr>`;
    el.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => guard(async () => {
      const r = subs.find(x => x.id === b.dataset.dl);
      downloadBlob(await downloadFile(r.file_path), r.file_name);
      logActivity('Stiahnutie práce', `${r.student_name} – ${r.file_name}`);
    }));
  }
  el.querySelector('#q').oninput = draw;
  el.querySelector('#missing').onchange = draw;
  draw();
  drawShares(el.querySelector('#shares'), shares, subjects);
  el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => shareDialog(subjects.find(s => s.id === b.dataset.share), () => renderAllWorks(el)));

  // ZIP všetkých prác z predmetu (posledná práca každého študenta + prípadné ďalšie)
  el.querySelectorAll('[data-zip]').forEach(b => b.onclick = () => guard(async () => {
    const subj = subjects.find(s => s.id === b.dataset.zip);
    const items = subs.filter(r => r.subject_id === subj.id);
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = new window.JSZip();
    const prog = el.querySelector('#prog');
    prog.classList.remove('hidden');
    try {
      for (const [i, r] of items.entries()) {
        zip.file(`${safeName(r.student_name)}_${safeName(r.file_name)}`, await downloadFile(r.file_path));
        prog.firstElementChild.style.width = `${((i + 1) / items.length) * 100}%`;
      }
      const missing = students.filter(s => !done(s, subj)).map(s => s.full_name);
      zip.file('zoznam.txt', `${subj.name}\r\nOdovzdané: ${items.length}\r\n\r\n` +
        items.map(r => `${r.student_name}\t${r.title}\t${r.file_name}\t${fmtDateTime(r.created_at)}`).join('\r\n') +
        (missing.length ? `\r\n\r\nNeodovzdali (${missing.length}):\r\n${missing.join('\r\n')}` : ''));
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(subj.name)}_prace_${new Date().toISOString().slice(0, 10)}.zip`);
      logActivity('Stiahnutie ZIP s prácami', `${subj.name} – ${items.length} prác (${fmtSize(items.reduce((a, r) => a + r.file_size, 0))})`);
      toast(`Stiahnutých ${items.length} prác z predmetu ${subj.name}`);
    } finally {
      prog.classList.add('hidden');
      prog.firstElementChild.style.width = '0';
    }
  }));
}

// Doplní chýbajúce značky pre práce odovzdané pred zavedením prehľadu pre študentov
function syncMarks(subs, marks) {
  const have = new Set(marks.map(m => m.id));
  const missing = [...new Map(subs.map(r => [`${r.student_id}_${r.subject_id}`, r])).entries()].filter(([id, r]) => r.subject_id && !have.has(id));
  for (let i = 0; i < missing.length; i += 400) {
    const batch = writeBatch(db);
    missing.slice(i, i + 400).forEach(([id, r]) => batch.set(doc(db, 'submitted', id), { student_id: r.student_id, subject_id: r.subject_id, at: r.created_at || serverTimestamp() }));
    batch.commit().catch(e => console.warn(e));
  }
}

// Pohľad študenta: iba kto už odovzdal, bez súborov a názvov prác
async function renderStudentView(el) {
  const [users, subjects, marks] = await Promise.all([cached('users'), cached('subjects'), list(col('submitted'))]);
  const students = users.filter(u => u.approved && isStudent(u)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  const done = new Set(marks.map(m => `${m.student_id}|${m.subject_id}`));
  const has = (s, subj) => done.has(`${s.id}|${subj.id}`);

  el.innerHTML = `<div class="card">
      <div class="row" style="margin-bottom:.75rem">
        <input id="q" placeholder="Hľadať študenta…" style="max-width:260px">
        <label class="check" style="margin:0"><input type="checkbox" id="missing"> Iba s chýbajúcimi prácami</label>
        <span class="spacer"></span><span class="muted small">${students.length} študentov</span>
      </div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th class="sticky-col">Študent</th>${subjects.map(s => {
        const n = students.filter(st => has(st, s)).length;
        return `<th title="${esc(s.lecturer_name || '')}"><div class="mx-head">${esc(s.name)}</div>
          <div class="mx-sub"><span class="badge ${n === students.length && n ? 'ok' : n ? 'warn' : ''}">${n}/${students.length}</span></div></th>`;
      }).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
      ${subjects.length ? '' : '<p class="muted">Zatiaľ nie sú zadané žiadne predmety.</p>'}
      <p class="muted small" style="margin:.75rem 0 0">${icon('check', 13)} = práca odovzdaná, – = zatiaľ chýba. Obsah prác vidia iba autori, administrátori a lektori.</p>
    </div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function draw() {
    const q = norm(el.querySelector('#q').value);
    const onlyMissing = el.querySelector('#missing').checked;
    const shown = students.filter(s => norm(s.full_name).includes(q) && (!onlyMissing || subjects.some(subj => !has(s, subj))));
    el.querySelector('#rows').innerHTML = shown.map(s => `<tr class="${s.id === state.user.uid ? 'me-row' : ''}">
      <td class="sticky-col"><div class="mx-student">${avatar(s, 26)}<span class="ellipsis">${esc(s.full_name)}</span></div></td>
      ${subjects.map(subj => `<td class="mx-cell">${has(s, subj) ? `<span class="mx-ok static">${icon('check', 16)}</span>` : '<span class="mx-miss">–</span>'}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${subjects.length + 1}" class="muted">Nikto nevyhovuje filtru.</td></tr>`;
  }
  el.querySelector('#q').oninput = draw;
  el.querySelector('#missing').onchange = draw;
  draw();
}

// ---------------------------------------------------------------- Odkazy pre lektorov
// ZIP so všetkými prácami z predmetu vytvorí Cloud Function; lektor ho stiahne cez odkaz bez prihlásenia
function shareMail(s, url) {
  const subject = `Odovzdané práce – ${s.subject_name}`;
  const body = `Dobrý deň${s.lecturer_name ? ' ' + s.lecturer_name : ''},\n\nvšetky odovzdané práce z predmetu ${s.subject_name} (${s.count}) si môžete stiahnuť naraz ako ZIP:\n\n${url}\n\nOdkaz platí do ${fmtDate(s.expires_at)}. V archíve je aj zoznam prác a študentov, ktorí neodovzdali.\n\nS pozdravom`;
  return `mailto:${encodeURIComponent(s.lecturer_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function shareDialog(subj, done) {
  const m = modal(`Odkaz pre lektora – ${subj.name}`, `<form>
    <p class="muted small" style="margin-top:0">Vytvoríme ZIP so všetkými prácami z predmetu a zoznamom, kto neodovzdal. Lektor si ho stiahne cez odkaz, bez prihlásenia.
      Práce odovzdané neskôr v ZIP nebudú – vtedy vytvor nový odkaz.</p>
    <label>Platnosť odkazu (dni)</label><input name="days" type="number" min="1" max="30" value="14" style="max-width:120px">
    <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn" id="go">${icon('link', 15)} Vytvoriť odkaz</button></div></form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = e => guard(async () => {
    e.preventDefault();
    const btn = form.querySelector('#go');
    btn.disabled = true;
    btn.textContent = 'Pripravujem ZIP… (môže to trvať minútu)';
    try {
      const { data } = await httpsCallable(getFunctions(app, 'europe-west1'), 'createShareLink', { timeout: 540000 })({ subjectId: subj.id, days: Number(form.elements.days.value) });
      const s = { subject_name: subj.name, lecturer_name: subj.lecturer_name, lecturer_email: subj.lecturer_email, count: data.count, expires_at: new Date(data.expires) };
      const url = shareUrl(data.token);
      logActivity('Odkaz pre lektora vytvorený', `${subj.name} – ${data.count} prác, ${fmtSize(data.size)}, platí do ${fmtDate(s.expires_at)}`);
      m.el.innerHTML = `<p style="margin-top:0">ZIP s <strong>${data.count}</strong> prácami (${fmtSize(data.size)}) je pripravený. Odkaz platí do <strong>${fmtDate(s.expires_at)}</strong>.</p>
        <input readonly value="${esc(url)}" id="url" onclick="this.select()">
        <div class="actions"><button class="btn ghost" id="copy">${icon('copy', 15)} Kopírovať</button>
          <a class="btn ghost" href="${esc(shareMail(s, url))}">${icon('mail', 15)} Poslať e-mailom</a><button class="btn" data-close>Hotovo</button></div>`;
      m.el.querySelector('#copy').onclick = () => navigator.clipboard.writeText(url).then(() => toast('Odkaz skopírovaný'));
      m.el.querySelector('[data-close]').addEventListener('click', done);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon('link', 15)} Vytvoriť odkaz`;
      throw err;
    }
  });
}

function drawShares(box, shares, subjects) {
  const now = Date.now();
  const active = shares.filter(s => !s.revoked && toDate(s.expires_at) > now).sort((a, b) => toDate(b.created_at) - toDate(a.created_at));
  if (!active.length) return void (box.innerHTML = '');
  box.innerHTML = `<h3 style="margin:1.25rem 0 .5rem">${icon('link', 16)} Aktívne odkazy pre lektorov</h3>
    <div class="table-wrap"><table><thead><tr><th>Predmet</th><th>Práce</th><th>Platí do</th><th>Stiahnutí</th><th></th></tr></thead><tbody>
    ${active.map(s => `<tr><td><strong>${esc(s.subject_name)}</strong><div class="muted small">vytvoril ${esc(s.created_by_name)} ${fmtDate(s.created_at)}</div></td>
      <td>${s.count} · ${fmtSize(s.size)}</td><td>${fmtDate(s.expires_at)}</td><td>${s.downloads || 0}</td>
      <td class="nowrap-cell"><button class="icon-btn" data-copy="${s.id}" title="Kopírovať odkaz">${icon('copy', 16)}</button>
        <a class="icon-btn" href="${esc(shareMail({ ...s, lecturer_email: subjects.find(x => x.id === s.subject_id)?.lecturer_email, expires_at: toDate(s.expires_at) }, shareUrl(s.id)))}" title="Poslať e-mailom">${icon('mail', 16)}</a>
        <button class="icon-btn" data-revoke="${s.id}" title="Zrušiť odkaz">${icon('x', 16)}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(shareUrl(b.dataset.copy)).then(() => toast('Odkaz skopírovaný')));
  box.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => guard(async () => {
    const s = shares.find(x => x.id === b.dataset.revoke);
    if (!confirm(`Zrušiť odkaz na práce z predmetu ${s.subject_name}? Lektor si ich už cez neho nestiahne.`)) return;
    await updateDoc(doc(db, 'shares', s.id), { revoked: true });
    s.revoked = true;
    logActivity('Odkaz pre lektora zrušený', s.subject_name);
    toast('Odkaz zrušený');
    drawShares(box, shares, subjects);
  }));
}
