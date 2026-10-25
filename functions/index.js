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
  const [files] = await getStorage().bucket().getFiles();
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

// ---------------------------------------------------------------- Odkaz pre lektora
// Admin vytvorí odkaz na ZIP so všetkými prácami z predmetu. Lektor ho otvorí bez prihlásenia,
// odkaz platí obmedzený čas a dá sa zrušiť. Po vypršaní sa ZIP z úložiska zmaže.
const { onRequest } = require('firebase-functions/v2/https');
const archiver = require('archiver');
const crypto = require('crypto');

const SHARE_DAYS = 14;
const safe = s => String(s || 'subor').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(0, 80);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const fmtDate = d => d.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava', dateStyle: 'medium', timeStyle: 'short' });

async function requireAdmin(request) {
  const uid = request.auth?.uid;
  const profile = uid ? (await db.doc(`users/${uid}`).get()).data() : null;
  if (!profile?.approved || profile.role !== 'admin') throw new HttpsError('permission-denied', 'Iba pre administrátora');
  return { uid, ...profile };
}

exports.createShareLink = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 540 }, async request => {
  const admin = await requireAdmin(request);
  const subjectId = String(request.data?.subjectId || '');
  const days = Math.min(30, Math.max(1, Number(request.data?.days) || SHARE_DAYS));
  const subject = (await db.doc(`subjects/${subjectId}`).get()).data();
  if (!subject) throw new HttpsError('not-found', 'Predmet neexistuje');
  const subs = (await db.collection('submissions').where('subject_id', '==', subjectId).get()).docs.map(d => d.data());
  if (!subs.length) throw new HttpsError('failed-precondition', 'Z predmetu zatiaľ nie sú odovzdané žiadne práce');
  subs.sort((a, b) => a.student_name.localeCompare(b.student_name, 'sk') || (a.created_at?.toMillis() || 0) - (b.created_at?.toMillis() || 0));

  // Kto neodovzdal – študenti a admini, ktorí zároveň študujú
  const users = (await db.collection('users').where('approved', '==', true).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const students = users.filter(u => (u.role || 'student') === 'student' || (u.role === 'admin' && u.also_student === true));
  const submitted = new Set(subs.map(s => s.student_id));
  const missing = students.filter(s => !submitted.has(s.id)).map(s => s.full_name).sort((a, b) => a.localeCompare(b, 'sk'));

  const token = crypto.randomBytes(24).toString('base64url');
  const bucket = getStorage().bucket();
  const path = `shares/${token}/${safe(subject.name)}.zip`;
  const out = bucket.file(path).createWriteStream({ contentType: 'application/zip', resumable: false });
  const zip = archiver('zip', { zlib: { level: 1 } });
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); zip.on('error', reject); });
  zip.pipe(out);
  const used = new Set();
  for (const r of subs) {
    let name = `${safe(r.student_name)}_${safe(r.file_name)}`;
    for (let i = 2; used.has(name); i++) name = `${safe(r.student_name)}_${i}_${safe(r.file_name)}`;
    used.add(name);
    zip.append(bucket.file(r.file_path).createReadStream(), { name });
  }
  zip.append(`${subject.name}\r\nVytvorené ${fmtDate(new Date())}, prác: ${subs.length}\r\n\r\n` +
    subs.map(r => `${r.student_name}\t${r.title}\t${r.file_name}\t${r.created_at ? fmtDate(r.created_at.toDate()) : ''}`).join('\r\n') +
    (missing.length ? `\r\n\r\nNeodovzdali (${missing.length}):\r\n${missing.join('\r\n')}` : ''), { name: 'zoznam.txt' });
  await zip.finalize();
  await done;
  const [meta] = await bucket.file(path).getMetadata();

  const expires = new Date(Date.now() + days * 864e5);
  await db.doc(`shares/${token}`).set({
    subject_id: subjectId, subject_name: subject.name, lecturer_name: subject.lecturer_name || '',
    path, size: Number(meta.size || 0), count: subs.length, missing: missing.length,
    created_by: admin.uid, created_by_name: admin.full_name || '', created_at: FieldValue.serverTimestamp(),
    expires_at: expires, downloads: 0, revoked: false,
  });
  return { token, expires: expires.toISOString(), count: subs.length, size: Number(meta.size || 0) };
});

