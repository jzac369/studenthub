import {
  db, state, col, doc, query, where, list, cached, updateDoc, writeBatch, serverTimestamp, toDate, byNewest,
  uploadFile, downloadFile, removeFile, adjustStats, logActivity, isAdmin, isStudent, esc, guard, toast, modal,
  fmtDate, fmtDateTime, fmtSize, safeName, downloadBlob, loadScript, icon, avatar,
} from '../lib.js';

export const GRADES = ['A', 'B', 'C', 'D', 'E', 'FX', 'započítané', 'nezapočítané'];
const PREVIEW = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain;charset=utf-8' };
const ext = name => String(name || '').split('.').pop().toLowerCase();
export const canPreview = name => !!PREVIEW[ext(name)];

// Náhľad v novej karte prehliadača (PDF, obrázky, text) – okno sa otvorí hneď, aby ho prehliadač nezablokoval
export async function previewFile(path, name) {
  const w = window.open('', '_blank');
  w?.document.write('<p style="font-family:sans-serif;padding:1rem">Načítavam…</p>');
  try {
    const blob = await downloadFile(path);
    const url = URL.createObjectURL(new Blob([blob], { type: PREVIEW[ext(name)] }));
    if (w) w.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

// Stav hodnotenia ako odznak – používa ho lektor, admin aj študent
export function reviewBadge(r) {
  if (!r.review_status) return '';
  const returned = r.review_status === 'returned';
  return `<span class="badge ${returned ? 'warn' : 'ok'}">${returned ? 'vrátené na prepracovanie' : 'ohodnotené'}${r.grade ? `: ${esc(r.grade)}` : ''}</span>`;
}

// Predmety, ktoré prihlásený používateľ hodnotí (admin všetky)
export async function mySubjects() {
  const subjects = await cached('subjects');
  const mine = isAdmin() ? subjects : subjects.filter(s => (state.profile.subjects || []).includes(s.id));
  return mine.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
}

// Lektor smie čítať iba práce svojich predmetov, preto sa pýtame po predmetoch
export const loadSubjectSubs = id => list(query(col('submissions'), where('subject_id', '==', id)));

export default async function (root, [sid] = []) {
  root.innerHTML = `<div class="title-row"><h1>${icon('award', 24)} Hodnotenie prác</h1></div><div id="grading">Načítavam…</div>`;
  await renderGrading(root.querySelector('#grading'), sid, '#/hodnotenie');
}

export async function renderGrading(el, sid, base) {
  const subjects = await mySubjects();
  if (!subjects.length) {
    el.innerHTML = '<div class="card"><p class="muted" style="margin:0">Administrátor ti zatiaľ nepriradil žiadny predmet. Keď ho priradí, uvidíš tu odovzdané práce študentov.</p></div>';
    return;
  }
  const subj = subjects.find(s => s.id === sid) || subjects[0];
  const [users, subs] = await Promise.all([cached('users'), loadSubjectSubs(subj.id)]);
  const students = users.filter(u => u.approved && isStudent(u)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  subs.sort(byNewest);
  const latest = new Map();
  const versions = new Map();
  for (const r of subs) {
    if (!latest.has(r.student_id)) latest.set(r.student_id, r);
    versions.set(r.student_id, (versions.get(r.student_id) || 0) + 1);
  }
  const lecturer = !isAdmin();
  const isNew = r => !r.lecturer_seen_at;
  const late = r => r.due_date && toDate(r.created_at)?.toLocaleDateString('sv-SE') > r.due_date;
  const works = students.map(s => latest.get(s.id)).filter(Boolean);
  const count = f => works.filter(f).length;

  el.innerHTML = `${subjects.length > 1 ? `<div class="tabs">${subjects.map(s => `<a href="${base}/${s.id}" class="${s.id === subj.id ? 'active' : ''}">${esc(s.name)}</a>`).join('')}</div>` : ''}
    <div class="stat-grid">
      <div class="card"><div class="muted small">Odovzdali</div><div class="stat">${works.length} / ${students.length}</div><div class="muted small">${esc(subj.name)}</div></div>
      <div class="card"><div class="muted small">Nové (ešte nestiahnuté)</div><div class="stat">${count(isNew)}</div><div class="muted small">od posledného stiahnutia</div></div>
      <div class="card"><div class="muted small">Ohodnotené</div><div class="stat">${count(r => r.review_status === 'reviewed')}</div><div class="muted small">vrátené: ${count(r => r.review_status === 'returned')}</div></div>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:.75rem">
        <input id="q" placeholder="Hľadať študenta…" style="max-width:240px">
        <select id="f" style="max-width:220px">
          <option value="">Všetci študenti</option><option value="new">Nové práce</option><option value="todo">Neohodnotené</option>
          <option value="reviewed">Ohodnotené</option><option value="returned">Vrátené na prepracovanie</option><option value="missing">Neodovzdali</option>
        </select>
        <span class="spacer"></span>
        <button class="btn ghost sm" id="csv">${icon('download', 14)} Hodnotenia (CSV)</button>
        <button class="btn ghost sm" id="zip-new" ${count(isNew) ? '' : 'disabled'}>${icon('download', 14)} Nové (ZIP)</button>
        <button class="btn sm" id="zip-all" ${subs.length ? '' : 'disabled'}>${icon('download', 14)} Všetky (ZIP)</button>
      </div>
      <div class="progress hidden" id="prog"><div></div></div>
      <div class="table-wrap" id="list"></div>
      <p class="muted small" style="margin:.75rem 0 0">${icon('eye', 13)} náhľad funguje pre PDF a obrázky, ostatné súbory (Word, PowerPoint…) si stiahni.
        ${lecturer ? 'Práce, ktoré si stiahneš, sa prestanú zobrazovať ako nové.' : ''} Študent uvidí hodnotenie a spätnú väzbu v časti Moje práce.</p>
    </div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = (s, f) => {
    const r = latest.get(s.id);
    if (f === 'missing') return !r;
    if (!f) return true;
    if (!r) return false;
    return f === 'new' ? isNew(r) : f === 'todo' ? !r.review_status : r.review_status === f;
  };

  function draw() {
    const q = norm(el.querySelector('#q').value);
    const f = el.querySelector('#f').value;
    const shown = students.filter(s => norm(s.full_name).includes(q) && match(s, f));
    el.querySelector('#list').innerHTML = shown.length ? `<table><thead><tr><th>Študent</th><th>Práca</th><th>Odovzdané</th><th>Hodnotenie</th><th></th></tr></thead><tbody>
      ${shown.map(s => {
        const r = latest.get(s.id);
        const who = `<td><div class="mx-student">${avatar(s, 28)}<strong class="ellipsis">${esc(s.full_name)}</strong></div></td>`;
        if (!r) return `<tr class="missing-row">${who}<td colspan="4" class="muted">neodovzdal(a)</td></tr>`;
        const n = versions.get(s.id);
        return `<tr>${who}
          <td>${esc(r.title)}${isNew(r) && lecturer ? ' <span class="badge pri">nové</span>' : ''}
            <div class="muted small">${esc(r.file_name)} · ${fmtSize(r.file_size)}${n > 1 ? ` · ${n} verzie (zobrazená posledná)` : ''}</div>
            ${r.note ? `<div class="small muted">Poznámka: ${esc(r.note)}</div>` : ''}</td>
          <td>${fmtDateTime(r.created_at)}${late(r) ? '<br><span class="badge warn">po termíne</span>' : ''}</td>
          <td>${reviewBadge(r) || '<span class="muted small">—</span>'}${r.feedback ? `<div class="muted small clamp">${esc(r.feedback)}</div>` : ''}</td>
          <td class="nowrap-cell">
            ${canPreview(r.file_name) ? `<button class="icon-btn" data-view="${r.id}" title="Náhľad">${icon('eye', 17)}</button>` : ''}
            <button class="icon-btn" data-dl="${r.id}" title="Stiahnuť">${icon('download', 17)}</button>
            <button class="btn sm ${r.review_status ? 'ghost' : ''}" data-grade="${r.id}">${icon('award', 14)} ${r.review_status ? 'Upraviť' : 'Hodnotiť'}</button></td></tr>`;
      }).join('')}</tbody></table>` : '<p class="muted">Nikto nevyhovuje filtru.</p>';

    const find = id => subs.find(x => x.id === id);
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => guard(async () => {
      const r = find(b.dataset.view);
      await previewFile(r.file_path, r.file_name);
      await markSeen([r]);
      logActivity('Náhľad práce', `${r.student_name} – ${r.file_name}`);
    }));
    el.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => guard(async () => {
      const r = find(b.dataset.dl);
      downloadBlob(await downloadFile(r.file_path), r.file_name);
      await markSeen([r]);
      logActivity('Stiahnutie práce', `${r.student_name} – ${r.file_name}`);
    }));
    el.querySelectorAll('[data-grade]').forEach(b => b.onclick = () => gradeDialog(find(b.dataset.grade), subj, () => renderGrading(el, subj.id, base)));
  }

  // Lektorovi sa stiahnuté práce prestanú ukazovať ako nové (admin tento príznak nemení)
  async function markSeen(items) {
    const fresh = items.filter(isNew);
    if (!lecturer || !fresh.length) return;
    for (let i = 0; i < fresh.length; i += 400) {
      const batch = writeBatch(db);
      fresh.slice(i, i + 400).forEach(r => batch.update(doc(db, 'submissions', r.id), { lecturer_seen_at: serverTimestamp() }));
      await batch.commit();
    }
    const now = new Date();
    fresh.forEach(r => (r.lecturer_seen_at = now));
  }

  async function zipDownload(items, label) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = new window.JSZip();
    const prog = el.querySelector('#prog');
    prog.classList.remove('hidden');
    try {
      for (const [i, r] of items.entries()) {
        const older = latest.get(r.student_id) !== r ? `_verzia_${fmtDate(r.created_at).replace(/\D+/g, '-')}` : '';
        zip.file(`${safeName(r.student_name)}${older}_${safeName(r.file_name)}`, await downloadFile(r.file_path));
        prog.firstElementChild.style.width = `${((i + 1) / items.length) * 100}%`;
      }
      const missing = students.filter(s => !latest.has(s.id)).map(s => s.full_name);
      zip.file('zoznam.txt', `${subj.name}\r\nStiahnuté ${fmtDateTime(new Date())}, prác: ${items.length}\r\n\r\n` +
        items.map(r => `${r.student_name}\t${r.title}\t${r.file_name}\t${fmtDateTime(r.created_at)}${late(r) ? '\tpo termíne' : ''}`).join('\r\n') +
        (missing.length ? `\r\n\r\nNeodovzdali (${missing.length}):\r\n${missing.join('\r\n')}` : ''));
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(subj.name)}_${label}_${new Date().toISOString().slice(0, 10)}.zip`);
      await markSeen(items);
      logActivity('Stiahnutie ZIP s prácami', `${subj.name} – ${items.length} prác (${label})`);
      toast(`Stiahnutých ${items.length} prác`);
    } finally {
      prog.classList.add('hidden');
      prog.firstElementChild.style.width = '0';
    }
  }

  el.querySelector('#zip-all').onclick = () => guard(() => zipDownload(subs, 'vsetky').then(() => renderGrading(el, subj.id, base)));
  el.querySelector('#zip-new').onclick = () => guard(() => zipDownload(subs.filter(isNew), 'nove').then(() => renderGrading(el, subj.id, base)));
  el.querySelector('#csv').onclick = () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = students.map(s => {
      const r = latest.get(s.id);
      return [s.full_name, s.email, r?.title, r ? fmtDateTime(r.created_at) : 'neodovzdal(a)', r?.grade,
        r?.review_status === 'returned' ? 'vrátené' : r?.review_status ? 'ohodnotené' : '', r?.feedback].map(cell).join(';');
    });
    downloadBlob(new Blob(['﻿' + ['Študent;E-mail;Práca;Odovzdané;Známka;Stav;Spätná väzba', ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `${safeName(subj.name)}_hodnotenie.csv`);
  };
  el.querySelector('#q').oninput = draw;
  el.querySelector('#f').onchange = draw;
  draw();
}

function gradeDialog(r, subj, done) {
  const m = modal('Hodnotenie práce', `<form>
    <p style="margin-top:0"><strong>${esc(r.student_name)}</strong><br><span class="muted small">${esc(r.title)} · ${esc(r.file_name)}</span></p>
    <div class="row nowrap">
      <div class="grow"><label>Známka</label><select name="grade"><option value="">— bez známky —</option>
        ${GRADES.map(g => `<option ${r.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="grow"><label>Výsledok</label><select name="review_status">
        <option value="reviewed">Ohodnotené</option>
        <option value="returned" ${r.review_status === 'returned' ? 'selected' : ''}>Vrátiť na prepracovanie</option></select></div>
    </div>
    <label>Spätná väzba pre študenta</label><textarea name="feedback" rows="6" maxlength="4000" placeholder="Čo je dobré, čo treba zlepšiť…">${esc(r.feedback || '')}</textarea>
    <label>Súbor s poznámkami / opravená verzia (nepovinné)</label>
    <label class="file-pick"><input name="file" type="file">
      <span class="btn ghost">${icon('file', 16)} Vybrať súbor</span><span class="file-name muted">${r.review_file_name ? `${esc(r.review_file_name)} (nahraný)` : 'Nie je vybraný žiadny súbor'}</span></label>
    <div class="progress hidden" id="gprog"><div></div></div>
    <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn" id="save">${icon('check', 15)} Uložiť hodnotenie</button></div></form>`);
  const form = m.el.querySelector('form');
  const fileIn = form.elements.file;
  fileIn.onchange = () => {
    const f = fileIn.files[0];
    const name = form.querySelector('.file-name');
    if (f) name.textContent = `${f.name} (${fmtSize(f.size)})`;
    name.classList.toggle('muted', !f);
  };
  form.onsubmit = e => guard(async () => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const file = fileIn.files[0];
    if (file && file.size > 50 * 1048576) throw new Error('Súbor môže mať najviac 50 MB');
    form.querySelector('#save').disabled = true;
    const data = {
      grade: f.grade, feedback: f.feedback.trim(), review_status: f.review_status,
      reviewed_at: serverTimestamp(), reviewer_id: state.user.uid, reviewer_name: state.profile.full_name,
    };
    try {
      if (file) {
        const prog = form.querySelector('#gprog');
        prog.classList.remove('hidden');
        const path = `reviews/${r.student_id}/${subj.id}/${Date.now()}_${safeName(file.name)}`;
        await uploadFile(path, file, p => (prog.firstElementChild.style.width = `${Math.round(p * 100)}%`));
        Object.assign(data, { review_file_path: path, review_file_name: file.name, review_file_size: file.size });
      }
      await updateDoc(doc(db, 'submissions', r.id), data);
    } catch (err) {
      if (data.review_file_path) await removeFile(data.review_file_path).catch(() => {});
      form.querySelector('#save').disabled = false;
      throw err;
    }
    if (file) {
      if (r.review_file_path) {
        await removeFile(r.review_file_path).catch(() => {});
        adjustStats(-(r.review_file_size || 0), 0);
      }
      adjustStats(file.size, 0);
    }
    logActivity('Hodnotenie práce', `${r.student_name} – ${subj.name}: ${f.grade || 'bez známky'}${f.review_status === 'returned' ? ', vrátené' : ''}`);
    toast('Hodnotenie uložené – študent ho uvidí v Moje práce');
    m.close();
    done();
  });
}
