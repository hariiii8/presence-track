/**
 * Procedural Web Audio synthesizer (clicks, transit blips, alerts). Call only from event handlers.
 */
let audioContext: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function tone(freq: number, peak: number, duration: number, endFreq?: number) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, c.currentTime + duration);
  gain.gain.setValueAtTime(peak, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

export function playClick() {
  tone(800, 0.15, 0.025);
}

export function playTransitBlip() {
  tone(1200, 0.1, 0.12);
  tone(1600, 0.08, 0.12);
}

export function playWarningBeep() {
  tone(440, 0.12, 0.2);
}

export function playSweep() {
  tone(350, 0.1, 0.4, 1250);
}
