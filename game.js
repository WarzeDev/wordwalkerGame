"use strict";
// ---------- config ----------
const T = 56, G = 6, STEP = T + G;
const START_TIME = 30, MAX_TIME = 60;
const AUDIO = {
  type: "audio/type.mp3",
  backspace: "audio/backspace.mp3",
  correct: "audio/correct.mp3",
  invalid: "audio/invalid.mp3",
  music: "audio/music.mp3",
};

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const world = $("world"), overlay = $("overlay"), toastEl = $("toast"), kb = $("kb");
const scoreEl = $("score"), wordsEl = $("words"), clockEl = $("clock");
const barEl = $("clockbar"), clockText = $("clocktext");

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
  kb.focus();
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
  el.innerHTML = '<span class="l"></span>' + (mult > 1 ? `<span class="m">x${mult}</span>` : "");
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
      c.mult = 1; c.prov = prev.cells[prev.L - 1].letter; c.el.firstChild.textContent = c.prov;
      cells.push(c);
    } else cells.push(makeCell(x, y, randMult()));
  }
  seg = { dir, L, a, cells, buf: [] };
  render();
}

function render() {
  world.querySelectorAll(".cursor").forEach((e) => e.classList.remove("cursor"));
  const i = Math.min(seg.buf.length, seg.L - 1), c = seg.cells[i];
  c.el.classList.add("cursor");
  world.style.transform = `translate(${innerWidth / 2 - (c.x * STEP + T / 2)}px,${innerHeight / 2 - (c.y * STEP + T / 2) + 24}px)`;
}

// ---------- input ----------
function type(ch) {
  if (!running || seg.buf.length >= seg.L) return;
  const i = seg.buf.length, c = seg.cells[i];
  if (i === seg.a && ch !== c.prov) { flash(c.el, "bad"); play("invalid", 0.5); return; }
  seg.buf.push(ch); c.letter = ch; c.el.firstChild.textContent = ch;
  c.el.classList.remove("pending"); flash(c.el, "pop");
  play("type", 0.5);
  if (seg.buf.length === seg.L) submit();
  render();
}

function back() {
  if (!running || !seg.buf.length) return;
  seg.cells.forEach((c) => c.el.classList.remove("bad"));
  const i = seg.buf.length - 1, c = seg.cells[i];
  seg.buf.pop();
  if (i === seg.a) { c.el.classList.add("pending"); c.letter = c.prov; c.el.firstChild.textContent = c.prov; }
  else { c.letter = ""; c.el.firstChild.textContent = ""; }
  play("backspace", 0.5); render();
}

function flash(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function submit() {
  const word = seg.buf.join("");
  const reject = (msg) => { seg.cells.forEach((c) => flash(c.el, "bad")); toast(msg); play("invalid"); };
  if (used.has(word)) return reject("Already used!");
  if (!WORDS.has(word)) return reject("Not a word");
  let pts = 0;
  seg.cells.forEach((c, i) => { if (i !== seg.a) pts += 10 * c.mult; c.el.classList.add("done"); c.el.classList.remove("pop"); });
  used.add(word); count++; score += pts;
  time = Math.min(MAX_TIME, time + 3 + seg.L * 1.5);
  flash(clockEl, "bump"); toast("+" + pts);
  scoreEl.textContent = score; wordsEl.textContent = count + (count === 1 ? " word" : " words");
  play("correct");
  newSegment(seg);
}

addEventListener("keydown", (e) => {
  if (!running) { if (e.key === "Enter" && !overlay.classList.contains("hidden")) start(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Backspace") { e.preventDefault(); back(); }
  else if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toLowerCase());
});
addEventListener("pointerdown", () => running && kb.focus());
addEventListener("resize", () => seg && render());

// ---------- loop ----------
function tick(now) {
  if (!running) return;
  time -= (now - last) / 1000; last = now;
  if (time <= 0) return end();
  barEl.style.width = (time / MAX_TIME) * 100 + "%";
  clockText.textContent = time.toFixed(1);
  clockEl.classList.toggle("low", time < 8);
  requestAnimationFrame(tick);
}

function start() {
  world.innerHTML = ""; tiles = new Map(); used = new Set();
  score = 0; count = 0; time = START_TIME; running = true;
  scoreEl.textContent = 0; wordsEl.textContent = "0 words";
  overlay.classList.add("hidden");
  newSegment(null);
  startMusic(); kb.focus();
  last = performance.now(); requestAnimationFrame(tick);
}

function end() {
  running = false; snd.music.pause(); snd.music.currentTime = 0;
  clockText.textContent = "0.0"; barEl.style.width = "0%";
  if (score > best) { best = score; try { localStorage.setItem("wordwalker-best", best); } catch (e) {} }
  overlay.querySelector("h1").textContent = "Time's up!";
  overlay.querySelector("p").innerHTML = `Score <b>${score}</b> · ${count} words`;
  $("best").textContent = "Best: " + best;
  $("start").textContent = "Play again";
  overlay.classList.remove("hidden");
}

$("best").textContent = best ? "Best: " + best : "";

// ---------- bottom of game.js (replaces `$("start").onclick = start;`) ----------
if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask the browser not to evict it

const startBtn = $("start");
startBtn.disabled = true;
startBtn.textContent = "Loading words…";
startBtn.onclick = start;
loadWords()
  .then(() => { startBtn.disabled = false; startBtn.textContent = "Play"; })
  .catch(() => { startBtn.textContent = "Couldn't load words.txt"; });
