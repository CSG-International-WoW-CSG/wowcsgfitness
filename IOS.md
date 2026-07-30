# iOS App (Capacitor)

Native iOS wrapper for the WOW-CSG Fitness Challenge website.

## Why an iOS app?

Safari/Chrome on iPhone pause GPS and sensors when the screen locks.  
The native app uses **Capacitor Geolocation** + the **pedometer plugin** (Core Motion) so tracking works more reliably than the website alone.

> **Important:** Building and shipping an iPhone app requires a **Mac with Xcode** and an **Apple Developer** account. This Windows machine can prepare the `ios/` project, but final compile / TestFlight must be done on a Mac.

## Requirements (Mac)

- macOS with **Xcode 15+** (App Store)
- **CocoaPods** (`sudo gem install cocoapods` or Homebrew)
- Node.js 18+
- Apple ID enrolled in [Apple Developer Program](https://developer.apple.com/programs/) (for device install / TestFlight)

## Setup (first time on a Mac)

```bash
cd wowcsgfitness
npm install
npm run copy:www
npx cap sync ios
cd ios/App
pod install
cd ../..
npm run ios
```

Xcode opens the workspace (`ios/App/App.xcworkspace`).

1. Select the **App** target → **Signing & Capabilities**
2. Choose your Team (CSG / personal Apple Developer team)
3. Confirm Bundle ID: `com.csgi.wowcsgfitness`
4. Connect an iPhone or pick a simulator
5. Press **Run** ▶

## Day-to-day sync (after web changes)

```bash
npm run ios:sync
# then on Mac:
cd ios/App && pod install && cd ../..
npm run ios
```

## Permissions the app requests

| Permission | Why |
|------------|-----|
| **Location When In Use** | Outdoor KM tracking |
| **Motion & Fitness** | Step counting (treadmill / outdoor assist) |

Users must allow these on first **Start Activity**.

Privacy strings live in `ios/App/App/Info.plist`.

## Distribute to CSG employees

1. In Xcode: **Product → Archive**
2. Distribute to **TestFlight** (App Store Connect)
3. Add internal testers with `@csgi.com` emails
4. Share the TestFlight invite link

Sideloading IPA outside TestFlight is limited on non-jailbroken devices without Enterprise signing.

## How tracking works on iOS

| Mode | Unlocked | Locked / background |
|------|----------|---------------------|
| Outdoor | GPS + pedometer when available | Location background mode + pedometer when OS allows; progress also auto-saved for Resume |
| Treadmill | Pedometer / motion steps | Steps when Core Motion continues; Resume after unlock if the OS suspends the app |

Android still has a dedicated foreground **TrackingKeepAlive** service; iOS relies on Apple location/motion APIs + the in-app session restore (v95+).

## Project files

- `capacitor.config.json` — app id `com.csgi.wowcsgfitness`
- `native-bridge.js` — JS ↔ Capacitor plugins (works on iOS + Android)
- `scripts/copy-www.mjs` — copies site assets into `www/` then into the app
- `ios/` — Xcode / CocoaPods project

## Troubleshooting

### `CocoaPods is not installed`

On the Mac:

```bash
sudo gem install cocoapods
cd ios/App && pod install
```

### Signing errors

- Bundle ID must match an App ID in your Apple Developer account
- Enable **Automatically manage signing** and pick a Team

### Location / Motion denied

iPhone Settings → WOW-CSG Fitness → enable Location and Motion & Fitness, then restart the activity.

### Website still better for some users?

Until TestFlight is live, iPhone users can keep using:

https://csg-international-wow-csg.github.io/wowcsgfitness/

(Add to Home Screen). Hard-refresh to the latest site version before each day’s run.
