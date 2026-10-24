import {
  db, state, col, doc, addDoc, updateDoc, deleteDoc, setDoc, cached, bump, loadSettings, logActivity, esc, guard, toast, modal, icon, isAdmin, today,
} from '../lib.js';

export const DAYS = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota', 'Nedeľa'];
export const TYPES = { lecture: 'Prednáška', seminar: 'Seminár', lab: 'Cvičenie', other: 'Iné' };
const WEEKS = { all: 'Každý týždeň', odd: 'Nepárny týždeň', even: 'Párny týždeň' };
const SHORT_DAYS = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];

// Hodina je buď týždenná (pole day 1–7), alebo na konkrétny dátum (pole date RRRR-MM-DD) – externé štúdium
export const isDated = l => !!l.date;

// ISO číslo týždňa – pre striedanie párnych a nepárnych týždňov
export function weekNumber(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
export const runsThisWeek = l => l.week === 'all' || !l.week || (l.week === 'even') === (weekNumber() % 2 === 0);
export const sortLessons = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.day || 0) - (b.day || 0) || (a.start || '').localeCompare(b.start || '');
const isoDay = d => (new Date(d).getDay() || 7);

// Hodiny na dnešok: týždenné podľa dňa v týždni a datované podľa dátumu
export function lessonsOn(lessons, iso = today()) {
  const dow = isoDay(iso);
  return lessons.filter(l => (isDated(l) ? l.date === iso : l.day === dow && runsThisWeek(l))).sort(sortLessons);
}
export const nextDated = (lessons, iso = today()) => lessons.filter(l => isDated(l) && l.date > iso).sort(sortLessons);

