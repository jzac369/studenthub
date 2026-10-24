import { db, col, doc, addDoc, updateDoc, deleteDoc, cached, bump, esc, guard, toast, modal, icon, isAdmin } from '../lib.js';

export const DAYS = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
export const TYPES = { lecture: 'Prednáška', seminar: 'Seminár', lab: 'Cvičenie', other: 'Iné' };
const WEEKS = { all: 'Každý týždeň', odd: 'Nepárny týždeň', even: 'Párny týždeň' };

// ISO číslo týždňa – pre striedanie párnych a nepárnych týždňov
export function weekNumber(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
export const runsThisWeek = l => l.week === 'all' || !l.week || (l.week === 'even') === (weekNumber() % 2 === 0);
export const sortLessons = (a, b) => a.day - b.day || a.start.localeCompare(b.start);

export function lessonCard(l, { tools = false, now = false } = {}) {
  return `<div class="lesson t-${TYPES[l.type] ? l.type : 'other'} ${now ? 'now' : ''}">
    <div class="time">${esc(l.start)} – ${esc(l.end)}${l.week && l.week !== 'all' ? ` · ${l.week === 'odd' ? 'nepárny' : 'párny'} týž.` : ''}</div>
    <div class="subj">${esc(l.subject)}</div>
    <div class="info"><span>${esc(TYPES[l.type] || 'Iné')}</span>
      ${l.room ? `<span>${icon('home', 12)}${esc(l.room)}</span>` : ''}
      ${l.teacher ? `<span>${icon('user', 12)}${esc(l.teacher)}</span>` : ''}
      ${l.group ? `<span>${icon('users', 12)}${esc(l.group)}</span>` : ''}</div>
    ${tools ? `<div class="tools"><button class="icon-btn" data-edit="${l.id}" title="Upraviť">${icon('edit', 14)}</button><button class="icon-btn" data-del="${l.id}" title="Zmazať">${icon('trash', 14)}</button></div>` : ''}
  </div>`;
}

export default async function (root) {
  let group = '';
  try { group = localStorage.getItem('sh-group') || ''; } catch {}

  async function render() {
    const lessons = (await cached('schedule')).sort(sortLessons);
    const groups = [...new Set(lessons.map(l => l.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sk'));
    if (group && !groups.includes(group)) group = '';
    const shown = lessons.filter(l => !group || !l.group || l.group === group);
    const days = shown.some(l => l.day === 6) ? 6 : 5;
    const now = new Date();
    const todayIdx = now.getDay(); // 1 = pondelok
    const hm = now.toTimeString().slice(0, 5);

    root.innerHTML = `<div class="title-row"><h1>${icon('calendar', 24)} Rozvrh</h1>
      <span class="badge pri">${weekNumber() % 2 ? 'nepárny' : 'párny'} týždeň (${weekNumber()}.)</span><span class="spacer"></span>
      ${groups.length ? `<select id="grp" style="max-width:200px"><option value="">Všetky krúžky</option>${groups.map(g => `<option ${g === group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}
      ${isAdmin() ? `<button class="btn" id="add">${icon('plus', 16)} Pridať hodinu</button>` : ''}</div>
      <div class="legend" style="margin-bottom:.9rem">${Object.entries(TYPES).map(([k, v]) => `<span class="t-${k}"><i></i>${v}</span>`).join('')}</div>
      <div class="week" style="--days:${days}">${DAYS.slice(0, days).map((d, i) => {
        const items = shown.filter(l => l.day === i + 1);
        return `<section class="day ${todayIdx === i + 1 ? 'today' : ''}"><h3>${d}${todayIdx === i + 1 ? '<span class="spacer"></span><span class="badge pri">dnes</span>' : ''}</h3>
          ${items.map(l => lessonCard(l, { tools: isAdmin(), now: todayIdx === i + 1 && runsThisWeek(l) && l.start <= hm && hm < l.end })).join('') || '<p class="muted small" style="margin:.2rem">Voľno</p>'}</section>`;
      }).join('')}</div>
      ${lessons.length ? '' : `<p class="muted">Rozvrh zatiaľ nie je zadaný.${isAdmin() ? ' Pridaj prvú hodinu tlačidlom vyššie.' : ''}</p>`}`;

    root.querySelector('#grp')?.addEventListener('change', e => {
      group = e.target.value;
      try { localStorage.setItem('sh-group', group); } catch {}
      render();
    });
    root.querySelector('#add')?.addEventListener('click', () => edit());
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(lessons.find(l => l.id === b.dataset.edit)));
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
      if (!confirm('Zmazať túto hodinu z rozvrhu?')) return;
      await deleteDoc(doc(db, 'schedule', b.dataset.del));
      await bump('schedule');
      render();
    }));
  }

  function edit(l = { day: 1, start: '08:00', end: '09:30', subject: '', type: 'lecture', room: '', teacher: '', group: '', week: 'all' }) {
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${v}</option>`).join('');
    const m = modal(l.id ? 'Upraviť hodinu' : 'Nová hodina v rozvrhu', `<form>
      <label>Predmet</label><input name="subject" required maxlength="80" value="${esc(l.subject)}">
      <div class="row nowrap">
        <div class="grow"><label>Deň</label><select name="day">${opt(Object.fromEntries(DAYS.map((d, i) => [i + 1, d])), l.day)}</select></div>
        <div class="grow"><label>Od</label><input name="start" type="time" required value="${esc(l.start)}"></div>
        <div class="grow"><label>Do</label><input name="end" type="time" required value="${esc(l.end)}"></div>
      </div>
      <div class="row nowrap">
        <div class="grow"><label>Typ</label><select name="type">${opt(TYPES, l.type)}</select></div>
        <div class="grow"><label>Opakovanie</label><select name="week">${opt(WEEKS, l.week || 'all')}</select></div>
      </div>
      <div class="row nowrap">
        <div class="grow"><label>Miestnosť</label><input name="room" maxlength="30" value="${esc(l.room)}"></div>
        <div class="grow"><label>Krúžok / skupina</label><input name="group" maxlength="30" placeholder="prázdne = všetci" value="${esc(l.group)}"></div>
      </div>
      <label>Vyučujúci</label><input name="teacher" maxlength="80" value="${esc(l.teacher)}">
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('check', 16)} Uložiť</button></div></form>`);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.end <= f.start) throw new Error('Koniec hodiny musí byť po začiatku');
      const row = { ...f, day: Number(f.day), subject: f.subject.trim(), room: f.room.trim(), teacher: f.teacher.trim(), group: f.group.trim() };
      if (l.id) await updateDoc(doc(db, 'schedule', l.id), row);
      else await addDoc(col('schedule'), row);
      await bump('schedule');
      m.close();
      toast('Rozvrh uložený');
      render();
    });
  }

  await render();
}
