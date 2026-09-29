// Sons du jeu, synthétisés par le navigateur (Web Audio) : aucun fichier à charger.
// Coups d'épée, monstres touchés, blessures, roulade, butin, cloche du village au lever du jour,
// cor de la horde, et une pluie de fond quand il pleut. Touche M : couper ou remettre le son.

let ac = null;
let master = null;
let rain = null;
let muted = false;
try { muted = localStorage.getItem('contree.muet') === '1'; } catch { /* stockage indisponible */ }

// Le navigateur n'autorise le son qu'après un geste du joueur.
export function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  ac = new Ctx();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ac.destination);
  setWeather(weather); // la météo a pu changer avant que le son ne soit permis
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('contree.muet', muted ? '1' : '0'); } catch { /* rien */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05);
  return muted;
}

let noiseBuffer = null;
function noise() {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

// Enveloppe courte : attaque presque immédiate, puis extinction.
function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function tone(type, f0, f1, decay, peak = 0.3, delay = 0) {
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + decay);
  env(g, t0, peak, decay);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + decay + 0.05);
}

function whoosh(freq, decay, peak) {
  const t0 = ac.currentTime;
  const src = noise();
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t0);
  f.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + decay);
  f.Q.value = 1.2;
  const g = ac.createGain();
  env(g, t0, peak, decay);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + decay + 0.05);
}

const SOUNDS = {
  epee: () => whoosh(900, 0.14, 0.35),
  touche: () => tone('square', 220, 110, 0.12, 0.18),
  blesse: () => { tone('sawtooth', 330, 120, 0.25, 0.2); whoosh(300, 0.15, 0.2); },
  roulade: () => whoosh(400, 0.22, 0.25),
  butin: () => { tone('triangle', 660, 660, 0.12, 0.2); tone('triangle', 880, 880, 0.12, 0.2, 0.08); tone('triangle', 1320, 1320, 0.2, 0.2, 0.16); },
  manger: () => { tone('sine', 520, 700, 0.15, 0.2); tone('sine', 700, 900, 0.2, 0.15, 0.1); },
  // La cloche du village : quelques partiels qui résonnent longtemps.
  cloche: () => { for (const [f, p] of [[523, 0.25], [1046, 0.12], [1567, 0.08], [2093, 0.05]]) tone('sine', f, f, 2.8, p); },
  // Le cor de la horde : grave, qui monte un peu.
  cor: () => { tone('sawtooth', 98, 131, 1.4, 0.22); tone('sawtooth', 147, 196, 1.4, 0.12, 0.05); },
  succes: () => { tone('triangle', 523, 523, 0.2, 0.2); tone('triangle', 659, 659, 0.2, 0.2, 0.12); tone('triangle', 784, 784, 0.4, 0.22, 0.24); },
};

export function play(name) {
  if (!ac || muted || ac.state !== 'running') return;
  SOUNDS[name]?.();
}

// Pluie de fond : un bruit filtré dont le volume suit la météo.
const RAIN_LEVEL = { averses: 0.08, pluie: 0.12, orage: 0.18 };
let weather = '';
export function setWeather(meteo) {
  weather = meteo ?? '';
  if (!ac) return;
  const level = RAIN_LEVEL[meteo] ?? 0;
  if (!rain && level) {
    const src = noise();
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    rain = { src, g };
  }
  if (rain) rain.g.gain.setTargetAtTime(level, ac.currentTime, 1.5);
}
