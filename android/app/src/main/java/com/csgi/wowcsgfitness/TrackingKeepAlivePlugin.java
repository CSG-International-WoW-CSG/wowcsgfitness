package com.csgi.wowcsgfitness;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "TrackingKeepAlive",
    permissions = {
        @Permission(
            alias = "activity",
            strings = { Manifest.permission.ACTIVITY_RECOGNITION }
        ),
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class TrackingKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String mode = call.getString("mode", "outdoor");
        float speed = call.getFloat("treadmillSpeedKmh", 5f);
        if (speed < 2f || speed > 12f) speed = 5f;

        if (Build.VERSION.SDK_INT >= 29
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("activity", call, "activityPermCallback");
            return;
        }

        ActivityTrackingService.start(getContext(), mode, speed);
        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("mode", mode);
        call.resolve(ret);
    }

    @PermissionCallback
    private void activityPermCallback(PluginCall call) {
        String mode = call.getString("mode", "outdoor");
        float speed = call.getFloat("treadmillSpeedKmh", 5f);
        if (speed < 2f || speed > 12f) speed = 5f;
        ActivityTrackingService.start(getContext(), mode, speed);
        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("mode", mode);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ActivityTrackingService.stop(getContext());
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        SharedPreferences prefs =
            getContext().getSharedPreferences(ActivityTrackingService.PREFS, android.content.Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("active", prefs.getBoolean("active", false));
        ret.put("mode", prefs.getString("mode", "outdoor"));
        ret.put("steps", prefs.getInt("steps", 0));
        ret.put("distanceKm", (double) prefs.getFloat("distanceKm", 0f));
        ret.put("treadmillSpeedKmh", (double) prefs.getFloat("treadmillSpeedKmh", 5f));
        ret.put("startedAt", prefs.getLong("startedAt", 0L));
        ret.put("updatedAt", prefs.getLong("updatedAt", 0L));
        if (prefs.contains("lat") && prefs.contains("lng")) {
            ret.put("lat", (double) prefs.getFloat("lat", 0f));
            ret.put("lng", (double) prefs.getFloat("lng", 0f));
        }
        call.resolve(ret);
    }
}
