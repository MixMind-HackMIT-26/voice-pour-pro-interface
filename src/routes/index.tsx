import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type MachineStateName =
  | "idle"
  | "listening"
  | "thinking"
  | "reveal"
  | "pouring"
  | "serving"
  | "error";

type VoiceFeatures = {
  pitch_mean_hz: number;
  pitch_sd_hz: number;
  loudness_db: number;
  pause_ratio: number;
  onset_rate_hz: number;
  jitter_pct: number;
  shimmer_pct: number;
  duration_s: number;
};

type Recipe = {
  name: string;
  mood: string;
  rationale: string;
  pours: Array<{ channel: number; ml: number }>;
  stir_seconds: number;
};

type MachineState = {
  state: MachineStateName;
  level_db: number;
  elapsed_s: number;
  features: VoiceFeatures | null;
  recipe: Recipe | null;
  pour: {
    index: number;
    total: number;
    channel: number;
    ml: number;
    duration_ms: number;
    started_at_ms: number;
  } | null;
  ingredients: Record<string, string>;
  error: string | null;
};

const ingredients = {
  "1": "Orange juice",
  "2": "Cranberry",
  "3": "Grapefruit",
  "4": "Iced tea",
  "5": "Apple juice",
  "6": "Ginger ale",
};

const features: VoiceFeatures = {
  pitch_mean_hz: 105,
  pitch_sd_hz: 18.4,
  loudness_db: -27.4,
  pause_ratio: 0.09,
  onset_rate_hz: 0.33,
  jitter_pct: 1.95,
  shimmer_pct: 12.2,
  duration_s: 18.4,
};

const recipe: Recipe = {
  name: "Running On Empty",
  mood: "depleted",
  rationale: "You took your time and your voice stayed level — something bright, gentle, and restoring felt right.",
  pours: [
    { channel: 1, ml: 45 },
    { channel: 5, ml: 50 },
    { channel: 6, ml: 60 },
  ],
  stir_seconds: 6,
};

const baseState: MachineState = {
  state: "idle",
  level_db: -42,
  elapsed_s: 0,
  features: null,
  recipe: null,
  pour: null,
  ingredients,
  error: null,
};

const demoStages = [
  { state: "idle", duration: 3000 },
  { state: "listening", duration: 7000 },
  { state: "thinking", duration: 6500 },
  { state: "reveal", duration: 7000 },
  { state: "pouring", duration: 9000 },
  { state: "serving", duration: 8000 },
] as const;

const demoCycleDuration = demoStages.reduce((total, stage) => total + stage.duration, 0);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MixMind — Voice-matched drinks" },
      { name: "description", content: "MixMind listens, understands, and mixes a drink to match your voice." },
      { property: "og:title", content: "MixMind" },
      { property: "og:description", content: "A voice-matched drink experience." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MixMindKiosk,
});

function getDemoState(epoch: number, now: number): MachineState {
  let cursor = now - epoch;
  if (cursor < 0 || cursor >= demoCycleDuration) return baseState;
  let current: { state: MachineStateName; duration: number } = demoStages[0];
  let stageStart = epoch;

  for (const stage of demoStages) {
    if (cursor < stage.duration) {
      current = stage;
      break;
    }
    cursor -= stage.duration;
    stageStart += stage.duration;
  }

  if (current.state === "idle") return baseState;
  if (current.state === "listening") {
    const seconds = cursor / 1000;
    return {
      ...baseState,
      state: "listening",
      elapsed_s: seconds,
      level_db: -35 + Math.sin(seconds * 5.2) * 15,
    };
  }
  if (current.state === "thinking") {
    return { ...baseState, state: "thinking", features };
  }
  if (current.state === "reveal") {
    return { ...baseState, state: "reveal", features, recipe };
  }
  if (current.state === "serving") {
    return { ...baseState, state: "serving", features, recipe };
  }

  const pourDuration = 3000;
  const pourIndex = Math.min(Math.floor(cursor / pourDuration), recipe.pours.length);
  if (pourIndex >= recipe.pours.length) {
    return { ...baseState, state: "pouring", features, recipe, pour: null };
  }
  const activePour = recipe.pours[pourIndex];
  if (!activePour) return { ...baseState, state: "pouring", features, recipe, pour: null };
  return {
    ...baseState,
    state: "pouring",
    features,
    recipe,
    pour: {
      index: pourIndex + 1,
      total: recipe.pours.length,
      channel: activePour.channel,
      ml: activePour.ml,
      duration_ms: pourDuration,
      started_at_ms: stageStart + pourIndex * pourDuration,
    },
  };
}

