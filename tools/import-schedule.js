// Zapíše rozvrh zo súboru JSON do Firestore (spúšťa sa v Google Cloud Shell, používa tamojšie prihlásenie).
// Pri opakovanom spustení najprv zmaže hodiny z rovnakého súboru, takže nevznikajú duplicity.
// Použitie: node tools/import-schedule.js tools/rozvrh-zs-2026.json
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const { title, lessons } = JSON.parse(fs.readFileSync(file, 'utf8'));
const source = path.basename(file, '.json');
const isoDay = d => new Date(d + 'T12:00:00Z').getUTCDay() || 7;

initializeApp({ projectId: 'studenthub-bc04b' });
const db = getFirestore();

(async () => {
  const old = await db.collection('schedule').where('source', '==', source).get();
  const batch = db.batch();
  old.docs.forEach(d => batch.delete(d.ref));
  for (const l of lessons) {
    batch.set(db.collection('schedule').doc(), {
      subject: l.subject, type: l.type || 'lecture', date: l.date, day: isoDay(l.date), week: 'all',
      start: l.start || '', end: l.end || '', room: l.room || '', teacher: l.teacher || '', group: l.group || '', note: l.note || '',
      source,
    });
  }
  if (title) batch.set(db.doc('settings/app'), { schedule_title: title }, { merge: true });
  batch.set(db.doc('meta/versions'), { schedule: FieldValue.serverTimestamp(), settings: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  console.log(`Hotovo: zmazaných ${old.size}, zapísaných ${lessons.length} hodín (${source}).`);
})().catch(e => { console.error(e.message); process.exit(1); });
