import {
  db, state, col, doc, query, where, list, cached, bump, addDoc, updateDoc, deleteDoc, serverTimestamp, byNewest, increment,
  uploadFile, downloadFile, removeFile, logActivity, isAdmin, esc, guard, toast, modal, fmtDate, fmtSize, safeName,
  downloadBlob, icon, avatar,
} from '../lib.js';
import { ALLOWED } from './submissions.js';

const KINDS = { sell: 'Predám', give: 'Darujem', want: 'Hľadám' };
const CONDITIONS = ['nové', 'ako nové', 'používané', 's poznámkami'];

// Študijné materiály (so schvaľovaním) a vnorená Burza kníh a skrípt
export default async function (root, [tab = 'materialy']) {
  const tabs = [['materialy', 'book', 'Študijné materiály'], ['burza', 'archive', 'Burza kníh a skrípt']];
  if (isAdmin()) tabs.push(['schvalovanie', 'check', 'Na schválenie']);
  const current = tabs.find(t => t[0] === tab)?.[0] || 'materialy';
  root.innerHTML = `<div class="title-row"><h1>${icon('book', 24)} Materiály</h1></div>
    <div class="tabs">${tabs.map(([k, ic, l]) => `<a href="#/materialy/${k}" class="${k === current ? 'active' : ''}">${icon(ic, 15)} ${l}${k === 'schvalovanie' ? ' <span class="count hidden" id="pending-n"></span>' : ''}</a>`).join('')}</div>
    <div id="tab"></div>`;
  const el = root.querySelector('#tab');
  if (isAdmin()) countPending(root);
  if (current === 'burza') return renderMarket(el);
  if (current === 'schvalovanie') return renderApproval(el, root);
  return renderMaterials(el);
}

async function countPending(root) {
  const pending = await list(query(col('materials'), where('status', '==', 'pending')));
  const badge = root.querySelector('#pending-n');
  if (badge && pending.length) { badge.textContent = pending.length; badge.classList.remove('hidden'); }
}

function materialRow(m, { mine = false, admin = false } = {}) {
  const status = m.status === 'pending' ? '<span class="badge warn">čaká na schválenie</span>'
    : m.status === 'rejected' ? '<span class="badge err">zamietnuté</span>' : '';
  return `<div class="mat">
    <div class="mat-ic">${icon(m.url ? 'external' : 'file', 20)}</div>
    <div class="min0 grow">
      <div class="strong">${esc(m.title)} ${status}</div>
      ${m.description ? `<div class="small">${esc(m.description)}</div>` : ''}
      <div class="muted small">${esc(m.subject_name || 'Všeobecné')} · ${esc(m.uploader_name)} · ${fmtDate(m.created_at)}${m.file_size ? ` · ${fmtSize(m.file_size)}` : ''}
        · <span class="dl-count" data-count="${m.id}" title="Počet stiahnutí a otvorení">${icon('download', 12)} ${m.downloads || 0}×</span></div>
    </div>
    <div class="row nowrap">
      ${m.url ? `<a class="btn ghost sm" href="${esc(m.url)}" target="_blank" rel="noopener" data-link="${m.id}">${icon('external', 14)} Otvoriť</a>`
        : `<button class="btn ghost sm" data-open="${m.id}">${icon('external', 14)} Otvoriť</button>
           <button class="btn ghost sm" data-dl="${m.id}">${icon('download', 14)} Stiahnuť</button>`}
      ${admin ? `<button class="btn sm" data-ok="${m.id}">${icon('check', 14)} Schváliť</button><button class="btn ghost sm" data-no="${m.id}">Zamietnuť</button>` : ''}
      ${(mine && m.status !== 'approved') || isAdmin() ? `<button class="icon-btn" data-del="${m.id}" title="Zmazať">${icon('trash', 16)}</button>` : ''}
    </div></div>`;
}

