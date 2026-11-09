<div align="center">

<img src="logo.svg" alt="Wordwalker logo" width="120">

# Wordwalker

**Type words along a winding path. Never repeat one. Beat the clock.**

[Play it live](https://wordwalker.warze.org/) · [Report a bug](../../issues)

<img src="thumbnail.png" alt="Wordwalker gameplay" width="720">

</div>

---

## About

Wordwalker is a fast word game for the browser. A path of empty tiles stretches out in front of you: think of an English word that fits, type it, and the path continues from its last letter, turning a corner each time. Right, then down, then right again. The clock is always ticking, and every valid word buys you more time.

Plain HTML, CSS and JavaScript. No frameworks, no build step, no dependencies. The optional definition bonus uses the free [Free Dictionary API](https://dictionaryapi.dev/).

## How to play

1. Press **Play**. You start with an empty row of 3-6 tiles going **right**.
2. Type a valid English word that fits the row.
3. The next word begins on the last letter of the previous one and goes **down**, then **right**, then **down**, and so on.
4. The inherited letter is shown dimmed until you type it. You still have to type it, and it has to match.
5. If a word is not valid, or you already used it, the tiles flash red. Press **Backspace** and try another.
6. The first two words come with a short on-screen tutorial. The score, clock, word count and hint button stay hidden and fade in once you have completed **3 words**. The clock starts then, and the first 3 words are free. Keep going until it runs out.
7. Stuck? Tap the 💡 button (bottom right) or press **1** to reveal a random valid word as faint ghost letters over 5 seconds. You still have to type it. You start with **2 hints** and earn **1 more every 10 words** (Normal mode only). If you type exactly the word the hint suggested, it grants no points, no time and no celebration, so deviate from it a little to get full points.

When time is up the camera pans out to show your whole path, followed by your stats: highest scoring word, average score, words used, fastest word and average word time.

**Definition bonus** (Normal and Hardcore): from the 5th word on, there is a 50% chance that a box appears at the bottom with the definition of a random valid word that fits the current tiles. Type exactly that word for **+200 points**. The box glows and shoots confetti when you get it. If you play a different word instead, the box shows the correct one for 1.5 seconds. The definition never contains the word itself (or a close variant), and nothing is shown if the dictionary can't be reached or has no usable definition. Typing a hinted word still gives nothing. Definitions come from [dictionaryapi.dev](https://dictionaryapi.dev/) (needs an internet connection; the game works fine without it).

### Modes

Pick a mode on the start screen. Each mode keeps its own best (Marathon keeps your fastest time).

- **Normal**: the classic game described above.
- **Marathon**: no clock and no time limit. Complete **30 words** as fast as you can; the bar shows your progress and the stopwatch starts at your first letter. The stats screen shows your final time. You only get the **2 starting hints**, no more are earned.
- **Hardcore**: hints are disabled, and every invalid or repeated word submission costs you **3 seconds**. From the 4th word on there is an increasing chance (up to 60%) that the next word has to **bridge over an older letter**: a letter from a previous word further along the line is already placed, so your word must contain both it and the inherited letter. Bridge words are 7 letters at most, and the game only picks spots where at least 5 words fit.

### Settings

Tap the gear (main menu, or top right during a game; **Esc** also opens it). Opening it mid-game pauses the game. Settings are saved in your browser.

- **Visual Effects**: score celebrations, screen pulses, particles, the word shine and the definition glow and confetti. Turn off for a plainer look.
- **Music** and **Sound effects**: volume sliders.
- **Auto type forced letters**: the inherited letters (and bridge letters) are typed for you as soon as you reach them, and Backspace skips over them.

### Scoring

- Every letter is worth its **Scrabble value** (E = 1, D = 2, B = 3, K = 5, Q = 10, and so on). The value is shown in the bottom right of the tile once you type the letter. The inherited letter is worth nothing.
- 🟥 **Red** tiles are worth **x2** and 🟪 **purple** tiles are worth **x3**. The multiplier is shown in the bottom left of the tile and applies to that tile's letter, so a Q on a purple tile is worth 30.
- A word's score is the sum of its letters' values after multipliers.
- Each correct word adds **3 seconds + 1.5 seconds per letter** to the clock, up to a maximum of 60 seconds. You start with 30.
- Your best score is saved in your browser.

### Difficulty

The longer you survive, the harder it gets:

- Words get longer: up to 6 letters at first, then 7, 8 and finally 9.
- The shortest allowed word also grows (3, then 4, then 5 letters).
- The inherited letter stops being at the start of the word and can appear in the middle. The tiles then extend backwards (left or up) from the corner.
- Multiplier tiles become more common.

The path never overlaps itself.

## Running locally

The game loads its dictionary with `fetch`, so it has to be served over HTTP. Opening `index.html` directly from disk will not work.

```bash
# with Bun
bun --serve .

# or with Python
python -m http.server 8000
```

Then open the address it prints (for Python: <http://localhost:8000>).

## Browser support

Any modern desktop or mobile browser. Tap the screen on mobile to open the keyboard.

## Author

Made by **WarzeDev** · [GitHub](https://github.com/WarzeDev) · [X / Twitter](https://x.com/warzedev)