export function fmtLessonDate(iso, withYear = true) {
  const d = new Date(iso + 'T12:00:00');
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.${withYear ? ` ${d.getFullYear()}` : ''}`;
}

export function lessonCard(l, { tools = false, now = false, showDate = false } = {}) {
  const time = l.start ? `${esc(l.start)}${l.end ? ` – ${esc(l.end)}` : ''}` : esc(l.note || 'celý deň');
  return `<div class="lesson t-${TYPES[l.type] ? l.type : 'other'} ${now ? 'now' : ''}">
    <div class="time">${showDate && l.date ? `${fmtLessonDate(l.date)} · ` : ''}${time}${l.week && l.week !== 'all' && !l.date ? ` · ${l.week === 'odd' ? 'nepárny' : 'párny'} týž.` : ''}</div>
    <div class="subj">${esc(l.subject)}</div>
    <div class="info"><span>${esc(TYPES[l.type] || 'Iné')}</span>
      ${l.room ? `<span>${icon(/online/i.test(l.room) ? 'external' : 'home', 12)}${esc(l.room)}</span>` : ''}
      ${l.teacher ? `<span>${icon('user', 12)}${esc(l.teacher)}</span>` : ''}
      ${l.group ? `<span>${icon('users', 12)}${esc(l.group)}</span>` : ''}</div>
    ${tools ? `<div class="tools"><button class="icon-btn" data-edit="${l.id}" title="Upraviť">${icon('edit', 14)}</button><button class="icon-btn" data-del="${l.id}" title="Zmazať">${icon('trash', 14)}</button></div>` : ''}
  </div>`;
}

const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];

export default async function (root) {
  let group = '';
  let showPast = false;
  try { group = localStorage.getItem('sh-group') || ''; } catch {}

  async function render() {
    const lessons = (await cached('schedule')).sort(sortLessons);
    const groups = [...new Set(lessons.map(l => l.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sk'));
    if (group && !groups.includes(group)) group = '';
    const shown = lessons.filter(l => !group || !l.group || l.group === group);
    const weekly = shown.filter(l => !isDated(l));
    const dated = shown.filter(isDated);
    const iso = today();
    const now = new Date();
    const hm = now.toTimeString().slice(0, 5);
    const todayIdx = now.getDay() || 7;
    const title = state.settings.schedule_title || '';
    const tools = isAdmin();

    // Datované hodiny zoskupené podľa dňa a mesiaca; minulé sú zbalené
    const upcoming = dated.filter(l => l.date >= iso);
    const past = dated.filter(l => l.date < iso);
    const nextDate = upcoming[0]?.date;
    const byDate = list => {
      let html = '', month = '';
      const dates = [...new Set(list.map(l => l.date))];
      for (const d of dates) {
        const m = d.slice(0, 7);
        if (m !== month) { month = m; html += `<h3 class="month">${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</h3>`; }
        const items = list.filter(l => l.date === d);
        const isToday = d === iso;
        html += `<section class="dated ${isToday ? 'today' : ''} ${d === nextDate && !isToday ? 'next' : ''} ${d < iso ? 'past' : ''}">
          <div class="dated-day"><strong>${fmtLessonDate(d, false)}</strong>${isToday ? '<span class="badge pri">dnes</span>' : d === nextDate ? '<span class="badge ok">najbližšie</span>' : ''}</div>
          <div class="dated-items">${items.map(l => lessonCard(l, { tools, now: isToday && l.start <= hm && hm < l.end })).join('')}</div></section>`;
      }
      return html;
    };

    root.innerHTML = `<div class="title-row"><h1>${icon('calendar', 24)} Rozvrh</h1>
      ${weekly.length ? `<span class="badge pri">${weekNumber() % 2 ? 'nepárny' : 'párny'} týždeň (${weekNumber()}.)</span>` : ''}<span class="spacer"></span>
      ${groups.length ? `<select id="grp" style="max-width:200px"><option value="">Všetky krúžky</option>${groups.map(g => `<option ${g === group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}
      ${tools ? `<button class="btn ghost" id="title">${icon('edit', 16)} Nadpis</button><button class="btn" id="add">${icon('plus', 16)} Pridať hodinu</button>` : ''}</div>
      ${title ? `<p class="schedule-title">${esc(title)}</p>` : ''}
      <div class="legend" style="margin-bottom:.9rem">${Object.entries(TYPES).map(([k, v]) => `<span class="t-${k}"><i></i>${v}</span>`).join('')}</div>
      ${dated.length ? `<div class="card dated-list">
        ${upcoming.length ? byDate(upcoming) : '<p class="muted">Všetky termíny výučby už prebehli.</p>'}
        ${past.length ? `<button class="btn ghost sm" id="past" style="margin-top:.75rem">${showPast ? 'Skryť' : 'Zobraziť'} minulé termíny (${past.length})</button>
          ${showPast ? `<div style="margin-top:.5rem">${byDate(past)}</div>` : ''}` : ''}
      </div>` : ''}
      ${weekly.length ? `<div class="week" style="--days:${weekly.some(l => l.day >= 6) ? 6 : 5}">${DAYS.slice(0, weekly.some(l => l.day >= 6) ? 6 : 5).map((d, i) => {
        const items = weekly.filter(l => l.day === i + 1);
        return `<section class="day ${todayIdx === i + 1 ? 'today' : ''}"><h3>${d}${todayIdx === i + 1 ? '<span class="spacer"></span><span class="badge pri">dnes</span>' : ''}</h3>
          ${items.map(l => lessonCard(l, { tools, now: todayIdx === i + 1 && runsThisWeek(l) && l.start <= hm && hm < l.end })).join('') || '<p class="muted small" style="margin:.2rem">Voľno</p>'}</section>`;
      }).join('')}</div>` : ''}
      ${lessons.length ? '' : `<p class="muted">Rozvrh zatiaľ nie je zadaný.${tools ? ' Pridaj prvú hodinu tlačidlom vyššie.' : ''}</p>`}`;

    root.querySelector('#grp')?.addEventListener('change', e => {
      group = e.target.value;
      try { localStorage.setItem('sh-group', group); } catch {}
      render();
    });
    root.querySelector('#past')?.addEventListener('click', () => { showPast = !showPast; render(); });
    root.querySelector('#add')?.addEventListener('click', () => edit());
    root.querySelector('#title')?.addEventListener('click', () => editTitle());
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(lessons.find(l => l.id === b.dataset.edit)));
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(async () => {
      if (!confirm('Zmazať túto hodinu z rozvrhu?')) return;
      await deleteDoc(doc(db, 'schedule', b.dataset.del));
      const gone = lessons.find(l => l.id === b.dataset.del);
      logActivity('Rozvrh: hodina zmazaná', gone ? `${gone.subject}, ${gone.date ? fmtLessonDate(gone.date) : DAYS[gone.day - 1]} ${gone.start || ''}` : '');
      await bump('schedule');
      render();
    }));
  }

  function editTitle() {
    const m = modal('Nadpis rozvrhu', `<form><label>Nadpis (napr. semester, odbor, ročník)</label>
      <input name="title" maxlength="140" value="${esc(state.settings.schedule_title || '')}" placeholder="Rozvrh ZS 2026/2027 – …">
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('check', 16)} Uložiť</button></div></form>`);
    m.el.querySelector('form').onsubmit = e => guard(async () => {
      e.preventDefault();
      const title = new FormData(e.target).get('title').trim();
      await setDoc(doc(db, 'settings', 'app'), { schedule_title: title }, { merge: true });
      await bump('settings');
      await loadSettings();
      logActivity('Rozvrh: nadpis', title);
      m.close();
      render();
    });
  }

  function edit(l = { date: '', day: 1, start: '08:00', end: '09:30', subject: '', type: 'lecture', room: '', teacher: '', group: '', week: 'all' }) {
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${v}</option>`).join('');
    const mode = l.id ? (isDated(l) ? 'date' : 'week') : 'date';
    const m = modal(l.id ? 'Upraviť hodinu' : 'Nová hodina v rozvrhu', `<form>
      <label>Predmet</label><input name="subject" required maxlength="80" value="${esc(l.subject)}">
      <label>Kedy</label>
      <div class="row"><label class="check" style="margin:0"><input type="radio" name="mode" value="date" ${mode === 'date' ? 'checked' : ''}> Konkrétny dátum</label>
        <label class="check" style="margin:0"><input type="radio" name="mode" value="week" ${mode === 'week' ? 'checked' : ''}> Každý týždeň</label></div>
      <div class="row nowrap">
        <div class="grow" data-mode="date"><label>Dátum</label><input name="date" type="date" value="${esc(l.date || '')}"></div>
        <div class="grow" data-mode="week"><label>Deň</label><select name="day">${opt(Object.fromEntries(DAYS.map((d, i) => [i + 1, d])), l.day || 1)}</select></div>
        <div class="grow"><label>Od</label><input name="start" type="time" value="${esc(l.start)}"></div>
        <div class="grow"><label>Do</label><input name="end" type="time" value="${esc(l.end)}"></div>
      </div>
      <div class="row nowrap">
        <div class="grow"><label>Typ</label><select name="type">${opt(TYPES, l.type)}</select></div>
        <div class="grow" data-mode="week"><label>Opakovanie</label><select name="week">${opt(WEEKS, l.week || 'all')}</select></div>
      </div>
      <div class="row nowrap">
        <div class="grow"><label>Miestnosť / online</label><input name="room" maxlength="40" value="${esc(l.room)}"></div>
        <div class="grow"><label>Krúžok / skupina</label><input name="group" maxlength="30" placeholder="prázdne = všetci" value="${esc(l.group)}"></div>
      </div>
      <label>Vyučujúci</label><input name="teacher" maxlength="100" value="${esc(l.teacher)}">
      <label>Poznámka (nepovinné)</label><input name="note" maxlength="100" value="${esc(l.note || '')}" placeholder="napr. do 15. 10. 2026">
      <div class="actions"><button type="button" class="btn ghost" data-close>Zrušiť</button><button class="btn">${icon('check', 16)} Uložiť</button></div></form>`);
    const form = m.el.querySelector('form');
    const sync = () => {
      const md = form.elements.mode.value;
      form.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('hidden', el.dataset.mode !== md));
    };
    form.querySelectorAll('[name=mode]').forEach(r => (r.onchange = sync));
    sync();
    form.onsubmit = e => guard(async () => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const dated = f.mode === 'date';
      if (dated && !f.date) throw new Error('Vyber dátum');
      if (!dated && (!f.start || !f.end)) throw new Error('Zadaj čas od – do');
      if (f.start && f.end && f.end <= f.start) throw new Error('Koniec hodiny musí byť po začiatku');
      const row = {
        subject: f.subject.trim(), type: f.type, start: f.start, end: f.end, room: f.room.trim(), teacher: f.teacher.trim(),
        group: f.group.trim(), note: f.note.trim(),
        ...(dated ? { date: f.date, day: isoDay(f.date), week: 'all' } : { date: '', day: Number(f.day), week: f.week }),
      };
      if (l.id) await updateDoc(doc(db, 'schedule', l.id), row);
      else await addDoc(col('schedule'), row);
      await bump('schedule');
      m.close();
      logActivity(l.id ? 'Rozvrh: hodina upravená' : 'Rozvrh: nová hodina', `${row.subject}, ${dated ? fmtLessonDate(row.date) : DAYS[row.day - 1]} ${row.start}–${row.end}`);
      toast('Rozvrh uložený');
      render();
    });
  }

  await render();
}