function MixMindKiosk() {
  const [isDemo, setIsDemo] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [machine, setMachine] = useState<MachineState>(baseState);
  const [now, setNow] = useState(Date.now());
  const demoEpoch = useRef(Date.now());
  // ?demo=1 is demo for good. Otherwise demo is only a fallback: keep checking
  // for the Pi's backend and switch to it when it answers -- at boot, Chromium
  // can easily come up before the server does.
  const forcedDemo = useRef(false);
  const lastState = useRef("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      forcedDemo.current = true;
      demoEpoch.current = Date.now();
      setIsDemo(true);
    }
  }, []);

  // The clock re-renders the whole page, so it runs only where something moves
  // with time: the demo, "thinking" and "pouring". Ticking at 50 ms on every
  // screen kept the Pi's Chromium at ~85% CPU on the idle screen.
  const clockNeeded = (isDemo && demoRunning) || machine.state === "thinking" || machine.state === "pouring";
  useEffect(() => {
    if (!clockNeeded) return;
    setNow(Date.now());                    // don't start from a stale time
    const clock = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(clock);
  }, [clockNeeded]);

  useEffect(() => {
    if (!isDemo) return;
    if (!demoRunning) {
      setMachine(baseState);
      return;
    }
    const nextState = getDemoState(demoEpoch.current, now);
    setMachine(nextState);
    if (now - demoEpoch.current >= demoCycleDuration) setDemoRunning(false);
  }, [demoRunning, isDemo, now]);

  useEffect(() => {
    if (forcedDemo.current) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("Machine unavailable");
        const text = await response.text();
        if (cancelled) return;
        if (isDemo) {                      // the backend is back: leave demo
          setIsDemo(false);
          setDemoRunning(false);
        }
        // Redraw only when the machine actually changed: on the idle screen
        // it answers the same thing five times a second.
        if (text !== lastState.current) {
          lastState.current = text;
          setMachine(JSON.parse(text) as MachineState);
        }
      } catch {
        if (!cancelled && !isDemo) {
          demoEpoch.current = Date.now();
          setIsDemo(true);
        }
      }
    };
    void poll();
    // Fast while the machine is live; a gentle retry while in fallback demo.
    const interval = window.setInterval(poll, isDemo ? 2000 : 200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isDemo]);

  const start = useCallback(async () => {
    if (isDemo) {
      demoEpoch.current = Date.now() - demoStages[0].duration;
      setDemoRunning(true);
      setNow(Date.now());
      return;
    }
    try {
      await fetch("/api/start", { method: "POST" });
    } catch {
      demoEpoch.current = Date.now() - demoStages[0].duration;
      setIsDemo(true);
      setDemoRunning(true);
    }
  }, [isDemo]);

  const reset = useCallback(async () => {
    if (isDemo) {
      demoEpoch.current = Date.now();
      setDemoRunning(false);
      setNow(Date.now());
      return;
    }
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch {
      demoEpoch.current = Date.now();
      setIsDemo(true);
    }
  }, [isDemo]);

  return (
    <main className="kiosk-shell" aria-live="polite">
      <div className="kiosk-topline">
        {machine.state !== "idle" && <Logo compact />}
        {isDemo && <span className="demo-tag">DEMO</span>}
      </div>
      <div className="state-stage" key={machine.state}>
        {machine.state === "idle" && <IdleState onStart={start} />}
        {machine.state === "listening" && <ListeningState machine={machine} />}
        {machine.state === "thinking" && <ThinkingState features={machine.features ?? features} now={now} />}
        {machine.state === "reveal" && (
          <RevealState recipe={machine.recipe ?? recipe} features={machine.features ?? features} />
        )}
        {machine.state === "pouring" && <PouringState machine={machine} now={now} />}
        {machine.state === "serving" && <ServingState recipe={machine.recipe ?? recipe} />}
        {machine.state === "error" && <ErrorState message={machine.error} onReset={reset} />}
      </div>
    </main>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "wordmark wordmark-compact" : "wordmark"} aria-label="MixMind">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M16 10v28c0 11 7 16 16 16s16-5 16-16V10" />
        <path d="M18 34c7-5 20 5 28 0" />
        <circle cx="26" cy="25" r="3" />
        <circle cx="38" cy="20" r="2" />
      </svg>
      <span>MixMind</span>
    </div>
  );
}

type BartenderMood = "ready" | "listening" | "thinking" | "pleased" | "focused" | "celebrating" | "concerned";

