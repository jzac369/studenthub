import {
  db, state, collection, col, doc, getDoc, setDoc, addDoc, updateDoc, query, orderBy, limit, onSnapshot,
  serverTimestamp, writeBatch, increment, rows, toDate, isUnread, unreadCount, logActivity, avatar as personAvatar, esc, guard, modal, fmtDateTime, initials, icon, isAdmin, loadPeople,
} from '../lib.js';

export default async function (root) {
  const uid = state.user.uid;
  await loadPeople();
  let active = null;
  let unsubMsgs = null;
  const PAGE = 25; // správ na jedno načítanie – staršie len na požiadanie

  root.innerHTML = `<div class="chat" id="chat">
    <aside class="chat-list">
      <div class="chat-actions">
        <button class="btn sm" id="dm">${icon('mail', 15)} Nová správa</button>
        ${isAdmin() ? `<button class="btn ghost sm" id="grp">${icon('users', 15)} Skupina</button>
        <button class="btn ghost sm" id="all" title="Skupina so všetkými študentmi">${icon('megaphone', 15)} Všetkým</button>` : ''}
      </div>
      <div id="convs"></div>
    </aside>
    <section class="chat-main" id="pane"><div class="empty">${icon('message', 40)}<p>Vyber konverzáciu alebo začni novú.</p></div></section>
  </div>`;
  const chat = root.querySelector('#chat');
  const name = id => state.people.get(id)?.full_name || 'Neznámy';
  const title = c => (c.is_group ? c.name : name(c.members.find(m => m !== uid)));
  const avatar = c => (c.is_group
    ? `<div class="avatar">${icon('users', 16)}</div>`
    : personAvatar(state.people.get(c.members.find(m => m !== uid)) || { full_name: title(c) }, 34));

  // Zoznam konverzácií sa aktualizuje živo z odberu v main.js
  function drawList() {
    const convs = [...state.convs].sort((a, b) => (toDate(b.last_message_at) || 0) - (toDate(a.last_message_at) || 0));
    root.querySelector('#convs').innerHTML = convs.map(c => `
      <div class="conv ${c.id === active ? 'active' : ''}" data-id="${c.id}">
        ${avatar(c)}
        <div class="min0"><div class="name">${esc(title(c))}</div>
          <div class="muted small ellipsis">${c.last_message ? esc(c.last_message) : c.is_group ? `${c.members.length} členov` : 'zatiaľ bez správ'}</div></div>
        ${isUnread(c) ? `<span class="count" title="Neprečítané správy">${unreadCount(c)}</span>` : ''}
      </div>`).join('') || '<p class="muted small" style="padding:1rem">Zatiaľ nemáš žiadne konverzácie.</p>';
    root.querySelectorAll('.conv').forEach(el => el.onclick = () => open(el.dataset.id));
    const cur = state.convs.find(c => c.id === active);
    if (cur && isUnread(cur)) markRead(cur.id);
  }

  function open(id) {
    const c = state.convs.find(x => x.id === id);
    if (!c) return;
    active = id;
    unsubMsgs?.();
    chat.classList.add('open');
    drawList();
    const pane = root.querySelector('#pane');
    pane.innerHTML = `<div class="chat-head"><button class="icon-btn back-btn" id="back">${icon('back', 20)}</button>
        ${avatar(c)}<div class="min0"><strong>${esc(title(c))}</strong>
        ${c.is_group ? `<div class="muted small ellipsis">${esc(c.members.filter(m => m !== uid).map(name).join(', '))}</div>` : ''}</div></div>
      <div class="msgs" id="msgs"></div>
      ${c.is_group && !isAdmin()
        ? `<div class="chat-readonly">${icon('megaphone', 15)} Do skupiny môžu písať iba administrátori.</div>`
        : `<form class="chat-form" id="send"><textarea name="body" placeholder="Napíš správu…" title="Enter odošle, Shift+Enter nový riadok" maxlength="4000" required></textarea>
        <button class="btn" title="Odoslať">${icon('send', 16)}</button></form>`}`;
    pane.querySelector('#back').onclick = () => chat.classList.remove('open');

    const box = pane.querySelector('#msgs');
    let shown = PAGE;
    const listen = keepScroll => {
      unsubMsgs?.();
      unsubMsgs = onSnapshot(query(collection(db, 'conversations', id, 'messages'), orderBy('created_at', 'desc'), limit(shown)), snap => {
        const fromBottom = box.scrollHeight - box.scrollTop;
        box.innerHTML = (snap.size >= shown ? '<button class="btn ghost sm older" id="older">Načítať staršie správy</button>' : '') +
          rows(snap).reverse().map(m => {
            const mine = m.sender_id === uid;
            return `<div class="msg ${mine ? 'me' : ''}">${!mine && c.is_group ? `<div class="who">${esc(name(m.sender_id))}</div>` : ''}${esc(m.body)}<div class="time">${fmtDateTime(m.created_at)}</div></div>`;
          }).join('');
        box.scrollTop = keepScroll ? box.scrollHeight - fromBottom : box.scrollHeight;
        keepScroll = false;
        box.querySelector('#older')?.addEventListener('click', () => { shown += PAGE; listen(true); });
      }, err => guard(() => { throw err; }));
    };
    listen(false);

    const form = pane.querySelector('#send');
    if (!form) return;
    const body = form.elements.body;
    body.focus();
    body.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    };
    form.onsubmit = e => guard(async () => {
      e.preventDefault();
      const text = body.value.trim();
      if (!text) return;
      body.value = '';
      const batch = writeBatch(db);
      batch.set(doc(collection(db, 'conversations', id, 'messages')), { sender_id: uid, body: text, created_at: serverTimestamp() });
      const others = Object.fromEntries(c.members.filter(m => m !== uid).map(m => [`unread.${m}`, increment(1)]));
      batch.update(doc(db, 'conversations', id), {
        last_message_at: serverTimestamp(), last_message: text.slice(0, 80), last_sender: uid,
        [`reads.${uid}`]: serverTimestamp(), [`unread.${uid}`]: 0, ...others,
      });
      await batch.commit();
      logActivity('Správa odoslaná', c.is_group ? `skupina „${c.name}“ (${c.members.length} členov)` : `súkromná správa pre ${title(c)}`);
    });
  }

  function markRead(id) {
    updateDoc(doc(db, 'conversations', id), { [`reads.${uid}`]: serverTimestamp(), [`unread.${uid}`]: 0 }).catch(console.error);
  }

  const newConv = (members, extra) => ({
    members, created_by: uid, created_at: serverTimestamp(), last_message_at: serverTimestamp(),
    last_message: '', last_sender: '', reads: {}, unread: {}, ...extra,
  });
  // Nová konverzácia sa objaví v odbere s malým oneskorením – počkáme na ňu
  async function openWhenReady(id) {
    for (let i = 0; i < 20 && !state.convs.some(c => c.id === id); i++) await new Promise(r => setTimeout(r, 150));
    open(id);
  }

  const peoplePicker = multi => `<input id="filter" placeholder="Hľadať meno…">
    <div class="pick-list">${[...state.people.values()].filter(p => p.id !== uid)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'sk'))
      .map(p => `<label class="check" data-n="${esc(p.full_name.toLowerCase())}"><input type="${multi ? 'checkbox' : 'radio'}" name="who" value="${p.id}" ${multi ? '' : 'required'}> ${esc(p.full_name)} <span class="muted small">${esc(p.city)}</span></label>`).join('')}</div>`;
  const wireFilter = el => el.querySelector('#filter').oninput = e => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll('.pick-list label').forEach(l => l.classList.toggle('hidden', !l.dataset.n.includes(q)));
  };

  root.querySelector('#dm').onclick = () => {
    const m = modal('Nová súkromná správa', `<form>${peoplePicker(false)}
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">Otvoriť chat</button></div></form>`);
    wireFilter(m.el);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      await startDm(new FormData(e.target).get('who'));
      m.close();
    });
  };

  // Súkromná konverzácia má pevné id z oboch účtov – vznikne iba raz
  async function startDm(other) {
    const id = 'dm_' + [uid, other].sort().join('_');
    const ref = doc(db, 'conversations', id);
    if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, newConv([uid, other], { name: '', is_group: false }));
      logActivity('Nová súkromná konverzácia', `s ${name(other)}`);
    }
    openWhenReady(id);
  }

  root.querySelector('#grp')?.addEventListener('click', () => {
    const m = modal('Nová skupinová konverzácia', `<form><label>Názov skupiny</label><input name="name" required maxlength="60" placeholder="napr. Tím – projekt Marketing">
      <label>Členovia</label>${peoplePicker(true)}
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">Vytvoriť</button></div></form>`);
    wireFilter(m.el);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const f = new FormData(e.target);
      const members = f.getAll('who');
      if (!members.length) throw new Error('Vyber aspoň jedného člena');
      const ref = await addDoc(col('conversations'), newConv([uid, ...members], { name: f.get('name').trim(), is_group: true }));
      logActivity('Nová skupina', `„${f.get('name').trim()}“, ${members.length} členov`);
      m.close();
      openWhenReady(ref.id);
    });
  });

  root.querySelector('#all')?.addEventListener('click', () => {
    const m = modal('Hromadná správa všetkým', `<form><p class="muted small">Vytvorí skupinu so všetkými schválenými študentmi (${state.people.size}).</p>
      <label>Názov skupiny</label><input name="name" required value="Oznamy pre všetkých">
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">Vytvoriť</button></div></form>`);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const members = [...new Set([uid, ...state.people.keys()])];
      const groupName = new FormData(e.target).get('name').trim();
      const ref = await addDoc(col('conversations'), newConv(members, { name: groupName, is_group: true }));
      logActivity('Hromadná skupina pre všetkých', `„${groupName}“, ${members.length} členov`);
      m.close();
      openWhenReady(ref.id);
    });
  });

  window.addEventListener('sh:convs', drawList);
  drawList();

  // Príchod z Registra cez tlačidlo „Napísať správu“
  let openDm = null;
  try { openDm = sessionStorage.getItem('sh-open-dm'); sessionStorage.removeItem('sh-open-dm'); } catch {}
  if (openDm && state.people.has(openDm)) guard(() => startDm(openDm));
  return () => {
    window.removeEventListener('sh:convs', drawList);
    unsubMsgs?.();
  };
}
