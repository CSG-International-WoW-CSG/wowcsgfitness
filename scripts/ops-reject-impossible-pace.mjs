/**
 * Reject Day-challenge entries that imply superhuman pace, and/or match
 * named users from a leaderboard dispute.
 *
 * Usage:
 *   node scripts/ops-reject-impossible-pace.mjs
 *   node scripts/ops-reject-impossible-pace.mjs --maxKmh 18 --names "Varun Kumar Pinnam,CHANCHAL PALIWAL,Mimoh Ojha"
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const secretFile = join(root, '.admin-bootstrap-secret.txt');
const configFile = join(root, 'firebase-config.js');

const API_KEY = 'AIzaSyCX9JCEu6aHqE9EVXiT4Xfi-iA6kmPCLJI';
const PROJECT = 'wow-csg';
const SEASON = 'jul2026-v2';
const DAY_GOALS = [1, 2, 3, 4, 5, 6, 7];
const START = new Date(2026, 6, 26); // Jul 26 2026 local
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

function challengeDayNum(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const start = new Date(START.getFullYear(), START.getMonth(), START.getDate());
  const diff = Math.floor((day - start) / 86400000) + 1;
  return diff >= 1 && diff <= 7 ? diff : 0;
}

function goalKmForEntry(entry) {
  const dayNum = challengeDayNum(entry.date);
  if (dayNum) return DAY_GOALS[dayNum - 1];
  return 1;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function estimateTimeToGoalSec(entry, goalKm) {
  const distanceKm = Number(entry.distanceKm) || 0;
  const durationSec = Number(entry.durationSec) || 0;
  if (distanceKm < goalKm - 0.01 || durationSec <= 0) return null;
  const path = Array.isArray(entry.path) ? entry.path : [];
  const timed = path.filter((p) => p && Number.isFinite(Number(p.t)) && Number(p.t) > 0);
  if (timed.length >= 2) {
    let cum = 0;
    const t0 = Number(timed[0].t);
    for (let i = 1; i < timed.length; i++) {
      const a = timed[i - 1];
      const b = timed[i];
      cum += haversineKm(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng));
      if (cum >= goalKm - 0.01) {
        const elapsed = Math.max(1, Math.round((Number(b.t) - t0) / 1000));
        return Math.min(elapsed, durationSec);
      }
    }
  }
  return Math.max(1, Math.round(durationSec * (goalKm / distanceKm)));
}

function impliedSpeedKmh(finishSec, goalKm) {
  if (!(finishSec > 0) || !(goalKm > 0)) return null;
  return goalKm / (finishSec / 3600);
}

function firestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function fromFirestoreDoc(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('nullValue' in v) out[k] = null;
    else if ('arrayValue' in v) {
      out[k] = (v.arrayValue.values || []).map((item) => {
        if (item.mapValue) {
          const m = {};
          for (const [mk, mv] of Object.entries(item.mapValue.fields || {})) {
            if ('stringValue' in mv) m[mk] = mv.stringValue;
            else if ('integerValue' in mv) m[mk] = Number(mv.integerValue);
            else if ('doubleValue' in mv) m[mk] = Number(mv.doubleValue);
            else if ('nullValue' in mv) m[mk] = null;
          }
          return m;
        }
        if ('doubleValue' in item) return Number(item.doubleValue);
        if ('integerValue' in item) return Number(item.integerValue);
        if ('stringValue' in item) return item.stringValue;
        return null;
      });
    }
  }
  return out;
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
  if (!res.ok) throw new Error(data.error?.message || 'Auth failed');
  return data;
}

async function listAllStepEntries(idToken) {
  // Prefer filtered runQuery (lighter) — fall back to paged list if needed
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'stepEntries' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'season' },
          op: 'EQUAL',
          value: { stringValue: SEASON }
        }
      },
      limit: 500
    }
  };
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
      body: JSON.stringify(queryBody)
    }
  );
  const data = await res.json();
  if (!res.ok || (data && data.error)) {
    throw new Error(JSON.stringify((data && data.error) || data));
  }
  const docs = [];
  for (const row of data || []) {
    if (!row.document) continue;
    const id = row.document.name.split('/').pop();
    docs.push({ id, ...fromFirestoreDoc(row.document.fields) });
  }
  return docs;
}

async function patchEntryStatus(idToken, entryId, patch) {
  const fieldPaths = Object.keys(patch);
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/stepEntries/${entryId}`
  );
  for (const fp of fieldPaths) url.searchParams.append('updateMask.fieldPaths', fp);
  const fields = {};
  for (const [k, v] of Object.entries(patch)) fields[k] = firestoreValue(v);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: apiHeaders({ Authorization: `Bearer ${idToken}` }),
    body: JSON.stringify({ fields })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${entryId}: ${JSON.stringify(data.error || data)}`);
  return data;
}

async function main() {
  void configFile;
  const secret = readSecret();
  const email = arg('email', secret.email);
  const password = arg('password', secret.password);
  const maxKmh = Number(arg('maxKmh', '18'));
  const names = String(arg('names', 'Varun Kumar Pinnam,CHANCHAL PALIWAL,Mimoh Ojha'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const dryRun = process.argv.includes('--dry-run');

  if (!email || !password) {
    console.error('Missing admin email/password in .admin-bootstrap-secret.txt');
    process.exitCode = 1;
    return;
  }

  const auth = await signIn(email, password);
  console.log('Signed in as admin:', auth.email || email);

  const entries = await listAllStepEntries(auth.idToken);
  console.log('Loaded stepEntries:', entries.length);

  const reason =
    'Rejected: finish time implies speed beyond a realistic human pace for this challenge (GPS glitch / invalid tracking).';

  const targets = [];
  for (const entry of entries) {
    if (entry.season && entry.season !== SEASON) continue;
    if ((entry.status || 'pending') === 'rejected') continue;

    const name = String(entry.userName || '').trim().toLowerCase();
    const goalKm = goalKmForEntry(entry);
    const finishSec = estimateTimeToGoalSec(entry, goalKm);
    const speed = finishSec != null ? impliedSpeedKmh(finishSec, goalKm) : null;
    const namedHit = names.includes(name);
    const tooFast = speed != null && speed > maxKmh;
    const dayNum = challengeDayNum(entry.date);

    // Focus on named Day-1 leaderboard dispute + any superhuman pace finishes
    if (namedHit && dayNum === 1 && finishSec != null) {
      targets.push({ entry, goalKm, finishSec, speed, why: 'named-day1' });
    } else if (tooFast && finishSec != null) {
      targets.push({ entry, goalKm, finishSec, speed, why: 'too-fast' });
    }
  }

  if (!targets.length) {
    console.log('No matching entries to reject.');
    return;
  }

  console.log(`Will reject ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'}:`);
  for (const t of targets) {
    const mm = Math.floor(t.finishSec / 60);
    const ss = String(t.finishSec % 60).padStart(2, '0');
    console.log(
      `- ${t.entry.userName} | ${t.entry.id} | day goal ${t.goalKm} KM | ~${mm}:${ss} | ~${t.speed?.toFixed(1)} km/h | ${t.why} | status=${t.entry.status}`
    );
  }

  if (dryRun) {
    console.log('Dry run only — no writes.');
    return;
  }

  for (const t of targets) {
    await patchEntryStatus(auth.idToken, t.entry.id, {
      status: 'rejected',
      validatedBy: 'Admin (ops-reject-impossible-pace)',
      validatedAt: new Date().toISOString(),
      notes: reason
    });
    console.log('Rejected', t.entry.id, t.entry.userName);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
