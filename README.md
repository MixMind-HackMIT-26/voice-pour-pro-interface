# MixMind Voice Bar

## Integrated kiosk modes

The current UI offers **Quick Mix** (the existing one-pass workflow) and
**Taste & Tune** (Gemini-assisted tasting and up to two revisions). It renders
the backend greeting and spoken text, uses backend calibration ranges, and
keeps the fixed 1024x600 touchscreen layout. Taste & Tune includes separate
sample-cup and final-cup confirmation; samples are 0.08x the proposed recipe.

The original design brief below is historical. The backend now exposes extra
session states and `/api/action`; see `voice_decipher_2/README.md` for the contract.
The UI itself needs no external assets or API keys. Optional cloud features run
on the backend. `?demo=1` previews both modes without pumps. A live connection
failure shows reconnection, not a fake dispensing sequence.

For local backend development, set `MIXMIND_API_URL=http://127.0.0.1:8090`
before `npm run dev`; the Vite proxy forwards `/api` to that backend.

Build a single-screen kiosk UI for "MixMind", a drink-mixing machine that

listens to how someone speaks and pours them a drink.

HARD CONSTRAINTS

- Exactly 1024x600 px, landscape, 7-inch capacitive touchscreen. Fixed layout

  at that size. No scrolling, ever. No hover states (touch only).

- Touch targets at least 64 px. Text readable from 1.5 m: nothing under 20 px.

- Must run 100% OFFLINE. No Supabase, no auth, no database, no analytics,

  no Google Fonts, no CDN images or scripts. Use system fonts and inline SVG.

  It will be built with `npm run build` and served as static files from

  localhost on a Raspberry Pi.

- High contrast: it is used in a loud, brightly lit hall. Anything the

  machine says out loud must also appear on screen, large.

- No landing page, no navigation, no settings. One screen that changes state.

DATA

Poll GET /api/state every 200 ms. It returns:

{

  "state": "idle" | "listening" | "thinking" | "reveal" | "pouring" | "serving" | "error",

  "level_db": -32.5,            // mic level while listening, roughly -60..0

  "elapsed_s": 4.2,             // seconds since listening started

  "features": {                 // null until measured

    "pitch_mean_hz": 105, "pitch_sd_hz": 18.4, "loudness_db": -27.4,

    "pause_ratio": 0.09, "onset_rate_hz": 0.33, "jitter_pct": 1.95,

    "shimmer_pct": 12.2, "duration_s": 18.4 },

  "recipe": {                   // null until chosen

    "name": "Running On Empty", "mood": "depleted",

    "rationale": "You took your time and your voice stayed level...",

    "pours": [{"channel": 1, "ml": 45}, {"channel": 5, "ml": 50}, {"channel": 6, "ml": 60}],

    "stir_seconds": 6 },

  "pour": { "index": 1, "total": 3, "channel": 5, "ml": 50,

            "duration_ms": 13333, "started_at_ms": 1726764000000 },  // null unless pouring

  "ingredients": {"1": "Orange juice", "2": "Cranberry", "3": "Grapefruit",

                  "4": "Iced tea", "5": "Apple juice", "6": "Ginger ale"},

  "error": null

}

POST /api/start starts listening. POST /api/reset returns to idle.

DEMO MODE (required): if /api/state fails, or the URL has ?demo=1, run a

built-in fake sequence through every state on a loop with the example data

above, so the UI can be previewed with no backend. Show a small "DEMO" tag.

STATES

- idle: "MixMind" wordmark, slow pulse, huge button "Tap and tell me about

  your day". The whole screen is tappable. Tapping POSTs /api/start.

- listening: big live level meter driven by level_db, elapsed seconds,

  "I'm listening..." Cap at 25 s.

- thinking: the six voice measurements appear one by one as horizontal

  gauges, each labelled in plain words: Pitch, Pitch wobble, Loudness,

  Pauses, Pace, Voice strain (jitter). Plus a subtle shimmer animation.

- reveal: drink name HUGE, mood as a coloured chip, rationale below in

  large readable text. The gauges stay visible, small, on one side:

  they are the proof that the machine measured the voice.

- pouring: one vertical bar per ingredient in the recipe, labelled with the

  ingredient name, filling in order. Animate the current bar from

  started_at_ms over duration_ms, ml counting up. Then "Stirring" for

  stir_seconds.

- serving: "Take your drink" and the drink name, for 8 s, then back to idle.

- error: one plain human sentence (never a stack trace) and a big

  "Try again" button that POSTs /api/reset.

LOOK

Dark background, one warm accent colour, bold and calm, like a premium

bar menu. Smooth transitions between states. No emoji.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dbc73f88-9917-4064-95d6-f6867616806e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Docker

```
docker build -t voice-pour .
docker run -p 3000:3000 voice-pour
```

Open http://localhost:3000 (add `?demo=1` to force demo mode).

## Raspberry Pi touchscreen (kiosk)

The Pi needs no Node.js: build on a laptop, copy ~500 KB of static files.
The page makes no requests outside the Pi, so it works offline.

```
./scripts/build-pi.sh
rsync -av --delete pi-ui/ pi@<pi-ip>:~/mixmind-ui/
```

The script checks that every file the saved page asks for is really in
`pi-ui/`. It refuses to run while another server holds its port: a stale UI
server once answered instead of the fresh build, and the saved page pointed at
old files -- an unstyled screen on the Pi.

On the Pi, the kiosk server in
[voice_decipher_2](https://github.com/MixMind-HackMIT-26/voice_decipher_2)
serves this folder *and* `/api/state` on :8080 (`python server.py`). For a
look at the UI alone, `python3 -m http.server 8080 --directory ~/mixmind-ui`
works too -- it shows DEMO mode.

Then open `http://localhost:8080` in Chromium on the touchscreen and go
fullscreen (F11 -- `Fn`+`3` on the mini keyboard), or launch it with
`chromium-browser --kiosk http://localhost:8080`.

Why the snapshot instead of a static build: on this template, TanStack
Start's SPA mode fails to prerender `/` (Internal Server Error), and nitro's
`static` preset fails with "rolldownOptions.input should not be an html file
when building for SSR". Rendering the page once with the node server and
saving it works, and the saved page is fully interactive.

On the HackMIT Wi-Fi `pi.local` does not resolve, but the Pi is reachable by
IP -- find it with `hostname -I` on the Pi. With no backend the UI runs in
DEMO mode, and it keeps checking: when the backend comes up (it can start after
Chromium at boot) the UI switches to it by itself. `?demo=1` forces demo.
