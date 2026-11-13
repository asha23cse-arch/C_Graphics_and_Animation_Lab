/* ==========================================================
   চাষি ভাইয়ের অভিযান — A side-scrolling platformer
   Hero: a Bangladeshi farmer (lungi, jama/panjabi, gamcha on head)
   Plain JavaScript + Canvas. No libraries.

   VERY SIMPLE CONTROLS
     - The farmer runs forward automatically.
     - Tap (touch screen) or click (mouse) anywhere on the game = JUMP.
       Hold a little longer = a higher jump.
     - Jump over the ponds, land on the pests, and collect the dhan!
     - (Space / Up arrow also jump, as a backup)
   ========================================================== */
(() => {
  'use strict';

  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  const T = 36;             // tile size
  const ROWS = 15;
  const COLS = 170;
  const GROUND_ROW = 13;
  const FLAG_COL = 162;

  const GRAVITY = 0.55;
  const MAX_FALL = 13;
  const AUTO_SPEED = 3.4;   // the farmer always runs at this (beginner-friendly) speed
  const JUMP_V = -11.6;

  // Tile types
  const EMPTY = 0, GRASS = 1, SOIL = 2, BRICK = 3, QBLOCK = 4, USED = 5;

  // HUD / overlay elements
  // Safe element lookup: if an element is missing (e.g. an older index.html), do not crash
  const $ = (id) => document.getElementById(id) ||
    { style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, textContent: '' };

  const elScore = $('score');
  const elCoins = $('coins');
  const elLives = $('lives');
  const elBest = $('best');
  const elFill = $('progFill');
  const elDot = $('progDot');
  const overlay = $('overlay');
  const ovTitle = $('ovTitle');
  const ovText = $('ovText');
  const ovBtn = $('ovBtn');
  const elHowto = $('howto');
  const elCancel = $('cancelBtn');
  const elHome = $('homeBtn');
  const stage = document.querySelector('.stage');

  // ---------- Game state ----------
  let state = 'start';   // start | play | dying | over | win
  let overlayShownAt = 0;
  let grid, coins, enemies, effects;
  let parts = [];
  let score = 0, coinCount = 0, lives = 5, checkpointX = 0, camX = 0, frame = 0;
  let shake = 0, drowning = false, hint = 0, lastPct = -1, winFrame = 0;
  let best = 0;
  try { best = +localStorage.getItem('chashi_best') || 0; } catch (_) { /* ignore */ }

  const player = {
    x: 0, y: 0, w: 26, h: 44, vx: 0, vy: 0,
    face: 1, onGround: false, jumpHeld: false, invul: 0, prevY: 0,
    buffer: 0, coyote: 0, jumpAge: 99
  };

  // ---------- Input: ONE action only ----------
  //   Tap / click anywhere on the game = jump (hold a little longer = higher jump)
  //   Keyboard backup: Space or Up arrow
  const input = { kb: false, pointer: false, pulse: 0 };

  function canRestart() {
    return state !== 'play' && state !== 'dying' && performance.now() - overlayShownAt > 600;
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  window.addEventListener('keydown', (e) => {
    if (JUMP_KEYS.includes(e.code)) { input.kb = true; e.preventDefault(); }
    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat && canRestart()) startGame();
  });
  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.code)) { input.kb = false; e.preventDefault(); }
  });
  window.addEventListener('blur', () => { input.kb = false; input.pointer = false; });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('button')) return; // overlay button handles itself
    input.pointer = true;
    input.pulse = 8;            // a very quick tap still counts as a full jump
    e.preventDefault();
  });
  window.addEventListener('pointerup', () => { input.pointer = false; });
  window.addEventListener('pointercancel', () => { input.pointer = false; });

  ovBtn.addEventListener('click', () => { if (state !== 'play' && state !== 'dying') startGame(); });

  // ---------- Sound (tiny WebAudio beeps) ----------
  let audioCtx = null;
  function beep(type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const presets = {
        jump:  { f: [320, 620], d: 0.14, w: 'square' },
        coin:  { f: [880, 1320], d: 0.12, w: 'triangle' },
        stomp: { f: [260, 120], d: 0.12, w: 'square' },
        bump:  { f: [140, 100], d: 0.08, w: 'square' },
        splash:{ f: [300, 80], d: 0.35, w: 'sawtooth' },
        die:   { f: [400, 90], d: 0.6, w: 'sawtooth' },
        win:   { f: [520, 1040], d: 0.5, w: 'triangle' }
      };
      const p = presets[type];
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = p.w;
      o.frequency.setValueAtTime(p.f[0], audioCtx.currentTime);
      o.frequency.exponentialRampToValueAtTime(p.f[1], audioCtx.currentTime + p.d);
      g.gain.setValueAtTime(0.3, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + p.d);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + p.d);
    } catch (_) { /* audio is optional */ }
  }

  // ---------- Background music: "Polli Mario" (made with WebAudio) ----------
  // Bouncy Super-Mario-style chiptune in a village pentatonic scale:
  // square-wave lead + bansuri flute, bouncing bass, dholak kick & shaker.
  // Village ambience on top: bird chirps, breeze, and pond water that gets louder
  // as the farmer walks close to a pond.
  // Plays only while state === 'play'. Press M (or the 🔊 button) to mute.
  // Want your own song? Put "bgm.mp3" next to index.html -- it is used instead.
  const music = (() => {
    const BPM = 150, STEP_T = 60 / BPM / 2;          // one step = an eighth note
    const D3 = 146.83, hz = (semi) => D3 * Math.pow(2, semi / 12);
    // 8 bars x 8 steps. Numbers = semitones above D4, '-' = hold, null = rest.
    const BARS = [
      [4, 4, '-', 4, null, 0, 4, '-'],
      [9, '-', 7, '-', 4, '-', 2, '-'],
      [4, 4, '-', 7, '-', 9, '-', '-'],
      [12, '-', '-', '-', 9, '-', 7, '-'],
      [4, 4, '-', 4, null, 0, 4, '-'],
      [9, '-', 12, '-', 14, '-', 12, '-'],
      [14, '-', 12, 9, 7, '-', 9, 12],
      [12, '-', '-', '-', '-', '-', null, null]
    ];
    const CHORD_ROOT = [0, 5, 7, 0, 0, 5, 7, 0];     // D G A D | D G A D
    const melody = {};                                 // step -> { semi, steps }
    let s = 0, cur = null;
    BARS.forEach((bar) => bar.forEach((n) => {
      if (n === '-') { if (cur) cur.steps++; }
      else if (n === null) cur = null;
      else { cur = melody[s] = { semi: n + 12, steps: 1 }; }
      s++;
    }));
    const TOTAL = s;                                   // 64 steps

    const MUSIC_VOL = 1.8;                             // 0.5 = quiet ... 1 = normal ... 2.5 = very loud
    let master = null, noiseBuf = null, timer = null, step = 0, nextT = 0;
    let muted = false, mp3 = null;
    try { muted = localStorage.getItem('chashi_mute') === '1'; } catch (_) { /* ignore */ }

    const ctxOk = () => {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (!master) {
        master = audioCtx.createGain();
        master.gain.value = 0;
        const lim = audioCtx.createDynamicsCompressor();   // keeps loud sound clean
        lim.threshold.value = -18; lim.ratio.value = 10;
        master.connect(lim); lim.connect(audioCtx.destination);
        noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.1, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        setupAmbient();
      }
    };

    // ----- Village ambience -----
    let amb = null;
    function setupAmbient() {
      const len = audioCtx.sampleRate * 2;
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const loopNoise = (type, freq, q) => {
        const src = audioCtx.createBufferSource(), f = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
        src.buffer = buf; src.loop = true;
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(master); src.start();
        return { g, f };
      };
      const wind = loopNoise('bandpass', 500, 0.6);      // soft breeze through the palms
      wind.g.gain.value = 0.06;
      const swell = audioCtx.createOscillator(), sg = audioCtx.createGain();
      swell.frequency.value = 0.12; sg.gain.value = 0.04;
      swell.connect(sg); sg.connect(wind.g.gain); swell.start();
      const water = loopNoise('lowpass', 800, 1);        // pond water, gets louder near a pond
      const ripple = audioCtx.createOscillator(), rg = audioCtx.createGain();
      ripple.frequency.value = 3.2; rg.gain.value = 350;
      ripple.connect(rg); rg.connect(water.f.frequency); ripple.start();
      amb = { wind, water };
    }
    function chirp(t) {                                // a little village bird
      const base = 2200 + Math.random() * 1800, n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(), st = t + i * 0.11;
        o.type = 'sine';
        o.frequency.setValueAtTime(base, st);
        o.frequency.exponentialRampToValueAtTime(base * 1.5, st + 0.07);
        g.gain.setValueAtTime(0.0001, st);
        g.gain.linearRampToValueAtTime(0.14, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
        o.connect(g); g.connect(master); o.start(st); o.stop(st + 0.1);
      }
    }
    function ambience(on) {
      if (!amb) return;
      const now = audioCtx.currentTime;
      let near = 0;
      if (on && typeof GAPS !== 'undefined') {
        const px = player.x + player.w / 2;
        let dist = 1e9;
        for (const g of GAPS) {
          const a = g[0] * T, b = (g[1] + 1) * T;
          dist = Math.min(dist, px < a ? a - px : px > b ? px - b : 0);
        }
        near = Math.max(0, 1 - dist / 450);              // 1 = at the pond edge, 0 = far away
      }
      amb.water.g.gain.setTargetAtTime(0.28 * near * near, now, 0.15);
      if (on && Math.random() < 0.012) chirp(now + 0.02);
    }

    function tone(f, t, dur, type, vol, vib) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = f;
      if (vib) {                                       // bansuri: slide up into the note + vibrato
        o.frequency.setValueAtTime(f * 0.94, t);
        o.frequency.linearRampToValueAtTime(f, t + 0.09);
        const l = audioCtx.createOscillator(), lg = audioCtx.createGain();
        l.frequency.value = 5.5; lg.gain.value = f * 0.012;
        l.connect(lg); lg.connect(o.frequency); l.start(t + 0.1); l.stop(t + dur + 0.1);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function pluck(f, t, vol) {                        // dotara string
      const o = audioCtx.createOscillator(), fl = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(2600, t);
      fl.frequency.exponentialRampToValueAtTime(500, t + 0.5);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(fl); fl.connect(g); g.connect(master); o.start(t); o.stop(t + 0.75);
    }
    function thump(t) {                                // dholak bass
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
    }
    function tick(t, vol) {                            // dholak treble / shaker
      const n = audioCtx.createBufferSource(), f = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
      n.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 3500;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t + 0.08);
    }

    function playStep(i, t) {
      const m = i % TOTAL, k = m % 8, root = CHORD_ROOT[(m / 8) | 0];
      // bouncing bass: low root / octave up, on every step
      tone(hz(root - 12 + (k % 2 ? 12 : 0)), t, STEP_T * 0.85, 'triangle', 0.4);
      // dholak kick on beats 1 and 3, snare-like hit on 2 and 4, shaker on off-beats
      if (k === 0 || k === 4) thump(t);
      if (k === 2 || k === 6) tick(t, 0.16);
      if (k % 2 === 1) tick(t, 0.06);
      // melody: square-wave lead + soft bansuri flute on top
      const n = melody[m];
      if (n) {
        const d = Math.max(0.12, n.steps * STEP_T * 0.92);
        tone(hz(n.semi), t, d, 'square', 0.14);
        tone(hz(n.semi), t, d, 'sine', 0.3, true);
      }
    }

    function pump() {
      if (!audioCtx || !master) return;
      const on = state === 'play' && !muted && !document.hidden;
      master.gain.setTargetAtTime(on ? MUSIC_VOL : 0, audioCtx.currentTime, 0.12);
      ambience(on);
      if (mp3) { if (on) mp3.play().catch(() => {}); else mp3.pause(); return; }
      if (!on) { nextT = 0; return; }                  // wait quietly, resume in time later
      if (nextT < audioCtx.currentTime) nextT = audioCtx.currentTime + 0.05;
      while (nextT < audioCtx.currentTime + 0.25) {
        playStep(step++, nextT);
        nextT += STEP_T;
      }
    }

    return {
      start() {
        try {
          ctxOk();
          if (!timer) {
            timer = setInterval(pump, 60);
            // optional: a real song file replaces the built-in tune
            const a = new Audio('bgm.mp3');
            a.loop = true; a.volume = 1;
            a.addEventListener('canplaythrough', () => { mp3 = a; }, { once: true });
          }
          pump();
        } catch (_) { /* music is optional */ }
      },
      toggle() {
        muted = !muted;
        try { localStorage.setItem('chashi_mute', muted ? '1' : '0'); } catch (_) { /* ignore */ }
        pump();
        return muted;
      },
      get muted() { return muted; }
    };
  })();

  const elMute = $('muteBtn');
  const showMute = () => { elMute.textContent = music.muted ? '🔇' : '🔊'; };
  function toggleMute() { music.toggle(); showMute(); }
  elMute.addEventListener('click', () => { toggleMute(); if (elMute.blur) elMute.blur(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) toggleMute(); });
  showMute();

  // ---------- Farmer's victory shout: "Yeah!" ----------
  // 1) If a recording named yea.mp3 sits next to index.html, it is played.
  // 2) Otherwise the browser's built-in voice (speech synthesis) says "Yeah!".
  function shoutYea() {
    const speak = () => {
      try {
        if (!('speechSynthesis' in window)) return;
        const synth = window.speechSynthesis;
        synth.cancel();
        const say = (voice) => {
          const u = new SpeechSynthesisUtterance('Yeah!');
          u.lang = voice ? voice.lang : 'en-US';
          if (voice) u.voice = voice;
          u.rate = 1; u.pitch = 1.3; u.volume = 1;
          synth.speak(u);
        };
        const pick = () => synth.getVoices().find(v => /^en/i.test(v.lang)) || null;
        if (synth.getVoices().length) say(pick());
        else {
          let done = false;
          synth.onvoiceschanged = () => { if (!done) { done = true; say(pick()); } };
          setTimeout(() => { if (!done) { done = true; say(pick()); } }, 400);
        }
      } catch (_) { /* voice is optional */ }
    };
    try {
      const a = new Audio('yea.mp3');
      a.volume = 1;
      a.addEventListener('error', speak, { once: true });
      const pr = a.play();
      if (pr && pr.catch) pr.catch(speak);
    } catch (_) { speak(); }
  }

  // ---------- Level ----------
  // Pits are village ponds (pukur) — fall in and you lose a life.
  const GAPS = [[22, 23], [70, 71], [95, 96], [140, 141]];

  function buildLevel() {
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
    coins = [];
    enemies = [];
    effects = [];
    parts = [];

    // Ground with ponds
    for (let c = 0; c < COLS; c++) {
      if (GAPS.some((g) => c >= g[0] && c <= g[1])) continue;
      grid[GROUND_ROW][c] = GRASS;
      grid[GROUND_ROW + 1][c] = SOIL;
    }

    // Blocks: B = brick, ? = question block (gives dhan)
    const blocks = (c, r, s) =>
      [...s].forEach((ch, i) => {
        if (ch === 'B') grid[r][c + i] = BRICK;
        else if (ch === '?') grid[r][c + i] = QBLOCK;
      });

    blocks(10, 9, 'B?B?B');
    blocks(28, 9, '?');
    blocks(30, 10, 'BBB');
    blocks(36, 8, 'B?B');
    blocks(52, 9, 'BB?BB');
    blocks(60, 8, '?B?');
    blocks(78, 9, 'B?B');
    blocks(84, 10, 'BBBB');
    blocks(87, 8, '?B?B?');
    blocks(100, 9, 'B?B?B');
    blocks(108, 10, 'BBB');
    blocks(114, 8, '?');
    blocks(128, 9, 'B?B');
    blocks(134, 9, '?B?');

    // Stairs before the flag (4 steps)
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k <= i; k++) grid[GROUND_ROW - 1 - k][150 + i] = BRICK;
    }

    // Dhan (paddy coins) — many are placed high so the cursor can grab them
    const coinRow = (c, r, n) => {
      for (let i = 0; i < n; i++) coins.push({ x: (c + i) * T + T / 2, y: r * T + T / 2, got: false });
    };
    coinRow(5, 11, 4);
    coinRow(21, 10, 4);
    coinRow(31, 8, 3);
    coinRow(45, 10, 5);
    coinRow(55, 7, 3);
    coinRow(69, 10, 4);
    coinRow(84, 7, 3);
    coinRow(94, 10, 4);
    coinRow(110, 8, 3);
    coinRow(120, 10, 5);
    coinRow(139, 10, 4);
    coinRow(146, 11, 3);

    // Pests (poka)
    [18, 36, 58, 82, 102, 118, 132, 146].forEach((c) => {
      enemies.push({
        x: c * T + 4, y: GROUND_ROW * T - 26, w: 30, h: 26,
        vx: -0.9, vy: 0, onGround: false, alive: true, squash: 0
      });
    });
  }

  function resetPlayer(x) {
    player.x = x;
    player.y = GROUND_ROW * T - player.h - 1;
    player.vx = player.vy = 0;
    player.face = 1;
    player.onGround = false;
    player.jumpHeld = true; // must release jump first
    player.invul = 0;
    player.buffer = 0; player.coyote = 0; player.jumpAge = 99;
  }

  function startGame() {
    buildLevel();
    score = 0; coinCount = 0; lives = 5;
    checkpointX = 3 * T;
    camX = 0; shake = 0; drowning = false; hint = 300; winFrame = 0;
    resetPlayer(checkpointX);
    state = 'play';
    overlay.classList.add('hidden');
    updateHud();
    music.start();
    elCancel.style.display = '';
  }

  function updateHud() {
    elScore.textContent = score;
    elCoins.textContent = coinCount;
    elLives.textContent = Math.max(lives, 0);
    elBest.textContent = best;
  }

  function saveBest() {
    if (score > best) {
      best = score;
      try { localStorage.setItem('chashi_best', String(best)); } catch (_) { /* ignore */ }
    }
  }

  function showOverlay(title, text, btn, showHow) {
    ovTitle.textContent = title;
    ovText.textContent = text;
    ovBtn.textContent = btn;
    elHowto.style.display = showHow ? '' : 'none';
    elHome.style.display = showHow ? 'none' : '';     // 🏠 Home only on game-over / win cards
    elCancel.style.display = 'none';
    overlay.classList.remove('hidden');
    overlayShownAt = performance.now();
    updateHud();
  }

  // ---------- Home screen: Cancel (during play) and Home buttons ----------
  function goHome() {
    state = 'start';
    buildLevel();
    score = 0; coinCount = 0; lives = 5; camX = 0; shake = 0; drowning = false; hint = 0; winFrame = 0;
    checkpointX = 3 * T;
    resetPlayer(checkpointX);
    lastPct = -1;
    elFill.style.width = '0%'; elDot.style.left = '0%';
    showOverlay('চাষি ভাইয়ের অভিযান',
      'ধান কুড়াও, পোকা মাড়াও, আর শেষে জাতীয় পতাকার কাছে পৌঁছাও!',
      '▶ খেলা শুরু করো', true);
  }
  elCancel.addEventListener('click', () => {
    if (state === 'play' || state === 'dying' || state === 'win') goHome();
    if (elCancel.blur) elCancel.blur();
  });
  elHome.addEventListener('click', () => { goHome(); if (elHome.blur) elHome.blur(); });
  elCancel.style.display = 'none';
  elHome.style.display = 'none';

  // ---------- Particles ----------
  function burst(x, y, n, colors, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      const life = (o.life || 30) * (0.6 + Math.random() * 0.8);
      parts.push({
        x, y,
        vx: (Math.random() - 0.5) * (o.spread || 4),
        vy: -Math.random() * (o.up || 3) - (o.base || 0),
        g: o.g === undefined ? 0.15 : o.g,
        life, max: life,
        size: (o.size || 3) * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        square: !!o.square
      });
    }
  }
  const DUST = ['#d9c39a', '#c2a878', '#e8d9b5'];
  const GOLD = ['#ffd23f', '#fff3a0', '#ffb703'];
  const WATER = ['#bfefff', '#7fd6f0', '#ffffff'];
  const CONFETTI = ['#006a4e', '#f42a41', '#ffd23f', '#ffffff', '#4cc3e0'];

  // ---------- Physics ----------
  function solidAt(c, r) {
    if (c < 0 || c >= COLS) return true;
    if (r < 0 || r >= ROWS) return false;
    return grid[r][c] > EMPTY;
  }

  // Moves an entity and resolves tile collisions (X first, then Y).
  // Returns true if it hit a wall horizontally.
  function moveEntity(e, onHeadHit) {
    let hitX = false;

    e.x += e.vx;
    if (e.vx !== 0) {
      const left = Math.floor(e.x / T);
      const right = Math.floor((e.x + e.w - 1) / T);
      const top = Math.floor(e.y / T);
      const bot = Math.floor((e.y + e.h - 1) / T);
      for (let r = top; r <= bot; r++) {
        if (e.vx > 0 && solidAt(right, r)) { e.x = right * T - e.w; hitX = true; break; }
        if (e.vx < 0 && solidAt(left, r)) { e.x = (left + 1) * T; hitX = true; break; }
      }
    }

    e.y += e.vy;
    e.onGround = false;
    const left = Math.floor(e.x / T);
    const right = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      const bot = Math.floor((e.y + e.h - 1) / T);
      for (let c = left; c <= right; c++) {
        if (solidAt(c, bot)) { e.y = bot * T - e.h; e.vy = 0; e.onGround = true; break; }
      }
    } else if (e.vy < 0) {
      const top = Math.floor(e.y / T);
      const centre = (e.x + e.w / 2) / T;
      let bestC = -1;
      for (let c = left; c <= right; c++) {
        if (solidAt(c, top) && (bestC < 0 || Math.abs(c + 0.5 - centre) < Math.abs(bestC + 0.5 - centre))) bestC = c;
      }
      if (bestC >= 0) {
        e.y = (top + 1) * T; e.vy = 0;
        if (onHeadHit) onHeadHit(bestC, top);
      }
    }
    return hitX;
  }

  function hitBlockFromBelow(c, r) {
    if (grid[r][c] === QBLOCK) {
      grid[r][c] = USED;
      coinCount++; score += 100;
      effects.push({ kind: 'coin', x: c * T + T / 2, y: r * T, vy: -7, life: 28 });
      effects.push({ kind: 'text', text: '+100', x: c * T + T / 2, y: r * T - 10, vy: -1, life: 40 });
      burst(c * T + T / 2, r * T + T, 10, GOLD, { spread: 5, up: 3, size: 3 });
      beep('coin');
      updateHud();
    } else {
      beep('bump');
    }
  }

  // ---------- Update ----------
  function die(inWater) {
    if (state !== 'play') return;
    state = 'dying';
    lives--;
    drowning = !!inWater;
    player.vx = 0;
    player.vy = inWater ? -5 : -10;
    shake = inWater ? 5 : 12;
    if (inWater) {
      burst(player.x + player.w / 2, GROUND_ROW * T + 10, 22, WATER, { spread: 7, up: 6, base: 2, g: 0.25, size: 3 });
      beep('splash');
    } else {
      beep('die');
    }
    saveBest();
    updateHud();
  }

  function afterDeath() {
    if (lives <= 0) {
      state = 'over';
      showOverlay('খেলা শেষ!', 'স্কোর: ' + score + '  |  সেরা: ' + best + ' — আবার চেষ্টা করবে?', 'আবার খেলো', false);
    } else {
      resetPlayer(checkpointX);
      // snap camera to the checkpoint so the player is not pushed forward
      camX = Math.max(0, Math.min(COLS * T - W, checkpointX + player.w / 2 - W * 0.4));
      player.invul = 120;
      drowning = false;
      state = 'play';
    }
  }

  function update() {
    frame++;
    updateEffects();

    if (state === 'win') {
      winFrame++;
      const gy = GROUND_ROW * T - player.h - 1;      // come down to the ground
      if (player.y < gy) { player.vy += GRAVITY; player.y = Math.min(gy, player.y + player.vy); }
      else { player.y = gy; player.vy = 0; player.onGround = true; }
      if (winFrame === 150) {   // farmer shouts first, then the result card appears
        const record = score >= best && score > 0;
        showOverlay(
          'অভিনন্দন!',
          'তুমি পতাকার কাছে পৌঁছে গেছো! স্কোর: ' + score + ' | ধান: ' + coinCount + (record ? '  — নতুন রেকর্ড! 🏆' : ''),
          'আবার খেলো', false
        );
      }
    }
    if (state === 'win' && frame % 3 === 0) {
      burst(FLAG_COL * T + 40 + (Math.random() - 0.5) * 500, 60, 3, CONFETTI,
        { spread: 3, up: 1, g: 0.07, life: 140, size: 3.2, square: true });
    }

    if (state === 'dying') {
      player.vy += GRAVITY;
      player.y += player.vy;
      if (player.y > H + 150) afterDeath();
      return;
    }
    if (state !== 'play') return;

    const p = player;
    if (hint > 0) hint--;

    // Auto-run. Left = slow down / step back, right = speed up (touch drag or arrow keys)
    p.vx += (AUTO_SPEED - p.vx) * 0.25;
    p.face = 1;

    // Jump: with a short input buffer and "coyote time" so clicks/taps feel forgiving
    const jd = input.kb || input.pointer || input.pulse > 0;
    if (input.pulse > 0) input.pulse--;
    if (jd && !p.jumpHeld) p.buffer = 9;
    if (p.buffer > 0) p.buffer--;
    if (p.onGround) p.coyote = 7; else if (p.coyote > 0) p.coyote--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.onGround = false;
      p.buffer = 0; p.coyote = 0; p.jumpAge = 0;
      burst(p.x + p.w / 2, p.y + p.h, 5, DUST, { spread: 3, up: 1.5, size: 3 });
      beep('jump');
    }
    p.jumpHeld = jd;
    p.jumpAge++;
    // Releasing early = shorter hop (but a quick click still gives a decent jump)
    if (!jd && p.jumpAge > 6 && p.vy < -6) p.vy = -6;

    const wasGround = p.onGround;
    const preVy = p.vy;
    p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
    p.prevY = p.y;
    moveEntity(p, hitBlockFromBelow);

    // Do not walk off the left edge of the screen
    if (p.x < camX + 2) { p.x = camX + 2; p.vx = Math.max(p.vx, 0); }

    if (!wasGround && p.onGround && preVy > 3) {
      burst(p.x + p.w / 2, p.y + p.h, 6, DUST, { spread: 4, up: 1.5, size: 3 });
    }
    if (p.onGround && frame % 6 === 0) {
      burst(p.x + 4, p.y + p.h - 2, 1, DUST, { spread: 1.5, up: 1.2, size: 2.5, life: 22 });
    }

    if (p.invul > 0) p.invul--;

    // Checkpoints
    if (p.x > 105 * T) checkpointX = 105 * T;
    else if (p.x > 55 * T) checkpointX = Math.max(checkpointX, 55 * T);

    // Fell into a pond
    if (p.y > GROUND_ROW * T + 14 || p.y > H + 40) { die(true); return; }

    // Dhan: collected by the farmer OR by the cursor
    for (const c of coins) {
      if (c.got) continue;
      const byFarmer = Math.abs(c.x - (p.x + p.w / 2)) < 30 && Math.abs(c.y - (p.y + p.h / 2)) < 38;
      if (byFarmer) {
        c.got = true;
        coinCount++; score += 50;
        effects.push({ kind: 'text', text: '+50', x: c.x, y: c.y - 10, vy: -1, life: 30 });
        burst(c.x, c.y, 8, GOLD, { spread: 5, up: 3, size: 2.5, life: 24 });
        beep('coin');
        updateHud();
      }
    }

    // Pests
    for (const e of enemies) {
      if (!e.alive) { if (e.squash > 0) e.squash--; continue; }
      if (Math.abs(e.x - p.x) > W + 100) continue;

      e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);
      const hitWall = moveEntity(e);
      if (hitWall) e.vx = -e.vx;
      if (e.onGround) {
        const aheadCol = Math.floor((e.vx > 0 ? e.x + e.w + 2 : e.x - 2) / T);
        const belowRow = Math.floor((e.y + e.h + 2) / T);
        if (!solidAt(aheadCol, belowRow)) e.vx = -e.vx;
      }
      if (e.y > H + 100) { e.alive = false; e.squash = 0; continue; }

      const overlap =
        p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y;
      if (!overlap) continue;

      if (p.vy > 0 && p.prevY + p.h <= e.y + 14) {
        e.alive = false; e.squash = 25;
        p.vy = jd ? -10 : -7;
        p.jumpAge = 0;
        score += 200;
        effects.push({ kind: 'text', text: '+200', x: e.x + e.w / 2, y: e.y - 6, vy: -1, life: 40 });
        burst(e.x + e.w / 2, e.y + e.h, 12, ['#7b3f12', '#9a5520', '#ffd23f'], { spread: 6, up: 3, size: 3 });
        beep('stomp');
        updateHud();
      } else if (p.invul === 0) {
        die(false);
        return;
      }
    }

    // Reached the flag!
    if (p.x + p.w > FLAG_COL * T + 8) {
      state = 'win';
      winFrame = 0;
      score += lives * 500;
      saveBest();
      beep('win');
      shoutYea();
      player.vx = 0;
    }

    // Camera
    const target = p.x + p.w / 2 - W * 0.4;
    camX += (Math.max(0, Math.min(COLS * T - W, target)) - camX) * 0.15;

    // Progress bar
    const pct = Math.max(0, Math.min(100, Math.round((p.x / (FLAG_COL * T)) * 100)));
    if (pct !== lastPct) {
      lastPct = pct;
      elFill.style.width = pct + '%';
      elDot.style.left = pct + '%';
    }
  }

  function updateEffects() {
    for (const f of effects) {
      f.life--;
      if (f.kind === 'coin') { f.vy += 0.5; f.y += f.vy; }
      else f.y += f.vy;
    }
    effects = effects.filter((f) => f.life > 0);

    for (const q of parts) {
      q.life--;
      q.x += q.vx; q.y += q.vy; q.vy += q.g;
    }
    parts = parts.filter((q) => q.life > 0);

    if (shake > 0.2) shake *= 0.86; else shake = 0;
  }

  // ---------- Drawing: background ----------
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.85);
    sky.addColorStop(0, '#3fa7e6');
    sky.addColorStop(0.6, '#a8dcf5');
    sky.addColorStop(1, '#eafaff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun with soft glow
    const sunG = ctx.createRadialGradient(W - 140, 90, 10, W - 140, 90, 110);
    sunG.addColorStop(0, 'rgba(255,240,150,1)');
    sunG.addColorStop(0.4, 'rgba(255,214,70,.9)');
    sunG.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(W - 140, 90, 110, 0, Math.PI * 2); ctx.fill();

    // Clouds (slow parallax)
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    const cp = 420;
    for (let i = -1; i < W / cp + 2; i++) {
      const ox = i * cp - ((camX * 0.15 + frame * 0.1) % cp);
      cloud(ox + 80, 80, 1);
      cloud(ox + 290, 130, 0.7);
    }

    drawBirds();

    // Far misty hills
    ctx.fillStyle = '#b5ddc0';
    ctx.beginPath(); ctx.moveTo(0, 470);
    for (let x = 0; x <= W; x += 20) {
      const wx = x + camX * 0.15;
      ctx.lineTo(x, 380 + Math.sin(wx * 0.005 + 1) * 20 + Math.sin(wx * 0.013) * 10);
    }
    ctx.lineTo(W, 470); ctx.closePath(); ctx.fill();

    // Near green hills
    ctx.fillStyle = '#8bc48a';
    ctx.beginPath(); ctx.moveTo(0, 470);
    for (let x = 0; x <= W; x += 20) {
      const wx = x + camX * 0.3;
      ctx.lineTo(x, 400 + Math.sin(wx * 0.006) * 24 + Math.sin(wx * 0.017) * 10);
    }
    ctx.lineTo(W, 470); ctx.closePath(); ctx.fill();

    // Village: huts and palm trees (mid parallax)
    const hp = 560;
    for (let i = -1; i < W / hp + 2; i++) {
      const ox = i * hp - ((camX * 0.5) % hp);
      hut(ox + 120, GROUND_ROW * T);
      palm(ox + 300, GROUND_ROW * T, 1);
      palm(ox + 350, GROUND_ROW * T, 0.8);
      hut(ox + 470, GROUND_ROW * T);
    }

    // Paddy field strip behind the ground (gently swaying)
    const fp = 48;
    for (let i = -1; i < W / fp + 2; i++) {
      const ox = i * fp - ((camX * 0.8) % fp);
      ctx.fillStyle = i % 2 ? '#7cc24a' : '#8fd45a';
      ctx.fillRect(ox, GROUND_ROW * T - 14, fp, 14);
      ctx.fillStyle = '#5da33a';
      for (let k = 0; k < 4; k++) {
        const sway = Math.sin(frame * 0.05 + (ox + k * 11) * 0.05) * 1.5;
        ctx.fillRect(ox + 6 + k * 11 + sway, GROUND_ROW * T - 20, 2, 8);
      }
    }
  }

  function drawBirds() {
    ctx.strokeStyle = '#2b3a42'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const span = W + 200;
    for (let i = 0; i < 4; i++) {
      const x = (((i * 290 + frame * 0.6 - camX * 0.1) % span) + span) % span - 100;
      const y = 60 + i * 24 + Math.sin(frame * 0.03 + i) * 8;
      const wing = Math.sin(frame * 0.2 + i * 2) * 5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y + wing); ctx.quadraticCurveTo(x - 4, y - 4, x, y);
      ctx.quadraticCurveTo(x + 4, y - 4, x + 9, y + wing);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, 7);
    ctx.arc(x + 26 * s, y - 10 * s, 28 * s, 0, 7);
    ctx.arc(x + 56 * s, y, 22 * s, 0, 7);
    ctx.rect(x, y, 56 * s, 22 * s);
    ctx.fill();
  }

  function hut(x, groundY) {
    ctx.fillStyle = '#c9a66b';            // mud walls
    ctx.fillRect(x, groundY - 46, 82, 46);
    ctx.fillStyle = '#7a5c2e';            // door
    ctx.fillRect(x + 32, groundY - 30, 18, 30);
    ctx.fillStyle = '#9b7a35';            // thatched roof
    ctx.beginPath();
    ctx.moveTo(x - 12, groundY - 44);
    ctx.lineTo(x + 41, groundY - 86);
    ctx.lineTo(x + 94, groundY - 44);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6e5424'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 41, groundY - 86);
      ctx.lineTo(x - 12 + i * 26, groundY - 44);
      ctx.stroke();
    }
  }

  function palm(x, groundY, s) {
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 9 * s; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.quadraticCurveTo(x + 14 * s, groundY - 70 * s, x + 4 * s, groundY - 130 * s);
    ctx.stroke();
    ctx.strokeStyle = '#2f8f46'; ctx.lineWidth = 6 * s;
    const tx = x + 4 * s, ty = groundY - 130 * s;
    const sw = Math.sin(frame * 0.03 + x * 0.01) * 4 * s;
    for (let a = -2; a <= 2; a++) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + a * 22 * s, ty - 30 * s, tx + a * 36 * s + sw, ty + 12 * s);
      ctx.stroke();
    }
    ctx.fillStyle = '#5b3a1e';            // coconuts
    ctx.beginPath(); ctx.arc(tx - 4 * s, ty + 6 * s, 5 * s, 0, 7); ctx.arc(tx + 6 * s, ty + 8 * s, 5 * s, 0, 7); ctx.fill();
    ctx.lineCap = 'butt';
  }

  // ---------- Drawing: ponds (the pits) with shapla (water lilies) ----------
  function drawWater(alpha) {
    for (const g of GAPS) {
      const x = Math.round(g[0] * T - camX), w = (g[1] - g[0] + 1) * T;
      if (x > W || x + w < 0) continue;
      const y0 = GROUND_ROW * T + 8;
      ctx.save();
      ctx.globalAlpha = alpha;
      const gr = ctx.createLinearGradient(0, y0, 0, H);
      gr.addColorStop(0, '#5ad0e8');
      gr.addColorStop(1, '#14608a');
      ctx.fillStyle = gr;
      ctx.fillRect(x, y0, w, H - y0);

      ctx.fillStyle = 'rgba(255,255,255,.6)';           // ripples
      for (let i = 0; i < w; i += 14) {
        const wy = y0 + 3 + Math.sin(frame * 0.08 + (x + i) * 0.12) * 2;
        ctx.fillRect(x + i, wy, 8, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      for (let i = 6; i < w; i += 22) ctx.fillRect(x + i, y0 + 22 + Math.sin(frame * 0.05 + i) * 2, 10, 2);

      for (const fx of [0.3, 0.72]) {                    // shapla
        const cx = x + w * fx, cy = y0 + 2 + Math.sin(frame * 0.06 + fx * 9) * 1.5;
        ctx.fillStyle = '#2f9e57';
        ctx.beginPath(); ctx.ellipse(cx, cy + 3, 12, 4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff';
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath(); ctx.ellipse(cx + k * 4, cy - 3, 2.6, 6, k * 0.5, 0, 7); ctx.fill();
        }
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------- Drawing: tiles ----------
  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camX / T));
    const c1 = Math.min(COLS - 1, Math.floor((camX + W) / T));
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = grid[r][c];
        if (t === EMPTY) continue;
        const x = Math.round(c * T - camX), y = r * T;
        switch (t) {
          case GRASS:
            ctx.fillStyle = '#8d5a2b'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(x, y, T, 9);
            ctx.fillStyle = '#6cc66a';
            for (let k = 0; k < 4; k++) ctx.fillRect(x + 3 + k * 9, y + 9, 3, 4);
            break;
          case SOIL:
            ctx.fillStyle = '#76481f'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#8d5a2b';
            ctx.fillRect(x + 5, y + 7, 8, 5); ctx.fillRect(x + 20, y + 21, 9, 5);
            break;
          case BRICK:
            ctx.fillStyle = '#c8553d'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x + 2, y + 2, T - 4, 4);
            ctx.strokeStyle = '#7a2e1f'; ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
            ctx.beginPath();
            ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2);
            ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T / 2);
            ctx.moveTo(x + T / 4, y + T / 2); ctx.lineTo(x + T / 4, y + T);
            ctx.moveTo(x + 3 * T / 4, y + T / 2); ctx.lineTo(x + 3 * T / 4, y + T);
            ctx.stroke();
            break;
          case QBLOCK: {
            ctx.fillStyle = '#f2b632'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x + 3, y + 3, T - 6, 5);
            ctx.strokeStyle = '#a8741a'; ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
            const bob = Math.sin(frame * 0.1) * 1.5;
            ctx.fillStyle = '#fff3c4';
            ctx.font = 'bold 24px "Hind Siliguri", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('?', x + T / 2, y + 26 + bob);
            break;
          }
          case USED:
            ctx.fillStyle = '#a08a63'; ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = '#6e5d3f'; ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
            break;
        }
      }
    }
  }

  // ---------- Drawing: flag (Bangladesh flag) ----------
  function drawFlag() {
    const x = FLAG_COL * T - camX + 14;
    if (x < -120 || x > W + 50) return;
    const top = 4 * T, bottom = GROUND_ROW * T;
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(x, top, 6, bottom - top);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(x + 3, top, 7, 0, 7); ctx.fill();
    const fw = 90, fh = 54, fy = top + 8;
    ctx.fillStyle = '#006a4e';
    ctx.beginPath();
    ctx.moveTo(x + 6, fy);
    for (let i = 0; i <= fw; i += 6) ctx.lineTo(x + 6 + i, fy + Math.sin(frame * 0.12 + i * 0.08) * 3);
    for (let i = fw; i >= 0; i -= 6) ctx.lineTo(x + 6 + i, fy + fh + Math.sin(frame * 0.12 + i * 0.08) * 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f42a41';
    ctx.beginPath();
    ctx.arc(x + 6 + fw * 0.45, fy + fh / 2 + Math.sin(frame * 0.12 + fw * 0.036) * 3, fh * 0.3, 0, 7);
    ctx.fill();
  }

  // ---------- Drawing: dhan coins ----------
  function drawCoins() {
    for (const c of coins) {
      if (c.got) continue;
      const x = c.x - camX;
      if (x < -20 || x > W + 20) continue;
      const sx = Math.abs(Math.cos(frame * 0.08 + c.x * 0.02));
      ctx.fillStyle = '#e8a317';
      ctx.beginPath(); ctx.ellipse(x, c.y, 9 * sx + 1.5, 11, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.ellipse(x, c.y, 6 * sx + 1, 8, 0, 0, 7); ctx.fill();
    }
  }

  // ---------- Drawing: pest (poka) ----------
  function drawEnemy(e) {
    const x = e.x - camX;
    if (x < -50 || x > W + 50) return;
    if (!e.alive) {
      if (e.squash > 0) {
        ctx.fillStyle = '#5a3418';
        ctx.beginPath(); ctx.ellipse(x + e.w / 2, e.y + e.h - 3, 17, 4, 0, 0, 7); ctx.fill();
      }
      return;
    }
    const cx = x + e.w / 2, cy = e.y + e.h / 2;
    const step = Math.sin(frame * 0.3) * 3;
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 2.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(cx + i * 8, cy + 4); ctx.lineTo(cx + i * 12 + step * i, cy + 13); ctx.stroke();
    }
    ctx.fillStyle = '#7b3f12';
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 15, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#9a5520';
    ctx.beginPath(); ctx.ellipse(cx - 3, cy - 2, 7, 5, -0.4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4b2508'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 13); ctx.stroke();
    const d = e.vx > 0 ? 1 : -1;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx + d * 8, cy - 4, 4, 0, 7); ctx.arc(cx + d * 2, cy - 6, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx + d * 9, cy - 4, 1.8, 0, 7); ctx.arc(cx + d * 3, cy - 6, 1.8, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + d * 5, cy - 11); ctx.lineTo(cx + d * 12, cy - 7);
    ctx.stroke();
  }

  // ---------- Drawing: the farmer ----------
  // Lungi (checked wrap), jama (panjabi shirt) and a gamcha tied on the head.
  function drawFarmer(p) {
    if (p.invul > 0 && state === 'play' && Math.floor(frame / 4) % 2) return; // blink
    const sx = Math.round(p.x - camX + p.w / 2);
    const sy = Math.round(p.y);
    const moving = Math.abs(p.vx) > 0.4 && p.onGround;
    const air = !p.onGround;
    const dance = state === 'win';                    // victory dance: sway the waist!
    const ph = dance ? Math.sin(frame * 0.3)
      : moving ? Math.sin(frame * 0.3 * Math.max(0.8, Math.abs(p.vx) / 3.2)) : 0;
    const skin = '#b9773a';

    // soft shadow on the ground
    if (state === 'play' || state === 'start') {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(sx, GROUND_ROW * T + 2, air ? 10 : 14, 3.5, 0, 0, 7); ctx.fill();
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(p.face, 1);

    // Legs + bare feet
    ctx.fillStyle = skin;
    if (air) {
      ctx.fillRect(-9, 38, 5, 6); ctx.fillRect(4, 36, 5, 6);
    } else {
      ctx.fillRect(-8 + ph * 4, 38, 5, 6);
      ctx.fillRect(3 - ph * 4, 38, 5, 6);
    }
    ctx.fillStyle = '#5b3516';
    if (air) { ctx.fillRect(-10, 43, 8, 2); ctx.fillRect(4, 41, 8, 2); }
    else { ctx.fillRect(-9 + ph * 4, 43, 8, 2); ctx.fillRect(3 - ph * 4, 43, 8, 2); }

    // Whole upper body swings from the hips (waist dance)
    if (dance) {
      ctx.save();
      ctx.translate(Math.sin(frame * 0.3) * 3, 30);
      ctx.rotate(Math.sin(frame * 0.3) * 0.22);
      ctx.translate(0, -30);
    }

    // Lungi: green checked cloth wrapped around the waist
    const sway = dance ? ph * 5 : moving ? ph * 2 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-10, 30); ctx.lineTo(10, 30);
    ctx.lineTo(12 + sway, 41); ctx.lineTo(-12 + sway, 41);
    ctx.closePath();
    ctx.fillStyle = '#1b7f5c'; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    for (let i = -12; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(i, 28); ctx.lineTo(i, 42); ctx.stroke(); }
    for (let j = 30; j <= 42; j += 5) { ctx.beginPath(); ctx.moveTo(-14, j); ctx.lineTo(14, j); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(8,60,40,.6)';
    for (let i = -9; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(i, 28); ctx.lineTo(i, 42); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#d6a22b';
    ctx.fillRect(-10, 29, 20, 3);

    // Jama (panjabi): off-white long shirt
    ctx.fillStyle = '#f8f4e3';
    ctx.strokeStyle = '#bdb594'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, 19); ctx.lineTo(9, 19); ctx.lineTo(10, 33); ctx.lineTo(-10, 33);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 19); ctx.lineTo(0, 27); ctx.stroke();
    ctx.fillStyle = '#8c8566';
    ctx.fillRect(-1, 21, 2, 2); ctx.fillRect(-1, 25, 2, 2);

    // Arms
    const armA = dance ? -2.2 + Math.sin(frame * 0.3 + 1) * 0.5 : air ? -2.2 : ph * 0.9;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 9, 21);
      if (dance) ctx.rotate(-s * (2.5 + Math.sin(frame * 0.3 + (s === 1 ? 0 : 1.6)) * 0.35));  // arms up, opposite sides
      else ctx.rotate(s * armA * (s === 1 ? 1 : -1) + (s === 1 ? 0.15 : -0.15));
      ctx.fillStyle = '#f8f4e3';
      ctx.fillRect(-2.5, 0, 5, 10);
      ctx.strokeRect(-2.5, 0, 5, 10);
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, 12, 3, 0, 7); ctx.fill();
      ctx.restore();
    }

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, 13, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#8f5a28';
    ctx.beginPath(); ctx.arc(-7, 14, 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(4, 12, 2.4, 2.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(4.8, 12, 1.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a1608';
    ctx.fillRect(1, 16, 8, 2);
    ctx.fillStyle = '#7a3f1d';
    ctx.fillRect(3, 19, 4, 1);

    // Gamcha: red-and-white checked towel tied on the head
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 11, 9.5, Math.PI, 0);
    ctx.lineTo(9.5, 11); ctx.lineTo(-9.5, 11);
    ctx.closePath();
    ctx.fillStyle = '#d62828'; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.3;
    for (let i = -10; i <= 10; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 12); ctx.stroke(); }
    for (let j = 2; j <= 11; j += 4) { ctx.beginPath(); ctx.moveTo(-10, j); ctx.lineTo(10, j); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#d62828';
    const flap = Math.sin(frame * 0.25) * (moving || air ? 3 : 1);
    ctx.beginPath();
    ctx.moveTo(-8, 7); ctx.lineTo(-16, 10 + flap); ctx.lineTo(-14, 15 + flap); ctx.lineTo(-7, 11);
    ctx.closePath(); ctx.fill();

    if (dance) ctx.restore();   // end of waist swing
    ctx.restore();
  }

  // ---------- Drawing: particles, effects, cursor ----------
  function drawParts() {
    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life / q.max));
      ctx.fillStyle = q.color;
      const x = q.x - camX;
      if (q.square) ctx.fillRect(x, q.y, q.size * 1.4, q.size);
      else { ctx.beginPath(); ctx.arc(x, q.y, q.size, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects() {
    ctx.textAlign = 'center';
    for (const f of effects) {
      const x = f.x - camX;
      if (f.kind === 'coin') {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.ellipse(x, f.y, 7, 10, 0, 0, 7); ctx.fill();
      } else {
        ctx.font = 'bold 18px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1b4332'; ctx.lineWidth = 3;
        ctx.strokeText(f.text, x, f.y); ctx.fillText(f.text, x, f.y);
      }
    }
  }

  function drawHint() {
    if (hint <= 0 || state !== 'play') return;
    const a = Math.min(1, hint / 50);
    const text = 'স্ক্রিনে ট্যাপ / ক্লিক করো = লাফ';
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 22px "Hind Siliguri", sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 36;
    ctx.fillStyle = 'rgba(8,28,21,.72)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(W / 2 - w / 2, 28, w, 42, 21); else ctx.rect(W / 2 - w / 2, 28, w, 42);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(text, W / 2, 57);
    ctx.restore();
  }

  // ---------- Drawing: farmer's speech bubble (win) ----------
  function drawShout() {
    if (state !== 'win') return;
    const p = player;
    const pop = Math.min(1, winFrame / 12);
    const bob = Math.sin(frame * 0.15) * 3;
    const text = 'Yeah!';
    ctx.save();
    ctx.font = 'bold 30px "Hind Siliguri", sans-serif';
    ctx.textAlign = 'center';
    const bw = ctx.measureText(text).width + 36, bh = 52;
    const cx = Math.round(p.x - camX + p.w / 2);
    const by = p.y - bh - 26 + bob;
    ctx.translate(cx, p.y - 10);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -(p.y - 10));
    ctx.fillStyle = '#fff8e7';
    ctx.strokeStyle = '#1b7f5c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - bw / 2, by, bw, bh, 18); else ctx.rect(cx - bw / 2, by, bw, bh);
    ctx.fill(); ctx.stroke();
    // tail pointing at the farmer's head
    ctx.beginPath();
    ctx.moveTo(cx - 10, by + bh - 1);
    ctx.lineTo(cx, by + bh + 16);
    ctx.lineTo(cx + 10, by + bh - 1);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff8e7';
    ctx.fillRect(cx - 8, by + bh - 4, 16, 6);
    ctx.fillStyle = '#d62828';
    ctx.fillText(text, cx, by + 37);
    ctx.restore();
  }

  // ---------- Render ----------
  function render() {
    ctx.clearRect(0, 0, W, H);
    if (!grid) { drawBackground(); return; }
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground();
    drawWater(1);
    drawTiles();
    drawFlag();
    drawCoins();
    enemies.forEach(drawEnemy);
    drawFarmer(player);
    if (drowning) drawWater(0.8);   // water in front of the farmer = sinking
    drawParts();
    drawEffects();
    drawShout();
    ctx.restore();
    drawHint();
  }

  // ---------- Main loop (fixed 60 updates / second) ----------
  let last = 0, acc = 0;
  const STEP = 1000 / 60;
  function loop(ts) {
    if (!last) last = ts;
    acc += Math.min(100, ts - last);
    last = ts;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }

  // Show the title screen over a preview of level 1
  buildLevel();
  score = 0; coinCount = 0; lives = 5; camX = 0; checkpointX = 3 * T;
  resetPlayer(3 * T);
  updateHud();
  requestAnimationFrame(loop);
})();