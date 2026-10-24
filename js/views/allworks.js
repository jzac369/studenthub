import {
  col, list, cached, toDate, byNewest, downloadFile, logActivity, esc, guard, toast, fmtDateTime, fmtSize, safeName, downloadBlob, loadScript, icon, avatar,
} from '../lib.js';

// Všetky práce (iba admini): študenti × predmety, zelená fajka = študent z predmetu odovzdal prácu
export default async function renderAllWorks(el) {
  const [users, subjects, subs] = await Promise.all([cached('users'), cached('subjects'), list(col('submissions'))]);
  const students = users.filter(u => u.approved && u.role !== 'admin').sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
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
          ${n ? `<button class="icon-btn" data-zip="${s.id}" title="Stiahnuť všetky práce z predmetu ako ZIP">${icon('download', 15)}</button>` : ''}</div></th>`;
      }).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
      ${subjects.length ? '' : '<p class="muted">Zatiaľ nie sú zadané žiadne predmety.</p>'}
      <div class="progress hidden" id="prog"><div></div></div>
      <p class="muted small" style="margin:.75rem 0 0">${icon('check', 13)} = práca odovzdaná (kliknutím ju stiahneš), fajka v krúžku = už odoslaná lektorovi, – = chýba. Hromadné preposlanie lektorovi a označenie ako odoslané nájdeš v Administrácia → Práce a preposielanie.</p>
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
        return `<td class="mx-cell"><button class="mx-ok ${r.status === 'forwarded' ? 'sent' : ''}" data-dl="${r.id}"
          title="${esc(r.title)} · ${esc(r.file_name)} · ${fmtDateTime(r.created_at)}${r.status === 'forwarded' ? ' · odoslané lektorovi' : ''}${n > 1 ? ` · spolu ${n} práce` : ''}">${icon('check', 16)}</button></td>`;
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
