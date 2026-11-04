"use strict";
// ---------- config ----------
const T = 56, G = 6, STEP = T + G;
const START_TIME = 20, MAX_TIME = 40;
const MARATHON_WORDS = 30, HARDCORE_PENALTY = 3;
const BEST_KEY = { normal: "wordwalker-best", marathon: "wordwalker-best-marathon", hardcore: "wordwalker-best-hardcore" };
// Scrabble letter values
const LV = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};
const AUDIO = {
  type: "audio/type.mp3",
  backspace: "audio/backspace.mp3",
  correct: "audio/correct.mp3",
  invalid: "audio/invalid.mp3",
  hint: "audio/hint.mp3",
  score1: "audio/score1.mp3",
  score2: "audio/score2.mp3",
  score3: "audio/score3.mp3",
  score4: "audio/score4.mp3",
  score5: "audio/score5.mp3",
  score6: "audio/score6.mp3",
  music: "audio/music.mp3",
};

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const world = $("world"), overlay = $("overlay"), toastEl = $("toast"), kb = $("kb");
const scoreEl = $("score"), wordsEl = $("words"), clockEl = $("clock");
const barEl = $("clockbar"), clockText = $("clocktext");
const hintBtn = $("hint"), hintNum = $("hintnum");

// ---------- audio ----------
const snd = {};
for (const k in AUDIO) { const a = new Audio(AUDIO[k]); a.preload = "auto"; snd[k] = a; }
snd.music.loop = true; snd.music.volume = 0.35;
let muted = false;
function play(name, vol = 0.7) {
  if (muted) return;
  try { const a = snd[name].cloneNode(); a.volume = vol; a.play().catch(() => {}); } catch (e) {}
}
function startMusic() { if (!muted) snd.music.play().catch(() => {}); }
$("mute").onclick = () => {
  muted = !muted;
  $("mute").classList.toggle("muted", muted);
  muted ? snd.music.pause() : (running && startMusic());
  running && focusKb();
};

// ---------- word list (fetched once, then kept in localStorage) ----------
let WORDS = new Set(), BYLEN = null;

// Words grouped by length
function byLen(L) {
  if (!BYLEN) { BYLEN = []; for (const w of WORDS) (BYLEN[w.length] ||= []).push(w); }
  return BYLEN[L] || [];
}

async function loadWords() {
  let txt;
  try { txt = localStorage.getItem("wordwalker_words"); } catch (e) {}
  if (!txt) {
    txt = await (await fetch("words.txt")).text();
    try { localStorage.setItem("wordwalker_words", txt); } catch (e) {}
  }
  WORDS = new Set(txt.trim().toLowerCase().split(/\s+/)); BYLEN = null;
}

// ---------- state ----------
let tiles, used, seg, score, count, time, running = false, last = 0, mStart = 0, finalMs = 0;
let started = false, hints = 2, log = [], hintTimers = [], endTimers = []; // started = clock running (after the 3rd word)
// bests[normal/hardcore] = score, bests.marathon = fastest time in ms
const bests = {};
for (const m in BEST_KEY) { try { bests[m] = +localStorage.getItem(BEST_KEY[m]) || 0; } catch (e) { bests[m] = 0; } }
let mode = "normal";
try { mode = localStorage.getItem("wordwalker-mode") || "normal"; } catch (e) {}
if (!BEST_KEY[mode]) mode = "normal";
// 75.3 -> "1:15.3", 8.2 -> "8.2s"
function fmt(sec) {
  const t = Math.round(sec * 10), m = Math.floor(t / 600), r = (t % 600) / 10;
  return m ? m + ":" + r.toFixed(1).padStart(4, "0") : r.toFixed(1) + "s";
}
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("show"), 1100);
}

// ---------- tutorial (first two words) ----------
const tutEl = $("tutorial");
function updateTutorial() {
  if (count >= 2) { tutEl.classList.remove("show"); return; }
  tutEl.innerHTML = count === 0
    ? `Type a <b>${seg.L}</b> letter word`
    : `Now, type a <b>${seg.L}</b> letter word that starts with <b>${seg.cells[seg.a].prov.toUpperCase()}</b>`;
  tutEl.classList.add("show");
}