function BartenderFace({ mood, size = "large" }: { mood: BartenderMood; size?: "small" | "medium" | "large" }) {
  return (
    <div className={`bartender-face bartender-${mood} bartender-${size}`} aria-hidden="true">
      <svg viewBox="0 0 240 240" fill="none">
        <circle className="aura aura-outer" cx="120" cy="120" r="108" />
        <circle className="aura aura-inner" cx="120" cy="120" r="94" />
        <path className="shoulders" d="M46 226c13-36 39-52 74-52s61 16 74 52" />
        <path className="jacket" d="m86 181 34 31 34-31M120 212v14" />
        <path className="face-line" d="M70 61c11-25 31-38 50-38s39 13 50 38v56c0 42-23 72-50 72s-50-30-50-72V61Z" />
        <path className="hair" d="M70 71c2-34 24-52 50-52 27 0 48 19 51 52-16-6-28-18-37-34-13 20-35 30-64 34Z" />
        <path className="brow brow-left" d="M86 91c8-5 17-5 24 0" />
        <path className="brow brow-right" d="M130 91c8-5 17-5 24 0" />
        <path className="eye eye-left" d="M87 106c7-7 16-7 23 0" />
        <path className="eye eye-right" d="M130 106c7-7 16-7 23 0" />
        <path className="nose" d="M120 105v27l-8 5" />
        <path className="mouth" d="M101 153c11 6 27 6 38 0" />
        <path className="bowtie" d="m103 202-18-10v24l18-10m34-4 18-10v24l-18-10" />
      </svg>
    </div>
  );
}

function IdleState({ onStart }: { onStart: () => void }) {
  return (
    <button className="idle-touch" onClick={onStart} type="button">
      <div className="idle-mark"><Logo /></div>
      <div className="idle-persona">
        <BartenderFace mood="ready" />
        <div className="idle-greeting"><span>YOUR PERSONAL MIXOLOGIST</span><strong>Good evening.</strong><p>Tell me about your day and I’ll craft your drink.</p></div>
      </div>
      <div className="tap-invitation"><i aria-hidden="true" /><strong>Tap to speak</strong></div>
    </button>
  );
}

function ListeningState({ machine }: { machine: MachineState }) {
  const level = Math.max(0, Math.min(100, ((machine.level_db + 60) / 60) * 100));
  return (
    <section className="listening-layout">
      <div className="meter-wrap" aria-label={`Microphone level ${Math.round(level)} percent`}>
        <div className="meter-scale"><span>LOUD</span><span>QUIET</span></div>
        <div className="level-meter"><div style={{ height: `${level}%` }} /></div>
      </div>
      <div className="listening-copy">
        <BartenderFace mood="listening" size="medium" />
        <div className="sound-wave" aria-hidden="true">{[30, 54, 78, 44, 92, 62, 36].map((height, index) => <i key={index} style={{ height }} />)}</div>
        <h1>I’m listening…</h1>
        <p>Keep talking naturally.</p>
        <div className="elapsed"><strong>{Math.min(25, machine.elapsed_s).toFixed(1)}</strong><span>/ 25 seconds</span></div>
      </div>
    </section>
  );
}

type VoiceDial = { label: string; low: string; high: string; value: number; readings: [string, string, string]; hints: [string, string, string] };

