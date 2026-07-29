// WOW-CSG 7 Days Fitness Challenge Application
class StepathonApp {
    constructor() {
 // Challenge config: 26 July - 1 August 2026 | Day N = N KM Walk/Run
 this.challengeConfig = {
 name: 'WOW-CSG 7 Days Fitness Challenge',
 slogan: 'Step Together. Thrive Together.',
 tagline: '7 Days * 7 Challenges * 7 Winners',
 startYear: 2026,
 startMonth: 6, // July (0-indexed)
 startDay: 26,
 endYear: 2026,
 endMonth: 7, // August
 endDay: 1,
 durationDays: 7,
 stepsPerKm: 1300, // approx. walking steps per KM for progress tracking
 // Treadmill: distance = speed × time. Cap speeds so inflated "20 km/h walks" cannot farm KM.
 // Typical walk 4–6, jog 7–10, fast run ~12. 20 km/h is elite race pace — not allowed.
 treadmillSpeedMinKmh: 2,
 treadmillSpeedMaxKmh: 12,
 treadmillSpeedWalkMaxKmh: 7,
 treadmillSpeedDefaultKmh: 5,
 // Day board / auto-approve: faster than this is treated as GPS glitch or invalid
 // 15 km/h ≈ 4:00 min/km (strong recreational run; blocks elite/GPS-glitch day wins)
 maxHumanSpeedKmh: 15,
 dayGoalsKm: [1, 2, 3, 4, 5, 6, 7]
 };

 // Bump this to clear the visible roster (old season profiles are hidden)
 this.dataSeason = 'jul2026-v2';
 // Firestore security rules only allow these collection names
 this.participantsCollection = 'participants';
 this.stepEntriesCollection = 'stepEntries';
 this.activityFeedCollection = 'activityFeed';
 this.resetLocalUserDataIfNeeded();

        this.currentUser = null;
        this.isAdmin = false;
        this.firebaseEnabled = false;
        this.auth = null;
        this.db = null;
        this.storage = null;
        this.pendingShareSave = null;
        this.sharePhotoFile = null;
        this.isMigratingUsers = false;
        // Entry ids waiting for cloud confirm — never drop these on Firebase sync
        this._pendingEntryIds = new Set();
        this.initFirebase();
        this.participants = this.loadParticipants();
        
        // Avoid OOM on phones: drop oversized entry caches before JSON.parse
        this.stepEntries = this.loadStepEntriesSafely();
        console.log('StepathonApp initialized - stepEntries count:', this.stepEntries.length);
        
        // Bot protection: Rate limiting
        try {
            this.registrationAttempts = JSON.parse(localStorage.getItem('registrationAttempts') || '[]');
        } catch (e) {
            this.registrationAttempts = [];
        }
        try {
            this.passwordResetAttempts = JSON.parse(localStorage.getItem('passwordResetAttempts') || '[]');
        } catch (e) {
            this.passwordResetAttempts = [];
        }
        this.maxAttemptsPerHour = 5; // Maximum 5 attempts per hour
        this.maxAttemptsPerDay = 10; // Maximum 10 attempts per day
        
 // Step Counter + GPS map tracking
        this.stepCounter = {
            isRunning: false,
            isPaused: false,
            elapsedSecAtPause: 0,
            stepCount: 0,
            lastAcceleration: { x: 0, y: 0, z: 0 },
 threshold: 1.2,
 minVerticalChange: 0.8,
            stepHistory: [],
 accelerationHistory: [],
            startTime: null,
 permissionGranted: false,
 distanceKm: 0,
 path: [],
 watchId: null,
 lastPosition: null,
 gpsReady: false,
 wakeLock: null,
 trackingMode: 'outdoor', // 'outdoor' | 'treadmill'
 treadmillSpeedKmh: 5,
 treadmillDistanceKm: 0,
 lastTreadmillTickAt: null,
 pendingSegmentKm: 0,
 lastAccelMagnitude: 0,
 stepPeakArmed: true,
 lockedStepEstimateAt: null,
 /** Capacitor Android: hardware pedometer is source of truth (skip DeviceMotion). */
 useNativeStepsOnly: false,
 /** Steps already accrued before a pedometer restart (e.g. session restore). */
 nativeStepBaseline: 0,
 /** Seconds from start when live distance first hit today's goal (2-decimal UI). */
 timeToGoalSec: null,
 /** Snapshot frozen at Stop — Save must use this (not submit-time clock). */
 frozenForSave: null
 };

 this.activityMap = null;
 this.activityPolyline = null;
 this.activityMarker = null;
 this.activityKeepAliveBound = false;
 this.keepAwakeVideo = null;
 this.silentAudioCtx = null;
 this.silentOscillator = null;
 this.bgGpsPollId = null;
 this.wakeLockWatchdogId = null;
 this.activitySessionKey = 'wowcsg_active_activity_v1';
 this._lastActivityPersistAt = 0;
 this._lastStepEntriesSyncAt = 0;
 this._leaderboardSyncInFlight = null;
 this.keepAliveAudio = null;
 this.swMessageBound = false;
        
        // Timer properties
        this.timerInterval = null;
        this.timerStartTime = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateStorageNotice();
 this.ensurePrivacyConsentUi();
        // Only run these on main page, not admin page
        // Use requestAnimationFrame for better performance
        if (!window.location.pathname.includes('admin.html')) {
            requestAnimationFrame(() => {
                // Check challenge status immediately on page load
                this.updateDates();
                // Keep-alive/audio only when an activity is started (avoids cold-start crashes)
                
                this.checkCurrentUser();
                // Paint from local cache first — avoid triple Firebase sync on cold start
                // Delay paint on iOS so cold start / reload doesn't fight Firebase + JSON parse
                const iosBanner = document.getElementById('iosBootBanner');
                const iosLoadBtn = document.getElementById('iosLoadRankingsBtn');
                if (this.isLowMemoryClient()) {
                    if (iosBanner) iosBanner.style.display = 'block';
                    if (iosLoadBtn) {
                        iosLoadBtn.style.display = 'block';
                        iosLoadBtn.addEventListener('click', () => {
                            iosLoadBtn.disabled = true;
                            iosLoadBtn.textContent = 'Loading…';
                            this.ensureFirestore().then(() => this.syncParticipantsFromFirebase({ skipEntries: false }))
                                .then(() => {
                                    this.ensurePublicLeaderboardReady();
                                    iosLoadBtn.textContent = 'Rankings loaded';
                                })
                                .catch(() => {
                                    iosLoadBtn.disabled = false;
                                    iosLoadBtn.textContent = 'Load rankings';
                                });
                        });
                    }
                }
                setTimeout(() => {
                    if (!this.isLowMemoryClient()) {
                        this.ensurePublicLeaderboardReady();
                    } else {
                        const list = document.getElementById('leaderboardList');
                        if (list) {
                            list.innerHTML = '<div class="leaderboard-item"><div class="name">Tap “Load rankings” to refresh the board.</div></div>';
                        }
                    }
                }, this.isLowMemoryClient() ? 500 : 100);
                const iosTip = document.getElementById('iosTrackingTip');
                if (iosTip && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
                    iosTip.style.display = 'block';
                }
            });
 // Desktop/Android: sync for public leaderboard. iOS waits for explicit Load rankings / login.
 if (!this.isLowMemoryClient()) {
   const syncDelayMs = window.__WOWCSG_SAFE_BOOT__ ? 4500 : 2500;
   setTimeout(() => {
     this.syncParticipantsFromFirebase({ skipEntries: false });
   }, syncDelayMs);
 }
 } else {
 this.restoreAdminSessionIfAuthorized();
 // Admin needs both entries (Validations) and participants (User Management + totals)
 setTimeout(() => {
 this.syncParticipantsFromFirebase({ skipEntries: false }).then(() => {
 if (typeof this.updateAdminDashboard === 'function') {
 this.updateAdminDashboard();
 }
 if (document.getElementById('usersList') && document.getElementById('usersTab')?.classList.contains('active')) {
 this.loadUsersList();
 }
 }).catch(() => {});
 }, 800);
 }
    }

    /** iPhone Chrome/Safari + safe-boot: keep memory tiny (GPS paths OOM on reload). */
    isLowMemoryClient() {
        // Admin maps need full GPS paths — never strip there
        if (window.location.pathname.includes('admin.html')) return false;
        if (window.__WOWCSG_IOS__ || window.__WOWCSG_SAFE_BOOT__) return true;
        const ua = navigator.userAgent || '';
        return /iPhone|iPad|iPod/i.test(ua);
    }

    /** Drop GPS / screenshot blobs — not needed for boards or dashboards. */
    leanStepEntry(entry) {
        if (!entry || typeof entry !== 'object') return entry;
        const { path, screenshot, ...rest } = entry;
        return rest;
    }

    loadStepEntriesSafely() {
        try {
            const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
            const raw = localStorage.getItem(storageKey);
            // iOS Chrome OOMs well below 1.5MB — especially after reload with GPS caches
            const maxChars = this.isLowMemoryClient() ? 350000 : 1500000;
            if (raw && raw.length > maxChars) {
                console.warn('Trimming oversized stepEntries cache:', raw.length);
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        const lean = parsed
                            .map((e) => this.leanStepEntry(e))
                            .filter((e) => e && e.id)
                            .sort((a, b) => this.entryTimestampMs(b) - this.entryTimestampMs(a))
                            .slice(0, 250);
                        localStorage.setItem(storageKey, JSON.stringify(lean));
                        return lean;
                    }
                } catch (trimErr) {
                    console.warn('Trim failed, keeping empty until Firebase sync:', trimErr);
                }
                // Never delete the key before we have a trimmed copy — sync will refill
                return [];
            }
        } catch (e) {
            /* ignore */
        }
        const entries = this.loadStepEntries();
        if (!Array.isArray(entries)) return [];
        if (this.isLowMemoryClient()) {
            return entries.map((e) => this.leanStepEntry(e));
        }
        return entries;
    }

    /** Sortable timestamp for merge / history (ms). */
    entryTimestampMs(entry) {
        if (!entry) return 0;
        const candidates = [entry.lastModifiedAt, entry.validatedAt, entry.date];
        for (const c of candidates) {
            if (!c) continue;
            const ms = this.parseEntryDate(c).getTime();
            if (Number.isFinite(ms)) return ms;
        }
        return 0;
    }

    /**
     * Merge local + remote step entries by id.
     * Never drop local-only or still-pending cloud writes (fixes "saved then vanished").
     */
    mergeStepEntries(localList, remoteList) {
        const byId = new Map();
        const pending = this._pendingEntryIds || new Set();

        (remoteList || []).forEach((e) => {
            if (e && e.id) byId.set(String(e.id), leanPrefer(e));
        });

        const self = this;
        function leanPrefer(entry) {
            return self.isLowMemoryClient() ? self.leanStepEntry(entry) : entry;
        }

        (localList || []).forEach((e) => {
            if (!e || !e.id) return;
            const id = String(e.id);
            if (pending.has(id)) {
                byId.set(id, leanPrefer(e));
                return;
            }
            if (!byId.has(id)) {
                // Keep local-only rows (cloud write failed / delayed)
                byId.set(id, leanPrefer(e));
                return;
            }
            const remote = byId.get(id);
            if (this.entryTimestampMs(e) > this.entryTimestampMs(remote)) {
                byId.set(id, leanPrefer(e));
            }
        });

        return Array.from(byId.values()).sort(
            (a, b) => this.entryTimestampMs(b) - this.entryTimestampMs(a)
        );
    }

    loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            if (!src) {
                reject(new Error('Missing script src'));
                return;
            }
            const existing = document.querySelector(`script[data-wowcsg-src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.dataset.wowcsgSrc = src;
            s.onload = () => {
                s.dataset.loaded = '1';
                resolve();
            };
            s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
        });
    }

    async ensureLeafletLoaded() {
        if (!document.querySelector('link[data-wowcsg-leaflet-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.dataset.wowcsgLeafletCss = '1';
            document.head.appendChild(link);
        }
        if (typeof L !== 'undefined') return true;
        await this.loadScriptOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
        return typeof L !== 'undefined';
    }

    async ensureTesseractLoaded() {
        if (typeof Tesseract !== 'undefined') return true;
        await this.loadScriptOnce('https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js');
        return typeof Tesseract !== 'undefined';
    }

    async ensureEmailJsLoaded() {
        if (typeof emailjs !== 'undefined') return true;
        await this.loadScriptOnce('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js');
        return typeof emailjs !== 'undefined';
    }

    async ensureFirebaseStorageLoaded() {
        if (this.storage) return true;
        if (typeof firebase === 'undefined') return false;
        try {
            if (!firebase.storage) {
                await this.loadScriptOnce('https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js');
            }
            if (firebase.storage) {
                this.storage = firebase.storage();
                return true;
            }
        } catch (err) {
            console.warn('Firebase Storage load skipped:', err);
        }
        return false;
    }

    initFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                return;
            }

            if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
                return;
            }

            if (!firebase.apps.length) {
                firebase.initializeApp(window.firebaseConfig);
            }

            this.auth = firebase.auth();
            // iOS: defer Firestore SDK + queries until rankings/login need them
            if (window.__WOWCSG_DEFER_FIRESTORE__ || typeof firebase.firestore !== 'function') {
                this.db = null;
                this.firebaseEnabled = true;
                this._firestoreReady = false;
            } else {
                this.db = firebase.firestore();
                this._firestoreReady = true;
                this.firebaseEnabled = true;
            }
            // Storage SDK loaded on demand when sharing a photo
            this.storage = null;
            if (!this.firebaseEnabled) return;

            // Keep session in sync
 this.auth.onAuthStateChanged(async (user) => {
                if (this.isMigratingUsers) {
                    return;
                }
 if (!user) {
 if (this.isAdmin) {
 this.isAdmin = false;
 }
 return;
 }
 await this.ensureFirestore();
 if (window.location.pathname.includes('admin.html')) {
 const ok = await this.verifyAdminAccess(user);
 if (ok) {
 this.isAdmin = true;
 this.showAdminDashboard();
 }
 return;
 }
 if (!this.isCorporateEmail(user.email)) {
 console.warn('Non-corporate account signed in; signing out.');
 await this.auth.signOut();
 return;
 }
 this.loadCurrentUserFromFirebase(user.uid);
            });
        } catch (error) {
            console.warn('Firebase initialization failed:', error);
            this.firebaseEnabled = false;
            this.auth = null;
            this.db = null;
        }
    }

    async ensureFirestore() {
        if (this.db && this._firestoreReady) return true;
        if (typeof firebase === 'undefined') return false;
        try {
            if (typeof firebase.firestore !== 'function') {
                await this.loadScriptOnce('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');
            }
            if (typeof firebase.firestore !== 'function') return false;
            this.db = firebase.firestore();
            this._firestoreReady = true;
            this.firebaseEnabled = true;
            return true;
        } catch (e) {
            console.warn('Firestore load failed', e);
            return false;
        }
    }

 securityCfg() {
 return window.securityConfig || {
 allowedEmailDomains: ['csgi.com', 'csg.com'],
 adminEmails: ['wow-csg@csgi.com'],
 minPasswordLength: 8,
 gpsCoordDecimals: 5,
 maxGpsPointsCloud: 300,
 maxGpsPointsCache: 180,
 privacyVersion: '2026-07-21b',
 supportEmail: 'wow-csg@csgi.com'
 };
 }

 isCorporateEmail(email) {
 if (!email || typeof email !== 'string' || !email.includes('@')) return false;
 const domain = email.split('@').pop().toLowerCase().trim();
 return this.securityCfg().allowedEmailDomains.includes(domain);
 }

 isAllowlistedAdminEmail(email) {
 if (!email) return false;
 const list = (this.securityCfg().adminEmails || []).map((e) => String(e).toLowerCase());
 return list.includes(String(email).toLowerCase().trim());
 }

 async verifyAdminAccess(user) {
 if (!user || !this.firebaseEnabled || !this.db) return false;
 if (!this.isAllowlistedAdminEmail(user.email) && !this.isCorporateEmail(user.email)) {
 return false;
 }
 if (!this.isAllowlistedAdminEmail(user.email)) {
 return false;
 }
 try {
 const doc = await this.db.collection('admins').doc(user.uid).get();
 return doc.exists;
 } catch (error) {
 console.warn('Admin verification failed:', error);
 return false;
 }
 }

 async restoreAdminSessionIfAuthorized() {
 if (!this.firebaseEnabled || !this.auth) return;
 const user = this.auth.currentUser;
 if (!user) return;
 const ok = await this.verifyAdminAccess(user);
 if (ok) {
 this.isAdmin = true;
 this.showAdminDashboard();
 }
 }

 requireAdmin() {
 if (!this.isAdmin) {
 alert('Admin authorization required.');
 return false;
 }
 if (!this.firebaseEnabled || !this.auth || !this.auth.currentUser) {
 alert('Admin Firebase session required. Please sign in again.');
 this.isAdmin = false;
 return false;
 }
 return true;
 }

 ensurePrivacyConsentUi() {
 if (typeof document === 'undefined') return;
 const version = this.securityCfg().privacyVersion;
 const key = 'wowcsg_privacy_consent_v';

 // Always restore scrolling (older builds locked body overflow)
 document.body.classList.remove('privacy-consent-open');
 document.body.style.overflow = '';
 document.body.style.position = '';
 document.body.style.height = '';
 document.body.style.touchAction = '';
 document.documentElement.style.overflow = '';
 document.documentElement.style.height = '';

 const existing = document.getElementById('privacyConsentBanner');
 if (existing) existing.remove();

 if (localStorage.getItem(key) === version) return;

 // In-page banner (document flow) so scrolling never freezes
 const host = document.querySelector('.container') || document.body;
 const banner = document.createElement('div');
 banner.id = 'privacyConsentBanner';
 banner.className = 'privacy-consent-inline';
 banner.setAttribute('role', 'region');
 banner.setAttribute('aria-label', 'Privacy notice');
 banner.innerHTML = `
 <div class="privacy-consent-inner">
 <strong>Privacy notice</strong>
 <p class="privacy-consent-lead">CSG internal challenge — we store your name, employee ID, CSG email, and activity data for this challenge only.</p>
 <button type="button" class="btn btn-primary" id="privacyConsentAccept">I am a CSG employee — Agree &amp; Continue</button>
 <p class="privacy-consent-fineprint">By continuing you agree to this use of your data. Contact ${this.escapeHtml(this.securityCfg().supportEmail)}.</p>
 </div>`;
 host.insertBefore(banner, host.firstChild);
 banner.querySelector('#privacyConsentAccept').addEventListener('click', () => {
 localStorage.setItem(key, version);
 banner.remove();
 });
 }

 sanitizePathForCloud(path, options = {}) {
 const cfg = this.securityCfg();
 const decimals = Number(options.decimals != null ? options.decimals : (cfg.gpsCoordDecimals || 5));
 const maxPts = Number(options.maxPts != null ? options.maxPts : (cfg.maxGpsPointsCloud || 300));
 return this.downsampleActivityPath(path, maxPts, decimals);
 }

 /**
 * Keep the full route shape for admin maps: always preserve start/end and
 * evenly sample the middle (old code took only the first 40 points).
 */
 downsampleActivityPath(path, maxPts = 300, decimals = 5) {
 if (!Array.isArray(path)) return [];
 const cleaned = path
 .map((p) => {
 if (!p || typeof p !== 'object') return null;
 const lat = Number(p.lat != null ? p.lat : p.latitude);
 const lng = Number(p.lng != null ? p.lng : (p.longitude != null ? p.longitude : p.lon));
 if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
 if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
 return {
 lat,
 lng,
 t: p.t || p.timestamp || null
 };
 })
 .filter(Boolean);
 if (!cleaned.length) return [];

 const factor = Math.pow(10, Math.max(0, Math.min(8, decimals)));
 const roundPt = (p) => ({
 lat: Math.round(p.lat * factor) / factor,
 lng: Math.round(p.lng * factor) / factor,
 t: p.t || null
 });

 let sampled;
 if (cleaned.length <= maxPts) {
 sampled = cleaned.map(roundPt);
 } else {
 sampled = [];
 const last = cleaned.length - 1;
 for (let i = 0; i < maxPts; i++) {
 const idx = Math.round((i * last) / (maxPts - 1));
 sampled.push(roundPt(cleaned[idx]));
 }
 }

 // Drop consecutive duplicates after rounding (reduces grid spikes)
 const deduped = [];
 for (const pt of sampled) {
 const prev = deduped[deduped.length - 1];
 if (prev && prev.lat === pt.lat && prev.lng === pt.lng) continue;
 deduped.push(pt);
 }
 return deduped;
 }

 /** Wipe browser caches when data season changes (fresh challenge start). */
 resetLocalUserDataIfNeeded() {
 const seasonKey = 'wowcsg_data_season';
 const stored = localStorage.getItem(seasonKey);
 if (stored === this.dataSeason) {
 return;
 }

 const keysToClear = [
 'participants',
 'participants_cache',
 'stepEntries',
 'stepEntries_cache',
 'currentUser',
 'registrationAttempts',
 'passwordResetAttempts',
 'sentEmails',
 'motivationIndex',
 'isAdmin'
 ];
 keysToClear.forEach((key) => localStorage.removeItem(key));
 localStorage.setItem(seasonKey, this.dataSeason);
 console.log('Cleared local user data for new season:', this.dataSeason);
 }

 participantsCol() {
 return this.db.collection(this.participantsCollection);
 }

 stepEntriesCol() {
 return this.db.collection(this.stepEntriesCollection);
 }

 activityFeedCol() {
 return this.db.collection(this.activityFeedCollection);
 }

 isCurrentSeasonParticipant(participant) {
 return participant && participant.season === this.dataSeason;
 }

 isCurrentSeasonEntry(entry) {
 if (!entry) return false;
 if (entry.season === this.dataSeason) return true;
 // Legacy rows missing season: keep if they fall inside this challenge window
 if (!entry.season && entry.date) {
 return this.getChallengeDayNumber(this.parseEntryDate(entry.date)) > 0;
 }
 return false;
 }

 filterCurrentSeasonParticipants(list) {
 return (list || []).filter((p) => this.isCurrentSeasonParticipant(p));
 }

 filterCurrentSeasonEntries(list) {
 return (list || []).filter((e) => this.isCurrentSeasonEntry(e));
 }

    isEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    updateStorageNotice() {
        const notice = document.getElementById('storageNotice');
        if (!notice) {
            return;
        }
        if (this.firebaseEnabled) {
            notice.style.display = 'none';
            return;
        }
        notice.style.display = 'block';
    }

    getLegacyParticipantsForMigration() {
        try {
            const saved = localStorage.getItem('participants');
            if (!saved) {
                return [];
            }
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Failed to read legacy participants from localStorage:', error);
            return [];
        }
    }

    getLegacyStepEntriesForMigration() {
        try {
            const saved = localStorage.getItem('stepEntries');
            if (!saved) {
                return [];
            }
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Failed to read legacy stepEntries from localStorage:', error);
            return [];
        }
    }

    generateTempPassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    normalizeLocalParticipant(localUser, uid) {
        const email = localUser.email || localUser.emailId || '';
        const emailLower = email ? email.toLowerCase() : '';
        const username = localUser.username || (email ? email.split('@')[0] : '');
        const usernameLower = username ? username.toLowerCase() : '';
        const employeeId = localUser.employeeId || localUser.id || '';
        const employeeIdLower = employeeId ? employeeId.toLowerCase() : '';

        return {
            uid: uid,
            id: employeeId,
            employeeId: employeeId,
            name: localUser.name || '',
            email: email,
            emailLower: emailLower,
            username: username,
            usernameLower: usernameLower,
            employeeIdLower: employeeIdLower,
            totalSteps: localUser.totalSteps || 0,
            dailySteps: localUser.dailySteps || {},
            streak: localUser.streak || 0,
            lastActivity: localUser.lastActivity || null,
            activities: Array.isArray(localUser.activities) ? localUser.activities : [],
            registeredAt: localUser.registeredAt || new Date().toISOString()
        };
    }

    normalizeStepEntry(entry, userUid = null) {
        return {
            id: entry.id,
            userId: entry.userId || '',
            userUid: userUid,
            userName: entry.userName || entry.name || 'Unknown User',
            userEmail: entry.userEmail || entry.email || 'No email',
            steps: entry.steps || 0,
            screenshot: entry.screenshot || null,
            date: entry.date || new Date().toISOString(),
            status: entry.status || 'pending',
            validatedBy: entry.validatedBy || null,
            validatedAt: entry.validatedAt || null,
            lastModifiedBy: entry.lastModifiedBy || null,
            lastModifiedAt: entry.lastModifiedAt || null,
            notes: entry.notes || null,
            source: entry.source || 'manual'
        };
    }

    setupEventListeners() {
        // Login tabs (only if exists - not on admin page)
        const loginTabs = document.querySelectorAll('.login-tab');
        if (loginTabs.length > 0) {
            loginTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const tabType = e.target.dataset.tab;
                    this.switchLoginTab(tabType);
                });
            });
        }

        // Registration form (only if exists - not on admin page)
        const registrationForm = document.getElementById('registrationForm');
        if (registrationForm) {
            // Initialize CAPTCHA for registration
            this.generateCaptcha('registration');
            
            // Refresh CAPTCHA button
            const refreshCaptcha = document.getElementById('refreshCaptcha');
            if (refreshCaptcha) {
                refreshCaptcha.addEventListener('click', () => {
                    this.generateCaptcha('registration');
                });
            }
            
            registrationForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const submitBtn = registrationForm.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.dataset.originalLabel = submitBtn.textContent;
                    submitBtn.textContent = 'Creating account…';
                }
                Promise.resolve(this.handleRegistration())
                    .catch((err) => {
                        console.error('Registration failed:', err);
                        alert(
                            'Registration failed. Please try again.\n\n' +
                            ((err && (err.message || err.code)) || 'Unknown error') +
                            '\n\nNeed help? ' + this.securityCfg().supportEmail
                        );
                    })
                    .finally(() => {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = submitBtn.dataset.originalLabel || 'Create Account & Join Challenge';
                        }
                    });
            });
        }

        // User login form (only if exists - not on admin page)
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        // Switch between registration and login (only if exists)
        const showRegistrationLink = document.getElementById('showRegistrationLink');
        if (showRegistrationLink) {
            showRegistrationLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchLoginTab('user');
            });
        }

        // Forgot password link (only if exists)
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleForgotPassword();
            });
        }

        // Admin login form (only if exists on page)
        const adminForm = document.getElementById('adminForm');
        if (adminForm) {
            adminForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAdminLogin();
            });
        }

        // Add steps form (only if exists - not on admin page)
        const addStepsForm = document.getElementById('addStepsForm');
        if (addStepsForm) {
            addStepsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addSteps();
            });
        }

        // Update screenshot requirement based on step counter usage (only if exists)
        const stepsInput = document.getElementById('stepsInput');
        if (stepsInput) {
            stepsInput.addEventListener('input', () => {
                this.updateScreenshotRequirement();
            });
        }

        // Logout button (only if exists - not on admin page)
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }

        // Help button
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                this.showHelpModal();
            });
        }

        // Footer help link
        const footerHelpLink = document.getElementById('footerHelpLink');
        if (footerHelpLink) {
            footerHelpLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showHelpModal();
            });
        }

        // Login help button
        const loginHelpBtn = document.getElementById('loginHelpBtn');
        if (loginHelpBtn) {
            loginHelpBtn.addEventListener('click', () => {
                this.showHelpModal();
            });
        }

        // Admin logout
        const adminLogoutBtn = document.getElementById('adminLogoutBtn');
        if (adminLogoutBtn) {
            adminLogoutBtn.addEventListener('click', () => {
                this.adminLogout();
            });
        }

        // Migrate local users to Firebase (admin only)
        const migrateUsersBtn = document.getElementById('migrateUsersBtn');
        if (migrateUsersBtn) {
            migrateUsersBtn.addEventListener('click', () => {
                this.migrateLocalUsersToFirebase();
            });
        }

 const clearAllUsersBtn = document.getElementById('clearAllUsersBtn');
 if (clearAllUsersBtn) {
 clearAllUsersBtn.addEventListener('click', () => {
 this.clearAllChallengeUserData();
 });
 }

        // Manual screenshot upload
        const manualScreenshot = document.getElementById('manualScreenshot');
        if (manualScreenshot) {
            manualScreenshot.addEventListener('change', (e) => {
                this.handleManualScreenshotUpload(e.target.files[0]);
            });
        }

        const removeManualImageBtn = document.getElementById('removeManualImageBtn');
        if (removeManualImageBtn) {
            removeManualImageBtn.addEventListener('click', () => {
                this.resetManualScreenshot();
            });
        }

        // Admin filters
        const adminFilters = document.querySelectorAll('.admin-filters .filter-btn');
        adminFilters.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.dataset.filter;
                this.filterAdminEntries(filter);
            });
        });

        // Step Counter Event Listeners
        // Note: startStepCounterBtn is now handled via tabs, but keeping for backward compatibility
        const startStepCounterBtn = document.getElementById('startStepCounterBtn');
        if (startStepCounterBtn) {
            startStepCounterBtn.addEventListener('click', () => {
                this.switchInputMethod('counter');
            });
        }

        const closeStepCounterBtn = document.getElementById('closeStepCounterBtn');
        if (closeStepCounterBtn) {
            closeStepCounterBtn.addEventListener('click', () => {
                // Switch back to manual entry when closing
                this.switchInputMethod('manual');
            });
        }

        const startCounterBtn = document.getElementById('startCounterBtn');
        if (startCounterBtn) {
            startCounterBtn.addEventListener('click', () => {
                this.startStepCounter();
            });
        }

        const stopCounterBtn = document.getElementById('stopCounterBtn');
        if (stopCounterBtn) {
            stopCounterBtn.addEventListener('click', () => {
                this.stopStepCounter();
            });
        }

        const resumeCounterBtn = document.getElementById('resumeCounterBtn');
        if (resumeCounterBtn) {
            resumeCounterBtn.addEventListener('click', () => {
                this.resumeStepCounter();
            });
        }

        // Button removed - no longer needed

        const saveCounterStepsBtn = document.getElementById('saveCounterStepsBtn');
        if (saveCounterStepsBtn) {
            saveCounterStepsBtn.addEventListener('click', () => {
                this.saveCounterStepsDirectly();
            });
        }

        const refreshFeedBtn = document.getElementById('refreshFeedBtn');
        if (refreshFeedBtn) {
            refreshFeedBtn.addEventListener('click', () => this.loadActivityFeed(true));
        }
        const recoverUnsyncedBtn = document.getElementById('recoverUnsyncedBtn');
        if (recoverUnsyncedBtn) {
            recoverUnsyncedBtn.addEventListener('click', async () => {
                recoverUnsyncedBtn.disabled = true;
                const prev = recoverUnsyncedBtn.textContent;
                recoverUnsyncedBtn.textContent = 'Recovering...';
                try {
                    await this.recoverUnsyncedActivitiesForCurrentUser({ silent: false });
                } finally {
                    recoverUnsyncedBtn.disabled = false;
                    recoverUnsyncedBtn.textContent = prev || 'Recover unsaved activities';
                }
            });
        }

        const sharePhotoInput = document.getElementById('shareActivityPhoto');
        if (sharePhotoInput) {
            sharePhotoInput.addEventListener('change', (e) => {
                this.handleSharePhotoSelected(e.target.files && e.target.files[0]);
            });
        }
        const clearSharePhotoBtn = document.getElementById('clearSharePhotoBtn');
        if (clearSharePhotoBtn) {
            clearSharePhotoBtn.addEventListener('click', () => this.clearSharePhotoSelection());
        }
        const confirmShareSaveBtn = document.getElementById('confirmShareSaveBtn');
        if (confirmShareSaveBtn) {
            confirmShareSaveBtn.addEventListener('click', () => this.confirmShareAndSave());
        }
        const cancelShareSaveBtn = document.getElementById('cancelShareSaveBtn');
        if (cancelShareSaveBtn) {
            cancelShareSaveBtn.addEventListener('click', () => this.closeShareActivityModal());
        }
        const closeShareActivityBtn = document.getElementById('closeShareActivityBtn');
        if (closeShareActivityBtn) {
            closeShareActivityBtn.addEventListener('click', () => this.closeShareActivityModal());
        }
        const shareToFeedCheckbox = document.getElementById('shareToFeedCheckbox');
        if (shareToFeedCheckbox) {
            shareToFeedCheckbox.addEventListener('change', () => this.toggleSharePhotoGroups());
        }

 const bodyWeightInput = document.getElementById('bodyWeightKg');
 if (bodyWeightInput) {
 const savedWeight = this.getBodyWeightKg();
 bodyWeightInput.value = String(savedWeight);
 bodyWeightInput.addEventListener('change', () => {
 this.setBodyWeightKg(bodyWeightInput.value);
 this.updateStepCounterDisplay();
 });
 bodyWeightInput.addEventListener('input', () => {
 this.updateStepCounterDisplay();
 });
 }

 document.querySelectorAll('.mode-btn').forEach((btn) => {
 btn.addEventListener('click', () => {
 this.setTrackingMode(btn.dataset.mode);
 });
 });

 const treadmillSpeedInput = document.getElementById('treadmillSpeedKmh');
 if (treadmillSpeedInput) {
 // Legacy speed field removed from UI — ignore if still present in old cached HTML
 treadmillSpeedInput.disabled = true;
 }

 const savedMode = localStorage.getItem('trackingMode');
 if (savedMode === 'treadmill' || savedMode === 'outdoor') {
 this.setTrackingMode(savedMode, true);
 } else {
 this.setTrackingMode('outdoor', true);
 }

        // Method tabs (only if exists - not on admin page)
        const methodTabs = document.querySelectorAll('.method-tab');
        if (methodTabs.length > 0) {
            methodTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const method = e.target.dataset.method;
                    this.switchInputMethod(method);
                });
            });
        }

        // Screenshot upload (only if exists)
        const screenshotInput = document.getElementById('screenshotInput');
        const uploadArea = document.getElementById('uploadArea');
        
        if (screenshotInput) {
            screenshotInput.addEventListener('change', (e) => {
                this.handleScreenshotUpload(e.target.files[0]);
            });
        }

        // Drag and drop (only if exists)
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    this.handleScreenshotUpload(file);
                }
            });
        }

        // Remove image (only if exists)
        const removeImageBtn = document.getElementById('removeImageBtn');
        if (removeImageBtn) {
            removeImageBtn.addEventListener('click', () => {
                this.resetScreenshotForm();
            });
        }

        // Confirm extracted steps (only if exists)
        const confirmStepsBtn = document.getElementById('confirmStepsBtn');
        if (confirmStepsBtn) {
            confirmStepsBtn.addEventListener('click', async () => {
            const steps = parseInt(document.getElementById('extractedSteps').textContent.replace(/,/g, ''));
            if (steps > 0) {
                // Get the screenshot from OCR form
                const screenshotInput = document.getElementById('screenshotInput');
                if (screenshotInput && screenshotInput.files.length > 0) {
                    // Store screenshot temporarily for addSteps
                    this.tempScreenshotFile = screenshotInput.files[0];
                }
                document.getElementById('stepsInput').value = steps;
                await this.addSteps();
                this.resetScreenshotForm();
                this.tempScreenshotFile = null;
            } else {
                alert('Please edit the steps value before confirming.');
            }
            });
        }

        // Edit steps (only if exists)
        const editStepsBtn = document.getElementById('editStepsBtn');
        if (editStepsBtn) {
            editStepsBtn.addEventListener('click', () => {
                const editStepsInput = document.getElementById('editStepsInput');
                const extractedSteps = document.getElementById('extractedSteps');
                const editedSteps = document.getElementById('editedSteps');
                if (editStepsInput && extractedSteps && editedSteps) {
                    editStepsInput.style.display = 'flex';
                    const currentSteps = extractedSteps.textContent.replace(/,/g, '');
                    editedSteps.value = currentSteps;
                }
            });
        }

        // Save edited steps (only if exists)
        const saveEditedStepsBtn = document.getElementById('saveEditedStepsBtn');
        if (saveEditedStepsBtn) {
            saveEditedStepsBtn.addEventListener('click', () => {
                const editedSteps = document.getElementById('editedSteps');
                const extractedSteps = document.getElementById('extractedSteps');
                const editStepsInput = document.getElementById('editStepsInput');
                if (editedSteps && extractedSteps && editStepsInput) {
                    const steps = parseInt(editedSteps.value);
                    if (!isNaN(steps) && steps >= 0) {
                        extractedSteps.textContent = steps.toLocaleString();
                        editStepsInput.style.display = 'none';
                    }
                }
            });
        }

        // Refresh motivation button
        const refreshMotivationBtn = document.getElementById('refreshMotivationBtn');
        if (refreshMotivationBtn) {
            refreshMotivationBtn.addEventListener('click', () => {
                this.updateDailyMotivation();
                // Add animation feedback
                refreshMotivationBtn.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    refreshMotivationBtn.style.transform = 'scale(1)';
                }, 150);
            });
        }

 // Leaderboard filters (overall + per-day)
 document.querySelectorAll('.filter-btn, .day-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
 const button = e.currentTarget;
 const filter = button.dataset.filter;
 document.querySelectorAll('.filter-btn, .day-filter-btn').forEach(b => b.classList.remove('active'));
 button.classList.add('active');
 // Day boards need fresh approve/reject status; throttle still applies unless forced
 const forceSync = String(filter || '').startsWith('day-');
 this.updateLeaderboard(filter, { forceSync });
            });
        });
    }

    switchInputMethod(method) {
 // Challenge logging is app counter only
 method = 'counter';

        document.querySelectorAll('.method-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const activeTab = document.querySelector(`[data-method="${method}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
        }

        const addStepsForm = document.getElementById('addStepsForm');
        const screenshotForm = document.getElementById('screenshotForm');
        const stepCounterForm = document.getElementById('stepCounterForm');
 const methodTabs = document.querySelector('.input-method-tabs');
        
 if (methodTabs) methodTabs.style.display = 'none';
        if (addStepsForm) addStepsForm.style.display = 'none';
        if (screenshotForm) screenshotForm.style.display = 'none';
            if (stepCounterForm) {
                stepCounterForm.style.display = 'block';
                this.requestMotionPermission();
        }
    }

    async handleScreenshotUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            alert('Please upload a valid image file!');
            return;
        }

        // Show image preview
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('previewImage').src = e.target.result;
            document.getElementById('imagePreview').style.display = 'block';
            document.getElementById('uploadArea').style.display = 'none';
            
            // Start OCR processing
            this.processImageWithOCR(e.target.result);
        };
        reader.readAsDataURL(file);
    }

    async processImageWithOCR(imageDataUrl) {
        const ocrProcessing = document.getElementById('ocrProcessing');
        const extractedResult = document.getElementById('extractedResult');
        
        ocrProcessing.style.display = 'block';
        extractedResult.style.display = 'none';

        try {
            const ok = await this.ensureTesseractLoaded();
            if (!ok) {
                throw new Error('OCR library failed to load');
            }
            let steps = 0;
            let ocrText = '';
            let ocrWords = [];

            // Try OCR with original image first (better for colored/dark backgrounds)
            try {
                const result1 = await Tesseract.recognize(imageDataUrl, 'eng', {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            // Progress logging
                        }
                    }
                });
                ocrText = result1.data.text;
                ocrWords = result1.data.words || [];
                console.log('OCR Text (Original):', ocrText);
                console.log('OCR Words (Original):', ocrWords);
                
                steps = this.extractStepsFromText(ocrText, ocrWords);
            } catch (err) {
                console.log('First OCR attempt failed, trying preprocessed image');
            }

            // If no steps found, try with preprocessed image
            if (steps === 0) {
                try {
                    const processedImage = await this.preprocessImage(imageDataUrl);
                    const result2 = await Tesseract.recognize(processedImage, 'eng', {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                // Progress logging
                            }
                        }
                    });
                    
                    const processedText = result2.data.text;
                    const processedWords = result2.data.words || [];
                    console.log('OCR Text (Processed):', processedText);
                    console.log('OCR Words (Processed):', processedWords);
                    
                    const processedSteps = this.extractStepsFromText(processedText, processedWords);
                    if (processedSteps > 0) {
                        steps = processedSteps;
                        ocrText = processedText;
                        ocrWords = processedWords;
                    }
                } catch (err) {
                    console.log('Processed OCR attempt also failed');
                }
            }

            // If still no steps, try with number-only OCR
            if (steps === 0) {
                try {
                    const result3 = await Tesseract.recognize(imageDataUrl, 'eng', {
                        tessedit_char_whitelist: '0123456789,',
                        tessedit_pageseg_mode: '6' // Uniform block of text
                    });
                    const numbersOnlyText = result3.data.text;
                    console.log('OCR Text (Numbers Only):', numbersOnlyText);
                    const numbersOnlySteps = this.extractStepsFromText(numbersOnlyText, result3.data.words || []);
                    if (numbersOnlySteps > 0) {
                        steps = numbersOnlySteps;
                        // Combine OCR texts for debug
                        if (ocrText) {
                            ocrText += '\n\n--- Numbers Only OCR ---\n' + numbersOnlyText;
                        } else {
                            ocrText = numbersOnlyText;
                        }
                    }
                } catch (err) {
                    console.log('Numbers-only OCR attempt failed');
                }
            }
            
            // If still no steps, try combining all OCR texts for better extraction
            if (steps === 0 && ocrText) {
                // One more attempt with combined text
                steps = this.extractStepsFromText(ocrText, ocrWords);
            }
            
            ocrProcessing.style.display = 'none';
            
            // Always set debug text
            const debugTextEl = document.getElementById('debugOcrText');
            if (debugTextEl) {
                debugTextEl.textContent = ocrText.substring(0, 1000) || 'No text detected by OCR';
            }
            
            if (steps > 0) {
                document.getElementById('extractedSteps').textContent = steps.toLocaleString();
                document.getElementById('confirmStepsBtn').style.display = 'inline-block';
                extractedResult.style.display = 'block';
            } else {
                // Show debug info but still display result card
                const debugInfo = `OCR detected text: "${ocrText.substring(0, 200)}"\n\nCould not detect steps. Please try:\n1. Ensure the step count is clearly visible\n2. Use a clearer image\n3. Or enter steps manually\n\nCheck the Debug Info section below for full OCR text.`;
                alert(debugInfo);
                // Still show the result card with debug info even if no steps detected
                extractedResult.style.display = 'block';
                document.getElementById('extractedSteps').textContent = '0';
                document.getElementById('confirmStepsBtn').style.display = 'none';
            }
        } catch (error) {
            console.error('OCR Error:', error);
            ocrProcessing.style.display = 'none';
            alert('Error processing image. Please try again or enter steps manually.');
            this.resetScreenshotForm();
        }
    }

    async preprocessImage(imageDataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Scale up image for better OCR (2x)
                const scale = 2;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                
                // Use image smoothing
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // Draw scaled image
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Get image data
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                // Enhance contrast and brightness (less aggressive)
                for (let i = 0; i < data.length; i += 4) {
                    // Convert to grayscale
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    
                    // Increase contrast moderately
                    const contrast = 1.3;
                    const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
                    let newGray = factor * (gray - 128) + 128;
                    
                    // Brightness adjustment
                    newGray = Math.min(255, Math.max(0, newGray + 20));
                    
                    // Soft threshold (not pure black/white)
                    const threshold = newGray > 140 ? 255 : (newGray < 100 ? 0 : newGray);
                    
 data[i] = threshold; // R
                    data[i + 1] = threshold; // G
                    data[i + 2] = threshold; // B
                    // data[i + 3] stays as alpha
                }
                
                // Put processed image data back
                ctx.putImageData(imageData, 0, 0);
                
                // Convert back to data URL
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = imageDataUrl;
        });
    }

    extractStepsFromText(text, words = []) {
        // Clean the text - preserve numbers and commas
        const cleanText = text.replace(/\s+/g, ' ');
        
        console.log('Processing text:', cleanText);
        
        // Extract all numbers (with and without commas)
        const allNumbers = [];
        const excludedNumbers = new Set(); // Numbers to exclude (like goal values)
        
        // First, identify numbers to EXCLUDE (goal values, etc.)
        const goalPatterns = [
            /goal\s*:?\s*(\d{1,3}(?:,\d{3})*|\d{3,6})/gi,
            /target\s*:?\s*(\d{1,3}(?:,\d{3})*|\d{3,6})/gi,
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s*goal/gi,
        ];
        
        goalPatterns.forEach(pattern => {
            const matches = [...cleanText.matchAll(pattern)];
            matches.forEach(match => {
                const numStr = match[1] || match[0].replace(/\D/g, '');
                const parsed = parseInt(numStr.replace(/,/g, ''));
                if (parsed >= 1000) {
                    excludedNumbers.add(parsed);
                    console.log('Excluding goal/target number:', parsed);
                }
            });
        });
        
        // Pattern 1: Numbers with commas (e.g., "6,162", "10,000")
        const commaNumbers = cleanText.match(/\d{1,3}(?:,\d{3})+/g);
        if (commaNumbers) {
            commaNumbers.forEach(num => {
                const parsed = parseInt(num.replace(/,/g, ''));
                if (parsed >= 100 && parsed <= 1000000 && !excludedNumbers.has(parsed)) {
                    // Much lower confidence if it's a round number (likely goal)
                    // Round numbers like 10,000, 5,000, 8,000 are almost always goals
                    let confidence = 0.9;
                    if (parsed % 1000 === 0) {
                        confidence = 0.2; // Very low confidence for round numbers
                    } else if (parsed % 100 === 0) {
                        confidence = 0.7; // Medium confidence for numbers ending in 00
                    }
                    allNumbers.push({ value: parsed, original: num, confidence: confidence });
                }
            });
        }
        
        // Pattern 2: Look for "TOTAL" keyword (HIGHEST PRIORITY - fitness apps often use "TOTAL X steps")
        const totalPatterns = [
            /total\s+(\d{1,3}(?:,\d{3})*|\d{3,6})\s+steps?/gi,
            /total\s+steps?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d{3,6})/gi,
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s+steps?\s+total/gi,
        ];
        
        totalPatterns.forEach(pattern => {
            const matches = [...cleanText.matchAll(pattern)];
            matches.forEach(match => {
                const numStr = match[1] || match[0].replace(/\D/g, '');
                const parsed = parseInt(numStr.replace(/,/g, ''));
                if (parsed >= 100 && parsed <= 1000000 && !excludedNumbers.has(parsed)) {
                    allNumbers.push({ value: parsed, original: numStr, confidence: 0.99 });
                    console.log('Found TOTAL pattern:', parsed);
                }
            });
        });
        
        // Pattern 2b: Look for "steps" keyword and nearby numbers (HIGH PRIORITY)
        const stepPatterns = [
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s+steps?/gi,
            /steps?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d{3,6})/gi,
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s+st\b/gi,
        ];
        
        stepPatterns.forEach(pattern => {
            const matches = [...cleanText.matchAll(pattern)];
            matches.forEach(match => {
                const numStr = match[1] || match[0].replace(/\D/g, '');
                const parsed = parseInt(numStr.replace(/,/g, ''));
                if (parsed >= 100 && parsed <= 1000000 && !excludedNumbers.has(parsed)) {
                    allNumbers.push({ value: parsed, original: numStr, confidence: 0.98 });
                }
            });
        });
        
        // Pattern 2c: "today" keyword (HIGH PRIORITY - step count is usually shown with "today")
        const todayPatterns = [
            /today\s*:?\s*(\d{1,3}(?:,\d{3})*|\d{3,6})/gi,
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s+today/gi,
            /(\d{1,3}(?:,\d{3})*|\d{3,6})\s+steps?\s+today/gi,
            /today\s+(\d{1,3}(?:,\d{3})*|\d{3,6})\s+steps?/gi,
        ];
        
        todayPatterns.forEach(pattern => {
            const matches = [...cleanText.matchAll(pattern)];
            matches.forEach(match => {
                const numStr = match[1] || match[0].replace(/\D/g, '');
                const parsed = parseInt(numStr.replace(/,/g, ''));
                if (parsed >= 100 && parsed <= 1000000 && !excludedNumbers.has(parsed)) {
                    allNumbers.push({ value: parsed, original: numStr, confidence: 0.97 });
                }
            });
        });
        
        // Pattern 3: 3-digit numbers (common for early day step counts like 981, 987)
        const threeDigitNumbers = cleanText.match(/\b\d{3}\b/g);
        if (threeDigitNumbers) {
            threeDigitNumbers.forEach(num => {
                const parsed = parseInt(num);
                // 3-digit numbers are valid step counts (especially early in the day)
                if (parsed >= 100 && parsed <= 999 && !excludedNumbers.has(parsed)) {
                    // Check if it's near "TOTAL" or "steps" for higher confidence
                    const numIndex = cleanText.indexOf(num);
                    const context = cleanText.substring(
                        Math.max(0, numIndex - 30),
                        Math.min(cleanText.length, numIndex + 30)
                    ).toLowerCase();
                    const confidence = (context.includes('total') || context.includes('step')) ? 0.95 : 0.7;
                    allNumbers.push({ value: parsed, original: num, confidence: confidence });
                }
            });
        }
        
        // Pattern 3b: Large standalone numbers (4-6 digits, likely step counts)
        // Also match numbers with commas that might be split by OCR
        const largeNumbers = cleanText.match(/\b\d{4,6}\b/g);
        if (largeNumbers) {
            largeNumbers.forEach(num => {
                const parsed = parseInt(num);
                if (parsed >= 1000 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                    const confidence = (parsed % 1000 === 0) ? 0.3 : 0.7;
                    allNumbers.push({ value: parsed, original: num, confidence: confidence });
                }
            });
        }
        
        // Pattern 3c: Numbers that might be split (e.g., "6,162" read as "6 162" or "6162")
        const splitNumbers = cleanText.match(/\d{1,2}\s+\d{3,4}\b/g);
        if (splitNumbers) {
            splitNumbers.forEach(num => {
                const combined = num.replace(/\s+/g, '');
                const parsed = parseInt(combined);
                if (parsed >= 1000 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                    allNumbers.push({ value: parsed, original: num, confidence: 0.75 });
                }
            });
        }
        
        // Pattern 3d: Look for 4-digit numbers that could be step counts (e.g., 6162)
        const fourDigitNumbers = cleanText.match(/\b\d{4}\b/g);
        if (fourDigitNumbers) {
            fourDigitNumbers.forEach(num => {
                const parsed = parseInt(num);
                // Prefer numbers in typical step range, exclude round numbers
                if (parsed >= 1000 && parsed <= 50000 && !excludedNumbers.has(parsed)) {
                    // Higher confidence for non-round 4-digit numbers
                    const confidence = (parsed % 1000 === 0) ? 0.3 : 0.85;
                    allNumbers.push({ value: parsed, original: num, confidence: confidence });
                }
            });
        }
        
        // Pattern 4: Use word data if available (better position info)
        if (words && words.length > 0) {
            // Find words that look like step counts (large numbers)
            // Sort by bounding box size (larger = more prominent = likely step count)
            const numberWords = words
                .map(word => {
                    const wordText = word.text.replace(/[,\s]/g, '');
                    const parsed = parseInt(wordText);
                    if (!isNaN(parsed) && parsed >= 1000 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                        const bbox = word.bbox || {};
                        const area = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
                        return {
                            value: parsed,
                            original: word.text,
                            area: area,
                            bbox: bbox
                        };
                    }
                    return null;
                })
                .filter(w => w !== null)
                .sort((a, b) => b.area - a.area); // Largest first
            
            numberWords.forEach((word, index) => {
                // Higher confidence for larger/prominent numbers
                let confidence = 0.6;
                
                // Accept 3-digit numbers (like 981, 987) - common for early day step counts
                if (word.value >= 100 && word.value <= 999) {
                    confidence = 0.85; // Good confidence for 3-digit numbers
                }
                // Prefer numbers in typical step range (not round numbers like 10,000)
                else if (word.value >= 1000 && word.value <= 50000) {
                    // Round numbers (multiples of 1000) are likely goals, not step counts
                    if (word.value % 1000 === 0) {
                        confidence = 0.15; // Very low confidence for round numbers (likely goals)
                    } else {
                        confidence = 0.92; // Very high confidence for non-round numbers in step range
                    }
                } else if (word.value > 50000) {
                    confidence = 0.7;
                }
                
                // MAJOR boost for largest bounding box (most prominent number)
                // The step count is ALWAYS the largest/most prominent number on screen
                if (index === 0 && word.area > 1000) {
                    confidence += 0.2; // Extra boost for most prominent number
                    // If it's also non-round, boost even more
                    if (word.value % 1000 !== 0) {
                        confidence += 0.1;
                    }
                }
                
                // Heavy penalty for common goal values
                if (word.value === 10000 || word.value === 5000 || word.value === 8000 || word.value === 12000) {
                    confidence = 0.1; // Almost zero confidence for common goal values
                }
                
                // Additional penalty if excluded
                if (excludedNumbers.has(word.value)) {
                    confidence = 0.05; // Almost zero if explicitly excluded
                }
                
                allNumbers.push({
                    value: word.value,
                    original: word.original,
                    confidence: Math.min(1.0, confidence),
                    bbox: word.bbox,
                    area: word.area
                });
            });
        }
        
        // Pattern 5: Look for numbers near "TOTAL" keyword (HIGHEST PRIORITY)
        const totalIndex = cleanText.toLowerCase().indexOf('total');
        if (totalIndex !== -1) {
            // Extract numbers near "total" (within 40 characters - "TOTAL 981 steps Today")
            const context = cleanText.substring(
                Math.max(0, totalIndex - 10), 
                Math.min(cleanText.length, totalIndex + 40)
            );
            const nearbyNumbers = context.match(/\d{1,3}(?:,\d{3})*|\d{3,6}/g);
            if (nearbyNumbers) {
                nearbyNumbers.forEach(num => {
                    const parsed = parseInt(num.replace(/,/g, ''));
                    // Accept 3-digit numbers too (like 981)
                    if (parsed >= 100 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                        // Very high confidence for numbers near "TOTAL"
                        allNumbers.push({ value: parsed, original: num, confidence: 0.995 });
                        console.log('Found number near TOTAL:', parsed);
                    }
                });
            }
        }
        
        // Pattern 5b: Look for numbers near "today" keyword (HIGH PRIORITY - step count is usually with "today")
        const todayIndex = cleanText.toLowerCase().indexOf('today');
        if (todayIndex !== -1) {
            // Extract numbers near "today" (within 30 characters)
            const context = cleanText.substring(
                Math.max(0, todayIndex - 30), 
                Math.min(cleanText.length, todayIndex + 30)
            );
            const nearbyNumbers = context.match(/\d{1,3}(?:,\d{3})*|\d{3,6}/g);
            if (nearbyNumbers) {
                nearbyNumbers.forEach(num => {
                    const parsed = parseInt(num.replace(/,/g, ''));
                    // Accept 3-digit numbers too
                    if (parsed >= 100 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                        // Very high confidence for numbers near "today"
                        allNumbers.push({ value: parsed, original: num, confidence: 0.99 });
                    }
                });
            }
        }
        
        // Pattern 5c: Look for numbers near "step" keyword (but not "goal")
        const stepIndex = cleanText.toLowerCase().indexOf('step');
        if (stepIndex !== -1) {
            // Check if "goal" is nearby - if so, skip this context
            const goalNearby = cleanText.toLowerCase().substring(
                Math.max(0, stepIndex - 20),
                Math.min(cleanText.length, stepIndex + 20)
            ).includes('goal');
            
            if (!goalNearby) {
                const context = cleanText.substring(
                    Math.max(0, stepIndex - 30), 
                    Math.min(cleanText.length, stepIndex + 30)
                );
                const nearbyNumbers = context.match(/\d{1,3}(?:,\d{3})*|\d{3,6}/g);
                if (nearbyNumbers) {
                    nearbyNumbers.forEach(num => {
                        const parsed = parseInt(num.replace(/,/g, ''));
                        // Accept 3-digit numbers too
                        if (parsed >= 100 && parsed <= 100000 && !excludedNumbers.has(parsed)) {
                            allNumbers.push({ value: parsed, original: num, confidence: 0.95 });
                        }
                    });
                }
            }
        }
        
        // Remove duplicates and sort by confidence and value
        const uniqueNumbers = [];
        const seen = new Set();
        
        allNumbers.forEach(item => {
            if (!seen.has(item.value)) {
                seen.add(item.value);
                uniqueNumbers.push(item);
            }
        });
        
        // Sort by confidence (highest first), then by area (largest first if available), then by value
        uniqueNumbers.sort((a, b) => {
            // First priority: confidence
            if (Math.abs(a.confidence - b.confidence) > 0.1) {
                return b.confidence - a.confidence;
            }
            // Second priority: bounding box area (larger = more prominent)
            if (a.area && b.area && Math.abs(a.area - b.area) > 100) {
                return b.area - a.area;
            }
            // Third priority: prefer non-round numbers (not multiples of 1000)
            const aIsRound = a.value % 1000 === 0;
            const bIsRound = b.value % 1000 === 0;
            if (aIsRound !== bIsRound) {
                return aIsRound ? 1 : -1; // Non-round numbers first
            }
            // Fourth priority: value (larger first, but within reasonable range)
            return b.value - a.value;
        });
        
        console.log('Extracted numbers:', uniqueNumbers);
        
        // Return the best match with aggressive filtering
        if (uniqueNumbers.length > 0) {
            // Strategy 1: Highest confidence number (likely from "TOTAL" pattern - 0.995 confidence)
            const highestConfidence = uniqueNumbers.find(n => 
                n.confidence >= 0.99 && 
                !excludedNumbers.has(n.value)
            );
            if (highestConfidence) {
                console.log('Selected highest confidence number (TOTAL pattern):', highestConfidence.value, 'Confidence:', highestConfidence.confidence);
                return highestConfidence.value;
            }
            
            // Strategy 2: Prefer the number with largest bounding box (most prominent) that's not excluded
            // This is the MOST IMPORTANT - step count is always the most prominent number
            const largestArea = uniqueNumbers.find(n => 
                n.area && 
                n.area > 1000 && 
                !excludedNumbers.has(n.value) &&
 n.value % 1000 !== 0 // Not a round number
            );
            if (largestArea) {
                console.log('Selected largest area number (most prominent):', largestArea.value, 'Area:', largestArea.area);
                return largestArea.value;
            }
            
            // Strategy 3: Prefer numbers in the 100-50,000 range that are NOT round numbers
            // Include 3-digit numbers (like 981)
            const typicalNonRound = uniqueNumbers.find(n => 
                n.value >= 100 && 
                n.value <= 50000 && 
                n.value % 1000 !== 0 &&
                !excludedNumbers.has(n.value)
            );
            if (typicalNonRound) {
                console.log('Selected typical non-round number:', typicalNonRound.value);
                return typicalNonRound.value;
            }
            
            // Strategy 4: Highest confidence that's not excluded and not round
            const bestConfidence = uniqueNumbers.find(n => 
                !excludedNumbers.has(n.value) && 
                n.value % 1000 !== 0 &&
                n.confidence > 0.5
            );
            if (bestConfidence) {
                console.log('Selected highest confidence number:', bestConfidence.value, 'Confidence:', bestConfidence.confidence);
                return bestConfidence.value;
            }
            
            // Strategy 5: Any number that's not excluded (even if round)
            const notExcluded = uniqueNumbers.find(n => !excludedNumbers.has(n.value));
            if (notExcluded) {
                console.log('Selected non-excluded number:', notExcluded.value);
                return notExcluded.value;
            }
            
            // Last resort: highest confidence match (but log warning)
            console.warn('WARNING: Using fallback number, may be incorrect:', uniqueNumbers[0].value);
            return uniqueNumbers[0].value;
        }
        
        return 0;
    }

    resetScreenshotForm() {
        document.getElementById('screenshotInput').value = '';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';
        document.getElementById('ocrProcessing').style.display = 'none';
        document.getElementById('extractedResult').style.display = 'none';
        document.getElementById('editStepsInput').style.display = 'none';
        document.getElementById('previewImage').src = '';
    }

 getChallengeBounds() {
 const cfg = this.challengeConfig;
 // Anchor bounds at India local dates so day boards don't shift by browser TZ
 const startDate = new Date(Date.parse(
 `${cfg.startYear}-${String(cfg.startMonth + 1).padStart(2, '0')}-${String(cfg.startDay).padStart(2, '0')}T00:00:00+05:30`
 ));
 const endDate = new Date(Date.parse(
 `${cfg.endYear}-${String(cfg.endMonth + 1).padStart(2, '0')}-${String(cfg.endDay).padStart(2, '0')}T23:59:59+05:30`
 ));
 return { startDate, endDate };
 }

 /** Challenge calendar day key in Asia/Kolkata (YYYY-MM-DD). */
 getChallengeCalendarDayKey(date = new Date()) {
 try {
 return new Intl.DateTimeFormat('en-CA', {
 timeZone: 'Asia/Kolkata',
 year: 'numeric',
 month: '2-digit',
 day: '2-digit'
 }).format(new Date(date));
 } catch (e) {
 const d = new Date(date);
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
 }
 }

 /** Challenge day number 1-7 in Asia/Kolkata, or 0 if outside the window */
 getChallengeDayNumber(date = new Date()) {
 const cfg = this.challengeConfig;
 const startKey = `${cfg.startYear}-${String(cfg.startMonth + 1).padStart(2, '0')}-${String(cfg.startDay).padStart(2, '0')}`;
 const dayKey = this.getChallengeCalendarDayKey(date);
 const startMs = Date.parse(`${startKey}T00:00:00+05:30`);
 const dayMs = Date.parse(`${dayKey}T00:00:00+05:30`);
 if (!Number.isFinite(startMs) || !Number.isFinite(dayMs)) return 0;
 const dayIndex = Math.round((dayMs - startMs) / 86400000);
 if (dayIndex < 0 || dayIndex >= (cfg.durationDays || 7)) return 0;
 return dayIndex + 1;
 }

 getDailyGoalKm(date = new Date()) {
 const day = this.getChallengeDayNumber(date);
 if (day < 1 || day > 7) {
 return this.challengeConfig.dayGoalsKm[0];
 }
 return this.challengeConfig.dayGoalsKm[day - 1];
 }

 getDailyGoalSteps(date = new Date()) {
 return this.getDailyGoalKm(date) * this.challengeConfig.stepsPerKm;
 }

 getChallengeDayDate(dayNum) {
 const cfg = this.challengeConfig;
 const startKey = `${cfg.startYear}-${String(cfg.startMonth + 1).padStart(2, '0')}-${String(cfg.startDay).padStart(2, '0')}`;
 const startMs = Date.parse(`${startKey}T12:00:00+05:30`);
 return new Date(startMs + (Math.max(1, dayNum) - 1) * 86400000);
 }

 updateDates() {
 const { startDate, endDate } = this.getChallengeBounds();

        const startDateElement = document.getElementById('startDate');
        const endDateElement = document.getElementById('endDate');
 const durationEl = document.getElementById('challengeDuration');
 const infoDailyGoal = document.getElementById('infoDailyGoal');
        
        if (startDateElement) {
            startDateElement.textContent = this.formatDate(startDate);
        }
        if (endDateElement) {
            endDateElement.textContent = this.formatDate(endDate);
        }
        if (durationEl) {
            durationEl.textContent = '7 Days';
        }
        if (infoDailyGoal) {
            const day = this.getChallengeDayNumber();
            if (day >= 1 && day <= 7) {
                infoDailyGoal.textContent = `Day ${day}: ${day} KM`;
            } else {
                infoDailyGoal.textContent = '1-7 KM (progressive)';
            }
        }

        // Mirror dates into compact top meta band
        const map = [
            ['startDateTop', startDateElement ? startDateElement.textContent : this.formatDate(startDate)],
            ['endDateTop', endDateElement ? endDateElement.textContent : this.formatDate(endDate)],
            ['challengeDurationTop', '7 Days'],
            ['infoDailyGoalTop', infoDailyGoal ? infoDailyGoal.textContent.replace(' (progressive)', '') : '1-7 KM']
        ];
        map.forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        });

        this.updateDailyPlanHighlight();
        this.checkChallengeStatus(startDate, endDate);
    }

 updateDailyPlanHighlight() {
 const day = this.getChallengeDayNumber();
 document.querySelectorAll('.day-plan-item').forEach((el) => {
 const itemDay = parseInt(el.getAttribute('data-day'), 10);
 el.classList.toggle('is-today', itemDay === day);
 el.classList.toggle('is-complete', day > 0 && itemDay < day);
 });
 }

 isChallengeActive() {
 const { startDate, endDate } = this.getChallengeBounds();
        const now = new Date();
        return now >= startDate && now <= endDate;
    }

 /** Allow logging from now until challenge end (includes pre-start practice) */
 canLogSteps() {
 const { endDate } = this.getChallengeBounds();
 return new Date() <= endDate;
 }

    checkChallengeStatus(startDate, endDate) {
        const now = new Date();
        const isActive = now >= startDate && now <= endDate;
 const notStarted = now < startDate;
 const hasEnded = now > endDate;
        
 // Show/hide challenge status message on main page (before login)
        const mainPageMsg = document.getElementById('mainPageChallengeOverMessage');
        if (mainPageMsg) {
 if (isActive) {
 mainPageMsg.style.display = 'none';
 } else if (notStarted) {
 mainPageMsg.style.display = 'block';
 mainPageMsg.innerHTML = `
 <div style="background: linear-gradient(135deg, #6B2D8B 0%, #003366 100%); color: white; padding: 20px; border-radius: 12px; margin: 20px auto; max-width: 900px; box-shadow: 0 4px 15px rgba(107, 45, 139, 0.35); text-align: center;">
 <div style="font-size: 2.5rem; margin-bottom: 10px;"></div>
 <h2 style="margin: 0 0 10px 0; font-size: 1.6rem; font-weight: bold;">Challenge Starts Soon!</h2>
 <p style="margin: 0 0 10px 0; font-size: 1rem; opacity: 0.95;">
 The <strong>WOW-CSG 7 Days Fitness Challenge</strong> runs from <strong>${this.formatDate(startDate)}</strong> to <strong>${this.formatDate(endDate)}</strong>.
 </p>
 <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">
 Register now | Day 1 = 1 KM | Build up to 7 KM | Fastest finisher wins each day!
 </p>
 </div>`;
 } else {
 mainPageMsg.style.display = 'block';
 mainPageMsg.innerHTML = `
 <div style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%); color: white; padding: 20px; border-radius: 12px; margin: 20px auto; max-width: 900px; box-shadow: 0 4px 15px rgba(244, 67, 54, 0.3); text-align: center;">
 <div style="font-size: 2.5rem; margin-bottom: 10px;"></div>
 <h2 style="margin: 0 0 10px 0; font-size: 1.6rem; font-weight: bold;">Challenge Has Ended</h2>
 <p style="margin: 0 0 10px 0; font-size: 1rem; opacity: 0.95;">
 The WOW-CSG 7 Days Fitness Challenge ended on <strong>${this.formatDate(endDate)}</strong>.
 </p>
 <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">
 Thank you for participating! You can still login to view your progress and the leaderboard.
 </p>
 </div>`;
 }
        }
        
        // Show/hide challenge over message in dashboard (after login)
        let challengeOverMsg = document.getElementById('challengeOverMessage');
        if (!challengeOverMsg) {
            challengeOverMsg = document.createElement('div');
            challengeOverMsg.id = 'challengeOverMessage';
            challengeOverMsg.className = 'challenge-over-message';
            
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.insertBefore(challengeOverMsg, mainContent.firstChild);
            }
        }
        
 if (hasEnded) {
            const formattedEnd = this.formatDate(endDate);
            challengeOverMsg.innerHTML = `
                <div style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(244, 67, 54, 0.3); text-align: center;">
 <div style="font-size: 2.5rem; margin-bottom: 15px;"></div>
                    <h2 style="margin: 0 0 10px 0; font-size: 1.8rem; font-weight: bold;">Challenge Has Ended</h2>
                    <p style="margin: 0 0 15px 0; font-size: 1.1rem; opacity: 0.95;">
 The WOW-CSG 7 Days Fitness Challenge ended on <strong>${formattedEnd}</strong>.
                    </p>
                    <p style="margin: 0; font-size: 1rem; opacity: 0.9;">
                        Thank you for participating! You can still view your progress and the leaderboard below.
                    </p>
                </div>
            `;
            challengeOverMsg.style.display = 'block';
 this.disableAddStepsSection('ended');
 } else if (notStarted) {
 challengeOverMsg.innerHTML = `
 <div style="background: linear-gradient(135deg, #0d9488 0%, #0b3d66 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(13, 148, 136, 0.3); text-align: center;">
 <div style="font-size: 2.5rem; margin-bottom: 15px;"></div>
 <h2 style="margin: 0 0 10px 0; font-size: 1.8rem; font-weight: bold;">Get Ready!</h2>
 <p style="margin: 0 0 15px 0; font-size: 1.1rem; opacity: 0.95;">
 Official challenge: <strong>${this.formatDate(startDate)}</strong> &ndash; <strong>${this.formatDate(endDate)}</strong>. Progressive goals: 1 KM &rarr; 7 KM.
 </p>
 <p style="margin: 0; font-size: 1rem; opacity: 0.9;">
 You can use the step / KM counter now to practice. Official daily winners start on Day 1.
 </p>
 </div>
 `;
 challengeOverMsg.style.display = 'block';
 // Keep counter usable before the official start
 this.enableAddStepsSection();
        } else {
            challengeOverMsg.style.display = 'none';
            this.enableAddStepsSection();
        }
    }

 disableAddStepsSection(reason = 'ended') {
        // Disable the entire add steps section
        const addStepsSection = document.querySelector('.add-steps-section');
 const { endDate, startDate } = this.getChallengeBounds();
        if (addStepsSection) {
            addStepsSection.style.opacity = '0.6';
            addStepsSection.style.pointerEvents = 'none';
            addStepsSection.style.position = 'relative';
            
            // Add overlay message
            let overlay = addStepsSection.querySelector('.challenge-disabled-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'challenge-disabled-overlay';
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.95);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 12px;
                    z-index: 100;
                    flex-direction: column;
                    padding: 20px;
                `;
 addStepsSection.appendChild(overlay);
 }

 if (reason === 'not-started') {
                overlay.innerHTML = `
 <div style="font-size: 3rem; margin-bottom: 15px;"></div>
 <h3 style="margin: 0 0 10px 0; color: #0b3d66; font-size: 1.5rem;">Challenge Starts Soon</h3>
 <p style="margin: 0; color: #666; text-align: center; max-width: 400px;">
 Official logging opens on <strong>${this.formatDate(startDate)}</strong> (through <strong>${this.formatDate(endDate)}</strong>).
 </p>
 `;
 } else {
 overlay.innerHTML = `
 <div style="font-size: 3rem; margin-bottom: 15px;"></div>
                    <h3 style="margin: 0 0 10px 0; color: #f44336; font-size: 1.5rem;">Challenge Has Ended</h3>
                    <p style="margin: 0; color: #666; text-align: center; max-width: 400px;">
 New step entries are no longer being accepted. The challenge ended on <strong>${this.formatDate(endDate)}</strong>.
                    </p>
                `;
            }
        }
        
        // Disable all input methods
        const methodTabs = document.querySelectorAll('.method-tab');
        methodTabs.forEach(tab => {
            tab.disabled = true;
            tab.style.opacity = '0.5';
            tab.style.cursor = 'not-allowed';
        });
        
        // Disable forms
        const addStepsForm = document.getElementById('addStepsForm');
        if (addStepsForm) {
            const inputs = addStepsForm.querySelectorAll('input, button');
            inputs.forEach(input => input.disabled = true);
        }
        
        const screenshotForm = document.getElementById('screenshotForm');
        if (screenshotForm) {
            const inputs = screenshotForm.querySelectorAll('input, button');
            inputs.forEach(input => input.disabled = true);
        }
        
        const stepCounterForm = document.getElementById('stepCounterForm');
        if (stepCounterForm) {
            const buttons = stepCounterForm.querySelectorAll('button');
            buttons.forEach(btn => btn.disabled = true);
        }
    }

    enableAddStepsSection() {
        const addStepsSection = document.querySelector('.add-steps-section');
        if (addStepsSection) {
            addStepsSection.style.opacity = '1';
            addStepsSection.style.pointerEvents = 'auto';
            
            const overlay = addStepsSection.querySelector('.challenge-disabled-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
        
        const methodTabs = document.querySelectorAll('.method-tab');
        methodTabs.forEach(tab => {
            tab.disabled = false;
            tab.style.opacity = '1';
            tab.style.cursor = 'pointer';
        });
    }

    formatDate(date) {
        // Ensure date is valid
        if (!date || isNaN(date.getTime())) {
            console.error('Invalid date provided to formatDate');
            return 'Invalid Date';
        }
        
        // Use explicit formatting to avoid locale issues
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        
        return `${month} ${day}, ${year}`;
    }

    checkCurrentUser() {
 localStorage.removeItem('isAdmin');
        const savedUser = localStorage.getItem('currentUser');
        
 if (this.firebaseEnabled && this.auth && this.auth.currentUser) {
            this.loadCurrentUserFromFirebase(this.auth.currentUser.uid).then((participant) => {
                if (participant) {
                    this.showDashboard();
                }
            });
        } else if (savedUser) {
 try {
 this.currentUser = this.stripSecretsFromParticipant(JSON.parse(savedUser));
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            this.showDashboard();
 } catch (e) {
 localStorage.removeItem('currentUser');
 }
        }
    }

    switchLoginTab(tabType) {
        document.querySelectorAll('.login-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.login-form').forEach(form => {
            form.classList.remove('active');
            if (form.id !== 'adminLoginForm') {
                form.style.display = 'none';
            }
        });
        
        if (tabType === 'user') {
            document.querySelector('[data-tab="user"]').classList.add('active');
            document.getElementById('userLoginForm').style.display = 'block';
            document.getElementById('userLoginForm').classList.add('active');
            document.getElementById('userLoginFormExisting').style.display = 'none';
        } else if (tabType === 'user-login') {
            document.querySelector('[data-tab="user-login"]').classList.add('active');
            document.getElementById('userLoginFormExisting').style.display = 'block';
            document.getElementById('userLoginFormExisting').classList.add('active');
            document.getElementById('userLoginForm').style.display = 'none';
        } else {
            document.querySelector('[data-tab="admin"]').classList.add('active');
            document.getElementById('adminLoginForm').classList.add('active');
            document.getElementById('userLoginForm').style.display = 'none';
            document.getElementById('userLoginFormExisting').style.display = 'none';
        }
    }

    handleAdminLogin() {
 this.handleAdminLoginAsync();
 }

 async handleAdminLoginAsync() {
 try {
 const usernameInput = document.getElementById('adminUsername');
 const passwordInput = document.getElementById('adminPassword');

 if (!usernameInput || !passwordInput) {
 alert('Error: Admin login form elements not found. Please refresh the page.');
            return;
        }

 const email = usernameInput.value.trim().toLowerCase();
 const password = passwordInput.value;

 if (!email || !password) {
 alert('Please enter both admin email and password.');
 return;
 }

 if (!this.firebaseEnabled || !this.auth) {
 alert('Firebase is required for CSG-compliant admin access. Configure Firebase and try again.');
 return;
 }

 if (!this.isAllowlistedAdminEmail(email)) {
 alert('This email is not authorized for admin access.');
 return;
 }

 try {
 const credential = await this.auth.signInWithEmailAndPassword(email, password);
 const ok = await this.verifyAdminAccess(credential.user);
 if (!ok) {
 await this.auth.signOut();
 alert(
 'Signed in, but this account is not an admin.\n\n' +
 'Add Firestore document admins/' + credential.user.uid + ' in the Firebase Console.'
 );
 return;
 }
 this.isAdmin = true;
 localStorage.removeItem('isAdmin');
            if (!window.location.pathname.includes('admin.html')) {
                window.location.href = 'admin.html';
            } else {
                this.showAdminDashboard();
            }
 } catch (error) {
 console.warn('Admin login failed');
 alert('Invalid admin credentials or Firebase error. Contact ' + this.securityCfg().supportEmail);
 passwordInput.focus();
 }
 } catch (error) {
 console.error('Admin login error:', error);
 alert('An error occurred during admin login.');
        }
    }

    adminLogout() {
        this.isAdmin = false;
        localStorage.removeItem('isAdmin');
 if (this.firebaseEnabled && this.auth) {
 this.auth.signOut().catch(() => {});
 }
        
        // Check if we're on admin page
        if (window.location.pathname.includes('admin.html')) {
            document.getElementById('adminLoginCard').style.display = 'block';
            document.getElementById('adminDashboard').style.display = 'none';
            const adminForm = document.getElementById('adminForm');
            if (adminForm) {
                adminForm.reset();
            }
        } else {
            // On main page
            document.getElementById('loginCard').style.display = 'block';
            const adminDashboard = document.getElementById('adminDashboard');
            if (adminDashboard) {
                adminDashboard.style.display = 'none';
            }
            document.getElementById('dashboardCard').style.display = 'none';
        }
    }

    loadStepEntries() {
        try {
            const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
            const saved = localStorage.getItem(storageKey);
            if (!saved || saved === 'null' || saved === 'undefined') {
                return [];
            }
            const entries = JSON.parse(saved);
            if (!Array.isArray(entries)) {
                console.error('stepEntries is not an array! Type:', typeof entries);
                return [];
            }
            return entries;
        } catch (error) {
            console.error('Error loading stepEntries from localStorage:', error);
            return [];
        }
    }

    saveStepEntries() {
        try {
            if (!Array.isArray(this.stepEntries)) {
                console.error('Cannot save stepEntries - not an array!', typeof this.stepEntries, this.stepEntries);
                this.stepEntries = [];
            }
            // Slim cache for mobile Safari — screenshots / huge GPS dumps cause OOM + QuotaExceeded
            const cfg = this.securityCfg();
            const cacheMax = cfg.maxGpsPointsCache || 180;
            const lowMem = this.isLowMemoryClient();
            const slim = this.stepEntries.map((entry) => {
                if (!entry || typeof entry !== 'object') return entry;
                if (lowMem) return this.leanStepEntry(entry);
                const copy = { ...entry };
                delete copy.screenshot;
                if (Array.isArray(copy.path) && copy.path.length > cacheMax) {
                    copy.path = this.downsampleActivityPath(copy.path, cacheMax, cfg.gpsCoordDecimals || 5);
                }
                return copy;
            });
            const jsonString = JSON.stringify(slim);
            const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
            localStorage.setItem(storageKey, jsonString);
        } catch (error) {
            console.error('Error saving stepEntries to localStorage:', error);
            try {
                const minimal = (this.stepEntries || []).map((e) => this.leanStepEntry(e));
                const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
                localStorage.setItem(storageKey, JSON.stringify(minimal));
            } catch (inner) {
                console.error('Minimal stepEntries cache save also failed:', inner);
            }
        }
    }

    async handleRegistration() {
        // Bot protection: Check honeypot field
        const honeypot = document.getElementById('website');
        if (honeypot && honeypot.value.trim() !== '') {
            console.warn('Bot detected: Honeypot field was filled');
            alert('Bot activity detected. Registration blocked.');
            return;
        }

        // Bot protection: Rate limiting check
        if (!this.checkRateLimit('registration')) {
            this.recordAttempt('registration', false); // Record failed attempt
            alert('Too many registration attempts. Please try again later.\n\nMaximum 5 attempts per hour and 10 attempts per day.');
            return;
        }

        // Bot protection: Verify CAPTCHA
        if (!this.verifyCaptcha('registration')) {
            this.recordAttempt('registration', false); // Record failed attempt
            alert('Security check failed. Please solve the math problem correctly.');
            this.generateCaptcha('registration'); // Generate new CAPTCHA
            return;
        }

        const name = document.getElementById('employeeName').value.trim();
        const id = document.getElementById('employeeId').value.trim();
        const email = document.getElementById('emailId').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Validation
        if (!name) {
            alert('Please enter your name!');
            return;
        }

        if (!id) {
            alert('Please enter your Employee ID!');
            return;
        }

        if (!email) {
            alert('Please enter your Email ID!');
            return;
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Please enter a valid email address!');
            return;
        }

 if (!this.isCorporateEmail(email)) {
 const domains = this.securityCfg().allowedEmailDomains.join(', @');
 alert('CSG employees only. Please register with a corporate email (@' + domains + ').');
 document.getElementById('emailId').focus();
 return;
 }

 const privacyKey = 'wowcsg_privacy_consent_v';
 if (localStorage.getItem(privacyKey) !== this.securityCfg().privacyVersion) {
 alert('Please accept the privacy notice before registering.');
 this.ensurePrivacyConsentUi();
 return;
 }

        if (!username || username.length < 3) {
            alert('Please enter a username with at least 3 characters!');
            return;
        }

 const minPw = this.securityCfg().minPasswordLength || 8;
 if (!password || password.length < minPw) {
 alert('Please enter a password with at least ' + minPw + ' characters!');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }

        if (this.firebaseEnabled) {
            await this.ensureFirestore();
            const usernameLower = username.toLowerCase();
            const employeeIdLower = id.toLowerCase();

            // Note: username/employeeId uniqueness cannot be queried while signed out
            // (Firestore rules). Firebase Auth enforces unique email; proceed to create.
            try {
 let credential;
 let reclaimed = false;
 try {
 credential = await this.auth.createUserWithEmailAndPassword(email, password);
 } catch (createError) {
 if (createError.code !== 'auth/email-already-in-use') {
 throw createError;
 }
 // Email still exists in Firebase Auth from an earlier signup (challenge data was cleared, Auth was not).
 // Sign in with the password they entered and create a fresh season profile.
 try {
 credential = await this.auth.signInWithEmailAndPassword(email, password);
 reclaimed = true;
 } catch (signInError) {
 const badPassword = [
 'auth/wrong-password',
 'auth/invalid-credential',
 'auth/invalid-login-credentials',
 'auth/user-mismatch'
 ].includes(signInError.code);
 if (badPassword) {
 alert(
 'This email already has a login from earlier Challenge.\n\n' +
 'Challenge user data was cleared, but Firebase still keeps the email account.\n\n' +
 'Do one of the following:\n' +
 '1) Register again using the SAME password you used before, or\n' +
 '2) Use "Forgot Password" / Login to reset it, then register again.\n\n' +
 'After that you will get a fresh challenge profile.'
 );
 this.switchLoginTab('user-login');
 document.getElementById('emailId').focus();
 return;
 }
 throw signInError;
 }
 }

                const participant = {
                    uid: credential.user.uid,
                    id: id,
                    employeeId: id,
                    name: name,
                    email: email,
                    emailLower: email.toLowerCase(),
                    username: username,
                    usernameLower: usernameLower,
                    employeeIdLower: employeeIdLower,
                    totalSteps: 0,
                    dailySteps: {},
                    streak: 0,
                    lastActivity: null,
                    activities: [],
 registeredAt: new Date().toISOString(),
 season: this.dataSeason
 };

 await this.participantsCol().doc(credential.user.uid).set(participant);
 this.participants = this.filterCurrentSeasonParticipants(
 this.participants.filter((p) => p.uid !== participant.uid).concat([participant])
 );
                this.saveParticipantsCache();
 this.syncParticipantsFromFirebase().catch(() => {});

 this.currentUser = this.stripSecretsFromParticipant(participant);
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

                this.recordAttempt('registration', true);
                this.generateCaptcha('registration');

                document.getElementById('registrationForm').reset();
 try {
 this.showDashboard();
 this.updateLeaderboard();
 } catch (uiError) {
 console.warn('Dashboard open after registration failed:', uiError);
                this.switchLoginTab('user-login');
 }

 alert(
 reclaimed
 ? 'Welcome back! Your previous challenge data was cleared. A fresh profile is ready.'
 : 'Account created successfully!\n\nYou can now login with your email and password from any device.'
 );
            } catch (error) {
 if (error.code === 'auth/invalid-email') {
                    alert('Please enter a valid email address!');
                    document.getElementById('emailId').focus();
                } else if (error.code === 'auth/weak-password') {
                    alert('Password is too weak. Please use at least 6 characters.');
                    document.getElementById('password').focus();
 } else if (error.code === 'permission-denied') {
 console.error('Firebase registration permission error:', error);
 alert('Registration failed due to a permissions issue. Please try again or contact support.');
                } else {
                    console.error('Firebase registration error:', error);
 alert('Registration failed. Please try again.\n\n' + (error.code || '') + ' ' + (error.message || ''));
                }
            }
            return;
        }

 // CSG compliance: local-only accounts disabled (insecure password storage).
 alert(
 'Firebase is required to register. Corporate accounts must use Firebase Auth.\n\n' +
 'If you see this message, Firebase is not configured. Contact ' +
 this.securityCfg().supportEmail
 );
    }

    async handleLogin() {
        // Reload participants to avoid stale data across tabs or sessions
        this.participants = this.loadParticipants();

        const identifier = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!identifier || !password) {
            alert('Please enter your username/email/Employee ID and password!');
            return;
        }

        if (this.firebaseEnabled) {
            await this.handleFirebaseLogin(identifier, password);
            return;
        }

 alert(
 'Firebase is required for CSG-compliant login.\n\n' +
 'Contact ' + this.securityCfg().supportEmail + ' if the app cannot reach Firebase.'
 );
 }

 /** Strip credential fields before any localStorage / in-memory cache write. */
 stripSecretsFromParticipant(participant) {
 if (!participant || typeof participant !== 'object') {
 return participant;
 }
 const clean = { ...participant };
 delete clean.password;
 delete clean.passwordHash;
 delete clean.passwordResetAt;
 return clean;
    }

    isPlaceholderDisplayName(name) {
        const n = String(name || '').trim().toLowerCase();
        if (!n) return true;
        return (
            n === 'challenge participant' ||
            n === 'unknown user' ||
            n === 'unknown' ||
            n === 'teammate' ||
            n === 'user'
        );
    }

    /** utkarsh.bajpai@csgi.com → Utkarsh Bajpai */
    deriveDisplayNameFromEmail(email) {
        const local = String(email || '').split('@')[0] || '';
        if (!local) return '';
        return local
            .replace(/[._+\-]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }

    resolveDisplayName(...candidates) {
        for (const c of candidates) {
            if (!this.isPlaceholderDisplayName(c)) return String(c).trim();
        }
        return '';
    }

    /**
     * Fix profiles stuck as "Challenge Participant" (season reclaim / missing displayName).
     * Also backfills userName on this user's recent entries + feed posts.
     */
    async repairPlaceholderProfileName(profile, authUser) {
        if (!profile) return profile;
        if (!this.isPlaceholderDisplayName(profile.name)) return profile;

        const email = profile.email || profile.emailId || (authUser && authUser.email) || '';
        const fixed = this.resolveDisplayName(
            authUser && authUser.displayName,
            profile.username && !/^\d+$/.test(String(profile.username)) ? String(profile.username).replace(/[._]/g, ' ') : '',
            this.deriveDisplayNameFromEmail(email)
        );
        if (!fixed) return profile;

        profile.name = fixed;
        this.currentUser = this.stripSecretsFromParticipant(profile);
        try {
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
        } catch (e0) { /* ignore */ }

        const idx = (this.participants || []).findIndex(
            (p) => (p.uid && profile.uid && p.uid === profile.uid) ||
                (String(p.email || '').toLowerCase() === String(email).toLowerCase())
        );
        if (idx >= 0) {
            this.participants[idx] = { ...this.participants[idx], name: fixed };
            this.saveParticipantsCache();
        }

        if (this.firebaseEnabled && this.db && profile.uid) {
            try {
                await this.ensureFirestore();
                await this.participantsCol().doc(profile.uid).set({ name: fixed }, { merge: true });
            } catch (e1) {
                console.warn('Could not persist repaired display name:', e1);
            }
            // Backfill denormalized names on recent activities / feed
            try {
                const mine = (this.stepEntries || []).filter((e) => this.entryBelongsToParticipant(e, profile));
                for (const entry of mine.slice(0, 40)) {
                    if (!this.isPlaceholderDisplayName(entry.userName)) continue;
                    entry.userName = fixed;
                    await this.upsertStepEntryInFirebase(entry);
                    await this.syncActivityFeedForEntry(entry);
                }
                this.saveStepEntries();
            } catch (e2) {
                console.warn('Could not backfill activity display names:', e2);
            }
        }
        return profile;
    }


    initializeEmailJS() {
        // Check if EmailJS is available
        if (typeof emailjs !== 'undefined') {
            // Initialize EmailJS with public key (user needs to configure this)
            // Get from localStorage or use default
            const emailjsPublicKey = localStorage.getItem('emailjs_public_key') || '';
            if (emailjsPublicKey) {
                emailjs.init(emailjsPublicKey);
            }
        }
    }

    async sendPasswordEmail(email, password, username) {
 // CSG policy: never email or persist plaintext passwords.
 return false;
    }

    async sendEmailViaEmailJS(email, username, password) {
 // Disabled — passwords must not leave the device via client email APIs.
            return false;
    }

    showEmailModal(email, username, password, subject, body, emailSent = false) {
        const modal = document.createElement('div');
        modal.className = 'email-modal-overlay';
 const safeEmail = this.escapeHtml(email || '');
 const safeUser = this.escapeHtml(username || '');
        modal.innerHTML = `
            <div class="email-modal">
                <div class="email-modal-header">
 <h3>Account ready</h3>
 <button type="button" class="email-modal-close" id="emailModalCloseBtn">&times;</button>
                </div>
                <div class="email-modal-content">
 <p>Your account was created. Use the password you chose at registration — it is not stored or emailed by this app.</p>
 <p><strong>Email:</strong> ${safeEmail}</p>
 <p><strong>Username:</strong> <span id="copyUsername">${safeUser}</span>
 <button type="button" class="btn-copy" id="copyUsernameBtn">Copy</button></p>
 <button type="button" class="btn btn-primary" id="emailModalDoneBtn">Continue</button>
                    </div>
 </div>`;
        document.body.appendChild(modal);
 const close = () => modal.remove();
 modal.querySelector('#emailModalCloseBtn').addEventListener('click', close);
 modal.querySelector('#emailModalDoneBtn').addEventListener('click', close);
 modal.querySelector('#copyUsernameBtn').addEventListener('click', () => this.copyToClipboard(username, 'Username'));
 modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    copyToClipboard(text, label) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast(`${label} copied to clipboard!`);
        }).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.showToast(`${label} copied to clipboard!`);
            } catch (err) {
                this.showToast('Failed to copy. Please copy manually.');
            }
            document.body.removeChild(textarea);
        });
    }

 copyEmailContent(email, username) {
 const content = `Account Details for WOW-CSG 7 Days Fitness Challenge

Email: ${email}
Username: ${username}

Use Forgot Password if you need a reset link. Passwords are never emailed by this app.`;
        
        this.copyToClipboard(content, 'Email content');
    }

    showToast(message, type = 'success') {
        // Remove existing toast if any
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Show toast
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        // Hide and remove toast after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, 3000);
    }

    // EmailJS Configuration Functions
    showEmailJSConfig() {
        const modal = document.getElementById('emailjsConfigModal');
        if (modal) {
            modal.style.display = 'block';
            this.loadEmailJSConfig();
        }
    }

    closeEmailJSConfig() {
        const modal = document.getElementById('emailjsConfigModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    loadEmailJSConfig() {
        const serviceId = localStorage.getItem('emailjs_service_id') || '';
        const templateId = localStorage.getItem('emailjs_template_id') || '';
        const publicKey = localStorage.getItem('emailjs_public_key') || '';

        const serviceIdInput = document.getElementById('emailjsServiceId');
        const templateIdInput = document.getElementById('emailjsTemplateId');
        const publicKeyInput = document.getElementById('emailjsPublicKey');

        if (serviceIdInput) serviceIdInput.value = serviceId;
        if (templateIdInput) templateIdInput.value = templateId;
        if (publicKeyInput) publicKeyInput.value = publicKey;
    }

    saveEmailJSConfig() {
        const serviceId = document.getElementById('emailjsServiceId').value.trim();
        const templateId = document.getElementById('emailjsTemplateId').value.trim();
        const publicKey = document.getElementById('emailjsPublicKey').value.trim();

        if (!serviceId || !templateId || !publicKey) {
            alert('Please fill in all EmailJS configuration fields!');
            return;
        }

        localStorage.setItem('emailjs_service_id', serviceId);
        localStorage.setItem('emailjs_template_id', templateId);
        localStorage.setItem('emailjs_public_key', publicKey);

        // Reinitialize EmailJS
        this.initializeEmailJS();

        const statusDiv = document.getElementById('emailjsStatus');
        if (statusDiv) {
 statusDiv.innerHTML = '<div class="email-success"><p>OK: EmailJS configuration saved successfully!</p></div>';
        }

        this.showToast('EmailJS configuration saved!');
    }

    async testEmailJS() {
        const testEmail = prompt('Enter your email address to send a test email:');
        if (!testEmail) return;

        const serviceId = localStorage.getItem('emailjs_service_id');
        const templateId = localStorage.getItem('emailjs_template_id');
        const publicKey = localStorage.getItem('emailjs_public_key');

        if (!serviceId || !templateId || !publicKey) {
            alert('Please configure EmailJS first!');
            return;
        }

        try {
            if (!(await this.ensureEmailJsLoaded())) {
                alert('EmailJS SDK not loaded. Please refresh the page.');
                return;
            }

            emailjs.init(publicKey);

            const templateParams = {
                to_email: testEmail,
                to_name: 'Test User',
                username: 'testuser',
 password: '[not used — passwords are never emailed]',
 subject: 'Test Email - WOW-CSG Fitness Challenge',
 message: 'This is a test email from WOW-CSG 7 Days Fitness Challenge. If you receive this, EmailJS is configured correctly!'
            };

            await emailjs.send(serviceId, templateId, templateParams);
            
            const statusDiv = document.getElementById('emailjsStatus');
            if (statusDiv) {
 statusDiv.innerHTML = `<div class="email-success"><p>OK: Test email sent successfully to ${testEmail}!</p></div>`;
            }
            this.showToast('Test email sent successfully!');
        } catch (error) {
            console.error('EmailJS Test Error:', error);
            const statusDiv = document.getElementById('emailjsStatus');
            if (statusDiv) {
 statusDiv.innerHTML = `<div class="email-error"><p>Error: ${error.text || error.message || 'Failed to send test email'}</p></div>`;
            }
            alert('Failed to send test email. Please check your EmailJS configuration.');
        }
    }

    clearEmailJSConfig() {
        if (confirm('Are you sure you want to clear EmailJS configuration? Automatic email sending will be disabled.')) {
            localStorage.removeItem('emailjs_service_id');
            localStorage.removeItem('emailjs_template_id');
            localStorage.removeItem('emailjs_public_key');
            
            const serviceIdInput = document.getElementById('emailjsServiceId');
            const templateIdInput = document.getElementById('emailjsTemplateId');
            const publicKeyInput = document.getElementById('emailjsPublicKey');

            if (serviceIdInput) serviceIdInput.value = '';
            if (templateIdInput) templateIdInput.value = '';
            if (publicKeyInput) publicKeyInput.value = '';

            const statusDiv = document.getElementById('emailjsStatus');
            if (statusDiv) {
 statusDiv.innerHTML = '<div class="email-warning"><p>Note: EmailJS configuration cleared.</p></div>';
            }
            this.showToast('EmailJS configuration cleared');
        }
    }

    handleForgotPassword() {
        // Show forgot password modal
        this.showForgotPasswordModal();
    }

    showForgotPasswordModal() {
 if (!this.firebaseEnabled) {
 alert(
 'Firebase is required to reset passwords.\n\n' +
 'Contact ' + this.securityCfg().supportEmail + ' if the app cannot reach Firebase.'
 );
 return;
 }

        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'email-modal-overlay';
        
        // Generate CAPTCHA for password reset
        const captcha = this.generateCaptchaValue();

        modal.innerHTML = `
            <div class="email-modal">
                <div class="email-modal-header">
 <h3>Reset Password</h3>
 <button type="button" class="email-modal-close" id="resetModalCloseBtn" aria-label="Close">&times;</button>
                </div>
                <div class="email-modal-content">
 <p class="email-info">Enter the <strong>CSG email</strong> you used to register. Firebase will email you a secure reset link (check Inbox and Spam).</p>
 <form id="resetPasswordForm">
                        <!-- Honeypot field -->
                        <input type="text" id="resetWebsite" name="website" style="display: none;" tabindex="-1" autocomplete="off">
                        
                        <div class="form-group">
 <label for="resetIdentifier">CSG Email <span class="required">*</span></label>
 <input type="email" id="resetIdentifier" placeholder="you@csgi.com" required autocomplete="email">
 <small class="form-hint">Use your @csgi.com / @csg.com registration email (not username).</small>
                        </div>
                        <div class="form-group captcha-group">
                            <label for="resetCaptchaAnswer">Security Check <span class="required">*</span></label>
                            <div class="captcha-container">
                                <div class="captcha-question" id="resetCaptchaQuestion">${captcha.question}</div>
                                <input type="number" id="resetCaptchaAnswer" placeholder="Enter answer" required autocomplete="off" min="0">
 <button type="button" class="btn btn-secondary btn-small" id="refreshResetCaptchaBtn" title="Refresh CAPTCHA">Refresh</button>
                            </div>
                            <small class="form-hint">Please solve the math problem to verify you're human.</small>
                        </div>
                        <div class="email-actions">
 <button type="submit" class="btn btn-primary" id="sendResetLinkBtn">Send Reset Link</button>
 <button type="button" class="btn btn-secondary" id="cancelResetBtn">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Store CAPTCHA answer in modal data
        modal.dataset.captchaAnswer = captcha.answer;
 
 const close = () => modal.remove();
 modal.querySelector('#resetModalCloseBtn').addEventListener('click', close);
 modal.querySelector('#cancelResetBtn').addEventListener('click', close);
 modal.querySelector('#refreshResetCaptchaBtn').addEventListener('click', () => this.refreshResetCaptcha());
 modal.querySelector('#resetPasswordForm').addEventListener('submit', (e) => {
 e.preventDefault();
 this.resetPasswordFirebase();
 });
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
 close();
            }
        });

        // Focus on first input
        setTimeout(() => {
            document.getElementById('resetIdentifier').focus();
        }, 100);
    }

 getPasswordResetActionSettings() {
 const continueUrl = (typeof window !== 'undefined' && window.location && window.location.origin)
 ? `${window.location.origin}${window.location.pathname || '/'}`.replace(/admin\.html$/i, 'index.html')
 : 'https://csg-international-wow-csg.github.io/wowcsgfitness/';
 return {
 url: continueUrl,
 handleCodeInApp: false
 };
 }

    async resetPasswordFirebase() {
 const sendBtn = document.getElementById('sendResetLinkBtn');
 if (sendBtn) {
 sendBtn.disabled = true;
 sendBtn.textContent = 'Sending…';
 }

 try {
        // Bot protection: Check honeypot field
        const honeypot = document.getElementById('resetWebsite');
        if (honeypot && honeypot.value.trim() !== '') {
            console.warn('Bot detected: Honeypot field was filled in password reset');
            alert('Bot activity detected. Password reset blocked.');
            return;
        }

        // Bot protection: Rate limiting check
        if (!this.checkRateLimit('passwordReset')) {
 this.recordAttempt('passwordReset', false);
            alert('Too many password reset attempts. Please try again later.\n\nMaximum 5 attempts per hour and 10 attempts per day.');
            return;
        }

        // Bot protection: Verify CAPTCHA
        const modal = document.querySelector('.email-modal-overlay');
 const captchaAnswer = modal ? parseInt(modal.dataset.captchaAnswer, 10) : null;
 const userAnswer = parseInt(document.getElementById('resetCaptchaAnswer').value, 10);
        
        if (!captchaAnswer || userAnswer !== captchaAnswer) {
 this.recordAttempt('passwordReset', false);
            alert('Security check failed. Please solve the math problem correctly.');
            this.refreshResetCaptcha();
            return;
        }

 const identifier = (document.getElementById('resetIdentifier').value || '').trim().toLowerCase();
        if (!identifier) {
 alert('Please enter your CSG email address.');
            return;
        }

        let email = identifier;
        if (!this.isEmail(identifier)) {
 // Username / employee ID lookup needs Firestore auth; ask for email instead.
 alert('Please enter the CSG email address used at registration (example: name@csgi.com).');
                document.getElementById('resetIdentifier').focus();
                return;
            }

 if (!this.isCorporateEmail(email)) {
 alert('Password reset is only available for CSG corporate emails (@csgi.com / @csg.com).');
 return;
 }

 if (!this.firebaseEnabled || !this.auth) {
 alert('Firebase is not available. Contact ' + this.securityCfg().supportEmail);
 return;
        }

        try {
 await this.auth.sendPasswordResetEmail(email, this.getPasswordResetActionSettings());
            this.recordAttempt('passwordReset', true);
 if (modal) modal.remove();
 alert(
 'If an account exists for that email, a password reset link has been sent.\n\n' +
 '1) Check Inbox and Spam/Junk\n' +
 '2) Open the link from Firebase / noreply\n' +
 '3) Set a new password, then log in here\n\n' +
 'Still nothing after a few minutes? Contact ' + this.securityCfg().supportEmail
 );
 this.showToast('Password reset email requested. Check your inbox/spam.');
        } catch (error) {
            console.error('Firebase password reset error:', error);
 this.recordAttempt('passwordReset', false);
 const code = error && error.code ? String(error.code) : '';
 let message = 'Unable to send reset email. Please try again.';
 if (code === 'auth/user-not-found') {
 // Avoid account enumeration wording while still guiding the user
 message =
 'If this email is registered, a reset link will arrive shortly. ' +
 'If you never registered, create an account first. Check Spam too.';
 } else if (code === 'auth/invalid-email') {
 message = 'That email address looks invalid. Please check and try again.';
 } else if (code === 'auth/too-many-requests') {
 message = 'Too many reset attempts. Please wait a while and try again.';
 } else if (code === 'auth/unauthorized-continue-uri' || code === 'auth/unauthorized-domain') {
 // Retry without custom continue URL (Firebase default handler)
 try {
 await this.auth.sendPasswordResetEmail(email);
 this.recordAttempt('passwordReset', true);
 if (modal) modal.remove();
 alert(
 'Password reset email sent (Firebase default link).\n\n' +
 'Check Inbox and Spam, then return here to log in.'
 );
            return;
 } catch (retryErr) {
 console.error('Password reset retry failed:', retryErr);
 message = 'Reset link blocked by Auth domain settings. Contact ' + this.securityCfg().supportEmail;
 }
 } else if (error && error.message) {
 message = 'Unable to send reset email: ' + error.message;
 }
 alert(message);
 }
 } finally {
 if (sendBtn) {
 sendBtn.disabled = false;
 sendBtn.textContent = 'Send Reset Link';
 }
 }
 }

 resetPassword() {
 // Local password reset removed — Firebase Auth only (CSG policy).
 if (!this.firebaseEnabled || !this.auth) {
 alert(
 'Firebase is required to reset passwords.\n\n' +
 'Contact ' + this.securityCfg().supportEmail + ' for help.'
 );
            return;
        }
 return this.resetPasswordFirebase();
    }

    async showDashboard() {
        document.getElementById('loginCard').style.display = 'none';
        const dash = document.getElementById('dashboardCard');
        if (dash) {
            dash.style.display = 'flex';
            dash.style.flexDirection = 'column';
        }
        this.setLoggedInShell(true);
        
        // Check challenge status and disable features if challenge is over
        this.updateDates(); // This will call checkChallengeStatus

        // Pull latest entries + recover any local saves that never reached Firebase
        if (this.firebaseEnabled) {
            try {
                await this.recoverUnsyncedActivitiesForCurrentUser({ silent: true });
                await this.syncStepEntriesFromFirebase();
            } catch (e) {
                console.warn('Dashboard entry sync skipped:', e);
            }
        }

        // Fix "Challenge Participant" placeholder names (e.g. Utkarsh after season reclaim)
        if (this.currentUser && this.isPlaceholderDisplayName(this.currentUser.name)) {
            const authUser = this.auth && this.auth.currentUser;
            await this.repairPlaceholderProfileName(this.currentUser, authUser);
        }
        
        this.updateDashboard();
        this.updateActivities();
        this.loadActivityFeed();
 this.switchInputMethod('counter');
 setTimeout(() => {
 this.initActivityMap();
 // Restore in-progress activity if the phone killed/reloaded the page while locked
 this.tryRestoreActivitySession();
 const startBtn = document.getElementById('startCounterBtn');
 if (startBtn && typeof startBtn.scrollIntoView === 'function') {
 startBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
 }
 }, 250);
    }

    setLoggedInShell(isLoggedIn) {
        document.body.classList.toggle('is-logged-in', !!isLoggedIn);
        document.querySelectorAll('.guest-only').forEach((el) => {
            el.style.display = isLoggedIn ? 'none' : '';
        });
    }

    /**
     * Show today's (or latest) day board for everyone — including signed-out visitors.
     */
    ensurePublicLeaderboardReady() {
        const dayNum = this.getChallengeDayNumber();
        const filter = dayNum >= 1 && dayNum <= 7 ? `day-${dayNum}` : 'total';
        document.querySelectorAll('.filter-btn, .day-filter-btn').forEach((b) => b.classList.remove('active'));
        const btn = document.querySelector(`.day-filter-btn[data-filter="${filter}"], .filter-btn[data-filter="${filter}"]`);
        if (btn) btn.classList.add('active');
        this.updateLeaderboard(filter, { skipRemoteSync: true });
    }

    /**
     * Rebuild the logged-in user's dashboard totals from their step entries.
     * Personal Today/progress includes approved + pending (so a just-saved walk
     * is visible). Rejected pace glitches are excluded but surfaced as a hint.
     */
    refreshCurrentUserTotalsFromEntries() {
        if (!this.currentUser) return { todayRejectedKm: 0, todayPending: false };
        if (!Array.isArray(this.stepEntries)) {
            this.stepEntries = this.loadStepEntriesSafely();
        }
        this.stepEntries = this.filterCurrentSeasonEntries(this.stepEntries || []);

        const mine = (this.stepEntries || []).filter((e) => this.entryBelongsToParticipant(e, this.currentUser));
        const forTotals = mine.filter((e) => {
            const st = e.status || 'pending';
            return st === 'approved' || st === 'pending';
        });
        const rejectedToday = mine.filter((e) => {
            if ((e.status || '') !== 'rejected') return false;
            try {
                return new Date(e.date).toDateString() === new Date().toDateString();
            } catch (err) {
                return false;
            }
        });

        // Zero then re-apply (approved + pending) so Today matches what the user saved
        this.currentUser.totalSteps = 0;
        this.currentUser.totalDistanceKm = 0;
        this.currentUser.totalCalories = 0;
        this.currentUser.dailySteps = {};
        this.currentUser.dailyDistanceKm = {};
        this.currentUser.dailyCalories = {};
        this.currentUser.dailyStats = {};
        for (const entry of forTotals) {
            this.applyEntryContribution(this.currentUser, entry, 1);
        }

        // Keep roster copy in sync for rank
        const idx = (this.participants || []).findIndex((p) =>
            (this.currentUser.uid && p.uid && String(p.uid) === String(this.currentUser.uid)) ||
            (this.currentUser.id && p.id && String(p.id) === String(this.currentUser.id)) ||
            (this.currentUser.employeeId && p.employeeId && String(p.employeeId) === String(this.currentUser.employeeId))
        );
        if (idx >= 0) {
            this.participants[idx] = this.stripSecretsFromParticipant({ ...this.currentUser });
        }

        try {
            localStorage.setItem('currentUser', JSON.stringify(this.stripSecretsFromParticipant(this.currentUser)));
        } catch (e) { /* ignore */ }

        const today = new Date().toDateString();
        const todayPending = forTotals.some((e) => {
            try {
                return (e.status || 'pending') === 'pending' && new Date(e.date).toDateString() === today;
            } catch (err) {
                return false;
            }
        });
        const todayRejectedKm = rejectedToday.reduce((s, e) => s + (Number(e.distanceKm) || 0), 0);
        return { todayRejectedKm, todayPending };
    }

    updateDashboard() {
        if (!this.currentUser) return;

        document.getElementById('userName').textContent = this.currentUser.name;

        // Always rebuild Today/Total from this user's entries (fixes 0% after a saved walk)
        const dashMeta = this.refreshCurrentUserTotalsFromEntries();

        const today = new Date().toDateString();
        if (!this.currentUser.dailySteps) this.currentUser.dailySteps = {};
        if (!this.currentUser.dailyDistanceKm) this.currentUser.dailyDistanceKm = {};

        let todaySteps = Number(this.currentUser.dailySteps[today]) || 0;
        let todayKm = Number(this.currentUser.dailyDistanceKm[today]) || 0;
        // If GPS distance exists but steps weren't stored, derive steps for the counter card
        const stepsPerKm = this.challengeConfig.stepsPerKm || 1300;
        if (todayKm > 0.005 && todaySteps <= 0) {
            todaySteps = Math.round(todayKm * stepsPerKm);
            this.currentUser.dailySteps[today] = todaySteps;
        }
        if (todaySteps > 0 && todayKm < 0.005) {
            todayKm = Number((todaySteps / stepsPerKm).toFixed(3));
            this.currentUser.dailyDistanceKm[today] = todayKm;
        }

        const totalSteps = this.currentUser.totalSteps || 0;

        // Always recalculate streak to ensure it's up to date
        const streak = this.calculateStreak(this.currentUser);
        this.currentUser.streak = streak;

        // Animated number counting
        this.animateNumber('todaySteps', todaySteps);
        this.animateNumber('totalSteps', totalSteps);
        this.animateNumber('streak', streak);

        // Progress is KM-based (challenge goal), with step-ratio fallback
        const goalKm = this.getDailyGoalKm();
        const goalSteps = this.getDailyGoalSteps();
        const dayNum = this.getChallengeDayNumber();
        const progressFromKm = goalKm > 0 ? (todayKm / goalKm) * 100 : 0;
        const progressFromSteps = goalSteps > 0 ? (todaySteps / goalSteps) * 100 : 0;
        const progress = Math.min(100, Math.max(progressFromKm, progressFromSteps));
        this.animateProgressBar(progress);
        const progressBadge = document.getElementById('progressBadge');
        if (progressBadge) {
            this.animateNumber('progressBadge', Math.round(progress), '%');
        }
        const remainingEl = document.getElementById('remainingSteps');
        if (remainingEl) {
            const kmLeft = Math.max(0, goalKm - todayKm);
            if (todayKm > 0.005 || progressFromKm >= progressFromSteps) {
                remainingEl.textContent = kmLeft <= 0.005
                    ? 'Goal complete'
                    : `${kmLeft.toFixed(2)} KM left`;
            } else {
                remainingEl.textContent = Math.max(0, goalSteps - todaySteps).toLocaleString() + ' steps left';
            }
        }
        const goalLabel = document.getElementById('dailyGoalLabel');
        if (goalLabel) {
            const dayPrefix = dayNum >= 1 && dayNum <= 7 ? `Day ${dayNum}: ` : '';
            const kmPart = todayKm > 0.005 ? ` · ${todayKm.toFixed(2)} KM today` : '';
            goalLabel.textContent = `${dayPrefix}${goalKm} KM goal${kmPart}`;
        }
        const progressTitle = document.getElementById('dailyGoalTitle');
        if (progressTitle) {
            progressTitle.textContent = dayNum >= 1 && dayNum <= 7
                ? `Day ${dayNum} · ${goalKm} KM`
                : 'Daily goal';
        }

        // Hint when today's walk exists but was rejected for the day board
        const hintEl = document.getElementById('dailyGoalHint') || document.getElementById('counterStatus');
        if (dashMeta.todayRejectedKm > 0.05 && progress < 5) {
            this.updateCounterHint(
                `Today's saved activity (~${dashMeta.todayRejectedKm.toFixed(2)} KM) was rejected for the day board (usually GPS pace). Try again with a steady GPS lock, or contact wow-csg@csgi.com.`
            );
        } else if (dashMeta.todayPending) {
            this.updateCounterHint('Today\'s activity is pending approval — it still counts on your dashboard.');
        }

        const todayCalories = this.currentUser.dailyCalories && this.currentUser.dailyCalories[today]
            ? this.currentUser.dailyCalories[today]
            : 0;
        const totalCalories = this.currentUser.totalCalories || 0;
        const todayCalEl = document.getElementById('todayCaloriesLabel');
        if (todayCalEl) {
            todayCalEl.textContent = `${Math.round(todayCalories).toLocaleString()} kcal today`;
        }
        const totalCalEl = document.getElementById('totalCaloriesLabel');
        if (totalCalEl) {
            totalCalEl.textContent = `${Math.round(totalCalories).toLocaleString()} kcal`;
        }

        // Update rank (approved-only leaderboard)
        const rank = this.getUserRank(this.currentUser);
        document.getElementById('rank').textContent = rank > 0 ? `#${rank}` : '-';

        // Update activities
        this.updateActivities();

        // Update motivation messages
        this.updateMotivationMessages(todaySteps, progress);

        // Update daily motivation quote
        this.updateDailyMotivation();
    }

    updateMotivationMessages(todaySteps, progress) {
        const motivationBadge = document.getElementById('motivationBadge');
        const badgeText = document.getElementById('badgeText');
        
        if (!motivationBadge || !badgeText) return;
        
        // Hide previous badge
        motivationBadge.style.display = 'none';
        
 // Use real Unicode glyphs (textContent does not decode HTML entities like &#128694;)
        let message = '';
 let icon = String.fromCodePoint(0x1F3AF); // target
        
        if (progress >= 100) {
 message = 'Amazing! You crushed your daily goal!';
 icon = String.fromCodePoint(0x1F3C6); // trophy
        } else if (progress >= 75) {
 message = 'Almost there! Keep pushing!';
 icon = String.fromCodePoint(0x1F525); // fire
        } else if (progress >= 50) {
 message = 'Halfway there! You\'re doing great!';
 icon = String.fromCodePoint(0x2B50); // star
        } else if (progress >= 25) {
 message = 'Great start! Every step counts!';
 icon = String.fromCodePoint(0x1F463); // footprints
        } else if (todaySteps > 0) {
 message = 'You\'re on the right track! Keep moving!';
 icon = String.fromCodePoint(0x1F6B6); // walker
        }
        
        if (message) {
            badgeText.textContent = message;
            const badgeIcon = motivationBadge.querySelector('.badge-icon');
            if (badgeIcon) badgeIcon.textContent = icon;
            motivationBadge.style.display = 'flex';
        }
    }

    updateDailyMotivation() {
        const motivations = [
            "The only bad workout is the one that didn't happen!",
            "Your body can do it. It's your mind you need to convince!",
            "Don't stop when you're tired. Stop when you're done!",
            "Take care of your body. It's the only place you have to live!",
            "The pain you feel today will be the strength you feel tomorrow!",
            "Success is the sum of small efforts repeated day in and day out!",
            "You don't have to be great to start, but you have to start to be great!",
            "The only way to do great work is to love what you do!",
 "Your limitation-it's only your imagination!",
            "Push yourself, because no one else is going to do it for you!",
            "Great things never come from comfort zones!",
            "Dream it. Wish it. Do it!",
            "Success doesn't just find you. You have to go out and get it!",
            "The harder you work for something, the greater you'll feel when you achieve it!",
            "Dream bigger. Do bigger!",
            "Don't wait for opportunity. Create it!",
            "Some people want it to happen, some wish it would happen, others make it happen!",
            "Great things never come from comfort zones!",
            "Do something today that your future self will thank you for!",
            "The only way to do great work is to love what you do!"
        ];
        
        const motivationText = document.getElementById('dailyMotivation');
        if (motivationText) {
            // Get a random motivation or cycle through them
            const savedIndex = localStorage.getItem('motivationIndex') || '0';
            let index = parseInt(savedIndex);
            index = (index + 1) % motivations.length;
            localStorage.setItem('motivationIndex', index.toString());
            
            motivationText.textContent = `"${motivations[index]}"`;
        }
    }

    animateNumber(elementId, targetValue, suffix = '') {
        const element = document.getElementById(elementId);
        if (!element) return;

        const currentValue = parseInt(element.textContent.replace(/[^0-9]/g, '')) || 0;
        const duration = 1000; // 1 second
        const startTime = performance.now();
        const difference = targetValue - currentValue;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(currentValue + (difference * easeOut));
            
            element.textContent = current.toLocaleString() + suffix;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                element.textContent = targetValue.toLocaleString() + suffix;
            }
        };

        requestAnimationFrame(animate);
    }

    animateProgressBar(targetProgress) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');
        
        if (!progressBar) return;

        const currentProgress = parseFloat(progressBar.style.width) || 0;
        const duration = 800;
        const startTime = performance.now();
        const difference = targetProgress - currentProgress;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const current = currentProgress + (difference * easeOut);
            
            progressBar.style.width = current + '%';
            if (progressText) {
                progressText.textContent = Math.round(current) + '%';
            }
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                progressBar.style.width = targetProgress + '%';
                if (progressText) {
                    progressText.textContent = Math.round(targetProgress) + '%';
                }
            }
        };

        requestAnimationFrame(animate);
    }

    handleManualScreenshotUpload(file) {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file!');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const imagePreview = document.getElementById('manualImagePreview');
            const previewImage = document.getElementById('manualPreviewImage');
            const uploadArea = document.getElementById('manualUploadArea');
            
            previewImage.src = e.target.result;
            imagePreview.style.display = 'block';
            uploadArea.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    resetManualScreenshot() {
        document.getElementById('manualScreenshot').value = '';
        document.getElementById('manualImagePreview').style.display = 'none';
        document.getElementById('manualUploadArea').style.display = 'block';
        document.getElementById('manualPreviewImage').src = '';
    }

    async addSteps() {
 alert('Manual entry is disabled. Please use the Live KM / Step Counter in the app.');
            return;
    }

    convertFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    showAdminDashboard() {
        // Check if we're on admin page
        if (window.location.pathname.includes('admin.html')) {
            document.getElementById('adminLoginCard').style.display = 'none';
            document.getElementById('adminDashboard').style.display = 'block';
        } else {
            // On main page
            document.getElementById('loginCard').style.display = 'none';
            document.getElementById('dashboardCard').style.display = 'none';
            const adminDashboard = document.getElementById('adminDashboard');
            if (adminDashboard) {
                adminDashboard.style.display = 'block';
            }
        }
        // Show validations tab by default
        this.showValidationsTab();
        this.updateAdminDashboard();
    }

    async updateAdminDashboard() {
        try {
 if (!this.requireAdmin()) {
 return;
 }
            if (this.firebaseEnabled) {
                // Pull participants + entries from Firebase (local cache is often empty on admin devices)
                await this.syncParticipantsFromFirebase({ skipEntries: false });
            }
            // Reload entries from localStorage to ensure we have the latest data
            this.stepEntries = this.loadStepEntries();
            // Prefer in-memory roster from Firebase; only fall back to cache if empty
            if (!Array.isArray(this.participants) || this.participants.length === 0) {
                this.participants = this.loadParticipants();
            }
            
            if (!Array.isArray(this.stepEntries)) {
                console.error('stepEntries is not an array!', typeof this.stepEntries, this.stepEntries);
                this.stepEntries = [];
            }

            // Auto-reject GPS-glitch / superhuman day finishes (e.g. 1 KM in 1:44)
            try {
                await this.rejectImplausibleApprovedEntries({ silent: true });
            } catch (paceErr) {
                console.warn('Pace auto-reject skipped:', paceErr);
            }
            
            // Optimize: Single pass through entries to count all stats
            let pending = 0, approved = 0, rejected = 0;
            for (let i = 0; i < this.stepEntries.length; i++) {
                const e = this.stepEntries[i];
                if (!e) continue;
                const status = e.status || 'pending';
                if (status === 'pending') pending++;
                else if (status === 'approved') approved++;
                else if (status === 'rejected') rejected++;
            }
            
            // Aggregate totals across all participants (fallback to approved step entries)
            const stepsPerKm = this.challengeConfig?.stepsPerKm || 1300;
            let totalSteps = 0;
            let totalKm = 0;
            let totalCalories = 0;
            const roster = Array.isArray(this.participants) ? this.participants : [];
            if (roster.length > 0) {
                roster.forEach((participant) => {
                    if (!participant) return;
                    const steps = Number(participant.totalSteps) || 0;
                    totalSteps += steps;

                    let km = Number(participant.totalDistanceKm);
                    if (!Number.isFinite(km) || km < 0) {
                        km = steps / stepsPerKm;
                    }
                    totalKm += km;

                    let calories = Number(participant.totalCalories);
                    if (!Number.isFinite(calories) || calories < 0) {
                        calories = this.estimateCaloriesBurned(km, null, null);
                    }
                    totalCalories += calories;
                });
            } else {
                // Fallback when participant docs aren't loaded yet — sum approved entries
                (this.stepEntries || []).forEach((e) => {
                    if (!e || (e.status || 'pending') !== 'approved') return;
                    totalSteps += Number(e.steps) || 0;
                    totalKm += Number(e.distanceKm) || 0;
                    totalCalories += Number(e.caloriesBurned) || 0;
                });
            }

            // Update stats immediately
            const pendingCountEl = document.getElementById('pendingCount');
            const approvedCountEl = document.getElementById('approvedCount');
            const rejectedCountEl = document.getElementById('rejectedCount');
            const totalStepsCountEl = document.getElementById('totalStepsCount');
            const totalKmCountEl = document.getElementById('totalKmCount');
            const totalCaloriesCountEl = document.getElementById('totalCaloriesCount');
            
            if (pendingCountEl) pendingCountEl.textContent = pending;
            if (approvedCountEl) approvedCountEl.textContent = approved;
            if (rejectedCountEl) rejectedCountEl.textContent = rejected;
            if (totalStepsCountEl) totalStepsCountEl.textContent = totalSteps.toLocaleString();
            if (totalKmCountEl) {
                totalKmCountEl.textContent = totalKm >= 100
                    ? Math.round(totalKm).toLocaleString()
                    : totalKm.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
            }
            if (totalCaloriesCountEl) {
                totalCaloriesCountEl.textContent = Math.round(totalCalories).toLocaleString();
            }

            // Get current filter or default to 'pending'
            const activeFilter = document.querySelector('.admin-filters .filter-btn.active');
            const filter = activeFilter ? (activeFilter.dataset.filter || 'pending') : 'pending';
            
            // Render validation list asynchronously to not block stats update
            setTimeout(() => this.renderValidationList(filter), 0);
        } catch (error) {
            console.error('Error in updateAdminDashboard:', error);
            alert('Error updating admin dashboard: ' + error.message);
        }
    }

    async filterAdminEntries(filter) {
        document.querySelectorAll('.admin-filters .filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        await this.renderValidationList(filter);
    }

    // User Management Functions
    showUsersTab() {
        document.querySelectorAll('.admin-tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('usersTab').classList.add('active');
        document.querySelector('[data-tab="users"]').classList.add('active');
        this.loadUsersList();
    }

    showValidationsTab() {
        document.querySelectorAll('.admin-tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('validationsTab').classList.add('active');
        document.querySelector('[data-tab="validations"]').classList.add('active');
    }

    async loadUsersList() {
 if (!this.requireAdmin()) {
 return;
 }
        const usersList = document.getElementById('usersList');
        if (!usersList) {
            console.error('usersList element not found!');
            return;
        }

        try {
            usersList.innerHTML = '<p class="no-entries">Loading users from Firebase…</p>';
            if (this.firebaseEnabled) {
                await this.syncParticipantsFromFirebase({ skipEntries: true });
                this.saveParticipantsCache();
            } else {
                this.participants = this.loadParticipants();
            }
            // Prefer in-memory roster from Firebase sync; fall back to cache
            if (!Array.isArray(this.participants) || this.participants.length === 0) {
                this.participants = this.loadParticipants();
            }
            console.log('Loaded participants:', this.participants);
            console.log('Participants count:', this.participants ? this.participants.length : 0);
            
            if (!this.participants || this.participants.length === 0) {
                usersList.innerHTML = '<p class="no-entries">No users registered yet. If entries exist under Validations, click Refresh Users again after Firebase finishes loading.</p>';
                return;
            }

            let html = '<div class="users-grid">';
            this.participants.forEach((user, index) => {
                try {
                    const totalSteps = user.totalSteps || 0;
                    const dailyStepsCount = user.dailySteps ? Object.keys(user.dailySteps).length : 0;
                    const lastActivity = user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : 'Never';
                    
                    // Use a safe identifier for the user
                    const userId = user.id || user.employeeId || `user_${index}`;
                    // Escape any special characters in the onclick handler
                    const safeUserId = String(userId).replace(/'/g, "\\'");
                    
                    html += `
                        <div class="user-card">
                            <div class="user-card-header">
                                <h4>${(user.name || 'Unknown User').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h4>
                                <button class="btn btn-small btn-primary" onclick="app.viewUserDetails('${safeUserId}')">View Details</button>
                            </div>
                            <div class="user-card-info">
                                <div class="user-info-item">
                                    <strong>Username:</strong> ${(user.username || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                                </div>
                                <div class="user-info-item">
                                    <strong>Email:</strong> ${(user.email || user.emailId || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                                </div>
                                <div class="user-info-item">
                                    <strong>Employee ID:</strong> ${(user.id || user.employeeId || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                                </div>
                                <div class="user-info-item">
                                    <strong>Total Steps:</strong> ${totalSteps.toLocaleString()}
                                </div>
                                <div class="user-info-item">
                                    <strong>Active Days:</strong> ${dailyStepsCount}
                                </div>
                                <div class="user-info-item">
                                    <strong>Last Activity:</strong> ${lastActivity}
                                </div>
                            </div>
                        </div>
                    `;
                } catch (error) {
                    console.error('Error rendering user card:', error, user);
                }
            });
            html += '</div>';
            usersList.innerHTML = html;
            console.log('Users list rendered successfully');
        } catch (error) {
            console.error('Error in loadUsersList:', error);
            usersList.innerHTML = `<p class="no-entries" style="color: red;">Error loading users: ${error.message}. Check console for details.</p>`;
        }
    }

    async viewUserDetails(userId) {
        // Reload participants to ensure we have the latest data
        this.participants = this.loadParticipants();
        if (this.firebaseEnabled) {
            await this.syncStepEntriesFromFirebase();
        } else {
            this.stepEntries = this.loadStepEntries();
        }
        // Prefer in-memory Firebase sync (do NOT reload slimmed localStorage over it)
        if (!Array.isArray(this.stepEntries)) {
            this.stepEntries = this.loadStepEntries();
        }
        
        // Handle user_ prefix from index-based IDs
        let searchId = userId;
        if (userId.startsWith('user_')) {
            const index = parseInt(userId.replace('user_', ''));
            const user = this.participants[index];
            if (user) {
                searchId = user.id || user.employeeId || userId;
            }
        }
        
        const user = this.participants.find(p => 
            (p.id && p.id === searchId) || 
            (p.employeeId && p.employeeId === searchId) ||
            (p.id && String(p.id) === String(searchId)) ||
            (p.employeeId && String(p.employeeId) === String(searchId)) ||
            (p.uid && String(p.uid) === String(searchId))
        );
        
        if (!user) {
            console.error('User not found. Search ID:', searchId, 'All participants:', this.participants);
            alert('User not found! Please try refreshing the users list.');
            return;
        }

        const actualUserId = user.id || user.employeeId || searchId;
        let userActivities = (this.stepEntries || []).filter((entry) =>
            this.entryBelongsToParticipant(entry, user)
        ).sort((a, b) => new Date(b.date) - new Date(a.date));

        // Re-fetch each outdoor entry path from Firebase so admin sees the stored route
        // (local cache may have dropped/coarsened GPS points).
        userActivities = await this.hydrateActivityPathsFromFirebase(userActivities);
        
        console.log('User activities found:', userActivities.length, 'for user:', actualUserId);

        const modal = document.getElementById('userDetailsModal');
        const content = document.getElementById('userDetailsContent');
        
        if (!modal || !content) return;

        // Leaderboard-aligned totals (approved only)
        this.recalculateParticipantTotalsFromApproved(user);
        const totalSteps = user.totalSteps || 0;
        const dailySteps = user.dailySteps || {};
        const dailyStepsCount = Object.keys(dailySteps).length;
        const streak = this.calculateStreak(user);
        
        const approvedList = userActivities.filter((a) => a.status === 'approved');
        const totalActivitySteps = approvedList.reduce((sum, a) => sum + (a.steps || 0), 0);
        const totalActivityKm = approvedList.reduce((sum, a) => sum + (Number(a.distanceKm) || 0), 0);
        const totalActivityCalories = approvedList.reduce((sum, a) => sum + (Number(a.caloriesBurned) || 0), 0);
        const approvedActivities = approvedList.length;
        const pendingActivities = userActivities.filter(a => !a.status || a.status === 'pending').length;
        const rejectedActivities = userActivities.filter(a => a.status === 'rejected').length;
        const outdoorCount = userActivities.filter(a => (a.trackingMode || '') === 'outdoor' || a.source === 'gps-counter').length;
        const treadmillCount = userActivities.filter(a => (a.trackingMode || '') === 'treadmill' || a.source === 'treadmill-counter').length;
        
        let activitiesHtml = '';
        if (userActivities.length > 0) {
            activitiesHtml = `
                <div class="user-activities-section">
                    <h3>Activity Details</h3>
                    
                    <!-- Activity Statistics Summary -->
                    <div class="activity-stats-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #003366;">${userActivities.length}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Total Entries</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #4caf50;">${approvedActivities}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Approved</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #ff9800;">${pendingActivities}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Pending</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #f44336;">${rejectedActivities}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Rejected</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #2196f3;">${totalActivitySteps.toLocaleString()}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Approved Steps</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #00897b;">${totalActivityKm.toFixed(2)}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Approved KM</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #e65100;">${Math.round(totalActivityCalories).toLocaleString()}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Approved Calories</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value" style="font-size: 1.1rem; font-weight: bold; color: #5e35b1;">${outdoorCount} / ${treadmillCount}</div>
                            <div class="stat-label" style="font-size: 0.85rem; color: #666;">Outdoor / Treadmill</div>
                        </div>
                    </div>
                    
                    <div class="activities-list" style="max-height: 560px; overflow-y: auto;">
            `;
            
            userActivities.forEach((activity) => {
                const date = new Date(activity.date);
                const dateStr = date.toLocaleDateString();
                const timeStr = date.toLocaleTimeString();
                const status = activity.status || 'pending';
                const statusClass = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending';
                const activityType = this.getActivityTypeLabel(activity);
                const sourceDisplay = this.getActivitySourceLabel(activity);
                const distanceKm = Number(activity.distanceKm);
                const calories = Number(activity.caloriesBurned);
                const durationLabel = this.formatDurationClock(activity.durationSec);
                const pathPoints = Array.isArray(activity.path) ? activity.path.length : 0;
                const speed = activity.treadmillSpeedKmh != null ? Number(activity.treadmillSpeedKmh) : null;
                const mapDomId = this.adminMapDomId(activity.id);
                const validGpsCount = this.normalizeActivityPath(activity.path).length;
                const safeActivityId = this.escapeHtml(activity.id || '');
                const safeUserIdAttr = this.escapeHtml(String(actualUserId));
                
                let validatedDateStr = '';
                if (activity.validatedAt) {
                    try {
                        validatedDateStr = new Date(activity.validatedAt).toLocaleString();
                    } catch (e) {
                        validatedDateStr = activity.validatedAt;
                    }
                }
                
                let modifiedDateStr = '';
                if (activity.lastModifiedAt) {
                    try {
                        modifiedDateStr = new Date(activity.lastModifiedAt).toLocaleString();
                    } catch (e) {
                        modifiedDateStr = activity.lastModifiedAt;
                    }
                }
                
                activitiesHtml += `
                    <div class="activity-entry ${statusClass}" style="border: 2px solid ${status === 'approved' ? '#4caf50' : status === 'rejected' ? '#f44336' : '#ff9800'}; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: white;">
                        <div class="activity-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                            <div>
                                <span class="activity-date" style="font-weight: bold; color: #003366; font-size: 1rem;">${dateStr} ${timeStr}</span>
                                <div style="margin-top: 6px;">
                                    <span class="activity-type-badge">${this.escapeHtml(activityType)}</span>
                                </div>
                                <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
                                    Entry ID: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem;">${safeActivityId || 'N/A'}</code>
                                </div>
                            </div>
                            <span class="activity-status ${statusClass}" style="padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 0.9rem; background: ${status === 'approved' ? '#e8f5e9' : status === 'rejected' ? '#ffebee' : '#fff3e0'}; color: ${status === 'approved' ? '#2e7d32' : status === 'rejected' ? '#c62828' : '#e65100'};">
                                ${status.toUpperCase()}
                            </span>
                        </div>
                        <div class="activity-details" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                            <div class="detail-item">
                                <strong style="color: #003366;">Activity:</strong>
                                <span>${this.escapeHtml(activityType)}</span>
                            </div>
                            <div class="detail-item">
                                <strong style="color: #003366;">Steps:</strong>
                                <span style="font-size: 1.1rem; font-weight: bold; color: #2196f3;">${(activity.steps || 0).toLocaleString()}</span>
                            </div>
                            <div class="detail-item">
                                <strong style="color: #003366;">Distance:</strong>
                                <span style="font-weight: bold; color: #00897b;">${Number.isFinite(distanceKm) ? distanceKm.toFixed(3) : '0.000'} km</span>
                            </div>
                            <div class="detail-item">
                                <strong style="color: #003366;">Calories:</strong>
                                <span style="font-weight: bold; color: #e65100;">${Number.isFinite(calories) ? Math.round(calories).toLocaleString() : '0'} kcal</span>
                            </div>
                            <div class="detail-item">
                                <strong style="color: #003366;">Duration:</strong>
                                <span>${durationLabel}</span>
                            </div>
                            <div class="detail-item">
                                <strong style="color: #003366;">Source:</strong>
                                <span>${this.escapeHtml(sourceDisplay)}</span>
                            </div>
                            ${speed != null && Number.isFinite(speed) ? `
                                <div class="detail-item">
                                    <strong style="color: #003366;">Treadmill Speed:</strong>
                                    <span>${speed.toFixed(1)} km/h</span>
                                </div>
                            ` : ''}
                            ${pathPoints > 0 ? `
                                <div class="detail-item">
                                    <strong style="color: #003366;">GPS Points:</strong>
                                    <span>${pathPoints}${validGpsCount !== pathPoints ? ` (${validGpsCount} usable)` : ''}</span>
                                </div>
                            ` : ''}
                        </div>

                        ${validGpsCount > 1 ? `
                            <div class="admin-gps-map-section" style="margin: 14px 0 8px;">
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
                                    <strong style="color: #003366;">GPS Route Map</strong>
                                    <button type="button" class="btn btn-small btn-secondary" onclick="app.refitAdminActivityMap('${mapDomId}')">Fit route</button>
                                </div>
                                <div id="${mapDomId}" class="admin-gps-map" style="height: 360px; width: 100%; border-radius: 8px; border: 1px solid #cfd8dc; background: #e8eef3;"></div>
                                <p style="margin: 6px 0 0; font-size: 0.8rem; color: #666;">Blue = start · Red = end · ${validGpsCount} GPS points (full saved route)</p>
                            </div>
                        ` : pathPoints > 1 ? `
                            <div class="admin-gps-map-section" style="margin: 12px 0; padding: 10px; background: #fff8e1; border-radius: 6px; color: #6d4c41; font-size: 0.9rem;">
                                GPS points are stored but coordinates could not be read for mapping.
                            </div>
                        ` : pathPoints === 1 ? `
                            <div class="admin-gps-map-section" style="margin: 12px 0; padding: 10px; background: #fff8e1; border-radius: 6px; color: #6d4c41; font-size: 0.9rem;">
                                Only 1 GPS point recorded — not enough to draw a route.
                            </div>
                        ` : (activity.trackingMode === 'outdoor' || activity.source === 'gps-counter') ? `
                            <div class="admin-gps-map-section" style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px; color: #666; font-size: 0.9rem;">
                                No GPS path saved for this outdoor activity.
                            </div>
                        ` : ''}
                        
                        ${activity.screenshot ? `
                            <div class="screenshot-section" style="margin: 12px 0; padding: 12px; background: #f8f9fa; border-radius: 6px;">
                                <strong style="color: #003366; display: block; margin-bottom: 8px;">Screenshot:</strong>
                                <img src="${activity.screenshot}" 
                                     alt="Activity screenshot" 
                                     class="activity-screenshot" 
                                     onclick="this.style.maxWidth = this.style.maxWidth === '100%' ? '200px' : '100%'; this.style.cursor = 'pointer';"
                                     style="max-width: 200px; border-radius: 6px; cursor: pointer; border: 2px solid #ddd; transition: all 0.3s ease;"
                                     title="Click to enlarge">
                                <div style="margin-top: 8px; font-size: 0.85rem; color: #666;">Click image to enlarge</div>
                            </div>
                        ` : ''}
                        
                        ${activity.notes ? `
                            <div class="notes-section" style="margin: 12px 0; padding: 12px; background: #e3f2fd; border-radius: 6px; border-left: 4px solid #2196f3;">
                                <strong style="color: #003366; display: block; margin-bottom: 6px;">Notes:</strong>
                                <div style="color: #555; white-space: pre-wrap;">${this.escapeHtml(activity.notes)}</div>
                            </div>
                        ` : ''}
                        
                        ${activity.validatedBy ? `
                            <div class="validation-info" style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px; font-size: 0.9rem;">
                                <strong style="color: #003366;">Validated by:</strong> ${this.escapeHtml(activity.validatedBy)}
                                ${validatedDateStr ? ` on ${validatedDateStr}` : ''}
                            </div>
                        ` : ''}
                        
                        ${activity.lastModifiedBy ? `
                            <div class="modification-info" style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px; font-size: 0.9rem;">
                                <strong style="color: #003366;">Last modified by:</strong> ${this.escapeHtml(activity.lastModifiedBy)}
                                ${modifiedDateStr ? ` on ${modifiedDateStr}` : ''}
                            </div>
                        ` : ''}
                        
                        <div class="activity-actions" style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
                            ${status === 'pending' ? `
                                <button type="button" class="btn btn-small btn-success" onclick="app.validateEntry('${safeActivityId}', 'approved', '${safeUserIdAttr}')" title="Approve this entry">Approve</button>
                                <button type="button" class="btn btn-small btn-danger" onclick="app.validateEntry('${safeActivityId}', 'rejected', '${safeUserIdAttr}')" title="Reject this entry">Reject</button>
                            ` : status === 'approved' ? `
                                <button type="button" class="btn btn-small btn-danger" onclick="app.validateEntry('${safeActivityId}', 'rejected', '${safeUserIdAttr}')" title="Reject this entry">Reject</button>
                            ` : `
                                <button type="button" class="btn btn-small btn-success" onclick="app.validateEntry('${safeActivityId}', 'approved', '${safeUserIdAttr}')" title="Approve this entry">Approve</button>
                            `}
                            <button type="button" class="btn btn-small btn-secondary" onclick="app.openEditActivityModal('${safeActivityId}', '${safeUserIdAttr}')" title="Update activity details">Edit Activity</button>
                            <button type="button" class="btn btn-small btn-danger" onclick="if(confirm('Are you sure you want to delete this activity?')) { app.deleteUserActivity('${safeActivityId}', '${safeUserIdAttr}'); }" title="Delete this activity">Delete</button>
                        </div>
                    </div>
                `;
            });
            
            activitiesHtml += `
                    </div>
                </div>
            `;
        } else {
            activitiesHtml = `
                <div class="user-activities-section">
                    <h3>Activity Details</h3>
                    <div style="padding: 30px; text-align: center; background: #f8f9fa; border-radius: 8px; margin-top: 15px;">
                        <p style="font-size: 1.1rem; color: #666; margin: 0;">No activities recorded yet.</p>
                        <p style="font-size: 0.9rem; color: #999; margin-top: 8px;">This user hasn't submitted any step entries.</p>
                    </div>
                </div>
            `;
        }

        content.innerHTML = `
            <form id="editUserForm" onsubmit="event.preventDefault(); app.saveUserDetails('${actualUserId}');">
                <div class="form-section">
 <h3> Personal Information</h3>
                    <div class="form-group">
                        <label>Full Name <span class="required">*</span></label>
                        <input type="text" id="editUserName" value="${user.name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Email <span class="required">*</span></label>
                        <input type="email" id="editUserEmail" value="${user.email || user.emailId || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Employee ID <span class="required">*</span></label>
                        <input type="text" id="editUserEmployeeId" value="${user.id || user.employeeId || ''}" required>
                    </div>
                </div>

                <div class="form-section">
 <h3> Account Credentials</h3>
                    <div class="form-group">
                        <label>Username <span class="required">*</span></label>
                        <input type="text" id="editUserUsername" value="${user.username || ''}" required>
                    </div>
                    <div class="form-group">
 <label>Password</label>
 <p class="form-hint" style="margin-bottom: 8px;">Passwords are managed by Firebase Auth only. They are never stored in this app.</p>
 <button type="button" class="btn btn-secondary" onclick="app.sendUserPasswordResetEmail(decodeURIComponent('${encodeURIComponent(user.email || user.emailId || '')}'))">Send password reset email</button>
                    </div>
                </div>

                <div class="form-section">
                    <h3>Statistics</h3>
                    <div class="user-stats-grid">
                        <div class="stat-item">
                            <strong>Total Steps:</strong> ${totalSteps.toLocaleString()}
                        </div>
                        <div class="stat-item">
                            <strong>Total Distance:</strong> ${Number(user.totalDistanceKm || 0).toFixed(2)} km
                        </div>
                        <div class="stat-item">
                            <strong>Total Calories:</strong> ${Math.round(user.totalCalories || 0).toLocaleString()} kcal
                        </div>
                        <div class="stat-item">
                            <strong>Active Days:</strong> ${dailyStepsCount}
                        </div>
                        <div class="stat-item">
                            <strong>Current Streak:</strong> ${streak} days
                        </div>
                        <div class="stat-item">
                            <strong>Last Activity:</strong> ${user.lastActivity ? new Date(user.lastActivity).toLocaleString() : 'Never'}
                        </div>
                    </div>
                </div>

                ${activitiesHtml}

                <div class="form-actions">
 <button type="submit" class="btn btn-primary"> Save Changes</button>
                    <button type="button" class="btn btn-secondary" onclick="app.closeUserDetailsModal()">Cancel</button>
 <button type="button" class="btn btn-danger" onclick="app.deleteUser('${actualUserId}')"> Delete User</button>
                </div>
            </form>
        `;

        modal.style.display = 'flex';
        // Draw GPS routes after modal is visible (Leaflet needs non-zero size)
        const drawMaps = () => this.renderAdminActivityMaps(userActivities);
        requestAnimationFrame(() => {
            setTimeout(drawMaps, 50);
            setTimeout(drawMaps, 250);
            setTimeout(drawMaps, 600);
        });
    }

    adminMapDomId(entryId) {
        return `adminGpsMap_${String(entryId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }

    /**
     * Pull fresh path arrays from Firestore for outdoor entries so admin maps
     * are not limited to a previously over-slimmed localStorage cache.
     */
    async hydrateActivityPathsFromFirebase(activities) {
        if (!this.firebaseEnabled || !this.db || !Array.isArray(activities) || !activities.length) {
            return activities || [];
        }
        const out = [];
        for (const activity of activities) {
            const copy = { ...activity };
            const needsPath = (copy.trackingMode === 'outdoor' || copy.source === 'gps-counter' || copy.source === 'native')
                && (!Array.isArray(copy.path) || copy.path.length < 2 || copy.path.length < 50);
            if (needsPath && copy.id) {
                try {
                    const doc = await this.stepEntriesCol().doc(copy.id).get();
                    if (doc.exists) {
                        const remote = doc.data() || {};
                        if (Array.isArray(remote.path) && remote.path.length > (copy.path || []).length) {
                            copy.path = remote.path;
                        } else if (Array.isArray(remote.path) && remote.path.length >= 2 && (!copy.path || copy.path.length < 2)) {
                            copy.path = remote.path;
                        }
                    }
                } catch (err) {
                    console.warn('Could not hydrate GPS path for', copy.id, err);
                }
            }
            out.push(copy);
        }
        return out;
    }

    normalizeActivityPath(path) {
        if (!Array.isArray(path)) return [];
        return path
            .map((p) => {
                if (!p || typeof p !== 'object') return null;
                const lat = Number(p.lat != null ? p.lat : p.latitude);
                const lng = Number(p.lng != null ? p.lng : (p.longitude != null ? p.longitude : p.lon));
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
                return { lat, lng, t: p.t || p.timestamp || null };
            })
            .filter(Boolean);
    }

    destroyAdminActivityMaps() {
        if (!Array.isArray(this._adminActivityMaps)) return;
        this._adminActivityMaps.forEach((entry) => {
            try {
                const map = entry && entry.map ? entry.map : entry;
                if (map && typeof map.remove === 'function') map.remove();
            } catch (err) {
                /* ignore */
            }
        });
        this._adminActivityMaps = [];
    }

    refitAdminActivityMap(mapDomId) {
        const found = (this._adminActivityMaps || []).find((m) => m && m.id === mapDomId);
        if (!found || !found.map || !found.bounds) return;
        try {
            found.map.invalidateSize();
            found.map.fitBounds(found.bounds, { padding: [24, 24] });
        } catch (err) {
            console.warn('refitAdminActivityMap failed:', err);
        }
    }

    renderAdminActivityMaps(activities) {
        this.destroyAdminActivityMaps();
        this._adminActivityMaps = [];

        if (typeof L === 'undefined') {
            console.warn('Leaflet not loaded — admin GPS maps unavailable');
            (activities || []).forEach((activity) => {
                const el = document.getElementById(this.adminMapDomId(activity.id));
                if (el) {
                    el.innerHTML = '<div style="padding:16px;color:#c62828;font-size:0.9rem;">Map library failed to load. Hard-refresh admin page (Ctrl+F5).</div>';
                }
            });
            return;
        }

        (activities || []).forEach((activity) => {
            const path = this.normalizeActivityPath(activity.path);
            if (path.length < 2) return;
            const mapId = this.adminMapDomId(activity.id);
            const el = document.getElementById(mapId);
            if (!el) return;

            // Avoid double-init if Leaflet left a map on this node
            if (el._leaflet_id) {
                el.innerHTML = '';
                delete el._leaflet_id;
            }

            try {
                const map = L.map(el, {
                    zoomControl: true,
                    attributionControl: true
                });
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; OpenStreetMap'
                }).addTo(map);
                const latLngs = path.map((p) => [p.lat, p.lng]);
                const line = L.polyline(latLngs, {
                    color: '#0d9488',
                    weight: 4,
                    opacity: 0.95,
                    lineJoin: 'round',
                    lineCap: 'round'
                }).addTo(map);
                // Start pin
                L.circleMarker(latLngs[0], {
                    radius: 7,
                    color: '#0d47a1',
                    fillColor: '#42a5f5',
                    fillOpacity: 1,
                    weight: 2
                }).addTo(map).bindTooltip('Start');
                // End pin (classic marker so it is obvious)
                L.marker(latLngs[latLngs.length - 1], {
                    title: 'End'
                }).addTo(map).bindTooltip('End');
                // Midway dots for longer routes so the track is obvious
                if (latLngs.length >= 8) {
                    const step = Math.max(1, Math.floor(latLngs.length / 12));
                    for (let i = step; i < latLngs.length - 1; i += step) {
                        L.circleMarker(latLngs[i], {
                            radius: 3,
                            color: '#115e59',
                            fillColor: '#5eead4',
                            fillOpacity: 0.9,
                            weight: 1
                        }).addTo(map);
                    }
                }
                const bounds = line.getBounds();
                map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
                this._adminActivityMaps.push({ id: mapId, map, bounds });
                [80, 250, 600, 1200].forEach((ms) => {
                    setTimeout(() => {
                        try {
                            map.invalidateSize();
                            map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
                        } catch (e) { /* ignore */ }
                    }, ms);
                });
            } catch (err) {
                console.warn('Failed to render admin GPS map:', err);
                el.innerHTML = `<div style="padding:16px;color:#c62828;font-size:0.9rem;">Could not draw map: ${this.escapeHtml(err.message || 'unknown error')}</div>`;
            }
        });
    }

    saveUserDetails(userId) {
        // Reload participants to ensure we have the latest data
        this.participants = this.loadParticipants();
        
        // Handle user_ prefix from index-based IDs
        let searchId = userId;
        if (userId.startsWith('user_')) {
            const index = parseInt(userId.replace('user_', ''));
            const userByIndex = this.participants[index];
            if (userByIndex) {
                searchId = userByIndex.id || userByIndex.employeeId || userId;
            }
        }
        
        const user = this.participants.find(p => 
            (p.id && p.id === searchId) || 
            (p.employeeId && p.employeeId === searchId) ||
            (p.id && String(p.id) === String(searchId)) ||
            (p.employeeId && String(p.employeeId) === String(searchId))
        );
        
        if (!user) {
            console.error('User not found for save. Search ID:', searchId);
            alert('User not found!');
            return;
        }

        const name = document.getElementById('editUserName').value.trim();
        const email = document.getElementById('editUserEmail').value.trim();
        const employeeId = document.getElementById('editUserEmployeeId').value.trim();
        const username = document.getElementById('editUserUsername').value.trim();

        if (!name || !email || !employeeId || !username) {
            alert('Name, Email, Employee ID, and Username are required!');
            return;
        }

        // Check for duplicate username (excluding current user)
        const duplicateUsername = this.participants.find(p => 
            p.username && p.username.toLowerCase() === username.toLowerCase() && 
            (p.id !== userId && p.employeeId !== userId)
        );
        if (duplicateUsername) {
            alert('Username already exists! Please choose a different username.');
            return;
        }

        // Check for duplicate email (excluding current user)
        const duplicateEmail = this.participants.find(p => 
            (p.email || p.emailId) && (p.email || p.emailId).toLowerCase() === email.toLowerCase() && 
            (p.id !== userId && p.employeeId !== userId)
        );
        if (duplicateEmail) {
            alert('Email already exists! Please use a different email.');
            return;
        }

 // Update user profile fields only (never store passwords locally)
        user.name = name;
        user.email = email;
        user.emailId = email;
        user.id = employeeId;
        user.employeeId = employeeId;
        user.username = username;
 delete user.password;
 delete user.passwordHash;

        // Save to localStorage
        const index = this.participants.findIndex(p => 
            (p.id && p.id === searchId) || 
            (p.employeeId && p.employeeId === searchId) ||
            (p.id && String(p.id) === String(searchId)) ||
            (p.employeeId && String(p.employeeId) === String(searchId))
        );
        if (index !== -1) {
 this.participants[index] = this.stripSecretsFromParticipant(user);
            this.saveParticipantsCache();
            
            // If this is the current user, update currentUser
            if (this.currentUser && (this.currentUser.id === searchId || this.currentUser.employeeId === searchId)) {
 this.currentUser = this.stripSecretsFromParticipant(user);
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
 }

 if (user.uid && this.firebaseEnabled) {
 this.participantsCol().doc(user.uid).set(this.stripSecretsFromParticipant(user), { merge: true }).catch((err) => {
 console.warn('Failed to sync profile edit to Firebase:', err);
 });
            }

            alert('User details updated successfully!');
            this.closeUserDetailsModal();
            this.loadUsersList();
        } else {
            alert('Error: Could not find user to update!');
        }
    }

 async sendUserPasswordResetEmail(email) {
 if (!this.requireAdmin()) {
 return;
 }
 const target = (email || '').trim();
 if (!target || !this.isEmail(target)) {
 alert('A valid email is required to send a Firebase password reset.');
 return;
 }
 if (!this.firebaseEnabled || !this.auth) {
 alert('Firebase is required to send password reset emails.');
 return;
 }
 try {
 await this.auth.sendPasswordResetEmail(target);
 this.showToast('Password reset email sent to ' + target);
 } catch (error) {
 console.error('Admin password reset error:', error);
 alert('Unable to send reset email. Check the address and Firebase Auth settings.');
 }
 }

    deleteUser(userId) {
 if (!this.requireAdmin()) {
 return;
 }
        if (!confirm('Are you sure you want to delete this user? This will also delete all their step entries. This action cannot be undone!')) {
            return;
        }

        const user = this.participants.find(p => (p.id === userId) || (p.employeeId === userId));
        if (!user) {
            alert('User not found!');
            return;
        }

        // Delete user from participants
        this.participants = this.participants.filter(p => (p.id !== userId) && (p.employeeId !== userId));
        this.saveParticipantsCache();
        if (this.firebaseEnabled && user.uid) {
 this.participantsCol().doc(user.uid).delete().catch((error) => {
                console.warn('Failed to delete participant from Firebase:', error);
            });
        }

        // Delete all step entries for this user
        this.stepEntries = this.loadStepEntries();
        const removedEntries = this.stepEntries.filter(entry =>
            entry.userId === userId || entry.userId === user.id || entry.userId === user.employeeId
        );
        this.stepEntries = this.stepEntries.filter(entry => 
            entry.userId !== userId && entry.userId !== user.id && entry.userId !== user.employeeId
        );
        this.saveStepEntries();
        if (removedEntries.length > 0) {
            removedEntries.forEach(entry => this.deleteStepEntryFromFirebase(entry.id));
        }

        alert('User and all their activities have been deleted!');
        this.closeUserDetailsModal();
        this.loadUsersList();
        this.updateAdminDashboard();
    }

 /**
 * Admin: wipe local caches and empty the current-season Firebase collections
 * for docs this client can delete. Starts a fresh challenge roster in the UI.
 */
 async clearAllChallengeUserData() {
 if (!this.requireAdmin()) {
 return;
 }

 const confirmed = confirm(
 'Clear ALL challenge user data for this season?\n\n' +
 'This removes participants and step entries from the app/local cache.\n' +
 'This cannot be undone.'
 );
 if (!confirmed) return;

 const confirmedAgain = confirm('Final confirmation: delete all current-season user data now?');
 if (!confirmedAgain) return;

 try {
 let deletedParticipants = 0;
 let deletedEntries = 0;

 if (this.firebaseEnabled && this.db) {
 await this.syncParticipantsFromFirebase();
 await this.syncStepEntriesFromFirebase();

 const participantSnap = await this.participantsCol().get();
 for (const docSnap of participantSnap.docs) {
 try {
 await docSnap.ref.delete();
 deletedParticipants += 1;
 } catch (err) {
 console.warn('Could not delete participant', docSnap.id, err);
 }
 }

 const entrySnap = await this.stepEntriesCol().get();
 for (const docSnap of entrySnap.docs) {
 try {
 await docSnap.ref.delete();
 deletedEntries += 1;
 } catch (err) {
 console.warn('Could not delete step entry', docSnap.id, err);
 }
 }
 }

 this.participants = [];
 this.stepEntries = [];
 this.currentUser = null;
 this.saveParticipantsCache();
 this.saveStepEntries();
 [
 'currentUser',
 'participants',
 'participants_cache',
 'stepEntries',
 'stepEntries_cache',
 'registrationAttempts',
 'passwordResetAttempts'
 ].forEach((key) => localStorage.removeItem(key));
 localStorage.setItem('wowcsg_data_season', this.dataSeason);

 this.loadUsersList();
 this.updateAdminDashboard();
 if (typeof this.updateLeaderboard === 'function') {
 this.updateLeaderboard();
 }

 alert(
 `Challenge user data cleared.\n\n` +
 `Season collections wiped where permitted:\n` +
 `- Participants deleted: ${deletedParticipants}\n` +
 `- Step entries deleted: ${deletedEntries}\n\n` +
 `Note: Firebase Auth login accounts (email/password) are separate.\n` +
 `If someone needs a fully new Auth account, delete users in Firebase Console → Authentication.`
 );
 } catch (error) {
 console.error('clearAllChallengeUserData failed:', error);
 alert('Failed to clear all data: ' + (error.message || error));
 }
 }

    async deleteUserActivity(activityId, userId) {
        if (!this.requireAdmin()) return;
        if (!confirm('Are you sure you want to delete this activity entry?')) {
            return;
        }

        this.stepEntries = this.loadStepEntries();
        const activity = this.stepEntries.find(e => e.id === activityId);
        let user = null;

        if (activity) {
            user = this.findParticipantForEntry(activity) ||
                this.participants.find(p => (p.id === userId) || (p.employeeId === userId) || (p.uid === userId));

            this.stepEntries = this.stepEntries.filter(e => e.id !== activityId);
            this.saveStepEntries();
            await this.deleteStepEntryFromFirebase(activityId);
            await this.removeActivityFeedForEntry(activityId);

            if (user) {
                this.recalculateParticipantTotalsFromApproved(user);
                this.saveParticipantsCache();
                await this.syncParticipantToFirebase(user);
            }
        }

        await this.refreshSurfacesAfterAdminActivityChange(user);
        alert('Activity deleted successfully!');
        this.viewUserDetails(userId);
    }

    closeUserDetailsModal() {
        this.destroyAdminActivityMaps();
        const modal = document.getElementById('userDetailsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Help Modal Functions
    showHelpModal() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    closeHelpModal() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    openEmailClient() {
 const subject = encodeURIComponent('WOW-CSG Fitness Challenge Support');
        const body = encodeURIComponent('Hello,\n\nI need help with:\n\n');
        window.location.href = `mailto:wow-csg@csgi.com?subject=${subject}&body=${body}`;
    }

    async renderValidationList(filter = 'pending') {
        try {
            const validationList = document.getElementById('validationList');
            if (!validationList) {
                console.error('validationList element not found!');
                return;
            }

            if (this.firebaseEnabled) {
                if (!Array.isArray(this.stepEntries) || this.stepEntries.length === 0) {
                    await this.syncStepEntriesFromFirebase();
                }
            } else {
                // Ensure entries are loaded for local-only mode
                this.stepEntries = this.loadStepEntries();
            }
            
            // Show loading state
            validationList.innerHTML = '<p class="no-entries">Loading entries...</p>';

            // Use requestAnimationFrame to prevent blocking UI
            requestAnimationFrame(() => {
                // Optimize: Single pass filtering (no array copy needed)
                let entries = [];
                const filterLower = filter.toLowerCase();
                
                for (let i = 0; i < this.stepEntries.length; i++) {
                    const e = this.stepEntries[i];
                    if (!e) continue;
                    if (filter === 'all' || (e.status || 'pending').toLowerCase() === filterLower) {
                        entries.push(e);
                    }
                }

                // Optimized sorting - use getTime() for faster comparison
                entries.sort((a, b) => {
                    const dateA = a.date ? new Date(a.date).getTime() : 0;
                    const dateB = b.date ? new Date(b.date).getTime() : 0;
                    return dateB - dateA;
                });

                if (entries.length === 0) {
                    const filterText = filter === 'all' ? '' : ` for "${filter}" status`;
                    validationList.innerHTML = `<p class="no-entries">No entries found${filterText}. Total entries in system: ${this.stepEntries.length}</p>`;
                    return;
                }

                // Limit initial render for performance (show first 100 entries)
                const maxEntries = 100;
                const entriesToRender = entries.slice(0, maxEntries);
                
                // Batch create HTML string (faster than individual DOM operations)
                const htmlParts = [];
                for (let i = 0; i < entriesToRender.length; i++) {
                    htmlParts.push(this.createEntryHTML(entriesToRender[i]));
                }
                
                let html = htmlParts.join('');
                
                // Add pagination info if there are more entries
                if (entries.length > maxEntries) {
                    html += `<p class="pagination-info" style="text-align: center; padding: 15px; color: #666; font-size: 0.9rem;">Showing ${maxEntries} of ${entries.length} entries. Use filters to narrow results.</p>`;
                }
                
                validationList.innerHTML = html;
            });
        } catch (error) {
            console.error('Error in renderValidationList:', error);
            const validationList = document.getElementById('validationList');
            if (validationList) {
                validationList.innerHTML = `<p class="no-entries" style="color: red;">Error rendering entries: ${error.message}</p>`;
            }
        }
    }

    createEntryHTML(entry) {
        if (!entry) return '';
        
        const userName = entry.userName || entry.name || 'Unknown User';
        const userEmail = entry.userEmail || entry.email || 'No email';
        const userId = entry.userId || entry.id || 'unknown';
        const steps = entry.steps || 0;
        const distanceKm = Number(entry.distanceKm);
        const calories = Number(entry.caloriesBurned);
        const entryDate = entry.date || new Date().toISOString();
        const entryStatus = entry.status || 'pending';
        const activityType = this.getActivityTypeLabel(entry);
        const sourceLabel = this.getActivitySourceLabel(entry);
        const durationLabel = this.formatDurationClock(entry.durationSec);
        const safeEntryId = this.escapeHtml(entry.id || '');
        
        let date;
        try {
            date = new Date(entryDate);
            if (isNaN(date.getTime())) date = new Date();
        } catch (e) {
            date = new Date();
        }
        
        const statusClass = entryStatus === 'approved' ? 'approved' : entryStatus === 'rejected' ? 'rejected' : 'pending';
        
        let formattedDate;
        try {
            formattedDate = date.toLocaleString();
        } catch (e) {
            formattedDate = entryDate;
        }
        
        let validatedDateStr = '';
        if (entry.validatedAt) {
            try {
                const validatedDate = new Date(entry.validatedAt);
                if (!isNaN(validatedDate.getTime())) {
                    validatedDateStr = validatedDate.toLocaleString();
                }
            } catch (e) {
                validatedDateStr = entry.validatedAt;
            }
        }
        
        let modifiedDateStr = '';
        if (entry.lastModifiedAt) {
            try {
                const modifiedDate = new Date(entry.lastModifiedAt);
                if (!isNaN(modifiedDate.getTime())) {
                    modifiedDateStr = modifiedDate.toLocaleString();
                }
            } catch (e) {
                modifiedDateStr = entry.lastModifiedAt;
            }
        }
        
        return `
            <div class="validation-entry ${statusClass}">
                <div class="entry-header">
                    <div class="entry-info">
                        <h4>${this.escapeHtml(userName)} (${this.escapeHtml(userEmail)})</h4>
                        <p class="entry-date">${formattedDate}</p>
                        <p class="entry-id" style="font-size: 0.8rem; color: #666;">Entry ID: ${safeEntryId || 'N/A'}</p>
                        <p class="entry-user-id" style="font-size: 0.8rem; color: #666;">User ID: ${this.escapeHtml(String(userId))}</p>
                        <p style="margin-top: 6px;"><span class="activity-type-badge">${this.escapeHtml(activityType)}</span></p>
                    </div>
                    <div class="entry-status ${statusClass}">
                        ${entryStatus.toUpperCase()}
                    </div>
                </div>
                <div class="entry-details">
                    <div class="entry-steps">
                        <strong>Activity:</strong> ${this.escapeHtml(activityType)}
                        &nbsp;|&nbsp; <strong>Steps:</strong> ${steps.toLocaleString()}
                        &nbsp;|&nbsp; <strong>Distance:</strong> ${Number.isFinite(distanceKm) ? distanceKm.toFixed(3) : '0.000'} km
                        &nbsp;|&nbsp; <strong>Calories:</strong> ${Number.isFinite(calories) ? Math.round(calories).toLocaleString() : '0'} kcal
                        &nbsp;|&nbsp; <strong>Duration:</strong> ${durationLabel}
                    </div>
                    <div class="entry-screenshot">
                        <strong>Screenshot:</strong>
                        ${entry.screenshot ? `
                            <img src="${entry.screenshot}" alt="Step screenshot" class="validation-screenshot" onclick="this.classList.toggle('expanded')" style="cursor: pointer; max-width: 200px; border-radius: 8px; margin-top: 8px;">
                        ` : `
                            <p class="no-screenshot">No screenshot provided</p>
                        `}
                    </div>
                    <div class="entry-source" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Source:</strong> ${this.escapeHtml(sourceLabel)}</div>
                    ${entry.validatedBy ? `<div class="entry-validator" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Validated by:</strong> ${this.escapeHtml(entry.validatedBy)}${validatedDateStr ? ` on ${validatedDateStr}` : ''}</div>` : ''}
                    ${entry.lastModifiedBy ? `<div class="entry-modifier" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Last modified by:</strong> ${this.escapeHtml(entry.lastModifiedBy)}${modifiedDateStr ? ` on ${modifiedDateStr}` : ''}</div>` : ''}
                    ${entry.notes ? `<div class="entry-notes" style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 0.9rem;"><strong>Notes:</strong> ${this.escapeHtml(entry.notes)}</div>` : ''}
                </div>
                <div class="entry-actions">
                    ${entryStatus === 'pending' ? `
                        <button class="btn btn-success" onclick="app.validateEntry('${safeEntryId}', 'approved')">Approve</button>
                        <button class="btn btn-danger" onclick="app.validateEntry('${safeEntryId}', 'rejected')">Reject</button>
                    ` : entryStatus === 'approved' ? `
                        <button class="btn btn-danger" onclick="app.validateEntry('${safeEntryId}', 'rejected')">Reject</button>
                    ` : `
                        <button class="btn btn-success" onclick="app.validateEntry('${safeEntryId}', 'approved')">Approve</button>
                    `}
                    <button class="btn btn-edit" onclick="app.openEditActivityModal('${safeEntryId}')">Edit Activity</button>
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async validateEntry(entryId, status, refreshUserId = null) {
        if (!this.requireAdmin()) {
            return false;
        }
        const entry = this.stepEntries.find(e => e.id === entryId);
        if (!entry) return false;

        const notes = prompt(status === 'approved' ? 'Add approval notes (optional):' : 'Add rejection reason (required):');
        
        if (status === 'rejected' && !notes) {
            alert('Please provide a reason for rejection!');
            return false;
        }
        if (notes === null && status === 'approved') {
            // User cancelled optional notes prompt
            return false;
        }

        const previousStatus = entry.status || 'pending';
        const participant = this.findParticipantForEntry(entry);

        entry.status = status;
        entry.validatedBy = 'Admin';
        entry.validatedAt = new Date().toISOString();
        entry.notes = notes || null;

        if (participant) {
            // Rebuild from approved entries only (self-heals stale rejected totals)
            this.recalculateParticipantTotalsFromApproved(participant);

            const activity = (participant.activities || []).find(a => a.entryId === entryId);
            if (activity) {
                if (status === 'approved') {
                    activity.message = previousStatus === 'rejected'
                        ? `Activity approved after rejection: ${(entry.steps || 0).toLocaleString()} steps / ${Number(entry.distanceKm || 0).toFixed(2)} km`
                        : `Activity approved: ${(entry.steps || 0).toLocaleString()} steps / ${Number(entry.distanceKm || 0).toFixed(2)} km`;
                } else if (status === 'rejected') {
                    activity.message = `Activity rejected: ${(entry.steps || 0).toLocaleString()} steps / ${Number(entry.distanceKm || 0).toFixed(2)} km`;
                }
            }
            this.saveParticipantsCache();
        }

        this.saveStepEntries();
        await this.upsertStepEntryInFirebase(entry);
        if (this.firebaseEnabled && participant) {
            await this.syncParticipantToFirebase(participant);
        }
        await this.syncActivityFeedForEntry(entry);
        await this.refreshSurfacesAfterAdminActivityChange(participant);

        alert(`Entry ${status} successfully!`);
        if (refreshUserId) {
            this.viewUserDetails(refreshUserId);
        }
        return true;
    }

    /**
     * Reject approved entries whose time-to-goal implies speed above maxHumanSpeedKmh.
     * Clears GPS-glitch day-board winners (e.g. 1 KM in under ~4:00).
     */
    async rejectImplausibleApprovedEntries({ silent = false } = {}) {
        if (!this.isAdmin) {
            if (!silent) alert('Admin login required.');
            return 0;
        }
        if (this.firebaseEnabled) {
            await this.syncStepEntriesFromFirebase();
        } else {
            this.stepEntries = this.loadStepEntries();
        }
        const reason =
            `Rejected: finish time implies speed above ${this.challengeConfig.maxHumanSpeedKmh} km/h for the day KM goal (unrealistic / GPS glitch).`;
        let rejected = 0;
        const touched = new Set();
        const rejectedNames = [];

        for (const entry of this.stepEntries || []) {
            if (!this.isApprovedEntry(entry)) continue;
            const goalKm = this.getDailyGoalKm(new Date(entry.date));
            if (!this.isImplausibleChallengePace(entry, goalKm)) continue;

            entry.status = 'rejected';
            entry.validatedBy = 'Admin (pace check)';
            entry.validatedAt = new Date().toISOString();
            entry.notes = reason;
            rejected += 1;
            rejectedNames.push(entry.userName || entry.id);

            const participant = this.findParticipantForEntry(entry);
            if (participant) {
                const key = participant.uid || participant.id || participant.email || participant.name;
                touched.add(String(key));
                this.recalculateParticipantTotalsFromApproved(participant);
            }
            await this.upsertStepEntryInFirebase(entry);
            await this.syncActivityFeedForEntry(entry);
        }

        if (rejected > 0) {
            this.saveStepEntries();
            this.saveParticipantsCache();
            for (const p of this.participants || []) {
                const key = String(p.uid || p.id || p.email || p.name);
                if (touched.has(key)) {
                    await this.syncParticipantToFirebase(p);
                }
            }
            if (!window.location.pathname.includes('admin.html')) {
                await this.updateLeaderboard(null, { skipRemoteSync: true });
            }
        }

        if (!silent) {
            alert(
                rejected
                    ? `Rejected ${rejected} impossible-pace entr${rejected === 1 ? 'y' : 'ies'}:\n\n- ${rejectedNames.join('\n- ')}`
                    : 'No impossible-pace approved entries found.\n\nTip: click Refresh first, then try again.'
            );
        } else if (rejected) {
            console.log(`Auto-rejected ${rejected} impossible-pace entries:`, rejectedNames);
        }
        return rejected;
    }

    editEntrySteps(entryId) {
        // Backward-compatible alias
        this.openEditActivityModal(entryId);
    }

    openEditActivityModal(entryId, refreshUserId = null) {
        if (!this.requireAdmin()) return;
        const entry = this.stepEntries.find(e => e.id === entryId);
        if (!entry) {
            alert('Activity entry not found.');
            return;
        }

        this._editActivityContext = { entryId, refreshUserId };

        const modal = document.getElementById('editActivityModal');
        if (!modal) {
            // Fallback if modal markup is missing (e.g. old cached admin page)
            this.editEntryStepsPromptFallback(entryId, refreshUserId);
            return;
        }

        document.getElementById('editActivityId').value = entry.id;
        document.getElementById('editActivityType').value =
            entry.trackingMode === 'treadmill' || entry.source === 'treadmill-counter' ? 'treadmill' : 'outdoor';
        document.getElementById('editActivitySteps').value = entry.steps || 0;
        document.getElementById('editActivityDistance').value = Number(entry.distanceKm || 0).toFixed(3);
        document.getElementById('editActivityCalories').value = Math.round(Number(entry.caloriesBurned) || 0);
        const durationSec = Number(entry.durationSec) || 0;
        document.getElementById('editActivityDurationMin').value = Math.floor(durationSec / 60);
        document.getElementById('editActivitySpeed').value =
            entry.treadmillSpeedKmh != null ? Number(entry.treadmillSpeedKmh) : '';
        document.getElementById('editActivityNotes').value = entry.notes || '';
        document.getElementById('editActivityStatus').value = entry.status || 'pending';
        document.getElementById('editActivityMeta').textContent =
            `${this.getActivityTypeLabel(entry)} · ${this.getActivitySourceLabel(entry)} · ${new Date(entry.date).toLocaleString()}`;

        modal.style.display = 'flex';
    }

    closeEditActivityModal() {
        const modal = document.getElementById('editActivityModal');
        if (modal) modal.style.display = 'none';
        this._editActivityContext = null;
    }

    editEntryStepsPromptFallback(entryId, refreshUserId = null) {
        const entry = this.stepEntries.find(e => e.id === entryId);
        if (!entry) return;

        const currentSteps = entry.steps;
        const newStepsStr = prompt(`Edit step count:\nCurrent: ${currentSteps}`, currentSteps);
        if (newStepsStr === null) return;
        const newSteps = parseInt(newStepsStr, 10);
        if (isNaN(newSteps) || newSteps < 0) {
            alert('Please enter a valid number of steps (0 or greater)!');
            return;
        }

        const distanceStr = prompt(`Edit distance (km):\nCurrent: ${Number(entry.distanceKm || 0).toFixed(3)}`, Number(entry.distanceKm || 0).toFixed(3));
        if (distanceStr === null) return;
        const newDistance = parseFloat(distanceStr);
        if (isNaN(newDistance) || newDistance < 0) {
            alert('Please enter a valid distance.');
            return;
        }

        this.saveEditedActivityDetails({
            entryId,
            steps: newSteps,
            distanceKm: newDistance,
            caloriesBurned: entry.caloriesBurned,
            durationSec: entry.durationSec,
            trackingMode: entry.trackingMode || 'outdoor',
            treadmillSpeedKmh: entry.treadmillSpeedKmh,
            notes: entry.notes,
            status: entry.status || 'pending',
            refreshUserId
        });
    }

    async saveEditedActivityFromForm() {
        if (!this.requireAdmin()) return;
        const ctx = this._editActivityContext || {};
        const entryId = document.getElementById('editActivityId')?.value || ctx.entryId;
        if (!entryId) return;

        const steps = parseInt(document.getElementById('editActivitySteps').value, 10);
        const distanceKm = parseFloat(document.getElementById('editActivityDistance').value);
        const caloriesBurned = parseFloat(document.getElementById('editActivityCalories').value);
        const durationMin = parseFloat(document.getElementById('editActivityDurationMin').value);
        const trackingMode = document.getElementById('editActivityType').value;
        const speedRaw = document.getElementById('editActivitySpeed').value;
        const notes = document.getElementById('editActivityNotes').value;
        const status = document.getElementById('editActivityStatus').value;

        if (isNaN(steps) || steps < 0) {
            alert('Please enter a valid step count.');
            return;
        }
        if (isNaN(distanceKm) || distanceKm < 0) {
            alert('Please enter a valid distance (km).');
            return;
        }
        if (isNaN(caloriesBurned) || caloriesBurned < 0) {
            alert('Please enter valid calories.');
            return;
        }
        if (isNaN(durationMin) || durationMin < 0) {
            alert('Please enter a valid duration (minutes).');
            return;
        }

        let treadmillSpeedKmh = null;
        if (speedRaw !== '' && speedRaw != null) {
            treadmillSpeedKmh = parseFloat(speedRaw);
            if (isNaN(treadmillSpeedKmh) || treadmillSpeedKmh < 0) {
                alert('Please enter a valid treadmill speed.');
                return;
            }
            const maxSpeed = this.challengeConfig.treadmillSpeedMaxKmh;
            const minSpeed = this.challengeConfig.treadmillSpeedMinKmh;
            if (treadmillSpeedKmh > maxSpeed || treadmillSpeedKmh < minSpeed) {
                alert(`Treadmill speed must be between ${minSpeed} and ${maxSpeed} km/h.`);
                return;
            }
            treadmillSpeedKmh = this.clampTreadmillSpeedKmh(treadmillSpeedKmh);
        }

        await this.saveEditedActivityDetails({
            entryId,
            steps,
            distanceKm: Number(distanceKm.toFixed(3)),
            caloriesBurned: Math.round(caloriesBurned),
            durationSec: Math.round(durationMin * 60),
            trackingMode: trackingMode === 'treadmill' ? 'treadmill' : 'outdoor',
            treadmillSpeedKmh,
            notes: notes || null,
            status,
            refreshUserId: ctx.refreshUserId || null
        });
    }

    async saveEditedActivityDetails({
        entryId,
        steps,
        distanceKm,
        caloriesBurned,
        durationSec,
        trackingMode,
        treadmillSpeedKmh,
        notes,
        status,
        refreshUserId
    }) {
        const entry = this.stepEntries.find(e => e.id === entryId);
        if (!entry) {
            alert('Activity entry not found.');
            return;
        }

        const participant = this.findParticipantForEntry(entry);
        const previousStatus = entry.status || 'pending';

        entry.steps = steps;
        entry.distanceKm = Number(Number(distanceKm).toFixed(3));
        entry.caloriesBurned = Number(caloriesBurned) || 0;
        entry.durationSec = durationSec == null ? null : Number(durationSec);
        entry.trackingMode = trackingMode === 'treadmill' ? 'treadmill' : 'outdoor';
        if (entry.trackingMode === 'treadmill') {
            entry.source = 'treadmill-counter';
            entry.treadmillSpeedKmh = treadmillSpeedKmh;
        } else {
            if (entry.source === 'treadmill-counter') entry.source = 'gps-counter';
            entry.treadmillSpeedKmh = null;
        }
        entry.notes = notes;
        entry.lastModifiedBy = 'Admin';
        entry.lastModifiedAt = new Date().toISOString();
        entry.status = status || previousStatus;

        if (entry.status === 'approved') {
            entry.validatedBy = 'Admin';
            entry.validatedAt = new Date().toISOString();
        } else if (previousStatus === 'approved' && entry.status !== 'approved') {
            entry.validatedBy = 'Admin';
            entry.validatedAt = new Date().toISOString();
        }

        if (participant) {
            this.recalculateParticipantTotalsFromApproved(participant);
            const activity = (participant.activities || []).find(a => a.entryId === entryId);
            if (activity) {
                activity.steps = entry.steps;
                activity.distanceKm = entry.distanceKm;
                activity.caloriesBurned = entry.caloriesBurned;
                activity.message = `Activity updated by admin: ${entry.steps.toLocaleString()} steps / ${entry.distanceKm.toFixed(2)} km (${entry.status})`;
            }
            this.saveParticipantsCache();
        }

        this.saveStepEntries();
        await this.upsertStepEntryInFirebase(entry);
        if (this.firebaseEnabled && participant) {
            await this.syncParticipantToFirebase(participant);
        }
        await this.syncActivityFeedForEntry(entry);
        await this.refreshSurfacesAfterAdminActivityChange(participant);

        this.closeEditActivityModal();
        alert('Activity details updated successfully.');
        if (refreshUserId) {
            this.viewUserDetails(refreshUserId);
        }
    }

    showSuccessAnimation(steps) {
        // Create a temporary success message
        const successMsg = document.createElement('div');
        successMsg.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #003366 0%, #001a33 100%);
            color: white;
            padding: 20px 30px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0, 51, 102, 0.4);
            z-index: 1000;
            animation: slideInRight 0.5s ease-out, fadeOut 0.5s ease-out 2.5s;
            font-weight: 600;
            font-size: 1.1rem;
        `;
 successMsg.textContent = ` ${steps.toLocaleString()} steps added!`;
        document.body.appendChild(successMsg);

        // Add CSS animations if not already present
        if (!document.getElementById('successAnimationStyles')) {
            const style = document.createElement('style');
            style.id = 'successAnimationStyles';
            style.textContent = `
                @keyframes slideInRight {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes fadeOut {
                    from {
                        opacity: 1;
                        transform: translateX(0);
                    }
                    to {
                        opacity: 0;
                        transform: translateX(400px);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            successMsg.remove();
        }, 3000);
    }

    calculateStreak(participant) {
        if (!participant) {
            return 0;
        }

        // Prefer entry-based streak when step entries exist (counts per qualifying entry)
        const entries = Array.isArray(this.stepEntries) ? this.stepEntries : this.loadStepEntries();
        if (Array.isArray(entries) && entries.length > 0) {
            const participantIds = new Set([
                participant.uid ? String(participant.uid) : '',
                participant.id ? String(participant.id) : '',
                participant.employeeId ? String(participant.employeeId) : ''
            ].filter(Boolean));

            const qualifyingCountsByDate = {};
            entries.forEach(entry => {
                if (!entry) {
                    return;
                }
                const entryUserUid = entry.userUid ? String(entry.userUid) : '';
                const entryUserId = entry.userId ? String(entry.userId) : '';
                const matchesUser = (entryUserUid && participantIds.has(entryUserUid)) ||
                    (entryUserId && participantIds.has(entryUserId));

                if (!matchesUser) {
                    return;
                }

                const steps = typeof entry.steps === 'number' ? entry.steps : parseInt(entry.steps);
                const entryDate = new Date(entry.date || Date.now());
                if (isNaN(entryDate.getTime())) {
                    return;
                }
 const dayGoal = this.getDailyGoalSteps(entryDate);
 if (!steps || steps < dayGoal) {
 return;
 }

                entryDate.setHours(0, 0, 0, 0);
                const dateKey = entryDate.toDateString();
                qualifyingCountsByDate[dateKey] = (qualifyingCountsByDate[dateKey] || 0) + 1;
            });

            let streak = 0;
            Object.values(qualifyingCountsByDate).forEach(count => {
                streak += count;
            });
            return streak;
        }

        if (!participant.dailySteps || Object.keys(participant.dailySteps).length === 0) {
            return 0;
        }
        
        // Get today's date string (same format as stored: toDateString())
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toDateString();
        
        // Create a map of date strings to steps for easy lookup
        const stepsByDate = {};
        Object.keys(participant.dailySteps).forEach(dateStr => {
            try {
                // Parse the date string - handle both Date objects and strings
                let date;
                if (dateStr instanceof Date) {
                    date = new Date(dateStr);
                } else {
                    date = new Date(dateStr);
                }
                
                // Check if date is valid
                if (isNaN(date.getTime())) {
                    console.warn('Invalid date string in dailySteps:', dateStr);
                    return;
                }
                
                date.setHours(0, 0, 0, 0);
                const normalizedDateStr = date.toDateString();
                // Sum steps if multiple entries exist for same date
                if (stepsByDate[normalizedDateStr]) {
                    stepsByDate[normalizedDateStr] += participant.dailySteps[dateStr];
                } else {
                    stepsByDate[normalizedDateStr] = participant.dailySteps[dateStr];
                }
            } catch (e) {
                console.warn('Error parsing date in calculateStreak:', dateStr, e);
            }
        });
        
        let streak = 0;
        let checkDate = new Date(today);
        const minStepsForStreak = 1; // Count any day with activity (steps > 0) as a streak day
        const maxDaysToCheck = 365; // Prevent infinite loops
        let daysChecked = 0;
        
        // Check consecutive days starting from today (or yesterday if today has no activity)
        // First, check if today has any steps
        if (stepsByDate[todayStr] && stepsByDate[todayStr] >= minStepsForStreak) {
            // Start counting from today
            checkDate = new Date(today);
        } else {
            // If today has no steps, start from yesterday
            checkDate.setDate(checkDate.getDate() - 1);
        }
        
        // Count consecutive days backwards
        while (daysChecked < maxDaysToCheck) {
            const checkDateStr = checkDate.toDateString();
            const steps = stepsByDate[checkDateStr];
            
            // If this date has any steps (activity), increment streak
            if (steps && steps >= minStepsForStreak) {
                streak++;
                // Move to previous day
                checkDate.setDate(checkDate.getDate() - 1);
                daysChecked++;
            } else {
                // No more consecutive days with activity
                break;
            }
        }
        
        return streak;
    }

    getUserRank(user) {
        if (!user) return 0;
        this.participants = this.filterCurrentSeasonParticipants(this.participants || this.loadParticipants());
        this.stepEntries = this.filterCurrentSeasonEntries(this.stepEntries || this.loadStepEntries());
        this.recalculateAllParticipantTotalsFromApproved();
        const sorted = [...(this.participants || [])]
            .filter((p) => (p.totalSteps || 0) > 0 || (p.totalDistanceKm || 0) > 0.005)
            .sort((a, b) => (b.totalSteps || 0) - (a.totalSteps || 0));
        const idx = sorted.findIndex((p) =>
            (user.uid && p.uid && String(p.uid) === String(user.uid)) ||
            (user.id && p.id && String(p.id) === String(user.id)) ||
            (user.employeeId && p.employeeId && String(p.employeeId) === String(user.employeeId)) ||
            (user.email && (p.email || p.emailId) &&
                String(p.email || p.emailId).toLowerCase() === String(user.email).toLowerCase()) ||
            (user.name && p.name && p.name === user.name)
        );
        return idx >= 0 ? idx + 1 : 0;
    }

 formatDurationClock(totalSec) {
 if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) {
 return '--';
 }
 const sec = Math.round(totalSec);
 const hours = Math.floor(sec / 3600);
 const minutes = Math.floor((sec % 3600) / 60);
 const seconds = sec % 60;
 if (hours > 0) {
 return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
 }
 return `${minutes}:${String(seconds).padStart(2, '0')}`;
 }

 getActivityTypeLabel(entry) {
 if (!entry) return 'Unknown';
 const mode = entry.trackingMode;
 if (mode === 'treadmill' || entry.source === 'treadmill-counter') return 'Treadmill';
 if (mode === 'outdoor' || entry.source === 'gps-counter' || entry.source === 'step-counter') {
 return 'Outdoor Walk / Run';
 }
 if (entry.source === 'native') return 'Native Tracking';
 if (entry.source === 'manual') return 'Manual Entry';
 if (entry.source === 'screenshot') return 'Screenshot Upload';
 return entry.source || 'Activity';
 }

 getActivitySourceLabel(entry) {
 const map = {
 'gps-counter': 'GPS Counter',
 'treadmill-counter': 'Treadmill Counter',
 'step-counter': 'Step Counter',
 'native': 'Native Keep-Alive',
 'manual': 'Manual Entry',
 'screenshot': 'Screenshot Upload'
 };
 return map[entry && entry.source] || (entry && entry.source) || 'Unknown';
 }

 findParticipantForEntry(entry) {
 if (!entry) return null;
 // Same identity rules as totals (uid / employeeId / email) — day boards were
 // missing people when entries only matched via email or userEmployeeId.
 return (this.participants || []).find((p) => this.entryBelongsToParticipant(entry, p)) || null;
 }

 entryBelongsToParticipant(entry, participant) {
 if (!entry || !participant) return false;
 const ids = [
 participant.id,
 participant.employeeId,
 participant.uid
 ].filter((v) => v != null && v !== '').map((v) => String(v));
 const entryIds = [
 entry.userId,
 entry.userUid,
 entry.userEmployeeId
 ].filter((v) => v != null && v !== '').map((v) => String(v));
 if (entryIds.some((id) => ids.includes(id))) return true;

 const pEmail = String(participant.email || participant.emailId || participant.emailLower || '').toLowerCase().trim();
 const eEmail = String(entry.userEmail || entry.email || '').toLowerCase().trim();
 return !!(pEmail && eEmail && pEmail === eEmail);
 }

 isApprovedEntry(entry) {
 return entry && String(entry.status || 'pending').toLowerCase() === 'approved';
 }

 /** Normalize Firestore Timestamp / ISO / Date into a valid Date. */
 parseEntryDate(value) {
 if (value == null || value === '') return new Date();
 if (value instanceof Date) {
 return Number.isNaN(value.getTime()) ? new Date() : value;
 }
 if (typeof value.toDate === 'function') {
 try {
 const d = value.toDate();
 if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
 } catch (e) { /* fall through */ }
 }
 if (typeof value === 'object') {
 const sec = value.seconds != null ? value.seconds : value._seconds;
 if (sec != null && Number.isFinite(Number(sec))) {
 return new Date(Number(sec) * 1000);
 }
 }
 const d = new Date(value);
 return Number.isNaN(d.getTime()) ? new Date() : d;
 }

 /**
 * Legal finish seconds for day-board ranking.
 * Ignores impossible live timeToGoalSec spikes and falls back to session pace.
 */
 getDayBoardFinishSec(entry, goalKm) {
 if (!entry || !(goalKm > 0)) return null;
 const maxKmh = Number(this.challengeConfig.maxHumanSpeedKmh) || 15;
 const isLegal = (sec) => {
 if (!(sec > 0)) return false;
 const speed = this.impliedSpeedKmh(sec, goalKm);
 return speed == null || speed <= maxKmh;
 };
 let finish = this.estimateTimeToGoalSec(entry, goalKm);
 if (isLegal(finish)) return finish;
 // Strip glitch snapshot and retry from duration / path only
 const retry = this.estimateTimeToGoalSec({ ...entry, timeToGoalSec: null }, goalKm);
 if (isLegal(retry)) return retry;
 return null;
 }

 /** True when the entry has any timing we can use to judge pace. */
 hasTimingEvidence(entry) {
 if (!entry) return false;
 return (Number(entry.durationSec) || 0) > 0 || (Number(entry.timeToGoalSec) || 0) > 0;
 }

 /**
 * Day-board eligibility aligned with Team Feed:
 * approved/pending goal finishers count unless timing proves an illegal pace.
 * Pass goalKmOverride when ranking a specific day board so goal matches that day.
 */
 isDayBoardEligibleEntry(entry, goalKmOverride = null) {
 if (!entry) return false;
 const st = String(entry.status || 'pending').toLowerCase();
 const goalKm = goalKmOverride != null
 ? goalKmOverride
 : this.getDailyGoalKm(this.parseEntryDate(entry.date));
 const dist = Number(entry.distanceKm) || 0;

 if (st === 'rejected') {
 const why = `${entry.notes || ''} ${entry.validatedBy || ''}`;
 if (!/pace/i.test(why)) return false;
 if (!this.meetsDailyGoal(dist, goalKm)) return false;
 // Recover false pace-rejects when session pace is legal now
 return this.getDayBoardFinishSec(entry, goalKm) != null;
 }

 if (st !== 'approved' && st !== 'pending') return false;
 if (!this.meetsDailyGoal(dist, goalKm)) {
 // Still allow in-progress rows (distance toward the day goal)
 return dist > 0.005 || (Number(entry.steps) || 0) > 0;
 }
 const finish = this.getDayBoardFinishSec(entry, goalKm);
 if (finish != null) return true;
 // Goal met, no timing → count it (matches Team Feed); cannot DQ without evidence
 if (!this.hasTimingEvidence(entry)) return true;
 // Timing present but illegal pace → exclude
 return false;
 }

 /**
 * Pull Team Feed posts into stepEntries for a challenge day so feed finishers
 * are never missing from that day's leaderboard.
 */
 async hydrateDayBoardEntriesFromFeed(dayNum) {
 if (!this.firebaseEnabled || !this.db) return 0;
 const goalKm = this.challengeConfig.dayGoalsKm[dayNum - 1] || dayNum;
 let addedOrPatched = 0;
 try {
 let snap;
 try {
 snap = await this.activityFeedCol()
 .where('season', '==', this.dataSeason)
 .where('visible', '==', true)
 .orderBy('date', 'desc')
 .limit(80)
 .get();
 } catch (idxErr) {
 snap = await this.activityFeedCol()
 .where('season', '==', this.dataSeason)
 .limit(120)
 .get();
 }
 if (!Array.isArray(this.stepEntries)) this.stepEntries = [];
 const byId = new Map(
 (this.stepEntries || []).filter((e) => e && e.id).map((e) => [String(e.id), e])
 );

 snap.docs.forEach((doc) => {
 const p = doc.data();
 if (!p || p.visible === false) return;
 const entryId = p.entryId || p.id;
 if (!entryId) return;
 const dateVal = p.date;
 const entryDay = this.getChallengeDayNumber(this.parseEntryDate(dateVal));
 if (entryDay !== dayNum) return;

 const dist = Number(p.distanceKm) || 0;
 const steps = Number(p.steps) || 0;
 if (dist <= 0.005 && steps <= 0) return;

 const existing = byId.get(String(entryId));
 if (existing) {
 let patched = false;
 // Fill gaps so day-board pace/finish can be computed like the feed UI
 if (!(Number(existing.durationSec) > 0) && Number(p.durationSec) > 0) {
 existing.durationSec = Number(p.durationSec);
 patched = true;
 }
 if (!(Number(existing.distanceKm) > 0) && dist > 0) {
 existing.distanceKm = dist;
 patched = true;
 }
 if (!(Number(existing.steps) > 0) && steps > 0) {
 existing.steps = steps;
 patched = true;
 }
 if (!existing.userName && p.userName) {
 existing.userName = p.userName;
 patched = true;
 }
 // Feed-visible posts should not stay stuck as pending for day boards
 if (String(existing.status || '').toLowerCase() === 'pending') {
 existing.status = 'approved';
 existing.validatedBy = existing.validatedBy || 'Feed hydrate';
 patched = true;
 }
 if (patched) addedOrPatched += 1;
 return;
 }

 const synthesized = {
 id: String(entryId),
 userUid: p.userUid || null,
 userId: p.userId || null,
 userName: p.userName || 'Teammate',
 userEmail: p.userEmail || null,
 steps,
 distanceKm: dist,
 caloriesBurned: Number(p.caloriesBurned) || 0,
 durationSec: p.durationSec == null ? null : Number(p.durationSec),
 timeToGoalSec: p.timeToGoalSec == null ? null : Number(p.timeToGoalSec),
 date: dateVal || new Date().toISOString(),
 challengeDay: dayNum,
 status: 'approved',
 validatedBy: 'Team feed hydrate',
 validatedAt: new Date().toISOString(),
 notes: `Hydrated from Team Feed for Day ${dayNum} (${goalKm} KM)`,
 source: p.source || 'gps-counter',
 trackingMode: p.trackingMode || null,
 season: this.dataSeason,
 _fromFeed: true
 };
 this.stepEntries.push(synthesized);
 byId.set(String(entryId), synthesized);
 addedOrPatched += 1;
 });
 } catch (err) {
 console.warn('hydrateDayBoardEntriesFromFeed failed:', err);
 }
 return addedOrPatched;
 }

 /**
 * Rebuild participant totals from approved step entries only.
 * Fixes leaderboard drift when rejected/pending entries were still counted.
 */
 recalculateParticipantTotalsFromApproved(participant) {
 if (!participant) return;
 participant.totalSteps = 0;
 participant.totalDistanceKm = 0;
 participant.totalCalories = 0;
 participant.dailySteps = {};
 participant.dailyDistanceKm = {};
 participant.dailyCalories = {};
 participant.dailyStats = {};

 const entries = (this.stepEntries || []).filter(
 (e) => this.isApprovedEntry(e) && this.isCurrentSeasonEntry(e) && this.entryBelongsToParticipant(e, participant)
 );
 for (const entry of entries) {
 this.applyEntryContribution(participant, entry, 1);
 }
 }

 recalculateAllParticipantTotalsFromApproved() {
 if (!Array.isArray(this.stepEntries)) {
 this.stepEntries = this.loadStepEntries();
 }
 (this.participants || []).forEach((p) => this.recalculateParticipantTotalsFromApproved(p));
 this.saveParticipantsCache();
 }

 /**
 * Add (sign=+1) or remove (sign=-1) an entry's contribution from participant totals.
 */
 applyEntryContribution(participant, entry, sign) {
 if (!participant || !entry) return;
 const s = sign >= 0 ? 1 : -1;
 const entryDate = new Date(entry.date).toDateString();
 let steps = Number(entry.steps) || 0;
 const distanceKm = Number(entry.distanceKm) || 0;
 const calories = Number(entry.caloriesBurned) || 0;
 const durationSec = Number(entry.durationSec) || 0;
 // GPS-first activities may store KM with 0 steps — derive steps so Today isn't stuck at 0
 if (steps <= 0 && distanceKm > 0.005) {
 steps = Math.round(distanceKm * (this.challengeConfig.stepsPerKm || 1300));
 }

 if (!participant.dailySteps) participant.dailySteps = {};
 participant.dailySteps[entryDate] = Math.max(0, (participant.dailySteps[entryDate] || 0) + s * steps);
 participant.totalSteps = Math.max(0, (participant.totalSteps || 0) + s * steps);

 if (!participant.dailyDistanceKm) participant.dailyDistanceKm = {};
 participant.dailyDistanceKm[entryDate] = Math.max(
 0,
 Number(((participant.dailyDistanceKm[entryDate] || 0) + s * distanceKm).toFixed(3))
 );
 participant.totalDistanceKm = Math.max(
 0,
 Number(((participant.totalDistanceKm || 0) + s * distanceKm).toFixed(3))
 );

 if (!participant.dailyCalories) participant.dailyCalories = {};
 participant.dailyCalories[entryDate] = Math.max(0, (participant.dailyCalories[entryDate] || 0) + s * calories);
 participant.totalCalories = Math.max(0, (participant.totalCalories || 0) + s * calories);

 if (!participant.dailyStats) participant.dailyStats = {};
 const day = participant.dailyStats[entryDate] || {
 distanceKm: 0,
 durationSec: 0,
 steps: 0,
 caloriesBurned: 0,
 completed: false,
 completionDurationSec: null,
 completedAt: null,
 goalKm: null,
 challengeDay: null
 };
 day.distanceKm = Math.max(0, Number(((day.distanceKm || 0) + s * distanceKm).toFixed(3)));
 day.durationSec = Math.max(0, (day.durationSec || 0) + s * durationSec);
 day.steps = Math.max(0, (day.steps || 0) + s * steps);
 day.caloriesBurned = Math.max(0, (day.caloriesBurned || 0) + s * calories);
 const goalKm = this.getDailyGoalKm(new Date(entry.date));
 day.goalKm = goalKm;
 if (s > 0) {
 const entryFinishSec = this.estimateTimeToGoalSec(entry, goalKm);
 if (entryFinishSec != null && !this.isImplausibleChallengePace(entry, goalKm)) {
 day.completed = true;
 // Keep the best (shortest) time-to-goal across attempts — never lock the first
 if (day.completionDurationSec == null || entryFinishSec < day.completionDurationSec) {
 day.completionDurationSec = entryFinishSec;
 day.completedAt = entry.date || new Date().toISOString();
 }
 } else if (this.meetsDailyGoal(day.distanceKm, goalKm)) {
 // Distance may still count toward progress, but only legal single attempts set finish time
 day.completed = day.completionDurationSec != null;
 } else {
 day.completed = false;
 day.completionDurationSec = null;
 day.completedAt = null;
 }
 } else if (!this.meetsDailyGoal(day.distanceKm, goalKm)) {
 day.completed = false;
 day.completionDurationSec = null;
 day.completedAt = null;
 }
 participant.dailyStats[entryDate] = day;
 }

 /**
 * Goal check matching the live counter (2 decimal places), plus ~5 m GPS tolerance.
 * Prevents "UI showed 4.00 KM" but board treats 3.995 as incomplete.
 */
 meetsDailyGoal(distanceKm, goalKm) {
 const d = Number(distanceKm) || 0;
 const g = Number(goalKm) || 0;
 if (!(g > 0) || !(d > 0)) return false;
 if (Number(d.toFixed(2)) >= Number(g.toFixed(2))) return true;
 return d + 0.005 >= g;
 }

 /**
 * Time (seconds) to reach the day's target KM within a single activity.
 * Prefers live goal-crossing snapshot, then GPS path crossing, then pace scale.
 * Example: 3 KM in 30 min on a 1 KM day → ~10 min (not 30).
 *
 * If live timeToGoalSec is an impossible spike (GPS/step glitch) but the full
 * session pace is legal, fall back to scaled session time so the day board
 * still ranks real finishers who appear on the activity feed.
 */
 estimateTimeToGoalSec(entry, goalKm) {
 if (!entry || !(goalKm > 0)) return null;
 const distanceKm = Number(entry.distanceKm) || 0;
 const durationSec = Number(entry.durationSec) || 0;
 const maxKmh = Number(this.challengeConfig.maxHumanSpeedKmh) || 15;
 const scaledFinish = () => {
   if (!this.meetsDailyGoal(distanceKm, goalKm) || durationSec <= 0) return null;
   return Math.max(1, Math.round(durationSec * (goalKm / Math.max(distanceKm, goalKm))));
 };
 const isLegalFinish = (sec) => {
   if (!(sec > 0)) return false;
   const speed = this.impliedSpeedKmh(sec, goalKm);
   return speed == null || speed <= maxKmh;
 };

 const liveGoalSec = Number(entry.timeToGoalSec);
 if (Number.isFinite(liveGoalSec) && liveGoalSec > 0) {
   const candidate = Math.min(Math.round(liveGoalSec), durationSec > 0 ? durationSec : Math.round(liveGoalSec));
   if (isLegalFinish(candidate)) return candidate;
   const scaled = scaledFinish();
   if (scaled != null && isLegalFinish(scaled)) return scaled;
   // Prefer scaled even if borderline; ranking layer strips remaining illegals
   if (scaled != null) return scaled;
   return candidate;
 }
 if (!this.meetsDailyGoal(distanceKm, goalKm)) return null;
 if (durationSec <= 0) return null;

 const path = typeof this.normalizeActivityPath === 'function'
 ? this.normalizeActivityPath(entry.path)
 : (Array.isArray(entry.path) ? entry.path : []);
 const timed = path.filter((p) => p && Number.isFinite(Number(p.t)) && Number(p.t) > 0);
 if (timed.length >= 2 && typeof this.haversineKm === 'function') {
 let cum = 0;
 const t0 = Number(timed[0].t);
 for (let i = 1; i < timed.length; i++) {
 const a = timed[i - 1];
 const b = timed[i];
 const seg = this.haversineKm(a.lat, a.lng, b.lat, b.lng);
 const prev = cum;
 cum += seg;
 if (this.meetsDailyGoal(cum, goalKm) || cum >= goalKm) {
 const need = Math.max(0, goalKm - prev);
 const frac = seg > 0.00001 ? Math.min(1, need / seg) : 1;
 const crossedAt = Number(a.t) + frac * (Number(b.t) - Number(a.t));
 const elapsed = Math.max(1, Math.round((crossedAt - t0) / 1000));
 const pathFinish = Math.min(elapsed, durationSec);
 if (isLegalFinish(pathFinish)) return pathFinish;
 break;
 }
 }
 }

 return scaledFinish();
 }

 /** Implied average speed (km/h) for covering goalKm in finishSec. */
 impliedSpeedKmh(finishSec, goalKm) {
 if (!(finishSec > 0) || !(goalKm > 0)) return null;
 return goalKm / (finishSec / 3600);
 }

 /**
 * Reject GPS glitches / fake tracking: e.g. 1 KM in 1:44 (~34 km/h) is not a valid challenge finish.
 */
 isImplausibleChallengePace(entry, goalKm) {
 const goal = goalKm > 0 ? goalKm : this.getDailyGoalKm(entry && entry.date ? this.parseEntryDate(entry.date) : new Date());
 const dist = Number(entry && entry.distanceKm) || 0;
 if (!this.meetsDailyGoal(dist, goal)) return false;
 // Legal finish after stripping live spikes → not implausible
 if (this.getDayBoardFinishSec(entry, goal) != null) return false;
 const durationSec = Number(entry && entry.durationSec) || 0;
 const liveGoalSec = Number(entry && entry.timeToGoalSec);
 // Only flag when we have timing evidence that cannot yield a legal finish
 return durationSec > 0 || (Number.isFinite(liveGoalSec) && liveGoalSec > 0);
 }

 minLegalFinishSecForGoal(goalKm) {
 const goal = goalKm > 0 ? goalKm : 1;
 const maxKmh = Number(this.challengeConfig.maxHumanSpeedKmh) || 15;
 return Math.ceil((goal / maxKmh) * 3600);
 }

 /**
 * Build per-day leaderboard from APPROVED step entries only.
 * Rank by best single-attempt time to the day's target KM (not full session time).
 */
 getDayLeaderboardRows(dayNum) {
 const goalKm = this.challengeConfig.dayGoalsKm[dayNum - 1] || dayNum;
 const dateKey = this.getChallengeCalendarDayKey(this.getChallengeDayDate(dayNum));
 const byKey = new Map();
 const entries = this.filterCurrentSeasonEntries(this.stepEntries || []);

 entries.forEach((entry) => {
 // Bucket by Asia/Kolkata calendar day from entry.date (not stale challengeDay alone).
 const entryDay = this.getChallengeDayNumber(this.parseEntryDate(entry.date));
 if (entryDay !== dayNum) return;
 if (!this.isDayBoardEligibleEntry(entry, goalKm)) return;

 const participant = this.findParticipantForEntry(entry);
 // Prefer stable auth/employee ids from the entry so missing profiles still rank
 const key = String(
 entry.userUid ||
 entry.userId ||
 entry.userEmployeeId ||
 (participant && (participant.uid || participant.id || participant.employeeId || participant.email)) ||
 entry.userEmail ||
 entry.userName ||
 entry.id
 );
 const dist = Number(entry.distanceKm) || 0;
 const steps = Number(entry.steps) || 0;
 // Legal finish only (strips timeToGoalSec GPS spikes that falsely DQ real finishers)
 const finishSec = this.getDayBoardFinishSec(entry, goalKm);
 const goalMet = this.meetsDailyGoal(dist, goalKm);
 // Goal reached + timing proves illegal pace → exclude. No timing → still count (feed parity).
 if (goalMet && finishSec == null && this.hasTimingEvidence(entry)) return;

 const row = byKey.get(key) || {
 name: this.resolveDisplayName(participant && participant.name, entry.userName) || 'Unknown',
 department: (participant && participant.department) || '',
 steps: 0,
 distanceKm: 0,
 durationSec: null,
 bestFinishSec: null,
 completed: false,
 goalKm,
 dateKey,
 attempts: 0
 };
 row.attempts += 1;
 // Keep best attempt stats for display
 if (dist > (row.distanceKm || 0)) {
 row.distanceKm = dist;
 row.steps = steps;
 }
 if (finishSec != null) {
 row.completed = true;
 if (row.bestFinishSec == null || finishSec < row.bestFinishSec) {
 row.bestFinishSec = finishSec;
 row.durationSec = finishSec;
 // Prefer the winning attempt's distance/steps on the board
 row.distanceKm = dist;
 row.steps = steps;
 row.bestEntryId = entry.id;
 }
 } else if (goalMet && !this.hasTimingEvidence(entry)) {
 // Finished the KM goal but device did not store a duration — still count as a finisher
 row.completed = true;
 row.bestEntryId = row.bestEntryId || entry.id;
 }
 byKey.set(key, row);
 });

 return Array.from(byKey.values())
 .map((row) => ({
 name: row.name,
 department: row.department,
 steps: row.steps,
 distanceKm: Number(row.distanceKm) || 0,
 completed: !!row.completed,
 durationSec: row.completed ? row.bestFinishSec : null,
 goalKm,
 dateKey: row.dateKey,
 attempts: row.attempts
 }))
 .filter((row) => row.steps > 0 || row.distanceKm > 0.005)
 .sort((a, b) => {
 if (a.completed !== b.completed) {
 return a.completed ? -1 : 1;
 }
 if (a.completed && b.completed) {
 const da = a.durationSec != null ? a.durationSec : Number.MAX_SAFE_INTEGER;
 const db = b.durationSec != null ? b.durationSec : Number.MAX_SAFE_INTEGER;
 if (da !== db) return da - db;
 return a.distanceKm - b.distanceKm;
 }
 if (b.distanceKm !== a.distanceKm) return b.distanceKm - a.distanceKm;
 return b.steps - a.steps;
 });
 }

 /**
 * Promote pending legal day-goal finishes to approved so they stick on
 * day boards, totals, and the team feed after a refresh.
 */
 async healPendingDayBoardEntries(dayNum) {
 const goalKm = this.challengeConfig.dayGoalsKm[dayNum - 1] || dayNum;
 const entries = this.filterCurrentSeasonEntries(this.stepEntries || []);
 const toHeal = [];
 for (const entry of entries) {
 if (!entry || !entry.id) continue;
 const st = String(entry.status || 'pending').toLowerCase();
 if (st !== 'pending') continue;
 if (this.getChallengeDayNumber(this.parseEntryDate(entry.date)) !== dayNum) continue;
 if (!this.meetsDailyGoal(Number(entry.distanceKm) || 0, goalKm)) continue;
 if (this.getDayBoardFinishSec(entry, goalKm) == null) continue;
 entry.status = 'approved';
 entry.validatedBy = entry.validatedBy || 'Day board auto-heal';
 entry.validatedAt = new Date().toISOString();
 entry.notes = entry.notes || `Auto-approved: legal Day ${dayNum} finish (${goalKm} KM).`;
 toHeal.push(entry);
 }
 if (!toHeal.length) return;
 this.saveStepEntries();
 for (const entry of toHeal) {
 try {
 await this.upsertStepEntryInFirebase(entry);
 await this.syncActivityFeedForEntry(entry);
 } catch (e) {
 console.warn('healPendingDayBoardEntries failed for', entry.id, e);
 }
 }
 this.recalculateAllParticipantTotalsFromApproved();
 }

 updateLeaderboardSubtitle(filter) {
 const el = document.getElementById('leaderboardSubtitle');
 if (!el) return;
 if (filter === 'total') {
 el.textContent = 'Overall ranking by total steps';
 } else if (filter === 'today') {
 el.textContent = 'Ranking by steps logged today';
 } else if (filter === 'avg') {
 el.textContent = 'Ranking by average steps per active day';
 } else if (String(filter).startsWith('day-')) {
 const dayNum = parseInt(String(filter).split('-')[1], 10);
 const goalKm = this.challengeConfig.dayGoalsKm[dayNum - 1] || dayNum;
 const dayDate = this.getChallengeDayDate(dayNum);
 const dateLabel = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
 el.textContent = `Day ${dayNum} (${dateLabel}) - ${goalKm} KM - shortest time to ${goalKm} KM wins (best attempt)`;
 } else {
 el.textContent = '';
 }
 }

 async updateLeaderboard(filter, options = {}) {
 if (!filter) {
 // Scope to leaderboard card — admin dashboard also uses .filter-btn.active
 const active = document.querySelector(
 '#leaderboardCard .day-filter-btn.active, #leaderboardCard .filter-btn.active, #dayLeaderboardFilters .day-filter-btn.active'
 );
 filter = (active && active.dataset.filter) || this._leaderboardRenderFilter || 'total';
 }
 this._leaderboardRenderFilter = filter;
        const list = document.getElementById('leaderboardList');
        if (!list) return; // Element doesn't exist on admin page
        list.innerHTML = '';
 this.updateLeaderboardSubtitle(filter);

 const skipRemoteSync = !!(options && options.skipRemoteSync);
 const forceSync = !!(options && options.forceSync);
 const syncStaleMs = 45000;
 const syncIsStale = !this._lastStepEntriesSyncAt || (Date.now() - this._lastStepEntriesSyncAt) > syncStaleMs;

 // Refresh from Firebase when needed — but never thrash on every paint (iOS Safari OOM)
 if (this.firebaseEnabled && !skipRemoteSync && (forceSync || syncIsStale)) {
 // Skip nested leaderboard refresh; this call will render with the correct filter
 await this.syncParticipantsFromFirebase({ skipEntries: false, skipLeaderboardRefresh: true });
 } else if (!Array.isArray(this.stepEntries) || this.stepEntries.length === 0) {
 this.stepEntries = this.loadStepEntries();
 }
 // Always season-filter before ranking (local cache may still contain old-season rows)
 this.stepEntries = this.filterCurrentSeasonEntries(this.stepEntries || this.loadStepEntries());
 this.participants = this.filterCurrentSeasonParticipants(this.participants || this.loadParticipants());
 this.recalculateAllParticipantTotalsFromApproved();

        let sorted = [];
 const dayMatch = String(filter).match(/^day-(\d+)$/);

 if (dayMatch) {
 const dayNum = parseInt(dayMatch[1], 10);
 // Bring Team Feed finishers into stepEntries before ranking (fixes feed≠board gap)
 try {
 await this.hydrateDayBoardEntriesFromFeed(dayNum);
 } catch (hydrateErr) {
 console.warn('Day board feed hydrate skipped:', hydrateErr);
 }
 this.stepEntries = this.filterCurrentSeasonEntries(this.stepEntries || []);
 sorted = this.getDayLeaderboardRows(dayNum);
 // Heal pending legal finishers so totals/feed stay in sync with the day board
 this.healPendingDayBoardEntries(dayNum).catch(() => {});
 if (sorted.length === 0) {
 list.innerHTML = `<div class="leaderboard-item"><div class="rank">-</div><div class="name">No approved finishers for Day ${dayNum} yet</div><div class="steps">Be the first!</div></div>`;
 return;
 }

 sorted.forEach((participant, index) => {
 const item = document.createElement('div');
 item.className = 'leaderboard-item' + (participant.completed && index === 0 ? ' is-day-winner' : '');
 const status = participant.completed
 ? (participant.durationSec != null
 ? `Finished - ${this.formatDurationClock(participant.durationSec)}`
 : `Finished - ${participant.distanceKm.toFixed(2)} KM`)
 : `${participant.distanceKm.toFixed(2)} KM - in progress`;
 const detail = participant.completed
 ? `${participant.goalKm} KM goal`
 : `${Math.min(100, Math.round((participant.distanceKm / participant.goalKm) * 100))}% of ${participant.goalKm} KM`;
 item.innerHTML = `
 <div class="rank">${index + 1}</div>
 <div class="name">${this.escapeHtml(participant.name)}${participant.department ? ` (${this.escapeHtml(participant.department)})` : ''}${participant.completed && index === 0 ? ' <span class="day-winner-tag">Winner</span>' : ''}<div class="lb-detail">${detail}</div></div>
 <div class="steps">${status}</div>
 `;
 list.appendChild(item);
 });
 return;
 }

        if (filter === 'total') {
            sorted = [...this.participants].sort((a, b) => 
                (b.totalSteps || 0) - (a.totalSteps || 0)
            );
        } else if (filter === 'today') {
            const today = new Date().toDateString();
            sorted = [...this.participants]
                .map(p => ({
                    ...p,
                    todaySteps: (p.dailySteps && p.dailySteps[today]) || 0
                }))
                .sort((a, b) => b.todaySteps - a.todaySteps);
        } else if (filter === 'avg') {
            sorted = [...this.participants]
                .map(p => {
                    const days = Object.keys(p.dailySteps || {}).length || 1;
                    return {
                        ...p,
                        avgSteps: (p.totalSteps || 0) / days
                    };
                })
                .sort((a, b) => b.avgSteps - a.avgSteps);
        }

        // Hide people with zero approved activity on total/today/avg boards
        if (filter === 'total' || filter === 'avg') {
            sorted = sorted.filter((p) => (p.totalSteps || 0) > 0 || (p.totalDistanceKm || 0) > 0.005);
        } else if (filter === 'today') {
            sorted = sorted.filter((p) => (p.todaySteps || 0) > 0);
        }

        if (sorted.length === 0) {
            list.innerHTML = '<div class="leaderboard-item"><div class="rank">-</div><div class="name">No approved activity yet</div><div class="steps">0 steps</div></div>';
            return;
        }

        sorted.forEach((participant, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';

            let stepsDisplay = '';
            if (filter === 'total') {
                stepsDisplay = `${(participant.totalSteps || 0).toLocaleString()} steps`;
            } else if (filter === 'today') {
                stepsDisplay = `${(participant.todaySteps || 0).toLocaleString()} steps`;
            } else if (filter === 'avg') {
                stepsDisplay = `${Math.round(participant.avgSteps || 0).toLocaleString()} avg`;
            }

            item.innerHTML = `
                <div class="rank">${index + 1}</div>
 <div class="name">${this.escapeHtml(participant.name)}${participant.department ? ` (${this.escapeHtml(participant.department)})` : ''}</div>
                <div class="steps">${stepsDisplay}</div>
            `;

            list.appendChild(item);
        });
    }

    updateActivities() {
        const list = document.getElementById('activityList');
        if (!list) return;
        list.innerHTML = '';

        if (!this.currentUser) {
            list.innerHTML = '<p class="no-activity">No activity yet. Start walking!</p>';
            return;
        }

        // Single source of truth: stepEntries (survives profile reload / sync)
        const fromEntries = (this.stepEntries || [])
            .filter((e) => e && this.entryBelongsToParticipant(e, this.currentUser))
            .sort((a, b) => this.entryTimestampMs(b) - this.entryTimestampMs(a))
            .slice(0, 15)
            .map((e) => {
                const dist = Number(e.distanceKm) || 0;
                const steps = Number(e.steps) || 0;
                const kcal = Number(e.caloriesBurned) || 0;
                const st = String(e.status || 'pending').toLowerCase();
                const mode = this.getActivityTypeLabel
                    ? this.getActivityTypeLabel(e)
                    : (e.trackingMode || 'Activity');
                const statusNote = st === 'rejected' ? ' (not counted — pace check)' : '';
                return {
                    date: e.date,
                    message: `${mode}: ${dist.toFixed(2)} KM · ${steps.toLocaleString()} steps · ~${Math.round(kcal)} kcal${statusNote}`,
                    entryId: e.id
                };
            });

        const legacy = Array.isArray(this.currentUser.activities) ? this.currentUser.activities : [];
        const seen = new Set(fromEntries.map((a) => a.entryId).filter(Boolean));
        const merged = fromEntries.slice();
        legacy.forEach((a) => {
            if (a && a.entryId && seen.has(a.entryId)) return;
            merged.push(a);
        });
        merged.sort((a, b) => this.entryTimestampMs(b) - this.entryTimestampMs(a));
        const rows = merged.slice(0, 15);

        if (!rows.length) {
            list.innerHTML = '<p class="no-activity">No activity yet. Start walking!</p>';
            return;
        }

        rows.forEach((activity) => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            let timeStr = '';
            try {
                timeStr = this.parseEntryDate(activity.date).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {
                timeStr = '';
            }
            item.innerHTML = `
 <div>${this.escapeHtml(activity.message || '')}</div>
                <div class="activity-time">${timeStr}</div>
            `;
            list.appendChild(item);
        });
    }

    logout() {
 if (this.stepCounter.isRunning) {
 this.stopStepCounter();
 } else {
 this.clearActivitySession();
 }
        if (this.firebaseEnabled && this.auth) {
            this.auth.signOut().catch((error) => {
                console.warn('Firebase sign out failed:', error);
            });
        }
        this.currentUser = null;
        localStorage.removeItem('currentUser');
        document.getElementById('loginCard').style.display = 'block';
        document.getElementById('dashboardCard').style.display = 'none';
        this.setLoggedInShell(false);
        document.getElementById('loginForm').reset();
    }

    async handleFirebaseLogin(identifier, password) {
        try {
            await this.ensureFirestore();
            let raw = String(identifier || '').trim();
            let email = raw;
            let participant = null;

            if (this.isEmail(raw)) {
                email = raw.toLowerCase();
            } else {
                participant = await this.lookupFirebaseParticipant(raw);
                if (!participant || !participant.email) {
                    alert(
                        'No account found for that username or Employee ID.\n\n' +
                        'After a password reset, log in with your full CSG email:\n' +
                        'example: name@csgi.com\n\nand your NEW password.'
                    );
                    document.getElementById('loginUsername').focus();
                    return;
                }
                email = String(participant.email).toLowerCase().trim();
            }

            const credential = await this.auth.signInWithEmailAndPassword(email, password);
 if (!this.isCorporateEmail(credential.user.email || email)) {
 await this.auth.signOut();
 alert('Only CSG corporate email accounts can use this challenge.');
 return;
 }
 let profile = participant && participant.uid === credential.user.uid && this.isCurrentSeasonParticipant(participant)
                ? participant
                : await this.loadCurrentUserFromFirebase(credential.user.uid);

 // Auth works but season profile missing/cleared: recreate a fresh challenge profile
 if (!profile) {
 profile = await this.createFreshSeasonProfileFromAuth(credential.user, email);
 }

 if (!profile) {
 await this.auth.signOut();
 alert('Unable to create your challenge profile. Please register again.');
 this.switchLoginTab('user');
 return;
 }

 this.currentUser = this.stripSecretsFromParticipant(profile);
 await this.repairPlaceholderProfileName(this.currentUser, credential.user);
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

            document.getElementById('loginForm').reset();
            this.showDashboard();
            this.updateLeaderboard();
            this.loadActivityFeed(true);
        } catch (error) {
 if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
                alert(
                    'Login failed: email or password is incorrect.\n\n' +
                    'After resetting your password:\n' +
                    '1) Use your full CSG email (@csgi.com), not username\n' +
                    '2) Use the NEW password from the reset link\n' +
                    '3) Try Incognito/Private window or hard refresh (Ctrl+F5)\n\n' +
                    'Still stuck? Email wow-csg@csgi.com'
                );
                document.getElementById('loginPassword').focus();
            } else if (error.code === 'auth/user-not-found') {
                alert('No Firebase account found for that email. Please register first, or contact wow-csg@csgi.com');
                document.getElementById('loginUsername').focus();
            } else if (error.code === 'permission-denied' || /permission-denied|insufficient permissions/i.test(String(error.message || ''))) {
                alert(
                    'Login authenticated, but profile access was blocked.\n\n' +
                    'Please hard refresh (Ctrl+F5) and try again with your CSG email.\n' +
                    'If it still fails, contact wow-csg@csgi.com'
                );
            } else if (error.code === 'auth/too-many-requests') {
                alert('Too many failed login attempts. Please wait a few minutes, then try again with your CSG email and new password.');
            } else {
                console.error('Firebase login error:', error);
                alert('Login failed. Please try again.\n\n' + (error.code || '') + ' ' + (error.message || ''));
            }
        }
    }

 /**
 * When Auth login succeeds but challenge data was cleared / old season,
 * rebuild a zeroed profile for the current season from any prior Firestore doc.
 */
 async createFreshSeasonProfileFromAuth(authUser, email) {
 if (!this.firebaseEnabled || !this.db || !authUser) {
            return null;
        }

 const uid = authUser.uid;
 const emailFinal = String(email || authUser.email || '').toLowerCase().trim();
 let prior = null;
 try {
 const doc = await this.participantsCol().doc(uid).get();
 if (doc.exists) {
 prior = doc.data();
 }
 } catch (error) {
 console.warn('Could not read prior profile:', error);
 }

 if (!prior) {
 try {
 if (emailFinal) {
 const snap = await this.participantsCol().where('emailLower', '==', emailFinal).limit(5).get();
 if (!snap.empty) {
 prior = snap.docs[0].data();
 }
 }
 } catch (error) {
 console.warn('Could not look up prior email profile:', error);
 }
 }

 const safeId = String((prior && (prior.id || prior.employeeId)) || `USER_${Date.now()}`);
 const usernameBase = String((prior && prior.username) || emailFinal.split('@')[0] || 'user');
 const resolvedName = this.resolveDisplayName(
   prior && prior.name,
   authUser.displayName,
   usernameBase.includes('.') || usernameBase.includes('_') ? usernameBase.replace(/[._]/g, ' ') : '',
   this.deriveDisplayNameFromEmail(emailFinal || (prior && prior.email))
 ) || 'Challenge Participant';
 const participant = {
 uid,
 id: safeId,
 employeeId: safeId,
 name: resolvedName,
 email: emailFinal || (prior && prior.email) || '',
 emailLower: emailFinal || String((prior && prior.email) || '').toLowerCase(),
 username: usernameBase,
 usernameLower: usernameBase.toLowerCase(),
 employeeIdLower: safeId.toLowerCase(),
 totalSteps: prior && prior.season === this.dataSeason ? (prior.totalSteps || 0) : 0,
 dailySteps: prior && prior.season === this.dataSeason ? (prior.dailySteps || {}) : {},
 streak: prior && prior.season === this.dataSeason ? (prior.streak || 0) : 0,
 lastActivity: prior && prior.season === this.dataSeason ? (prior.lastActivity || null) : null,
 activities: prior && prior.season === this.dataSeason ? (prior.activities || []) : [],
 registeredAt: (prior && prior.registeredAt) || new Date().toISOString(),
 season: this.dataSeason
 };

 try {
 // merge:true so missing legacy fields (uid) get fixed without full-doc create conflicts
 await this.participantsCol().doc(uid).set(participant, { merge: true });
 } catch (writeErr) {
 console.error('Failed to write season profile:', writeErr);
 // Still allow login with in-memory profile if rules briefly lag
 }

 this.participants = this.filterCurrentSeasonParticipants(
 this.participants.filter((p) => p.uid !== uid).concat([participant])
 );
 this.saveParticipantsCache();
 return participant;
 }

 async lookupFirebaseParticipant(identifier) {
 await this.ensureFirestore();
 if (!this.firebaseEnabled || !this.db) {
 return null;
 }

 // Firestore participant reads require a signed-in corporate user.
 // Before Auth, skip cloud lookup (avoids permission-denied on login).
 if (!this.auth || !this.auth.currentUser) {
 const local = (this.participants || []).find((p) => {
 const id = String(identifier || '').toLowerCase();
 return (
 String(p.usernameLower || p.username || '').toLowerCase() === id ||
 String(p.employeeIdLower || p.employeeId || p.id || '').toLowerCase() === id ||
 String(p.emailLower || p.email || '').toLowerCase() === id
 );
 });
 return local || null;
 }

 const normalizedIdentifier = identifier.toLowerCase();
 const collection = this.participantsCol();

 const pickCurrent = (snap) => {
 const all = snap.docs.map((d) => d.data());
 // Prefer current season, but fall back to any match so password login can resolve email
 return all.find((p) => this.isCurrentSeasonParticipant(p)) || all[0] || null;
 };

 try {
 const usernameSnap = await collection.where('usernameLower', '==', normalizedIdentifier).limit(25).get();
 const byUsername = pickCurrent(usernameSnap);
 if (byUsername) return byUsername;

 const employeeIdSnap = await collection.where('employeeIdLower', '==', normalizedIdentifier).limit(25).get();
 const byEmployee = pickCurrent(employeeIdSnap);
 if (byEmployee) return byEmployee;

 const emailSnap = await collection.where('emailLower', '==', normalizedIdentifier).limit(25).get();
 const byEmail = pickCurrent(emailSnap);
 if (byEmail) return byEmail;
 } catch (err) {
 console.warn('lookupFirebaseParticipant failed:', err);
 }

        return null;
    }

    async isFirebaseFieldTaken(fieldName, value) {
        if (!this.firebaseEnabled || !this.db) {
            return false;
        }
        // Pre-registration callers are signed out; Firestore rules require corporate auth to read.
        // Skip blocking checks until after Auth signup — email uniqueness is enforced by Firebase Auth.
        if (!this.auth || !this.auth.currentUser) {
            return false;
        }
        try {
            const snap = await this.participantsCol()
                .where(fieldName, '==', value)
                .where('season', '==', this.dataSeason)
                .limit(1)
                .get();
            return !snap.empty;
        } catch (error) {
            console.warn('Duplicate check skipped:', error.message || error);
            return false;
        }
    }

    async loadCurrentUserFromFirebase(uid) {
        await this.ensureFirestore();
        if (!this.firebaseEnabled || !this.db) {
            return null;
        }
        try {
 const doc = await this.participantsCol().doc(uid).get();
            if (!doc.exists) {
                return null;
            }
            const participant = doc.data();
 // Old-season profiles are treated as cleared
 if (!this.isCurrentSeasonParticipant(participant)) {
 return null;
 }
 this.currentUser = this.stripSecretsFromParticipant(participant);
 if (this.isPlaceholderDisplayName(this.currentUser.name)) {
   const authUser = this.auth && this.auth.currentUser;
   await this.repairPlaceholderProfileName(this.currentUser, authUser);
 }
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
 return this.currentUser;
        } catch (error) {
            console.error('Failed to load user profile from Firebase:', error);
            return null;
        }
    }

    async syncParticipantsFromFirebase(options = {}) {
        await this.ensureFirestore();
        if (!this.firebaseEnabled || !this.db) {
            return;
        }
        try {
 const snapshot = await this.participantsCol().get();
 this.participants = this.filterCurrentSeasonParticipants(
 snapshot.docs.map((doc) => this.stripSecretsFromParticipant(doc.data()))
 );
 this.saveParticipantsCache();
 if (!options.skipEntries) {
 // Always refresh entries first — local cache can still say "approved" after admin reject
 await this.syncStepEntriesFromFirebase();
 this.recalculateAllParticipantTotalsFromApproved();
 }
            if (!options.skipLeaderboardRefresh && !window.location.pathname.includes('admin.html')) {
                await this.updateLeaderboard(this._leaderboardRenderFilter || null, { skipRemoteSync: true });
            }
        } catch (error) {
            console.warn('Failed to sync participants from Firebase:', error);
        }
    }

    async syncStepEntriesFromFirebase() {
        await this.ensureFirestore();
        if (!this.firebaseEnabled || !this.db) {
            return;
        }
        if (this._leaderboardSyncInFlight) {
            return this._leaderboardSyncInFlight;
        }
        this._leaderboardSyncInFlight = (async () => {
            try {
                const localBefore = Array.isArray(this.stepEntries)
                    ? this.stepEntries.slice()
                    : this.loadStepEntriesSafely();
                const snapshot = await this.stepEntriesCol().get();
                const lean = this.isLowMemoryClient();
                const remote = this.filterCurrentSeasonEntries(
                    snapshot.docs.map((doc) => {
                        const data = doc.data();
                        // Ensure id is always present (some older docs relied on doc id only)
                        if (data && !data.id && doc.id) data.id = doc.id;
                        return lean ? this.leanStepEntry(data) : data;
                    })
                );
                // MERGE — never replace local saves with a stale remote snapshot
                this.stepEntries = this.filterCurrentSeasonEntries(
                    this.mergeStepEntries(localBefore, remote)
                );
                this._lastStepEntriesSyncAt = Date.now();
                this.saveStepEntries();
                if (this.currentUser) {
                    this.refreshCurrentUserTotalsFromEntries();
                }
            } catch (error) {
                console.warn('Failed to sync step entries from Firebase:', error);
            } finally {
                this._leaderboardSyncInFlight = null;
            }
        })();
        return this._leaderboardSyncInFlight;
    }

    /**
     * Build a Firestore-safe payload: drop secrets, undefined, and null-only banned keys.
     * Always stamp userUid from the live Auth session (stale local uid caused permission errors).
     */
    buildFirestoreWritePayload(entry, options = {}) {
        const authUser = this.auth && this.auth.currentUser;
        if (!authUser) {
            throw new Error('Not signed in to Firebase Auth. Please log out and log in again.');
        }
        const payload = { ...(entry || {}) };
        const dropKeys = [
            'screenshot', 'password', 'passwordHash', 'bodyWeightKg',
            '_cloudSynced', '_cloudSyncError', 'photoBase64'
        ].concat(options.dropKeys || []);
        dropKeys.forEach((k) => { delete payload[k]; });

        // Live Auth uid must match rules: request.resource.data.userUid == request.auth.uid
        payload.userUid = authUser.uid;
        if (payload.id == null && options.docId) payload.id = options.docId;

        Object.keys(payload).forEach((key) => {
            if (payload[key] === undefined) delete payload[key];
        });
        if (payload.path) {
            payload.path = this.sanitizePathForCloud(payload.path);
        }
        return payload;
    }

    async upsertStepEntryInFirebase(entry) {
        await this.ensureFirestore();
        if (!this.firebaseEnabled || !this.db || !entry || !entry.id) {
            return false;
        }
        if (!this.auth || !this.auth.currentUser) {
            entry._cloudSynced = false;
            entry._cloudSyncError = 'Not signed in to Firebase Auth';
            if (!this._pendingEntryIds) this._pendingEntryIds = new Set();
            this._pendingEntryIds.add(String(entry.id));
            console.warn('upsertStepEntryInFirebase blocked: no Firebase Auth session');
            return false;
        }
        if (!this._pendingEntryIds) this._pendingEntryIds = new Set();
        this._pendingEntryIds.add(String(entry.id));
        try {
            const payload = this.buildFirestoreWritePayload(entry);
            // Keep local entry aligned with Auth uid for future merges
            entry.userUid = payload.userUid;
            await this.stepEntriesCol().doc(entry.id).set(payload, { merge: true });
            this._pendingEntryIds.delete(String(entry.id));
            entry._cloudSynced = true;
            entry._cloudSyncError = null;
            return true;
        } catch (error) {
            console.warn('Failed to upsert step entry in Firebase:', error);
            entry._cloudSynced = false;
            entry._cloudSyncError = String((error && error.message) || error);
            // Keep id in _pendingEntryIds so sync cannot wipe this local save
            return false;
        }
    }

    /** Re-upload local entries that never made it to Firebase. */
    async retryPendingCloudUploads() {
        return this.recoverUnsyncedActivitiesForCurrentUser({ silent: true });
    }

    /** Keep a durable backup of cloud-failed saves (survives stepEntries cache wipes). */
    persistUnsyncedBackup(entry) {
        if (!entry || !entry.id) return;
        try {
            const key = 'wowcsg_unsynced_entries_v1';
            let list = [];
            try {
                list = JSON.parse(localStorage.getItem(key) || '[]');
            } catch (e) {
                list = [];
            }
            if (!Array.isArray(list)) list = [];
            const lean = {
                ...this.leanStepEntry(entry),
                _cloudSynced: false,
                _cloudSyncError: entry._cloudSyncError || 'pending upload'
            };
            const idx = list.findIndex((e) => e && String(e.id) === String(entry.id));
            if (idx >= 0) list[idx] = lean;
            else list.unshift(lean);
            localStorage.setItem(key, JSON.stringify(list.slice(0, 80)));
        } catch (e) {
            console.warn('persistUnsyncedBackup failed:', e);
        }
    }

    loadUnsyncedBackup() {
        try {
            const list = JSON.parse(localStorage.getItem('wowcsg_unsynced_entries_v1') || '[]');
            return Array.isArray(list) ? list.filter((e) => e && e.id) : [];
        } catch (e) {
            return [];
        }
    }

    clearUnsyncedBackupIds(ids) {
        if (!ids || !ids.length) return;
        try {
            const key = 'wowcsg_unsynced_entries_v1';
            const set = new Set(ids.map(String));
            const list = this.loadUnsyncedBackup().filter((e) => !set.has(String(e.id)));
            localStorage.setItem(key, JSON.stringify(list));
        } catch (e) { /* ignore */ }
    }

    /**
     * Rebuild a step entry from the Recent Activity log when stepEntries was wiped.
     */
    rebuildEntryFromActivityLog(activity) {
        if (!activity || !this.currentUser) return null;
        const authUid = (this.auth && this.auth.currentUser && this.auth.currentUser.uid)
            || this.currentUser.uid;
        if (!authUid) return null;
        const id = activity.entryId || `RECOVER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const distanceKm = Number(activity.distanceKm) || 0;
        const steps = Number(activity.steps) || 0;
        if (distanceKm <= 0 && steps <= 0) return null;
        const msg = String(activity.message || '').toLowerCase();
        const trackingMode = /treadmill/.test(msg) ? 'treadmill' : 'outdoor';
        return {
            id,
            userId: this.currentUser.id || this.currentUser.employeeId || 'unknown',
            userUid: authUid,
            userName: this.resolveDisplayName(this.currentUser.name, this.currentUser.username) || 'Unknown User',
            userEmail: this.currentUser.email || this.currentUser.emailId || '',
            steps,
            distanceKm: Number(distanceKm.toFixed(3)),
            caloriesBurned: Number(activity.caloriesBurned) || 0,
            path: [],
            durationSec: null,
            timeToGoalSec: null,
            date: activity.date || new Date().toISOString(),
            challengeDay: this.getChallengeDayNumber(this.parseEntryDate(activity.date || new Date())),
            status: 'approved',
            validatedBy: 'Local activity recovery',
            validatedAt: new Date().toISOString(),
            notes: activity.message || 'Recovered from local activity history',
            source: trackingMode === 'treadmill' ? 'treadmill-counter' : 'gps-counter',
            trackingMode,
            season: this.dataSeason,
            _cloudSynced: false,
            _recoveredFromActivityLog: true
        };
    }

    /**
     * Recover activities that saved locally but never reached Firebase / history wipe.
     * Sources: stepEntries (unsynced), durable backup key, currentUser.activities log.
     */
    async recoverUnsyncedActivitiesForCurrentUser(options = {}) {
        const silent = !!(options && options.silent);
        await this.ensureFirestore();
        if (!this.firebaseEnabled || !this.db || !this.auth || !this.auth.currentUser) {
            if (!silent) {
                alert('Please log in with your @csgi.com email first, then tap Recover again.');
            }
            return { uploaded: 0, restored: 0, failed: 0 };
        }
        if (!this.currentUser) {
            if (!silent) alert('No signed-in profile found.');
            return { uploaded: 0, restored: 0, failed: 0 };
        }

        if (!Array.isArray(this.stepEntries)) {
            this.stepEntries = this.loadStepEntriesSafely();
        }

        // 1) Merge durable backup into memory
        let restored = 0;
        const backup = this.loadUnsyncedBackup();
        backup.forEach((e) => {
            if (!e || !e.id) return;
            if (!this.entryBelongsToParticipant(e, this.currentUser)
                && String(e.userUid || '') !== String(this.auth.currentUser.uid)
                && String(e.userEmail || '').toLowerCase() !== String(this.currentUser.email || this.currentUser.emailId || '').toLowerCase()) {
                // Still keep if email/uid matches auth
                const authEmail = String((this.auth.currentUser.email || '')).toLowerCase();
                const eEmail = String(e.userEmail || '').toLowerCase();
                if (String(e.userUid) !== String(this.auth.currentUser.uid) && eEmail !== authEmail) return;
            }
            const exists = (this.stepEntries || []).some((x) => x && String(x.id) === String(e.id));
            if (!exists) {
                this.stepEntries.unshift(e);
                restored += 1;
            }
        });

        // 2) Rebuild from Recent Activity log if missing from stepEntries
        const logs = Array.isArray(this.currentUser.activities) ? this.currentUser.activities : [];
        logs.forEach((act) => {
            if (!act) return;
            const id = act.entryId;
            if (id && (this.stepEntries || []).some((x) => x && String(x.id) === String(id))) return;
            if (!id && !(Number(act.distanceKm) > 0 || Number(act.steps) > 0)) return;
            // Skip very old logs outside challenge
            const day = this.getChallengeDayNumber(this.parseEntryDate(act.date || new Date()));
            if (day < 1) return;
            const rebuilt = this.rebuildEntryFromActivityLog(act);
            if (!rebuilt) return;
            const dup = (this.stepEntries || []).some((x) =>
                x && String(x.id) === String(rebuilt.id)
            );
            if (dup) return;
            this.stepEntries.unshift(rebuilt);
            this.persistUnsyncedBackup(rebuilt);
            restored += 1;
        });

        if (restored) this.saveStepEntries();

        // 3) Find which of MY entries need cloud upload
        const authUid = this.auth.currentUser.uid;
        const backupIds = new Set(this.loadUnsyncedBackup().map((e) => String(e.id)));
        const candidates = (this.stepEntries || []).filter((e) => {
            if (!e || !e.id) return false;
            if (!this.isCurrentSeasonEntry(e)) return false;
            const mine = this.entryBelongsToParticipant(e, this.currentUser)
                || String(e.userUid || '') === String(authUid)
                || String(e.userEmail || '').toLowerCase() === String(this.auth.currentUser.email || '').toLowerCase();
            if (!mine) return false;
            if (e._cloudSynced === false || e._cloudSyncError || e._recoveredFromActivityLog) return true;
            if (this._pendingEntryIds && this._pendingEntryIds.has(String(e.id))) return true;
            if (backupIds.has(String(e.id))) return true;
            // Manual Recover button: also re-check any local entry not known synced
            if (!silent && e._cloudSynced !== true) return true;
            return false;
        });

        let uploaded = 0;
        let failed = 0;
        const uploadedIds = [];
        for (const entry of candidates) {
            try {
                // Skip if already on Firebase (unless marked unsynced)
                const force = entry._cloudSynced === false || !!entry._cloudSyncError || !!entry._recoveredFromActivityLog;
                if (!force) {
                    const snap = await this.stepEntriesCol().doc(entry.id).get();
                    if (snap.exists) {
                        entry._cloudSynced = true;
                        entry._cloudSyncError = null;
                        continue;
                    }
                }
                entry.userUid = authUid;
                const ok = await this.upsertStepEntryInFirebase(entry);
                if (ok) {
                    uploaded += 1;
                    uploadedIds.push(entry.id);
                    if ((entry.status || '') === 'approved') {
                        try {
                            await this.publishActivityFeedPost(entry, { shareToFeed: true, caption: null, photoFile: null });
                        } catch (feedErr) {
                            console.warn('Feed republish skipped:', feedErr);
                        }
                    }
                } else {
                    failed += 1;
                    this.persistUnsyncedBackup(entry);
                }
            } catch (e) {
                failed += 1;
                console.warn('recover upload failed for', entry && entry.id, e);
                this.persistUnsyncedBackup(entry);
            }
        }

        this.clearUnsyncedBackupIds(uploadedIds);
        this.saveStepEntries();
        this.refreshCurrentUserTotalsFromEntries();
        this.recalculateParticipantTotalsFromApproved(this.currentUser);
        this.saveParticipantsCache();
        this.syncParticipantToFirebase(this.currentUser);
        this.updateDashboard();
        this.updateActivities();
        await this.updateLeaderboard(null, { skipRemoteSync: true });
        this.loadActivityFeed(true);

        if (!silent) {
            if (uploaded || restored) {
                alert(
                    `Recovery finished.\n\n` +
                    `Restored locally: ${restored}\n` +
                    `Uploaded to cloud: ${uploaded}\n` +
                    (failed ? `Still failed: ${failed}\n` : '') +
                    `\nCheck Recent Activity and the Day leaderboard.`
                );
            } else if (failed) {
                alert(`Could not upload ${failed} activit(y/ies). Log out, log in again, then tap Recover once more.`);
            } else {
                alert('No unsaved local activities were found on this device to recover.\n\nIf they were wiped earlier, they cannot be restored from the cloud and need to be recorded again.');
            }
        } else if (uploaded > 0 && typeof this.showToast === 'function') {
            this.showToast(`Recovered ${uploaded} activit${uploaded === 1 ? 'y' : 'ies'} to the cloud`);
        }

        return { uploaded, restored, failed };
    }

    async deleteStepEntryFromFirebase(entryId) {
        if (!this.firebaseEnabled || !this.db || !entryId) {
            return;
        }
        try {
 await this.stepEntriesCol().doc(entryId).delete();
        } catch (error) {
            console.warn('Failed to delete step entry from Firebase:', error);
        }
    }

    async syncParticipantToFirebase(participant) {
        if (!this.firebaseEnabled || !this.db || !participant || !participant.uid) {
            return;
        }
        try {
 await this.participantsCol().doc(participant.uid).set(participant, { merge: true });
        } catch (error) {
            console.warn('Failed to sync participant to Firebase:', error);
        }
    }

    async migrateLocalUsersToFirebase() {
 if (!this.requireAdmin()) {
 return;
 }
        if (!this.firebaseEnabled || !this.auth || !this.db) {
            alert('Firebase is not configured. Please update firebase-config.js first.');
            return;
        }

        const localUsers = this.getLegacyParticipantsForMigration();
        const localStepEntries = this.getLegacyStepEntriesForMigration();
        if (!localUsers.length && !localStepEntries.length) {
            alert('No local users or step entries found to migrate.');
            return;
        }

        const confirmed = confirm(
            `This will migrate ${localUsers.length} local users and ${localStepEntries.length} step entries to Firebase.\n\n` +
            `New accounts will receive a password reset email.\n` +
            `Continue?`
        );
        if (!confirmed) {
            return;
        }

        const results = {
            processed: 0,
            createdAuth: 0,
            createdDocs: 0,
            updatedDocs: 0,
            skippedMissingEmail: 0,
            skippedInvalidEmail: 0,
            skippedExistingAuthNoDoc: 0,
            stepEntriesMigrated: 0,
            stepEntriesSkipped: 0,
            failed: 0
        };

        this.isMigratingUsers = true;

        try {
            for (const localUser of localUsers) {
                results.processed += 1;
                const email = localUser.email || localUser.emailId || '';

                if (!email) {
                    results.skippedMissingEmail += 1;
                    continue;
                }

                if (!this.isEmail(email)) {
                    results.skippedInvalidEmail += 1;
                    continue;
                }

                let uid = null;
                let docRef = null;
                let docExists = false;

                const emailLower = email.toLowerCase();
                const existingDocSnap = await this.db
 .collection(this.participantsCollection)
                    .where('emailLower', '==', emailLower)
                    .limit(1)
                    .get();

                if (!existingDocSnap.empty) {
                    docRef = existingDocSnap.docs[0].ref;
                    uid = existingDocSnap.docs[0].id;
                    docExists = true;
                }

                let authExists = false;
                try {
                    const methods = await this.auth.fetchSignInMethodsForEmail(email);
                    authExists = Array.isArray(methods) && methods.length > 0;
                } catch (error) {
                    console.warn('Failed to check auth for email:', email, error);
                }

                if (!uid && !authExists) {
                    try {
                        const tempPassword = this.generateTempPassword();
                        const credential = await this.auth.createUserWithEmailAndPassword(email, tempPassword);
                        uid = credential.user.uid;
 docRef = this.participantsCol().doc(uid);
                        results.createdAuth += 1;

                        try {
                            await this.auth.sendPasswordResetEmail(email);
                        } catch (error) {
                            console.warn('Failed to send reset email for', email, error);
                        }
                    } catch (error) {
                        console.error('Failed to create Firebase user for', email, error);
                        results.failed += 1;
                        continue;
                    }
                }

                if (!uid && authExists) {
                    results.skippedExistingAuthNoDoc += 1;
                    continue;
                }

                const normalized = this.normalizeLocalParticipant(localUser, uid);
                if (!docRef) {
 docRef = this.participantsCol().doc(uid);
                }

                await docRef.set(normalized, { merge: true });
                if (docExists) {
                    results.updatedDocs += 1;
                } else {
                    results.createdDocs += 1;
                }
            }

            for (const entry of localStepEntries) {
                if (!entry || !entry.id) {
                    results.stepEntriesSkipped += 1;
                    continue;
                }

                let userUid = null;
                if (entry.userUid) {
                    userUid = entry.userUid;
                } else if (entry.userEmail && this.isEmail(entry.userEmail)) {
                    const participant = await this.lookupFirebaseParticipant(entry.userEmail);
                    if (participant && participant.uid) {
                        userUid = participant.uid;
                    }
                } else if (entry.userId) {
                    const participant = await this.lookupFirebaseParticipant(entry.userId);
                    if (participant && participant.uid) {
                        userUid = participant.uid;
                    }
                }

                const normalizedEntry = this.normalizeStepEntry(entry, userUid);
 await this.stepEntriesCol().doc(normalizedEntry.id).set(normalizedEntry, { merge: true });
                results.stepEntriesMigrated += 1;
            }
        } finally {
            this.isMigratingUsers = false;
            try {
                await this.auth.signOut();
            } catch (error) {
                console.warn('Firebase sign out failed after migration:', error);
            }
            this.currentUser = null;
            localStorage.removeItem('currentUser');
        }

        await this.syncParticipantsFromFirebase();
        await this.syncStepEntriesFromFirebase();

        alert(
            `Migration complete.\n\n` +
            `Processed: ${results.processed}\n` +
            `Auth created: ${results.createdAuth}\n` +
            `Profiles created: ${results.createdDocs}\n` +
            `Profiles updated: ${results.updatedDocs}\n` +
            `Skipped (missing email): ${results.skippedMissingEmail}\n` +
            `Skipped (invalid email): ${results.skippedInvalidEmail}\n` +
            `Skipped (auth exists, no profile): ${results.skippedExistingAuthNoDoc}\n` +
            `Step entries migrated: ${results.stepEntriesMigrated}\n` +
            `Step entries skipped: ${results.stepEntriesSkipped}\n` +
            `Failed: ${results.failed}`
        );
    }

    saveParticipantsCache() {
        const storageKey = this.firebaseEnabled ? 'participants_cache' : 'participants';
 const sanitized = (this.participants || []).map((p) => this.stripSecretsFromParticipant(p));
 this.participants = sanitized;
 localStorage.setItem(storageKey, JSON.stringify(sanitized));
    }

    loadParticipants() {
        const storageKey = this.firebaseEnabled ? 'participants_cache' : 'participants';
        const saved = localStorage.getItem(storageKey);
 if (!saved) {
 return [];
 }
 try {
 const parsed = JSON.parse(saved);
 if (!Array.isArray(parsed)) {
 return [];
 }
 return parsed.map((p) => this.stripSecretsFromParticipant(p));
 } catch (error) {
 console.warn('Failed to parse participants cache:', error);
 return [];
 }
    }

    // Step Counter Functions
    showStepCounterPanel() {
        // This function is kept for backward compatibility but now we use tabs
        this.switchInputMethod('counter');
    }

    hideStepCounterPanel() {
        // This function is kept for backward compatibility
        // When switching away from counter tab, stop if running
        if (this.stepCounter.isRunning) {
            this.stopStepCounter();
        }
    }

    async requestMotionPermission() {
        // Request device motion permission (iOS 13+)
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceMotionEvent.requestPermission();
                this.stepCounter.permissionGranted = permission === 'granted';
                if (!this.stepCounter.permissionGranted) {
                    this.updateCounterStatus('Permission denied. Please enable motion access in settings.');
                }
            } catch (error) {
                console.error('Error requesting motion permission:', error);
                this.updateCounterStatus('Unable to access motion sensors.');
            }
        } else {
            // Android and older iOS - permission not required
            this.stepCounter.permissionGranted = true;
        }
    }

    startStepCounter() {
        const mode = this.getTrackingMode();
        // Treadmill: no user speed — distance comes from pedometer/steps only

        if (!this.stepCounter.permissionGranted && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            this.requestMotionPermission().then(() => {
                if (this.stepCounter.permissionGranted) {
                    this.initializeStepCounter();
                }
            });
            return;
        }

        this.initializeStepCounter();
    }

    initializeStepCounter() {
        if (this.stepCounter.isRunning) return;

 const mode = this.getTrackingMode();
 this.stepCounter.trackingMode = mode;
        this.stepCounter.isRunning = true;
        this.stepCounter.isPaused = false;
        this.stepCounter.elapsedSecAtPause = 0;
        this.stepCounter.startTime = Date.now();
        this.stepCounter.lastAcceleration = { x: 0, y: 0, z: 0 };
        this.stepCounter.stepHistory = [];
        this.stepCounter.accelerationHistory = [];
 this.stepCounter.distanceKm = 0;
 this.stepCounter.path = [];
 this.stepCounter.lastPosition = null;
 this.stepCounter.stepCount = 0;
 this.stepCounter.treadmillDistanceKm = 0;
 this.stepCounter.lastTreadmillTickAt = Date.now();
 this.stepCounter.treadmillSpeedKmh = null;

 // Treadmill: slightly more sensitive motion thresholds (phone in pocket / on arm)
 if (mode === 'treadmill') {
 this.stepCounter.threshold = 0.85;
 this.stepCounter.minVerticalChange = 0.45;
 } else {
 // Outdoor: balanced for pocket / hand (too high under-counts steps)
 this.stepCounter.threshold = 1.05;
 this.stepCounter.minVerticalChange = 0.55;
 }

 this.stepCounter.pendingSegmentKm = 0;
 this.stepCounter.lastAccelMagnitude = 0;
 this.stepCounter.stepPeakArmed = true;
 this.stepCounter.lockedStepEstimateAt = null;
 this.stepCounter.timeToGoalSec = null;
 this.stepCounter.frozenForSave = null;

 this.stepCounter.useNativeStepsOnly = false;
 this.stepCounter.nativeStepBaseline = 0;
 this.bindMotionListener();
 this.applyRunningActivityUi();

 // Capacitor Android: hardware pedometer keeps counting while locked
 this.startNativeTrackingHelpers();

 if (mode === 'treadmill') {
 this.updateCounterStatus('Treadmill mode — KM from phone steps only (no speed entry).');
 this.updateCounterHint('Keep the phone on your body. Distance = steps ÷ steps-per-KM. Fake treadmill speeds are not allowed.');
 this.showCounterNotification('Treadmill started. Walk/run with phone on you — steps drive KM.');
 this.updateTreadmillSpeedPaceLabel(null);
 } else {
 this.updateCounterStatus('Tracking your route — works with screen off when possible.');
 this.updateCounterHint('Keep the app open (Home Screen recommended). Tracking continues while locked when the OS allows.');
 this.showCounterNotification('Activity started. Tracking continues while the phone is locked.');
 const ua = navigator.userAgent || '';
 const isNative = !!(window.WowNative && window.WowNative.isNative);
 if (/iPhone|iPad|iPod/i.test(ua)) {
 this.updateCounterHint('iPhone tip: keep Safari open and the screen on (or guided access). Apple Fitness can keep counting while Safari GPS pauses.');
 this.showCounterNotification('iPhone: keep the screen on for accurate portal KM.');
 } else if (!isNative && /Android/i.test(ua)) {
 this.updateCounterHint('Android web tip: Chrome may pause GPS when locked. Prefer the Android APK, or keep Chrome open with the screen on.');
 this.showCounterNotification('Android Chrome: keep screen on, or use the APK for lock-screen tracking.');
 } else if (isNative) {
 this.updateCounterHint('Android app: tracking continues in the notification while locked. Do not force-stop the app or swipe it away from Recents on some phones.');
 this.showCounterNotification('Android app: leave the tracking notification running while locked.');
 }
 }

 this.startTimer(false);
 this.setupActivityKeepAlive();
 this.setupServiceWorkerTrackingBridge();
 this.notifyServiceWorkerTracking(true);
 // Foreground: screen wake lock only. Heavy keep-alives start when the tab is hidden.
 this.requestWakeLock();

 if (mode === 'outdoor') {
 this.initActivityMap();
 this.startGpsTracking();
 // Native Android: keep a GPS poll even while unlocked — MIUI often starves watchPosition.
 // Web: poll only when locked/hidden (battery).
 if (window.WowNative && window.WowNative.isNative) {
 this.startBackgroundGpsPoll();
 } else {
 this.stopBackgroundGpsPoll();
 }
 } else {
 this.stopGpsTracking();
 this.stopBackgroundGpsPoll();
 }

 this.startWakeLockWatchdog();
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 this.updateWakeLockUi();
 this.applyTrackingModeUi();
 }

 async startNativeTrackingHelpers() {
 if (!window.WowNative) return;
 try {
 await window.WowNative.ready();
 if (!window.WowNative.isNative) {
 this.stepCounter.useNativeStepsOnly = false;
 return;
 }
 await window.WowNative.requestPermissions();

 const mode = this.stepCounter.trackingMode || this.getTrackingMode();
 const speed = this.getTreadmillSpeedKmh();

 // Foreground service keeps hardware steps + KM alive while locked / backgrounded
 const keepAliveOk = await window.WowNative.startKeepAliveTracking({
 mode,
 treadmillSpeedKmh: speed
 });
 if (keepAliveOk) {
 window.WowNative.startKeepAlivePolling((snap) => this.applyKeepAliveSnapshot(snap), 1500);
 }

 const attachNativeStepUi = () => {
 this.stepCounter.useNativeStepsOnly = true;
 if (this.boundHandleDeviceMotion) {
 window.removeEventListener('devicemotion', this.boundHandleDeviceMotion);
 }
 // Faster poll while tracking — WebView timers may stall when locked
 const pollMs = document.visibilityState === 'visible' ? 1500 : 1000;
 window.WowNative.startStepPolling((steps) => this.applyNativeStepCount(steps), pollMs);
 window.WowNative.watchAppResume(
 ({ steps, snapshot }) => {
 this.applyNativeStepCount(steps);
 if (snapshot) this.applyKeepAliveSnapshot(snapshot);
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.catchUpGpsAfterUnlock();
 } else {
 this.catchUpTreadmillAfterUnlock();
 }
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 this.updateCounterHint('Android hardware steps synced after unlock.');
 },
 ({ steps, snapshot }) => {
 // Flush before OEM suspends the WebView
 this.applyNativeStepCount(steps);
 if (snapshot) this.applyKeepAliveSnapshot(snapshot);
 this.persistActivitySession(true);
 }
 );
 };

 // Already running (e.g. after unlock) — do not call startCounting again
 if (window.WowNative.pedometerStarted) {
 attachNativeStepUi();
 return;
 }

 const started = await window.WowNative.startPedometer();
 if (started || keepAliveOk) {
 // Process death / session restore: plugin restarts at 0; keep prior steps as baseline
 if ((this.stepCounter.stepCount || 0) > 0) {
 this.stepCounter.nativeStepBaseline = this.stepCounter.stepCount;
 } else {
 this.stepCounter.nativeStepBaseline = 0;
 }
 attachNativeStepUi();
 this.updateCounterStatus('Android lock-screen tracking ON — steps/KM continue in background.');
 this.showCounterNotification('Background tracking active (notification stays while you walk).');
 } else {
 this.stepCounter.useNativeStepsOnly = false;
 this.bindMotionListener();
 }
 } catch (e) {
 console.warn('Native tracking helpers failed', e);
 this.stepCounter.useNativeStepsOnly = false;
 }
 }

 applyKeepAliveSnapshot(snap) {
 if (!this.stepCounter.isRunning || !snap) return;
 const serviceSteps = Math.max(0, Math.round(Number(snap.steps) || 0));
 const tubblySteps = (window.WowNative && window.WowNative.lastNativeSteps) || 0;
 const bestDelta = Math.max(serviceSteps, tubblySteps);
 this.applyNativeStepCount(bestDelta);

 const serviceKm = Number(snap.distanceKm);
 if (!Number.isFinite(serviceKm) || serviceKm <= 0) return;

 if (this.stepCounter.trackingMode === 'treadmill') {
 // Ignore native speed×time KM; keep step-derived distance only
 this.stepCounter.treadmillDistanceKm = (this.stepCounter.stepCount || 0) / this.getStepsPerKmForTracking();
 } else {
 // Outdoor: take service KM only if it doesn't wildly exceed local GPS track
 const localGps = (this.stepCounter.distanceKm || 0) + (this.stepCounter.pendingSegmentKm || 0);
 if (localGps < 0.05) {
 this.stepCounter.distanceKm = Math.max(this.stepCounter.distanceKm || 0, serviceKm);
 } else {
 const capped = Math.min(serviceKm, localGps * 1.15 + 0.1);
 this.stepCounter.distanceKm = Math.max(this.stepCounter.distanceKm || 0, Math.min(serviceKm, capped));
 }
 }
 this.syncStepsFromDistance(false);
 this.updateStepCounterDisplay();
 this.persistActivitySession(false);
 }

 applyNativeStepCount(nativeSteps) {
 if (!this.stepCounter.isRunning) return;
 const n = Math.max(0, Math.round(Number(nativeSteps) || 0));
 const baseline = this.stepCounter.nativeStepBaseline || 0;
 const total = baseline + n;
 // Never go backwards mid-session
 if (total >= (this.stepCounter.stepCount || 0)) {
 this.stepCounter.stepCount = total;
 this.updateStepCounterDisplay();
 this.persistActivitySession(false);
 }
 }

 getTrackingMode() {
 const active = document.querySelector('.mode-btn.active');
 if (active && active.dataset.mode) return active.dataset.mode;
 return this.stepCounter.trackingMode || 'outdoor';
 }

 getTreadmillSpeedKmh() {
 const min = this.challengeConfig.treadmillSpeedMinKmh;
 const max = this.challengeConfig.treadmillSpeedMaxKmh;
 const fallback = this.challengeConfig.treadmillSpeedDefaultKmh;
 const input = document.getElementById('treadmillSpeedKmh');
 const fromInput = input ? parseFloat(input.value) : NaN;
 if (Number.isFinite(fromInput)) {
 return this.clampTreadmillSpeedKmh(fromInput);
 }
 const stored = parseFloat(localStorage.getItem('treadmillSpeedKmh') || '');
 if (Number.isFinite(stored)) return this.clampTreadmillSpeedKmh(stored);
 const current = Number(this.stepCounter.treadmillSpeedKmh);
 if (Number.isFinite(current) && current >= min && current <= max) return current;
 return fallback;
 }

 clampTreadmillSpeedKmh(raw) {
 const min = this.challengeConfig.treadmillSpeedMinKmh;
 const max = this.challengeConfig.treadmillSpeedMaxKmh;
 const fallback = this.challengeConfig.treadmillSpeedDefaultKmh;
 if (!Number.isFinite(raw)) return fallback;
 return Math.min(max, Math.max(min, Math.round(raw * 10) / 10));
 }

 getTreadmillPaceLabel(speedKmh) {
 const speed = this.clampTreadmillSpeedKmh(speedKmh);
 const walkMax = this.challengeConfig.treadmillSpeedWalkMaxKmh;
 if (speed < 3.5) return 'Slow walk';
 if (speed <= walkMax) return 'Walking pace';
 if (speed <= 10) return 'Jogging / easy run';
 return 'Fast run (near challenge max)';
 }

 updateTreadmillSpeedPaceLabel(speedKmh) {
 const el = document.getElementById('treadmillSpeedPace');
 if (!el) return;
 // Derived pace only (from steps + elapsed time) — never a user input
 const dist = this.getTrackedDistanceKm();
 const sec = this.getSessionDurationSec ? this.getSessionDurationSec() : 0;
 if (dist > 0.01 && sec > 30) {
 const pace = dist / (sec / 3600);
 el.textContent = `Estimated pace from steps: ${pace.toFixed(1)} km/h · ${this.getTreadmillPaceLabel(pace)}`;
 el.classList.toggle('is-run-pace', pace > this.challengeConfig.treadmillSpeedWalkMaxKmh);
 } else {
 el.textContent = 'Step-based distance · keep phone on your body';
 el.classList.remove('is-run-pace');
 }
 }

 /**
 * Treadmill no longer credits KM from user speed × time.
 * Kept as a tick hook so unlock/sync still refreshes the derived pace label.
 */
 accumulateTreadmillDistance() {
 if (!this.stepCounter.isRunning || this.stepCounter.trackingMode !== 'treadmill') return;
 this.stepCounter.lastTreadmillTickAt = Date.now();
 // Distance is step-derived via getTrackedDistanceKm(); mirror into treadmillDistanceKm for UI/session
 this.stepCounter.treadmillDistanceKm = (this.stepCounter.stepCount || 0) / this.getStepsPerKmForTracking();
 const sec = this.getSessionDurationSec ? this.getSessionDurationSec() : 0;
 if (this.stepCounter.treadmillDistanceKm > 0.01 && sec > 30) {
 this.stepCounter.treadmillSpeedKmh = this.stepCounter.treadmillDistanceKm / (sec / 3600);
 } else {
 this.stepCounter.treadmillSpeedKmh = null;
 }
 this.updateTreadmillSpeedPaceLabel(this.stepCounter.treadmillSpeedKmh);
 }

 /** After unlock in treadmill mode, refresh step-based KM (no speed × time credit) */
 catchUpTreadmillAfterUnlock() {
 if (!this.stepCounter.isRunning || this.stepCounter.trackingMode !== 'treadmill') return;
 this.stepCounter.lastTreadmillTickAt = Date.now();
 this.accumulateTreadmillDistance();
 }

 setTrackingMode(mode, silent = false) {
 if (mode !== 'outdoor' && mode !== 'treadmill') mode = 'outdoor';
 if (this.stepCounter.isRunning && this.stepCounter.trackingMode !== mode) {
 if (!silent) {
 alert('Stop the current activity before switching Outdoor / Treadmill mode.');
 }
 // Re-sync button active state to current mode
 mode = this.stepCounter.trackingMode || 'outdoor';
 }

 this.stepCounter.trackingMode = mode;
 localStorage.setItem('trackingMode', mode);
 document.querySelectorAll('.mode-btn').forEach((btn) => {
 btn.classList.toggle('active', btn.dataset.mode === mode);
 });
 this.applyTrackingModeUi();
 if (mode === 'treadmill') {
 this.updateTreadmillSpeedPaceLabel(null);
 }
 }

 applyTrackingModeUi() {
 const mode = this.stepCounter.trackingMode || this.getTrackingMode();
 const speedRow = document.getElementById('treadmillSpeedRow');
 const mapWrap = document.getElementById('activityMapWrap');
 const distLabel = document.getElementById('distanceStatLabel');
 const modeRow = document.getElementById('activityModeRow');

 if (speedRow) speedRow.style.display = mode === 'treadmill' ? 'flex' : 'none';
 if (mapWrap) {
 mapWrap.style.display = mode === 'treadmill' ? 'none' : 'block';
 }
 if (distLabel) {
 distLabel.textContent = mode === 'treadmill' ? 'Step distance' : 'GPS distance';
 }
 if (modeRow) {
 modeRow.classList.toggle('is-locked', !!this.stepCounter.isRunning || !!this.stepCounter.isPaused);
 }
 }

 bindMotionListener() {
 if (this.stepCounter.useNativeStepsOnly) return;
 if (typeof DeviceMotionEvent === 'undefined') return;
 if (!this.boundHandleDeviceMotion) {
 this.boundHandleDeviceMotion = this.handleDeviceMotion.bind(this);
 }
 window.removeEventListener('devicemotion', this.boundHandleDeviceMotion);
 window.addEventListener('devicemotion', this.boundHandleDeviceMotion);
 }

 applyRunningActivityUi() {
        const startBtn = document.getElementById('startCounterBtn');
        const stopBtn = document.getElementById('stopCounterBtn');
        const resumeBtn = document.getElementById('resumeCounterBtn');
        const saveBtn = document.getElementById('saveCounterStepsBtn');
        const timerEl = document.getElementById('counterTimer');
        const pulseEl = document.getElementById('counterPulse');
 const valueEl = document.getElementById('liveKmCount');
        
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
        if (timerEl) timerEl.style.display = 'flex';
        if (pulseEl) pulseEl.classList.add('active');
        if (valueEl) valueEl.classList.add('active');
 }

 applyPausedActivityUi() {
        const startBtn = document.getElementById('startCounterBtn');
        const stopBtn = document.getElementById('stopCounterBtn');
        const resumeBtn = document.getElementById('resumeCounterBtn');
        const saveBtn = document.getElementById('saveCounterStepsBtn');
        const pulseEl = document.getElementById('counterPulse');
        const valueEl = document.getElementById('liveKmCount');
        const timerEl = document.getElementById('counterTimer');

        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'inline-flex';
        if (saveBtn) saveBtn.style.display = 'inline-flex';
        if (timerEl) timerEl.style.display = 'flex';
        if (pulseEl) pulseEl.classList.remove('active');
        if (valueEl) valueEl.classList.remove('active');
 }

 applyIdleActivityUi() {
        const startBtn = document.getElementById('startCounterBtn');
        const stopBtn = document.getElementById('stopCounterBtn');
        const resumeBtn = document.getElementById('resumeCounterBtn');
        const saveBtn = document.getElementById('saveCounterStepsBtn');
        const timerEl = document.getElementById('counterTimer');
        const pulseEl = document.getElementById('counterPulse');
        const valueEl = document.getElementById('liveKmCount');

        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
        if (timerEl) timerEl.style.display = 'none';
        if (pulseEl) pulseEl.classList.remove('active');
        if (valueEl) valueEl.classList.remove('active');
 }

 getActivitySessionUserKey() {
 if (!this.currentUser) return null;
 return this.currentUser.uid
 || this.currentUser.id
 || this.currentUser.employeeId
 || this.currentUser.email
 || this.currentUser.name
 || null;
 }

 persistActivitySession(force = false) {
 try {
 if (!this.stepCounter.isRunning && !this.stepCounter.isPaused) return;
 const now = Date.now();
 if (!force && now - (this._lastActivityPersistAt || 0) < 2000) return;
 this._lastActivityPersistAt = now;

 const userKey = this.getActivitySessionUserKey();
 if (!userKey) return;

 const path = (this.stepCounter.path || []).slice(-250).map((p) => ({
 lat: p.lat,
 lng: p.lng,
 t: p.t
 }));
 const payload = {
 version: 1,
 isRunning: !!this.stepCounter.isRunning,
 isPaused: !!this.stepCounter.isPaused,
 elapsedSecAtPause: this.stepCounter.elapsedSecAtPause || 0,
 userKey,
 startTime: this.stepCounter.startTime,
 stepCount: this.stepCounter.stepCount || 0,
 distanceKm: this.stepCounter.distanceKm || 0,
 pendingSegmentKm: this.stepCounter.pendingSegmentKm || 0,
 treadmillDistanceKm: this.stepCounter.treadmillDistanceKm || 0,
 treadmillSpeedKmh: this.stepCounter.treadmillSpeedKmh || this.getTreadmillSpeedKmh(),
 trackingMode: this.stepCounter.trackingMode || 'outdoor',
 lastTreadmillTickAt: this.stepCounter.lastTreadmillTickAt || null,
 nativeStepBaseline: this.stepCounter.nativeStepBaseline || 0,
 useNativeStepsOnly: !!this.stepCounter.useNativeStepsOnly,
 path,
 lastPosition: this.stepCounter.lastPosition || null,
 timeToGoalSec: this.stepCounter.timeToGoalSec,
 frozenForSave: this.stepCounter.frozenForSave || null,
 savedAt: now
 };
 localStorage.setItem(this.activitySessionKey, JSON.stringify(payload));
 } catch (error) {
 console.warn('Could not persist activity session:', error);
 }
 }

 loadActivitySession() {
 try {
 const raw = localStorage.getItem(this.activitySessionKey);
 if (!raw) return null;
 const data = JSON.parse(raw);
 if (!data || !data.startTime) return null;
 if (!data.isRunning && !data.isPaused) return null;
 return data;
 } catch (error) {
 console.warn('Could not load activity session:', error);
 return null;
 }
 }

 clearActivitySession() {
 try {
 localStorage.removeItem(this.activitySessionKey);
 } catch (error) {
 console.warn('Could not clear activity session:', error);
 }
 }

 tryRestoreActivitySession() {
 if (window.location.pathname.includes('admin.html')) return false;

 if (this.stepCounter.isRunning) {
 this.ensureActivityRuntimeAlive('Activity still running after unlock.');
 return true;
 }

 const data = this.loadActivitySession();
 if (!data) return false;

 const maxAgeMs = 8 * 60 * 60 * 1000;
 if (!data.savedAt || (Date.now() - data.savedAt) > maxAgeMs) {
 this.clearActivitySession();
 return false;
 }

 const userKey = this.getActivitySessionUserKey();
 if (userKey && data.userKey && data.userKey !== userKey) {
 return false;
 }

 this.stepCounter.isRunning = !!data.isRunning && !data.isPaused;
 this.stepCounter.isPaused = !!data.isPaused && !data.isRunning;
 this.stepCounter.elapsedSecAtPause = Number(data.elapsedSecAtPause) || 0;
 this.stepCounter.startTime = data.startTime;
 this.stepCounter.stepCount = data.stepCount || 0;
 this.stepCounter.distanceKm = Number(data.distanceKm) || 0;
 this.stepCounter.pendingSegmentKm = Number(data.pendingSegmentKm) || 0;
 this.stepCounter.treadmillDistanceKm = Number(data.treadmillDistanceKm) || 0;
 this.stepCounter.treadmillSpeedKmh = Number(data.treadmillSpeedKmh) || this.getTreadmillSpeedKmh();
 this.stepCounter.trackingMode = data.trackingMode === 'treadmill' ? 'treadmill' : 'outdoor';
 this.stepCounter.lastTreadmillTickAt = data.lastTreadmillTickAt || data.savedAt || Date.now();
 this.stepCounter.path = Array.isArray(data.path) ? data.path : [];
 this.stepCounter.lastPosition = data.lastPosition || null;
 this.stepCounter.nativeStepBaseline = Number(data.nativeStepBaseline) || 0;
 this.stepCounter.useNativeStepsOnly = !!data.useNativeStepsOnly;
 this.stepCounter.timeToGoalSec = data.timeToGoalSec != null ? Number(data.timeToGoalSec) : null;
 this.stepCounter.frozenForSave = data.frozenForSave || null;
 this.stepCounter.stepHistory = [];
 this.stepCounter.accelerationHistory = [];
 this.stepCounter.lastAcceleration = { x: 0, y: 0, z: 0 };
 this.stepCounter.gpsReady = (this.stepCounter.path || []).length > 0;
 this.stepCounter.useNativeStepsOnly = false;

 if (this.stepCounter.trackingMode === 'treadmill') {
 this.stepCounter.threshold = 0.85;
 this.stepCounter.minVerticalChange = 0.45;
 } else {
 this.stepCounter.threshold = 1.2;
 this.stepCounter.minVerticalChange = 0.8;
 }

 this.setTrackingMode(this.stepCounter.trackingMode, true);
 const speedInput = document.getElementById('treadmillSpeedKmh');
 if (speedInput && this.stepCounter.treadmillSpeedKmh) {
 speedInput.value = String(this.stepCounter.treadmillSpeedKmh);
 }

 this.initActivityMap();
 if (this.stepCounter.path.length) {
 const latLngs = this.stepCounter.path.map((p) => [p.lat, p.lng]);
 if (this.activityPolyline) {
 this.activityPolyline.setLatLngs(latLngs);
 }
 const last = this.stepCounter.path[this.stepCounter.path.length - 1];
 if (last) this.updateActivityMap(last);
 if (this.activityMap && this.activityPolyline && latLngs.length > 1) {
 try {
 this.activityMap.fitBounds(this.activityPolyline.getBounds(), { padding: [24, 24] });
 } catch (e) { /* ignore */ }
 }
 }

 if (this.stepCounter.isPaused) {
 this.applyPausedActivityUi();
 this.updateStepCounterDisplay();
 const distance = this.getTrackedDistanceKm();
 const elapsed = this.stepCounter.elapsedSecAtPause || 0;
 const minutes = Math.floor(elapsed / 60);
 const seconds = elapsed % 60;
 const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
 this.updateCounterStatus(`Paused. Covered ${distance.toFixed(2)} KM in ${timeStr}.`);
 this.updateCounterHint('Tap Resume to continue, or Save Activity to update the leaderboard.');
 this.showCounterNotification('Paused activity restored. Resume or Save when ready.');
 return true;
 }

 this.bindMotionListener();
 this.applyRunningActivityUi();
 this.startNativeTrackingHelpers().then(() => {
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 });

 this.ensureActivityRuntimeAlive('Activity restored after unlock — tracking continued.');
 this.recalculateGpsDistanceFromPath();
 this.showCounterNotification('Activity restored. Your distance was kept after unlock.');
 this.updateCounterStatus('Resumed after unlock. Keep moving — tracking is active.');
 return true;
 }

 ensureActivityRuntimeAlive(hintMessage) {
 if (!this.stepCounter.isRunning) return;
 this.setupActivityKeepAlive();
 this.setupServiceWorkerTrackingBridge();
 this.notifyServiceWorkerTracking(true);
 this.startTimer(true);
 this.requestWakeLock();
 this.startNativeTrackingHelpers();
 const isHidden = document.visibilityState !== 'visible';
 if (isHidden) {
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 this.startKeepAwakeFallback();
 }
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.startGpsTracking();
 if (isHidden || (window.WowNative && window.WowNative.isNative)) {
 this.startBackgroundGpsPoll();
 } else {
 this.stopBackgroundGpsPoll();
 }
 } else {
 this.stopGpsTracking();
 this.stopBackgroundGpsPoll();
 this.catchUpTreadmillAfterUnlock();
 }
 this.startWakeLockWatchdog();
 this.applyRunningActivityUi();
 this.applyTrackingModeUi();
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 this.updateWakeLockUi();
 if (hintMessage) {
 this.updateCounterHint(hintMessage);
 }
 }

 handleDeviceMotion(event) {
 if (!this.stepCounter.isRunning) return;
 // Android native pedometer already counting — DeviceMotion would double-count
 if (this.stepCounter.useNativeStepsOnly) return;

        const acceleration = event.accelerationIncludingGravity || event.acceleration;
        if (!acceleration) return;

        const currentAccel = {
            x: acceleration.x || 0,
            y: acceleration.y || 0,
            z: acceleration.z || 0
        };

 // Absolute magnitude peak detection is more reliable than delta-only while walking
 const mag = Math.sqrt(
 currentAccel.x * currentAccel.x +
 currentAccel.y * currentAccel.y +
 currentAccel.z * currentAccel.z
 );
 const lastMag = this.stepCounter.lastAccelMagnitude || mag;
 const deltaMag = Math.abs(mag - lastMag);
 const deltaZ = Math.abs(currentAccel.z - (this.stepCounter.lastAcceleration.z || 0));

        this.stepCounter.accelerationHistory.push({
 magnitude: deltaMag,
 absMag: mag,
 deltaZ,
            timestamp: Date.now()
        });
 if (this.stepCounter.accelerationHistory.length > 25) {
            this.stepCounter.accelerationHistory.shift();
        }

 const peakThreshold = this.stepCounter.trackingMode === 'treadmill' ? 10.8 : 11.2;
 const valleyThreshold = this.stepCounter.trackingMode === 'treadmill' ? 9.4 : 9.6;
            const now = Date.now();
 const minStepGapMs = this.stepCounter.trackingMode === 'treadmill' ? 280 : 320;
            const timeSinceLastStep = this.stepCounter.stepHistory.length > 0 
                ? now - this.stepCounter.stepHistory[this.stepCounter.stepHistory.length - 1]
                : 1000;

 // Arm on valley, fire step on rising peak (classic step algorithm)
 if (mag < valleyThreshold) {
 this.stepCounter.stepPeakArmed = true;
 }

 const peakHit = this.stepCounter.stepPeakArmed && mag > peakThreshold && timeSinceLastStep > minStepGapMs;
 const deltaHit = deltaMag > this.stepCounter.threshold && deltaZ > this.stepCounter.minVerticalChange && timeSinceLastStep > minStepGapMs;

 if (peakHit || deltaHit) {
                this.stepCounter.stepCount++;
                this.stepCounter.stepHistory.push(now);
 this.stepCounter.stepPeakArmed = false;
 if (this.stepCounter.stepHistory.length > 12) {
                    this.stepCounter.stepHistory.shift();
                }
                this.updateStepCounterDisplay();
                this.animateStepCounter();
 this.persistActivitySession(false);
        }

 this.stepCounter.lastAccelMagnitude = mag;
        this.stepCounter.lastAcceleration = currentAccel;
    }

    stopStepCounter() {
        if (!this.stepCounter.isRunning) return;

        this.accumulateTreadmillDistance();
        // Flush any buffered GPS meters into distance before freezing the snapshot
        if ((this.stepCounter.pendingSegmentKm || 0) > 0) {
            this.stepCounter.distanceKm = (this.stepCounter.distanceKm || 0) + (this.stepCounter.pendingSegmentKm || 0);
            this.stepCounter.pendingSegmentKm = 0;
        }
        const elapsedSec = this.stepCounter.startTime
            ? Math.max(0, Math.floor((Date.now() - this.stepCounter.startTime) / 1000))
            : (this.stepCounter.elapsedSecAtPause || 0);
        this.stepCounter.elapsedSecAtPause = elapsedSec;
        this.stepCounter.isRunning = false;
        this.stepCounter.isPaused = true;
        this.maybeCaptureTimeToGoal();

        if (this.boundHandleDeviceMotion) {
            window.removeEventListener('devicemotion', this.boundHandleDeviceMotion);
        }
 this.stopGpsTracking();
 this.stopBackgroundGpsPoll();
 this.stopWakeLockWatchdog();
 this.releaseWakeLock();
 this.stopSilentAudioKeepAlive();
 this.stopHtmlAudioKeepAlive();
 this.stopKeepAwakeFallback();
 this.notifyServiceWorkerTracking(false);
        this.stopTimer();
 if (window.WowNative && window.WowNative.isNative) {
 window.WowNative.stopPedometer();
 window.WowNative.stopKeepAliveTracking();
 }
 this.stepCounter.useNativeStepsOnly = false;
 this.stepCounter.nativeStepBaseline = 0;

 const distance = this.getTrackedDistanceKm();
 // Freeze Stop-time distance/duration so Save cannot pick up submit-time clock or later GPS noise
 this.stepCounter.frozenForSave = {
 distanceKm: Number(distance.toFixed(3)),
 durationSec: elapsedSec,
 steps: this.stepCounter.stepCount || 0,
 path: (this.stepCounter.path || []).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t })),
 timeToGoalSec: this.stepCounter.timeToGoalSec,
 trackingMode: this.stepCounter.trackingMode || 'outdoor',
 treadmillSpeedKmh: this.stepCounter.treadmillSpeedKmh || null,
 startTime: this.stepCounter.startTime || null
 };

 this.applyPausedActivityUi();
 this.persistActivitySession(true);

        const minutes = Math.floor(elapsedSec / 60);
        const seconds = elapsedSec % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        const timerValue = document.getElementById('timerValue');
        if (timerValue) {
            timerValue.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
 const goalKm = this.getDailyGoalKm();
 const goalNote = this.stepCounter.timeToGoalSec != null
 ? ` · time to ${goalKm} KM: ${this.formatDurationClock(this.stepCounter.timeToGoalSec)}`
 : '';
 this.updateCounterStatus(`Stopped. Covered ${distance.toFixed(3)} KM in ${timeStr}${goalNote}.`);
 this.updateCounterHint('Tap Resume to continue, or Save Activity to update the leaderboard. Leaderboard uses time to the day goal, not submit time.');
 this.showCounterNotification(`Activity stopped: ${distance.toFixed(3)} KM`);
 this.updateStepCounterDisplay();
    }

    resumeStepCounter() {
        if (this.stepCounter.isRunning) return;
        const hasProgress = (this.stepCounter.stepCount || 0) > 0
            || this.getTrackedDistanceKm() > 0.001
            || (this.stepCounter.elapsedSecAtPause || 0) > 0
            || !!this.stepCounter.startTime;
        if (!hasProgress && !this.stepCounter.isPaused) {
            this.startStepCounter();
            return;
        }

        const elapsedSec = this.stepCounter.elapsedSecAtPause || 0;
        this.stepCounter.startTime = Date.now() - (elapsedSec * 1000);
        this.stepCounter.lastTreadmillTickAt = Date.now();
        this.stepCounter.isPaused = false;
        this.stepCounter.isRunning = true;
        this.stepCounter.frozenForSave = null;
        this.stepCounter.useNativeStepsOnly = false;
        this.stepCounter.nativeStepBaseline = 0;

        this.bindMotionListener();
        this.applyRunningActivityUi();
        this.startNativeTrackingHelpers();
        this.ensureActivityRuntimeAlive('Tracking resumed. Keep moving.');
        this.updateCounterStatus('Activity resumed. Tracking is active again.');
        this.updateCounterHint('Tap Stop Activity when you are ready to save or pause again.');
        this.showCounterNotification('Activity resumed.');
        this.updateStepCounterDisplay();
        this.persistActivitySession(true);
    }

    resetStepCounter() {
 this.stopGpsTracking();
 this.stopBackgroundGpsPoll();
 this.stopWakeLockWatchdog();
 this.releaseWakeLock();
 this.stopSilentAudioKeepAlive();
 this.stopHtmlAudioKeepAlive();
 this.stopKeepAwakeFallback();
 this.notifyServiceWorkerTracking(false);
 this.stepCounter.isRunning = false;
 this.stepCounter.isPaused = false;
 this.stepCounter.elapsedSecAtPause = 0;
 if (window.WowNative && window.WowNative.isNative) {
 window.WowNative.stopPedometer();
 window.WowNative.stopKeepAliveTracking();
 }
        this.stepCounter.stepCount = 0;
        this.stepCounter.stepHistory = [];
        this.stepCounter.accelerationHistory = [];
        this.stepCounter.startTime = null;
 this.stepCounter.distanceKm = 0;
 this.stepCounter.treadmillDistanceKm = 0;
 this.stepCounter.lastTreadmillTickAt = null;
 this.stepCounter.path = [];
 this.stepCounter.lastPosition = null;
 this.stepCounter.gpsReady = false;
 this.stepCounter.timeToGoalSec = null;
 this.stepCounter.frozenForSave = null;
 this.stepCounter.pendingSegmentKm = 0;
 this.clearActivitySession();
 this.clearActivityMapTrack();
        this.updateStepCounterDisplay();
 this.updateCounterStatus('Ready to track your next walk/run.');
 this.updateCounterHint('Start Activity to begin GPS map tracking.');
        
 this.applyIdleActivityUi();
        
        const timerValue = document.getElementById('timerValue');
        if (timerValue) timerValue.textContent = '00:00';
 this.stopTimer();
 }

 getTrackedDistanceKm() {
 const mode = this.stepCounter.trackingMode || 'outdoor';
 const stepsPerKm = this.getStepsPerKmForTracking();
 const stepKm = (this.stepCounter.stepCount || 0) / stepsPerKm;

 if (mode === 'treadmill') {
 // Steps only — never trust user-entered treadmill speed
 return Number(stepKm.toFixed(3));
 }

 const gpsKm = (this.stepCounter.distanceKm || 0) + (this.stepCounter.pendingSegmentKm || 0);
 const pathLen = Array.isArray(this.stepCounter.path) ? this.stepCounter.path.length : 0;
 const gpsReady = pathLen >= 6 || gpsKm >= 0.12;
 if (gpsReady) {
 // Prefer GPS. Allow steps to fill only a small under-count — never let
 // aggressive step-stride blow past the GPS track (Hari: ~3 KM real → 5 KM shown).
 const cappedStep = Math.min(stepKm, gpsKm * 1.12 + 0.08);
 return Number(Math.max(gpsKm, cappedStep).toFixed(3));
 }
 // GPS still cold / locked with no track: use conservative step distance
 return Number(Math.max(gpsKm, stepKm).toFixed(3));
 }

 /**
 * Steps-per-KM for distance estimates. Keep outdoor stride conservative —
 * shorter "steps/KM" over-counts distance and trips the pace gate.
 */
 getStepsPerKmForTracking() {
 const base = this.challengeConfig.stepsPerKm || 1300;
 // Native hardware pedometers are close enough; do not use 0.8× (was ~1040 and over-counted).
 return base;
 }

 /**
 * Keep step count in sync with distance when DeviceMotion is paused (phone locked).
 * Mobile browsers almost always stop accelerometer events while the screen is off.
 */
 syncStepsFromDistance(force = false) {
 if (!this.stepCounter.isRunning) return;
 const isHidden = document.visibilityState !== 'visible';
 if (!force && !isHidden) return;

 // On native, still allow GPS→steps sync while locked so KM/steps stay aligned
 // when the pedometer poll is slow. Never reduce hardware counts.
 const dist = (this.stepCounter.distanceKm || 0) + (this.stepCounter.pendingSegmentKm || 0);
 if (dist <= 0) return;
 const estimated = Math.round(dist * this.getStepsPerKmForTracking());
 if (estimated > (this.stepCounter.stepCount || 0)) {
 this.stepCounter.stepCount = estimated;
 }
 }

 /**
 * Rebuild GPS distance from the full path (avoids losing short segments).
 */
 recalculateGpsDistanceFromPath() {
 const path = this.stepCounter.path || [];
 if (path.length < 2) {
 // Keep any already-credited distance; only clear pending buffer
 this.stepCounter.pendingSegmentKm = 0;
 return this.stepCounter.distanceKm || 0;
 }
 let total = 0;
 for (let i = 1; i < path.length; i++) {
 const a = path[i - 1];
 const b = path[i];
 const segmentKm = this.haversineKm(a.lat, a.lng, b.lat, b.lng);
 const dtSec = Math.max(1, ((b.t || 0) - (a.t || 0)) / 1000);
 const hours = dtSec / 3600;
 // Allow brisk walk/jog; for long gaps credit capped pace instead of dropping to 0
 const maxKm = Math.min(8.0, Math.max(0.5, hours * 14));
 if (segmentKm <= 0) continue;
 if (segmentKm <= maxKm) {
 total += segmentKm;
 } else if (dtSec >= 20) {
 // Sparse GPS after lock: credit at up to ~9 km/h rather than discard the gap
 total += Math.min(segmentKm, hours * 9);
 }
 }
 // Never reduce credited KM (path thinning / stricter filters used to drop e.g. 2.00 → 1.98)
 this.stepCounter.distanceKm = Math.max(this.stepCounter.distanceKm || 0, total);
 this.stepCounter.pendingSegmentKm = 0;
 return this.stepCounter.distanceKm;
 }

 maybeCaptureTimeToGoal() {
 if (this.stepCounter.timeToGoalSec != null) return;
 const goalKm = this.getDailyGoalKm();
 if (!(goalKm > 0)) return;
 const dist = this.getTrackedDistanceKm();
 if (!this.meetsDailyGoal(dist, goalKm)) return;
 const elapsed = this.getSessionDurationSec();
 if (elapsed > 0) {
 this.stepCounter.timeToGoalSec = elapsed;
 }
 }

 getBodyWeightKg() {
 const stored = parseFloat(localStorage.getItem('bodyWeightKg') || '');
 if (Number.isFinite(stored) && stored >= 30 && stored <= 200) {
 return stored;
 }
 const input = document.getElementById('bodyWeightKg');
 if (input) {
 const fromInput = parseFloat(input.value);
 if (Number.isFinite(fromInput) && fromInput >= 30 && fromInput <= 200) {
 return fromInput;
 }
 }
 return 70;
 }

 setBodyWeightKg(value) {
 const weight = parseFloat(value);
 if (!Number.isFinite(weight) || weight < 30 || weight > 200) {
 return this.getBodyWeightKg();
 }
 localStorage.setItem('bodyWeightKg', String(weight));
 return weight;
 }

 /**
 * Estimate calories from distance, duration, and body weight (MET-based).
 * Uses pace to pick intensity; falls back to walking estimate if duration is missing.
 */
 estimateCaloriesBurned(distanceKm, durationSec, weightKg) {
 const distance = Math.max(0, Number(distanceKm) || 0);
 const weight = Math.max(30, Math.min(200, Number(weightKg) || 70));
 if (distance <= 0) return 0;

 const duration = Math.max(0, Number(durationSec) || 0);
 let met = 3.5; // casual walk default

 if (duration >= 30 && distance > 0.01) {
 const hours = duration / 3600;
 const speedKmh = distance / hours;
 if (speedKmh < 4) met = 3.0;
 else if (speedKmh < 5.5) met = 3.8;
 else if (speedKmh < 6.5) met = 4.5;
 else if (speedKmh < 8) met = 7.0;
 else if (speedKmh < 10) met = 9.8;
 else if (speedKmh < 12) met = 11.0;
 else met = 12.5;

 return Math.round(met * weight * hours);
 }

 // No usable duration: ~0.55 kcal per kg per km (walking) to ~1.0 for running-like
 const kcalPerKgPerKm = 0.63;
 return Math.round(weight * distance * kcalPerKgPerKm);
 }

 getSessionDurationSec() {
 if (this.stepCounter.isPaused) {
 return Math.max(0, this.stepCounter.elapsedSecAtPause || 0);
 }
 if (this.stepCounter.startTime) {
 return Math.max(0, Math.round((Date.now() - this.stepCounter.startTime) / 1000));
 }
 if (this.timerStartTime) {
 return Math.max(0, Math.round((Date.now() - this.timerStartTime) / 1000));
 }
 return 0;
 }

 getSessionCalories() {
 return this.estimateCaloriesBurned(
 this.getTrackedDistanceKm(),
 this.getSessionDurationSec(),
 this.getBodyWeightKg()
 );
 }

 haversineKm(lat1, lon1, lat2, lon2) {
 const toRad = (deg) => (deg * Math.PI) / 180;
 const R = 6371;
 const dLat = toRad(lat2 - lat1);
 const dLon = toRad(lon2 - lon1);
 const a =
 Math.sin(dLat / 2) * Math.sin(dLat / 2) +
 Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
 Math.sin(dLon / 2) * Math.sin(dLon / 2);
 return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 }

 async initActivityMap() {
 const mapEl = document.getElementById('activityMap');
 if (!mapEl) return;
 try {
 await this.ensureLeafletLoaded();
 } catch (err) {
 console.warn('Leaflet failed to load:', err);
 return;
 }
 if (typeof L === 'undefined') {
 return;
 }
 if (!this.activityMap) {
 this.activityMap = L.map(mapEl, {
 zoomControl: true,
 attributionControl: true
 }).setView([20.5937, 78.9629], 5);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
 maxZoom: 19,
 attribution: '&copy; OpenStreetMap'
 }).addTo(this.activityMap);
 this.activityPolyline = L.polyline([], {
 color: '#0d9488',
 weight: 5,
 opacity: 0.9
 }).addTo(this.activityMap);
 }
 setTimeout(() => {
 if (this.activityMap) this.activityMap.invalidateSize();
 }, 200);
 }

 clearActivityMapTrack() {
 if (this.activityPolyline) {
 this.activityPolyline.setLatLngs([]);
 }
 if (this.activityMarker && this.activityMap) {
 this.activityMap.removeLayer(this.activityMarker);
 this.activityMarker = null;
 }
 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = 'Allow location access to track your walk/run route on the map.';
 }
 }

 startGpsTracking() {
 const hasNative = !!(window.WowNative && window.WowNative.isNative);
 if (!navigator.geolocation && !hasNative) {
 this.updateCounterStatus('GPS not available on this device. Step estimate will be used.');
 const hint = document.getElementById('mapHint');
 if (hint) hint.textContent = 'GPS unavailable — distance will use step estimate.';
 return;
 }

 this.stopGpsTracking();

 const onPos = (pos) => this.handleGpsPosition(pos);
 const onErr = (err) => {
 console.warn('GPS error:', err);
 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = 'Location permission needed for map tracking. You can still use step estimate.';
 }
 this.updateCounterHint('Enable location for accurate KM tracking on the map.');
 };

 if (hasNative) {
 window.WowNative.watchPosition(onPos, onErr).then((id) => {
 this.stepCounter.watchId = id;
 this.stepCounter._nativeGps = true;
 });
 return;
 }

 const options = {
 enableHighAccuracy: true,
 maximumAge: 0,
 timeout: 20000
 };
 this.stepCounter.watchId = navigator.geolocation.watchPosition(onPos, onErr, options);
 this.stepCounter._nativeGps = false;
 }

 stopGpsTracking() {
 if (window.WowNative && this.stepCounter._nativeGps) {
 window.WowNative.clearWatch();
 } else if (this.stepCounter.watchId != null && navigator.geolocation) {
 navigator.geolocation.clearWatch(this.stepCounter.watchId);
 }
 this.stepCounter.watchId = null;
 this.stepCounter._nativeGps = false;
 }

 setupActivityKeepAlive() {
 if (this.activityKeepAliveBound) return;
 this.activityKeepAliveBound = true;

 const onVis = () => this.onActivityVisibilityChange();
 document.addEventListener('visibilitychange', onVis);
 window.addEventListener('focus', onVis);
 window.addEventListener('pageshow', (event) => {
 this.onActivityVisibilityChange();
 // bfcache / reload after lock: restore persisted session if needed
 if (!this.stepCounter.isRunning) {
 this.tryRestoreActivitySession();
 }
 if (event && event.persisted && this.stepCounter.isRunning) {
 this.ensureActivityRuntimeAlive('Activity resumed from browser cache.');
 }
 });
 window.addEventListener('pagehide', () => this.persistActivitySession(true));
 window.addEventListener('beforeunload', () => this.persistActivitySession(true));
 window.addEventListener('blur', () => this.persistActivitySession(true));
 }

 async onActivityVisibilityChange() {
 if (!this.stepCounter.isRunning) {
 // Page may have been killed while locked — try restore when user returns
 if (document.visibilityState === 'visible') {
 this.tryRestoreActivitySession();
 }
 return;
 }

 if (document.visibilityState === 'hidden') {
 this.persistActivitySession(true);
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 this.startKeepAwakeFallback();
 this.notifyServiceWorkerTracking(true);
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.startGpsTracking();
 this.startBackgroundGpsPoll();
 } else {
 this.stopGpsTracking();
 this.stopBackgroundGpsPoll();
 this.accumulateTreadmillDistance();
 this.updateStepCounterDisplay();
 }
 const hint = document.getElementById('mapHint');
 if (hint && this.stepCounter.trackingMode === 'outdoor') {
 hint.textContent = 'Lock-screen tracking ON. Keep the site open in background — do not force-close the app.';
 }
 return;
 }

 // Visible again after unlock — reinstate timers/GPS + catch up missed distance
 this.stopBackgroundGpsPoll();
 this.ensureActivityRuntimeAlive('Tracking active again after unlock.');
 if (window.WowNative && window.WowNative.isNative) {
 window.WowNative.getKeepAliveSnapshot().then((snap) => {
 if (snap) this.applyKeepAliveSnapshot(snap);
 }).catch(() => {});
 window.WowNative.getNativeStepDelta().then((steps) => {
 this.applyNativeStepCount(steps);
 }).catch(() => {});
 }
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.catchUpGpsAfterUnlock();
 } else {
 this.catchUpTreadmillAfterUnlock();
 }
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 }

 startBackgroundGpsPoll() {
 this.stopBackgroundGpsPoll();
 if (this.stepCounter.trackingMode !== 'outdoor') return;
 const isNative = !!(window.WowNative && window.WowNative.isNative);
 // Web: poll only while locked. Native: also poll while unlocked (MIUI GPS gaps).
 if (!isNative && document.visibilityState === 'visible') return;
 const intervalMs = isNative
 ? (document.visibilityState === 'visible' ? 4000 : 3000)
 : 6000;
 this.bgGpsPollId = setInterval(() => {
 if (!isNative && document.visibilityState === 'visible') {
 this.stopBackgroundGpsPoll();
 return;
 }
 this.pollGpsOnce(document.visibilityState !== 'visible');
 }, intervalMs);
 }

 pollGpsOnce(fromBackground = false) {
 if (!this.stepCounter.isRunning) return;
 if (this.stepCounter.trackingMode !== 'outdoor') return;
 if (window.WowNative && window.WowNative.isNative) {
 window.WowNative.getCurrentPosition({
 enableHighAccuracy: true,
 timeout: fromBackground ? 15000 : 10000,
 maximumAge: fromBackground ? 4000 : 1500
 }).then((pos) => {
 if (pos) this.handleGpsPosition(pos, fromBackground);
 });
 return;
 }
 if (!navigator.geolocation) return;
 navigator.geolocation.getCurrentPosition(
 (pos) => this.handleGpsPosition(pos, fromBackground),
 () => {},
 {
 enableHighAccuracy: true,
 maximumAge: fromBackground ? 5000 : 1000,
 timeout: fromBackground ? 15000 : 10000
 }
 );
 }

 catchUpGpsAfterUnlock() {
 if (!this.stepCounter.isRunning || this.stepCounter.trackingMode !== 'outdoor') return;
 this.recalculateGpsDistanceFromPath();
 // Always sync — never reduces hardware steps; fills gaps when pedometer lagged
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();

 const sample = () => {
 this.pollGpsOnce(true);
 this.syncStepsFromDistance(true);
 };
 sample();
 setTimeout(sample, 1500);
 setTimeout(sample, 3500);
 setTimeout(() => {
 this.recalculateGpsDistanceFromPath();
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 }, 5000);
 }

 stopBackgroundGpsPoll() {
 if (this.bgGpsPollId) {
 clearInterval(this.bgGpsPollId);
 this.bgGpsPollId = null;
 }
 }

 startWakeLockWatchdog() {
 this.stopWakeLockWatchdog();
 // 15s: enough for treadmill credit + wake lock refresh without burning battery
 this.wakeLockWatchdogId = setInterval(() => {
 if (!this.stepCounter.isRunning) return;
 const isHidden = document.visibilityState !== 'visible';
 if (isHidden) {
 // Only nudge media if it already stopped — avoid restarting every tick
 this.ensureHiddenKeepAlives();
 }
 if (this.stepCounter.trackingMode === 'outdoor') {
 if (isHidden) {
 this.pollGpsOnce(true);
 }
 } else {
 this.accumulateTreadmillDistance();
 this.updateStepCounterDisplay();
 }
 this.persistActivitySession(false);
 if (!isHidden) {
 this.requestWakeLock();
 }
 }, 15000);
 }

 /** Start lock-screen keep-alives only if not already running (battery-friendly). */
 ensureHiddenKeepAlives() {
 try {
 const audioOk = this.keepAliveAudio && !this.keepAliveAudio.paused;
 const oscOk = !!(this.silentOscillator && this.silentAudioCtx && this.silentAudioCtx.state === 'running');
 if (!audioOk) this.startHtmlAudioKeepAlive();
 if (!oscOk) this.startSilentAudioKeepAlive();
 if (!this.keepAwakeVideo) this.startKeepAwakeFallback();
 } catch (e) {
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 }
 }

 stopWakeLockWatchdog() {
 if (this.wakeLockWatchdogId) {
 clearInterval(this.wakeLockWatchdogId);
 this.wakeLockWatchdogId = null;
 }
 }

 /** Near-silent looping HTMLAudio — keeps many Android browsers from suspending the tab */
 startHtmlAudioKeepAlive() {
 try {
 if (!this.keepAliveAudio) {
 // Tiny WAV (near silence). Volume must be > 0 or some browsers suspend playback.
 this.keepAliveAudio = new Audio(
 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
 );
 this.keepAliveAudio.loop = true;
 this.keepAliveAudio.preload = 'auto';
 this.keepAliveAudio.volume = 0.01;
 }
 const playPromise = this.keepAliveAudio.play();
 if (playPromise && playPromise.catch) {
 playPromise.catch(() => {});
 }
 if (navigator.mediaSession) {
 try {
 navigator.mediaSession.metadata = new MediaMetadata({
 title: 'WOW-CSG Activity Tracking',
 artist: 'Fitness Challenge',
 album: 'Keep tracking while locked'
 });
 navigator.mediaSession.playbackState = 'playing';
 navigator.mediaSession.setActionHandler('pause', () => {
 if (this.stepCounter.isRunning) {
 this.keepAliveAudio.play().catch(() => {});
 }
 });
 } catch (e) { /* ignore */ }
 }
 } catch (error) {
 console.warn('HTML audio keep-alive failed:', error);
 }
 }

 stopHtmlAudioKeepAlive() {
 try {
 if (this.keepAliveAudio) {
 this.keepAliveAudio.pause();
 this.keepAliveAudio.src = '';
 this.keepAliveAudio = null;
 }
 } catch (error) {
 console.warn('HTML audio cleanup failed:', error);
 }
 }

 setupServiceWorkerTrackingBridge() {
 if (this.swMessageBound || !('serviceWorker' in navigator)) return;
 this.swMessageBound = true;
 navigator.serviceWorker.addEventListener('message', (event) => {
 if (!event.data || event.data.type !== 'TRACKING_TICK') return;
 if (!this.stepCounter.isRunning) return;
 const isHidden = document.visibilityState !== 'visible';
 if (this.stepCounter.trackingMode === 'outdoor' && isHidden) {
 this.pollGpsOnce(true);
 } else if (this.stepCounter.trackingMode === 'treadmill') {
 this.accumulateTreadmillDistance();
 this.updateStepCounterDisplay();
 }
 this.persistActivitySession(false);
 if (isHidden) {
 this.ensureHiddenKeepAlives();
 }
 });
 }

 notifyServiceWorkerTracking(active) {
 if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
 try {
 navigator.serviceWorker.controller.postMessage({
 type: active ? 'TRACKING_START' : 'TRACKING_STOP'
 });
 } catch (error) {
 console.warn('SW tracking notify failed:', error);
 }
 }

 startSilentAudioKeepAlive() {
 try {
 const AudioCtx = window.AudioContext || window.webkitAudioContext;
 if (!AudioCtx) {
 this.startKeepAwakeFallback();
 this.startHtmlAudioKeepAlive();
 return;
 }
 if (!this.silentAudioCtx) {
 this.silentAudioCtx = new AudioCtx();
 }
 if (this.silentAudioCtx.state === 'suspended') {
 this.silentAudioCtx.resume().catch(() => {});
 }
 if (!this.silentOscillator) {
 const osc = this.silentAudioCtx.createOscillator();
 const gain = this.silentAudioCtx.createGain();
 // Tiny non-zero gain — zero often gets suspended by mobile browsers
 gain.gain.value = 0.0008;
 osc.frequency.value = 40;
 osc.connect(gain);
 gain.connect(this.silentAudioCtx.destination);
 osc.start();
 this.silentOscillator = osc;
 }
 this.startHtmlAudioKeepAlive();
 if (navigator.mediaSession) {
 try {
 navigator.mediaSession.metadata = new MediaMetadata({
 title: 'WOW-CSG Activity Tracking',
 artist: 'Fitness Challenge',
 album: 'Distance tracking in progress'
 });
 navigator.mediaSession.playbackState = 'playing';
 } catch (e) { /* ignore */ }
 }
 } catch (error) {
 console.warn('Silent audio keep-alive failed:', error);
 this.startKeepAwakeFallback();
 this.startHtmlAudioKeepAlive();
 }
 }

 stopSilentAudioKeepAlive() {
 try {
 if (this.silentOscillator) {
 try { this.silentOscillator.stop(); } catch (e) { /* ignore */ }
 try { this.silentOscillator.disconnect(); } catch (e) { /* ignore */ }
 this.silentOscillator = null;
 }
 if (this.silentAudioCtx) {
 this.silentAudioCtx.close().catch(() => {});
 this.silentAudioCtx = null;
 }
 if (navigator.mediaSession) {
 try { navigator.mediaSession.playbackState = 'none'; } catch (e) { /* ignore */ }
 }
 } catch (error) {
 console.warn('Silent audio cleanup failed:', error);
 }
 }

 async requestWakeLock() {
 try {
 if (navigator.wakeLock && navigator.wakeLock.request) {
 if (this.stepCounter.wakeLock) {
 try { await this.stepCounter.wakeLock.release(); } catch (e) { /* ignore */ }
 this.stepCounter.wakeLock = null;
 }
 this.stepCounter.wakeLock = await navigator.wakeLock.request('screen');
 this.stepCounter.wakeLock.addEventListener('release', () => {
 this.updateWakeLockUi();
 if (this.stepCounter.isRunning) {
 if (document.visibilityState !== 'visible') {
 this.ensureHiddenKeepAlives();
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.startBackgroundGpsPoll();
 }
 } else {
 this.requestWakeLock();
 }
 }
 });
 this.updateWakeLockUi();
 return true;
 }
 } catch (error) {
 console.warn('Wake Lock unavailable:', error);
 }
 this.startKeepAwakeFallback();
 this.updateWakeLockUi();
 return false;
 }

 async releaseWakeLock() {
 try {
 if (this.stepCounter.wakeLock) {
 await this.stepCounter.wakeLock.release();
 }
 } catch (error) {
 console.warn('Wake Lock release failed:', error);
 }
 this.stepCounter.wakeLock = null;
 this.updateWakeLockUi();
 }

 startKeepAwakeFallback() {
 // Silent looping media keeps many mobile browsers from fully sleeping the tab
 try {
 if (!this.keepAwakeVideo) {
 this.keepAwakeVideo = document.createElement('video');
 this.keepAwakeVideo.setAttribute('playsinline', '');
 this.keepAwakeVideo.setAttribute('muted', '');
 this.keepAwakeVideo.muted = true;
 this.keepAwakeVideo.loop = true;
 this.keepAwakeVideo.preload = 'auto';
 this.keepAwakeVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;';
 const canvas = document.createElement('canvas');
 canvas.width = 2;
 canvas.height = 2;
 const stream = canvas.captureStream(1);
 this.keepAwakeVideo.srcObject = stream;
 document.body.appendChild(this.keepAwakeVideo);
 }
 const playPromise = this.keepAwakeVideo.play();
 if (playPromise && playPromise.catch) {
 playPromise.catch(() => {});
 }
 } catch (error) {
 console.warn('Keep-awake fallback failed:', error);
 }
 }

 stopKeepAwakeFallback() {
 try {
 if (this.keepAwakeVideo) {
 this.keepAwakeVideo.pause();
 if (this.keepAwakeVideo.srcObject) {
 const tracks = this.keepAwakeVideo.srcObject.getTracks();
 tracks.forEach((t) => t.stop());
 this.keepAwakeVideo.srcObject = null;
 }
 if (this.keepAwakeVideo.parentNode) {
 this.keepAwakeVideo.parentNode.removeChild(this.keepAwakeVideo);
 }
 this.keepAwakeVideo = null;
 }
 } catch (error) {
 console.warn('Keep-awake cleanup failed:', error);
 }
 }

 updateWakeLockUi() {
 const badge = document.getElementById('wakeLockBadge');
 const hint = document.getElementById('mapHint');
 if (!this.stepCounter.isRunning) {
 if (badge) badge.style.display = 'none';
 return;
 }
 if (badge) badge.style.display = 'inline-flex';
 const active = !!(this.stepCounter.wakeLock && this.stepCounter.wakeLock.released === false);
 if (badge) {
 badge.textContent = active
 ? 'Lock tracking ON (screen stay-awake)'
 : 'Lock tracking ON (GPS + keep-alive)';
 badge.classList.add('is-active');
 }
 if (hint) {
 hint.textContent = 'Tracking while locked is enabled. Add to Home Screen and allow Location for best results. Do not swipe the app away.';
 }
 }

 handleGpsPosition(position, fromResume = false) {
 if (!this.stepCounter.isRunning) return;
 if (this.stepCounter.trackingMode === 'treadmill') return;

 const { latitude, longitude, accuracy } = position.coords;
 const isBackground = fromResume || document.visibilityState !== 'visible';
 const isNative = !!(window.WowNative && window.WowNative.isNative);
 const ua = navigator.userAgent || '';
 const isIosWeb = !isNative && /iPhone|iPad|iPod/i.test(ua);
 const isAndroidWeb = !isNative && /Android/i.test(ua);
 const isMobileWeb = isIosWeb || isAndroidWeb;
 // Mobile browsers often report 80–150m+ accuracy while still usable for walking.
 // Native Android can be noisier while locked (MIUI) — allow a wider window.
 const maxAccuracy = isNative
 ? (isBackground ? 280 : 160)
 : isMobileWeb
 ? (isBackground || fromResume ? 250 : 150)
 : (isBackground ? 180 : 100);
 if (accuracy && accuracy > maxAccuracy) {
 return;
 }

 const point = { lat: latitude, lng: longitude, t: Date.now(), accuracy: accuracy || null };
 const last = this.stepCounter.lastPosition;
 if (last) {
 const segmentKm = this.haversineKm(last.lat, last.lng, point.lat, point.lng);
 const dtSec = Math.max(0.5, (point.t - (last.t || point.t)) / 1000);
 const hours = dtSec / 3600;
 // Wider limits on native / after unlock so sparse samples still credit distance
 const maxKm = isBackground || isNative || (isMobileWeb && (fromResume || dtSec >= 20))
 ? Math.min(14.0, Math.max(0.6, hours * 18))
 : Math.min(4.0, Math.max(0.35, hours * 20));

 if (segmentKm > maxKm) {
 if (dtSec >= 12) {
 // Long gap (typical when phone was locked): credit capped walking/jogging pace
 const paceKmh = isMobileWeb ? 10.5 : 9.5;
 const creditKm = Math.min(segmentKm, hours * paceKmh);
 if (creditKm >= 0.005) {
 this.stepCounter.distanceKm = (this.stepCounter.distanceKm || 0) + creditKm;
 }
 this.stepCounter.lastPosition = point;
 this.stepCounter.path.push(point);
 this.stepCounter.gpsReady = true;
 if (isBackground || isNative || isIosWeb) {
 this.syncStepsFromDistance(true);
 }
 this.updateActivityMap(point);
 this.updateStepCounterDisplay();
 this.persistActivitySession(false);
 }
 return;
 }

 // Ignore GPS jitter under ~2.5 m unless enough time passed
 if (segmentKm < 0.0025 && dtSec < 8) {
 return;
 }

 this.stepCounter.pendingSegmentKm = (this.stepCounter.pendingSegmentKm || 0) + segmentKm;
 if (this.stepCounter.pendingSegmentKm >= 0.001 || isBackground || isNative || isIosWeb) {
 this.stepCounter.distanceKm += this.stepCounter.pendingSegmentKm;
 this.stepCounter.pendingSegmentKm = 0;
 }
 }

 this.stepCounter.lastPosition = point;
 this.stepCounter.path.push(point);
 if (this.stepCounter.path.length > 800) {
 this.stepCounter.path = this.stepCounter.path.filter((_, idx, arr) => {
 if (idx === 0 || idx === arr.length - 1) return true;
 return idx % 3 !== 1;
 });
 this.recalculateGpsDistanceFromPath();
 }

 this.stepCounter.gpsReady = true;
 if (isBackground || isNative) {
 this.syncStepsFromDistance(true);
 }
 this.updateActivityMap(point);
 this.updateStepCounterDisplay();
 this.persistActivitySession(false);

 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = isBackground
 ? 'Lock-screen GPS update received. KM + steps still counting.'
 : 'Live GPS tracking ON. Distance uses GPS + step backup.';
 }
 }

 updateActivityMap(point) {
 this.initActivityMap();
 if (!this.activityMap || !point) return;

 const latLng = [point.lat, point.lng];
 if (this.activityPolyline) {
 this.activityPolyline.addLatLng(latLng);
 }
 if (!this.activityMarker) {
 this.activityMarker = L.circleMarker(latLng, {
 radius: 7,
 color: '#ff6b4a',
 fillColor: '#ff6b4a',
 fillOpacity: 0.9
 }).addTo(this.activityMap);
 this.activityMap.setView(latLng, 17);
 } else {
 this.activityMarker.setLatLng(latLng);
 }
 if (this.activityPolyline && this.activityPolyline.getLatLngs().length > 1) {
 this.activityMap.fitBounds(this.activityPolyline.getBounds(), { padding: [24, 24] });
 }
    }

    updateStepCounterDisplay() {
 this.maybeCaptureTimeToGoal();
 const distance = this.stepCounter.frozenForSave
 ? Number(this.stepCounter.frozenForSave.distanceKm) || 0
 : this.getTrackedDistanceKm();
 const calories = this.getSessionCalories();
 const kmEl = document.getElementById('liveKmCount');
 if (kmEl) {
 // Show 3 decimals near the day goal so 1.98 is not mistaken for 2.00
 const goalKm = this.getDailyGoalKm();
 const nearGoal = goalKm > 0 && distance >= Math.max(0, goalKm - 0.08);
 kmEl.textContent = nearGoal ? distance.toFixed(3) : distance.toFixed(2);
 }
 const stepsEl = document.getElementById('liveStepCount');
 if (stepsEl) {
 stepsEl.textContent = `${(this.stepCounter.stepCount || 0).toLocaleString()} steps`;
 }
 const calorieEl = document.getElementById('liveCalorieCount');
 if (calorieEl) {
 calorieEl.textContent = `${calories.toLocaleString()} kcal`;
 }

 const gpsDistanceLabel = document.getElementById('gpsDistanceLabel');
 if (gpsDistanceLabel) {
 const goalKm = this.getDailyGoalKm();
 const nearGoal = goalKm > 0 && distance >= Math.max(0, goalKm - 0.08);
 gpsDistanceLabel.textContent = nearGoal
 ? `${Number(distance).toFixed(3)} KM`
 : `${Number(distance).toFixed(2)} KM`;
 }
 const gpsCaloriesLabel = document.getElementById('gpsCaloriesLabel');
 if (gpsCaloriesLabel) {
 gpsCaloriesLabel.textContent = `${calories.toLocaleString()} kcal`;
 }
 const paceLabel = document.getElementById('gpsPaceLabel');
 if (paceLabel && this.stepCounter.startTime && distance > 0.01) {
 const minutes = (Date.now() - this.stepCounter.startTime) / 60000;
 const pace = minutes / distance;
 paceLabel.textContent = `${pace.toFixed(1)} min/KM`;
 } else if (paceLabel) {
 paceLabel.textContent = '--';
        }
    }

    animateStepCounter() {
 const display = document.getElementById('liveKmCount');
        if (display) {
            display.style.transform = 'scale(1.1)';
            setTimeout(() => {
                display.style.transform = 'scale(1)';
            }, 150);
        }
    }

    updateCounterStatus(message) {
        const status = document.getElementById('counterStatus');
        if (status) {
            status.textContent = message;
        }
    }

    updateCounterHint(message) {
        const hint = document.getElementById('counterHint');
        if (hint) {
            hint.textContent = message;
        }
    }

    // Timer functions
 startTimer(preserveElapsed = false) {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        
 if (!preserveElapsed || !this.stepCounter.startTime) {
 if (!this.stepCounter.startTime) {
 this.stepCounter.startTime = Date.now();
 }
 }
 this.timerStartTime = this.stepCounter.startTime;

        this.timerInterval = setInterval(() => {
 const elapsed = Math.floor((Date.now() - this.stepCounter.startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            const timerValue = document.getElementById('timerValue');
            if (timerValue) {
                timerValue.textContent = timeStr;
            }
 this.accumulateTreadmillDistance();
 // While locked, sensors pause — keep steps aligned with KM from GPS/treadmill
 if (document.visibilityState !== 'visible') {
 this.syncStepsFromDistance(true);
 }
 // Refresh calorie estimate as duration changes
 this.updateStepCounterDisplay();
 if (elapsed > 0 && elapsed % 5 === 0) {
 this.persistActivitySession(false);
 }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    useCounterSteps() {
        // This function is disabled - users cannot use step counter steps in manual entry
        // They must save steps directly using "Save Steps & Update Leaderboard" button
        return;
        
        // Disabled code below:
        // if (this.stepCounter.stepCount > 0) {
 // // Switch to manual entry tab and populate the input
 // this.switchInputMethod('manual');
 // const stepsInput = document.getElementById('stepsInput');
 // if (stepsInput) {
 // stepsInput.value = this.stepCounter.stepCount;
 // }
 // this.updateScreenshotRequirement();
 // this.showCounterNotification(`Added ${this.stepCounter.stepCount.toLocaleString()} steps to manual entry form! Screenshot is optional for step counter entries.`);
 // // Don't reset counter - user might want to save directly
        // }
    }

    updateScreenshotRequirement() {
        const stepsInput = document.getElementById('stepsInput');
        const screenshotRequired = document.getElementById('screenshotRequired');
        const screenshotHint = document.getElementById('screenshotHint');
        const manualScreenshot = document.getElementById('manualScreenshot');
        
        if (!stepsInput || !screenshotRequired || !screenshotHint) return;

        const inputValue = parseInt(stepsInput.value);
        const isFromStepCounter = this.stepCounter.stepCount > 0 && inputValue === this.stepCounter.stepCount;

        if (isFromStepCounter) {
            // Step counter - screenshot optional
            screenshotRequired.style.display = 'none';
            screenshotRequired.textContent = '';
            screenshotHint.textContent = 'Optional for step counter entries';
            screenshotHint.style.color = '#666';
            if (manualScreenshot) {
                manualScreenshot.removeAttribute('required');
            }
        } else {
            // Manual entry - screenshot required
            screenshotRequired.style.display = 'inline';
            screenshotRequired.textContent = '*';
            screenshotHint.textContent = 'Required for manual entry validation';
            screenshotHint.style.color = '#333';
            if (manualScreenshot) {
                manualScreenshot.setAttribute('required', 'required');
            }
        }
    }

    async saveCounterStepsDirectly() {
        if (!this.currentUser) {
            alert('Please login first!');
            return;
        }

 if (!this.canLogSteps()) {
 const { endDate } = this.getChallengeBounds();
 alert(`The challenge has ended. New step entries are no longer being accepted.\n\nEnded on ${this.formatDate(endDate)}.`);
            return;
        }

 // If still running, force Stop first so duration is freeze-at-stop (not submit time)
 if (this.stepCounter.isRunning) {
 this.stopStepCounter();
 }

 this.accumulateTreadmillDistance();
 const frozen = this.stepCounter.frozenForSave;
 const mode = (frozen && frozen.trackingMode) || this.stepCounter.trackingMode || 'outdoor';
 const motionSteps = frozen ? (frozen.steps || 0) : (this.stepCounter.stepCount || 0);
 const stepsPerKm = this.getStepsPerKmForTracking();
 // Treadmill: steps are the only source of truth (prevents fake speed farming)
 let distanceKm;
 let steps;
 if (mode === 'treadmill') {
 steps = motionSteps;
 distanceKm = Number((steps / stepsPerKm).toFixed(3));
 } else if (frozen && Number(frozen.distanceKm) > 0) {
 distanceKm = Number(Number(frozen.distanceKm).toFixed(3));
 const estimatedSteps = Math.round(distanceKm * stepsPerKm);
 steps = Math.max(motionSteps, estimatedSteps);
 } else {
 distanceKm = this.getTrackedDistanceKm();
 const estimatedSteps = Math.round(distanceKm * stepsPerKm);
 steps = Math.max(motionSteps, estimatedSteps);
 }

 if (distanceKm <= 0 && steps <= 0) {
 alert(mode === 'treadmill'
 ? 'No treadmill steps yet. Start Activity, keep the phone on your body, walk/run, then Stop and Save.'
 : 'No distance recorded yet. Start Activity, move with GPS on, then Stop and Save.');
 return;
 }

 this.maybeCaptureTimeToGoal();
 const durationSec = frozen && frozen.durationSec != null
 ? Math.max(0, Math.round(Number(frozen.durationSec) || 0))
 : (this.stepCounter.isPaused
 ? (this.stepCounter.elapsedSecAtPause || 0)
 : (this.stepCounter.startTime
 ? Math.round((Date.now() - this.stepCounter.startTime) / 1000)
 : this.getSessionDurationSec()));
 const timeToGoalSec = (frozen && frozen.timeToGoalSec != null)
 ? frozen.timeToGoalSec
 : this.stepCounter.timeToGoalSec;
 const path = frozen && Array.isArray(frozen.path)
 ? frozen.path
 : (mode === 'treadmill' ? [] : (this.stepCounter.path || []).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t })));

 // Mobile browsers often under-count if the screen was locked — warn before save
 const uaSave = navigator.userAgent || '';
 const isIosWebSave = /iPhone|iPad|iPod/i.test(uaSave);
 const isAndroidWebSave = /Android/i.test(uaSave) && !(window.WowNative && window.WowNative.isNative);
 if (
 mode === 'outdoor' &&
 (isIosWebSave || isAndroidWebSave) &&
 durationSec >= 600 &&
 distanceKm > 0 &&
 distanceKm < 0.5
 ) {
 const proceed = confirm(
 (isIosWebSave ? 'iPhone' : 'Android Chrome') +
 ' notice: portal distance looks very low for this duration (' +
 distanceKm.toFixed(3) +
 ' KM in ' +
 this.formatDurationClock(durationSec) +
 ').\n\n' +
 (isIosWebSave
 ? 'Safari often pauses GPS when the screen locks, while Apple Fitness may keep counting.\n\nFor accurate challenge KM: keep Safari open with the screen on, then try again.'
 : 'Chrome may pause GPS/steps when the screen locks or the tab is backgrounded.\n\nFor accurate challenge KM: use the Android APK, or keep Chrome open with the screen on, then try again.') +
 '\n\nSave this activity anyway?'
 );
 if (!proceed) return;
 }

 const caloriesBurned = this.estimateCaloriesBurned(distanceKm, durationSec, this.getBodyWeightKg());
 const goalKm = this.getDailyGoalKm();
 const finishHint = timeToGoalSec != null
 ? ` · day-goal time ${this.formatDurationClock(timeToGoalSec)}`
 : (this.meetsDailyGoal(distanceKm, goalKm) ? '' : ` · under ${goalKm} KM goal`);

 this.openShareActivityModal({
 steps,
 distanceKm,
 durationSec,
 timeToGoalSec: timeToGoalSec != null ? Number(timeToGoalSec) : null,
 caloriesBurned,
 bodyWeightKg: this.getBodyWeightKg(),
 trackingMode: mode,
 treadmillSpeedKmh: mode === 'treadmill'
 ? ((frozen && frozen.treadmillSpeedKmh) || this.stepCounter.treadmillSpeedKmh || null)
 : null,
 path,
 startedAt: (frozen && frozen.startTime) || this.stepCounter.startTime || Date.now()
 });
 // Enrich share summary with goal timing when available
 const summary = document.getElementById('shareActivitySummary');
 if (summary && finishHint) {
 summary.textContent = `${summary.textContent}${finishHint}`;
 }
 }

 async saveStepsWithScreenshot(steps, screenshotData, fromStepCounter = false, trackMeta = null, shareOptions = null) {
        // Do not bump totals here — leaderboard uses approved entries only.
        // Totals are rebuilt from approved entries after this entry is stored.
        this.currentUser.lastActivity = new Date().toISOString();

 const distanceKm = trackMeta && typeof trackMeta.distanceKm === 'number'
 ? trackMeta.distanceKm
 : steps / (this.challengeConfig.stepsPerKm || 1300);
 if (!this.currentUser.dailyDistanceKm) this.currentUser.dailyDistanceKm = {};
 if (!this.currentUser.dailySteps) this.currentUser.dailySteps = {};

 const durationSec = trackMeta && typeof trackMeta.durationSec === 'number' ? trackMeta.durationSec : null;
 const caloriesBurned = trackMeta && typeof trackMeta.caloriesBurned === 'number'
 ? trackMeta.caloriesBurned
 : this.estimateCaloriesBurned(distanceKm, durationSec, this.getBodyWeightKg());
 if (!this.currentUser.dailyCalories) this.currentUser.dailyCalories = {};

 // Per-day completion stats for daily leaderboards (shortest time wins)
 if (!this.currentUser.dailyStats) this.currentUser.dailyStats = {};
 // Use activity start time so a save after midnight still counts on the day you walked
 const activityStartedAt = (trackMeta && trackMeta.startedAt)
  || (trackMeta && trackMeta.startTime)
  || this.stepCounter.startTime
  || ((this.stepCounter.frozenForSave && this.stepCounter.frozenForSave.startTime) || null)
  || Date.now();
 const activityDate = this.parseEntryDate(activityStartedAt);
 const dayNum = this.getChallengeDayNumber(activityDate);
 const goalKmForDay = dayNum >= 1 && dayNum <= 7
 ? this.challengeConfig.dayGoalsKm[dayNum - 1]
 : this.getDailyGoalKm(activityDate);
 const today = activityDate.toDateString();
 const prevDay = this.currentUser.dailyStats[today] || {
 distanceKm: 0,
 durationSec: 0,
 steps: 0,
 caloriesBurned: 0,
 completed: false,
 completionDurationSec: null,
 completedAt: null,
 goalKm: goalKmForDay,
 challengeDay: dayNum || null
 };
 // Tentative day stats — rebuilt from approved entries after save when status is known
 prevDay.goalKm = goalKmForDay;
 prevDay.challengeDay = dayNum || prevDay.challengeDay || null;
 const attemptFinishSec = this.estimateTimeToGoalSec(
 { distanceKm, durationSec, path: trackMeta && trackMeta.path, timeToGoalSec: trackMeta && trackMeta.timeToGoalSec },
 goalKmForDay
 );
 const attemptEntry = { distanceKm, durationSec, path: trackMeta && trackMeta.path, timeToGoalSec: trackMeta && trackMeta.timeToGoalSec };
 // Only count toward day completion preview when this attempt will auto-approve
 // (actual rebuild happens after stepEntries is updated)
 this.currentUser.dailyStats[today] = prevDay;

        const entryId = `ENTRY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Must be live Firebase Auth — stale localStorage uid fails Firestore rules
        const authUser = this.auth && this.auth.currentUser;
        if (!authUser) {
            alert('Your login session expired. Please log out and log in again, then save the activity.');
            return;
        }
        const authUid = authUser.uid;
        if (this.currentUser && this.currentUser.uid && String(this.currentUser.uid) !== String(authUid)) {
            console.warn('Repairing stale profile uid to match Firebase Auth');
            this.currentUser.uid = authUid;
        }
 const draftForPace = {
 distanceKm: Number(distanceKm.toFixed(3)),
 durationSec,
 timeToGoalSec: trackMeta && trackMeta.timeToGoalSec != null ? Number(trackMeta.timeToGoalSec) : null,
 path: trackMeta && Array.isArray(trackMeta.path) ? trackMeta.path : []
 };
 const paceIllegal = this.isImplausibleChallengePace(draftForPace, goalKmForDay);
 const autoOk = fromStepCounter && !paceIllegal;
 if (autoOk && attemptFinishSec != null && !this.isImplausibleChallengePace(attemptEntry, goalKmForDay)) {
 prevDay.completed = true;
 if (prevDay.completionDurationSec == null || attemptFinishSec < prevDay.completionDurationSec) {
 prevDay.completionDurationSec = attemptFinishSec;
 prevDay.completedAt = new Date().toISOString();
 }
 }
 this.currentUser.dailyStats[today] = prevDay;
 const paceNote = paceIllegal
 ? `Rejected: pace faster than ${this.challengeConfig.maxHumanSpeedKmh} km/h for the day goal (unrealistic / GPS glitch).`
 : null;
        const stepEntry = {
            id: entryId,
            userId: this.currentUser.id || this.currentUser.employeeId || 'unknown',
            userUid: authUid,
            userName: this.resolveDisplayName(
                this.currentUser.name,
                this.currentUser.username,
                this.deriveDisplayNameFromEmail(this.currentUser.email || this.currentUser.emailId)
            ) || 'Unknown User',
            userEmail: this.currentUser.email || this.currentUser.emailId || 'No email',
            steps: steps,
            distanceKm: Number(distanceKm.toFixed(3)),
            caloriesBurned,
            path: this.sanitizePathForCloud(trackMeta && Array.isArray(trackMeta.path) ? trackMeta.path : []),
            durationSec,
            timeToGoalSec: trackMeta && trackMeta.timeToGoalSec != null ? Number(trackMeta.timeToGoalSec) : null,
            date: activityDate.toISOString(),
            challengeDay: dayNum || null,
            status: autoOk ? 'approved' : (paceIllegal ? 'rejected' : 'pending'),
            validatedBy: paceIllegal ? 'App pace check' : (fromStepCounter ? 'App GPS Counter' : null),
            validatedAt: (autoOk || paceIllegal) ? new Date().toISOString() : null,
            notes: paceNote || (fromStepCounter
                ? ((trackMeta && trackMeta.trackingMode === 'treadmill')
                    ? `Treadmill activity (step-based): ${distanceKm.toFixed(2)} KM / ${steps} steps - ${caloriesBurned} kcal`
                    : `In-app GPS activity: ${distanceKm.toFixed(2)} KM - ${caloriesBurned} kcal`)
                : null),
            source: fromStepCounter
                ? ((trackMeta && trackMeta.trackingMode === 'treadmill') ? 'treadmill-counter' : 'gps-counter')
                : 'manual',
            trackingMode: trackMeta && trackMeta.trackingMode ? trackMeta.trackingMode : (fromStepCounter ? 'outdoor' : null),
            treadmillSpeedKmh: trackMeta && trackMeta.treadmillSpeedKmh ? trackMeta.treadmillSpeedKmh : null,
            season: this.dataSeason
        };

        // Ensure stepEntries is initialized
        if (!this.stepEntries || !Array.isArray(this.stepEntries)) {
            console.warn('stepEntries not initialized in saveStepsWithScreenshot, loading from localStorage...');
            this.stepEntries = this.loadStepEntries();
        }
        
        this.stepEntries.unshift(stepEntry);
        
        console.log('=== Entry Creation (saveStepsWithScreenshot) ===');
        console.log('Entry created:', stepEntry);
        console.log('Total entries before save:', this.stepEntries.length);
        
        this.saveStepEntries();
        const cloudOk = await this.upsertStepEntryInFirebase(stepEntry);
        // Prevent an immediate leaderboard sync from racing and wiping this save
        this._lastStepEntriesSyncAt = Date.now();

        // Align personal dashboard with public leaderboard (approved entries only)
        this.recalculateParticipantTotalsFromApproved(this.currentUser);
        // Pending legal finishes still count on personal Today progress
        if (typeof this.refreshCurrentUserTotalsFromEntries === 'function') {
            this.refreshCurrentUserTotalsFromEntries();
        }

        let shareNote = '';
        // Team feed is for approved challenge activity only (pace rejects stay off the feed)
        if ((stepEntry.status || '') === 'approved') {
        try {
            const opts = shareOptions || { shareToFeed: true, caption: null, photoFile: null };
            await this.publishActivityFeedPost(stepEntry, {
                shareToFeed: true,
                caption: opts.caption || null,
                photoFile: opts.shareToFeed ? (opts.photoFile || null) : null
            });
            shareNote = (opts.shareToFeed && opts.photoFile)
                ? '\n\nShared to the Team Activity Feed with your photo!'
                : '\n\nPosted to the Team Activity Feed.';
        } catch (shareErr) {
            console.warn('Feed share failed:', shareErr);
            shareNote = '\n\nActivity saved, but Team Feed post failed: ' + (shareErr.message || 'unknown error');
        }
        } else if (paceIllegal) {
            shareNote = '\n\nNot posted to Team Feed (pace rejected for day board).';
        }
        if (!cloudOk) {
            stepEntry._cloudSynced = false;
            this.persistUnsyncedBackup(stepEntry);
            this.saveStepEntries();
            shareNote += '\n\nWarning: cloud sync failed — activity is kept on this device.\nTap “Recover unsaved activities” under Recent Activity after logging in again.';
        }
        
        // Verify save immediately
        const verify = this.loadStepEntries();
        console.log('Verification - Entries in localStorage after save:', verify.length);
        console.log('Verification - Latest entry ID:', verify.length > 0 ? verify[0].id : 'none');
        
        if (verify.length === 0) {
            console.error('ERROR: Entry was not saved to localStorage! Attempting manual save...');
            // Try manual save
            try {
                const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
                localStorage.setItem(storageKey, JSON.stringify([stepEntry]));
                console.log('Manual save attempted');
            } catch (e) {
                console.error('Manual save also failed:', e);
                alert('CRITICAL: Entry could not be saved to localStorage! Please check browser settings.');
            }
        }

 const modeLabel = trackMeta && trackMeta.trackingMode === 'treadmill' ? 'treadmill' : 'GPS';
        const activityMessage = fromStepCounter 
 ? `Covered ${distanceKm.toFixed(2)} KM (${steps.toLocaleString()} steps) via ${modeLabel} - burned ${caloriesBurned} kcal`
 : `Added ${steps.toLocaleString()} steps - burned ${caloriesBurned} kcal`;
        
        this.currentUser.activities.unshift({
            date: new Date().toISOString(),
            steps: steps,
 distanceKm: Number(distanceKm.toFixed(3)),
 caloriesBurned,
            message: activityMessage,
            entryId: entryId
        });

        // Keep only last 20 activities
        if (this.currentUser.activities.length > 20) {
            this.currentUser.activities = this.currentUser.activities.slice(0, 20);
        }

        // Update streak
        this.currentUser.streak = this.calculateStreak(this.currentUser);

        // Save — match by uid/id, not display name (duplicate names broke ranks)
        const index = this.participants.findIndex((p) =>
            (this.currentUser.uid && p.uid && String(p.uid) === String(this.currentUser.uid)) ||
            (this.currentUser.id && p.id && String(p.id) === String(this.currentUser.id)) ||
            (this.currentUser.employeeId && p.employeeId && String(p.employeeId) === String(this.currentUser.employeeId)) ||
            (p.name === this.currentUser.name)
        );
        if (index !== -1) {
            this.participants[index] = this.currentUser;
        } else {
            this.participants.push(this.currentUser);
        }

        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
        this.saveParticipantsCache();
        this.syncParticipantToFirebase(this.currentUser);

        // Reset step counter
        this.resetStepCounter();
        this.stopTimer();
        
        // Clear screenshot input if it was used
 const manualShot = document.getElementById('manualScreenshot');
 const manualPreview = document.getElementById('manualImagePreview');
 const manualUpload = document.getElementById('manualUploadArea');
 if (manualShot) manualShot.value = '';
 if (manualPreview) manualPreview.style.display = 'none';
 if (manualUpload) manualUpload.style.display = 'block';
        
        // Show success
 this.showCounterNotification(` ${distanceKm.toFixed(2)} KM - ${caloriesBurned} kcal saved!`);
        
        // Update dashboard and leaderboard immediately (do NOT remote-sync — that raced and wiped saves)
        this.updateDashboard();
        this.updateActivities();
        await this.updateLeaderboard(null, { skipRemoteSync: true });
        this.loadActivityFeed();
        
        // Show success message
        setTimeout(() => {
 if (paceIllegal) {
 alert(`Activity saved but REJECTED for the day challenge.\n\nYour pace to the day goal was faster than ${this.challengeConfig.maxHumanSpeedKmh} km/h (~${this.formatDurationClock(this.minLegalFinishSecForGoal(goalKmForDay))} min for ${goalKmForDay} KM minimum).\n\nThis often means GPS/step distance was over-counted (app KM higher than real). Please update to the latest Android APK, try again outdoors with a steady GPS lock, and stop near the real day goal.${shareNote}`);
 } else {
 alert(`Saved successfully!\n\n${distanceKm.toFixed(2)} KM covered (~${steps.toLocaleString()} steps)\nCalories burned: ~${caloriesBurned} kcal\n\nYour leaderboard has been updated.${shareNote}`);
 }
        }, 500);
    }

    openShareActivityModal(pending) {
        this.pendingShareSave = pending;
        this.clearSharePhotoSelection();
        const modal = document.getElementById('shareActivityModal');
        const summary = document.getElementById('shareActivitySummary');
        const shareCb = document.getElementById('shareToFeedCheckbox');
        const caption = document.getElementById('shareActivityCaption');
        if (shareCb) shareCb.checked = true;
        if (caption) caption.value = '';
        if (summary) {
            const modeLabel = pending.trackingMode === 'treadmill' ? 'Treadmill' : 'Outdoor';
            summary.textContent =
                `${modeLabel}: ${Number(pending.distanceKm || 0).toFixed(2)} KM · ` +
                `${(pending.steps || 0).toLocaleString()} steps · ` +
                `~${Math.round(pending.caloriesBurned || 0)} kcal · ` +
                `${this.formatDurationClock(pending.durationSec)}`;
        }
        this.toggleSharePhotoGroups();
        if (modal) modal.style.display = 'flex';
    }

    closeShareActivityModal() {
        const modal = document.getElementById('shareActivityModal');
        if (modal) modal.style.display = 'none';
        this.pendingShareSave = null;
        this.clearSharePhotoSelection();
    }

    toggleSharePhotoGroups() {
        const shareCb = document.getElementById('shareToFeedCheckbox');
        const enabled = !!(shareCb && shareCb.checked);
        const photoGroup = document.getElementById('sharePhotoGroup');
        const captionGroup = document.getElementById('shareCaptionGroup');
        if (photoGroup) photoGroup.style.opacity = enabled ? '1' : '0.5';
        if (captionGroup) captionGroup.style.opacity = enabled ? '1' : '0.5';
        const photoInput = document.getElementById('shareActivityPhoto');
        const caption = document.getElementById('shareActivityCaption');
        if (photoInput) photoInput.disabled = !enabled;
        if (caption) caption.disabled = !enabled;
    }

    handleSharePhotoSelected(file) {
        if (!file) {
            this.clearSharePhotoSelection();
            return;
        }
        if (!file.type || !file.type.startsWith('image/')) {
            alert('Please choose an image file.');
            this.clearSharePhotoSelection();
            return;
        }
        if (file.size > 12 * 1024 * 1024) {
            alert('Photo is too large. Please choose an image under 12 MB.');
            this.clearSharePhotoSelection();
            return;
        }
        this.sharePhotoFile = file;
        const preview = document.getElementById('sharePhotoPreview');
        const wrap = document.getElementById('sharePhotoPreviewWrap');
        if (preview) {
            preview.src = URL.createObjectURL(file);
        }
        if (wrap) wrap.style.display = 'block';
    }

    clearSharePhotoSelection() {
        this.sharePhotoFile = null;
        const input = document.getElementById('shareActivityPhoto');
        const preview = document.getElementById('sharePhotoPreview');
        const wrap = document.getElementById('sharePhotoPreviewWrap');
        if (input) input.value = '';
        if (preview) {
            if (preview.src && preview.src.startsWith('blob:')) {
                try { URL.revokeObjectURL(preview.src); } catch (e) { /* ignore */ }
            }
            preview.removeAttribute('src');
        }
        if (wrap) wrap.style.display = 'none';
    }

    async confirmShareAndSave() {
        if (!this.pendingShareSave) {
            this.closeShareActivityModal();
            return;
        }
        const pending = this.pendingShareSave;
        const shareToFeed = !!(document.getElementById('shareToFeedCheckbox') && document.getElementById('shareToFeedCheckbox').checked);
        const captionEl = document.getElementById('shareActivityCaption');
        const caption = captionEl ? String(captionEl.value || '').trim().slice(0, 180) : '';
        const shareOptions = {
            shareToFeed,
            caption: caption || null,
            photoFile: shareToFeed ? this.sharePhotoFile : null
        };

        const confirmBtn = document.getElementById('confirmShareSaveBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Saving...';
        }

        try {
            this.closeShareActivityModal();
            await this.saveStepsWithScreenshot(pending.steps, null, true, {
                distanceKm: pending.distanceKm,
                path: pending.path || [],
                durationSec: pending.durationSec,
                timeToGoalSec: pending.timeToGoalSec != null ? pending.timeToGoalSec : null,
                caloriesBurned: pending.caloriesBurned,
                bodyWeightKg: pending.bodyWeightKg,
                trackingMode: pending.trackingMode,
                treadmillSpeedKmh: pending.treadmillSpeedKmh,
                startedAt: pending.startedAt || null
            }, shareOptions);
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Save Activity';
            }
        }
    }

    compressImageFile(file, maxWidth = 1280, quality = 0.72) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read photo'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Could not load photo'));
                img.onload = () => {
                    const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error('Could not compress photo'));
                            return;
                        }
                        resolve(blob);
                    }, 'image/jpeg', quality);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not encode photo'));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Prefer Firebase Storage when available; otherwise embed a compressed JPEG
     * data URL in Firestore (Spark-plan friendly until Storage/Blaze is enabled).
     */
    async prepareFeedPhoto(entryId, file) {
        const attempts = [
            { maxWidth: 720, quality: 0.55 },
            { maxWidth: 560, quality: 0.45 },
            { maxWidth: 480, quality: 0.4 }
        ];
        let lastBlob = null;
        for (const opts of attempts) {
            lastBlob = await this.compressImageFile(file, opts.maxWidth, opts.quality);
            if (lastBlob.size <= 400 * 1024) break;
        }
        if (!lastBlob) throw new Error('Could not compress photo');

        // Try Storage first (works after Blaze + default bucket are enabled)
        await this.ensureFirebaseStorageLoaded();
        if (this.storage && this.auth && this.auth.currentUser) {
            try {
                const uid = this.auth.currentUser.uid;
                const path = `activity-photos/${uid}/${entryId}.jpg`;
                const ref = this.storage.ref().child(path);
                await ref.put(lastBlob, { contentType: 'image/jpeg' });
                const photoUrl = await ref.getDownloadURL();
                return { photoUrl, photoDataUrl: null };
            } catch (storageErr) {
                console.warn('Storage upload unavailable, using Firestore photo fallback:', storageErr);
            }
        }

        if (lastBlob.size > 450 * 1024) {
            throw new Error('Photo is still too large after compression. Try a smaller image.');
        }
        const photoDataUrl = await this.blobToDataUrl(lastBlob);
        return { photoUrl: null, photoDataUrl };
    }

    async publishActivityFeedPost(stepEntry, shareOptions) {
        if (!this.firebaseEnabled || !this.db || !stepEntry) return;
        const authUser = this.auth && this.auth.currentUser;
        if (!authUser) throw new Error('Not signed in to Firebase Auth. Please log out and log in again.');
        const authUid = authUser.uid;

        let photoUrl = null;
        let photoDataUrl = null;
        if (shareOptions && shareOptions.photoFile) {
            try {
                const prepared = await this.prepareFeedPhoto(stepEntry.id, shareOptions.photoFile);
                photoUrl = prepared.photoUrl;
                photoDataUrl = prepared.photoDataUrl;
            } catch (photoErr) {
                console.warn('Photo attach failed; posting activity without photo:', photoErr);
            }
        }

        const postId = `FEED_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const post = {
            id: postId,
            entryId: stepEntry.id,
            userUid: authUid,
            userName: this.resolveDisplayName(
                stepEntry.userName,
                this.currentUser && this.currentUser.name,
                this.deriveDisplayNameFromEmail((this.currentUser && (this.currentUser.email || this.currentUser.emailId)) || '')
            ) || 'Teammate',
            steps: stepEntry.steps || 0,
            distanceKm: Number(stepEntry.distanceKm || 0),
            caloriesBurned: Number(stepEntry.caloriesBurned || 0),
            date: stepEntry.date || new Date().toISOString(),
            season: this.dataSeason,
            // Only approved activities should appear on the public team feed
            visible: true
        };
        // Optional fields — omit nulls so rules/keys stay clean
        if (stepEntry.userId) post.userId = stepEntry.userId;
        if (shareOptions && shareOptions.caption) post.caption = String(shareOptions.caption).slice(0, 180);
        if (stepEntry.durationSec != null) post.durationSec = Number(stepEntry.durationSec);
        if (stepEntry.trackingMode) post.trackingMode = stepEntry.trackingMode;
        if (stepEntry.source) post.source = stepEntry.source;
        if (photoUrl) post.photoUrl = photoUrl;
        if (photoDataUrl) post.photoDataUrl = photoDataUrl;

        try {
            await this.activityFeedCol().doc(postId).set(post);
        } catch (writeErr) {
            // Retry without embedded photo if document too large / rules reject
            if (photoDataUrl || photoUrl) {
                console.warn('Feed write with photo failed, retrying text-only:', writeErr);
                delete post.photoDataUrl;
                delete post.photoUrl;
                await this.activityFeedCol().doc(postId).set(post);
            } else {
                throw writeErr;
            }
        }
        return post;
    }

    /**
     * Keep activityFeed posts in sync when admin edits/validates an entry.
     * Updates denormalized stats + visibility so leaderboard-adjacent feed stays accurate.
     */
    async syncActivityFeedForEntry(entry) {
        if (!this.firebaseEnabled || !this.db || !entry || !entry.id) return;
        const status = entry.status || 'pending';
        const visible = status === 'approved';
        try {
            const snap = await this.activityFeedCol()
                .where('entryId', '==', entry.id)
                .where('season', '==', this.dataSeason)
                .limit(10)
                .get();
            if (snap.empty) return;

            const patch = {
                steps: entry.steps || 0,
                distanceKm: Number(entry.distanceKm || 0),
                caloriesBurned: Number(entry.caloriesBurned || 0),
                durationSec: entry.durationSec == null ? null : Number(entry.durationSec),
                trackingMode: entry.trackingMode || null,
                source: entry.source || null,
                date: entry.date || null,
                userName: entry.userName || null,
                visible,
                lastSyncedAt: new Date().toISOString(),
                lastSyncedBy: 'Admin'
            };
            await Promise.all(snap.docs.map((doc) => doc.ref.update(patch)));
        } catch (err) {
            console.warn('Could not sync activity feed for entry:', err);
            // Fallback: at least toggle visibility
            try {
                await this.setFeedVisibilityForEntry(entry.id, visible);
            } catch (visErr) {
                console.warn('Feed visibility fallback failed:', visErr);
            }
        }
    }

    async removeActivityFeedForEntry(entryId) {
        if (!this.firebaseEnabled || !this.db || !entryId) return;
        try {
            const snap = await this.activityFeedCol()
                .where('entryId', '==', entryId)
                .where('season', '==', this.dataSeason)
                .limit(10)
                .get();
            if (snap.empty) return;
            await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
        } catch (err) {
            console.warn('Could not delete feed posts for entry; hiding instead:', err);
            await this.setFeedVisibilityForEntry(entryId, false);
        }
    }

    /**
     * Refresh leaderboard, admin stats, users list, team feed, and the affected user's dashboard.
     */
    async refreshSurfacesAfterAdminActivityChange(participant) {
        if (participant && this.currentUser) {
            const sameUser =
                (participant.uid && this.currentUser.uid === participant.uid) ||
                (participant.id && this.currentUser.id === participant.id) ||
                (participant.employeeId && this.currentUser.employeeId === participant.employeeId);
            if (sameUser) {
                this.currentUser = this.stripSecretsFromParticipant({ ...participant });
                localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                this.updateDashboard();
                if (typeof this.updateActivities === 'function') {
                    this.updateActivities();
                }
            }
        }

        await this.updateAdminDashboard();
        this.updateLeaderboard();
        if (document.getElementById('usersList')) {
            this.loadUsersList();
        }
        if (document.getElementById('teamFeedList')) {
            await this.loadActivityFeed(true);
        }
    }

    async setFeedVisibilityForEntry(entryId, visible) {
        if (!this.firebaseEnabled || !this.db || !entryId) return;
        try {
            const snap = await this.activityFeedCol()
                .where('entryId', '==', entryId)
                .where('season', '==', this.dataSeason)
                .limit(5)
                .get();
            const writes = snap.docs.map((doc) => doc.ref.update({ visible: !!visible }));
            await Promise.all(writes);
        } catch (err) {
            console.warn('Could not update feed visibility:', err);
        }
    }

    async loadActivityFeed(force = false) {
        const list = document.getElementById('teamFeedList');
        if (!list) return;

        if (!this.currentUser) {
            list.innerHTML = '<p class="no-feed">Sign in to view the team activity feed.</p>';
            return;
        }
        if (!this.firebaseEnabled || !this.db) {
            list.innerHTML = '<p class="no-feed">Team feed requires an online connection.</p>';
            return;
        }

        if (!force && list.dataset.loading === '1') return;
        list.dataset.loading = '1';
        list.innerHTML = '<p class="no-feed">Loading team feed...</p>';

        try {
            const byEntry = new Map();

            // 1) Shared feed posts (photos / captions)
            try {
                let snap;
                try {
                    snap = await this.activityFeedCol()
                        .where('season', '==', this.dataSeason)
                        .where('visible', '==', true)
                        .orderBy('date', 'desc')
                        .limit(40)
                        .get();
                } catch (indexErr) {
                    snap = await this.activityFeedCol()
                        .where('season', '==', this.dataSeason)
                        .limit(80)
                        .get();
                }
                snap.docs.forEach((d) => {
                    const p = d.data();
                    if (!p || p.visible === false) return;
                    const key = p.entryId || p.id;
                    byEntry.set(key, p);
                });
            } catch (feedErr) {
                console.warn('activityFeed query failed:', feedErr);
            }

            // Prefer in-memory stepEntries so admin edits apply immediately to the feed.
            if (!Array.isArray(this.stepEntries) || this.stepEntries.length === 0) {
                this.stepEntries = this.loadStepEntries();
            }
            const entriesById = new Map(
                (this.stepEntries || []).filter((e) => e && e.id).map((e) => [e.id, e])
            );

            // Overlay live entry stats onto feed posts (admin edits win over denormalized copies)
            for (const [key, post] of Array.from(byEntry.entries())) {
                const entry = entriesById.get(post.entryId || key);
                if (!entry) continue;
                const st = entry.status || 'pending';
                if (st === 'rejected') {
                    byEntry.delete(key);
                    continue;
                }
                post.steps = entry.steps || 0;
                post.distanceKm = Number(entry.distanceKm || 0);
                post.caloriesBurned = Number(entry.caloriesBurned || 0);
                post.durationSec = entry.durationSec == null ? null : Number(entry.durationSec);
                post.trackingMode = entry.trackingMode || post.trackingMode || null;
                post.source = entry.source || post.source || null;
                post.userName = entry.userName || post.userName;
                if (entry.date) post.date = entry.date;
            }

            // 2) Fallback / supplement: recent approved activities so the feed is never empty
            //    when people have saved workouts but feed posts failed earlier.
            try {
                let entrySnap;
                try {
                    entrySnap = await this.stepEntriesCol()
                        .where('season', '==', this.dataSeason)
                        .where('status', '==', 'approved')
                        .orderBy('date', 'desc')
                        .limit(40)
                        .get();
                } catch (idx2) {
                    entrySnap = await this.stepEntriesCol()
                        .where('season', '==', this.dataSeason)
                        .limit(80)
                        .get();
                }
                entrySnap.docs.forEach((d) => {
                    const e = d.data();
                    if (!e || !e.id) return;
                    const st = String(e.status || 'pending').toLowerCase();
                    if (st === 'rejected') return;
                    // Keep feed aligned with day board: pending only if legal finish for that day
                    if (st !== 'approved') {
                        const goalKm = this.getDailyGoalKm(this.parseEntryDate(e.date));
                        if (!this.meetsDailyGoal(Number(e.distanceKm) || 0, goalKm)) return;
                        if (this.getDayBoardFinishSec(e, goalKm) == null) return;
                    }
                    const key = e.id;
                    if (!key || byEntry.has(key)) return;
                    byEntry.set(key, {
                        id: `derived_${key}`,
                        entryId: key,
                        userUid: e.userUid || null,
                        userId: e.userId || null,
                        userEmail: e.userEmail || null,
                        userName: e.userName || 'Teammate',
                        photoUrl: null,
                        photoDataUrl: null,
                        caption: null,
                        steps: e.steps || 0,
                        distanceKm: Number(e.distanceKm || 0),
                        caloriesBurned: Number(e.caloriesBurned || 0),
                        durationSec: e.durationSec == null ? null : Number(e.durationSec),
                        trackingMode: e.trackingMode || null,
                        date: e.date,
                        season: e.season,
                        visible: true
                    });
                });
            } catch (entryErr) {
                console.warn('stepEntries feed supplement failed:', entryErr);
            }

            let posts = Array.from(byEntry.values());
            posts.sort((a, b) => new Date(b.date) - new Date(a.date));
            posts = posts.slice(0, 50);
            this.renderActivityFeed(posts);
        } catch (err) {
            console.warn('Failed to load activity feed:', err);
            list.innerHTML = '<p class="no-feed">Could not load the team feed right now. Try Refresh.<br><small>' +
                this.escapeHtml(err.message || '') + '</small></p>';
        } finally {
            list.dataset.loading = '0';
        }
    }

    renderActivityFeed(posts) {
        const list = document.getElementById('teamFeedList');
        if (!list) return;
        if (!posts || posts.length === 0) {
            list.innerHTML = '<p class="no-feed">No team activities yet. Save a walk/run to appear here for everyone.</p>';
            return;
        }

        list.innerHTML = posts.map((post) => {
            const participant = this.findParticipantForEntry(post);
            const author = this.resolveDisplayName(
                participant && participant.name,
                post.userName,
                this.deriveDisplayNameFromEmail(post.userEmail || (participant && participant.email))
            ) || 'Teammate';
            const mode = post.trackingMode === 'treadmill' ? 'Treadmill' : 'Outdoor';
            const when = (() => {
                try { return new Date(post.date).toLocaleString(); } catch (e) { return post.date || ''; }
            })();
            const caption = post.caption ? `<p class="feed-caption">${this.escapeHtml(post.caption)}</p>` : '';
            const imgSrc = post.photoUrl || post.photoDataUrl || '';
            const safeImg = (imgSrc.startsWith('https://') || imgSrc.startsWith('data:image/'))
                ? imgSrc
                : '';
            const photo = safeImg
                ? `<div class="feed-photo-wrap"><img class="feed-photo" src="${safeImg.replace(/"/g, '&quot;')}" alt="Activity photo by ${this.escapeHtml(author)}" loading="lazy"></div>`
                : '';
            return `
                <article class="feed-post">
                    <div class="feed-post-header">
                        <strong class="feed-author">${this.escapeHtml(author)}</strong>
                        <span class="feed-meta">${this.escapeHtml(mode)} · ${this.escapeHtml(when)}</span>
                    </div>
                    ${photo}
                    ${caption}
                    <div class="feed-stats">
                        <span>${Number(post.distanceKm || 0).toFixed(2)} KM</span>
                        <span>${(post.steps || 0).toLocaleString()} steps</span>
                        <span>~${Math.round(post.caloriesBurned || 0)} kcal</span>
                        <span>${this.formatDurationClock(post.durationSec)}</span>
                    </div>
                </article>
            `;
        }).join('');
    }

    showCounterNotification(message) {
        // Create temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #003366 0%, #001a33 100%);
            color: white;
            padding: 15px 25px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0, 51, 102, 0.4);
            z-index: 1000;
            animation: slideUp 0.3s ease-out, fadeOut 0.3s ease-out 2.7s;
            font-weight: 600;
            font-size: 0.95rem;
            max-width: 90%;
            text-align: center;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Bot Protection Functions
    generateCaptcha(type = 'registration') {
        const captcha = this.generateCaptchaValue();
        const questionEl = document.getElementById(type === 'registration' ? 'captchaQuestion' : 'resetCaptchaQuestion');
        const answerEl = document.getElementById(type === 'registration' ? 'captchaAnswer' : 'resetCaptchaAnswer');
        
        if (questionEl) {
            questionEl.textContent = captcha.question;
            questionEl.dataset.answer = captcha.answer;
        }
        
        if (answerEl) {
            answerEl.value = '';
            answerEl.focus();
        }
        
        return captcha;
    }

    generateCaptchaValue() {
        // Generate simple math CAPTCHA
        const num1 = Math.floor(Math.random() * 10) + 1; // 1-10
        const num2 = Math.floor(Math.random() * 10) + 1; // 1-10
        const operations = ['+', '-', '*'];
        const operation = operations[Math.floor(Math.random() * operations.length)];
        
        let answer;
        let question;
        
        switch(operation) {
            case '+':
                answer = num1 + num2;
                question = `${num1} + ${num2} = ?`;
                break;
            case '-':
                // Ensure positive result
                const larger = Math.max(num1, num2);
                const smaller = Math.min(num1, num2);
                answer = larger - smaller;
                question = `${larger} - ${smaller} = ?`;
                break;
            case '*':
                // Use smaller numbers for multiplication
                const n1 = Math.floor(Math.random() * 5) + 1; // 1-5
                const n2 = Math.floor(Math.random() * 5) + 1; // 1-5
                answer = n1 * n2;
 question = `${n1} x ${n2} = ?`;
                break;
        }
        
        return { question, answer };
    }

    verifyCaptcha(type = 'registration') {
        const questionEl = document.getElementById(type === 'registration' ? 'captchaQuestion' : 'resetCaptchaQuestion');
        const answerEl = document.getElementById(type === 'registration' ? 'captchaAnswer' : 'resetCaptchaAnswer');
        
        if (!questionEl || !answerEl) {
            return false;
        }
        
        const correctAnswer = parseInt(questionEl.dataset.answer);
        const userAnswer = parseInt(answerEl.value);
        
        return !isNaN(userAnswer) && userAnswer === correctAnswer;
    }

    refreshResetCaptcha() {
        const modal = document.querySelector('.email-modal-overlay');
        if (modal) {
            const captcha = this.generateCaptchaValue();
            const questionEl = document.getElementById('resetCaptchaQuestion');
            const answerEl = document.getElementById('resetCaptchaAnswer');
            
            if (questionEl) {
                questionEl.textContent = captcha.question;
                modal.dataset.captchaAnswer = captcha.answer;
            }
            
            if (answerEl) {
                answerEl.value = '';
            }
        }
    }

    checkRateLimit(type) {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        
        const attempts = type === 'registration' ? this.registrationAttempts : this.passwordResetAttempts;
        
        // Filter attempts within time windows
        const attemptsLastHour = attempts.filter(attempt => attempt.timestamp > oneHourAgo);
        const attemptsLastDay = attempts.filter(attempt => attempt.timestamp > oneDayAgo);
        
        // Check limits
        if (attemptsLastHour.length >= this.maxAttemptsPerHour) {
            const nextAttemptTime = new Date(attemptsLastHour[0].timestamp + (60 * 60 * 1000));
            console.warn(`Rate limit exceeded: ${attemptsLastHour.length} attempts in the last hour`);
            return false;
        }
        
        if (attemptsLastDay.length >= this.maxAttemptsPerDay) {
            console.warn(`Rate limit exceeded: ${attemptsLastDay.length} attempts in the last day`);
            return false;
        }
        
        return true;
    }

    recordAttempt(type, success) {
        const attempts = type === 'registration' ? this.registrationAttempts : this.passwordResetAttempts;
        
        attempts.push({
            timestamp: Date.now(),
            success: success
        });
        
        // Keep only last 24 hours of attempts
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const filteredAttempts = attempts.filter(attempt => attempt.timestamp > oneDayAgo);
        
        if (type === 'registration') {
            this.registrationAttempts = filteredAttempts;
            localStorage.setItem('registrationAttempts', JSON.stringify(this.registrationAttempts));
        } else {
            this.passwordResetAttempts = filteredAttempts;
            localStorage.setItem('passwordResetAttempts', JSON.stringify(this.passwordResetAttempts));
        }
    }
}

// Initialize after a tick so iOS can paint CSS before constructor work
(function bootStepathon() {
    function start() {
        try {
            const app = new StepathonApp();
            window.app = app;
            try {
                const key = window.__WOWCSG_BOOT_KEY__ || 'wowcsg_boot_fails_v82';
                sessionStorage.setItem(key, '0');
            } catch (e0) { /* ignore */ }
            console.log('StepathonApp initialized successfully');
        } catch (error) {
            console.error('Error initializing StepathonApp:', error);
            window.app = null;
        }
    }
    const delay = window.__WOWCSG_IOS__ ? 120 : 0;
    if (delay) setTimeout(start, delay);
    else start();
})();