// ---------- segments ----------
function makeCell(x, y, mult) {
  const el = document.createElement("div");
  el.className = "tile" + (mult === 2 ? " x2" : mult === 3 ? " x3" : "");
  el.style.left = x * STEP + "px"; el.style.top = y * STEP + "px";
  el.innerHTML = '<span class="l"></span>' + (mult > 1 ? `<span class="m">x${mult}</span>` : "") + '<span class="p"></span><span class="g"></span>';
  world.appendChild(el);
  const c = { x, y, el, mult };
  tiles.set(x + "," + y, c);
  return c;
}

function randMult() {
  const p3 = Math.min(0.14, 0.04 + count * 0.004), p2 = Math.min(0.22, 0.1 + count * 0.006), r = Math.random();
  return r < p3 ? 3 : r < p3 + p2 ? 2 : 1;
}

function newSegment(prev) {
  let dir, L, a, px = 0, py = 0, fx = new Set();
  if (!prev) { dir = 0; L = rnd(3, 6); a = -1; }
  else {
    dir = 1 - prev.dir; px = prev.cells[prev.L - 1].x; py = prev.cells[prev.L - 1].y;
    const maxLen = count < 4 ? 6 : count < 8 ? 7 : count < 12 ? 8 : 9;
    const minLen = count < 10 ? 3 : count < 20 ? 4 : 5;
    const pAnchor = count < 3 ? 0 : Math.min(0.7, (count - 2) * 0.08);
    const dx = dir === 0 ? 1 : 0, dy = dir === 1 ? 1 : 0;
    const fits = (l, an) => { for (let i = 0; i < l; i++) if (i !== an && tiles.has((px + dx * (i - an)) + "," + (py + dy * (i - an)))) return false; return true; };
    for (let tries = 0; ; tries++) {
      L = tries < 30 ? rnd(minLen, maxLen) : 3;
      a = Math.random() < pAnchor && tries < 30 ? rnd(1, L - 1) : 0;
      if (fits(L, a) || tries > 60) break;
    }
    fx.add(a);
  }
  const dx = dir === 0 ? 1 : 0, dy = dir === 1 ? 1 : 0, cells = [];
  for (let i = 0; i < L; i++) {
    const x = px + dx * (i - Math.max(a, 0)), y = py + dy * (i - Math.max(a, 0));
    if (fx.has(i)) { // fixed letter: an existing tile, shown dimmed until typed
      const c = tiles.get(x + "," + y);
      c.el.className = "tile pending"; const m = c.el.querySelector(".m"); if (m) m.remove();
      c.el.querySelector(".p").textContent = ""; c.el.querySelector(".g").textContent = "";
      c.mult = 1; c.prov = c.letter; c.el.firstChild.textContent = c.prov;
      cells.push(c);
    } else cells.push(makeCell(x, y, randMult()));
  }
  clearHint();
  seg = { dir, L, a, fx, cells, buf: [], t0: performance.now(), hinted: false, hintWord: null };
  updateTutorial();
  render();
}

world.style.transformOrigin = "0 0";
const visible = () => window.visualViewport || { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 };

// Centers a box of tiles (grid coords) in the *visible* area (the on-screen keyboard
// shrinks the visual viewport), zooming out until it fits. Never zooms in past 1x.
function fit(minX, maxX, minY, maxY, minZoom) {
  const w = (maxX - minX) * STEP + T, h = (maxY - minY) * STEP + T;
  const mx = minX * STEP + w / 2, my = minY * STEP + h / 2;
  const vv = visible();
  const s = Math.max(minZoom, Math.min(1, (vv.width - 32) / w, (vv.height - 100) / h));
  const cx = vv.offsetLeft + vv.width / 2, cy = vv.offsetTop + vv.height / 2 + 30;
  world.style.transform = `translate(${cx - mx * s}px,${cy - my * s}px) scale(${s})`;
}

// Frames the whole current word.
function render() {
  world.querySelectorAll(".cursor").forEach((e) => e.classList.remove("cursor"));
  seg.cells[Math.min(seg.buf.length, seg.L - 1)].el.classList.add("cursor");
  const a = seg.cells[0], b = seg.cells[seg.L - 1];
  fit(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y), 0.3);
}

// Frames the entire map (used when the game ends).
function showAll() {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of tiles.values()) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
  fit(x0, x1, y0, y1, 0.04);
}

