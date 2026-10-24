// Ukážkoví študenti – iba záznamy v registri (bez prihlasovacích účtov), označené poľom demo: true
import { db, state, col, doc, query, where, list, cached, writeBatch, serverTimestamp, bump, uploadFile, removeFile } from '../lib.js';

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

// Ukážkové študijné materiály: 3 malé textové súbory a 2 odkazy na verejné zdroje
const MATERIALS = [
  { title: 'Poznámky z prednášok – Makroekonómia (1.–6. týždeň)', subject: 'Makroekonómia', description: 'HDP, inflácia, nezamestnanosť, fiškálna politika – stručne a prehľadne.',
    file: 'makroekonomia_poznamky.txt', text: 'MAKROEKONÓMIA – POZNÁMKY (ukážka)\n\n1. HDP: trhová hodnota finálnych statkov a služieb vyrobených v krajine za obdobie.\n2. Inflácia: rast cenovej hladiny, meria sa indexom spotrebiteľských cien.\n3. Nezamestnanosť: frikčná, štrukturálna, cyklická.\n4. Fiškálna politika: štátny rozpočet, dane, verejné výdavky.\n' },
  { title: 'Vzorové otázky na skúšku z Marketingu', subject: 'Marketing', description: '30 otázok z minulých rokov aj s odpoveďami.',
    file: 'marketing_vzorove_otazky.txt', text: 'MARKETING – VZOROVÉ OTÁZKY (ukážka)\n\n1. Vymenujte prvky marketingového mixu 4P.\n2. Čo je segmentácia trhu a podľa akých kritérií sa robí?\n3. Vysvetlite rozdiel medzi B2B a B2C marketingom.\n4. Čo je SWOT analýza?\n' },
  { title: 'Vzorce do štatistiky – ťahák', subject: '', description: 'Priemer, rozptyl, smerodajná odchýlka, korelácia na jednej strane.',
    file: 'statistika_vzorce.txt', text: 'ŠTATISTIKA – VZORCE (ukážka)\n\nAritmetický priemer: x̄ = Σx / n\nRozptyl: s² = Σ(x − x̄)² / (n − 1)\nSmerodajná odchýlka: s = √s²\nKorelačný koeficient: r = cov(x, y) / (sx · sy)\n' },
  { title: 'Národná banka Slovenska – menová politika', subject: 'Makroekonómia', description: 'Oficiálne vysvetlenie menovej politiky eurozóny a úlohy NBS.',
    url: 'https://nbs.sk/menova-politika/' },
  { title: 'Štatistický úrad SR – aktuálne údaje', subject: '', description: 'Zdroj dát na seminárne práce: HDP, nezamestnanosť, ceny.',
    url: 'https://slovak.statistics.sk/' },
];

// Ukážkové inzeráty v Burze kníh a skrípt
const LISTINGS = [
  { kind: 'sell', title: 'Marketing management', author: 'Philip Kotler, Kevin Lane Keller', price: 18, condition: 'ako nové', subject: 'Marketing', description: 'Slovenské vydanie, bez poznámok. Osobný odber v škole.' },
  { kind: 'give', title: 'Skriptá: Úvod do štatistiky', author: 'Katedra štatistiky', price: 0, condition: 's poznámkami', subject: '', description: 'Daruje sa, vyznačené dôležité pasáže.' },
  { kind: 'sell', title: 'Zásady ekonómie', author: 'N. Gregory Mankiw', price: 22, condition: 'používané', subject: 'Makroekonómia', description: 'Kniha je v dobrom stave, obálka mierne ohnutá.' },
  { kind: 'want', title: 'Podnikové financie', author: 'Fetisovová a kol.', price: 0, condition: '', subject: '', description: 'Hľadám na zimný semester, môžem aj požičať.' },
  { kind: 'sell', title: 'Zbierka príkladov z matematiky pre ekonómov', author: '', price: 6, condition: 's poznámkami', subject: '', description: 'Vyriešené príklady ceruzkou, dá sa vygumovať.' },
];

export async function createDemoMaterials() {
  const me = state.user.uid;
  const subjects = await cached('subjects');
  const subject = name => subjects.find(s => s.name === name) || null;
  // Inzeráty rozdelíme medzi ukážkových študentov, ak existujú
  const demoUsers = (await cached('users')).filter(u => u.demo);
  const seller = i => demoUsers[i % Math.max(1, demoUsers.length)] || { id: me, full_name: state.profile.full_name };

  const batch = writeBatch(db);
  for (const [i, m] of MATERIALS.entries()) {
    const s = subject(m.subject);
    const author = demoUsers[(i + 2) % Math.max(1, demoUsers.length)] || { id: me, full_name: state.profile.full_name };
    const row = {
      title: m.title, description: m.description, subject_id: s?.id || '', subject_name: s?.name || m.subject,
      uploader_id: me, uploader_name: author.full_name, status: 'approved', demo: true,
      created_at: new Date(Date.now() - (MATERIALS.length - i) * 864e5),
      url: m.url || '', file_path: '', file_name: '', file_size: 0,
    };
    if (m.file) {
      const blob = new Blob([m.text], { type: 'text/plain;charset=utf-8' });
      row.file_path = `materials/${me}/demo_${Date.now()}_${m.file}`;
      await uploadFile(row.file_path, new File([blob], m.file, { type: 'text/plain' }));
      Object.assign(row, { file_name: m.file, file_size: blob.size });
    }
    batch.set(doc(col('materials')), row);
  }
  LISTINGS.forEach((l, i) => {
    const s = subject(l.subject);
    const who = seller(i);
    batch.set(doc(col('market')), {
      kind: l.kind, title: l.title, author: l.author, description: l.description, price: l.price, condition: l.condition,
      subject_id: s?.id || '', subject_name: s?.name || l.subject, seller_id: who.id, seller_name: who.full_name,
      status: 'active', demo: true, created_at: new Date(Date.now() - (LISTINGS.length - i) * 36e5),
    });
  });
  await batch.commit();
  await bump('materials');
}

export async function deleteDemoData() {
  const files = (await list(query(col('materials'), where('demo', '==', true)))).filter(m => m.file_path);
  await Promise.all(files.map(m => removeFile(m.file_path).catch(() => {})));
  const [users, notes, materials, market] = await Promise.all([
    deleteDemo('users'), deleteDemo('announcements'), deleteDemo('materials'), deleteDemo('market'),
  ]);
  return { users, notes, materials, market };
}