function normalize(value: number, low: number, high: number) {
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

function voiceDials(value: VoiceFeatures): VoiceDial[] {
  const energy = 0.5 * normalize(value.loudness_db, -32, -12) + 0.5 * normalize(value.onset_rate_hz, 0.5, 2.1);
  const halting = normalize(value.pause_ratio, 0.018, 0.143);
  const animated = normalize(value.pitch_sd_hz, 19, 26.7);
  return [
    { label: "Energy", low: "low", high: "high", value: energy, readings: ["running low", "even keel", "fired up"], hints: ["dark sweet comfort + warm spiced", "", "tart red + sparkling"] },
    { label: "Flow", low: "steady", high: "halting", value: halting, readings: ["straight through", "a few pauses", "choosing words carefully"], hints: ["warm spiced", "", "bright citrus base"] },
    { label: "Tone", low: "flat", high: "lively", value: animated, readings: ["flat, tired", "relaxed", "animated"], hints: ["", "", "sharp sour accent"] },
  ];
}

function dialBand(value: number) {
  return value < 0.33 ? 0 : value <= 0.66 ? 1 : 2;
}

function VoiceDialRow({ dial, delay = 0 }: { dial: VoiceDial; delay?: number }) {
  const band = dialBand(dial.value);
  const markerStyle = { "--dial-position": `${dial.value * 100}%`, animationDelay: `${delay}ms` } as CSSProperties;
  return (
    <div className="voice-dial">
      <div className="dial-heading"><strong>{dial.label}</strong><span>{dial.low}</span><i /><span>{dial.high}</span></div>
      <div className="dial-track"><i style={markerStyle} /></div>
      <div className="dial-reading"><strong>{dial.readings[band]}</strong>{dial.hints[band] && <span>→ {dial.hints[band]}</span>}</div>
    </div>
  );
}

function VoiceRead({ value, showRaw = false }: { value: VoiceFeatures; showRaw?: boolean }) {
  const raw = [
    ["Pitch", `${Math.round(value.pitch_mean_hz)} Hz`],
    ["Pitch wobble", `${value.pitch_sd_hz.toFixed(1)} Hz`],
    ["Loudness", `${value.loudness_db.toFixed(1)} dB`],
    ["Pauses", `${Math.round(value.pause_ratio * 100)}%`],
    ["Pace", `${value.onset_rate_hz.toFixed(2)} onsets/s`],
    ["Voice strain / jitter", `${value.jitter_pct.toFixed(2)}%`],
  ];
  return (
    <div className="voice-read">
      {voiceDials(value).map((dial, index) => <VoiceDialRow key={dial.label} dial={dial} delay={index * 110} />)}
      {showRaw && <details className="raw-readings"><summary>Show the numbers</summary><div>{raw.map(([label, reading]) => <p key={label}><span>{label}</span><strong>{reading}</strong></p>)}</div></details>}
    </div>
  );
}

function ThinkingState({ features: value, now }: { features: VoiceFeatures; now: number }) {
  void now;
  return (
    <section className="thinking-layout">
      <header><div><p>READING YOUR VOICE</p><h1>Finding your mix…</h1></div><BartenderFace mood="thinking" size="small" /></header>
      <VoiceRead value={value} />
      <div className="shimmer-line" aria-label="Analysis in progress" />
    </section>
  );
}

function RevealState({ recipe: value, features: featureValues }: { recipe: Recipe; features: VoiceFeatures }) {
  return (
    <section className="reveal-layout">
      <div className="reveal-main">
        <BartenderFace mood="pleased" size="small" />
        <p className="eyebrow">YOUR DRINK IS</p>
        <h1>{value.name}</h1>
        <span className="mood-chip">{value.mood}</span>
      </div>
      <aside className="proof-panel">
        <p className="bartender-read">“{value.rationale}”</p>
        <VoiceRead value={featureValues} showRaw />
      </aside>
    </section>
  );
}

function PouringState({ machine, now }: { machine: MachineState; now: number }) {
  const activeIndex = machine.pour ? Math.max(0, machine.pour.index - 1) : machine.recipe?.pours.length ?? 0;
  const currentProgress = machine.pour
    ? Math.max(0, Math.min(1, (now - machine.pour.started_at_ms) / machine.pour.duration_ms))
    : 1;
  const currentMl = machine.pour ? Math.round(machine.pour.ml * currentProgress) : 0;
  const pours = machine.recipe?.pours ?? recipe.pours;
  const pouringComplete = machine.pour === null;

  return (
    <section className="pour-layout">
      <header>
        <BartenderFace mood="focused" size="medium" />
        <p>{pouringComplete ? "ALL POURS COMPLETE" : `POUR ${activeIndex + 1} OF ${pours.length}`}</p>
        <h1>{pouringComplete ? "Drink complete" : machine.ingredients[String(machine.pour?.channel)]}</h1>
        {!pouringComplete && <strong>{currentMl} / {machine.pour?.ml ?? 0} ml</strong>}
      </header>
      <div className="pour-bars">
        {pours.map((pour, index) => {
          const fill = index < activeIndex ? 1 : index === activeIndex ? currentProgress : 0;
          return (
            <div className={`pour-item ${index === activeIndex && !pouringComplete ? "active" : ""}`} key={`${pour.channel}-${index}`}>
              <div className="pour-vessel"><i style={{ height: `${fill * 100}%` }} /></div>
              <span>{machine.ingredients[String(pour.channel)]}</span>
              <strong>{pour.ml} ml</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ServingState({ recipe: value }: { recipe: Recipe }) {
  return (
    <section className="serving-layout">
      <BartenderFace mood="celebrating" />
      <div><p>IT’S READY</p><h1>Take your drink</h1><h2>{value.name}</h2></div>
    </section>
  );
}

function ErrorState({ message, onReset }: { message: string | null; onReset: () => void }) {
  return (
    <section className="error-layout">
      <BartenderFace mood="concerned" size="medium" />
      <h1>Something interrupted the mix.</h1>
      <p>{message || "Please check the machine, then try once more."}</p>
      <button type="button" onClick={onReset}>Try again</button>
    </section>
  );
}