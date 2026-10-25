import { state, esc, icon, isAdmin, feature, avatar, loadPeople, downloadBlob, onlineIds } from '../lib.js';

// Register: vľavo zoznam mien, vpravo detail vybraného študenta s fotkou a kontaktmi
export default async function (root) {
  const people = (await loadPeople()).sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'));
  const cities = [...new Set(people.map(p => p.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sk'));
  let selected = people.find(p => p.id !== state.user.uid)?.id || people[0]?.id;

  root.innerHTML = `<div class="title-row"><h1>${icon('users', 24)} Register študentov</h1>
    <span class="badge pri">${people.length}</span><span class="spacer"></span>
    ${isAdmin() ? `<button class="btn ghost" id="csv">${icon('download', 16)} Export CSV</button>` : ''}</div>
    <div class="reg">
      <div class="card">
        <div class="row" style="margin-bottom:.75rem">
          <input id="q" placeholder="Hľadať meno, e-mail, telefón…" style="flex:2;min-width:160px">
          <select id="city" style="flex:1;min-width:130px"><option value="">Všetky mestá</option>${cities.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="row" style="margin:-.25rem 0 .6rem"><span class="online-count" id="online-count"></span><span class="spacer"></span>
          <label class="check" style="margin:0"><input type="checkbox" id="only-online"> Iba online</label></div>
        <div class="reg-list" id="list"></div>
      </div>
      <div class="card reg-detail" id="detail"></div>
    </div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let shown = people;

  function drawList() {
    const q = norm(root.querySelector('#q').value);
    const city = root.querySelector('#city').value;
    const onlyOnline = root.querySelector('#only-online').checked;
    shown = people.filter(p => (!city || p.city === city) && (!onlyOnline || online.has(p.id)) && norm(`${p.full_name} ${p.email} ${p.phone}`).includes(q));
    root.querySelector('#list').innerHTML = shown.map(p => `
      <button class="reg-item ${p.id === selected ? 'active' : ''}" data-id="${p.id}"><span class="av-wrap">${avatar(p, 32)}${online.has(p.id) ? '<i class="online-dot" title="Online"></i>' : ''}</span>
        <span class="min0"><span class="ellipsis" style="display:block">${esc(p.full_name)}${p.id === state.user.uid ? ' <span class="muted small">(ty)</span>' : ''}</span>
        <span class="muted small">${esc(p.city || '')}</span></span></button>`).join('')
      || '<p class="muted">Nikto nevyhovuje hľadaniu.</p>';
    root.querySelectorAll('.reg-item').forEach(b => b.onclick = () => {
      selected = b.dataset.id;
      drawList();
      drawDetail();
      if (matchMedia('(max-width: 900px)').matches) root.querySelector('#detail').scrollIntoView({ behavior: 'smooth' });
    });
  }

  function drawDetail() {
    const p = state.people.get(selected);
    const box = root.querySelector('#detail');
    if (!p) return void (box.innerHTML = '<p class="muted">Vyber študenta zo zoznamu.</p>');
    const canMessage = feature('messaging_enabled') && p.id !== state.user.uid;
    box.innerHTML = `<span class="av-wrap big">${avatar(p, 120)}${online.has(p.id) ? '<i class="online-dot"></i>' : ''}</span>
      <h2>${esc(p.full_name)}</h2>
      <div class="muted">${esc(p.city || '')}${p.role === 'admin' ? ` · <span class="badge pri">admin</span>${p.also_student ? ' <span class="badge">študent</span>' : ''}` : p.role === 'lecturer' ? ' · <span class="badge ok">lektor</span>' : ''}</div>
      ${online.has(p.id) ? '<div class="online-label"><i class="online-dot static"></i> online</div>' : ''}
      <div class="reg-contacts">
        <a href="mailto:${esc(p.email)}">${icon('mail', 17)}${esc(p.email)}</a>
        ${p.phone ? `<a href="tel:${esc(p.phone.replace(/\s/g, ''))}">${icon('phone', 17)}${esc(p.phone)}</a>` : `<span class="muted">${icon('phone', 17)}telefón neuvedený</span>`}
      </div>
      ${canMessage ? `<button class="btn" id="dm" style="width:100%;justify-content:center">${icon('send', 16)} Napísať správu</button>` : ''}`;
    box.querySelector('#dm')?.addEventListener('click', () => {
      // Správy otvoria (alebo založia) súkromnú konverzáciu s týmto študentom
      try { sessionStorage.setItem('sh-open-dm', p.id); } catch {}
      location.hash = '#/spravy';
    });
  }

  let online = new Set();
  async function refreshOnline() {
    try { online = await onlineIds(); } catch { online = new Set(); }
    const n = people.filter(p => online.has(p.id)).length;
    root.querySelector('#online-count').innerHTML = `<i class="online-dot static"></i> online: ${n}`;
    drawList();
    drawDetail();
  }
  // Online stav sa mení najviac raz za 5 minút, stačí ho obnoviť každé 2 minúty (iba na viditeľnej karte)
  const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshOnline(); }, 120000);
  root.querySelector('#only-online').onchange = drawList;
  root.querySelector('#q').oninput = drawList;
  root.querySelector('#city').onchange = drawList;
  root.querySelector('#csv')?.addEventListener('click', () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Meno;E-mail;Telefón;Mesto', ...shown.map(p => [p.full_name, p.email, p.phone, p.city].map(cell).join(';'))].join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'studenthub-register.csv');
  });
  drawList();
  drawDetail();
  refreshOnline();
  return () => clearInterval(timer);
}
