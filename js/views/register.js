import { state, esc, icon, isAdmin, loadPeople, downloadBlob } from '../lib.js';

export default async function (root) {
  const people = (await loadPeople()).sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  const cities = [...new Set(people.map(p => p.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sk'));

  root.innerHTML = `<div class="title-row"><h1>${icon('users', 24)} Register študentov</h1>
    <span class="badge pri">${people.length}</span><span class="spacer"></span>
    ${isAdmin() ? `<button class="btn ghost" id="csv">${icon('download', 16)} Export CSV</button>` : ''}</div>
    <div class="card">
      <div class="row" style="margin-bottom:.75rem">
        <input id="q" placeholder="Hľadať meno, e-mail, telefón…" style="flex:2;min-width:200px">
        <select id="city" style="flex:1;min-width:150px"><option value="">Všetky mestá</option>${cities.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Meno</th><th>E-mail</th><th>Telefón</th><th>Mesto</th></tr></thead><tbody id="rows"></tbody></table></div>
    </div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let shown = people;

  function draw() {
    const q = norm(root.querySelector('#q').value);
    const city = root.querySelector('#city').value;
    shown = people.filter(p => (!city || p.city === city) && norm(`${p.full_name} ${p.email} ${p.phone}`).includes(q));
    root.querySelector('#rows').innerHTML = shown.map(p => `<tr>
      <td><strong>${esc(p.full_name)}</strong>${p.role === 'admin' ? ' <span class="badge pri">admin</span>' : ''}${p.id === state.user.uid ? ' <span class="muted small">(ty)</span>' : ''}</td>
      <td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td>
      <td>${p.phone ? `<a href="tel:${esc(p.phone.replace(/\s/g, ''))}">${esc(p.phone)}</a>` : '<span class="muted">—</span>'}</td>
      <td>${esc(p.city) || '<span class="muted">—</span>'}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">Nikto nevyhovuje hľadaniu.</td></tr>';
  }

  root.querySelector('#q').oninput = draw;
  root.querySelector('#city').onchange = draw;
  root.querySelector('#csv')?.addEventListener('click', () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Meno;E-mail;Telefón;Mesto', ...shown.map(p => [p.full_name, p.email, p.phone, p.city].map(cell).join(';'))].join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'studenthub-register.csv');
  });
  draw();
}
