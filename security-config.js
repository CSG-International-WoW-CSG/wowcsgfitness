/**
 * CSG security posture for WOW-CSG Fitness (client-side allowlists).
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
  /** Coarsen GPS before cloud sync (~110m). */
  gpsCoordDecimals: 3,
  maxGpsPointsCloud: 40,
  privacyVersion: '2026-07-20',
  supportEmail: 'wow-csg@csgi.com'
};
