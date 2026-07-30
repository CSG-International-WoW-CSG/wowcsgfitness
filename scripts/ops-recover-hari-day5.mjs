/**
 * Recover Harischandra Achari Day 5 activity without listing all participants
 * (works better under Firestore quota pressure).
 *
 * Usage:
 *   node scripts/ops-recover-hari-day5.mjs
 *   node scripts/ops-recover-hari-day5.mjs --password "ADMIN_PASSWORD"
 *   node scripts/ops-recover-hari-day5.mjs --dry-run
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

const HARI = {
  name: 'harischandra achari',
  email: 'harischandra.achari@csgi.com',
  employeeId: 'USER_1785330324518',
  username: 'harischandra.achari',
  distanceKm: 5.15,
  steps: 6695,
  durationSec: 1590, // 26:30
  calories: 326,
  day: 5
};

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

async function putDoc(idToken, collectionId, docId, payload) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify({ fields: toFields(payload) })
  });
  const data = await res.json();
  if (!res.ok) {
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

async function lookupParticipantUid(idToken, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'participants' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'emailLower' },
          op: 'EQUAL',
          value: { stringValue: String(email).toLowerCase() }
        }
      },
      limit: 1
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    console.warn('Participant lookup failed (quota?):', data?.error?.message || res.status);
    return null;
  }
  const row = (Array.isArray(data) ? data : []).find((r) => r.document);
  if (!row) return null;
  const name = row.document.name || '';
  const uid = name.split('/').pop() || null;
  const fields = row.document.fields || {};
  return {
    uid,
    employeeId: fields.employeeId?.stringValue || fields.id?.stringValue || HARI.employeeId,
    name: fields.name?.stringValue || HARI.name,
    email: fields.email?.stringValue || HARI.email
  };
}

async function main() {
  const secret = readSecret();
  const email = arg('email', secret.email);
  const password = arg('password', secret.password);
  const dryRun = process.argv.includes('--dry-run');
  if (!email || !password) {
    console.error('Missing admin credentials. Pass --password or update .admin-bootstrap-secret.txt');
    process.exitCode = 1;
    return;
  }

  const auth = await signIn(email, password);
  console.log('Signed in as', auth.email || email);

  let user = await lookupParticipantUid(auth.idToken, HARI.email);
  if (!user) {
    console.warn('Using screenshot identity (lookup unavailable). Email match still works in admin/day boards.');
    user = {
      uid: HARI.employeeId,
      employeeId: HARI.employeeId,
      name: HARI.name,
      email: HARI.email
    };
  } else {
    console.log('Matched participant:', user);
  }

  const dayOffset = HARI.day - 1;
  const dateIso = new Date(Date.parse('2026-07-26T18:30:00+05:30') + dayOffset * 86400000).toISOString();
  const entryId = `ENTRY_RECOVER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const finishSec = Math.max(
    1,
    Math.round(HARI.durationSec * (HARI.day / Math.max(HARI.distanceKm, HARI.day)))
  );
  const entry = {
    id: entryId,
    userId: user.employeeId || HARI.employeeId,
    userUid: user.uid || HARI.employeeId,
    userName: user.name || HARI.name,
    userEmail: user.email || HARI.email,
    steps: HARI.steps,
    distanceKm: HARI.distanceKm,
    caloriesBurned: HARI.calories,
    durationSec: HARI.durationSec,
    timeToGoalSec: finishSec,
    date: dateIso,
    challengeDay: HARI.day,
    status: 'approved',
    validatedBy: 'Admin recovery (failed client save)',
    validatedAt: new Date().toISOString(),
    notes: `Recovered Outdoor GPS activity: ${HARI.distanceKm.toFixed(2)} KM / ${HARI.steps} steps / ${HARI.durationSec}s`,
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
    userEmail: entry.userEmail,
    steps: HARI.steps,
    distanceKm: HARI.distanceKm,
    caloriesBurned: HARI.calories,
    durationSec: HARI.durationSec,
    trackingMode: 'outdoor',
    source: 'gps-counter',
    date: dateIso,
    season: SEASON,
    visible: true
  };

  console.log('Will write Day', HARI.day, 'entry ~', Math.floor(finishSec / 60) + ':' + String(finishSec % 60).padStart(2, '0'));
  if (dryRun) {
    console.log(entry);
    return;
  }

  await putDoc(auth.idToken, 'stepEntries', entryId, entry);
  console.log('Wrote stepEntries/' + entryId);
  await putDoc(auth.idToken, 'activityFeed', feedId, feed);
  console.log('Wrote activityFeed/' + feedId);
  console.log('Done. Refresh admin user details + Day 5 board.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