function wireMaterialActions(el, items, refresh) {
  // Počítadlo: každé otvorenie alebo stiahnutie zvýši downloads o 1
  const count = m => {
    if (m.status !== 'approved') return;
    updateDoc(doc(db, 'materials', m.id), { downloads: increment(1) }).catch(() => {});
    m.downloads = (m.downloads || 0) + 1;
    el.querySelectorAll(`[data-count="${m.id}"]`).forEach(c => (c.innerHTML = `${icon('download', 12)} ${m.downloads}×`));
  };
  el.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => guard(async () => {
    const m = items.find(x => x.id === b.dataset.dl);
    downloadBlob(await downloadFile(m.file_path), m.file_name);
    count(m);
    logActivity('Stiahnutie materiálu', m.title);
  }));
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => guard(async () => {
    const m = items.find(x => x.id === b.dataset.open);
    const win = window.open('', '_blank'); // okno otvoríme hneď pri kliknutí, inak by ho prehliadač zablokoval
    try {
      const blob = await downloadFile(m.file_path);
      const url = URL.createObjectURL(blob);
      if (win) win.location = url; else downloadBlob(blob, m.file_name);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { win?.close(); throw e; }
    count(m);
    logActivity('Otvorenie materiálu', m.title);
  }));
  el.querySelectorAll('[data-link]').forEach(a => a.addEventListener('click', () => {
    const m = items.find(x => x.id === a.dataset.link);
    count(m);
    logActivity('Otvorenie materiálu', m.title);
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
    const m = items.find(x => x.id === b.dataset.del);
    if (!confirm(`Zmazať materiál „${m.title}“?`)) return;
    await deleteDoc(doc(db, 'materials', m.id));
    if (m.file_path) await removeFile(m.file_path).catch(() => {});
    if (m.status === 'approved') await bump('materials');
    logActivity('Zmazanie materiálu', m.title);
    toast('Materiál zmazaný');
    refresh();
  }));
}