// Stránka odkazu: bez parametra dl ukáže prehľad a tlačidlo, s dl=1 pošle ZIP
exports.share = onRequest({ region: REGION, invoker: 'public', memory: '512MiB', timeoutSeconds: 540 }, async (req, res) => {
  const token = String(req.query.t || '');
  const page = (title, body) => res.status(200).set('Cache-Control', 'no-store').send(`<!doctype html><html lang="sk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} – StudentHUB</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f5fb;color:#1b1d27;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:16px;padding:28px;max-width:440px;width:100%;box-sizing:border-box;box-shadow:0 4px 24px #0001}h1{font-size:1.3rem;margin:0 0 .4rem}
.m{color:#6b6f85;font-size:.92rem;line-height:1.5}.b{display:inline-block;margin-top:1.2rem;background:#0b4bd8;color:#fff;text-decoration:none;padding:.8rem 1.3rem;border-radius:10px;font-weight:600}
.l{font-weight:800;letter-spacing:-.02em;margin-bottom:1rem;font-size:1.2rem}.l span{color:#0b4bd8}.f{margin-top:1.4rem;font-size:.78rem;color:#9a9db2}</style></head>
<body><div class="c"><div class="l">Student<span>HUB</span></div>${body}<p class="f">Powered by DigiStart ADV</p></div></body></html>`);
  if (!/^[\w-]{20,64}$/.test(token)) return page('Neplatný odkaz', '<h1>Neplatný odkaz</h1><p class="m">Skontrolujte, či ste skopírovali celý odkaz.</p>');
  const ref = db.doc(`shares/${token}`);
  const s = (await ref.get()).data();
  if (!s || s.revoked) return page('Odkaz bol zrušený', '<h1>Odkaz už neplatí</h1><p class="m">Administrátor ho zrušil. Požiadajte o nový.</p>');
  const expires = s.expires_at.toDate();
  if (expires < new Date()) return page('Platnosť vypršala', `<h1>Platnosť odkazu vypršala</h1><p class="m">Odkaz platil do ${esc(fmtDate(expires))}. Požiadajte administrátora o nový.</p>`);

  if (req.query.dl !== '1') {
    return page(s.subject_name, `<h1>${esc(s.subject_name)}</h1>
      <p class="m">Odovzdané práce študentov: <b>${s.count}</b>${s.missing ? ` · neodovzdali: ${s.missing}` : ''}<br>ZIP ${esc(fmtSize(s.size))} · platí do ${esc(fmtDate(expires))}</p>
      <a class="b" href="?t=${encodeURIComponent(token)}&amp;dl=1">Stiahnuť všetky práce (ZIP)</a>
      <p class="m" style="margin-top:1rem">V archíve je aj súbor zoznam.txt so zoznamom prác a študentov, ktorí neodovzdali.</p>`);
  }
  await ref.update({ downloads: FieldValue.increment(1), last_download_at: FieldValue.serverTimestamp() });
  await db.collection('logs').add({
    uid: 'share', name: s.lecturer_name || 'Lektor (odkaz)', email: '', role: 'lecturer', action: 'Stiahnutie cez odkaz',
    detail: `${s.subject_name} – ${s.count} prác`, device: /mobile/i.test(req.get('user-agent') || '') ? 'mobil' : 'počítač',
    at: FieldValue.serverTimestamp(),
  });
  res.set({
    'Content-Type': 'application/zip', 'Content-Length': String(s.size), 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${s.path.split('/').pop()}"`,
  });
  getStorage().bucket().file(s.path).createReadStream()
    .on('error', e => { console.error(e); res.destroy(e); })
    .pipe(res);
});

// Raz denne zmaže ZIP súbory zrušených a vypršaných odkazov
exports.cleanupShares = onSchedule({ schedule: 'every day 03:30', region: REGION, timeZone: 'Europe/Bratislava' }, async () => {
  const now = new Date();
  const snap = await db.collection('shares').get();
  for (const d of snap.docs) {
    const s = d.data();
    if (s.cleaned || !(s.revoked || s.expires_at.toDate() < now)) continue;
    await getStorage().bucket().file(s.path).delete({ ignoreNotFound: true });
    await d.ref.update({ cleaned: true });
  }
});
