"use strict";
// ---------- config ----------
const T = 56, G = 6, STEP = T + G;
const START_TIME = 30, MAX_TIME = 60;
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
let WORDS = new Set();

async function loadWords() {
  let txt;
  try { txt = localStorage.getItem("wordwalker_words"); } catch (e) {}
  if (!txt) {
    txt = await (await fetch("words.txt")).text();
    try { localStorage.setItem("wordwalker_words", txt); } catch (e) {}
  }
  WORDS = new Set(txt.trim().toLowerCase().split(/\s+/));
}

// ---------- state ----------
let tiles, used, seg, score, count, time, running = false, last = 0, best = 0;
let started = false, hints = 2, log = [], hintTimers = [], endTimers = []; // started = first letter typed
try { best = +localStorage.getItem("wordwalker-best") || 0; } catch (e) {}
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("show"), 1100);
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
  let dir, L, a, px = 0, py = 0;
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
  }
  const dx = dir === 0 ? 1 : 0, dy = dir === 1 ? 1 : 0, cells = [];
  for (let i = 0; i < L; i++) {
    const x = px + dx * (i - Math.max(a, 0)), y = py + dy * (i - Math.max(a, 0));
    if (i === a) {
      const c = tiles.get(x + "," + y);
      c.el.className = "tile pending"; const m = c.el.querySelector(".m"); if (m) m.remove();
      c.el.querySelector(".p").textContent = ""; c.el.querySelector(".g").textContent = "";
      c.mult = 1; c.prov = prev.cells[prev.L - 1].letter; c.el.firstChild.textContent = c.prov;
      cells.push(c);
    } else cells.push(makeCell(x, y, randMult()));
  }
  clearHint();
  seg = { dir, L, a, cells, buf: [], t0: performance.now(), hinted: false };
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
  if (i === seg.a && ch !== c.prov) { flash(c.el, "bad"); play("invalid", 0.5); return; }
  if (!started) { started = true; last = performance.now(); seg.t0 = last; } // clock starts on the first letter
  seg.buf.push(ch); c.letter = ch; c.el.firstChild.textContent = ch; c.el.classList.add("typed");
  c.el.classList.remove("pending"); flash(c.el, "pop");
  if (i !== seg.a) c.el.querySelector(".p").textContent = LV[ch]; // inherited letter scores nothing
  play("type", 0.5);
  if (seg.buf.length === seg.L) submit();
  render();
}

function back() {
  if (!running || !seg.buf.length) return;
  seg.cells.forEach((c) => c.el.classList.remove("bad"));
  const i = seg.buf.length - 1, c = seg.cells[i];
  seg.buf.pop(); c.el.classList.remove("typed");
  if (i === seg.a) { c.el.classList.add("pending"); c.letter = c.prov; c.el.firstChild.textContent = c.prov; }
  else { c.letter = ""; c.el.firstChild.textContent = ""; c.el.querySelector(".p").textContent = ""; }
  play("backspace", 0.5); render();
}

function flash(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function submit() {
  const word = seg.buf.join("");
  const reject = (msg) => { seg.cells.forEach((c) => flash(c.el, "bad")); toast(msg); play("invalid"); };
  if (used.has(word)) return reject("Already used!");
  if (!WORDS.has(word)) return reject("Not a word");
  let pts = 0;
  seg.cells.forEach((c, i) => { if (i !== seg.a) pts += LV[c.letter] * c.mult * 10; c.el.classList.add("done"); c.el.classList.remove("pop"); });
  used.add(word); count++; score += pts;
  time = Math.min(MAX_TIME, time + 3 + seg.L * 1.5);
  log.push({ word, pts, ms: performance.now() - seg.t0 });
  let msg = "+" + pts;
  if (count % 10 === 0) { hints++; msg += " - +1 hint"; }
  updateHint();
  flash(clockEl, "bump"); toast(msg);
  scoreEl.textContent = score; wordsEl.textContent = count + (count === 1 ? " word" : " words");
  play("correct");
  const finished = seg;
  newSegment(seg);
  finished.cells.forEach((c, i) => { c.el.style.setProperty("--d", i * 70 + "ms"); flash(c.el, "shine"); });
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
  if (!running) { if (e.key === "Enter" && !overlay.classList.contains("hidden")) start(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Backspace") { e.preventDefault(); back(); syncKb(); }
  else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toLowerCase()); syncKb(); }
});