// ---------- input ----------
function type(ch) {
  if (!running || seg.buf.length >= seg.L) return;
  const i = seg.buf.length, c = seg.cells[i];
  if (seg.fx.has(i) && ch !== c.prov) { flash(c.el, "bad"); play("invalid", 0.5); return; }
  if (count === 0 && !seg.touched) { seg.touched = true; seg.t0 = performance.now(); if (mode === "marathon") mStart = seg.t0; } // first word is timed from its first letter
  seg.buf.push(ch); c.letter = ch; c.el.firstChild.textContent = ch; c.el.classList.add("typed");
  c.el.classList.remove("pending"); flash(c.el, "pop");
  if (!seg.fx.has(i)) c.el.querySelector(".p").textContent = LV[ch]; // inherited letter scores nothing
  play("type", 0.5);
  if (seg.buf.length === seg.L) submit();
  render();
}

function back() {
  if (!running || !seg.buf.length) return;
  seg.cells.forEach((c) => c.el.classList.remove("bad"));
  const i = seg.buf.length - 1, c = seg.cells[i];
  seg.buf.pop(); c.el.classList.remove("typed");
  if (seg.fx.has(i)) { c.el.classList.add("pending"); c.letter = c.prov; c.el.firstChild.textContent = c.prov; }
  else { c.letter = ""; c.el.firstChild.textContent = ""; c.el.querySelector(".p").textContent = ""; }
  play("backspace", 0.5); render();
}

function flash(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function submit() {
  const word = seg.buf.join("");
  const reject = (msg) => {
    seg.cells.forEach((c) => flash(c.el, "bad")); play("invalid");
    if (mode === "hardcore" && started) { time -= HARDCORE_PENALTY; flash(clockEl, "hit"); msg += ` (-${HARDCORE_PENALTY}s)`; }
    toast(msg);
  };
  if (used.has(word)) return reject("Already used!");
  if (!WORDS.has(word)) return reject("Not a word");
  const hinted = word === seg.hintWord; // typing the exact hinted word: no points, no bonuses
  let pts = 0;
  seg.cells.forEach((c, i) => { if (!seg.fx.has(i)) pts += LV[c.letter] * c.mult * 10; c.el.classList.add("done"); c.el.classList.remove("pop"); });
  if (hinted) pts = 0;
  used.add(word); count++; score += pts;
  if (started && !hinted && mode !== "marathon") time = Math.min(MAX_TIME, time + 3 + seg.L * 1.5); // the 3 intro words are free
  log.push({ word, pts, ms: performance.now() - seg.t0, hinted });
  let msg = hinted ? "Hinted word - no points" : "+" + pts;
  if (mode === "normal" && !hinted && count % 10 === 0) { hints++; msg += " - +1 hint"; } // marathon/hardcore never earn hints
  updateHint();
  if (count === 3) { started = true; last = performance.now(); document.body.classList.remove("intro"); } // reveal HUD, start clock
  if (!hinted) flash(clockEl, "bump");
  toast(msg);
  scoreEl.textContent = score;
  wordsEl.textContent = mode === "marathon" ? `${count} / ${MARATHON_WORDS}` : count + (count === 1 ? " word" : " words");
  play("correct", hinted ? 0.35 : 0.7);
  const finished = seg, finish = mode === "marathon" && count >= MARATHON_WORDS;
  if (finish) finalMs = performance.now() - mStart; else newSegment(seg);
  finished.cells.forEach((c, i) => { c.el.style.setProperty("--d", i * 70 + "ms"); flash(c.el, "shine"); });
  if (!hinted) celebrate(pts, finished.cells);
  if (finish) end();
}

// ---------- keyboard (desktop + mobile) ----------
// A hidden <input> is focused so phones open their on-screen keyboard.
// Its value always mirrors the current word; on every `input` event we diff
// it against the word and replay the difference as typed letters/backspaces.
// (Mobile keyboards often report key = "Unidentified", so keydown alone isn't enough.)
kb.setAttribute("inputmode", "text");
kb.setAttribute("enterkeyhint", "done");
kb.setAttribute("autocapitalize", "none");

function focusKb() { kb.focus({ preventScroll: true }); }
function syncKb() { kb.value = seg ? seg.buf.join("") : ""; }

kb.addEventListener("input", () => {
  if (!running) { kb.value = ""; return; }
  const cur = kb.value.toLowerCase().replace(/[^a-z]/g, "");
  const buf = seg.buf.join("");
  let p = 0;
  while (p < cur.length && p < buf.length && cur[p] === buf[p]) p++;
  for (let n = buf.length - p; n > 0; n--) back();
  for (const ch of cur.slice(p)) type(ch);
  syncKb();
});

// Desktop path: preventDefault stops the character from also reaching the input.
addEventListener("keydown", (e) => {
  if (!running) { if (e.key === "Enter" && !overlay.classList.contains("hidden") && !e.target.closest("#modes")) start(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "1") { e.preventDefault(); if (!e.repeat) useHint(); }
  else if (e.key === "Backspace") { e.preventDefault(); back(); syncKb(); }
  else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toLowerCase()); syncKb(); }
});

