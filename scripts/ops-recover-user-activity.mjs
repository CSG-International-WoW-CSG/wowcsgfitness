/**
 * Recover a failed in-app save onto Day N (admin create).
 *
 * Usage:
 *   node scripts/ops-recover-user-activity.mjs --name "Mimoh Ojha" --distanceKm 4.01 --steps 5207 --durationSec 2544 --calories 223 --day 4
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const secretFile = join(root, '.admin-bootstrap-secret.txt');
const API_KEY = 'AIzaSyCX9JCEu6aHqE9EVXiT4Xfi-iA6kmPCLJI';
const PROJECT = 'wow-csg';
const SEASON = 'jul2026-v2';
const WEB_ORIGIN = 'https://csg-international-wow-csg.github.io';
const WEB_REFERER = `${WEB_ORIGIN}/wowcsgfitness/`;

function apiHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Referer: WEB_REFERER,
    Origin: WEB_ORIGIN,
    ...extra
  };
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readSecret() {
  if (!existsSync(secretFile)) return {};
  const out = {};
  for (const line of readFileSync(secretFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(email|password|uid):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('nullValue' in v) out[k] = null;
  }
  return out;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') {
      fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
  }
  return fields;
}

async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

async function listCollection(idToken, collectionId, pageSize = 100) {
  const docs = [];
  let pageToken = null;
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: apiHeaders({ Authorization: `Bearer ${idToken}` }) });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data.error || data));
    for (const d of data.documents || []) {
      docs.push({ id: d.name.split('/').pop(), ...fromFields(d.fields) });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return docs;
}

async function putDoc(idToken, collectionId, docId, payload) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify({ fields: toFields(payload) })
  });
  const data = await res.json();
  if (!res.ok) {
    // fallback patch/create via documents:commit-like PATCH with exists
    const patchUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}/${docId}`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
      body: JSON.stringify({ fields: toFields(payload) })
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(JSON.stringify(data.error || patchData.error || data));
    return patchData;
  }
  return data;
}

async function main() {
  const secret = readSecret();
  const email = arg('email', secret.email);
  const password = arg('password', secret.password);
  const nameNeedle = String(arg('name', 'Mimoh Ojha')).trim().toLowerCase();
  const day = Number(arg('day', '4'));
  const distanceKm = Number(arg('distanceKm', '4.01'));
  const steps = Number(arg('steps', '5207'));
  const durationSec = Number(arg('durationSec', '2544')); // 42:24
  const calories = Number(arg('calories', '223'));
  const dryRun = process.argv.includes('--dry-run');

  if (!email || !password) {
    console.error('Missing admin credentials');
    process.exitCode = 1;
    return;
  }

  const auth = await signIn(email, password);
  console.log('Signed in as', auth.email || email);

  const participants = await listCollection(auth.idToken, 'participants', 80);
  const user = participants.find((p) => {
    const blob = `${p.name || ''} ${p.email || ''} ${p.emailLower || ''} ${p.username || ''}`.toLowerCase();
    return blob.includes(nameNeedle) || /mimoh|ojha/.test(blob);
  });
  if (!user) {
    console.error('Participant not found for', nameNeedle);
    console.error(
      'Sample names:',
      participants.slice(0, 15).map((p) => p.name)
    );
    process.exitCode = 1;
    return;
  }
  console.log('Matched participant:', {
    id: user.id,
    uid: user.uid,
    name: user.name,
    email: user.email
  });

  // Day 4 = 2026-07-29 evening IST
  const dayOffset = Math.max(1, day) - 1;
  const dateIso = new Date(Date.parse('2026-07-26T18:30:00+05:30') + dayOffset * 86400000).toISOString();
  const entryId = `ENTRY_RECOVER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const finishSec = Math.max(1, Math.round(durationSec * (day / Math.max(distanceKm, day))));
  const entry = {
    id: entryId,
    userId: user.employeeId || user.id || 'unknown',
    userUid: user.uid || user.id,
    userName: user.name || 'Mimoh Ojha',
    userEmail: user.email || user.emailLower || '',
    steps,
    distanceKm,
    caloriesBurned: calories,
    durationSec,
    timeToGoalSec: finishSec,
    date: dateIso,
    challengeDay: day,
    status: 'approved',
    validatedBy: 'Admin recovery (failed client save)',
    validatedAt: new Date().toISOString(),
    notes: `Recovered Outdoor GPS activity: ${distanceKm.toFixed(2)} KM / ${steps} steps / ${durationSec}s`,
    source: 'gps-counter',
    trackingMode: 'outdoor',
    season: SEASON
  };

  const feedId = `FEED_RECOVER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const feed = {
    id: feedId,
    entryId,
    userUid: entry.userUid,
    userId: entry.userId,
    userName: entry.userName,
    steps,
    distanceKm,
    caloriesBurned: calories,
    durationSec,
    trackingMode: 'outdoor',
    source: 'gps-counter',
    date: dateIso,
    season: SEASON,
    visible: true
  };

  console.log('Will write entry', entry);
  console.log('Finish time for day goal ~', finishSec, 'sec (', Math.floor(finishSec / 60), 'm', finishSec % 60, 's)');
  if (dryRun) {
    console.log('Dry run only — no writes');
    return;
  }

  await putDoc(auth.idToken, 'stepEntries', entryId, entry);
  console.log('Wrote stepEntries/' + entryId);
  await putDoc(auth.idToken, 'activityFeed', feedId, feed);
  console.log('Wrote activityFeed/' + feedId);
  console.log('Done. Refresh Day', day, 'leaderboard. Winner = shortest legal time (not forced).');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
