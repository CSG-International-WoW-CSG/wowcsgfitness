package com.csgi.wowcsgfitness;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps counting steps (and outdoor GPS / treadmill KM)
 * while the screen is locked or the WebView is suspended.
 */
public class ActivityTrackingService extends Service implements SensorEventListener, LocationListener {
    public static final String ACTION_START = "com.csgi.wowcsgfitness.TRACK_START";
    public static final String ACTION_STOP = "com.csgi.wowcsgfitness.TRACK_STOP";
    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_SPEED = "treadmillSpeedKmh";
    public static final String PREFS = "wowcsg_tracking_keepalive";

    private static final String CHANNEL_ID = "wowcsg_tracking";
    private static final int NOTIF_ID = 42026;
    private static final long TICK_MS = 1000L;
    private static final long GPS_MIN_TIME_MS = 4000L;
    private static final float GPS_MIN_DIST_M = 3f;
    private static final float MAX_ACCURACY_M = 45f;
    private static final float MAX_JUMP_M = 80f;

    private SensorManager sensorManager;
    private Sensor stepSensor;
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private Runnable tickRunnable;

    private boolean running = false;
    private String mode = "outdoor";
    private float treadmillSpeedKmh = 5f;

    private float hardwareBaseline = -1f;
    private int sessionSteps = 0;
    private double distanceMeters = 0;
    private Location lastLocation = null;
    private long lastTickAt = 0L;
    private long startedAt = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        handler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTrackingInternal();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            mode = intent.getStringExtra(EXTRA_MODE) != null ? intent.getStringExtra(EXTRA_MODE) : "outdoor";
            treadmillSpeedKmh = intent.getFloatExtra(EXTRA_SPEED, 5f);
            if (treadmillSpeedKmh < 2f || treadmillSpeedKmh > 12f) treadmillSpeedKmh = 5f;
        }

        startAsForeground();
        startTrackingInternal();
        return START_STICKY;
    }

    private void startAsForeground() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WOW-CSG Fitness")
            .setContentText("Tracking active — steps/KM continue while locked")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        if (Build.VERSION.SDK_INT >= 34) {
            try {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH;
                if ("outdoor".equals(mode)) {
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
                }
                startForeground(NOTIF_ID, notification, type);
            } catch (Exception e) {
                startForeground(NOTIF_ID, notification);
            }
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void startTrackingInternal() {
        if (running) {
            persistSnapshot();
            return;
        }
        running = true;
        startedAt = System.currentTimeMillis();
        lastTickAt = startedAt;
        hardwareBaseline = -1f;
        sessionSteps = 0;
        distanceMeters = 0;
        lastLocation = null;

        acquireWakeLock();
        registerStepSensor();
        if ("outdoor".equals(mode)) {
            registerGps();
        }
        tickRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) return;
                onTick();
                handler.postDelayed(this, TICK_MS);
            }
        };
        handler.post(tickRunnable);
        persistSnapshot();
    }

    private void stopTrackingInternal() {
        running = false;
        if (handler != null && tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
        }
        unregisterStepSensor();
        unregisterGps();
        releaseWakeLock();
        SharedPreferences.Editor ed = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        ed.putBoolean("active", false);
        ed.apply();
    }

    private void onTick() {
        long now = System.currentTimeMillis();
        long dtMs = Math.max(0L, now - lastTickAt);
        lastTickAt = now;

        if ("treadmill".equals(mode) && dtMs > 0 && dtMs < 15000L) {
            double hours = dtMs / 3600000.0;
            distanceMeters += treadmillSpeedKmh * 1000.0 * hours;
        }

        // Prefer step-derived distance when GPS is sparse while locked
        if ("outdoor".equals(mode) && sessionSteps > 0) {
            double stepMeters = sessionSteps * (1000.0 / 1040.0); // ~1040 steps/KM native
            if (stepMeters > distanceMeters) {
                distanceMeters = stepMeters;
            }
        }

        persistSnapshot();
        updateNotification();
    }

    private void registerStepSensor() {
        if (sensorManager == null) return;
        stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (stepSensor != null) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
        }
    }

    private void unregisterStepSensor() {
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
    }

    private void registerGps() {
        if (locationManager == null) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    GPS_MIN_TIME_MS,
                    GPS_MIN_DIST_M,
                    this,
                    Looper.getMainLooper()
                );
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    GPS_MIN_TIME_MS,
                    GPS_MIN_DIST_M,
                    this,
                    Looper.getMainLooper()
                );
            }
        } catch (SecurityException e) {
            // Permission may be missing; steps still work
        }
    }

    private void unregisterGps() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception ignored) {}
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wowcsg:tracking");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(8 * 60 * 60 * 1000L); // up to 8 hours
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        wakeLock = null;
    }

    private void persistSnapshot() {
        SharedPreferences.Editor ed = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        ed.putBoolean("active", running);
        ed.putString("mode", mode);
        ed.putInt("steps", Math.max(0, sessionSteps));
        ed.putFloat("distanceKm", (float) Math.max(0, distanceMeters / 1000.0));
        ed.putFloat("treadmillSpeedKmh", treadmillSpeedKmh);
        ed.putLong("startedAt", startedAt);
        ed.putLong("updatedAt", System.currentTimeMillis());
        if (lastLocation != null) {
            ed.putFloat("lat", (float) lastLocation.getLatitude());
            ed.putFloat("lng", (float) lastLocation.getLongitude());
        }
        ed.apply();
    }

    private void updateNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String text = String.format(
                "Tracking: %d steps · %.2f KM",
                sessionSteps,
                distanceMeters / 1000.0
            );
            Intent launch = new Intent(this, MainActivity.class);
            PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("WOW-CSG Fitness")
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
            nm.notify(NOTIF_ID, notification);
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Activity tracking",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps step and KM tracking alive while the screen is locked");
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!running || event == null || event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        float total = event.values[0];
        if (hardwareBaseline < 0f) {
            hardwareBaseline = total;
            return;
        }
        int delta = Math.max(0, Math.round(total - hardwareBaseline));
        if (delta > sessionSteps) {
            sessionSteps = delta;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    @Override
    public void onLocationChanged(Location location) {
        if (!running || location == null) return;
        if (location.hasAccuracy() && location.getAccuracy() > MAX_ACCURACY_M) return;
        if (lastLocation != null) {
            float dist = lastLocation.distanceTo(location);
            long dt = Math.max(1L, location.getTime() - lastLocation.getTime());
            if (dist > MAX_JUMP_M && dt < 8000L) {
                // Likely GPS jump — skip
                lastLocation = location;
                return;
            }
            if (dist >= GPS_MIN_DIST_M && dist <= MAX_JUMP_M) {
                distanceMeters += dist;
            }
        }
        lastLocation = location;
        persistSnapshot();
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onDestroy() {
        stopTrackingInternal();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void start(Context context, String mode, float speedKmh) {
        Intent i = new Intent(context, ActivityTrackingService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_MODE, mode != null ? mode : "outdoor");
        i.putExtra(EXTRA_SPEED, speedKmh);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(i);
        } else {
            context.startService(i);
        }
    }

    public static void stop(Context context) {
        Intent i = new Intent(context, ActivityTrackingService.class);
        i.setAction(ACTION_STOP);
        try {
            context.startService(i);
        } catch (Exception e) {
            context.stopService(new Intent(context, ActivityTrackingService.class));
        }
    }
}
