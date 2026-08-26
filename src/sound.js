// ════════════════════════════════════════════════════════════════════════
//  SOUND NOTIFICATION SYSTEM (Web Audio API)
//  Synthesizes pure, crystal-clear harmonic chimes without external assets.
// ════════════════════════════════════════════════════════════════════════

let _audioCtx = null;
let _lastPlayTime = 0;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!_audioCtx) {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (AudioCtxClass) {
      _audioCtx = new AudioCtxClass();
    }
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// Auto-unlock AudioContext on first user interaction
if (typeof document !== 'undefined') {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    document.removeEventListener('click', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchstart', unlock);
  };
  document.addEventListener('click', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
}

function isSoundEnabled() {
  try {
    return localStorage.getItem('hr_sound_enabled') !== '0';
  } catch (_) {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem('hr_sound_enabled', enabled ? '1' : '0');
  } catch (_) {}
}

/**
 * Plays a soft, modern 2-tone chime for incoming chat messages.
 * Notes: E5 (659.3 Hz) -> A5 (880 Hz)
 */
export function playChatSound() {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - _lastPlayTime < 300) return; // Debounce
  _lastPlayTime = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const t0 = ctx.currentTime;
    
    // Note 1: E5
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, t0);
    gain1.gain.setValueAtTime(0, t0);
    gain1.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.13);

    // Note 2: A5
    const t1 = t0 + 0.08;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, t1);
    gain2.gain.setValueAtTime(0, t1);
    gain2.gain.linearRampToValueAtTime(0.22, t1 + 0.018);
    gain2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.28);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t1);
    osc2.stop(t1 + 0.30);
  } catch (_) {}
}

/**
 * Plays a sparkling, prominent 3-tone chime when tagged in chat (@username or @all).
 * Notes: D5 (587.3 Hz) -> A5 (880 Hz) -> D6 (1174.7 Hz)
 */
export function playMentionSound() {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - _lastPlayTime < 300) return; // Debounce
  _lastPlayTime = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const t0 = ctx.currentTime;

    // Note 1: D5
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, t0);
    gain1.gain.setValueAtTime(0, t0);
    gain1.gain.linearRampToValueAtTime(0.20, t0 + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.15);

    // Note 2: A5
    const t1 = t0 + 0.07;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, t1);
    gain2.gain.setValueAtTime(0, t1);
    gain2.gain.linearRampToValueAtTime(0.24, t1 + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.18);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t1);
    osc2.stop(t1 + 0.20);

    // Note 3: D6 (High sparkling finish)
    const t2 = t0 + 0.15;
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'triangle';
    osc3.frequency.setValueAtTime(1174.66, t2);
    gain3.gain.setValueAtTime(0, t2);
    gain3.gain.linearRampToValueAtTime(0.28, t2 + 0.018);
    gain3.gain.exponentialRampToValueAtTime(0.001, t2 + 0.38);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(t2);
    osc3.stop(t2 + 0.40);
  } catch (_) {}
}

/**
 * Plays a distinctive alert chime when tagged in a task / work item.
 * Notes: C5 (523.25 Hz) -> G5 (783.99 Hz) -> C6 (1046.5 Hz)
 */
export function playTaskSound() {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - _lastPlayTime < 300) return; // Debounce
  _lastPlayTime = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const t0 = ctx.currentTime;

    // Note 1: C5
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, t0);
    gain1.gain.setValueAtTime(0, t0);
    gain1.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.16);

    // Note 2: G5
    const t1 = t0 + 0.08;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, t1);
    gain2.gain.setValueAtTime(0, t1);
    gain2.gain.linearRampToValueAtTime(0.25, t1 + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.22);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t1);
    osc2.stop(t1 + 0.24);

    // Note 3: C6
    const t2 = t0 + 0.18;
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1046.50, t2);
    gain3.gain.setValueAtTime(0, t2);
    gain3.gain.linearRampToValueAtTime(0.28, t2 + 0.018);
    gain3.gain.exponentialRampToValueAtTime(0.001, t2 + 0.35);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(t2);
    osc3.stop(t2 + 0.38);
  } catch (_) {}
}
