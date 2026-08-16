// ════════════════════════════════════════════════
//  Single GPS abstraction for web + native (Capacitor).
//  Every view that needs a position must use this helper instead of
//  calling navigator.geolocation directly.
//
//  This returns ONE reading on demand — it is NOT continuous tracking.
// ════════════════════════════════════════════════

const isNativeApp = () => !!globalThis.Capacitor?.isNativePlatform?.();

function webGeolocationError(error) {
  switch (error?.code) {
    case 1:
      return new Error('Bạn đã từ chối quyền truy cập vị trí. Hãy bật quyền vị trí cho trình duyệt rồi thử lại.');
    case 2:
      return new Error('Không lấy được vị trí hiện tại. Hãy kiểm tra GPS/định vị đã bật và thử lại.');
    case 3:
      return new Error('Hết thời gian chờ lấy vị trí GPS. Hãy thử lại ở nơi thoáng.');
    default:
      return new Error('Không lấy được vị trí hiện tại. Vui lòng thử lại.');
  }
}

/**
 * Get the device location once.
 *
 * @returns {Promise<{latitude:number, longitude:number, accuracy:number}>}
 * Throws an Error with a Vietnamese message for every failure state:
 * permission denied · GPS disabled · timeout · unavailable · bad accuracy.
 */
export async function getDeviceLocation({
  timeoutMs = 15000,
  maximumAgeMs = 30000,
  maxAccuracyMeters = null, // only enforced when the caller explicitly passes it
  purposeLabel = 'chấm công',
} = {}) {
  const capacitor = globalThis.Capacitor;
  const plugin = capacitor?.Plugins?.Geolocation;
  let position = null;

  if (isNativeApp() && plugin) {
    // ── Native (Capacitor Geolocation) ──────────
    try {
      const perms = await plugin.checkPermissions?.();
      if (perms && (perms.location === 'denied' || perms.coarseLocation === 'denied')) {
        throw new Error(`Bạn đã từ chối quyền vị trí. Vào Cài đặt của ứng dụng để cấp quyền rồi ${purposeLabel} lại.`);
      }
      if (perms && perms.location !== 'granted' && typeof plugin.requestPermissions === 'function') {
        const requested = await plugin.requestPermissions();
        if (requested && (requested.location === 'denied' || requested.coarseLocation === 'denied')) {
          throw new Error(`Bạn đã từ chối quyền vị trí. Vào Cài đặt của ứng dụng để cấp quyền rồi ${purposeLabel} lại.`);
        }
      }
    } catch (error) {
      if (error instanceof Error && /quyền vị trí/i.test(error.message)) throw error;
      // Permission introspection failed for another reason — try getting the
      // position directly below, the native error message will guide the user.
    }
    try {
      position = await plugin.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: Math.max(1, Math.round(timeoutMs / 1000)),
        maximumAge: Math.max(0, Math.round(maximumAgeMs / 1000)),
      });
    } catch (error) {
      const msg = String(error?.message || error?.code || '');
      if (/denied|permission/i.test(msg)) throw new Error(`Bạn đã từ chối quyền vị trí. Vào Cài đặt của ứng dụng để cấp quyền rồi ${purposeLabel} lại.`);
      if (/timeout/i.test(msg)) throw new Error('Hết thời gian chờ lấy vị trí GPS. Hãy thử lại ở nơi thoáng.');
      throw new Error('Không lấy được vị trí hiện tại. Hãy kiểm tra GPS/định vị đã bật và thử lại.');
    }
  } else {
    // ── Web (browser geolocation) ────────────────
    if (!navigator.geolocation) throw new Error('Thiết bị hoặc trình duyệt không hỗ trợ GPS.');
    position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        error => reject(webGeolocationError(error)),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
      );
    });
  }

  const coords = position?.coords || position || {};
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  const accuracy = coords.accuracy === undefined || coords.accuracy === null ? 0 : Number(coords.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Không lấy được vị trí hiện tại. Hãy kiểm tra GPS/định vị đã bật và thử lại.');
  }
  if (maxAccuracyMeters !== null && accuracy > maxAccuracyMeters) {
    throw new Error(`Độ chính xác GPS quá thấp (±${Math.round(accuracy)} m). Hãy thử lại ở nơi thoáng.`);
  }
  return { latitude, longitude, accuracy };
}
