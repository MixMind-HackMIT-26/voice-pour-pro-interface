import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, GlassWater, Mic, X, ArrowLeft, Zap } from "lucide-react";

type MachineStateName =
  | "idle"
  | "greeting"
  | "sample_ready"
  | "sampling"
  | "feedback"
  | "final_ready"
  | "cancelled"
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
  mode?: "quick" | "mixed";
  speech?: string | null;
  session_id?: string;
  version?: number;
  updates_left?: number;
  allowed_actions?: string[];
  mixed_available?: boolean;
  sample_ratio?: number;
  samples_enabled?: boolean;
  sample_recipe?: Recipe;
  cup?: { hint: string; max_ml: number };
  ranges?: Record<string, [number, number]>;
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
  "3": "Lime cordial",
  "4": "Ginger ale",
  "5": "Grape juice",
  "6": "Apple juice",
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
  rationale:
    "You took your time and your voice stayed level — something bright, gentle, and restoring felt right.",
  pours: [
    { channel: 1, ml: 45 },
    { channel: 5, ml: 30 },
    { channel: 6, ml: 40 },
  ],
  stir_seconds: 0,
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
      {
        name: "description",
        content: "MixMind listens, understands, and mixes a drink to match your voice.",
      },
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
  const [disconnected, setDisconnected] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const liveConnected = useRef(false);
  const demoMixed = useRef(false);
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
  const clockNeeded =
    (isDemo && demoRunning) ||
    machine.state === "thinking" ||
    machine.state === "pouring" ||
    machine.state === "sampling";
  useEffect(() => {
    if (!clockNeeded) return;
    setNow(Date.now()); // don't start from a stale time
    const clock = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(clock);
  }, [clockNeeded]);

  useEffect(() => {
    if (!isDemo) return;
    if (!demoRunning) {
      return;
    }
    const nextState = getDemoState(demoEpoch.current, now);
    if (demoMixed.current && ["reveal", "pouring", "serving"].includes(nextState.state)) {
      setDemoRunning(false);
      setMachine({
        ...nextState,
        state: "sample_ready",
        mode: "mixed",
        version: 1,
        updates_left: 2,
        session_id: "demo",
        allowed_actions: ["sample", "finish", "cancel"],
        speech: "Your drink pairs orange with grape and apple. How does that balance sound?",
      });
      return;
    }
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
        const snapshot = JSON.parse(text) as MachineState;
        if (!snapshot.state || !snapshot.ingredients) throw new Error("Invalid machine state");
        if (cancelled) return;
        liveConnected.current = true;
        setDisconnected(false);
        if (isDemo) {
          // the backend is back: leave demo
          setIsDemo(false);
          setDemoRunning(false);
        }
        // Redraw only when the machine actually changed: on the idle screen
        // it answers the same thing five times a second.
        if (text !== lastState.current) {
          lastState.current = text;
          setMachine(snapshot);
        }
      } catch {
        if (!cancelled && liveConnected.current) {
          setDisconnected(true);
        } else if (!cancelled && !isDemo) {
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

  const start = useCallback(
    async (mode: "quick" | "mixed") => {
      if (isDemo) {
        demoMixed.current = mode === "mixed";
        demoEpoch.current = Date.now() - demoStages[0].duration;
        setDemoRunning(true);
        setNow(Date.now());
        return;
      }
      setActionPending(true);
      setActionError("");
      try {
        const response = await fetch("/api/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!response.ok) throw new Error("The machine could not start this session.");
      } catch {
        setActionError("The machine could not start this session. Please try again.");
      } finally {
        setActionPending(false);
      }
    },
    [isDemo],
  );

  const act = async (action: string) => {
    if (isDemo) {
      const current = machine.recipe ?? recipe;
      if (action === "cancel") {
        setMachine(baseState);
        return;
      }
      if (action === "finish") {
        setMachine({
          ...machine,
          state: "final_ready",
          speech: "Place a fresh cup with ice under the spouts.",
          allowed_actions: ["pour", "back", "cancel"],
        });
        return;
      }
      if (action === "pour") {
        setMachine({
          ...machine,
          state: "serving",
          speech: "That is yours. Give it a stir and mind the ice.",
          allowed_actions: [],
        });
        window.setTimeout(() => setMachine(baseState), 7000);
        return;
      }
      if (action === "feedback" && (machine.version ?? 1) < 3) {
        const nextVersion = (machine.version ?? 1) + 1;
        const nextRecipe = {
          ...current,
          pours: current.pours.map((p) => ({
            ...p,
            ml: p.channel === 1 ? p.ml + 5 : p.channel === 5 ? p.ml - 5 : p.ml,
          })),
        };
        setMachine({
          ...machine,
          recipe: nextRecipe,
          version: nextVersion,
          updates_left: 3 - nextVersion,
          state: "sample_ready",
          speech: "This version has less grape and more orange. Is that closer?",
          allowed_actions: ["sample", "finish", "cancel"],
        });
        return;
      }
      setMachine({
        ...machine,
        state: "feedback",
        speech:
          (machine.version ?? 1) < 3
            ? "Give your sample a stir and a taste. What would you change?"
            : "Shall I make the full drink?",
        allowed_actions: ["feedback", "finish", "cancel"],
      });
      return;
    }
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, session_id: machine.session_id, version: machine.version }),
      });
      if (!response.ok) throw new Error("Action unavailable");
    } catch {
      setActionError("That action is unavailable. Please wait for the machine and try again.");
    } finally {
      setActionPending(false);
    }
  };

  const reset = useCallback(async () => {
    if (isDemo) {
      demoEpoch.current = Date.now();
      setDemoRunning(false);
      setNow(Date.now());
      return;
    }
    try {
      const response = await fetch("/api/reset", { method: "POST" });
      if (!response.ok) throw new Error("Reset unavailable");
    } catch {
      setActionError("The machine cannot reset yet.");
    }
  }, [isDemo]);

  return (
    <main className="kiosk-shell" aria-live="polite">
      <div className="kiosk-topline">
        {machine.state !== "idle" && <Logo compact />}
        {isDemo && <span className="demo-tag">DEMO</span>}
      </div>
      <div className="state-stage" key={machine.state}>
        {machine.state === "idle" && (
          <IdleState
            onStart={start}
            disabled={actionPending || disconnected}
            mixedAvailable={isDemo || machine.mixed_available !== false}
            cup={machine.cup?.hint}
          />
        )}
        {machine.state === "greeting" && (
          <section className="conversation-state">
            <BartenderFace mood="ready" size="medium" />
            <h1>{machine.speech}</h1>
          </section>
        )}
        {machine.state === "listening" && <ListeningState machine={machine} />}
        {machine.state === "thinking" && (
          <ThinkingState features={machine.features} ranges={machine.ranges} now={now} />
        )}
        {machine.state === "reveal" && (
          <RevealState
            recipe={machine.recipe ?? recipe}
            features={machine.features ?? features}
            speech={machine.speech}
            ranges={machine.ranges}
          />
        )}
        {(machine.state === "pouring" || machine.state === "sampling") && (
          <PouringState
            machine={
              machine.state === "sampling"
                ? { ...machine, recipe: machine.sample_recipe ?? machine.recipe }
                : machine
            }
            now={now}
          />
        )}
        {["sample_ready", "feedback", "final_ready"].includes(machine.state) && (
          <NegotiationState
            machine={machine}
            onAction={act}
            disabled={actionPending || disconnected}
          />
        )}
        {machine.state === "cancelled" && (
          <section className="conversation-state">
            <BartenderFace mood="ready" size="medium" />
            <h1>{machine.speech}</h1>
          </section>
        )}
        {machine.state === "serving" && <ServingState recipe={machine.recipe ?? recipe} />}
        {machine.state === "error" && <ErrorState message={machine.error} onReset={reset} />}
      </div>
      {machine.speech && ["pouring", "serving"].includes(machine.state) && (
        <div className="speech-caption">{machine.speech}</div>
      )}
      {actionError && (
        <div className="action-error" role="alert" onClick={() => setActionError("")}>
          {actionError}
        </div>
      )}
      {disconnected && (
        <div className="connection-overlay" role="alert">
          <h1>Reconnecting to MixMind...</h1>
          <p>Your session is still on the machine.</p>
        </div>
      )}
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

type BartenderMood =
  "ready" | "listening" | "thinking" | "pleased" | "focused" | "celebrating" | "concerned";

function BartenderFace({
  mood,
  size = "large",
}: {
  mood: BartenderMood;
  size?: "small" | "medium" | "large";
}) {
  return (
    <div className={`bartender-face bartender-${mood} bartender-${size}`} aria-hidden="true">
      <svg viewBox="0 0 240 240" fill="none">
        <circle className="aura aura-outer" cx="120" cy="120" r="108" />
        <circle className="aura aura-inner" cx="120" cy="120" r="94" />
        <path className="shoulders" d="M46 226c13-36 39-52 74-52s61 16 74 52" />
        <path className="jacket" d="m86 181 34 31 34-31M120 212v14" />
        <path
          className="face-line"
          d="M70 61c11-25 31-38 50-38s39 13 50 38v56c0 42-23 72-50 72s-50-30-50-72V61Z"
        />
        <path
          className="hair"
          d="M70 71c2-34 24-52 50-52 27 0 48 19 51 52-16-6-28-18-37-34-13 20-35 30-64 34Z"
        />
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

function IdleState({
  onStart,
  disabled,
  mixedAvailable,
  cup,
}: {
  onStart: (mode: "quick" | "mixed") => void;
  disabled: boolean;
  mixedAvailable: boolean;
  cup?: string | undefined;
}) {
  return (
    <section className="idle-touch">
      <div className="idle-mark">
        <Logo />
      </div>
      <div className="idle-persona">
        <BartenderFace mood="ready" />
        <div className="idle-greeting">
          <span>YOUR PERSONAL MIXOLOGIST</span>
          <strong>Good evening.</strong>
          <p>Tell me about your day and I’ll craft your drink.</p>
        </div>
      </div>
      <div className="mode-actions">
        <button disabled={disabled} onClick={() => onStart("quick")}>
          <Zap />
          Quick Mix
        </button>
        <button disabled={disabled || !mixedAvailable} onClick={() => onStart("mixed")}>
          <GlassWater />
          Taste &amp; Tune
        </button>
      </div>
      {cup && <p className="cup-hint">{cup}</p>}
    </section>
  );
}

function ListeningState({ machine }: { machine: MachineState }) {
  const level = Math.max(0, Math.min(100, ((machine.level_db + 60) / 60) * 100));
  return (
    <section className="listening-layout">
      <div className="meter-wrap" aria-label={`Microphone level ${Math.round(level)} percent`}>
        <div className="meter-scale">
          <span>LOUD</span>
          <span>QUIET</span>
        </div>
        <div className="level-meter">
          <div style={{ height: `${level}%` }} />
        </div>
      </div>
      <div className="listening-copy">
        <BartenderFace mood="listening" size="medium" />
        <div className="sound-wave" aria-hidden="true">
          {[30, 54, 78, 44, 92, 62, 36].map((height, index) => (
            <i key={index} style={{ height }} />
          ))}
        </div>
        <h1>I’m listening…</h1>
        <p>Keep talking naturally.</p>
        <div className="elapsed">
          <strong>{Math.min(25, machine.elapsed_s).toFixed(1)}</strong>
          <span>/ 25 seconds</span>
        </div>
      </div>
    </section>
  );
}

type VoiceDial = {
  label: string;
  low: string;
  high: string;
  value: number;
  readings: [string, string, string];
  hints: [string, string, string];
};

function normalize(value: number, low: number, high: number) {
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

function voiceDials(value: VoiceFeatures, ranges?: Record<string, [number, number]>): VoiceDial[] {
  const energy =
    0.5 *
      normalize(
        value.loudness_db,
        ...(ranges?.["loudness_db"] ?? ([-32, -12] as [number, number])),
      ) +
    0.5 *
      normalize(
        value.onset_rate_hz,
        ...(ranges?.["onset_rate_hz"] ?? ([0.5, 2.1] as [number, number])),
      );
  const halting = normalize(
    value.pause_ratio,
    ...(ranges?.["pause_ratio"] ?? ([0.018, 0.143] as [number, number])),
  );
  const animated = normalize(
    value.pitch_sd_hz,
    ...(ranges?.["pitch_sd_hz"] ?? ([19, 26.7] as [number, number])),
  );
  return [
    {
      label: "Energy",
      low: "low",
      high: "high",
      value: energy,
      readings: ["running low", "even keel", "fired up"],
      hints: ["dark sweet comfort + warm spiced", "", "tart red + sparkling"],
    },
    {
      label: "Flow",
      low: "steady",
      high: "halting",
      value: halting,
      readings: ["straight through", "a few pauses", "choosing words carefully"],
      hints: ["warm spiced", "", "bright citrus base"],
    },
    {
      label: "Tone",
      low: "flat",
      high: "lively",
      value: animated,
      readings: ["level pitch", "varied pitch", "animated"],
      hints: ["", "", "sharp sour accent"],
    },
  ];
}

function dialBand(value: number) {
  return value < 0.33 ? 0 : value <= 0.66 ? 1 : 2;
}

function VoiceDialRow({ dial, delay = 0 }: { dial: VoiceDial; delay?: number }) {
  const band = dialBand(dial.value);
  const markerStyle = {
    "--dial-position": `${dial.value * 100}%`,
    animationDelay: `${delay}ms`,
  } as CSSProperties;
  return (
    <div className="voice-dial">
      <div className="dial-heading">
        <strong>{dial.label}</strong>
        <span>{dial.low}</span>
        <i />
        <span>{dial.high}</span>
      </div>
      <div className="dial-track">
        <i style={markerStyle} />
      </div>
      <div className="dial-reading">
        <strong>{dial.readings[band]}</strong>
        {dial.hints[band] && <span>→ {dial.hints[band]}</span>}
      </div>
    </div>
  );
}

function VoiceRead({
  value,
  showRaw = false,
  ranges,
}: {
  value: VoiceFeatures;
  showRaw?: boolean;
  ranges?: Record<string, [number, number]> | undefined;
}) {
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
      {voiceDials(value, ranges).map((dial, index) => (
        <VoiceDialRow key={dial.label} dial={dial} delay={index * 110} />
      ))}
      {showRaw && (
        <details className="raw-readings">
          <summary>Show the numbers</summary>
          <div>
            {raw.map(([label, reading]) => (
              <p key={label}>
                <span>{label}</span>
                <strong>{reading}</strong>
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ThinkingState({
  features: value,
  now,
  ranges,
}: {
  features: VoiceFeatures | null;
  now: number;
  ranges?: Record<string, [number, number]> | undefined;
}) {
  void now;
  return (
    <section className="thinking-layout">
      <header>
        <div>
          <p>READING YOUR VOICE</p>
          <h1>Finding your mix…</h1>
        </div>
        <BartenderFace mood="thinking" size="small" />
      </header>
      {value && <VoiceRead value={value} ranges={ranges} />}
      <div className="shimmer-line" aria-label="Analysis in progress" />
    </section>
  );
}

function RevealState({
  recipe: value,
  features: featureValues,
  speech,
  ranges,
}: {
  recipe: Recipe;
  features: VoiceFeatures;
  speech?: string | null | undefined;
  ranges?: Record<string, [number, number]> | undefined;
}) {
  return (
    <section className="reveal-layout">
      <div className="reveal-main">
        <BartenderFace mood="pleased" size="small" />
        <p className="eyebrow">YOUR DRINK IS</p>
        <h1>{value.name}</h1>
        <span className="mood-chip">{value.mood}</span>
      </div>
      <aside className="proof-panel">
        <p className="bartender-read">{speech === undefined ? value.rationale : speech}</p>
        <VoiceRead value={featureValues} showRaw ranges={ranges} />
      </aside>
    </section>
  );
}

function PouringState({ machine, now }: { machine: MachineState; now: number }) {
  // pour.index counts from 1; activeIndex counts from 0
  const activeIndex = machine.pour
    ? Math.max(0, machine.pour.index - 1)
    : (machine.recipe?.pours.length ?? 0);
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
        <p>
          {pouringComplete ? "ALL POURS COMPLETE" : `POUR ${activeIndex + 1} OF ${pours.length}`}
        </p>
        <h1>
          {pouringComplete ? "Drink complete" : machine.ingredients[String(machine.pour?.channel)]}
        </h1>
        {!pouringComplete && (
          <strong>
            {currentMl} / {machine.pour?.ml ?? 0} ml
          </strong>
        )}
      </header>
      <div className="pour-bars">
        {/* one bar per pump the machine has, not per ingredient in the drink:
            the pumps this drink does not use stay dim and empty */}
        {Object.keys(machine.ingredients)
          .map(Number)
          .sort((a, b) => a - b)
          .map((channel) => {
            const order = pours.findIndex((p) => p.channel === channel);
            const pour = order < 0 ? null : pours[order];
            const fill = !pour
              ? 0
              : order < activeIndex
                ? 1
                : order === activeIndex
                  ? currentProgress
                  : 0;
            const active = pour !== null && order === activeIndex && !pouringComplete;
            return (
              <div
                className={`pour-item${active ? " active" : ""}${pour ? "" : " unused"}`}
                key={channel}
              >
                <div className="pour-vessel">
                  <i style={{ height: `${fill * 100}%` }} />
                </div>
                <span>{machine.ingredients[String(channel)]}</span>
                <strong>{pour ? `${pour.ml} ml` : "—"}</strong>
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
      <div>
        <p>IT’S READY</p>
        <h1>Take your drink</h1>
        <h2>{value.name}</h2>
      </div>
    </section>
  );
}

function ErrorState({ message, onReset }: { message: string | null; onReset: () => void }) {
  return (
    <section className="error-layout">
      <BartenderFace mood="concerned" size="medium" />
      <h1>Something interrupted the mix.</h1>
      <p>{message || "Please check the machine, then try once more."}</p>
      <button type="button" onClick={onReset}>
        Try again
      </button>
    </section>
  );
}

function NegotiationState({
  machine,
  onAction,
  disabled,
}: {
  machine: MachineState;
  onAction: (action: string) => void;
  disabled: boolean;
}) {
  const labels: Record<string, string> = {
    sample: "Cup ready: taste",
    feedback: "Give feedback",
    finish: "Pour this drink",
    pour: "Cup ready: pour",
    cancel: "Cancel",
    back: "Back",
  };
  const icons: Record<string, typeof Mic> = {
    sample: GlassWater,
    feedback: Mic,
    finish: Check,
    pour: GlassWater,
    cancel: X,
    back: ArrowLeft,
  };
  const total = machine.recipe?.pours.reduce((sum, p) => sum + p.ml, 0) ?? 0;
  return (
    <section className="negotiation-layout">
      <header>
        <div>
          <p className="eyebrow">
            TASTE &amp; TUNE ·{" "}
            {machine.version ? `VERSION ${machine.version} OF 3` : "YOUR PREFERENCES"}
          </p>
          <h1>{machine.recipe?.name ?? "Finding your mix"}</h1>
        </div>
        <BartenderFace mood="pleased" size="small" />
      </header>
      <div className="negotiation-body">
        <div>
          <p className="negotiation-message">{machine.speech}</p>
          {(machine.state === "sample_ready" || machine.allowed_actions?.includes("sample")) && (
            <p className="sample-cup">
              {machine.samples_enabled === false ? (
                "Tasting is unavailable on this machine."
              ) : (
                <>
                  Place a separate tasting cup under the spouts.
                  <br />
                  Sample: {(total * (machine.sample_ratio ?? 0.08)).toFixed(2)} mL
                </>
              )}
            </p>
          )}
        </div>
        <ul>
          {machine.recipe?.pours.map((p) => (
            <li key={p.channel}>
              <span>{machine.ingredients[String(p.channel)]}</span>
              <strong>{p.ml} mL</strong>
            </li>
          ))}
          {total > 0 && (
            <li>
              <span>Final serving</span>
              <strong>{total} mL</strong>
            </li>
          )}
        </ul>
      </div>
      <div className="session-actions">
        {(machine.allowed_actions ?? []).map((action) => {
          const Icon = icons[action] ?? Check;
          return (
            <button
              key={action}
              disabled={disabled}
              onClick={() => onAction(action)}
              className={action === "cancel" ? "secondary" : ""}
            >
              <Icon />
              {labels[action]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
