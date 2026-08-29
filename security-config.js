/**
 * CSG security posture for WOW-CSG Health (client-side allowlists).
 * Server enforcement = Firestore rules + Firebase Auth (see firestore.rules).
 *
 * Bootstrap admin:
 * 1. Create a Firebase Auth user with an email listed in adminEmails.
 * 2. In Firestore, create document admins/{thatUserUid} with { email, role: "admin" }.
 * 3. Deploy firestore.rules (firebase deploy --only firestore:rules).
 */
window.securityConfig = {
  allowedEmailDomains: ['csgi.com', 'csg.com'],
  /** Firebase Auth emails allowed to open the admin UI (must also have admins/{uid} doc). */
  adminEmails: [
    'wow-csg@csgi.com'
  ],
  minPasswordLength: 8,
  /** GPS precision for cloud routes (~1.1 m). Was 3 (~110 m) which made admin maps look blocky/wrong. */
  gpsCoordDecimals: 5,
  /** Keep evenly spaced points across the full route (not just the first N). */
  maxGpsPointsCloud: 300,
  /** Slightly leaner for browser localStorage cache. */
  maxGpsPointsCache: 180,
  privacyVersion: '2026-07-21b',
  supportEmail: 'wow-csg@csgi.com'
};
