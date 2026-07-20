/**
 * Privileged seed of admins/{uid} using Application Default Credentials
 * or a service account JSON path.
 *
 * Prerequisites (one of):
 *   gcloud auth application-default login
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\serviceAccount.json
 *
 * Usage:
 *   node scripts/ops-seed-admin-privileged.mjs
 *   node scripts/ops-seed-admin-privileged.mjs --uid UID --email wow-csg@csgi.com
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const secretFile = join(root, '.admin-bootstrap-secret.txt');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function readSecret() {
  if (!existsSync(secretFile)) return {};
  const lines = readFileSync(secretFile, 'utf8').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const m = line.match(/^(email|password|uid):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main() {
  const secret = readSecret();
  const email = arg('email') || secret.email || 'wow-csg@csgi.com';
  const uid = arg('uid') || secret.uid;
  if (!uid) {
    console.error('Missing uid. Run ops-bootstrap-admin.mjs first, or pass --uid');
    process.exitCode = 1;
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'wow-csg'
    });
  }

  const db = admin.firestore();
  await db.collection('admins').doc(uid).set(
    {
      email,
      role: 'admin',
      createdAt: new Date().toISOString(),
      bootstrap: 'ops-seed-admin-privileged.mjs'
    },
    { merge: true }
  );
  console.log('Privileged write OK: admins/' + uid);
}

main().catch((e) => {
  console.error(e.message || e);
  console.error('\nAuthenticate first, e.g.:');
  console.error('  gcloud auth application-default login');
  console.error('or set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service account JSON.');
  process.exitCode = 1;
});
