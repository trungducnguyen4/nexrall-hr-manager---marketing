const isNative = () => !!globalThis.Capacitor?.isNativePlatform?.();

export function initNativeShell() {
  if (!isNative()) return;
  const app = globalThis.Capacitor?.Plugins?.App;
  app?.addListener?.('appStateChange', ({ isActive }) => document.documentElement.classList.toggle('native-private', !isActive));
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('native-private', document.hidden));
}

export async function verifyBiometricIfAvailable() {
  if (!isNative()) return true;
  const biometric = globalThis.Capacitor?.Plugins?.NativeBiometric;
  if (!biometric) return true;
  const available = await biometric.isAvailable();
  if (!available?.isAvailable) return true;
  await biometric.verifyIdentity({ reason: 'Xác nhận để mở NetViet HR', title: 'NetViet HR' });
  return true;
}
