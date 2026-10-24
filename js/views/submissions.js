import {
  db, state, col, doc, query, where, list, cached, addDoc, deleteDoc, serverTimestamp, toDate, byNewest,
  uploadFile, downloadFile, removeFile, adjustStats, logActivity, esc, guard, toast, fmtDate, fmtDateTime, fmtSize, safeName, downloadBlob, icon,
} from '../lib.js';

export const ALLOWED = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg'];

export default async function (root) {
  const uid = state.user.uid;
  const maxMb = Number(state.settings.max_file_mb) || 30;
  const [subjects, assignments] = await Promise.all([cached('subjects'), cached('assignments')]);
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  assignments.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));

  root.innerHTML = `<div class="title-row"><h1>${icon('upload', 24)} Moje práce</h1></div>
  ${subjects.length ? '' : '<div class="card"><p class="muted" style="margin:0">Administrátor ešte nepridal predmety, preto zatiaľ nie je možné odovzdať prácu.</p></div>'}
  <form class="card ${subjects.length ? '' : 'hidden'}" id="up"><h2>Odovzdať novú prácu</h2>
    <div class="grid" style="gap:0 1rem">
      <div><label>Predmet</label><select name="subject_id" required><option value="">— vyber —</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div><label>Zadanie (nepovinné)</label><select name="assignment_id"><option value="">— bez zadania —</option></select></div>
    </div>
    <label>Názov práce</label><input name="title" required maxlength="150" placeholder="napr. Seminárna práca – Marketingový mix">
    <label>Poznámka pre lektora (nepovinné)</label><textarea name="note" rows="2" maxlength="1000"></textarea>
    <label>Súbor (max. ${maxMb} MB)</label>
    <label class="file-pick"><input name="file" type="file" accept="${ALLOWED.map(x => '.' + x).join(',')}">
      <span class="btn ghost">${icon('file', 16)} Vybrať súbor</span><span class="file-name muted">Nie je vybraný žiadny súbor</span></label>
    <div class="progress hidden" id="prog"><div></div></div>
    <button class="btn" style="margin-top:1rem" id="send">${icon('upload', 16)} Odovzdať</button>
  </form>
  <div class="card"><h2>${icon('file')} Odovzdané</h2><div class="table-wrap" id="list">Načítavam…</div></div>`;

  const form = root.querySelector('#up');
  const el = form.elements;
  // Vlastné tlačidlo výberu súboru – zobrazí názov a veľkosť vybraného súboru
  el.file.onchange = () => {
    const f = el.file.files[0];
    const name = form.querySelector('.file-name');
    name.textContent = f ? `${f.name} (${fmtSize(f.size)})` : 'Nie je vybraný žiadny súbor';
    name.classList.toggle('muted', !f);
  };

  el.subject_id.onchange = () => {
    const opts = assignments.filter(a => a.subject_id === el.subject_id.value);
    el.assignment_id.innerHTML = '<option value="">— bez zadania —</option>' +
      opts.map(a => `<option value="${a.id}">${esc(a.title)}${a.due_date ? ` (do ${fmtDate(a.due_date)})` : ''}</option>`).join('');
  };

  form.onsubmit = e => guard(async () => {
    e.preventDefault();
    const file = el.file.files[0];
    if (!file) throw new Error('Vyber súbor, ktorý chceš odovzdať');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) throw new Error(`Nepovolený typ súboru .${ext}`);
    if (file.size > maxMb * 1048576) throw new Error(`Súbor má ${fmtSize(file.size)}, maximum je ${maxMb} MB`);
    const btn = root.querySelector('#send');
    const prog = root.querySelector('#prog');
    const bar = prog.firstElementChild;
    btn.disabled = true;
    prog.classList.remove('hidden');
    const path = `submissions/${uid}/${Date.now()}_${safeName(file.name)}`;
    const subject = subjects.find(s => s.id === el.subject_id.value);
    const assignment = assignments.find(a => a.id === el.assignment_id.value);
    try {
      await uploadFile(path, file, p => (bar.style.width = `${Math.round(p * 100)}%`));
      try {
        await addDoc(col('submissions'), {
          student_id: uid, student_name: state.profile.full_name, student_email: state.profile.email,
          subject_id: subject.id, subject_name: subject.name,
          assignment_id: assignment?.id || '', assignment_title: assignment?.title || '', due_date: assignment?.due_date || '',
          title: el.title.value.trim(), note: el.note.value.trim(),
          file_path: path, file_name: file.name, file_size: file.size,
          status: 'submitted', created_at: serverTimestamp(),
        });
      } catch (err) {
        await removeFile(path).catch(() => {});
        throw err;
      }
      adjustStats(file.size, 1);
      logActivity('Odovzdanie práce', `„${el.title.value.trim()}“ – ${subject.name}, ${file.name} (${fmtSize(file.size)})`);
      toast('Práca bola odovzdaná');
      form.reset();
      el.file.onchange();
      el.subject_id.onchange();
      await refresh();
    } finally {
      btn.disabled = false;
      prog.classList.add('hidden');
      bar.style.width = '0';
    }
  });

  async function refresh() {
    const items = (await list(query(col('submissions'), where('student_id', '==', uid)))).sort(byNewest);
    const box = root.querySelector('#list');
    if (!items.length) return void (box.innerHTML = '<p class="muted">Zatiaľ si neodovzdal/a žiadnu prácu.</p>');
    box.innerHTML = `<table><thead><tr><th>Práca</th><th>Predmet</th><th>Odovzdané</th><th>Stav</th><th></th></tr></thead><tbody>
      ${items.map(r => {
        const late = r.due_date && toDate(r.created_at).toLocaleDateString('sv-SE') > r.due_date;
        return `<tr><td><strong>${esc(r.title)}</strong><div class="muted small">${esc(r.file_name)} · ${fmtSize(r.file_size)}</div></td>
        <td>${esc(r.subject_name || '—')}<div class="muted small">${esc(r.assignment_title)}</div></td>
        <td>${fmtDateTime(r.created_at)}${late ? '<br><span class="badge warn">po termíne</span>' : ''}</td>
        <td>${r.status === 'forwarded' ? `<span class="badge ok">odoslané lektorovi</span><div class="muted small">${fmtDate(r.forwarded_at)}</div>` : '<span class="badge pri">odovzdané</span>'}</td>
        <td class="nowrap-cell"><button class="icon-btn" data-dl="${r.id}" title="Stiahnuť">${icon('download', 17)}</button>
          ${r.status === 'submitted' ? `<button class="icon-btn" data-del="${r.id}" title="Zmazať">${icon('trash', 17)}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`;
    box.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => guard(async () => {
      const r = items.find(x => x.id === b.dataset.dl);
      downloadBlob(await downloadFile(r.file_path), r.file_name);
      logActivity('Stiahnutie vlastnej práce', r.file_name);
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
      const r = items.find(x => x.id === b.dataset.del);
      if (!confirm(`Zmazať prácu „${r.title}“?`)) return;
      await deleteDoc(doc(db, 'submissions', r.id));
      await removeFile(r.file_path).catch(() => {});
      adjustStats(-r.file_size, -1);
      logActivity('Zmazanie práce', `„${r.title}“ – ${r.file_name}`);
      toast('Zmazané');
      refresh();
    }));
  }
  await refresh();
}
