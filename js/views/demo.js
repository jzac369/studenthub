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

export async function deleteDemoStudents() {
  const demo = await list(query(col('users'), where('demo', '==', true)));
  for (let i = 0; i < demo.length; i += 400) {
    const batch = writeBatch(db);
    demo.slice(i, i + 400).forEach(u => batch.delete(doc(db, 'users', u.id)));
    await batch.commit();
  }
  await bump('users');
  return demo.length;
}
