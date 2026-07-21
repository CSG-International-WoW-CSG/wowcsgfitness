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
    /** Session step count from plugin (delta since startCounting). */
    lastNativeSteps: 0,
    watchId: null,
    _pollId: null,
    _appListener: null,
    _stepListener: null
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

  function pedometerPlugin() {
    return plugin('CapacitorPedometer') || plugin('Pedometer') || plugin('TubblyCapacitorPedometer');
  }

  bridge.ready = async function ready() {
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
    result.activity = 'pending-start';
    return result;
  };

  bridge.startPedometer = async function startPedometer() {
    if (!bridge.isNative) return false;
    // Idempotent — restarting startCounting() resets the hardware session counter
    if (bridge.pedometerStarted) return true;
    const Pedometer = pedometerPlugin();
    if (!Pedometer) {
      console.warn('Pedometer plugin not found');
      return false;
    }
    try {
      if (Pedometer.startCounting) await Pedometer.startCounting();
      else if (Pedometer.start) await Pedometer.start();
      bridge.pedometerStarted = true;
      bridge.lastNativeSteps = 0;
      // Tubbly returns session delta since startCounting — read once to sync
      const first = await bridge.getNativeStepDelta();
      bridge.lastNativeSteps = first;
      return true;
    } catch (e) {
      console.warn('startPedometer failed', e);
      return false;
    }
  };

  bridge.stopPedometer = async function stopPedometer() {
    if (!bridge.isNative || !bridge.pedometerStarted) return;
    const Pedometer = pedometerPlugin();
    try {
      if (bridge._stepListener && bridge._stepListener.remove) {
        await bridge._stepListener.remove();
      }
    } catch (e) { /* ignore */ }
    bridge._stepListener = null;
    try {
      if (Pedometer && Pedometer.stopCounting) await Pedometer.stopCounting();
      else if (Pedometer && Pedometer.stop) await Pedometer.stop();
    } catch (e) {
      console.warn('stopPedometer failed', e);
    }
    bridge.pedometerStarted = false;
    bridge.lastNativeSteps = 0;
    if (bridge._pollId) {
      clearInterval(bridge._pollId);
      bridge._pollId = null;
    }
  };

  /**
   * Hardware TYPE_STEP_COUNTER keeps counting while locked.
   * Tubbly CapacitorPedometer.getStepCount() returns steps since startCounting().
   */
  bridge.getNativeStepDelta = async function getNativeStepDelta() {
    if (!bridge.isNative) return 0;
    const Pedometer = pedometerPlugin();
    if (!Pedometer) return 0;
    try {
      let raw = 0;
      if (Pedometer.getStepCount) {
        const res = await Pedometer.getStepCount();
        raw = Number(res && (res.count != null ? res.count : res.steps != null ? res.steps : res)) || 0;
      } else if (Pedometer.getCurrentSteps) {
        const res = await Pedometer.getCurrentSteps();
        raw = Number(res && (res.steps != null ? res.steps : res.count != null ? res.count : res)) || 0;
      }
      return Math.max(0, Math.round(raw));
    } catch (e) {
      console.warn('getNativeStepDelta failed', e);
      return bridge.lastNativeSteps || 0;
    }
  };

  bridge.startStepPolling = function startStepPolling(onSteps, intervalMs) {
    if (!bridge.isNative) return;
    if (bridge._pollId) clearInterval(bridge._pollId);
    const ms = Math.max(2000, Number(intervalMs) || 3000);

    const emit = async () => {
      const steps = await bridge.getNativeStepDelta();
      if (steps > bridge.lastNativeSteps) {
        bridge.lastNativeSteps = steps;
        if (typeof onSteps === 'function') onSteps(steps);
      } else if (steps > 0) {
        bridge.lastNativeSteps = Math.max(bridge.lastNativeSteps, steps);
      }
    };

    bridge._pollId = setInterval(emit, ms);
    emit();

    // Prefer native events when available (lower latency, less polling work)
    const Pedometer = pedometerPlugin();
    if (Pedometer && Pedometer.addListener && !bridge._stepListener) {
      Pedometer.addListener('stepCountChange', (event) => {
        const steps = Math.max(
          0,
          Math.round(Number(event && (event.count != null ? event.count : event.steps)) || 0)
        );
        if (steps > bridge.lastNativeSteps) {
          bridge.lastNativeSteps = steps;
          if (typeof onSteps === 'function') onSteps(steps);
        }
      }).then((handle) => {
        bridge._stepListener = handle;
      }).catch(() => {});
    }
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
        const steps = await bridge.getNativeStepDelta();
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
      // Slightly lower power than continuous max accuracy when possible
      bridge.watchId = await Geo.watchPosition(
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 2000 },
        (pos, err) => {
          if (err) {
            if (onError) onError(err);
            return;
          }
          if (!pos || !pos.coords) return;
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
      const pos = await Geo.getCurrentPosition(options || {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 3000
      });
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
