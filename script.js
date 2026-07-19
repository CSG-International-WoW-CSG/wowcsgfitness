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
 dayGoalsKm: [1, 2, 3, 4, 5, 6, 7]
 };

 // Bump this to clear the visible roster (old season profiles are hidden)
 this.dataSeason = 'jul2026-v2';
 // Firestore security rules only allow these collection names
 this.participantsCollection = 'participants';
 this.stepEntriesCollection = 'stepEntries';
 this.resetLocalUserDataIfNeeded();

 this.currentUser = null;
 this.isAdmin = false;
 this.firebaseEnabled = false;
 this.auth = null;
 this.db = null;
 this.isMigratingUsers = false;
 this.initFirebase();
 this.participants = this.loadParticipants();
 
 // Initialize stepEntries - ensure it's always an array
 this.stepEntries = this.loadStepEntries();
 if (!Array.isArray(this.stepEntries)) {
 console.warn('stepEntries was not an array, initializing as empty array');
 this.stepEntries = [];
 this.saveStepEntries(); // Save empty array to localStorage
 }
 console.log('StepathonApp initialized - stepEntries count:', this.stepEntries.length);
 
 this.adminCredentials = { username: 'admin', password: 'admin123' }; // Default admin credentials
 console.log('Admin credentials initialized:', this.adminCredentials);
 
 // Bot protection: Rate limiting
 this.registrationAttempts = JSON.parse(localStorage.getItem('registrationAttempts') || '[]');
 this.passwordResetAttempts = JSON.parse(localStorage.getItem('passwordResetAttempts') || '[]');
 this.maxAttemptsPerHour = 5; // Maximum 5 attempts per hour
 this.maxAttemptsPerDay = 10; // Maximum 10 attempts per day
 
 // Step Counter + GPS map tracking
 this.stepCounter = {
 isRunning: false,
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
 lockedStepEstimateAt: null
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
 // Only run these on main page, not admin page
 // Use requestAnimationFrame for better performance
 if (!window.location.pathname.includes('admin.html')) {
 requestAnimationFrame(() => {
 // Check challenge status immediately on page load
 this.updateDates();
 this.setupActivityKeepAlive();
 
 this.checkCurrentUser();
 // Defer heavy operations
 setTimeout(() => {
 this.updateLeaderboard();
 }, 100);
 });
 }

 // Keep participant cache fresh for admin/user lists
 this.syncParticipantsFromFirebase();

 if (window.location.pathname.includes('admin.html')) {
 this.syncStepEntriesFromFirebase();
 }
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
 this.db = firebase.firestore();
 this.firebaseEnabled = true;

 // Keep session in sync
 this.auth.onAuthStateChanged((user) => {
 if (this.isMigratingUsers) {
 return;
 }
 if (user) {
 this.loadCurrentUserFromFirebase(user.uid);
 }
 });
 } catch (error) {
 console.warn('Firebase initialization failed:', error);
 this.firebaseEnabled = false;
 this.auth = null;
 this.db = null;
 }
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
 'motivationIndex'
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

 isCurrentSeasonParticipant(participant) {
 return participant && participant.season === this.dataSeason;
 }

 isCurrentSeasonEntry(entry) {
 return entry && entry.season === this.dataSeason;
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
 this.handleRegistration();
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

 const resetCounterBtn = document.getElementById('resetCounterBtn');
 if (resetCounterBtn) {
 resetCounterBtn.addEventListener('click', () => {
 this.resetStepCounter();
 });
 }

 // Button removed - no longer needed

 const saveCounterStepsBtn = document.getElementById('saveCounterStepsBtn');
 if (saveCounterStepsBtn) {
 saveCounterStepsBtn.addEventListener('click', () => {
 this.saveCounterStepsDirectly();
 });
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
 const savedSpeed = parseFloat(localStorage.getItem('treadmillSpeedKmh') || '');
 if (Number.isFinite(savedSpeed) && savedSpeed >= 1 && savedSpeed <= 25) {
 treadmillSpeedInput.value = String(savedSpeed);
 this.stepCounter.treadmillSpeedKmh = savedSpeed;
 }
 const syncSpeed = () => {
 const speed = this.getTreadmillSpeedKmh();
 this.stepCounter.treadmillSpeedKmh = speed;
 localStorage.setItem('treadmillSpeedKmh', String(speed));
 };
 treadmillSpeedInput.addEventListener('change', syncSpeed);
 treadmillSpeedInput.addEventListener('input', syncSpeed);
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
 this.updateLeaderboard(filter);
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
 const startDate = new Date(cfg.startYear, cfg.startMonth, cfg.startDay);
 startDate.setHours(0, 0, 0, 0);
 const endDate = new Date(cfg.endYear, cfg.endMonth, cfg.endDay);
 endDate.setHours(23, 59, 59, 999);
 return { startDate, endDate };
 }

 /** Challenge day number 1-7 for a given date, or 0 if outside the challenge window */
 getChallengeDayNumber(date = new Date()) {
 const { startDate, endDate } = this.getChallengeBounds();
 const d = new Date(date);
 d.setHours(0, 0, 0, 0);
 if (d < startDate || d > endDate) return 0;
 const diffMs = d.getTime() - startDate.getTime();
 const dayIndex = Math.floor(diffMs / (1000 * 60 * 60 * 24));
 return dayIndex + 1; // 1..7
 }

 getDailyGoalKm(date = new Date()) {
 const day = this.getChallengeDayNumber(date);
 if (day < 1 || day > 7) {
 // Outside window: show Day 1 goal as preview / fallback
 return this.challengeConfig.dayGoalsKm[0];
 }
 return this.challengeConfig.dayGoalsKm[day - 1];
 }

 getDailyGoalSteps(date = new Date()) {
 return this.getDailyGoalKm(date) * this.challengeConfig.stepsPerKm;
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
 const savedUser = localStorage.getItem('currentUser');
 const savedAdmin = localStorage.getItem('isAdmin');
 
 if (savedAdmin === 'true') {
 this.isAdmin = true;
 this.showAdminDashboard();
 } else if (this.firebaseEnabled && this.auth && this.auth.currentUser) {
 this.loadCurrentUserFromFirebase(this.auth.currentUser.uid).then((participant) => {
 if (participant) {
 this.showDashboard();
 }
 });
 } else if (savedUser) {
 this.currentUser = JSON.parse(savedUser);
 this.showDashboard();
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
 const username = document.getElementById('adminUsername').value.trim();
 const password = document.getElementById('adminPassword').value.trim();

 if (!username || !password) {
 alert('Please enter both username and password!');
 return;
 }

 // Check credentials
 if (username === this.adminCredentials.username && password === this.adminCredentials.password) {
 this.isAdmin = true;
 localStorage.setItem('isAdmin', 'true');
 
 // Redirect to admin page if not already there
 if (!window.location.pathname.includes('admin.html')) {
 window.location.href = 'admin.html';
 } else {
 this.showAdminDashboard();
 }
 } else {
 alert('Invalid admin credentials! Please check your username and password.');
 document.getElementById('adminPassword').focus();
 }
 }

 adminLogout() {
 this.isAdmin = false;
 localStorage.removeItem('isAdmin');
 
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
 console.log('loadStepEntries - Raw localStorage value:', saved);
 
 if (!saved || saved === 'null' || saved === 'undefined') {
 console.log('No stepEntries found in localStorage (or null/undefined)');
 return [];
 }
 
 const entries = JSON.parse(saved);
 console.log('loadStepEntries - Parsed entries:', entries);
 console.log('loadStepEntries - Is array?', Array.isArray(entries));
 console.log('loadStepEntries - Type:', typeof entries);
 
 if (!Array.isArray(entries)) {
 console.error('stepEntries is not an array! Type:', typeof entries, 'Value:', entries);
 return [];
 }
 
 console.log('Loaded stepEntries from localStorage:', entries.length, 'entries');
 return entries;
 } catch (error) {
 console.error('Error loading stepEntries from localStorage:', error);
 console.error('Error stack:', error.stack);
 return [];
 }
 }

 saveStepEntries() {
 try {
 if (!Array.isArray(this.stepEntries)) {
 console.error('Cannot save stepEntries - not an array!', typeof this.stepEntries, this.stepEntries);
 this.stepEntries = [];
 }
 const jsonString = JSON.stringify(this.stepEntries);
 const storageKey = this.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
 localStorage.setItem(storageKey, jsonString);
 console.log('Saved stepEntries to localStorage:', this.stepEntries.length, 'entries');
 console.log('Saved data size:', jsonString.length, 'characters');
 
 // Verify save
 const verify = localStorage.getItem(storageKey);
 if (verify !== jsonString) {
 console.error('Save verification failed! Data mismatch.');
 } else {
 console.log('Save verification successful');
 }
 } catch (error) {
 console.error('Error saving stepEntries to localStorage:', error);
 console.error('Error stack:', error.stack);
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

 if (!username || username.length < 3) {
 alert('Please enter a username with at least 3 characters!');
 return;
 }

 if (!password || password.length < 6) {
 alert('Please enter a password with at least 6 characters!');
 return;
 }

 if (password !== confirmPassword) {
 alert('Passwords do not match!');
 return;
 }

 if (this.firebaseEnabled) {
 const usernameLower = username.toLowerCase();
 const employeeIdLower = id.toLowerCase();

 // Check duplicates in Firebase
 const usernameTaken = await this.isFirebaseFieldTaken('usernameLower', usernameLower);
 if (usernameTaken) {
 alert('Username already exists! Please choose a different username.');
 document.getElementById('username').focus();
 return;
 }

 const employeeIdTaken = await this.isFirebaseFieldTaken('employeeIdLower', employeeIdLower);
 if (employeeIdTaken) {
 alert('This Employee ID is already registered! Please login instead or contact support if you believe this is an error.');
 document.getElementById('employeeId').focus();
 this.switchLoginTab('user-login');
 return;
 }

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

 this.currentUser = participant;
 localStorage.setItem('currentUser', JSON.stringify(participant));

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

 // Check if username already exists
 const existingUser = this.participants.find(p => p.username && p.username.toLowerCase() === username.toLowerCase());
 if (existingUser) {
 alert('Username already exists! Please choose a different username.');
 document.getElementById('username').focus();
 return;
 }

 // Check if email is already registered
 const existingEmail = this.participants.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());
 if (existingEmail) {
 alert('This email is already registered! Please login instead.');
 document.getElementById('emailId').focus();
 this.switchLoginTab('user-login');
 return;
 }

 // Check if employee ID is already registered
 const existingEmployeeId = this.participants.find(p => p.id && p.id.toLowerCase() === id.toLowerCase());
 if (existingEmployeeId) {
 alert('This Employee ID is already registered! Please login instead or contact support if you believe this is an error.');
 document.getElementById('employeeId').focus();
 this.switchLoginTab('user-login');
 return;
 }

 // Create new participant
 const participant = {
 id: id,
 name: name,
 email: email,
 username: username,
 password: this.hashPassword(password), // Store hashed password
 totalSteps: 0,
 dailySteps: {},
 streak: 0,
 lastActivity: null,
 activities: [],
 registeredAt: new Date().toISOString()
 };

 this.participants.push(participant);
 this.saveParticipantsCache();

 // Record successful registration attempt
 this.recordAttempt('registration', true);

 // Generate new CAPTCHA for next registration
 this.generateCaptcha('registration');

 // Simulate sending password email
 this.sendPasswordEmail(email, password, username);

 // Show success message
 alert(`Account created successfully!\n\nYour password has been sent to: ${email}\n\nPlease check your email and login with your username and password.`);
 
 // Clear form and switch to login
 document.getElementById('registrationForm').reset();
 this.switchLoginTab('user-login');
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

 const normalizedIdentifier = identifier.toLowerCase();

 // Find participant by username, email, or employee ID
 const participant = this.participants.find(p =>
 (p.username && p.username.toLowerCase() === normalizedIdentifier) ||
 (p.email && p.email.toLowerCase() === normalizedIdentifier) ||
 (p.emailId && p.emailId.toLowerCase() === normalizedIdentifier) ||
 (p.id && p.id.toLowerCase() === normalizedIdentifier) ||
 (p.employeeId && p.employeeId.toLowerCase() === normalizedIdentifier)
 );
 
 if (!participant) {
 alert('No account found for that username, email, or Employee ID.\n\nIf you registered in another browser or device, configure Firebase to enable cross-browser login.');
 document.getElementById('loginUsername').focus();
 return;
 }

 // Verify password
 const hashedPassword = this.hashPassword(password);
 if (participant.password !== hashedPassword) {
 alert('Invalid username or password!');
 document.getElementById('loginPassword').focus();
 return;
 }

 this.currentUser = participant;
 localStorage.setItem('currentUser', JSON.stringify(participant));

 // Clear login form
 document.getElementById('loginForm').reset();

 this.showDashboard();
 this.updateLeaderboard();
 }

 hashPassword(password) {
 // Simple hash function (for demo purposes)
 // In production, use a proper hashing library like bcrypt
 let hash = 0;
 for (let i = 0; i < password.length; i++) {
 const char = password.charCodeAt(i);
 hash = ((hash << 5) - hash) + char;
 hash = hash & hash; // Convert to 32bit integer
 }
 return hash.toString();
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
 // Try to send email automatically via EmailJS first
 const emailSent = await this.sendEmailViaEmailJS(email, username, password);
 
 // Create email content for mailto link
 const subject = encodeURIComponent('Welcome to WOW-CSG 7 Days Fitness Challenge - Your Account Details');
 const body = encodeURIComponent(`Dear Participant,

Welcome to the WOW-CSG 7 Days Fitness Challenge!

Your account has been created successfully.

Username: ${username}
Password: ${password}

Please keep this information secure and login to start tracking your steps.

Note: Each email address and Employee ID can only be registered once.

Best regards,
WOW-CSG Fitness Team`);

 // Store email details for reference
 const emailData = {
 to: email,
 subject: 'Welcome to WOW-CSG 7 Days Fitness Challenge - Your Account Details',
 body: `Dear Participant,

Welcome to the WOW-CSG 7 Days Fitness Challenge!

Your account has been created successfully.

Username: ${username}
Password: ${password}

Please keep this information secure and login to start tracking your steps.

Note: Each email address and Employee ID can only be registered once.

Best regards,
WOW-CSG Fitness Team`,
 sentAt: new Date().toISOString(),
 sentViaEmailJS: emailSent
 };

 // Store in localStorage for reference
 const sentEmails = JSON.parse(localStorage.getItem('sentEmails') || '[]');
 sentEmails.push(emailData);
 localStorage.setItem('sentEmails', JSON.stringify(sentEmails));

 // Show email modal with copy functionality and mailto link
 this.showEmailModal(email, username, password, subject, body, emailSent);
 }

 async sendEmailViaEmailJS(email, username, password) {
 // Check if EmailJS is configured
 if (typeof emailjs === 'undefined') {
 return false;
 }

 // Get EmailJS configuration from localStorage
 const emailjsServiceId = localStorage.getItem('emailjs_service_id');
 const emailjsTemplateId = localStorage.getItem('emailjs_template_id');
 const emailjsPublicKey = localStorage.getItem('emailjs_public_key');

 // If not configured, return false
 if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
 return false;
 }

 try {
 // Initialize EmailJS if not already initialized
 if (!emailjs.init) {
 emailjs.init(emailjsPublicKey);
 }

 // Prepare email template parameters
 const templateParams = {
 to_email: email,
 to_name: username,
 username: username,
 password: password,
 subject: 'Welcome to WOW-CSG 7 Days Fitness Challenge - Your Account Details',
 message: `Dear Participant,

Welcome to the WOW-CSG 7 Days Fitness Challenge!

Your account has been created successfully.

Username: ${username}
Password: ${password}

Please keep this information secure and login to start tracking your steps.

Note: Each email address and Employee ID can only be registered once.

Best regards,
WOW-CSG Fitness Team`
 };

 // Send email via EmailJS
 await emailjs.send(emailjsServiceId, emailjsTemplateId, templateParams);
 return true;
 } catch (error) {
 console.error('EmailJS Error:', error);
 return false;
 }
 }

 showEmailModal(email, username, password, subject, body, emailSent = false) {
 // Create modal overlay
 const modal = document.createElement('div');
 modal.className = 'email-modal-overlay';
 
 const emailStatus = emailSent 
 ? '<div class="email-success"><p>OK: Email sent successfully to your registered email address!</p></div>'
 : '<div class="email-warning"><p>Note: Automatic email sending is not configured. Please use the options below to receive your credentials.</p></div>';
 
 modal.innerHTML = `
 <div class="email-modal">
 <div class="email-modal-header">
 <h3>Account Details ${emailSent ? 'Sent' : 'Ready'}</h3>
 <button class="email-modal-close" onclick="this.closest('.email-modal-overlay').remove()"></button>
 </div>
 <div class="email-modal-content">
 ${emailStatus}
 <p class="email-info">Your account credentials:</p>
 <div class="email-details">
 <p><strong>To:</strong> ${email}</p>
 <p><strong>Subject:</strong> Welcome to WOW-CSG 7 Days Fitness Challenge - Your Account Details</p>
 </div>
 <div class="email-credentials">
 <div class="credential-item">
 <label>Username:</label>
 <div class="credential-value">
 <span id="copyUsername">${username}</span>
 <button class="btn-copy" onclick="app.copyToClipboard('${username}', 'Username')">Copy</button>
 </div>
 </div>
 <div class="credential-item">
 <label>Password:</label>
 <div class="credential-value">
 <span id="copyPassword">${password}</span>
 <button class="btn-copy" onclick="app.copyToClipboard('${password}', 'Password')">Copy</button>
 </div>
 </div>
 </div>
 <div class="email-actions">
 <a href="mailto:${email}?subject=${subject}&body=${body}" class="btn btn-primary" target="_blank" onclick="this.closest('.email-modal-overlay').remove()">Open Email Client
 </a>
 <button class="btn btn-secondary" onclick="app.copyEmailContent('${email}', '${username}', '${password}')">Copy All Details
 </button>
 </div>
 ${!emailSent ? `
 <div class="email-note">
 <p><strong>Note:</strong> To enable automatic email sending, please configure EmailJS settings in the admin panel or contact your administrator.</p>
 </div>
 ` : ''}
 </div>
 </div>
 `;
 document.body.appendChild(modal);
 
 // Close on overlay click
 modal.addEventListener('click', (e) => {
 if (e.target === modal) {
 modal.remove();
 }
 });
 
 // Auto-close after 5 seconds if email was sent successfully
 if (emailSent) {
 setTimeout(() => {
 if (modal.parentNode) {
 modal.remove();
 }
 }, 5000);
 }
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

 copyEmailContent(email, username, password) {
 const content = `Account Details for WOW-CSG 7 Days Fitness Challenge

Email: ${email}
Username: ${username}
Password: ${password}

Please keep this information secure.`;
 
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
 if (typeof emailjs === 'undefined') {
 alert('EmailJS SDK not loaded. Please refresh the page.');
 return;
 }

 emailjs.init(publicKey);

 const templateParams = {
 to_email: testEmail,
 to_name: 'Test User',
 username: 'testuser',
 password: 'testpass123',
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
 // Create modal overlay
 const modal = document.createElement('div');
 modal.className = 'email-modal-overlay';
 
 // Generate CAPTCHA for password reset
 const captcha = this.generateCaptchaValue();
 const useFirebaseReset = this.firebaseEnabled;
 const formHandler = useFirebaseReset ? 'app.resetPasswordFirebase()' : 'app.resetPassword()';
 const infoText = useFirebaseReset
 ? 'Enter your username, email, or Employee ID. We will email you a reset link.'
 : 'Enter your username or email to reset your password.';
 const identifierLabel = useFirebaseReset ? 'Username / Email / Employee ID' : 'Username or Email';
 const identifierPlaceholder = useFirebaseReset
 ? 'Enter username, email, or Employee ID'
 : 'Enter username or email';
 const passwordFields = useFirebaseReset ? '' : `
 <div class="form-group">
 <label for="newPassword">New Password <span class="required">*</span></label>
 <input type="password" id="newPassword" placeholder="Enter new password (min 6 characters)" required minlength="6" autocomplete="new-password">
 <small class="form-hint">Minimum 6 characters</small>
 </div>
 <div class="form-group">
 <label for="confirmNewPassword">Confirm New Password <span class="required">*</span></label>
 <input type="password" id="confirmNewPassword" placeholder="Confirm new password" required minlength="6" autocomplete="new-password">
 </div>`;

 modal.innerHTML = `
 <div class="email-modal">
 <div class="email-modal-header">
 <h3>Reset Password</h3>
 <button class="email-modal-close" onclick="this.closest('.email-modal-overlay').remove()"></button>
 </div>
 <div class="email-modal-content">
 <p class="email-info">${infoText}</p>
 <form id="resetPasswordForm" onsubmit="event.preventDefault(); ${formHandler}">
 <!-- Honeypot field -->
 <input type="text" id="resetWebsite" name="website" style="display: none;" tabindex="-1" autocomplete="off">
 
 <div class="form-group">
 <label for="resetIdentifier">${identifierLabel} <span class="required">*</span></label>
 <input type="text" id="resetIdentifier" placeholder="${identifierPlaceholder}" required autocomplete="username">
 </div>
 ${passwordFields}
 <div class="form-group captcha-group">
 <label for="resetCaptchaAnswer">Security Check <span class="required">*</span></label>
 <div class="captcha-container">
 <div class="captcha-question" id="resetCaptchaQuestion">${captcha.question}</div>
 <input type="number" id="resetCaptchaAnswer" placeholder="Enter answer" required autocomplete="off" min="0">
 <button type="button" class="btn btn-secondary btn-small" onclick="app.refreshResetCaptcha()" title="Refresh CAPTCHA">Refresh</button>
 </div>
 <small class="form-hint">Please solve the math problem to verify you're human.</small>
 </div>
 <div class="email-actions">
 <button type="submit" class="btn btn-primary">Reset Password</button>
 <button type="button" class="btn btn-secondary" onclick="this.closest('.email-modal-overlay').remove()">Cancel</button>
 </div>
 </form>
 </div>
 </div>
 `;
 document.body.appendChild(modal);
 
 // Store CAPTCHA answer in modal data
 modal.dataset.captchaAnswer = captcha.answer;
 
 // Close on overlay click
 modal.addEventListener('click', (e) => {
 if (e.target === modal) {
 modal.remove();
 }
 });

 // Focus on first input
 setTimeout(() => {
 document.getElementById('resetIdentifier').focus();
 }, 100);
 }

 async resetPasswordFirebase() {
 // Bot protection: Check honeypot field
 const honeypot = document.getElementById('resetWebsite');
 if (honeypot && honeypot.value.trim() !== '') {
 console.warn('Bot detected: Honeypot field was filled in password reset');
 alert('Bot activity detected. Password reset blocked.');
 return;
 }

 // Bot protection: Rate limiting check
 if (!this.checkRateLimit('passwordReset')) {
 this.recordAttempt('passwordReset', false); // Record failed attempt
 alert('Too many password reset attempts. Please try again later.\n\nMaximum 5 attempts per hour and 10 attempts per day.');
 return;
 }

 // Bot protection: Verify CAPTCHA
 const modal = document.querySelector('.email-modal-overlay');
 const captchaAnswer = modal ? parseInt(modal.dataset.captchaAnswer) : null;
 const userAnswer = parseInt(document.getElementById('resetCaptchaAnswer').value);
 
 if (!captchaAnswer || userAnswer !== captchaAnswer) {
 this.recordAttempt('passwordReset', false); // Record failed attempt
 alert('Security check failed. Please solve the math problem correctly.');
 this.refreshResetCaptcha();
 return;
 }

 const identifier = document.getElementById('resetIdentifier').value.trim();
 if (!identifier) {
 alert('Please enter your username, email, or Employee ID!');
 return;
 }

 let email = identifier;
 if (!this.isEmail(identifier)) {
 const participant = await this.lookupFirebaseParticipant(identifier);
 if (!participant || !participant.email) {
 alert('No account found for that username, email, or Employee ID.');
 document.getElementById('resetIdentifier').focus();
 return;
 }
 email = participant.email;
 }

 try {
 await this.auth.sendPasswordResetEmail(email);
 this.recordAttempt('passwordReset', true);
 document.querySelector('.email-modal-overlay').remove();
 this.showToast('Password reset email sent. Please check your inbox.');
 } catch (error) {
 console.error('Firebase password reset error:', error);
 alert('Unable to send reset email. Please try again.');
 }
 }

 resetPassword() {
 // Bot protection: Check honeypot field
 const honeypot = document.getElementById('resetWebsite');
 if (honeypot && honeypot.value.trim() !== '') {
 console.warn('Bot detected: Honeypot field was filled in password reset');
 alert('Bot activity detected. Password reset blocked.');
 return;
 }

 // Bot protection: Rate limiting check
 if (!this.checkRateLimit('passwordReset')) {
 this.recordAttempt('passwordReset', false); // Record failed attempt
 alert('Too many password reset attempts. Please try again later.\n\nMaximum 5 attempts per hour and 10 attempts per day.');
 return;
 }

 // Bot protection: Verify CAPTCHA
 const modal = document.querySelector('.email-modal-overlay');
 const captchaAnswer = modal ? parseInt(modal.dataset.captchaAnswer) : null;
 const userAnswer = parseInt(document.getElementById('resetCaptchaAnswer').value);
 
 if (!captchaAnswer || userAnswer !== captchaAnswer) {
 this.recordAttempt('passwordReset', false); // Record failed attempt
 alert('Security check failed. Please solve the math problem correctly.');
 this.refreshResetCaptcha();
 return;
 }

 const identifier = document.getElementById('resetIdentifier').value.trim();
 const newPassword = document.getElementById('newPassword').value;
 const confirmNewPassword = document.getElementById('confirmNewPassword').value;

 if (!identifier) {
 alert('Please enter your username or email!');
 return;
 }

 if (!newPassword || newPassword.length < 6) {
 alert('Password must be at least 6 characters long!');
 return;
 }

 if (newPassword !== confirmNewPassword) {
 alert('Passwords do not match!');
 return;
 }

 // Find participant by username or email
 const participant = this.participants.find(p => 
 (p.username && p.username.toLowerCase() === identifier.toLowerCase()) ||
 (p.email && p.email.toLowerCase() === identifier.toLowerCase())
 );

 if (!participant) {
 alert('Username or email not found! Please check and try again.');
 document.getElementById('resetIdentifier').focus();
 return;
 }

 // Update password
 const oldPassword = participant.password;
 participant.password = this.hashPassword(newPassword);
 participant.passwordResetAt = new Date().toISOString();

 // Update in participants array
 const index = this.participants.findIndex(p => 
 (p.username && p.username.toLowerCase() === identifier.toLowerCase()) ||
 (p.email && p.email.toLowerCase() === identifier.toLowerCase())
 );
 if (index !== -1) {
 this.participants[index] = participant;
 }

 // Save to localStorage
 this.saveParticipantsCache();

 // If current user is logged in and matches, update their session
 if (this.currentUser && (
 (this.currentUser.username && this.currentUser.username.toLowerCase() === identifier.toLowerCase()) ||
 (this.currentUser.email && this.currentUser.email.toLowerCase() === identifier.toLowerCase())
 )) {
 this.currentUser.password = participant.password;
 localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
 }

 // Record successful password reset attempt
 this.recordAttempt('passwordReset', true);

 // Close modal
 document.querySelector('.email-modal-overlay').remove();

 // Show success message
 this.showToast('Password reset successfully! You can now login with your new password.');
 
 // Switch to login tab if on main page
 if (!window.location.pathname.includes('admin.html')) {
 setTimeout(() => {
 this.switchLoginTab('user-login');
 document.getElementById('loginUsername').value = participant.username || '';
 document.getElementById('loginUsername').focus();
 }, 500);
 }
 }

 showDashboard() {
 document.getElementById('loginCard').style.display = 'none';
 document.getElementById('dashboardCard').style.display = 'block';
 
 // Check challenge status and disable features if challenge is over
 this.updateDates(); // This will call checkChallengeStatus
 
 this.updateDashboard();
 this.switchInputMethod('counter');
 setTimeout(() => {
 this.initActivityMap();
 // Restore in-progress activity if the phone killed/reloaded the page while locked
 this.tryRestoreActivitySession();
 }, 250);
 }

 updateDashboard() {
 if (!this.currentUser) return;

 document.getElementById('userName').textContent = this.currentUser.name;
 
 const today = new Date().toDateString();
 const todaySteps = this.currentUser.dailySteps[today] || 0;
 const totalSteps = this.currentUser.totalSteps || 0;
 
 // Always recalculate streak to ensure it's up to date
 const streak = this.calculateStreak(this.currentUser);
 this.currentUser.streak = streak; // Update the stored streak value

 // Animated number counting
 this.animateNumber('todaySteps', todaySteps);
 this.animateNumber('totalSteps', totalSteps);
 this.animateNumber('streak', streak);

 // Update progress bar with animation - progressive daily KM goal
 const goalKm = this.getDailyGoalKm();
 const goal = this.getDailyGoalSteps();
 const dayNum = this.getChallengeDayNumber();
 const progress = Math.min((todaySteps / goal) * 100, 100);
 this.animateProgressBar(progress);
 const progressBadge = document.getElementById('progressBadge');
 if (progressBadge) {
 this.animateNumber('progressBadge', Math.round(progress), '%');
 }
 const remainingEl = document.getElementById('remainingSteps');
 if (remainingEl) {
 remainingEl.textContent = Math.max(0, goal - todaySteps).toLocaleString() + ' steps';
 }
 const goalLabel = document.getElementById('dailyGoalLabel');
 if (goalLabel) {
 const dayPrefix = dayNum >= 1 && dayNum <= 7 ? `Day ${dayNum}: ` : '';
 goalLabel.textContent = `${dayPrefix}${goalKm} KM (~${goal.toLocaleString()} steps)`;
 }
 const progressTitle = document.getElementById('dailyGoalTitle');
 if (progressTitle) {
 progressTitle.textContent = dayNum >= 1 && dayNum <= 7
 ? `Day ${dayNum} Goal - ${goalKm} KM Walk/Run`
 : 'Daily Goal Progress';
 }

 const todayCalories = this.currentUser.dailyCalories && this.currentUser.dailyCalories[today]
 ? this.currentUser.dailyCalories[today]
 : 0;
 const totalCalories = this.currentUser.totalCalories || 0;
 const todayCalEl = document.getElementById('todayCaloriesLabel');
 if (todayCalEl) {
 todayCalEl.textContent = `${Math.round(todayCalories).toLocaleString()} kcal`;
 }
 const totalCalEl = document.getElementById('totalCaloriesLabel');
 if (totalCalEl) {
 totalCalEl.textContent = `${Math.round(totalCalories).toLocaleString()} kcal`;
 }

 // Update rank
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

 handleAdminLogin() {
 try {
 const usernameInput = document.getElementById('adminUsername');
 const passwordInput = document.getElementById('adminPassword');
 
 if (!usernameInput || !passwordInput) {
 alert('Error: Admin login form elements not found. Please refresh the page.');
 console.error('Admin form elements not found');
 return;
 }

 const username = usernameInput.value.trim();
 const password = passwordInput.value.trim();

 if (!username || !password) {
 alert('Please enter both username and password!');
 return;
 }

 // Debug logging
 console.log('Admin login attempt:', { username, expectedUsername: this.adminCredentials.username });
 console.log('Password check:', { passwordLength: password.length, expectedPassword: this.adminCredentials.password });

 // Check credentials
 if (username === this.adminCredentials.username && password === this.adminCredentials.password) {
 this.isAdmin = true;
 localStorage.setItem('isAdmin', 'true');
 
 console.log('Admin login successful');
 
 // Redirect to admin page if not already there
 if (!window.location.pathname.includes('admin.html')) {
 window.location.href = 'admin.html';
 } else {
 this.showAdminDashboard();
 }
 } else {
 alert('Invalid admin credentials!\n\nExpected:\nUsername: ' + this.adminCredentials.username + '\nPassword: ' + this.adminCredentials.password + '\n\nYou entered:\nUsername: ' + username + '\nPassword: ' + (password ? '***' : '(empty)'));
 passwordInput.focus();
 passwordInput.select();
 }
 } catch (error) {
 console.error('Admin login error:', error);
 alert('An error occurred during admin login. Please check the console for details.\n\nError: ' + error.message);
 }
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
 if (this.firebaseEnabled) {
 await this.syncStepEntriesFromFirebase();
 }
 // Reload entries from localStorage to ensure we have the latest data
 this.stepEntries = this.loadStepEntries();
 
 if (!Array.isArray(this.stepEntries)) {
 console.error('stepEntries is not an array!', typeof this.stepEntries, this.stepEntries);
 this.stepEntries = [];
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
 
 // Cache total steps calculation - only recalculate if participants changed
 if (!this._cachedTotalSteps || this._participantsVersion !== (this.participants?.length || 0)) {
 this._cachedTotalSteps = (this.participants || []).reduce((sum, participant) => {
 return sum + (participant.totalSteps || 0);
 }, 0);
 this._participantsVersion = this.participants?.length || 0;
 }
 const totalSteps = this._cachedTotalSteps;

 // Update stats immediately
 const pendingCountEl = document.getElementById('pendingCount');
 const approvedCountEl = document.getElementById('approvedCount');
 const rejectedCountEl = document.getElementById('rejectedCount');
 const totalStepsCountEl = document.getElementById('totalStepsCount');
 
 if (pendingCountEl) pendingCountEl.textContent = pending;
 if (approvedCountEl) approvedCountEl.textContent = approved;
 if (rejectedCountEl) rejectedCountEl.textContent = rejected;
 if (totalStepsCountEl) totalStepsCountEl.textContent = totalSteps.toLocaleString();

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

 loadUsersList() {
 const usersList = document.getElementById('usersList');
 if (!usersList) {
 console.error('usersList element not found!');
 return;
 }

 try {
 this.participants = this.loadParticipants();
 console.log('Loaded participants:', this.participants);
 console.log('Participants count:', this.participants ? this.participants.length : 0);
 
 if (!this.participants || this.participants.length === 0) {
 usersList.innerHTML = '<p class="no-entries">No users registered yet.</p>';
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

 viewUserDetails(userId) {
 // Reload participants to ensure we have the latest data
 this.participants = this.loadParticipants();
 
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
 (p.employeeId && String(p.employeeId) === String(searchId))
 );
 
 if (!user) {
 console.error('User not found. Search ID:', searchId, 'All participants:', this.participants);
 alert('User not found! Please try refreshing the users list.');
 return;
 }

 // Get all activities for this user
 this.stepEntries = this.loadStepEntries();
 const actualUserId = user.id || user.employeeId || searchId;
 const userActivities = this.stepEntries.filter(entry => {
 const entryUserId = entry.userId || entry.userId;
 return entryUserId === actualUserId || 
 entryUserId === user.id || 
 entryUserId === user.employeeId ||
 String(entryUserId) === String(actualUserId) ||
 String(entryUserId) === String(user.id) ||
 String(entryUserId) === String(user.employeeId);
 }).sort((a, b) => new Date(b.date) - new Date(a.date));
 
 console.log('User activities found:', userActivities.length, 'for user:', actualUserId);

 const modal = document.getElementById('userDetailsModal');
 const content = document.getElementById('userDetailsContent');
 
 if (!modal || !content) return;

 const totalSteps = user.totalSteps || 0;
 const dailySteps = user.dailySteps || {};
 const dailyStepsCount = Object.keys(dailySteps).length;
 const streak = this.calculateStreak(user);
 
 // Calculate activity statistics
 const totalActivitySteps = userActivities.reduce((sum, a) => sum + (a.steps || 0), 0);
 const approvedActivities = userActivities.filter(a => a.status === 'approved').length;
 const pendingActivities = userActivities.filter(a => !a.status || a.status === 'pending').length;
 const rejectedActivities = userActivities.filter(a => a.status === 'rejected').length;
 const activitiesWithScreenshots = userActivities.filter(a => a.screenshot).length;
 
 let activitiesHtml = '';
 if (userActivities.length > 0) {
 activitiesHtml = `
 <div class="user-activities-section">
 <h3> Activity Details</h3>
 
 <!-- Activity Statistics Summary -->
 <div class="activity-stats-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #003366;">${userActivities.length}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;">Total Entries</div>
 </div>
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #4caf50;">${approvedActivities}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;"> Approved</div>
 </div>
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #ff9800;">${pendingActivities}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;"> Pending</div>
 </div>
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #f44336;">${rejectedActivities}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;"> Rejected</div>
 </div>
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #2196f3;">${totalActivitySteps.toLocaleString()}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;">Total Steps</div>
 </div>
 <div class="stat-box">
 <div class="stat-value" style="font-size: 1.5rem; font-weight: bold; color: #9c27b0;">${activitiesWithScreenshots}</div>
 <div class="stat-label" style="font-size: 0.85rem; color: #666;">| With Screenshots</div>
 </div>
 </div>
 
 <div class="activities-list" style="max-height: 500px; overflow-y: auto;">
 `;
 
 userActivities.forEach((activity, index) => {
 const date = new Date(activity.date);
 const dateStr = date.toLocaleDateString();
 const timeStr = date.toLocaleTimeString();
 const status = activity.status || 'pending';
 const statusClass = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending';
 const statusIcon = status === 'approved' ? '' : status === 'rejected' ? '' : '';
 
 // Format validation date if available
 let validatedDateStr = '';
 if (activity.validatedAt) {
 try {
 validatedDateStr = new Date(activity.validatedAt).toLocaleString();
 } catch (e) {
 validatedDateStr = activity.validatedAt;
 }
 }
 
 // Format last modified date if available
 let modifiedDateStr = '';
 if (activity.lastModifiedAt) {
 try {
 modifiedDateStr = new Date(activity.lastModifiedAt).toLocaleString();
 } catch (e) {
 modifiedDateStr = activity.lastModifiedAt;
 }
 }
 
 const sourceDisplay = activity.source === 'step-counter' ? 'Step Counter' : 
 activity.source === 'manual' ? 'Manual Entry' : 
 activity.source === 'screenshot' ? 'Screenshot Upload' : 
 activity.source || 'Unknown';
 
 activitiesHtml += `
 <div class="activity-entry ${statusClass}" style="border: 2px solid ${status === 'approved' ? '#4caf50' : status === 'rejected' ? '#f44336' : '#ff9800'}; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: white;">
 <div class="activity-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
 <div>
 <span class="activity-date" style="font-weight: bold; color: #003366; font-size: 1rem;"> ${dateStr} ${timeStr}</span>
 <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
 Entry ID: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem;">${activity.id || 'N/A'}</code>
 </div>
 </div>
 <span class="activity-status ${statusClass}" style="padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 0.9rem; background: ${status === 'approved' ? '#e8f5e9' : status === 'rejected' ? '#ffebee' : '#fff3e0'}; color: ${status === 'approved' ? '#2e7d32' : status === 'rejected' ? '#c62828' : '#e65100'};">
 ${statusIcon} ${status.toUpperCase()}
 </span>
 </div>
 <div class="activity-details" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
 <div class="detail-item">
 <strong style="color: #003366;"> Steps:</strong> 
 <span style="font-size: 1.1rem; font-weight: bold; color: #2196f3;">${(activity.steps || 0).toLocaleString()}</span>
 </div>
 <div class="detail-item">
 <strong style="color: #003366;"> Source:</strong> 
 <span>${sourceDisplay}</span>
 </div>
 ${activity.userName || activity.name ? `
 <div class="detail-item">
 <strong style="color: #003366;"> User:</strong> 
 <span>${this.escapeHtml(activity.userName || activity.name)}</span>
 </div>
 ` : ''}
 ${activity.userEmail || activity.email ? `
 <div class="detail-item">
 <strong style="color: #003366;"> Email:</strong> 
 <span>${this.escapeHtml(activity.userEmail || activity.email)}</span>
 </div>
 ` : ''}
 </div>
 
 ${activity.screenshot ? `
 <div class="screenshot-section" style="margin: 12px 0; padding: 12px; background: #f8f9fa; border-radius: 6px;">
 <strong style="color: #003366; display: block; margin-bottom: 8px;">| Screenshot:</strong>
 <img src="${activity.screenshot}" 
 alt="Activity screenshot" 
 class="activity-screenshot" 
 onclick="this.style.maxWidth = this.style.maxWidth === '100%' ? '200px' : '100%'; this.style.cursor = 'pointer';"
 style="max-width: 200px; border-radius: 6px; cursor: pointer; border: 2px solid #ddd; transition: all 0.3s ease;"
 title="Click to enlarge">
 <div style="margin-top: 8px; font-size: 0.85rem; color: #666;">Click image to enlarge</div>
 </div>
 ` : `
 <div style="padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 0.9rem; color: #856404;">
 No screenshot provided
 </div>
 `}
 
 ${activity.notes ? `
 <div class="notes-section" style="margin: 12px 0; padding: 12px; background: #e3f2fd; border-radius: 6px; border-left: 4px solid #2196f3;">
 <strong style="color: #003366; display: block; margin-bottom: 6px;"> Notes:</strong>
 <div style="color: #555; white-space: pre-wrap;">${this.escapeHtml(activity.notes)}</div>
 </div>
 ` : ''}
 
 ${activity.validatedBy ? `
 <div class="validation-info" style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px; font-size: 0.9rem;">
 <strong style="color: #003366;"> Validated by:</strong> ${this.escapeHtml(activity.validatedBy)}
 ${validatedDateStr ? ` on ${validatedDateStr}` : ''}
 </div>
 ` : ''}
 
 ${activity.lastModifiedBy ? `
 <div class="modification-info" style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px; font-size: 0.9rem;">
 <strong style="color: #003366;"> Last modified by:</strong> ${this.escapeHtml(activity.lastModifiedBy)}
 ${modifiedDateStr ? ` on ${modifiedDateStr}` : ''}
 </div>
 ` : ''}
 
 <div class="activity-actions" style="display: flex; gap: 10px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
 ${status === 'pending' ? `
 <button class="btn btn-small btn-success" onclick="app.validateEntry('${activity.id}', 'approved'); app.viewUserDetails('${actualUserId}');" title="Approve this entry"> Approve</button>
 <button class="btn btn-small btn-danger" onclick="app.validateEntry('${activity.id}', 'rejected'); app.viewUserDetails('${actualUserId}');" title="Reject this entry"> Reject</button>
 ` : status === 'approved' ? `
 <button class="btn btn-small btn-danger" onclick="app.validateEntry('${activity.id}', 'rejected'); app.viewUserDetails('${actualUserId}');" title="Reject this entry"> Reject</button>
 ` : status === 'rejected' ? `
 <button class="btn btn-small btn-success" onclick="app.validateEntry('${activity.id}', 'approved'); app.viewUserDetails('${actualUserId}');" title="Approve this entry"> Approve</button>
 ` : ''}
 <button class="btn btn-small btn-secondary" onclick="app.editEntrySteps('${activity.id}'); app.viewUserDetails('${actualUserId}');" title="Edit steps for this entry"> Edit Steps</button>
 <button class="btn btn-small btn-danger" onclick="if(confirm('Are you sure you want to delete this activity?')) { app.deleteUserActivity('${activity.id}', '${actualUserId}'); }" title="Delete this activity"> Delete</button>
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
 <h3> Activity Details</h3>
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
 <label>Password <span class="required">*</span></label>
 <input type="password" id="editUserPassword" placeholder="Enter new password (leave blank to keep current)" autocomplete="new-password">
 <small class="form-hint">Password is stored as a hash. Enter a new password to change it, or leave blank to keep the current password.</small>
 <div style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 0.85rem; color: #666;">
 <strong>Current Password Hash:</strong> <code style="font-size: 0.8rem; word-break: break-all;">${user.password || 'Not set'}</code>
 </div>
 </div>
 </div>

 <div class="form-section">
 <h3> Statistics</h3>
 <div class="user-stats-grid">
 <div class="stat-item">
 <strong>Total Steps:</strong> ${totalSteps.toLocaleString()}
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
 const password = document.getElementById('editUserPassword').value.trim();

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

 // Update user
 user.name = name;
 user.email = email;
 user.emailId = email;
 user.id = employeeId;
 user.employeeId = employeeId;
 user.username = username;
 
 // Only update password if a new one was provided
 if (password && password.length > 0) {
 // Check if the password is already hashed (hashes are typically numeric strings)
 // If it looks like a hash (all digits), don't hash again. Otherwise, hash it.
 if (/^\d+$/.test(password) && password.length > 10) {
 // Likely already a hash, use as is
 user.password = password;
 } else {
 // New password, hash it
 user.password = this.hashPassword(password);
 }
 }
 // If password is empty, keep the existing password (don't update)

 // Save to localStorage
 const index = this.participants.findIndex(p => 
 (p.id && p.id === searchId) || 
 (p.employeeId && p.employeeId === searchId) ||
 (p.id && String(p.id) === String(searchId)) ||
 (p.employeeId && String(p.employeeId) === String(searchId))
 );
 if (index !== -1) {
 this.participants[index] = user;
 this.saveParticipantsCache();
 
 // If this is the current user, update currentUser
 if (this.currentUser && (this.currentUser.id === searchId || this.currentUser.employeeId === searchId)) {
 this.currentUser = user;
 }

 alert('User details updated successfully!');
 this.closeUserDetailsModal();
 this.loadUsersList();
 } else {
 alert('Error: Could not find user to update!');
 }
 }

 deleteUser(userId) {
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
 if (!this.isAdmin) {
 alert('Admin login required.');
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

 deleteUserActivity(activityId, userId) {
 if (!confirm('Are you sure you want to delete this activity entry?')) {
 return;
 }

 this.stepEntries = this.loadStepEntries();
 const activity = this.stepEntries.find(e => e.id === activityId);
 
 if (activity) {
 // Remove steps from user's total
 const user = this.participants.find(p => (p.id === userId) || (p.employeeId === userId));
 if (user) {
 const entryDate = new Date(activity.date).toDateString();
 if (user.dailySteps && user.dailySteps[entryDate]) {
 user.dailySteps[entryDate] = Math.max(0, user.dailySteps[entryDate] - activity.steps);
 if (user.dailySteps[entryDate] === 0) {
 delete user.dailySteps[entryDate];
 }
 }
 user.totalSteps = Math.max(0, (user.totalSteps || 0) - activity.steps);
 this.saveParticipantsCache();
 this.syncParticipantToFirebase(user);
 }

 // Remove entry
 this.stepEntries = this.stepEntries.filter(e => e.id !== activityId);
 this.saveStepEntries();
 this.deleteStepEntryFromFirebase(activityId);
 }

 alert('Activity deleted successfully!');
 this.viewUserDetails(userId); // Refresh the modal
 this.updateAdminDashboard();
 }

 closeUserDetailsModal() {
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
 const entryDate = entry.date || new Date().toISOString();
 const entryStatus = entry.status || 'pending';
 
 // Parse date safely
 let date;
 try {
 date = new Date(entryDate);
 if (isNaN(date.getTime())) date = new Date();
 } catch (e) {
 date = new Date();
 }
 
 const statusClass = entryStatus === 'approved' ? 'approved' : entryStatus === 'rejected' ? 'rejected' : 'pending';
 const statusIcon = entryStatus === 'approved' ? '' : entryStatus === 'rejected' ? '' : '';
 
 // Format date safely
 let formattedDate;
 try {
 formattedDate = date.toLocaleString();
 } catch (e) {
 formattedDate = entryDate;
 }
 
 // Format validated date safely
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
 
 // Format modified date safely
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
 <p class="entry-id" style="font-size: 0.8rem; color: #666;">Entry ID: ${entry.id || 'N/A'}</p>
 <p class="entry-user-id" style="font-size: 0.8rem; color: #666;">User ID: ${userId}</p>
 </div>
 <div class="entry-status ${statusClass}">
 ${statusIcon} ${entryStatus.toUpperCase()}
 </div>
 </div>
 <div class="entry-details">
 <div class="entry-steps">
 <strong>Steps:</strong> ${steps.toLocaleString()}
 </div>
 <div class="entry-screenshot">
 <strong>Screenshot:</strong>
 ${entry.screenshot ? `
 <img src="${entry.screenshot}" alt="Step screenshot" class="validation-screenshot" onclick="this.classList.toggle('expanded')" style="cursor: pointer; max-width: 200px; border-radius: 8px; margin-top: 8px;">
 ` : `
 <p class="no-screenshot">No screenshot provided (Step counter entry or manual entry without screenshot)</p>
 `}
 </div>
 ${entry.source ? `<div class="entry-source" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Source:</strong> ${entry.source === 'step-counter' ? 'Step Counter' : 'Manual Entry'}</div>` : ''}
 ${entry.validatedBy ? `<div class="entry-validator" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Validated by:</strong> ${this.escapeHtml(entry.validatedBy)}${validatedDateStr ? ` on ${validatedDateStr}` : ''}</div>` : ''}
 ${entry.lastModifiedBy ? `<div class="entry-modifier" style="margin-top: 8px; font-size: 0.9rem; color: #666;"><strong>Last modified by:</strong> ${this.escapeHtml(entry.lastModifiedBy)}${modifiedDateStr ? ` on ${modifiedDateStr}` : ''}</div>` : ''}
 ${entry.notes ? `<div class="entry-notes" style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 0.9rem;"><strong>Notes:</strong> ${this.escapeHtml(entry.notes)}</div>` : ''}
 </div>
 <div class="entry-actions">
 ${entryStatus === 'pending' ? `
 <button class="btn btn-success" onclick="app.validateEntry('${entry.id}', 'approved')">Approve</button>
 <button class="btn btn-danger" onclick="app.validateEntry('${entry.id}', 'rejected')">Reject</button>
 ` : entryStatus === 'approved' ? `
 <button class="btn btn-success" onclick="app.validateEntry('${entry.id}', 'approved')">Re-approve</button>
 <button class="btn btn-danger" onclick="app.validateEntry('${entry.id}', 'rejected')">Reject</button>
 ` : entryStatus === 'rejected' ? `
 <button class="btn btn-success" onclick="app.validateEntry('${entry.id}', 'approved')">Approve</button>
 <button class="btn btn-danger" onclick="app.validateEntry('${entry.id}', 'rejected')">Reject Again</button>
 ` : ''}
 <button class="btn btn-edit" onclick="app.editEntrySteps('${entry.id}')"> Edit Steps</button>
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

 validateEntry(entryId, status) {
 const entry = this.stepEntries.find(e => e.id === entryId);
 if (!entry) return;

 const notes = prompt(status === 'approved' ? 'Add approval notes (optional):' : 'Add rejection reason (required):');
 
 if (status === 'rejected' && !notes) {
 alert('Please provide a reason for rejection!');
 return;
 }

 const previousStatus = entry.status;
 const currentSteps = entry.steps;

 entry.status = status;
 entry.validatedBy = 'Admin';
 entry.validatedAt = new Date().toISOString();
 entry.notes = notes || null;

 // If approving, update user's steps
 if (status === 'approved') {
 const participant = this.participants.find(p => p.id === entry.userId);
 if (participant) {
 const entryDate = new Date(entry.date).toDateString();
 
 // Handle different previous statuses
 if (previousStatus === 'approved') {
 // Re-approval after edit (entry was reset to pending)
 // Steps were already removed in editEntrySteps, so just add current steps
 participant.dailySteps[entryDate] = (participant.dailySteps[entryDate] || 0) + currentSteps;
 participant.totalSteps = (participant.totalSteps || 0) + currentSteps;
 } else if (previousStatus === 'rejected') {
 // Approving a previously rejected entry - add the steps
 participant.dailySteps[entryDate] = (participant.dailySteps[entryDate] || 0) + currentSteps;
 participant.totalSteps = (participant.totalSteps || 0) + currentSteps;
 } else {
 // First time approval (pending) - just add the steps
 participant.dailySteps[entryDate] = (participant.dailySteps[entryDate] || 0) + currentSteps;
 participant.totalSteps = (participant.totalSteps || 0) + currentSteps;
 }
 
 // Update activity message
 const activity = participant.activities.find(a => a.entryId === entryId);
 if (activity) {
 if (previousStatus === 'approved') {
 activity.message = `Steps re-approved: ${currentSteps.toLocaleString()} steps (Approved)`;
 } else if (previousStatus === 'rejected') {
 activity.message = `Steps approved after rejection: ${currentSteps.toLocaleString()} steps (Approved)`;
 } else {
 activity.message = `Added ${currentSteps.toLocaleString()} steps (Approved)`;
 }
 }

 this.saveParticipantsCache();
 }
 } else if (status === 'rejected') {
 // If rejecting a previously approved entry, subtract the steps
 if (previousStatus === 'approved') {
 const participant = this.participants.find(p => p.id === entry.userId);
 if (participant) {
 const entryDate = new Date(entry.date).toDateString();
 participant.dailySteps[entryDate] = Math.max(0, (participant.dailySteps[entryDate] || 0) - currentSteps);
 participant.totalSteps = Math.max(0, (participant.totalSteps || 0) - currentSteps);
 
 // Update activity message
 const activity = participant.activities.find(a => a.entryId === entryId);
 if (activity) {
 activity.message = `Added ${currentSteps.toLocaleString()} steps (Rejected)`;
 }

 this.saveParticipantsCache();
 }
 }
 // If rejecting a previously rejected entry, no change needed (steps were never added)
 }

 this.saveStepEntries();
 this.upsertStepEntryInFirebase(entry);
 if (this.firebaseEnabled) {
 const participant = this.participants.find(p => p.id === entry.userId || p.employeeId === entry.userId);
 if (participant) {
 this.syncParticipantToFirebase(participant);
 }
 }
 this.updateAdminDashboard();
 this.updateLeaderboard();
 
 if (status === 'approved' && previousStatus === 'approved') {
 alert(`Entry re-approved successfully!\n\nSteps: ${currentSteps.toLocaleString()}\n\nLeaderboard has been updated.`);
 } else if (status === 'approved' && previousStatus === 'rejected') {
 alert(`Rejected entry approved successfully!\n\nSteps: ${currentSteps.toLocaleString()}\n\nLeaderboard has been updated.`);
 } else {
 alert(`Entry ${status} successfully!`);
 }
 }

 editEntrySteps(entryId) {
 const entry = this.stepEntries.find(e => e.id === entryId);
 if (!entry) return;

 const currentSteps = entry.steps;
 const newStepsStr = prompt(`Edit step count for this entry:\n\nCurrent steps: ${currentSteps.toLocaleString()}\n\nEnter new step count:`, currentSteps);
 
 if (newStepsStr === null) return; // User cancelled

 const newSteps = parseInt(newStepsStr);
 if (isNaN(newSteps) || newSteps < 0) {
 alert('Please enter a valid number of steps (0 or greater)!');
 return;
 }

 if (newSteps === currentSteps) {
 alert('Step count unchanged.');
 return;
 }

 const previousStatus = entry.status;
 const previousSteps = entry.steps;
 entry.steps = newSteps;
 entry.lastModifiedBy = 'Admin';
 entry.lastModifiedAt = new Date().toISOString();

 // If entry was previously approved, remove the old steps from user totals
 if (previousStatus === 'approved') {
 const participant = this.participants.find(p => p.id === entry.userId);
 if (participant) {
 const entryDate = new Date(entry.date).toDateString();
 
 // Subtract old steps
 participant.dailySteps[entryDate] = Math.max(0, (participant.dailySteps[entryDate] || 0) - previousSteps);
 participant.totalSteps = Math.max(0, (participant.totalSteps || 0) - previousSteps);
 
 // Update activity message
 const activity = participant.activities.find(a => a.entryId === entryId);
 if (activity) {
 activity.message = `Steps updated: ${previousSteps.toLocaleString()} -> ${newSteps.toLocaleString()} (Pending re-approval)`;
 }

 this.saveParticipantsCache();
 }
 
 // Reset status to pending so admin can re-approve
 entry.status = 'pending';
 entry.validatedBy = null;
 entry.validatedAt = null;
 entry.notes = null;
 }

 this.saveStepEntries();
 this.upsertStepEntryInFirebase(entry);
 if (this.firebaseEnabled) {
 const participant = this.participants.find(p => p.id === entry.userId || p.employeeId === entry.userId);
 if (participant) {
 this.syncParticipantToFirebase(participant);
 }
 }
 this.updateAdminDashboard();
 this.updateLeaderboard();
 
 alert(`Step count updated successfully!\n\nPrevious: ${previousSteps.toLocaleString()}\nNew: ${newSteps.toLocaleString()}\nDifference: ${(newSteps - previousSteps).toLocaleString()}\n\nEntry status reset to PENDING. Please approve the entry to apply the changes to the leaderboard.`);
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
 const sorted = [...this.participants].sort((a, b) => 
 (b.totalSteps || 0) - (a.totalSteps || 0)
 );
 return sorted.findIndex(p => p.name === user.name) + 1;
 }

 getChallengeDayDate(dayNum) {
 const { startDate } = this.getChallengeBounds();
 const d = new Date(startDate);
 d.setDate(d.getDate() + (dayNum - 1));
 d.setHours(0, 0, 0, 0);
 return d;
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

 /**
 * Build per-day leaderboard rows: completed finishers first (shortest time),
 * then in-progress by distance.
 */
 getDayLeaderboardRows(dayNum) {
 const goalKm = this.challengeConfig.dayGoalsKm[dayNum - 1] || dayNum;
 const goalSteps = goalKm * (this.challengeConfig.stepsPerKm || 1300);
 const dayDate = this.getChallengeDayDate(dayNum);
 const dateKey = dayDate.toDateString();

 return this.participants
 .map((p) => {
 const stats = p.dailyStats && p.dailyStats[dateKey] ? p.dailyStats[dateKey] : null;
 const steps = stats && typeof stats.steps === 'number'
 ? stats.steps
 : (p.dailySteps && p.dailySteps[dateKey]) || 0;
 const distanceKm = stats && typeof stats.distanceKm === 'number'
 ? stats.distanceKm
 : (p.dailyDistanceKm && p.dailyDistanceKm[dateKey])
 || (steps / (this.challengeConfig.stepsPerKm || 1300));
 const completed = stats && typeof stats.completed === 'boolean'
 ? stats.completed
 : (distanceKm >= goalKm - 0.01 || steps >= goalSteps);
 let durationSec = null;
 if (stats) {
 if (stats.completed && stats.completionDurationSec != null) {
 durationSec = stats.completionDurationSec;
 } else if (stats.durationSec != null) {
 durationSec = stats.durationSec;
 }
 }
 return {
 name: p.name,
 department: p.department,
 steps,
 distanceKm: Number(distanceKm) || 0,
 completed: !!completed,
 durationSec,
 goalKm,
 dateKey
 };
 })
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
 el.textContent = `Day ${dayNum} (${dateLabel}) - ${goalKm} KM - shortest finish time wins`;
 } else {
 el.textContent = '';
 }
 }

 updateLeaderboard(filter) {
 if (!filter) {
 const active = document.querySelector('.filter-btn.active, .day-filter-btn.active');
 filter = (active && active.dataset.filter) || 'total';
 }
 const list = document.getElementById('leaderboardList');
 if (!list) return; // Element doesn't exist on admin page
 list.innerHTML = '';
 this.updateLeaderboardSubtitle(filter);

 let sorted = [];
 const dayMatch = String(filter).match(/^day-(\d+)$/);

 if (dayMatch) {
 const dayNum = parseInt(dayMatch[1], 10);
 sorted = this.getDayLeaderboardRows(dayNum);
 if (sorted.length === 0) {
 list.innerHTML = `<div class="leaderboard-item"><div class="rank">-</div><div class="name">No activity for Day ${dayNum} yet</div><div class="steps">Be the first!</div></div>`;
 return;
 }

 sorted.forEach((participant, index) => {
 const item = document.createElement('div');
 item.className = 'leaderboard-item' + (participant.completed && index === 0 ? ' is-day-winner' : '');
 const status = participant.completed
 ? `Finished - ${this.formatDurationClock(participant.durationSec)}`
 : `${participant.distanceKm.toFixed(2)} KM - in progress`;
 const detail = participant.completed
 ? `${participant.goalKm} KM goal`
 : `${Math.min(100, Math.round((participant.distanceKm / participant.goalKm) * 100))}% of ${participant.goalKm} KM`;
 item.innerHTML = `
 <div class="rank">${index + 1}</div>
 <div class="name">${participant.name}${participant.department ? ` (${participant.department})` : ''}${participant.completed && index === 0 ? ' <span class="day-winner-tag">Winner</span>' : ''}<div class="lb-detail">${detail}</div></div>
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
 todaySteps: p.dailySteps[today] || 0
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

 if (sorted.length === 0) {
 list.innerHTML = '<div class="leaderboard-item"><div class="rank">-</div><div class="name">No participants yet</div><div class="steps">0 steps</div></div>';
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
 <div class="name">${participant.name} ${participant.department ? `(${participant.department})` : ''}</div>
 <div class="steps">${stepsDisplay}</div>
 `;

 list.appendChild(item);
 });
 }

 updateActivities() {
 const list = document.getElementById('activityList');
 list.innerHTML = '';

 if (!this.currentUser.activities || this.currentUser.activities.length === 0) {
 list.innerHTML = '<p class="no-activity">No activity yet. Start walking! -</p>';
 return;
 }

 this.currentUser.activities.slice(0, 10).forEach(activity => {
 const item = document.createElement('div');
 item.className = 'activity-item';
 
 const date = new Date(activity.date);
 const timeStr = date.toLocaleString('en-US', {
 month: 'short',
 day: 'numeric',
 hour: '2-digit',
 minute: '2-digit'
 });

 item.innerHTML = `
 <div>${activity.message}</div>
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
 document.getElementById('loginForm').reset();
 }

 async handleFirebaseLogin(identifier, password) {
 try {
 let email = identifier;
 let participant = null;

 if (!this.isEmail(identifier)) {
 participant = await this.lookupFirebaseParticipant(identifier);
 if (!participant || !participant.email) {
 // Fall back: allow email login path only when identifier is email
 alert('No account found for that username, email, or Employee ID.\n\nIf your challenge data was reset, login with your email address.');
 document.getElementById('loginUsername').focus();
 return;
 }
 email = participant.email;
 }

 const credential = await this.auth.signInWithEmailAndPassword(email, password);
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

 this.currentUser = profile;
 localStorage.setItem('currentUser', JSON.stringify(profile));

 document.getElementById('loginForm').reset();
 this.showDashboard();
 this.updateLeaderboard();
 } catch (error) {
 if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
 alert('Invalid username or password!');
 document.getElementById('loginPassword').focus();
 } else if (error.code === 'auth/user-not-found') {
 alert('No account found for that username, email, or Employee ID.');
 document.getElementById('loginUsername').focus();
 } else {
 console.error('Firebase login error:', error);
 alert('Login failed. Please try again.');
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
 const emailLower = (email || authUser.email || '').toLowerCase();
 if (emailLower) {
 const snap = await this.participantsCol().where('emailLower', '==', emailLower).limit(5).get();
 if (!snap.empty) {
 prior = snap.docs[0].data();
 }
 }
 } catch (error) {
 console.warn('Could not look up prior email profile:', error);
 }
 }

 const safeId = (prior && (prior.id || prior.employeeId)) || (`USER_${Date.now()}`);
 const usernameBase = (prior && prior.username) || (email || 'user').split('@')[0];
 const participant = {
 uid,
 id: String(safeId),
 employeeId: String(safeId),
 name: (prior && prior.name) || (authUser.displayName) || 'Challenge Participant',
 email: email || authUser.email || (prior && prior.email) || '',
 emailLower: (email || authUser.email || (prior && prior.email) || '').toLowerCase(),
 username: usernameBase,
 usernameLower: String(usernameBase).toLowerCase(),
 employeeIdLower: String(safeId).toLowerCase(),
 totalSteps: 0,
 dailySteps: {},
 streak: 0,
 lastActivity: null,
 activities: [],
 registeredAt: new Date().toISOString(),
 season: this.dataSeason
 };

 await this.participantsCol().doc(uid).set(participant);
 this.participants = this.filterCurrentSeasonParticipants(
 this.participants.filter((p) => p.uid !== uid).concat([participant])
 );
 this.saveParticipantsCache();
 return participant;
 }

 async lookupFirebaseParticipant(identifier) {
 if (!this.firebaseEnabled || !this.db) {
 return null;
 }

 const normalizedIdentifier = identifier.toLowerCase();
 const collection = this.participantsCol();

 const pickCurrent = (snap) => {
 const match = snap.docs.map((d) => d.data()).find((p) => this.isCurrentSeasonParticipant(p));
 return match || null;
 };

 const usernameSnap = await collection.where('usernameLower', '==', normalizedIdentifier).limit(25).get();
 const byUsername = pickCurrent(usernameSnap);
 if (byUsername) return byUsername;

 const employeeIdSnap = await collection.where('employeeIdLower', '==', normalizedIdentifier).limit(25).get();
 const byEmployee = pickCurrent(employeeIdSnap);
 if (byEmployee) return byEmployee;

 const emailSnap = await collection.where('emailLower', '==', normalizedIdentifier).limit(25).get();
 const byEmail = pickCurrent(emailSnap);
 if (byEmail) return byEmail;

 return null;
 }

 async isFirebaseFieldTaken(fieldName, value) {
 if (!this.firebaseEnabled || !this.db) {
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
 // Fallback if composite index is missing: scan season-filtered cache/docs
 console.warn('Season field query failed, falling back:', error.message || error);
 const snap = await this.participantsCol().where(fieldName, '==', value).limit(25).get();
 return snap.docs.some((docSnap) => docSnap.data().season === this.dataSeason);
 }
 }

 async loadCurrentUserFromFirebase(uid) {
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
 this.currentUser = participant;
 localStorage.setItem('currentUser', JSON.stringify(participant));
 return participant;
 } catch (error) {
 console.error('Failed to load user profile from Firebase:', error);
 return null;
 }
 }

 async syncParticipantsFromFirebase() {
 if (!this.firebaseEnabled || !this.db) {
 return;
 }
 try {
 const snapshot = await this.participantsCol().get();
 this.participants = this.filterCurrentSeasonParticipants(snapshot.docs.map(doc => doc.data()));
 this.saveParticipantsCache();
 if (!window.location.pathname.includes('admin.html')) {
 this.updateLeaderboard();
 }
 } catch (error) {
 console.warn('Failed to sync participants from Firebase:', error);
 }
 }

 async syncStepEntriesFromFirebase() {
 if (!this.firebaseEnabled || !this.db) {
 return;
 }
 try {
 const snapshot = await this.stepEntriesCol().get();
 this.stepEntries = this.filterCurrentSeasonEntries(snapshot.docs.map(doc => doc.data()));
 this.saveStepEntries();
 } catch (error) {
 console.warn('Failed to sync step entries from Firebase:', error);
 }
 }

 async upsertStepEntryInFirebase(entry) {
 if (!this.firebaseEnabled || !this.db || !entry || !entry.id) {
 return;
 }
 try {
 await this.stepEntriesCol().doc(entry.id).set(entry, { merge: true });
 } catch (error) {
 console.warn('Failed to upsert step entry in Firebase:', error);
 }
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
 localStorage.setItem(storageKey, JSON.stringify(this.participants));
 }

 loadParticipants() {
 const storageKey = this.firebaseEnabled ? 'participants_cache' : 'participants';
 const saved = localStorage.getItem(storageKey);
 return saved ? JSON.parse(saved) : [];
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
 this.stepCounter.treadmillSpeedKmh = this.getTreadmillSpeedKmh();

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

 this.bindMotionListener();
 this.applyRunningActivityUi();

 if (mode === 'treadmill') {
 this.updateCounterStatus('Treadmill mode — distance from speed x time + step backup.');
 this.updateCounterHint('Match treadmill speed on the display. Keep the phone on your body for step backup.');
 this.showCounterNotification('Treadmill tracking started. Set speed to match your machine.');
 } else {
 this.updateCounterStatus('Tracking your route — works with screen off when possible.');
 this.updateCounterHint('Keep the app open (Home Screen recommended). Tracking continues while locked when the OS allows.');
 this.showCounterNotification('Activity started. Tracking continues while the phone is locked.');
 }

 this.startTimer(false);
 this.setupActivityKeepAlive();
 this.setupServiceWorkerTrackingBridge();
 this.notifyServiceWorkerTracking(true);
 this.requestWakeLock();
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 this.startKeepAwakeFallback();

 if (mode === 'outdoor') {
 this.initActivityMap();
 this.startGpsTracking();
 this.startBackgroundGpsPoll();
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

 getTrackingMode() {
 const active = document.querySelector('.mode-btn.active');
 if (active && active.dataset.mode) return active.dataset.mode;
 return this.stepCounter.trackingMode || 'outdoor';
 }

 getTreadmillSpeedKmh() {
 const input = document.getElementById('treadmillSpeedKmh');
 const fromInput = input ? parseFloat(input.value) : NaN;
 if (Number.isFinite(fromInput) && fromInput >= 1 && fromInput <= 25) {
 return fromInput;
 }
 const stored = parseFloat(localStorage.getItem('treadmillSpeedKmh') || '');
 if (Number.isFinite(stored) && stored >= 1 && stored <= 25) return stored;
 return this.stepCounter.treadmillSpeedKmh || 5;
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
 distLabel.textContent = mode === 'treadmill' ? 'Treadmill distance' : 'GPS distance';
 }
 if (modeRow) {
 modeRow.classList.toggle('is-locked', !!this.stepCounter.isRunning);
 }
 }

 accumulateTreadmillDistance() {
 if (!this.stepCounter.isRunning || this.stepCounter.trackingMode !== 'treadmill') return;
 const now = Date.now();
 const last = this.stepCounter.lastTreadmillTickAt || now;
 const dtSec = Math.max(0, (now - last) / 1000);
 this.stepCounter.lastTreadmillTickAt = now;
 if (dtSec <= 0 || dtSec > 30) return; // ignore huge gaps after deep sleep (catch-up below)
 const speed = this.getTreadmillSpeedKmh();
 this.stepCounter.treadmillSpeedKmh = speed;
 this.stepCounter.treadmillDistanceKm += (speed / 3600) * dtSec;
 }

 /** After unlock in treadmill mode, credit missed time at current speed (capped) */
 catchUpTreadmillAfterUnlock() {
 if (!this.stepCounter.isRunning || this.stepCounter.trackingMode !== 'treadmill') return;
 const now = Date.now();
 const last = this.stepCounter.lastTreadmillTickAt || this.stepCounter.startTime || now;
 const dtSec = Math.max(0, (now - last) / 1000);
 // Cap catch-up at 2 hours to avoid absurd values if session was abandoned
 const creditSec = Math.min(dtSec, 2 * 3600);
 if (creditSec < 2) {
 this.stepCounter.lastTreadmillTickAt = now;
 return;
 }
 const speed = this.getTreadmillSpeedKmh();
 this.stepCounter.treadmillDistanceKm += (speed / 3600) * creditSec;
 this.stepCounter.lastTreadmillTickAt = now;
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 }

 bindMotionListener() {
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
 const saveBtn = document.getElementById('saveCounterStepsBtn');
 const timerEl = document.getElementById('counterTimer');
 const pulseEl = document.getElementById('counterPulse');
 const valueEl = document.getElementById('liveKmCount');

 if (startBtn) startBtn.style.display = 'none';
 if (stopBtn) stopBtn.style.display = 'inline-block';
 if (saveBtn) saveBtn.style.display = 'none';
 if (timerEl) timerEl.style.display = 'flex';
 if (pulseEl) pulseEl.classList.add('active');
 if (valueEl) valueEl.classList.add('active');
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
 if (!this.stepCounter.isRunning) return;
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
 isRunning: true,
 userKey,
 startTime: this.stepCounter.startTime,
 stepCount: this.stepCounter.stepCount || 0,
 distanceKm: this.stepCounter.distanceKm || 0,
 pendingSegmentKm: this.stepCounter.pendingSegmentKm || 0,
 treadmillDistanceKm: this.stepCounter.treadmillDistanceKm || 0,
 treadmillSpeedKmh: this.stepCounter.treadmillSpeedKmh || this.getTreadmillSpeedKmh(),
 trackingMode: this.stepCounter.trackingMode || 'outdoor',
 lastTreadmillTickAt: this.stepCounter.lastTreadmillTickAt || null,
 path,
 lastPosition: this.stepCounter.lastPosition || null,
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
 if (!data || !data.isRunning || !data.startTime) return null;
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

 this.stepCounter.isRunning = true;
 this.stepCounter.startTime = data.startTime;
 this.stepCounter.stepCount = data.stepCount || 0;
 this.stepCounter.distanceKm = Number(data.distanceKm) || 0;
 this.stepCounter.treadmillDistanceKm = Number(data.treadmillDistanceKm) || 0;
 this.stepCounter.treadmillSpeedKmh = Number(data.treadmillSpeedKmh) || this.getTreadmillSpeedKmh();
 this.stepCounter.trackingMode = data.trackingMode === 'treadmill' ? 'treadmill' : 'outdoor';
 this.stepCounter.lastTreadmillTickAt = data.lastTreadmillTickAt || data.savedAt || Date.now();
 this.stepCounter.path = Array.isArray(data.path) ? data.path : [];
 this.stepCounter.lastPosition = data.lastPosition || null;
 this.stepCounter.stepHistory = [];
 this.stepCounter.accelerationHistory = [];
 this.stepCounter.lastAcceleration = { x: 0, y: 0, z: 0 };
 this.stepCounter.gpsReady = (this.stepCounter.path || []).length > 0;

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

 this.bindMotionListener();
 this.applyRunningActivityUi();
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

 this.ensureActivityRuntimeAlive('Activity restored after unlock — tracking continued.');
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
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 this.startKeepAwakeFallback();
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.startGpsTracking();
 this.startBackgroundGpsPoll();
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

 this.stepCounter.isRunning = false;
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
 this.clearActivitySession();

 const startBtn = document.getElementById('startCounterBtn');
 const stopBtn = document.getElementById('stopCounterBtn');
 const saveBtn = document.getElementById('saveCounterStepsBtn');
 const pulseEl = document.getElementById('counterPulse');
 const valueEl = document.getElementById('liveKmCount');
 
 if (startBtn) startBtn.style.display = 'inline-block';
 if (stopBtn) stopBtn.style.display = 'none';
 if (pulseEl) pulseEl.classList.remove('active');
 if (valueEl) valueEl.classList.remove('active');
 
 const distance = this.getTrackedDistanceKm();
 if (distance > 0 || this.stepCounter.stepCount > 0) {
 if (saveBtn) saveBtn.style.display = 'block';
 }

 const duration = Math.round((Date.now() - this.stepCounter.startTime) / 1000);
 const minutes = Math.floor(duration / 60);
 const seconds = duration % 60;
 const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
 
 this.updateCounterStatus(`Stopped. Covered ${distance.toFixed(2)} KM in ${timeStr}.`);
 this.updateCounterHint('Save to update your challenge progress and leaderboard.');
 this.showCounterNotification(`Activity stopped: ${distance.toFixed(2)} KM`);
 this.updateStepCounterDisplay();
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
 this.clearActivitySession();
 this.clearActivityMapTrack();
 this.updateStepCounterDisplay();
 this.updateCounterStatus('Reset. Ready to track your next walk/run.');
 this.updateCounterHint('Start Activity to begin GPS map tracking.');
 
 const startBtn = document.getElementById('startCounterBtn');
 const stopBtn = document.getElementById('stopCounterBtn');
 const saveBtn = document.getElementById('saveCounterStepsBtn');
 const timerEl = document.getElementById('counterTimer');
 
 if (startBtn) startBtn.style.display = 'inline-block';
 if (stopBtn) stopBtn.style.display = 'none';
 if (saveBtn) saveBtn.style.display = 'none';
 if (timerEl) timerEl.style.display = 'none';
 
 const timerValue = document.getElementById('timerValue');
 if (timerValue) timerValue.textContent = '00:00';
 this.stopTimer();
 }

 getTrackedDistanceKm() {
 const mode = this.stepCounter.trackingMode || 'outdoor';
 const stepKm = (this.stepCounter.stepCount || 0) / (this.challengeConfig.stepsPerKm || 1300);

 if (mode === 'treadmill') {
 const speedKm = this.stepCounter.treadmillDistanceKm || 0;
 return Math.max(speedKm, stepKm);
 }

 const gpsKm = (this.stepCounter.distanceKm || 0) + (this.stepCounter.pendingSegmentKm || 0);
 // Use the better of GPS and step estimate so neither under-count wins alone
 return Math.max(gpsKm, stepKm);
 }

 /**
 * Keep step count in sync with distance when DeviceMotion is paused (phone locked).
 * Mobile browsers almost always stop accelerometer events while the screen is off.
 */
 syncStepsFromDistance(force = false) {
 if (!this.stepCounter.isRunning) return;
 const isHidden = document.visibilityState !== 'visible';
 if (!force && !isHidden) return;

 const dist = this.getTrackedDistanceKm();
 if (dist <= 0) return;
 const estimated = Math.round(dist * (this.challengeConfig.stepsPerKm || 1300));
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
 this.stepCounter.distanceKm = 0;
 return 0;
 }
 let total = 0;
 for (let i = 1; i < path.length; i++) {
 const a = path[i - 1];
 const b = path[i];
 const segmentKm = this.haversineKm(a.lat, a.lng, b.lat, b.lng);
 const dtSec = Math.max(1, ((b.t || 0) - (a.t || 0)) / 1000);
 const maxKm = Math.min(5.0, Math.max(0.35, (dtSec / 3600) * 22));
 // Drop only teleport/noise jumps
 if (segmentKm > 0 && segmentKm <= maxKm) {
 total += segmentKm;
 }
 }
 this.stepCounter.distanceKm = total;
 this.stepCounter.pendingSegmentKm = 0;
 return total;
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

 initActivityMap() {
 const mapEl = document.getElementById('activityMap');
 if (!mapEl || typeof L === 'undefined') {
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
 if (!navigator.geolocation) {
 this.updateCounterStatus('GPS not available on this device. Step estimate will be used.');
 const hint = document.getElementById('mapHint');
 if (hint) hint.textContent = 'GPS unavailable — distance will use step estimate.';
 return;
 }

 // Restart cleanly (browsers often kill watches when the phone locks)
 this.stopGpsTracking();

 const options = {
 enableHighAccuracy: true,
 maximumAge: 0,
 timeout: 20000
 };

 this.stepCounter.watchId = navigator.geolocation.watchPosition(
 (pos) => this.handleGpsPosition(pos),
 (err) => {
 console.warn('GPS error:', err);
 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = 'Location permission needed for map tracking. You can still use step estimate.';
 }
 this.updateCounterHint('Enable location for accurate KM tracking on the map.');
 },
 options
 );
 }

 stopGpsTracking() {
 if (this.stepCounter.watchId != null && navigator.geolocation) {
 navigator.geolocation.clearWatch(this.stepCounter.watchId);
 }
 this.stepCounter.watchId = null;
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
 this.startBackgroundGpsPoll();
 this.startGpsTracking();
 this.notifyServiceWorkerTracking(true);
 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = 'Lock-screen tracking ON. Keep the site open in background — do not force-close the app.';
 }
 return;
 }

 // Visible again after unlock — reinstate timers/GPS + catch up missed distance
 this.ensureActivityRuntimeAlive('Tracking active again after unlock.');
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.catchUpGpsAfterUnlock();
 } else {
 this.catchUpTreadmillAfterUnlock();
 }
 }

 startBackgroundGpsPoll() {
 this.stopBackgroundGpsPoll();
 if (!navigator.geolocation) return;
 // Poll frequently while locked — browsers throttle timers, so keep interval short
 this.bgGpsPollId = setInterval(() => {
 this.pollGpsOnce(document.visibilityState !== 'visible');
 }, 2000);
 }

 pollGpsOnce(fromBackground = false) {
 if (!this.stepCounter.isRunning || !navigator.geolocation) return;
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
 if (!this.stepCounter.isRunning) return;
 this.recalculateGpsDistanceFromPath();
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 if (!navigator.geolocation) return;
 // Multiple samples help fill gap after OS paused GPS
 const sample = () => {
 navigator.geolocation.getCurrentPosition(
 (pos) => {
 this.handleGpsPosition(pos, true);
 this.syncStepsFromDistance(true);
 },
 () => {},
 { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
 );
 };
 sample();
 setTimeout(sample, 1200);
 setTimeout(sample, 3000);
 setTimeout(() => {
 this.recalculateGpsDistanceFromPath();
 this.syncStepsFromDistance(true);
 this.updateStepCounterDisplay();
 this.persistActivitySession(true);
 }, 4500);
 }

 stopBackgroundGpsPoll() {
 if (this.bgGpsPollId) {
 clearInterval(this.bgGpsPollId);
 this.bgGpsPollId = null;
 }
 }

 startWakeLockWatchdog() {
 this.stopWakeLockWatchdog();
 this.wakeLockWatchdogId = setInterval(() => {
 if (!this.stepCounter.isRunning) return;
 this.startSilentAudioKeepAlive();
 this.startHtmlAudioKeepAlive();
 this.startKeepAwakeFallback();
 if (this.stepCounter.trackingMode === 'outdoor') {
 this.pollGpsOnce(document.visibilityState !== 'visible');
 } else {
 this.accumulateTreadmillDistance();
 this.updateStepCounterDisplay();
 }
 this.persistActivitySession(false);
 if (document.visibilityState === 'visible') {
 this.requestWakeLock();
 }
 }, 8000);
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
 this.pollGpsOnce(document.visibilityState !== 'visible');
 this.persistActivitySession(false);
 this.startHtmlAudioKeepAlive();
 this.startSilentAudioKeepAlive();
 if (this.stepCounter.trackingMode === 'treadmill') {
 this.accumulateTreadmillDistance();
 this.updateStepCounterDisplay();
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
 this.startSilentAudioKeepAlive();
 this.startBackgroundGpsPoll();
 if (document.visibilityState === 'visible') {
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
 this.startSilentAudioKeepAlive();
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
 // Accept noisier fixes while locked — otherwise KM freezes outdoors
 const maxAccuracy = isBackground ? 180 : 100;
 if (accuracy && accuracy > maxAccuracy) {
 return;
 }

 const point = { lat: latitude, lng: longitude, t: Date.now(), accuracy: accuracy || null };
 const last = this.stepCounter.lastPosition;
 if (last) {
 const segmentKm = this.haversineKm(last.lat, last.lng, point.lat, point.lng);
 const dtSec = Math.max(0.5, (point.t - (last.t || point.t)) / 1000);
 const hours = dtSec / 3600;
 // Allow realistic walking/running; wider catch-up after lock
 const maxKm = isBackground
 ? Math.min(12.0, Math.max(0.5, hours * 16))
 : Math.min(4.0, Math.max(0.35, hours * 20));

 if (segmentKm > maxKm) {
 // Teleport / bad fix — skip point entirely (keep previous lastPosition)
 return;
 }

 // Bank tiny segments instead of discarding them (previous bug under-counted KM)
 this.stepCounter.pendingSegmentKm = (this.stepCounter.pendingSegmentKm || 0) + segmentKm;
 if (this.stepCounter.pendingSegmentKm >= 0.002 || isBackground) {
 this.stepCounter.distanceKm += this.stepCounter.pendingSegmentKm;
 this.stepCounter.pendingSegmentKm = 0;
 }
 }

 this.stepCounter.lastPosition = point;
 this.stepCounter.path.push(point);
 if (this.stepCounter.path.length > 500) {
 this.stepCounter.path = this.stepCounter.path.filter((_, idx, arr) => idx === 0 || idx === arr.length - 1 || idx % 2 === 0);
 this.recalculateGpsDistanceFromPath();
 }

 this.stepCounter.gpsReady = true;
 // While locked, motion sensors usually stop — estimate steps from GPS distance
 if (isBackground) {
 this.syncStepsFromDistance(true);
 }
 this.updateActivityMap(point);
 this.updateStepCounterDisplay();
 this.persistActivitySession(false);

 const hint = document.getElementById('mapHint');
 if (hint) {
 hint.textContent = isBackground
 ? 'Lock-screen GPS update received. KM + steps still counting.'
 : 'Live GPS tracking ON. Steps also sync from distance if sensors pause.';
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
 const distance = this.getTrackedDistanceKm();
 const calories = this.getSessionCalories();
 const kmEl = document.getElementById('liveKmCount');
 if (kmEl) {
 kmEl.textContent = distance.toFixed(2);
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
 const mode = this.stepCounter.trackingMode || 'outdoor';
 const shown = mode === 'treadmill'
 ? (this.stepCounter.treadmillDistanceKm || distance)
 : (this.stepCounter.distanceKm || distance);
 gpsDistanceLabel.textContent = `${Number(shown).toFixed(2)} KM`;
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

 this.accumulateTreadmillDistance();
 const distanceKm = this.getTrackedDistanceKm();
 const motionSteps = this.stepCounter.stepCount || 0;
 const estimatedSteps = Math.round(distanceKm * (this.challengeConfig.stepsPerKm || 1300));
 const steps = Math.max(motionSteps, estimatedSteps);
 const mode = this.stepCounter.trackingMode || 'outdoor';

 if (distanceKm <= 0 && steps <= 0) {
 alert(mode === 'treadmill'
 ? 'No treadmill distance yet. Set speed, Start Activity, walk/run, then Stop and Save.'
 : 'No distance recorded yet. Start Activity, move with GPS on, then Stop and Save.');
 return;
 }

 const durationSec = this.stepCounter.startTime
 ? Math.round((Date.now() - this.stepCounter.startTime) / 1000)
 : this.getSessionDurationSec();
 const caloriesBurned = this.estimateCaloriesBurned(distanceKm, durationSec, this.getBodyWeightKg());

 await this.saveStepsWithScreenshot(steps, null, true, {
 distanceKm,
 path: mode === 'treadmill' ? [] : (this.stepCounter.path || []).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t })),
 durationSec,
 caloriesBurned,
 bodyWeightKg: this.getBodyWeightKg(),
 trackingMode: mode,
 treadmillSpeedKmh: mode === 'treadmill' ? this.getTreadmillSpeedKmh() : null
 });
 }

 async saveStepsWithScreenshot(steps, screenshotData, fromStepCounter = false, trackMeta = null) {
 const today = new Date().toDateString();
 const currentSteps = this.currentUser.dailySteps[today] || 0;
 this.currentUser.dailySteps[today] = currentSteps + steps;
 this.currentUser.totalSteps = (this.currentUser.totalSteps || 0) + steps;
 this.currentUser.lastActivity = new Date().toISOString();

 const distanceKm = trackMeta && typeof trackMeta.distanceKm === 'number'
 ? trackMeta.distanceKm
 : steps / (this.challengeConfig.stepsPerKm || 1300);
 this.currentUser.totalDistanceKm = (this.currentUser.totalDistanceKm || 0) + distanceKm;
 if (!this.currentUser.dailyDistanceKm) this.currentUser.dailyDistanceKm = {};
 this.currentUser.dailyDistanceKm[today] = (this.currentUser.dailyDistanceKm[today] || 0) + distanceKm;

 const durationSec = trackMeta && typeof trackMeta.durationSec === 'number' ? trackMeta.durationSec : null;
 const caloriesBurned = trackMeta && typeof trackMeta.caloriesBurned === 'number'
 ? trackMeta.caloriesBurned
 : this.estimateCaloriesBurned(distanceKm, durationSec, this.getBodyWeightKg());
 this.currentUser.totalCalories = (this.currentUser.totalCalories || 0) + caloriesBurned;
 if (!this.currentUser.dailyCalories) this.currentUser.dailyCalories = {};
 this.currentUser.dailyCalories[today] = (this.currentUser.dailyCalories[today] || 0) + caloriesBurned;

 // Per-day completion stats for daily leaderboards (shortest time wins)
 if (!this.currentUser.dailyStats) this.currentUser.dailyStats = {};
 const dayNum = this.getChallengeDayNumber();
 const goalKmForDay = dayNum >= 1 && dayNum <= 7
 ? this.challengeConfig.dayGoalsKm[dayNum - 1]
 : this.getDailyGoalKm();
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
 prevDay.distanceKm = Number(((prevDay.distanceKm || 0) + distanceKm).toFixed(3));
 prevDay.durationSec = (prevDay.durationSec || 0) + (durationSec || 0);
 prevDay.steps = (prevDay.steps || 0) + steps;
 prevDay.caloriesBurned = (prevDay.caloriesBurned || 0) + caloriesBurned;
 prevDay.goalKm = goalKmForDay;
 prevDay.challengeDay = dayNum || prevDay.challengeDay || null;
 if (!prevDay.completed && prevDay.distanceKm >= (goalKmForDay - 0.01)) {
 prevDay.completed = true;
 prevDay.completionDurationSec = prevDay.durationSec;
 prevDay.completedAt = new Date().toISOString();
 }
 this.currentUser.dailyStats[today] = prevDay;

 const entryId = `ENTRY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
 const stepEntry = {
 id: entryId,
 userId: this.currentUser.id || this.currentUser.employeeId || 'unknown',
 userUid: this.currentUser.uid || null,
 userName: this.currentUser.name || 'Unknown User',
 userEmail: this.currentUser.email || this.currentUser.emailId || 'No email',
 steps: steps,
 distanceKm: Number(distanceKm.toFixed(3)),
 caloriesBurned,
 bodyWeightKg: trackMeta && trackMeta.bodyWeightKg ? trackMeta.bodyWeightKg : this.getBodyWeightKg(),
 path: trackMeta && Array.isArray(trackMeta.path) ? trackMeta.path.slice(0, 300) : [],
 durationSec,
 screenshot: null,
 date: new Date().toISOString(),
 status: fromStepCounter ? 'approved' : 'pending',
 validatedBy: fromStepCounter ? 'App GPS Counter' : null,
 validatedAt: fromStepCounter ? new Date().toISOString() : null,
 lastModifiedBy: null,
 lastModifiedAt: null,
 notes: fromStepCounter
 ? ((trackMeta && trackMeta.trackingMode === 'treadmill')
 ? `Treadmill activity: ${distanceKm.toFixed(2)} KM at ${trackMeta.treadmillSpeedKmh || '?'} km/h - ${caloriesBurned} kcal`
 : `In-app GPS activity: ${distanceKm.toFixed(2)} KM - ${caloriesBurned} kcal`)
 : null,
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
 this.upsertStepEntryInFirebase(stepEntry);
 
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

 // Save
 const index = this.participants.findIndex(p => p.name === this.currentUser.name);
 if (index !== -1) {
 this.participants[index] = this.currentUser;
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
 
 // Update dashboard and leaderboard immediately
 this.updateDashboard();
 this.updateLeaderboard();
 
 // Show success message
 setTimeout(() => {
 alert(`Saved successfully!\n\n${distanceKm.toFixed(2)} KM covered (~${steps.toLocaleString()} steps)\nCalories burned: ~${caloriesBurned} kcal\n\nYour leaderboard has been updated.`);
 }, 500);
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

// Initialize the app and make it globally accessible
try {
 const app = new StepathonApp();
 window.app = app; // Make app accessible globally for onclick handlers
 console.log('StepathonApp initialized successfully');
} catch (error) {
 console.error('Error initializing StepathonApp:', error);
 console.error('Error stack:', error.stack);
 // Still set window.app to null so admin.html can detect the error
 window.app = null;
}

// Debug helper functions (accessible from browser console)
window.debugStepathon = {
 // Check localStorage
 checkLocalStorage: function() {
 console.log('=== LocalStorage Debug ===');
 const stepEntriesKey = window.app && window.app.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
 const stepEntries = localStorage.getItem(stepEntriesKey);
 console.log('stepEntries key exists:', stepEntries !== null);
 console.log('stepEntries value:', stepEntries);
 console.log('stepEntries length:', stepEntries ? stepEntries.length : 0);
 
 if (stepEntries) {
 try {
 const parsed = JSON.parse(stepEntries);
 console.log('Parsed entries:', parsed);
 console.log('Is array:', Array.isArray(parsed));
 console.log('Entry count:', Array.isArray(parsed) ? parsed.length : 'N/A');
 if (Array.isArray(parsed) && parsed.length > 0) {
 console.log('First entry:', parsed[0]);
 console.log('All entry statuses:', parsed.map(e => e ? e.status : 'null'));
 }
 } catch (e) {
 console.error('Error parsing stepEntries:', e);
 }
 }
 
 const participantsKey = window.app && window.app.firebaseEnabled ? 'participants_cache' : 'participants';
 const participants = localStorage.getItem(participantsKey);
 console.log('participants key exists:', participants !== null);
 if (participants) {
 try {
 const parsed = JSON.parse(participants);
 console.log('Participants count:', Array.isArray(parsed) ? parsed.length : 'N/A');
 } catch (e) {
 console.error('Error parsing participants:', e);
 }
 }
 },
 
 // Create a test entry
 createTestEntry: function() {
 console.log('Creating test entry...');
 const testEntry = {
 id: 'TEST_ENTRY_' + Date.now(),
 userId: 'TEST_USER',
 userName: 'Test User',
 userEmail: 'test@example.com',
 steps: 5000,
 screenshot: null,
 date: new Date().toISOString(),
 status: 'pending',
 validatedBy: null,
 validatedAt: null,
 lastModifiedBy: null,
 lastModifiedAt: null,
 notes: null,
 source: 'manual'
 };
 
 if (window.app) {
 window.app.stepEntries = window.app.loadStepEntries();
 window.app.stepEntries.unshift(testEntry);
 window.app.saveStepEntries();
 console.log('Test entry created:', testEntry);
 console.log('Total entries now:', window.app.stepEntries.length);
 
 // Refresh dashboard if on admin page
 if (window.location.pathname.includes('admin.html')) {
 window.app.updateAdminDashboard();
 }
 } else {
 console.error('App not available');
 }
 },
 
 // Clear all entries
 clearEntries: function() {
 if (confirm('Are you sure you want to clear all step entries?')) {
 const stepEntriesKey = window.app && window.app.firebaseEnabled ? 'stepEntries_cache' : 'stepEntries';
 localStorage.removeItem(stepEntriesKey);
 if (window.app) {
 window.app.stepEntries = [];
 if (window.location.pathname.includes('admin.html')) {
 window.app.updateAdminDashboard();
 }
 }
 console.log('All entries cleared');
 }
 },
 
 // Force refresh dashboard
 refreshDashboard: function() {
 if (window.app && typeof window.app.updateAdminDashboard === 'function') {
 console.log('Forcing dashboard refresh...');
 window.app.updateAdminDashboard();
 } else {
 console.error('App or updateAdminDashboard not available');
 }
 },
 
 // Show app state
 showAppState: function() {
 if (window.app) {
 console.log('=== App State ===');
 console.log('stepEntries:', window.app.stepEntries);
 console.log('stepEntries length:', window.app.stepEntries ? window.app.stepEntries.length : 'N/A');
 console.log('isAdmin:', window.app.isAdmin);
 console.log('currentUser:', window.app.currentUser);
 } else {
 console.error('App not available');
 }
 }
};

console.log('Debug helpers available! Use window.debugStepathon to access:');
console.log(' - checkLocalStorage() - Check localStorage data');
console.log(' - createTestEntry() - Create a test entry');
console.log(' - clearEntries() - Clear all entries');
console.log(' - refreshDashboard() - Force refresh dashboard');
console.log(' - showAppState() - Show app state');

