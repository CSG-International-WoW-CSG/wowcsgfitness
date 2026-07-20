# WOW-CSG Fitness — Security & CSG Compliance

This app handles **CSG employee PII** and optional **location / fitness** data. Treat it as an internal challenge system.

## Required before production use

1. **Deploy Firestore rules** (interactive — needs your Google login)
   ```bat
   scripts\ops-firebase-login-and-deploy.cmd
   ```
   Or:
   ```bash
   npx firebase login
   npx firebase use wow-csg
   npx firebase deploy --only firestore:rules
   ```

2. **Bootstrap admin**
   - Auth user for `wow-csg@csgi.com` can be created with:
     ```bat
     node scripts/ops-bootstrap-admin.mjs
     ```
   - Then seed Firestore (needs Admin SDK credentials / ADC):
     ```bat
     gcloud auth application-default login
     node scripts/ops-seed-admin-privileged.mjs
     ```
   - Or in Firebase Console → Firestore, create `admins/{uid}`:
     ```json
     { "email": "wow-csg@csgi.com", "role": "admin", "createdAt": "<ISO date>" }
     ```
   - Password for a newly bootstrapped user is in `.admin-bootstrap-secret.txt` (gitignored) — store in a password manager and delete the file.

3. **Restrict Firebase API key** — see [`ops-api-key-lockdown.md`](ops-api-key-lockdown.md)

4. **Enable App Check** (recommended) for Auth + Firestore.

5. **Confirm Legal / InfoSec** sign-off for employee wellness + GPS data.

## What was hardened in code

| Control | Implementation |
|--------|----------------|
| Admin auth | Firebase Auth + `admins/{uid}` + email allowlist |
| No forgeable admin | Removed `localStorage.isAdmin` / hardcoded password |
| Corporate identity | `@csgi.com` / `@csg.com` only |
| Data access | `firestore.rules` least-privilege |
| Passwords | Firebase Auth only; stripped from localStorage/cache; no client hash; reset via email link |
| Admin CSP | Same Content-Security-Policy as main app |
| Privacy | Consent banner + versioned privacy notice |
| Android | `allowBackup=false`, no cleartext, no mixed content |
| XSS | Escape user strings on leaderboard / credentials UI |
| GPS | Coarsened coordinates; fewer points; weight kept local |

## Verify Firebase rules + API key lockdown (ops checklist)

Run these after deploy — code alone does not prove production compliance.

### A. Firestore rules are live

1. Open [Firebase Console → Firestore → Rules](https://console.firebase.google.com/project/wow-csg/firestore/rules)
2. Confirm the published rules match `firestore.rules` in this repo (look for `isCorporateEmail`, `admins/{uid}`, and `allow write: if false` on admins).
3. Or from a machine with Firebase CLI logged in:
   ```bash
   npx firebase use wow-csg
   npx firebase deploy --only firestore:rules
   ```
4. Smoke test in browser DevTools while signed in as a normal `@csgi.com` user:
   - Can read own `participants/{uid}` and create own `stepEntries`
   - Cannot write `admins/{anyUid}`
   - Cannot update another user’s `status` / `validatedBy` on step entries

### B. API key lockdown

1. Open [GCP Credentials for wow-csg](https://console.cloud.google.com/apis/credentials?project=wow-csg)
2. Find the Browser key matching `firebase-config.js`
3. Confirm **Application restrictions** = HTTP referrers (your GitHub Pages / localhost / Capacitor hosts only)
4. Confirm **API restrictions** limited to Identity Toolkit, Token Service, Cloud Firestore (and Installations if used)
5. Optional negative test: call the key from a random origin — should be rejected

### C. Admin bootstrap hygiene

1. Confirm `admins/{uid}` exists for `wow-csg@csgi.com`
2. Store the admin password in a password manager
3. Delete `.admin-bootstrap-secret.txt` from disk after storing it
4. Prefer rotating the bootstrap password once in Firebase Auth

### D. Recommended follow-ups

- Enable **App Check** for Auth + Firestore
- Get Legal / InfoSec sign-off for employee wellness + GPS data

## Privacy notice (summary)

- **Purpose:** Run the internal 7-day fitness challenge and leaderboards.
- **Data:** Name, employee ID, corporate email, username, activity distance/time/steps, optional GPS path (coarsened), optional body weight (device-local for calorie estimate).
- **Retention:** Challenge season data; wipe after challenge via admin clear / season bump.
- **Contact:** wow-csg@csgi.com

## Residual risk (needs Cloud Functions / Entra for full enterprise)

- Authenticated CSG users can still read peer profile fields needed for leaderboards (internal trust model).
- Client-submitted GPS distance can be spoofed without a trusted backend validator.
- Prefer Microsoft Entra ID SSO for admin when available.