// ---------------------------------------------------------------- Materiály
async function renderMaterials(el) {
  const uid = state.user.uid;
  const maxMb = Number(state.settings.max_file_mb) || 30;
  const [approved, mine, subjects] = await Promise.all([
    list(query(col('materials'), where('status', '==', 'approved'))),
    list(query(col('materials'), where('uploader_id', '==', uid))),
    cached('subjects'),
  ]);
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  const minePending = mine.filter(m => m.status !== 'approved').sort(byNewest);

  el.innerHTML = `<div class="row" style="margin-bottom:1rem">
      <input id="q" placeholder="Hľadať materiál…" style="flex:2;min-width:180px">
      <select id="subj" style="flex:1;min-width:150px"><option value="">Všetky predmety</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <button class="btn" id="add">${icon('plus', 16)} Pridať materiál</button></div>
    ${minePending.length ? `<div class="card"><h2>${icon('clock')} Moje príspevky čakajúce na schválenie</h2><div id="mine"></div></div>` : ''}
    <div class="card"><div id="list"></div></div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function draw() {
    const q = norm(el.querySelector('#q').value);
    const subj = el.querySelector('#subj').value;
    const shown = approved.filter(m => (!subj || m.subject_id === subj) && norm(`${m.title} ${m.description} ${m.subject_name}`).includes(q)).sort(byNewest);
    el.querySelector('#list').innerHTML = shown.map(m => materialRow(m, { mine: m.uploader_id === uid })).join('')
      || '<p class="muted">Zatiaľ tu nie sú žiadne materiály. Pridaj prvý.</p>';
    wireMaterialActions(el.querySelector('#list'), shown, () => renderMaterials(el));
  }
  if (minePending.length) {
    el.querySelector('#mine').innerHTML = minePending.map(m => materialRow(m, { mine: true })).join('');
    wireMaterialActions(el.querySelector('#mine'), minePending, () => renderMaterials(el));
  }
  el.querySelector('#q').oninput = draw;
  el.querySelector('#subj').onchange = draw;
  draw();

  el.querySelector('#add').onclick = () => {
    const m = modal('Pridať študijný materiál', `<form>
      <label>Názov</label><input name="title" required maxlength="120" placeholder="napr. Poznámky z prednášok – Makroekonómia">
      <label>Predmet</label><select name="subject_id"><option value="">Všeobecné</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <label>Popis (nepovinné)</label><textarea name="description" rows="2" maxlength="500"></textarea>
      <label>Súbor (max. ${maxMb} MB) alebo odkaz</label>
      <label class="file-pick"><input name="file" type="file" accept="${ALLOWED.map(x => '.' + x).join(',')}">
        <span class="btn ghost">${icon('file', 16)} Vybrať súbor</span><span class="file-name muted">Nie je vybraný žiadny súbor</span></label>
      <input name="url" type="url" placeholder="alebo odkaz, napr. https://…" style="margin-top:.5rem">
      ${isAdmin() ? '' : '<p class="muted small">Materiál sa ostatným zobrazí po schválení administrátorom.</p>'}
      <div class="progress hidden" id="prog"><div></div></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('upload', 16)} Pridať</button></div></form>`);
    const form = m.el.querySelector('form');
    const f = form.elements;
    f.file.onchange = () => {
      const file = f.file.files[0];
      const name = form.querySelector('.file-name');
      name.textContent = file ? `${file.name} (${fmtSize(file.size)})` : 'Nie je vybraný žiadny súbor';
      name.classList.toggle('muted', !file);
    };
    form.onsubmit = e => guard(async () => {
      e.preventDefault();
      const file = f.file.files[0];
      const url = f.url.value.trim();
      if (!file && !url) throw new Error('Vyber súbor alebo zadaj odkaz');
      if (url && !/^https?:\/\//i.test(url)) throw new Error('Odkaz musí začínať https://');
      const subject = subjects.find(s => s.id === f.subject_id.value);
      const row = {
        title: f.title.value.trim(), description: f.description.value.trim(),
        subject_id: subject?.id || '', subject_name: subject?.name || '',
        uploader_id: uid, uploader_name: state.profile.full_name,
        status: isAdmin() ? 'approved' : 'pending', created_at: serverTimestamp(),
        url: file ? '' : url, file_path: '', file_name: '', file_size: 0,
      };
      if (file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!ALLOWED.includes(ext)) throw new Error(`Nepovolený typ súboru .${ext}`);
        if (file.size > maxMb * 1048576) throw new Error(`Súbor má ${fmtSize(file.size)}, maximum je ${maxMb} MB`);
        const prog = form.querySelector('#prog');
        prog.classList.remove('hidden');
        row.file_path = `materials/${uid}/${Date.now()}_${safeName(file.name)}`;
        await uploadFile(row.file_path, file, p => (prog.firstElementChild.style.width = `${Math.round(p * 100)}%`));
        Object.assign(row, { file_name: file.name, file_size: file.size });
      }
      await addDoc(col('materials'), row);
      if (row.status === 'approved') await bump('materials');
      logActivity('Pridanie materiálu', `${row.title}${row.status === 'pending' ? ' (čaká na schválenie)' : ''}`);
      m.close();
      toast(row.status === 'pending' ? 'Materiál odoslaný na schválenie' : 'Materiál pridaný');
      renderMaterials(el);
    });
  };
}

// ---------------------------------------------------------------- Schvaľovanie (admin)
async function renderApproval(el, root) {
  const pending = (await list(query(col('materials'), where('status', '==', 'pending')))).sort(byNewest);
  el.innerHTML = `<div class="card">${pending.map(m => materialRow(m, { admin: true })).join('')
    || '<p class="muted">Nič nečaká na schválenie.</p>'}</div>`;
  wireMaterialActions(el, pending, () => renderApproval(el, root));
  const decide = (id, status) => guard(async () => {
    const m = pending.find(x => x.id === id);
    await updateDoc(doc(db, 'materials', id), { status, decided_at: serverTimestamp(), decided_by: state.profile.full_name });
    if (status === 'approved') await bump('materials');
    logActivity(status === 'approved' ? 'Schválenie materiálu' : 'Zamietnutie materiálu', `${m.title} (${m.uploader_name})`);
    toast(status === 'approved' ? 'Materiál schválený' : 'Materiál zamietnutý');
    renderApproval(el, root);
  });
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => decide(b.dataset.ok, 'approved'));
  el.querySelectorAll('[data-no]').forEach(b => b.onclick = () => decide(b.dataset.no, 'rejected'));
  const badge = root.querySelector('#pending-n');
  if (badge) { badge.textContent = pending.length; badge.classList.toggle('hidden', !pending.length); }
}

// ---------------------------------------------------------------- Burza kníh a skrípt
async function renderMarket(el) {
  const uid = state.user.uid;
  const [items, subjects] = await Promise.all([list(query(col('market'), where('status', '==', 'active'))), cached('subjects')]);
  items.sort(byNewest);

  el.innerHTML = `<div class="row" style="margin-bottom:1rem">
      <input id="q" placeholder="Hľadať knihu, skriptá, autora…" style="flex:2;min-width:180px">
      <select id="kind" style="flex:1;min-width:130px"><option value="">Všetky inzeráty</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn" id="add">${icon('plus', 16)} Pridať inzerát</button></div>
    <div class="market" id="list"></div>`;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function draw() {
    const q = norm(el.querySelector('#q').value);
    const kind = el.querySelector('#kind').value;
    const shown = items.filter(i => (!kind || i.kind === kind) && norm(`${i.title} ${i.author} ${i.description} ${i.subject_name}`).includes(q));
    el.querySelector('#list').innerHTML = shown.map(i => {
      const seller = state.people.get(i.seller_id) || { full_name: i.seller_name };
      const mine = i.seller_id === uid;
      return `<div class="card ad">
        <div class="row"><span class="badge ${i.kind === 'give' ? 'ok' : i.kind === 'want' ? 'warn' : 'pri'}">${KINDS[i.kind] || ''}</span><span class="spacer"></span>
          <strong class="price">${i.kind === 'sell' ? (Number(i.price) ? `${Number(i.price).toLocaleString('sk-SK')} €` : 'dohodou') : i.kind === 'give' ? 'zadarmo' : ''}</strong></div>
        <h3>${esc(i.title)}</h3>
        ${i.author ? `<div class="muted small">${esc(i.author)}</div>` : ''}
        ${i.description ? `<p class="small">${esc(i.description)}</p>` : ''}
        <div class="muted small">${[i.subject_name, i.condition && `stav: ${i.condition}`].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="ad-foot">${avatar(seller, 26)}<span class="small min0 ellipsis">${esc(seller.full_name)}</span><span class="spacer"></span>
          ${mine ? `<button class="btn ghost sm" data-sold="${i.id}">${icon('check', 14)} ${i.kind === 'want' ? 'Vybavené' : 'Predané'}</button>`
            : `<button class="btn sm" data-msg="${i.seller_id}">${icon('send', 14)} Napísať</button>`}
          ${mine || isAdmin() ? `<button class="icon-btn" data-del="${i.id}" title="Zmazať">${icon('trash', 15)}</button>` : ''}</div>
      </div>`;
    }).join('') || '<p class="muted">Zatiaľ žiadne inzeráty.</p>';

    el.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
      try { sessionStorage.setItem('sh-open-dm', b.dataset.msg); } catch {}
      location.hash = '#/spravy';
    });
    el.querySelectorAll('[data-sold]').forEach(b => b.onclick = () => guard(async () => {
      await updateDoc(doc(db, 'market', b.dataset.sold), { status: 'closed' });
      logActivity('Burza: inzerát uzavretý', items.find(i => i.id === b.dataset.sold)?.title || '');
      toast('Inzerát uzavretý');
      renderMarket(el);
    }));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
      if (!confirm('Zmazať inzerát?')) return;
      await deleteDoc(doc(db, 'market', b.dataset.del));
      logActivity('Burza: inzerát zmazaný', items.find(i => i.id === b.dataset.del)?.title || '');
      renderMarket(el);
    }));
  }
  el.querySelector('#q').oninput = draw;
  el.querySelector('#kind').onchange = draw;
  draw();

  el.querySelector('#add').onclick = () => {
    const m = modal('Nový inzerát', `<form>
      <label>Typ inzerátu</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>Názov knihy alebo skrípt</label><input name="title" required maxlength="120">
      <label>Autor (nepovinné)</label><input name="author" maxlength="100">
      <div class="row nowrap">
        <div class="grow"><label>Cena (€)</label><input name="price" type="number" min="0" step="0.5" placeholder="prázdne = dohodou"></div>
        <div class="grow"><label>Stav</label><select name="condition"><option value="">—</option>${CONDITIONS.map(c => `<option>${c}</option>`).join('')}</select></div>
      </div>
      <label>Predmet (nepovinné)</label><select name="subject_id"><option value="">—</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <label>Popis (nepovinné)</label><textarea name="description" rows="2" maxlength="500"></textarea>
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('check', 16)} Zverejniť</button></div></form>`);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const subject = subjects.find(s => s.id === f.subject_id);
      await addDoc(col('market'), {
        kind: f.kind, title: f.title.trim(), author: f.author.trim(), description: f.description.trim(),
        price: f.kind === 'sell' && f.price ? Number(f.price) : 0, condition: f.condition,
        subject_id: subject?.id || '', subject_name: subject?.name || '',
        seller_id: uid, seller_name: state.profile.full_name, status: 'active', created_at: serverTimestamp(),
      });
      logActivity('Burza: nový inzerát', `${KINDS[f.kind]} – ${f.title.trim()}`);
      m.close();
      toast('Inzerát zverejnený');
      renderMarket(el);
    });
  };
}