// Tap anywhere to (re)open the keyboard. Must happen inside a user gesture (click) for iOS.
addEventListener("mousedown", (e) => { if (running) e.preventDefault(); }); // keep focus on the input
addEventListener("click", () => running && focusKb());

function onViewport() { layoutHint(); sizeFx(); if (running) render(); }
addEventListener("resize", onViewport);
addEventListener("orientationchange", () => setTimeout(onViewport, 150));
if (window.visualViewport) {
  visualViewport.addEventListener("resize", onViewport);
  visualViewport.addEventListener("scroll", () => { scrollTo(0, 0); onViewport(); });
}

// ---------- hints ----------
// Reveals a random valid word (fitting the tiles and anything already typed) as faint
// ghost letters, one by one over 5 seconds. You still have to type it.
function updateHint() { hintNum.textContent = hints; hintBtn.disabled = hints < 1; }
function clearHint() { hintTimers.forEach(clearTimeout); hintTimers = []; }
// Keeps the button above the on-screen keyboard.
function layoutHint() { const vv = visible(); hintBtn.style.bottom = Math.max(0, innerHeight - vv.height - vv.offsetTop) + 16 + "px"; }

function useHint() {
  if (!running || mode === "hardcore" || count < 3 || hints < 1 || seg.hinted || seg.buf.length >= seg.L) return;
  const { L, fx, cells } = seg, pre = seg.buf.join("");
  const todo = [];
  for (let i = seg.buf.length; i < L; i++) if (!fx.has(i)) todo.push(i);
  if (!todo.length) return;
  const fixed = [...fx].map((i) => [i, cells[i].prov]);
  const pool = [];
  for (const w of byLen(L)) if (!used.has(w) && w.startsWith(pre) && fixed.every(([i, ch]) => w[i] === ch)) pool.push(w);
  if (!pool.length) return toast("No hint available");
  const word = pool[rnd(0, pool.length - 1)];
  hints--; seg.hinted = true; seg.hintWord = word; updateHint();
  todo.forEach((idx, k) => hintTimers.push(setTimeout(() => {
    cells[idx].el.querySelector(".g").textContent = word[idx];
  }, (1000 * k) / todo.length)));
  play("hint");
}
hintBtn.onclick = () => { useHint(); focusKb(); };

// ---------- end-of-game stats ----------
function statsHtml(isBest) {
  const n = log.length, sec = (ms) => (ms / 1000).toFixed(1) + "s";
  const row = (k, v) => `<div>${k}</div><b>${v}</b>`;
  const top = n && log.reduce((a, b) => (b.pts > a.pts ? b : a));
  const fast = n && log.reduce((a, b) => (b.ms < a.ms ? b : a));
  const head = mode === "marathon"
    ? row("Final time", fmt(finalMs / 1000)) + row("Best time", fmt(bests.marathon / 1000) + (isBest ? " (New!)" : "")) + row("Score", score)
    : row("Score", score) + row("Best", bests[mode] + (isBest ? " (New!)" : ""));
  return head
    + row("Words used", n)
    + row("Highest scoring word", n ? `${top.word.toUpperCase()} (${top.pts})` : "—")
    + row("Average score", n ? (score / n).toFixed(1) : "—")
    + row("Fastest word", n ? `${fast.word.toUpperCase()} (${sec(fast.ms)})` : "—")
    + row("Average word time", n ? sec(log.reduce((t, w) => t + w.ms, 0) / n) : "—");
}

