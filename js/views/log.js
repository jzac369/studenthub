import {
  db, col, doc, query, where, orderBy, limit, list, writeBatch, toDate, esc, guard, toast, fmtDateTime, downloadBlob, icon, logActivity,
} from '../lib.js';

const PAGE = 100; // záznamov na jedno načítanie

export default async function (root) {
  let shown = PAGE;
  let items = [];

  root.innerHTML = `<div class="title-row"><h1>${icon('activity', 24)} Log aktivít</h1><span class="spacer"></span>
      <button class="btn ghost" id="csv">${icon('download', 16)} Export CSV</button>
      <button class="btn ghost" id="purge">${icon('trash', 16)} Zmazať staršie ako 90 dní</button></div>
    <div class="card">
      <div class="row" style="margin-bottom:.75rem">
        <input id="q" placeholder="Hľadať meno, e-mail, akciu, detail…" style="flex:2;min-width:200px">
        <select id="who" style="flex:1;min-width:150px"><option value="">Všetci</option><option value="student">Iba študenti</option><option value="admin">Iba admini</option></select>
        <select id="what" style="flex:1;min-width:150px"><option value="">Všetky akcie</option></select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Čas</th><th>Používateľ</th><th>Akcia</th><th>Detail</th><th>Zariadenie</th></tr></thead><tbody id="rows"></tbody></table></div>
      <div class="row" style="margin-top:.75rem"><span class="muted small" id="info"></span><span class="spacer"></span>
        <button class="btn ghost sm" id="more">Načítať staršie záznamy</button></div>
    </div>
    <p class="muted small">Log vidia iba administrátori. Zaznamenáva prihlásenia, zobrazené stránky a činnosti v portáli, nikdy obsah správ ani heslá.</p>`;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let filtered = [];

  async function load() {
    items = await list(query(col('logs'), orderBy('at', 'desc'), limit(shown)));
    const actions = [...new Set(items.map(i => i.action))].sort((a, b) => a.localeCompare(b, 'sk'));
    const sel = root.querySelector('#what');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Všetky akcie</option>' + actions.map(a => `<option ${a === cur ? 'selected' : ''}>${esc(a)}</option>`).join('');
    root.querySelector('#more').classList.toggle('hidden', items.length < shown);
    draw();
  }

  function draw() {
    const q = norm(root.querySelector('#q').value);
    const who = root.querySelector('#who').value;
    const what = root.querySelector('#what').value;
    filtered = items.filter(i => (!who || i.role === who) && (!what || i.action === what)
      && norm(`${i.name} ${i.email} ${i.action} ${i.detail}`).includes(q));
    root.querySelector('#rows').innerHTML = filtered.map(i => `<tr>
      <td class="nowrap-cell">${fmtDateTime(i.at)}</td>
      <td><strong>${esc(i.name || '—')}</strong>${i.role === 'admin' ? ' <span class="badge pri">admin</span>' : ''}<div class="muted small">${esc(i.email)}</div></td>
      <td>${esc(i.action)}</td>
      <td class="small">${esc(i.detail)}</td>
      <td class="muted small">${esc(i.device || '')}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">Žiadne záznamy.</td></tr>';
    root.querySelector('#info').textContent = `Zobrazených ${filtered.length} z ${items.length} načítaných záznamov`;
  }

  root.querySelector('#q').oninput = draw;
  root.querySelector('#who').onchange = draw;
  root.querySelector('#what').onchange = draw;
  root.querySelector('#more').onclick = () => guard(async () => { shown += PAGE; await load(); });

  root.querySelector('#csv').onclick = () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Čas;Meno;E-mail;Rola;Akcia;Detail;Zariadenie',
      ...filtered.map(i => [fmtDateTime(i.at), i.name, i.email, i.role, i.action, i.detail, i.device].map(cell).join(';'))].join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'studenthub-log.csv');
  };

  root.querySelector('#purge').onclick = () => guard(async () => {
    if (!confirm('Natrvalo zmazať záznamy staršie ako 90 dní?')) return;
    const old = await list(query(col('logs'), where('at', '<', new Date(Date.now() - 90 * 864e5))));
    for (let i = 0; i < old.length; i += 400) {
      const batch = writeBatch(db);
      old.slice(i, i + 400).forEach(l => batch.delete(doc(db, 'logs', l.id)));
      await batch.commit();
    }
    logActivity('Čistenie logu', `zmazaných ${old.length} záznamov starších ako 90 dní`);
    toast(`Zmazaných ${old.length} starých záznamov`);
    load();
  });

  await load();
}
