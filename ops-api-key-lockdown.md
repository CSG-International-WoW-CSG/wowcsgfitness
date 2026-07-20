# API key lockdown (Google Cloud Console)

Firebase web API keys are public identifiers, but they **must** be restricted.

Project: `wow-csg`  
Key (from `firebase-config.js`): `AIzaSyCX9JCEu6aHqE9EVXiT4Xfi-iA6kmPCLJI`

## Status (last verified)

- **Firestore rules:** Deployed to project `wow-csg` (Firebase CLI `firestore:rules`).
- **Browser API key:** Restricted to GitHub Pages / localhost referrers and limited API targets
  (Identity Toolkit, Secure Token, Firestore, Firebase Installations, Firebase).

## Console steps (manual fallback)

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials?project=wow-csg)
2. Click the Browser key matching the Firebase web API key (or create an API key used by the Firebase web app).
3. **Application restrictions** → **HTTP referrers**
   - Add your real hosts, for example:
     - `https://csg-international-wow-csg.github.io/*`
     - `https://*.github.io/*`
     - `http://localhost/*` (dev only; remove later if unused)
     - Capacitor Android WebView often needs: `https://localhost/*` (androidScheme https)
4. **API restrictions** → Restrict key → enable at least:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
   - Firebase Installations API (if used)
5. Save.

## Android app restriction (recommended second key)

For the Android APK, prefer a **separate** Android-restricted key:

1. Create API key → Application restriction **Android apps**
2. Package name: `com.csgi.wowcsgfitness`
3. Add your release/debug SHA-1 from:
   ```bat
   cd android
   gradlew.bat signingReport
   ```
4. Point the Android build at that key if you move off the shared web key (advanced).

## gcloud (optional, if installed + authenticated)

```bat
gcloud config set project wow-csg
gcloud services api-keys list
REM Then update restrictions for the key resource name shown
```

Interactive restriction updates are usually easier in the Console UI above.
