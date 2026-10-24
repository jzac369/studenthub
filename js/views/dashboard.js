import { state, col, query, where, list, cached, esc, fmtDate, feature, icon, today, unreadCount } from '../lib.js';
import { lessonCard, runsThisWeek, sortLessons } from './schedule.js';
import { mountBoard } from './board.js';

// Domov: vľavo osobný prehľad, vpravo celá nástenka so sticky notes
export default async function (root) {
  const uid = state.user.uid;
  const day = today();
  const [assignments, subs, schedule] = await Promise.all([
    cached('assignments'),
    feature('uploads_enabled') ? list(query(col('submissions'), where('student_id', '==', uid))) : [],
    cached('schedule'),
  ]);
  const upcoming = assignments.filter(a => a.due_date && a.due_date >= day)
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const todays = schedule.filter(l => l.day === new Date().getDay() && runsThisWeek(l)).sort(sortLessons);
  const unreadN = state.convs.reduce((sum, c) => sum + unreadCount(c), 0);
  const firstName = state.profile.full_name.split(' ')[0] || '';
  const daysLeft = d => Math.round((new Date(d) - new Date(day)) / 864e5);
  const tile = (href, ic, label, value, sub) => `<a class="card tile" href="${href}"><div class="tile-ic">${icon(ic, 20)}</div>
    <div><div class="muted small">${label}</div><div class="stat">${value}</div><div class="small muted">${sub}</div></div></a>`;

  root.innerHTML = `<div class="home">
    <aside class="home-side">
      <h1>Ahoj, ${esc(firstName)}</h1>
      ${feature('messaging_enabled') ? tile('#/spravy', 'message', 'Neprečítané správy', unreadN, unreadN ? 'otvoriť správy' : 'všetko prečítané') : ''}
      ${feature('uploads_enabled') ? tile('#/prace', 'file', 'Moje odovzdané práce', subs.length, `${subs.filter(s => s.status === 'forwarded').length} odoslaných lektorovi`) : ''}
      <div class="card"><h2>${icon('calendar')} Dnes</h2>
        ${todays.length ? todays.map(l => lessonCard(l)).join('') : '<p class="muted">Dnes nemáš žiadne hodiny.</p>'}
        <a href="#/rozvrh" class="small">Celý rozvrh</a>
      </div>
      <div class="card"><h2>${icon('clock')} Termíny</h2>
        ${upcoming.length ? `<table>${upcoming.map(a => {
          const d = daysLeft(a.due_date);
          return `<tr><td><strong>${esc(a.title)}</strong><div class="muted small">${esc(a.subject_name || '')}</div></td>
            <td style="text-align:right">${fmtDate(a.due_date)}<br><span class="badge ${d <= 3 ? 'err' : d <= 7 ? 'warn' : ''}">${d === 0 ? 'dnes' : `o ${d} d.`}</span></td></tr>`;
        }).join('')}</table>` : '<p class="muted">Žiadne nadchádzajúce termíny.</p>'}
      </div>
    </aside>
    <section class="home-board" id="board"></section>
  </div>`;

  await mountBoard(root.querySelector('#board'));
}
