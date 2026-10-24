import { state, col, query, where, list, cached, esc, fmtDate, feature, icon, today, isUnread, toDate } from '../lib.js';
import { lessonCard, runsThisWeek, sortLessons } from './schedule.js';

export default async function (root) {
  const uid = state.user.uid;
  const day = today();
  const [ann, assignments, subs, schedule] = await Promise.all([
    cached('announcements'),
    cached('assignments'),
    feature('uploads_enabled') ? list(query(col('submissions'), where('student_id', '==', uid))) : [],
    cached('schedule'),
  ]);
  const due = assignments.filter(a => a.due_date && a.due_date >= day);
  const lessons = schedule.filter(l => l.day === new Date().getDay());

  const latest = ann.sort((a, b) => (!!b.pinned - !!a.pinned) || (toDate(b.created_at) - toDate(a.created_at))).slice(0, 3);
  const upcoming = due.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
  const todays = lessons.filter(runsThisWeek).sort(sortLessons);
  const unreadN = state.convs.filter(isUnread).length;
  const firstName = state.profile.full_name.split(' ')[0] || '';
  const daysLeft = d => Math.round((new Date(d) - new Date(day)) / 864e5);
  const tile = (href, ic, label, value, sub) => `<a class="card tile" href="${href}"><div class="tile-ic">${icon(ic, 20)}</div>
    <div><div class="muted small">${label}</div><div class="stat">${value}</div><div class="small muted">${sub}</div></div></a>`;

  root.innerHTML = `<h1>Ahoj, ${esc(firstName)}</h1>
  <div class="grid">
    ${feature('uploads_enabled') ? tile('#/prace', 'file', 'Moje odovzdané práce', subs.length, `${subs.filter(s => s.status === 'forwarded').length} odoslaných lektorovi`) : ''}
    ${feature('messaging_enabled') ? tile('#/spravy', 'message', 'Neprečítané konverzácie', unreadN, 'otvoriť správy') : ''}
    ${tile('#/rozvrh', 'calendar', 'Dnes v rozvrhu', todays.length, todays.length ? `prvá o ${esc(todays[0].start)}` : 'dnes voľno')}
  </div>
  <div class="grid" style="margin-top:1rem">
    <div class="card"><h2>${icon('calendar')} Dnešné hodiny</h2>
      ${todays.length ? todays.map(l => lessonCard(l)).join('') : '<p class="muted">Dnes nemáš žiadne hodiny.</p>'}
      <a href="#/rozvrh" class="small">Celý rozvrh</a>
    </div>
    <div class="card"><h2>${icon('clock')} Najbližšie termíny</h2>
      ${upcoming.length ? `<table>${upcoming.map(a => {
        const d = daysLeft(a.due_date);
        return `<tr><td><strong>${esc(a.title)}</strong><div class="muted small">${esc(a.subject_name || '')}</div></td>
          <td style="text-align:right">${fmtDate(a.due_date)}<br><span class="badge ${d <= 3 ? 'err' : d <= 7 ? 'warn' : ''}">${d === 0 ? 'dnes' : `o ${d} d.`}</span></td></tr>`;
      }).join('')}</table>` : '<p class="muted">Žiadne nadchádzajúce termíny.</p>'}
    </div>
    <div class="card"><h2>${icon('pin')} Najnovšie na nástenke</h2>
      ${latest.length ? latest.map(a => `<div style="margin-bottom:.75rem"><strong>${esc(a.title)}</strong> <span class="muted small">${fmtDate(a.created_at)}</span>
        <div class="small" style="white-space:pre-wrap">${esc(a.body.slice(0, 180))}${a.body.length > 180 ? '…' : ''}</div></div>`).join('') : '<p class="muted">Zatiaľ žiadne oznamy.</p>'}
      <a href="#/nastenka" class="small">Celá nástenka</a>
    </div>
  </div>`;
}