// ---------- score celebrations ----------
// Word + sound + pulsing screen edges + particles, scaled to the word's score.
const TIERS = [
  { min: 0,   word: "Good.",            color: "#ffffff", sound: "score1" },
  { min: 60,  word: "Nice!",            color: "#4cd97b", sound: "score2" },
  { min: 100, word: "Great!",           color: "#ffd93d", sound: "score3", fx: "electric", dur: 500 },
  { min: 160, word: "Amazing!!",        color: "#b36bff", sound: "score4", fx: "shapes" },
  { min: 210, word: "Fantastic!!!",     color: "#ff6ec7", sound: "score5", fx: "bubbles", dur: 700 },
  { min: 300, word: "INCONCEIVABLE!!!", color: "#ff3b30", sound: "score6", fx: "flames",  dur: 1000 },
];
const mk = (tag, id) => { const e = document.createElement(tag); e.id = id; document.body.appendChild(e); return e; };
const ratingEl = mk("div", "rating"), edgeEl = mk("div", "edge"), fx = mk("canvas", "fx");
const ctx = fx.getContext("2d");
let parts = [], emit = [], fxRaf = 0, fxLast = 0;
const rr = (a, b) => a + Math.random() * (b - a);
const pickOf = (a) => a[Math.floor(Math.random() * a.length)];

function sizeFx() {
  const d = devicePixelRatio || 1;
  fx.width = Math.round(innerWidth * d); fx.height = Math.round(innerHeight * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
function fxClear() { parts = []; emit = []; ctx.clearRect(0, 0, innerWidth, innerHeight); }

function celebrate(pts, cells) {
  let ti = 0; TIERS.forEach((t, i) => { if (pts >= t.min) ti = i; });
  const t = TIERS[ti], pos = cells.map((c) => ({ x: c.x * STEP + T / 2, y: c.y * STEP + T / 2 })); // world px
  play(t.sound, 0.8);

  ratingEl.textContent = t.word; ratingEl.style.color = t.color;
  ratingEl.style.fontSize = `min(${34 + ti * 7}px, ${(88 / (t.word.length * 0.62)).toFixed(1)}vw)`;
  ratingEl.style.setProperty("--dur", (1.1 + ti * 0.12).toFixed(2) + "s");
  flash(ratingEl, "show");

  // Screen-edge pulse: longer, wider and brighter the higher the score (maxes out at 400).
  const k = Math.min(pts, 400) / 400;
  edgeEl.style.setProperty("--c", t.color);
  edgeEl.style.setProperty("--b", 40 + k * 160 + "px");
  edgeEl.style.setProperty("--sp", 6 + k * 40 + "px");
  edgeEl.style.setProperty("--o", (0.4 + k * 0.6).toFixed(2));
  edgeEl.style.setProperty("--dur", (0.5 + k * 1.7).toFixed(2) + "s");
  flash(edgeEl, "pulse");

  if (t.fx === "shapes") spawnShapes(pos);
  else if (t.fx) emit.push({ kind: t.fx, pos, t0: performance.now(), dur: t.dur });
  if (t.fx && !fxRaf) { fxLast = performance.now(); fxRaf = requestAnimationFrame(fxTick); }
}

function spawnShapes(pos) {
  for (let i = 0; i < 36; i++) {
    const p = pickOf(pos);
    parts.push({ kind: "shape", x: p.x + rr(-40, 40), y: p.y + rr(-40, 40), vx: rr(-50, 50), vy: rr(-50, 50),
      age: 0, life: rr(1, 1.8), size: rr(6, 14), sides: pickOf([3, 4, 4, 5]), rot: rr(0, 6.28), vr: rr(-4, 4),
      seed: rr(0, 6.28), color: pickOf(["#a45cf0", "#c792ff", "#7b3fe4", "#d9b3ff"]) });
  }
}

function drawBolts(e, X, Y, k) {
  if (Math.random() < 0.35) return; // gaps make the pulses flicker
  ctx.save(); ctx.lineJoin = "round"; ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = 14;
  for (let n = 0; n < 3; n++) {
    const p = pickOf(e.pos), ang = rr(0, 6.283), len = rr(40, 100), dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y));
    for (let j = 1; j <= 6; j++) {
      const along = (len * j) / 6, off = rr(-14, 14);
      ctx.lineTo(X(p.x + dx * along - dy * off), Y(p.y + dy * along + dx * off));
    }
    ctx.strokeStyle = "#fff4a8"; ctx.lineWidth = 2.2 * k; ctx.stroke();
  }
  ctx.restore();
}