// Tap anywhere to (re)open the keyboard. Must happen inside a user gesture (click) for iOS.
addEventListener("mousedown", (e) => { if (running) e.preventDefault(); }); // keep focus on the input
addEventListener("click", () => running && focusKb());

function onViewport() { layoutHint(); if (running) render(); }
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
  if (!running || hints < 1 || seg.hinted || seg.buf.length >= seg.L) return;
  const { L, a, cells } = seg, pre = seg.buf.join(""), prov = a >= 0 ? cells[a].prov : null;
  const todo = [];
  for (let i = seg.buf.length; i < L; i++) if (i !== a) todo.push(i);
  if (!todo.length) return;
  const pool = [];
  for (const w of WORDS) if (w.length === L && !used.has(w) && w.startsWith(pre) && (a < 0 || w[a] === prov)) pool.push(w);
  if (!pool.length) return toast("No hint available");
  const word = pool[rnd(0, pool.length - 1)];
  hints--; seg.hinted = true; updateHint();
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
  return row("Score", score) + row("Best", best + (isBest ? " (New!)" : ""))
    + row("Words used", n)
    + row("Highest scoring word", n ? `${top.word.toUpperCase()} (${top.pts})` : "—")
    + row("Average score", n ? (score / n).toFixed(1) : "—")
    + row("Fastest word", n ? `${fast.word.toUpperCase()} (${sec(fast.ms)})` : "—")
    + row("Average word time", n ? sec(log.reduce((t, w) => t + w.ms, 0) / n) : "—");
}

// ---------- loop ----------
function tick(now) {
  if (!running) return;
  if (started) time -= (now - last) / 1000;
  last = now;
  if (time <= 0) return end();
  barEl.style.width = (time / MAX_TIME) * 100 + "%";
  clockText.textContent = time.toFixed(1);
  clockEl.classList.toggle("low", time < 8);
  requestAnimationFrame(tick);
}

function start() {
  world.innerHTML = ""; tiles = new Map(); used = new Set();
  score = 0; count = 0; time = START_TIME; running = true; started = false; hints = 2; log = [];
  endTimers.forEach(clearTimeout); endTimers = [];
  world.style.transitionDuration = ""; world.style.transitionTimingFunction = "";
  overlay.classList.remove("end"); hintBtn.hidden = false; updateHint(); layoutHint();
  scoreEl.textContent = 0; wordsEl.textContent = "0 words";
  overlay.classList.add("hidden");
  newSegment(null);
  kb.value = "";
  startMusic(); focusKb();
  last = performance.now(); requestAnimationFrame(tick);
}

function end() {
  running = false;
  clearHint(); hintBtn.hidden = true;
  kb.blur(); kb.value = ""; // closes the mobile keyboard
  clockText.textContent = "0.0"; barEl.style.width = "0%"; clockEl.classList.remove("low");
  const isBest = score > best;
  if (isBest) { best = score; try { localStorage.setItem("wordwalker-best", best); } catch (e) {} }
  overlay.querySelector("h1").textContent = "Time's up!";
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

$("best").textContent = best ? "Best: " + best : "";

// ---------- boot ----------
if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask the browser not to evict it

const startBtn = $("start");
startBtn.disabled = true;
startBtn.textContent = "Loading words…";
startBtn.onclick = start;
loadWords()
  .then(() => { startBtn.disabled = false; startBtn.textContent = "Play"; })
  .catch(() => { startBtn.textContent = "Couldn't load words.txt"; });

layoutHint(); updateHint();