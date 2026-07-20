/**
 * One-shot CSG ops bootstrap for wow-csg:
 * 1) Create Auth user wow-csg@csgi.com (or sign in if exists)
 * 2) Write Firestore admins/{uid}
 * 3) Print next steps for rules deploy + API key lock-down
 *
 * Usage:
 *   node scripts/ops-bootstrap-admin.mjs
 *   node scripts/ops-bootstrap-admin.mjs --password "YourSecurePass123!"
 */
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const cfgPath = join(root, 'firebase-config.js');
const secretOut = join(root, '.admin-bootstrap-secret.txt');

function loadApiKey() {
  const src = readFileSync(cfgPath, 'utf8');
  const m = src.match(/apiKey:\s*'([^']+)'/);
  if (!m) throw new Error('apiKey not found in firebase-config.js');
  return m[1];
}

function loadProjectId() {
  const src = readFileSync(cfgPath, 'utf8');
  const m = src.match(/projectId:\s*'([^']+)'/);
  return m ? m[1] : 'wow-csg';
}

function argPassword() {
  const i = process.argv.indexOf('--password');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function genPassword() {
  // 20 chars mixed, URL-safe-ish
  return randomBytes(18).toString('base64url') + 'Aa1!';
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function ensureAuthUser(apiKey, email, password) {
  const signUp = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { email, password, returnSecureToken: true }
  );
  if (signUp.ok && signUp.data.localId) {
    return { created: true, uid: signUp.data.localId, idToken: signUp.data.idToken, password };
  }
  const code = signUp.data.error?.message || '';
  if (code.includes('EMAIL_EXISTS')) {
    const signIn = await postJson(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true }
    );
    if (signIn.ok && signIn.data.localId) {
      return { created: false, uid: signIn.data.localId, idToken: signIn.data.idToken, password, reused: true };
    }
    return {
      created: false,
      emailExists: true,
      error: signIn.data.error?.message || signUp.data.error?.message || 'sign-in failed',
      password
    };
  }
  return { error: code || JSON.stringify(signUp.data), password };
}

async function writeAdminDoc(projectId, uid, email, idToken) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/admins/${uid}`;
  const body = {
    fields: {
      email: { stringValue: email },
      role: { stringValue: 'admin' },
      createdAt: { stringValue: new Date().toISOString() },
      bootstrap: { stringValue: 'ops-bootstrap-admin.mjs' }
    }
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const email = 'wow-csg@csgi.com';
  const apiKey = loadApiKey();
  const projectId = loadProjectId();
  let password = argPassword() || genPassword();

  console.log('Project:', projectId);
  console.log('Admin email:', email);

  let auth = await ensureAuthUser(apiKey, email, password);

  // If email exists but password unknown, create a password-reset request note
  if (auth.emailExists && !auth.uid) {
    console.error('\nAuth user already exists, but the provided/generated password did not work.');
    console.error('Re-run with the known password:');
    console.error('  node scripts/ops-bootstrap-admin.mjs --password "EXISTING_PASSWORD"');
    console.error('Or reset it in Firebase Console → Authentication → Users.');
    process.exitCode = 2;
    return;
  }
  if (auth.error && !auth.uid) {
    console.error('Auth bootstrap failed:', auth.error);
    process.exitCode = 1;
    return;
  }

  writeFileSync(
    secretOut,
    [
      'WOW-CSG admin bootstrap credentials — DELETE after storing in a password manager',
      `email: ${email}`,
      `password: ${auth.password}`,
      `uid: ${auth.uid}`,
      `created: ${auth.created}`,
      `at: ${new Date().toISOString()}`
    ].join('\n'),
    { encoding: 'utf8' }
  );

  console.log(auth.created ? 'Created Auth user.' : 'Signed in existing Auth user.');
  console.log('uid:', auth.uid);
  console.log('Password written to .admin-bootstrap-secret.txt (gitignored) — store then delete.');

  const doc = await writeAdminDoc(projectId, auth.uid, email, auth.idToken);
  if (doc.ok) {
    console.log('Wrote Firestore admins/' + auth.uid);
  } else {
    console.warn('Could not write admins/{uid} with client token (status ' + doc.status + ').');
    console.warn(JSON.stringify(doc.data?.error || doc.data, null, 2));
    console.warn('This usually means Firestore rules already block client writes to /admins.');
    console.warn('After `firebase login`, run: node scripts/ops-seed-admin-privileged.mjs');
  }

  console.log('\nNext:');
  console.log('1) Run scripts/ops-firebase-login-and-deploy.cmd (opens login + deploys rules)');
  console.log('2) Restrict API key in Google Cloud Console (see SECURITY.md / ops-api-key-lockdown.md)');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