function fxTick(now) {
  const dt = Math.min(0.05, (now - fxLast) / 1000); fxLast = now;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  // Particles live in world coordinates, so they follow the tiles as the camera moves.
  const m = new DOMMatrix(getComputedStyle(world).transform), k = m.a || 1;
  const X = (x) => m.a * x + m.e, Y = (y) => m.d * y + m.f;

  emit = emit.filter((e) => now - e.t0 < e.dur);
  for (const e of emit) {
    if (e.kind === "electric") drawBolts(e, X, Y, k);
    else for (const p of e.pos) {
      if (e.kind === "bubbles" && Math.random() < 0.12)
        parts.push({ kind: "bubble", x: p.x + rr(-20, 20), y: p.y + rr(-10, 10), vx: rr(-10, 10), vy: rr(-90, -40),
          age: 0, life: 2, popAt: rr(0.35, 1.5), size: rr(5, 14), seed: rr(0, 6.28) });
      if (e.kind === "flames" && Math.random() < 0.7)
        parts.push({ kind: "flame", x: p.x + rr(-22, 22), y: p.y + rr(-10, 20), vx: rr(-20, 20), vy: rr(-170, -80),
          age: 0, life: rr(0.5, 0.9), size: rr(10, 20), seed: 0 });
    }
  }

  for (const p of parts) {
    p.age += dt;
    const wob = p.kind === "shape" || p.kind === "bubble" ? Math.sin(p.age * 5 + p.seed) * 18 : 0;
    p.x += (p.vx + wob) * dt; p.y += p.vy * dt;
    if (p.kind === "bubble" && p.age >= p.popAt) { p.kind = "pop"; p.age = 0; p.life = 0.2; p.vx = p.vy = 0; }
  }
  parts = parts.filter((p) => p.age < p.life);

  for (const p of parts) {
    const u = p.age / p.life, x = X(p.x), y = Y(p.y), r = p.size * k;
    ctx.save();
    if (p.kind === "shape") {
      ctx.translate(x, y); ctx.rotate(p.rot + p.vr * p.age);
      ctx.shadowColor = p.color; ctx.shadowBlur = 10; ctx.fillStyle = p.color; ctx.strokeStyle = "#fff";
      ctx.beginPath();
      for (let i = 0; i < p.sides; i++) { const a = (i / p.sides) * 6.283; ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.globalAlpha = (1 - u) * 0.8; ctx.fill(); ctx.globalAlpha = 1 - u; ctx.stroke();
    } else if (p.kind === "bubble") {
      ctx.fillStyle = "rgba(255,110,199,.18)"; ctx.strokeStyle = "#ff9ad5"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(x, y, r * 0.65, 3.6, 4.5); ctx.stroke();
    } else if (p.kind === "pop") {
      ctx.globalAlpha = 1 - u; ctx.strokeStyle = "#ff9ad5"; ctx.fillStyle = "#ffd0ec"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r * (1 + u * 0.9), 0, 6.283); ctx.stroke();
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + p.seed, d = r * (1.2 + u * 1.3); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.6, 0, 6.283); ctx.fill(); }
    } else { // flame
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${55 - 55 * u},100%,${55 - 10 * u}%,${(1 - u) * 0.8})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r * (1 - u * 0.6)), 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  fxRaf = emit.length || parts.length ? requestAnimationFrame(fxTick) : 0;
  if (!fxRaf) ctx.clearRect(0, 0, innerWidth, innerHeight);
}

