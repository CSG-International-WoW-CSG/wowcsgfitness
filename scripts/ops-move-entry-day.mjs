/**
 * Move an existing stepEntries doc to another challenge calendar day.
 *
 * Usage:
 *   node scripts/ops-move-entry-day.mjs --entryId ENTRY_... --day 6
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
    else if ('timestampValue' in v) out[k] = v.timestampValue;
  }
  return out;
}

function toField(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
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

async function getDoc(idToken, collectionId, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, { headers: apiHeaders({ Authorization: `Bearer ${idToken}` }) });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data.error || data));
  return { id: docId, ...fromFields(data.fields) };
}

async function patchFields(idToken, collectionId, docId, patch) {
  const mask = Object.keys(patch)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}?${mask}`;
  const fields = {};
  for (const [k, v] of Object.entries(patch)) fields[k] = toField(v);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify({ fields })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data.error || data));
  return fromFields(data.fields);
}

async function runQuery(idToken, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify({ structuredQuery })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return (Array.isArray(data) ? data : [])
    .filter((x) => x.document)
    .map((x) => ({
      id: x.document.name.split('/').pop(),
      ...fromFields(x.document.fields)
    }));
}

async function main() {
  const entryId = arg('entryId');
  const day = Number(arg('day', '6'));
  if (!entryId) {
    console.error('Missing --entryId');
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(day) || day < 1 || day > 7) {
    console.error('Invalid --day (1-7)');
    process.exitCode = 1;
    return;
  }

  const secret = readSecret();
  if (!secret.email || !secret.password) {
    console.error('Missing email/password in .admin-bootstrap-secret.txt');
    process.exitCode = 1;
    return;
  }

  const auth = await signIn(secret.email, secret.password);
  console.log('Signed in as', auth.email);

  const entry = await getDoc(auth.idToken, 'stepEntries', entryId);
  console.log('BEFORE', {
    id: entry.id,
    userName: entry.userName,
    date: entry.date,
    challengeDay: entry.challengeDay,
    status: entry.status,
    distanceKm: entry.distanceKm,
    steps: entry.steps
  });

  // Place near end of target IST day so boards bucket to that calendar day.
  const dateLocal = `2026-07-${String(25 + day).padStart(2, '0')}T23:02:27+05:30`;
  // Day 1 = Jul 26 → 25+1=26; Day 6 = Jul 31 → 25+6=31; Day 7 = Aug 1 needs special case
  let newDateIso;
  if (day === 7) {
    newDateIso = new Date('2026-08-01T23:02:27+05:30').toISOString();
  } else {
    newDateIso = new Date(dateLocal).toISOString();
  }

  const noteExtra = ` | Admin: moved to Day ${day} (${newDateIso.slice(0, 10)})`;
  const patch = {
    date: newDateIso,
    challengeDay: day,
    notes: `${entry.notes || ''}${noteExtra}`.trim(),
    lastAdminEditAt: new Date().toISOString(),
    lastAdminEditBy: 'Admin date move'
  };

  const updated = await patchFields(auth.idToken, 'stepEntries', entryId, patch);
  console.log('AFTER stepEntries', {
    id: entryId,
    userName: updated.userName || entry.userName,
    date: updated.date,
    challengeDay: updated.challengeDay
  });

  let feed = [];
  try {
    feed = await runQuery(auth.idToken, {
      from: [{ collectionId: 'activityFeed' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'entryId' },
          op: 'EQUAL',
          value: { stringValue: entryId }
        }
      },
      limit: 10
    });
  } catch (err) {
    console.warn('Feed query failed:', err.message || err);
  }

  console.log(
    'Feed posts linked:',
    feed.length,
    feed.map((f) => f.id)
  );
  for (const f of feed) {
    const fp = await patchFields(auth.idToken, 'activityFeed', f.id, {
      date: newDateIso,
      challengeDay: day,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedBy: 'Admin date move'
    });
    console.log('Updated feed', f.id, { date: fp.date, challengeDay: fp.challengeDay });
  }

  console.log('DONE — refresh Day', day, 'board / user details');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
