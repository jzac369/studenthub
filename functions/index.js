// StudentHUB – Cloud Function, ktorá raz za hodinu zistí skutočnú spotrebu Firebase
// a uloží ju do dokumentu meta/usage. Administrácia portálu ju zobrazuje v karte Prehľad.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const monitoring = require('@google-cloud/monitoring');

initializeApp();
const db = getFirestore();
const metrics = new monitoring.MetricServiceClient();
const REGION = 'europe-west1';

// Denné limity Firestore sa nulujú o polnoci tichomorského času
function pacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}

// Súčet hodnôt metriky v Cloud Monitoring za zvolené obdobie; null, ak metrika neexistuje
async function sumMetric(type, start, end) {
  try {
    const seconds = Math.max(60, Math.floor((end - start) / 1000));
    const [series] = await metrics.listTimeSeries({
      name: metrics.projectPath(process.env.GCLOUD_PROJECT),
      filter: `metric.type = "${type}"`,
      interval: { startTime: { seconds: Math.floor(start / 1000) }, endTime: { seconds: Math.floor(end / 1000) } },
      aggregation: { alignmentPeriod: { seconds }, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' },
    });
    return series.reduce((sum, ts) => sum + ts.points.reduce((a, p) => a + Number(p.value.int64Value ?? p.value.doubleValue ?? 0), 0), 0);
  } catch (e) {
    console.warn(`Metrika ${type} nie je dostupná:`, e.message);
    return null;
  }
}

// Novšie projekty hlásia *_ops_count, staršie *_count – zoberieme tú, ktorá má údaje
async function firestoreOps(kind, start, end) {
  const values = await Promise.all([
    sumMetric(`firestore.googleapis.com/document/${kind}_ops_count`, start, end),
    sumMetric(`firestore.googleapis.com/document/${kind}_count`, start, end),
  ]);
  return Math.max(0, ...values.filter(v => v != null));
}

async function collectUsage() {
  const now = new Date();
  const dayStart = pacificMidnight(now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Úložisko spočítame priamo zo súborov – presné a bez čakania na dennú metriku
  const [files] = await getStorage().bucket().getFiles({ prefix: 'submissions/' });
  const bytes = files.reduce((a, f) => a + Number(f.metadata.size || 0), 0);

  const [reads, writes, deletes, downloaded] = await Promise.all([
    firestoreOps('read', dayStart, now),
    firestoreOps('write', dayStart, now),
    firestoreOps('delete', dayStart, now),
    sumMetric('storage.googleapis.com/network/sent_bytes_count', monthStart, now),
  ]);

  const usage = {
    updated_at: FieldValue.serverTimestamp(),
    firestore: { reads, writes, deletes, since: dayStart },
    storage: { bytes, files: files.length, downloaded_bytes_month: downloaded ?? 0 },
  };
  await db.doc('meta/usage').set(usage);
  // Zosúladí aj odhad, ktorý portál priebežne upravuje pri nahrávaní a mazaní
  await db.doc('meta/stats').set({ storage_bytes: bytes }, { merge: true });
  return usage;
}

exports.collectUsage = onSchedule({ schedule: 'every 60 minutes', region: REGION, timeZone: 'Europe/Bratislava' }, async () => {
  await collectUsage();
});

// Tlačidlo „Obnoviť teraz“ v administrácii – len pre schválených adminov
exports.refreshUsage = onCall({ region: REGION }, async request => {
  const uid = request.auth?.uid;
  const profile = uid ? (await db.doc(`users/${uid}`).get()).data() : null;
  if (!profile?.approved || profile.role !== 'admin') throw new HttpsError('permission-denied', 'Iba pre administrátora');
  await collectUsage();
  return { ok: true };
});
