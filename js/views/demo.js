// Ukážkoví študenti – iba záznamy v registri (bez prihlasovacích účtov), označené poľom demo: true
import { db, col, doc, query, where, list, writeBatch, serverTimestamp, bump } from '../lib.js';

const MEN = ['Adam', 'Martin', 'Peter', 'Tomáš', 'Jakub', 'Lukáš', 'Michal', 'Filip', 'Matej', 'Samuel', 'Dominik', 'Marek', 'Patrik', 'Juraj', 'Andrej', 'Erik', 'Richard', 'Daniel', 'Oliver', 'Šimon'];
const WOMEN = ['Lucia', 'Zuzana', 'Katarína', 'Michaela', 'Simona', 'Veronika', 'Natália', 'Kristína', 'Ema', 'Nina', 'Barbora', 'Laura', 'Petra', 'Sofia', 'Dominika', 'Viktória', 'Alžbeta', 'Tereza', 'Lenka', 'Hana'];
// [mužský tvar, ženský tvar]
const SURNAMES = [['Novák', 'Nováková'], ['Horváth', 'Horváthová'], ['Kováč', 'Kováčová'], ['Varga', 'Vargová'], ['Tóth', 'Tóthová'], ['Nagy', 'Nagyová'], ['Baláž', 'Balážová'], ['Szabó', 'Szabóová'], ['Molnár', 'Molnárová'], ['Lukáč', 'Lukáčová'], ['Kollár', 'Kollárová'], ['Hudák', 'Hudáková'], ['Krajčí', 'Krajčíová'], ['Polák', 'Poláková'], ['Michalík', 'Michalíková'], ['Oravec', 'Oravcová'], ['Marek', 'Mareková'], ['Hrušovský', 'Hrušovská'], ['Kráľ', 'Kráľová'], ['Benko', 'Benková'], ['Šimko', 'Šimková'], ['Bielik', 'Bieliková'], ['Kučera', 'Kučerová'], ['Gregor', 'Gregorová'], ['Mráz', 'Mrázová']];
const CITIES = ['Bratislava', 'Bratislava', 'Bratislava', 'Košice', 'Košice', 'Žilina', 'Nitra', 'Trnava', 'Banská Bystrica', 'Prešov', 'Trenčín', 'Martin', 'Poprad', 'Piešťany', 'Zvolen', 'Senec', 'Pezinok', 'Komárno', 'Levice', 'Ružomberok'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const phone = () => `+421 9${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10)} ${String(Math.floor(Math.random() * 1000)).padStart(3, '0')} ${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

export async function createDemoStudents(count = 50) {
  const used = new Set();
  const batch = writeBatch(db);
  for (let i = 0; i < count; i++) {
    let first, last;
    do {
      const woman = Math.random() < 0.55;
      first = pick(woman ? WOMEN : MEN);
      last = pick(SURNAMES)[woman ? 1 : 0];
    } while (used.has(first + last));
    used.add(first + last);
    batch.set(doc(col('users')), {
      full_name: `${first} ${last}`,
      email: `${plain(first)}.${plain(last)}@demo.studenthub.sk`,
      phone: phone(),
      city: pick(CITIES),
      role: 'student',
      approved: true,
      demo: true,
      created_at: serverTimestamp(),
    });
  }
  await batch.commit();
  await bump('users');
}

const NOTES = [
  { title: 'Prihlasovanie na skúšky', color: 'yellow', pinned: true,
    body: 'Prihlasovanie na skúšky zimného semestra v AIS sa otvára v utorok 1. 12. o 8:00.\nTermíny budú zverejnené najneskôr do 25. 11.' },
  { title: 'Seminárne práce – Marketing', color: 'pink',
    body: 'Seminárne práce z Marketingu odovzdajte do piatku 13. 11. cez sekciu Moje práce.\nFormát PDF, max. 30 MB, na titulnej strane meno a krúžok.' },
  { title: 'Zmena miestnosti', color: 'blue',
    body: 'Prednáška z Makroekonómie v utorok 27. 10. bude výnimočne v aule A01, nie v B204.' },
  { title: 'Imatrikulácia prvákov', color: 'green',
    body: 'Slávnostná imatrikulácia sa koná vo štvrtok 5. 11. o 10:00 v Aule Magna.\nDress code: formálne oblečenie.' },
  { title: 'Konzultačné hodiny', color: 'purple',
    body: 'doc. Novák – streda 14:00 – 15:30, kancelária B312.\nMimo konzultačných hodín po dohode e-mailom.' },
  { title: 'Knižnica počas skúškového', color: 'orange',
    body: 'Počas skúškového obdobia má knižnica predĺžené otváracie hodiny: pondelok – piatok 8:00 – 20:00, sobota 9:00 – 14:00.' },
];

export async function createDemoAnnouncements(authorId) {
  const batch = writeBatch(db);
  // Rozdielne časy vytvorenia, aby sa oznamy zoradili ako postupne pridávané
  NOTES.forEach((n, i) => batch.set(doc(col('announcements')), {
    ...n, pinned: !!n.pinned, author_id: authorId, demo: true,
    created_at: new Date(Date.now() - (NOTES.length - i) * 864e5),
  }));
  await batch.commit();
  await bump('announcements');
}

async function deleteDemo(name) {
  const demo = await list(query(col(name), where('demo', '==', true)));
  for (let i = 0; i < demo.length; i += 400) {
    const batch = writeBatch(db);
    demo.slice(i, i + 400).forEach(d => batch.delete(doc(db, name, d.id)));
    await batch.commit();
  }
  if (demo.length) await bump(name);
  return demo.length;
}

export async function deleteDemoData() {
  const [users, notes] = await Promise.all([deleteDemo('users'), deleteDemo('announcements')]);
  return { users, notes };
}
