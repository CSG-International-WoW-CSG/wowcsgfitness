# Android App (Capacitor)

Native Android wrapper for the WOW-CSG Fitness Challenge website.

## Why Android app?

Mobile browsers pause accelerometer events when the screen locks.  
The Android app uses the **hardware step counter** (`TYPE_STEP_COUNTER`), which keeps counting while locked. When the app resumes (or on a short poll), those steps are applied to your activity.

## Requirements

- Node.js 18+
- Android Studio (Ladybug or newer recommended)
- Android SDK 34+, JDK 17

## Setup (first time)

```bash
cd wowcsgfitness
npm install
npm run copy:www
npx cap add android
npm run cap:sync
npm run cap:open
```

In Android Studio:

1. Wait for Gradle sync
2. Connect a phone (USB debugging) or start an emulator
3. Run ▸ **app**

## Day-to-day build

```bash
npm run android
```

Debug APK (optional CLI):

```bash
npm run android:build
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

## Permissions the app requests

- **Location** (fine + background when available) — outdoor KM tracking  
- **Physical activity / ACTIVITY_RECOGNITION** — hardware step counter  

Users should allow these on first **Start Activity**.

## How tracking works in the app

| Mode | While unlocked | While locked |
|------|----------------|--------------|
| Outdoor | GPS + hardware steps | Hardware steps continue; GPS when OS allows; sync on unlock |
| Treadmill | Speed × time + hardware steps | Speed catch-up + hardware steps on unlock |

Web (GitHub Pages) behavior is unchanged — `native-bridge.js` is a no-op in browsers.

## Project files

- `capacitor.config.json` — app id `com.csgi.wowcsgfitness`
- `native-bridge.js` — JS ↔ native plugins
- `scripts/copy-www.mjs` — copies site assets into `www/` for Capacitor
- `android/` — generated Android Studio project (after `cap add android`)

## Notes

- Keep using the website for desktop / quick demos.
- Distribute the APK to challenge participants for best lock-screen accuracy.
- Play Store publishing is optional; sideload APK is fine for an internal CSG challenge.
