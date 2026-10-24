import { db, state, col, doc, addDoc, updateDoc, deleteDoc, cached, bump, logActivity, serverTimestamp, toDate, esc, guard, toast, modal, fmtDate, icon, isAdmin } from '../lib.js';

const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
// Stabilné mierne natočenie lístka podľa jeho id
const tilt = id => ((id.charCodeAt(0) + id.charCodeAt(5)) % 7) - 3;
// Červený špendlík pre pripnuté oznamy
const PIN = `<svg class="pin" width="26" height="30" viewBox="0 0 26 30" aria-label="Pripnuté"><line x1="13" y1="16" x2="13" y2="29" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="10" r="9" fill="#e5484d"/><circle cx="10" cy="7" r="3" fill="#fff" opacity=".45"/></svg>`;

export default async function (root) {
  async function render() {
    const notes = (await cached('announcements'))
      .sort((a, b) => (!!b.pinned - !!a.pinned) || (toDate(b.created_at) - toDate(a.created_at)));
    root.innerHTML = `<div class="title-row"><h1>${icon('pin', 24)} Nástenka</h1><span class="spacer"></span>
      ${isAdmin() ? `<button class="btn" id="add">${icon('plus', 16)} Nový oznam</button>` : ''}</div>
      ${notes.length ? '' : '<p class="muted">Na nástenke zatiaľ nič nie je.</p>'}
      <div class="board">${notes.map(n => `
        <article class="note ${n.pinned ? 'pinned' : ''}" style="--note:var(--note-${COLORS.includes(n.color) ? n.color : 'yellow'});--r:${tilt(n.id)}deg">
          ${n.pinned ? PIN : ''}
          <h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>
          <div class="meta"><span>${fmtDate(n.created_at)}</span><span class="spacer"></span>
            ${isAdmin() ? `<button class="icon-btn" data-edit="${n.id}" title="Upraviť">${icon('edit', 15)}</button><button class="icon-btn" data-del="${n.id}" title="Zmazať">${icon('trash', 15)}</button>` : ''}</div>
        </article>`).join('')}</div>`;

    root.querySelector('#add')?.addEventListener('click', () => edit());
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(notes.find(n => n.id === b.dataset.edit)));
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
      if (!confirm('Naozaj zmazať tento oznam?')) return;
      await deleteDoc(doc(db, 'announcements', b.dataset.del));
      logActivity('Nástenka: oznam zmazaný', notes.find(n => n.id === b.dataset.del)?.title || '');
      await bump('announcements');
      render();
    }));
  }

  function edit(note = { title: '', body: '', color: 'yellow', pinned: false }) {
    const m = modal(note.id ? 'Upraviť oznam' : 'Nový oznam', `<form>
      <label>Nadpis</label><input name="title" required maxlength="80" value="${esc(note.title)}">
      <label>Text</label><textarea name="body" rows="5">${esc(note.body)}</textarea>
      <label>Farba lístka</label><div class="colors">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${c === note.color ? 'checked' : ''}><span style="--note:var(--note-${c})"></span></label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="pinned" ${note.pinned ? 'checked' : ''}> Pripnúť navrch</label>
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('check', 16)} Uložiť</button></div></form>`);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = { title: f.get('title'), body: f.get('body'), color: f.get('color') || 'yellow', pinned: f.has('pinned') };
      if (note.id) await updateDoc(doc(db, 'announcements', note.id), row);
      else await addDoc(col('announcements'), { ...row, author_id: state.user.uid, created_at: serverTimestamp() });
      await bump('announcements');
      m.close();
      logActivity(note.id ? 'Nástenka: oznam upravený' : 'Nástenka: nový oznam', row.title);
      toast('Uložené');
      render();
    });
  }

  await render();
}
