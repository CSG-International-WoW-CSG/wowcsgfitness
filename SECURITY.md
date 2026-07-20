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
| Passwords | Never stored in localStorage or emailed in plaintext by the app |
| Privacy | Consent banner + versioned privacy notice |
| Android | `allowBackup=false`, no cleartext, no mixed content |
| XSS | Escape user strings on leaderboard / credentials UI |
| GPS | Coarsened coordinates; fewer points; weight kept local |

## Privacy notice (summary)

- **Purpose:** Run the internal 7-day fitness challenge and leaderboards.
- **Data:** Name, employee ID, corporate email, username, activity distance/time/steps, optional GPS path (coarsened), optional body weight (device-local for calorie estimate).
- **Retention:** Challenge season data; wipe after challenge via admin clear / season bump.
- **Contact:** wow-csg@csgi.com

## Residual risk (needs Cloud Functions / Entra for full enterprise)

- Authenticated CSG users can still read peer profile fields needed for leaderboards (internal trust model).
- Client-submitted GPS distance can be spoofed without a trusted backend validator.
- Prefer Microsoft Entra ID SSO for admin when available.
