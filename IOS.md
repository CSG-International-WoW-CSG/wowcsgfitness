# iOS without a Mac — free options

You do **not** need a Mac to give iPhone users a home-screen “app.”  
A real App Store / TestFlight IPA for all employees is **not fully free** (Apple Developer Program is **US$99/year**).

## Option A — Free (recommended now): iPhone Home Screen app (PWA)

Works on every iPhone today. No Mac. No Apple fee. Same Firebase login as Android/web.

### Install steps (send to participants)

1. Open **Safari** (not Chrome):  
   https://csg-international-wow-csg.github.io/wowcsgfitness/
2. Tap the **Share** button  
3. Tap **Add to Home Screen** → **Add**
4. Open **WOW-CSG Fitness** from the home screen
5. Allow **Location** when starting an activity
6. Hard-refresh once so the footer shows the latest site version

### Limits (honest)

- iOS may pause GPS when the phone is fully locked (Apple restriction for web apps)
- Progress is **auto-saved** — if the page reloads, tap **Resume** / **Save** (do not Start again)
- For best lock-screen tracking on phones, Android APK is still stronger

This is the only **fully free** way to “ship an iOS app” without a Mac.

---

## Option B — Free cloud compile (public GitHub repo): prove the native project builds

This repo is **public**, so GitHub Actions **macOS runners are free**.

Workflow: `.github/workflows/ios-build.yml`

- Manual run: GitHub → **Actions** → **iOS build (no Mac)** → **Run workflow**
- Builds the Capacitor iOS project on a cloud Mac
- Produces an **unsigned simulator build** artifact (validates the project compiles)

This does **not** install on employee iPhones by itself (Apple blocks unsigned distribution).

---

## Option C — Real iPhone install / TestFlight (not free)

To put a native app on many CSG iPhones you still need:

| Requirement | Cost |
|-------------|------|
| Apple Developer Program | **US$99 / year** (not free) |
| Code signing + TestFlight | Included with that membership |
| Build machine | **Free** via GitHub Actions (public repo) — no personal Mac required for day-to-day builds |

One-time Apple Developer enrollment can be done in a browser.  
Certificates / App Store Connect API keys are set up in Apple’s web portals; CI then builds on GitHub’s Macs.

After you have membership + secrets, we can extend the workflow to export a signed IPA / TestFlight upload.

---

## What we already prepared in this repo

- `ios/` — Capacitor native shell (`com.csgi.wowcsgfitness`)
- `IOS.md` (this file) — free-first path
- Site section **iPhone / iOS App** — Add to Home Screen instructions
- PWA icons in `icons/`
- GitHub Action for free cloud compile

## Commands (Windows OK)

```bash
npm install
npm run ios:sync
```

No Xcode needed for Option A.  
Option B runs on GitHub.  
Option C needs Apple Developer paid membership.
