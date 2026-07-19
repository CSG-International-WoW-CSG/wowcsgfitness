/**
 * Native bridge for Capacitor Android.
 * On web browsers this is a no-op and the existing web tracking code runs.
 * On Android it uses hardware STEP_COUNTER + Capacitor Geolocation.
 */
(function initNativeBridge(global) {
  const bridge = {
    isNative: false,
    platform: 'web',
    pedometerStarted: false,
    baselineSteps: null,
    lastNativeSteps: 0,
    watchId: null,
    _pollId: null,
    _appListener: null
  };

  function hasCapacitor() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  function plugin(name) {
    try {
      return global.Capacitor.Plugins[name] || null;
    } catch (e) {
      return null;
    }
  }

  bridge.ready = async function ready() {
    // Capacitor injects at runtime; wait briefly if needed
    for (let i = 0; i < 40; i++) {
      if (hasCapacitor()) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    bridge.isNative = hasCapacitor();
    bridge.platform = bridge.isNative
      ? (global.Capacitor.getPlatform ? global.Capacitor.getPlatform() : 'native')
      : 'web';
    return bridge.isNative;
  };

  bridge.requestPermissions = async function requestPermissions() {
    if (!bridge.isNative) return { location: 'web', activity: 'web' };
    const result = { location: 'unknown', activity: 'unknown' };
    try {
      const Geo = plugin('Geolocation');
      if (Geo && Geo.requestPermissions) {
        const perm = await Geo.requestPermissions();
        result.location = (perm && (perm.location || perm.coarseLocation)) || 'granted';
      }
    } catch (e) {
      console.warn('Geo permission failed', e);
    }
    // Pedometer plugin requests ACTIVITY_RECOGNITION on start
    result.activity = 'pending-start';
    return result;
  };

  bridge.startPedometer = async function startPedometer() {
    if (!bridge.isNative) return false;
    const Pedometer = plugin('CapacitorPedometer') || plugin('Pedometer') || plugin('TubblyCapacitorPedometer');
    if (!Pedometer) {
      console.warn('Pedometer plugin not found');
      return false;
    }
    try {
      if (Pedometer.startCounting) await Pedometer.startCounting();
      else if (Pedometer.start) await Pedometer.start();
      bridge.pedometerStarted = true;
      const count = await bridge.getNativeStepDelta(true);
      bridge.baselineSteps = count;
      bridge.lastNativeSteps = 0;
      return true;
    } catch (e) {
      console.warn('startPedometer failed', e);
      return false;
    }
  };

  bridge.stopPedometer = async function stopPedometer() {
    if (!bridge.isNative || !bridge.pedometerStarted) return;
    const Pedometer = plugin('CapacitorPedometer') || plugin('Pedometer') || plugin('TubblyCapacitorPedometer');
    try {
      if (Pedometer && Pedometer.stopCounting) await Pedometer.stopCounting();
      else if (Pedometer && Pedometer.stop) await Pedometer.stop();
    } catch (e) {
      console.warn('stopPedometer failed', e);
    }
    bridge.pedometerStarted = false;
    bridge.baselineSteps = null;
    bridge.lastNativeSteps = 0;
    if (bridge._pollId) {
      clearInterval(bridge._pollId);
      bridge._pollId = null;
    }
  };

  /**
   * Returns steps since startPedometer() (delta), using hardware counter when possible.
   * Hardware TYPE_STEP_COUNTER keeps counting while the screen is locked;
   * we read the cumulative value whenever the app wakes.
   */
  bridge.getNativeStepDelta = async function getNativeStepDelta(absolute) {
    if (!bridge.isNative) return 0;
    const Pedometer = plugin('CapacitorPedometer') || plugin('Pedometer') || plugin('TubblyCapacitorPedometer');
    if (!Pedometer) return 0;
    try {
      let raw = 0;
      if (Pedometer.getStepCount) {
        const res = await Pedometer.getStepCount();
        raw = Number(res && (res.steps != null ? res.steps : res.count != null ? res.count : res)) || 0;
      } else if (Pedometer.getCurrentSteps) {
        const res = await Pedometer.getCurrentSteps();
        raw = Number(res && (res.steps != null ? res.steps : res)) || 0;
      }
      if (absolute) return raw;
      // Plugin may already return delta since startCounting
      if (bridge.baselineSteps == null) {
        bridge.baselineSteps = raw;
        return 0;
      }
      // If values look like absolute-since-boot, convert to delta
      if (raw >= bridge.baselineSteps && raw > 1000 && bridge.baselineSteps > 100) {
        return Math.max(0, raw - bridge.baselineSteps);
      }
      return Math.max(0, raw);
    } catch (e) {
      console.warn('getNativeStepDelta failed', e);
      return bridge.lastNativeSteps || 0;
    }
  };

  bridge.startStepPolling = function startStepPolling(onSteps) {
    if (!bridge.isNative) return;
    if (bridge._pollId) clearInterval(bridge._pollId);
    bridge._pollId = setInterval(async () => {
      const steps = await bridge.getNativeStepDelta(false);
      if (steps > bridge.lastNativeSteps) {
        bridge.lastNativeSteps = steps;
        if (typeof onSteps === 'function') onSteps(steps);
      }
    }, 2000);
  };

  bridge.watchAppResume = function watchAppResume(onResume) {
    if (!bridge.isNative) return;
    const App = plugin('App');
    if (!App || !App.addListener) return;
    if (bridge._appListener && bridge._appListener.remove) {
      bridge._appListener.remove();
    }
    App.addListener('appStateChange', async (state) => {
      if (state && state.isActive && typeof onResume === 'function') {
        const steps = await bridge.getNativeStepDelta(false);
        bridge.lastNativeSteps = Math.max(bridge.lastNativeSteps, steps);
        onResume({ steps: bridge.lastNativeSteps });
      }
    }).then((handle) => {
      bridge._appListener = handle;
    }).catch(() => {});
  };

  bridge.watchPosition = async function watchPosition(onSuccess, onError) {
    if (!bridge.isNative) return null;
    const Geo = plugin('Geolocation');
    if (!Geo || !Geo.watchPosition) return null;
    try {
      bridge.watchId = await Geo.watchPosition(
        { enableHighAccuracy: true, timeout: 20000 },
        (pos, err) => {
          if (err) {
            if (onError) onError(err);
            return;
          }
          if (!pos || !pos.coords) return;
          // Normalize to browser GeolocationPosition-like shape
          onSuccess({
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              speed: pos.coords.speed,
              heading: pos.coords.heading
            },
            timestamp: pos.timestamp || Date.now()
          });
        }
      );
      return bridge.watchId;
    } catch (e) {
      console.warn('native watchPosition failed', e);
      if (onError) onError(e);
      return null;
    }
  };

  bridge.clearWatch = async function clearWatch() {
    if (!bridge.isNative) return;
    const Geo = plugin('Geolocation');
    try {
      if (Geo && Geo.clearWatch && bridge.watchId != null) {
        await Geo.clearWatch({ id: bridge.watchId });
      }
    } catch (e) {
      console.warn('clearWatch failed', e);
    }
    bridge.watchId = null;
  };

  bridge.getCurrentPosition = async function getCurrentPosition(options) {
    if (!bridge.isNative) return null;
    const Geo = plugin('Geolocation');
    if (!Geo || !Geo.getCurrentPosition) return null;
    try {
      const pos = await Geo.getCurrentPosition(options || { enableHighAccuracy: true, timeout: 20000 });
      return {
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading
        },
        timestamp: pos.timestamp || Date.now()
      };
    } catch (e) {
      console.warn('native getCurrentPosition failed', e);
      return null;
    }
  };

  global.WowNative = bridge;
})(window);