// ---------- modes ----------
const MODE_DESC = {
  normal: "Beat the clock. Every word buys you more time.",
  marathon: `No clock. Complete ${MARATHON_WORDS} words as fast as you can.`,
  hardcore: `No hints. Mistakes cost ${HARDCORE_PENALTY}s.`,
};
const modeBtns = document.querySelectorAll("#modes button");
const bestText = () => bests[mode] ? (mode === "marathon" ? "Best time: " + fmt(bests.marathon / 1000) : "Best: " + bests[mode]) : "";
function setMode(m) {
  mode = m; try { localStorage.setItem("wordwalker-mode", m); } catch (e) {}
  modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("modedesc").textContent = MODE_DESC[m];
  if (!$("stats").innerHTML) $("best").textContent = bestText(); // end screen keeps its stats
}
modeBtns.forEach((b) => { b.onclick = () => { if (!running) setMode(b.dataset.mode); }; });

// ---------- loop ----------
function tick(now) {
  if (!running) return;
  if (mode === "marathon") { // count up, bar = progress
    const el = mStart ? Math.max(0, performance.now() - mStart) / 1000 : 0;
    barEl.style.width = (count / MARATHON_WORDS) * 100 + "%";
    clockText.textContent = fmt(el);
    return requestAnimationFrame(tick);
  }
  if (started) time -= (now - last) / 1000;
  last = now;
  if (time <= 0) return end();
  barEl.style.width = (time / MAX_TIME) * 100 + "%";
  clockText.textContent = time.toFixed(1);
  clockEl.classList.toggle("low", time < 8);
  requestAnimationFrame(tick);
}

function start() {
  const marathon = mode === "marathon";
  world.innerHTML = ""; tiles = new Map(); used = new Set();
  score = 0; count = 0; time = START_TIME; running = true; started = false; hints = 2; log = []; mStart = 0; finalMs = 0;
  endTimers.forEach(clearTimeout); endTimers = []; fxClear();
  world.style.transitionDuration = ""; world.style.transitionTimingFunction = "";
  document.body.classList.add("intro"); tutEl.classList.remove("show");
  overlay.classList.remove("end"); hintBtn.hidden = mode === "hardcore"; updateHint(); layoutHint();
  clockEl.classList.toggle("marathon", marathon); clockEl.classList.remove("low");
  barEl.style.width = marathon ? "0%" : "100%"; clockText.textContent = marathon ? "0.0s" : START_TIME.toFixed(1);
  scoreEl.textContent = 0; wordsEl.textContent = marathon ? `0 / ${MARATHON_WORDS}` : "0 words";
  overlay.classList.add("hidden");
  newSegment(null);
  kb.value = "";
  startMusic(); focusKb();
  last = performance.now(); requestAnimationFrame(tick);
}

function end() {
  running = false;
  const marathon = mode === "marathon";
  clearHint(); hintBtn.hidden = true; tutEl.classList.remove("show");
  kb.blur(); kb.value = ""; // closes the mobile keyboard
  clockEl.classList.remove("low");
  if (marathon) { clockText.textContent = fmt(finalMs / 1000); barEl.style.width = "100%"; }
  else { clockText.textContent = "0.0"; barEl.style.width = "0%"; }
  const isBest = marathon ? !bests.marathon || finalMs < bests.marathon : score > bests[mode];
  if (isBest) { bests[mode] = marathon ? Math.round(finalMs) : score; try { localStorage.setItem(BEST_KEY[mode], bests[mode]); } catch (e) {} }
  overlay.querySelector("h1").textContent = marathon ? "Marathon complete!" : "Time's up!";
  $("best").textContent = "";
  $("stats").innerHTML = statsHtml(isBest);
  $("start").textContent = "Play again";
  // Slowly pan out to show the whole map, then bring up the results.
  endTimers = [
    setTimeout(() => {
      world.querySelectorAll(".cursor").forEach((e) => e.classList.remove("cursor"));
      world.style.transitionDuration = "3s"; world.style.transitionTimingFunction = "ease-in-out";
      showAll();
    }, 350),
    setTimeout(() => { overlay.classList.add("end"); overlay.classList.remove("hidden"); }, 3500),
  ];
}

// ---------- boot ----------
if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask the browser not to evict it

const startBtn = $("start");
startBtn.disabled = true;
startBtn.textContent = "Loading words…";
startBtn.onclick = start;
loadWords()
  .then(() => { startBtn.disabled = false; startBtn.textContent = "Play"; })
  .catch(() => { startBtn.textContent = "Couldn't load words.txt"; });

layoutHint(); updateHint(); sizeFx(); setMode(mode);