# Android App (Capacitor)

Native Android wrapper for the WOW-CSG Fitness Challenge website.

## Why Android app?

Mobile browsers pause accelerometer events when the screen locks.  
The Android app uses the **hardware step counter** (`TYPE_STEP_COUNTER`), which keeps counting while locked. When the app resumes (or on a short poll), those steps are applied to your activity.

## Troubleshooting

### “Please provide the path to the Android SDK”

Android Studio is installed, but the **Android SDK** is not (or not configured yet).

1. Click **Cancel** on that dialog (or close it).
2. Open **Android Studio** from the Start menu (not via the project).
3. On the welcome screen: **More Actions** → **SDK Manager**  
   (or **Settings** → **Languages & Frameworks** → **Android SDK**).
4. Install at least:
   - **Android SDK Platform** (API 34 or 35)
   - **Android SDK Platform-Tools**
   - **Android SDK Build-Tools**
5. Note the path shown at the top (usually):
   `C:\Users\<you>\AppData\Local\Android\Sdk`
6. Re-open the project:
   ```bash
   npm run android
   ```
7. When asked for the SDK path, paste that folder and click **OK**.

Optional: after the SDK exists, create `android/local.properties` with:

```properties
sdk.dir=C:\\Users\\ojhmim02\\AppData\\Local\\Android\\Sdk
```

(Use your real username/path; this file is gitignored.)

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

- **Location** (fine / coarse) — outdoor KM tracking while the app is open  
- **Physical activity / ACTIVITY_RECOGNITION** — hardware step counter  

Users should allow these on first **Start Activity**.

### “App not installed” when sideloading

1. **Uninstall** any older WOW-CSG Fitness build first (Settings → Apps → WOW-CSG Fitness → Uninstall).
2. Install the new APK from Desktop or USB (avoid incomplete OneDrive sync copies when possible).
3. Allow **Install unknown apps** for Files / Chrome / Drive.
4. Use the rebuilt debug APK (**version 1.0.1** / `versionCode` 2). Older builds could fail install on newer Android because of foreground-service permissions without a matching service.

Fixed APK locations after a successful build:

- `Desktop\WOW-CSG-Fitness-debug.apk`
- `wowcsgfitness\WOW-CSG-Fitness-debug.apk`
- `android\app\build\outputs\apk\debug\app-debug.apk`

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
