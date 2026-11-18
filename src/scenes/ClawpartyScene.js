import { Gfx, Label, drawSprite, loadImages } from "../lib/draw.js";
import { Clock } from "../lib/loop.js";
import { between, clamp, distance, floatBetween, lerp, shuffle } from "../lib/math.js";

/**
 * @typedef {import("../game/types.js").Contestant} Contestant
 * @typedef {import("../game/types.js").ContestantConfig} ContestantConfig
 * @typedef {import("../game/types.js").Ingredient} Ingredient
 * @typedef {import("../game/types.js").InputController} InputController
 * @typedef {import("../game/types.js").MiniGameDefinition} MiniGameDefinition
 * @typedef {import("../game/types.js").MiniGameKey} MiniGameKey
 * @typedef {import("../game/types.js").PaintBoard} PaintBoard
 * @typedef {import("../game/types.js").Pearl} Pearl
 * @typedef {import("../game/types.js").Point} Point
 * @typedef {import("../lib/draw.js").SpriteDraw} SpriteDraw
 * @typedef {ReturnType<typeof import("../lib/loop.js").createViewport>} Viewport
 */

/**
 * A contestant as drawn: shadow, walking sprite, hat, carried item, name and
 * score, all relative to the contestant's rounded position.
 * @typedef {object} ContestantView
 * @property {number} x
 * @property {number} y
 * @property {{ x: number, y: number, w: number, h: number, frame: number, angle: number, alpha: number, flipX: boolean }} sprite
 * @property {Gfx} accessory
 * @property {Gfx} carryIcon
 * @property {Label} label
 * @property {Label} score
 */

/** @typedef {{ left: number, right: number, top: number, bottom: number, width: number, height: number, cx: number, cy: number }} ArenaBounds */
/** @typedef {{ x: number, y: number, lifeMs: number, color: number }} Burst */
/** @typedef {{ id: number, x: number, y: number, vx: number, sprite: string, wobble: number }} CountCritter */
/** @typedef {{ x: number, y: number, w: number, h: number, color: number, name: string, safe: boolean }} MemoryTile */
/** @typedef {{ id: number, x: number, y: number, vx: number, vy: number, lastTouchId?: number, cooldownMs: number }} SoccerBall */
/** @typedef {{ playerId: number, x: number, y: number, homeX: number, homeY: number, carriedBy?: number, delivered: boolean, color: number }} DogBone */
/** @typedef {{ playerId: number, bonePlayerId: number, fromX: number, fromY: number, homeX: number, homeY: number }} DogCatch */
/**
 * @typedef {object} DogChase
 * @property {DogCatch[]} caught
 * @property {"toPlayer" | "toHome" | "back"} phase
 * @property {number} x
 * @property {number} y
 * @property {number} fromX
 * @property {number} fromY
 * @property {number} toX
 * @property {number} toY
 * @property {number} elapsedMs
 * @property {number} durationMs
 */
/**
 * @typedef {object} SavedContestant
 * @property {number} id
 * @property {string} name
 * @property {string} sprite
 * @property {number} color
 * @property {string} uiColor
 * @property {boolean} isHuman
 * @property {string} [skillLabel]
 * @property {number} crowns
 * @property {number} roundScore
 * @property {number} totalScore
 * @property {number} difficulty
 * @property {number} mistakeRate
 * @property {number} reactionMs
 * @property {number} paintShapeIndex
 */
/**
 * @typedef {object} SavedPartyProgress
 * @property {number} version
 * @property {number} savedAt
 * @property {"countdown" | "playing" | "roundOver"} phase
 * @property {number} roundIndex
 * @property {MiniGameKey} currentGameKey
 * @property {number} timerMs
 * @property {MiniGameKey} [singleGameKey]
 * @property {SavedContestant[]} contestants
 */

const TOTAL_ROUNDS = 6;
const COUNTDOWN_MS = 5_000;
const PEARL_PANIC_ASPECT = 1216 / 770;
const PARTY_SAVE_KEY = "clawparty-party-progress-v1";
const PARTY_SAVE_MAX_AGE_MS = 1000 * 60 * 60 * 6;
const PAINT_NODE_SPACING = 9;
const PAINT_TRACE_RADIUS = 9;
const PAINT_LINE_GRACE = 11;
const PAINT_OFFLINE_GRACE = 15;

const CPU_PRESETS = [
  { difficulty: 0, mistakeRate: 0, reactionMs: 0, skillLabel: "" },
  { difficulty: 0.48, mistakeRate: 0.28, reactionMs: 720, skillLabel: "Good CPU" },
  { difficulty: 0.32, mistakeRate: 0.42, reactionMs: 940, skillLabel: "Medium CPU" },
  { difficulty: 0.18, mistakeRate: 0.6, reactionMs: 1_240, skillLabel: "Messy CPU" },
];

/** @type {MiniGameDefinition[]} */
const MINI_GAMES = [
  {
    key: "claw",
    name: "Pearl Panic",
    objective: "Carry pearls to your tidepool!",
    durationMs: 30_000,
  },
  {
    key: "soccer",
    name: "Goal Rush",
    objective: "Take turns. Aim left/right, then shoot!",
    durationMs: 30_000,
  },
  {
    key: "paint",
    name: "Beret Trace",
    objective: "Complete as many shapes as you can!",
    durationMs: 30_000,
  },
  {
    key: "dog",
    name: "Bone Nap",
    objective: "Grab your bone. Freeze when the dog wakes!",
    durationMs: 30_000,
  },
  {
    key: "count",
    name: "Critter Count",
    objective: "Count all things going across the screen!",
    durationMs: 30_000,
  },
  {
    key: "memory",
    name: "Tile Tide",
    objective: "Remember colors, then stand on the called one!",
    durationMs: 30_000,
  },
];

/** @type {ContestantConfig[]} */
const CONTESTANTS = [
  { id: 0, name: "Invado", sprite: "invader", color: 0x5cc8ff, uiColor: "#5cc8ff", isHuman: true },
  { id: 1, name: "Shrimpy", sprite: "shrimp", color: 0xff8b4c, uiColor: "#ff8b4c", isHuman: false },
  { id: 2, name: "Pip", sprite: "apple", color: 0xe62b5e, uiColor: "#e62b5e", isHuman: false },
  { id: 3, name: "Lobstar", sprite: "lobster", color: 0xff3b26, uiColor: "#ff3b26", isHuman: false },
];

const SPRITE_DIR = "assets/sprites/";

/** Images by name; each walk sheet is a strip of four 96x96 frames. */
const IMAGE_FILES = {
  "invader-walk": "invader-walk.png",
  "shrimp-walk": "shrimp-walk.png",
  "apple-walk": "apple-walk.png",
  "lobster-walk": "lobster-walk.png",
  "dog-sleep": "dog-sleep.png",
  "dog-alert": "dog-alert.png",
  "dog-run": "dog-run.png",
  bone: "bone.png",
  "soccer-ball": "soccer-ball.png",
  "soccer-goal": "soccer-goal.png",
  "count-beach-sea": "critter-count-beach-sea.png",
  "claw-seabed": "pearl-panic-seabed.png",
  "clam-pearl": "clam-pearl.png",
  "clam-empty": "clam-empty.png",
};

const BACKGROUND = "#050505";

/** @param {number} x @param {number} y @returns {Point} */
const point = (x, y) => ({ x, y });

export class ClawpartyScene {
  /** @type {InputController} */
  controls;
  /** @type {Viewport} */
  view;
  /** Game time and delayed calls. */
  time = new Clock();
  /** The game's size in CSS pixels. */
  scale = { width: window.innerWidth, height: window.innerHeight };
  /** @type {Map<string, HTMLImageElement>} */
  images = new Map();
  /** @type {Contestant[]} */
  contestants = [];
  /** @type {Map<number, ContestantView>} */
  views = new Map();
  /** Contestants from back to front, as last updated. @type {Contestant[]} */
  drawOrder = [];
  /** Images to draw this frame, each with its layer depth. @type {Array<SpriteDraw & { depth: number }>} */
  sprites = [];
  /** @type {ArenaBounds} */
  arena = this.makeArena();
  /** @type {"lobby" | "countdown" | "playing" | "roundOver" | "final"} */
  phase = "lobby";
  roundIndex = 0;
  /** @type {MiniGameDefinition} */
  currentGame = MINI_GAMES[0];
  timerMs = 0;
  countdownMs = COUNTDOWN_MS;
  /** @type {Ingredient[]} */
  ingredients = [];
  /** @type {Pearl[]} */
  pearls = [];
  /** @type {PaintBoard[]} */
  paintBoards = [];
  /** @type {CountCritter[]} */
  countCritters = [];
  countActual = 0;
  countSpawnMs = 0;
  countWatchMs = 18_000;
  countTarget = 0;
  countGuessStarted = false;
  countGuessLockGraceMs = 0;
  /** @type {MemoryTile[]} */
  memoryTiles = [];
  memoryCycle = 0;
  /** @type {"show" | "choose" | "resolve"} */
  memoryPhase = "show";
  memoryPhaseMs = 0;
  memoryTarget = "red";
  /** @type {SoccerBall[]} */
  soccerBalls = [];
  soccerKeeperId = 0;
  /** @type {number[]} */
  soccerShooterOrder = [];
  soccerShooterIndex = 0;
  soccerCurrentShooterId = 0;
  /** @type {"aim" | "shot" | "reset"} */
  soccerPhase = "aim";
  soccerTurnMs = 0;
  soccerAimX = 0;
  /** @type {DogBone[]} */
  dogBones = [];
  /** @type {"sleep" | "look"} */
  dogState = "sleep";
  dogStateMs = 0;
  dogGraceMs = 0;
  /** @type {DogChase | undefined} */
  dogChase;
  paintPointer = { down: false, x: 0, y: 0 };
  /** @type {Burst[]} */
  bursts = [];
  nextItemId = 1;
  toastUntil = 0;
  domTickMs = 0;
  lastPartySaveMs = 0;
  /** @type {Map<number, number>} */
  rankMoves = new Map();

  // Shapes recorded each frame, drawn in this order: world, paint, props, effects.
  worldGfx = new Gfx();
  paintGfx = new Gfx();
  propGfx = new Gfx();
  effectsGfx = new Gfx();
  countdownText = new Label({ fontSize: 92, color: "#fff4d7", stroke: "#000000", strokeThickness: 10 }).setVisible(false);
  overlayText = new Label({ fontSize: 46, color: "#fff4d7", stroke: "#000000", strokeThickness: 7 }).setVisible(false);
  overlayHint = new Label({ fontSize: 14, color: "#6ed7ff", stroke: "#000000", strokeThickness: 4, align: "center", wrapWidth: 280 }).setVisible(false);

  /** @type {HTMLElement | null} */
  roundChip = null;
  /** @type {HTMLElement | null} */
  modeChip = null;
  /** @type {HTMLElement | null} */
  timerChip = null;
  /** @type {HTMLElement | null} */
  scorebar = null;
  /** @type {HTMLElement | null} */
  roster = null;
  /** @type {HTMLElement | null} */
  menuPanel = null;
  /** @type {HTMLElement | null} */
  menuSubtitle = null;
  /** @type {HTMLButtonElement | null} */
  startButton = null;
  /** @type {HTMLButtonElement | null} */
  shuffleButton = null;
  /** @type {HTMLButtonElement | null} */
  miniGameToggleButton = null;
  /** @type {HTMLElement | null} */
  miniGamePicker = null;
  /** @type {HTMLElement | null} */
  resultPanel = null;
  /** @type {HTMLElement | null} */
  resultTitle = null;
  /** @type {HTMLElement | null} */
  resultSubtitle = null;
  /** @type {HTMLElement | null} */
  resultList = null;
  /** @type {HTMLElement | null} */
  toast = null;
  /** @type {MiniGameKey | undefined} */
  singleGameKey;

  /**
   * @param {InputController} controls
   * @param {Viewport} view
   */
  constructor(controls, view) {
    this.controls = controls;
    this.view = view;
  }

  async preload() {
    const sources = Object.fromEntries(Object.entries(IMAGE_FILES).map(([name, file]) => [name, SPRITE_DIR + file]));
    this.images = await loadImages(sources);
  }

  create() {
    this.scale = { width: this.view.width, height: this.view.height };
    this.setupDom();
    this.setupPointerInput();
    this.createContestants();
    this.createContestantViews();
    this.layoutLobby();
    this.updateDom(true);
    this.tryRestorePartyProgress();

    window.addEventListener("beforeunload", () => {
      this.savePartyProgress(true);
    });
  }

  /**
   * One frame: follow a resize, run delayed calls, update, then draw.
   * @param {number} time
   * @param {number} deltaMs
   */
  step(time, deltaMs) {
    if (this.view.fit()) {
      this.scale.width = this.view.width;
      this.scale.height = this.view.height;
      this.arena = this.makeArena();
      this.clampContestants();
    }
    this.time.tick(time, deltaMs);
    this.update(time, deltaMs);
    this.render();
  }

  /** @param {number} time @param {number} deltaMs */
  update(time, deltaMs) {
    const delta = Math.min(deltaMs, 48) / 1000;
    this.arena = this.makeArena();
    this.worldGfx.clear();
    this.propGfx.clear();
    this.paintGfx.clear();
    this.effectsGfx.clear();
    this.sprites = [];
    this.overlayText.setVisible(false);
    this.overlayHint.setVisible(false);

    if (this.phase === "countdown") {
      this.drawCurrentArena();
      this.drawCountdownOverlay();
      this.countdownMs = Math.max(0, this.countdownMs - deltaMs);
      if (this.countdownMs <= 0) {
        this.phase = "playing";
        this.countdownText.setVisible(false);
        this.showToast(this.controlHint(), 1_900);
      }
    } else if (this.phase === "playing") {
      this.timerMs = Math.max(0, this.timerMs - deltaMs);
      this.updateActiveMinigame(delta, deltaMs);
      if (this.timerMs <= 0 || this.isRoundComplete()) {
        this.endRound();
      }
    } else {
      this.drawLobbyScene(time, delta);
      this.countdownText.setVisible(false);
    }

    this.updateBursts(deltaMs);
    this.updateContestantViews();
    this.updateDom(false, deltaMs);
    this.savePartyProgress();
  }

  setupDom() {
    this.roundChip = document.querySelector("#round-chip");
    this.modeChip = document.querySelector("#mode-chip");
    this.timerChip = document.querySelector("#timer-chip");
    this.scorebar = document.querySelector("#scorebar");
    this.roster = document.querySelector("#roster");
    this.menuPanel = document.querySelector("#menu-panel");
    this.menuSubtitle = document.querySelector("#menu-subtitle");
    this.startButton = document.querySelector("#start-button");
    this.shuffleButton = document.querySelector("#shuffle-button");
    this.miniGameToggleButton = document.querySelector("#minigame-toggle-button");
    this.miniGamePicker = document.querySelector("#minigame-picker");
    this.resultPanel = document.querySelector("#result-panel");
    this.resultTitle = document.querySelector("#result-title");
    this.resultSubtitle = document.querySelector("#result-subtitle");
    this.resultList = document.querySelector("#result-list");
    this.toast = document.querySelector("#toast");

    this.startButton?.addEventListener("click", () => {
      this.startParty(undefined);
    });

    this.shuffleButton?.addEventListener("click", () => {
      this.shuffleCpuDifficulties();
      this.showToast("CPU spice shuffled", 1100);
      this.updateDom(true);
    });

    this.miniGameToggleButton?.addEventListener("click", () => {
      this.miniGamePicker?.toggleAttribute("hidden");
    });

    this.miniGamePicker?.addEventListener("click", (/** @type {MouseEvent} */ event) => {
      const button = /** @type {HTMLElement} */ (event.target).closest("[data-minigame-key]");
      const key = /** @type {MiniGameKey | undefined} */ (/** @type {HTMLElement | null} */ (button)?.dataset.minigameKey);
      if (!key) {
        return;
      }
      this.startParty(key);
    });
  }

  setupPointerInput() {
    const canvas = this.view.canvas;
    /** @param {PointerEvent} event */
    const setPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      this.paintPointer.x = event.clientX - rect.left;
      this.paintPointer.y = event.clientY - rect.top;
    };

    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setPointer(event);
      this.paintPointer.down = true;
    });
    canvas.addEventListener("pointermove", setPointer);
    canvas.addEventListener("pointerup", (event) => {
      setPointer(event);
      this.paintPointer.down = false;
    });
    canvas.addEventListener("pointerleave", () => {
      this.paintPointer.down = false;
    });
  }

  createContestants() {
    const roster = shuffle([...CONTESTANTS]);
    this.contestants = roster.map((config, index) => this.makeContestant(config, index));
  }

  /**
   * @param {ContestantConfig} config
   * @param {number} index
   * @returns {Contestant}
   */
  makeContestant(config, index) {
    return {
      ...config,
      id: index,
      isHuman: index === 0,
      skillLabel: index === 0 ? "Player 1" : (config.skillLabel ?? CPU_PRESETS[index].skillLabel),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      crowns: 0,
      roundScore: 0,
      totalScore: 0,
      difficulty: index === 0 ? 1 : CPU_PRESETS[index].difficulty,
      mistakeRate: index === 0 ? 0 : CPU_PRESETS[index].mistakeRate,
      reactionMs: index === 0 ? 0 : CPU_PRESETS[index].reactionMs,
      targetX: 0,
      targetY: 0,
      aiThinkMs: 0,
      actionCooldownMs: 0,
      stunnedMs: 0,
      brushX: 0,
      brushY: 0,
      coveredNodes: new Set(),
      paintAccumulator: 0,
      paintPenalty: 0,
      paintShapeIndex: 0,
      countGuess: 0,
      countLocked: false,
      alive: true,
    };
  }

  shuffleCpuDifficulties() {
    for (const player of this.contestants) {
      if (!player.isHuman) {
        const preset = CPU_PRESETS[player.id];
        player.difficulty = clamp(preset.difficulty + floatBetween(-0.04, 0.04), 0.12, 0.62);
        player.mistakeRate = clamp(preset.mistakeRate + floatBetween(-0.04, 0.04), 0.12, 0.62);
        player.reactionMs = preset.reactionMs + between(-80, 120);
      }
    }
  }

  savePartyProgress(force = false) {
    if (this.phase !== "countdown" && this.phase !== "playing" && this.phase !== "roundOver") {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastPartySaveMs < 900) {
      return;
    }
    this.lastPartySaveMs = now;

    const save = {
      version: 1,
      savedAt: now,
      phase: this.phase,
      roundIndex: this.roundIndex,
      currentGameKey: this.currentGame.key,
      timerMs: this.timerMs,
      singleGameKey: this.singleGameKey,
      contestants: this.contestants.map((player) => ({
        id: player.id,
        name: player.name,
        sprite: player.sprite,
        color: player.color,
        uiColor: player.uiColor,
        isHuman: player.isHuman,
        skillLabel: player.skillLabel,
        crowns: player.crowns,
        roundScore: player.roundScore,
        totalScore: player.totalScore,
        difficulty: player.difficulty,
        mistakeRate: player.mistakeRate,
        reactionMs: player.reactionMs,
        paintShapeIndex: player.paintShapeIndex,
      })),
    };

    try {
      localStorage.setItem(PARTY_SAVE_KEY, JSON.stringify(save));
    } catch {
      // Autosave is a convenience only; gameplay should continue if storage is blocked.
    }
  }

  tryRestorePartyProgress() {
    let raw = null;
    try {
      raw = localStorage.getItem(PARTY_SAVE_KEY);
    } catch {
      return;
    }
    if (!raw) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.clearPartyProgress();
      return;
    }
    if (!this.isSavedPartyProgress(parsed) || Date.now() - parsed.savedAt > PARTY_SAVE_MAX_AGE_MS) {
      this.clearPartyProgress();
      return;
    }

    const restored = [...parsed.contestants].sort((a, b) => a.id - b.id);
    const savedById = new Map(restored.map((player) => [player.id, player]));
    this.singleGameKey = parsed.singleGameKey;
    this.contestants = restored.map((saved, index) => {
      const contestant = this.makeContestant(
        {
          id: index,
          name: saved.name,
          sprite: saved.sprite,
          color: saved.color,
          uiColor: saved.uiColor,
          isHuman: index === 0,
          skillLabel: saved.skillLabel,
        },
        index,
      );
      contestant.crowns = Math.max(0, Math.floor(saved.crowns));
      contestant.totalScore = Math.max(0, Math.floor(saved.totalScore));
      contestant.difficulty = saved.difficulty;
      contestant.mistakeRate = saved.mistakeRate;
      contestant.reactionMs = saved.reactionMs;
      return contestant;
    });

    this.createContestantViews();
    this.roundIndex = parsed.phase === "roundOver" ? parsed.roundIndex : Math.max(0, parsed.roundIndex - 1);
    this.menuPanel?.setAttribute("hidden", "true");
    this.miniGamePicker?.setAttribute("hidden", "true");
    this.resultPanel?.setAttribute("hidden", "true");
    this.rankMoves.clear();
    this.beginNextRound();
    if (parsed.phase !== "roundOver" && this.currentGame.key === parsed.currentGameKey) {
      this.timerMs = clamp(parsed.timerMs, 1_000, this.currentGame.durationMs);
      for (const player of this.contestants) {
        const saved = savedById.get(player.id);
        if (!saved) {
          continue;
        }
        player.roundScore = Math.max(0, Math.floor(saved.roundScore));
        if (this.currentGame.key === "paint") {
          player.paintShapeIndex = Math.max(0, Math.floor(saved.paintShapeIndex));
        }
      }
      if (this.currentGame.key === "paint") {
        this.restorePaintBrushes();
      }
      this.updateDom(true);
    }
    this.showToast(parsed.phase === "roundOver" ? "Recovered party progress" : "Recovered party progress: replaying this round", 2600);
  }

  /**
   * @param {unknown} value
   * @returns {value is SavedPartyProgress}
   */
  isSavedPartyProgress(value) {
    const save = /** @type {SavedPartyProgress} */ (value);
    const validGameKey = save?.singleGameKey === undefined || MINI_GAMES.some((game) => game.key === save.singleGameKey);
    return (
      Boolean(save) &&
      save.version === 1 &&
      typeof save.savedAt === "number" &&
      (save.phase === "countdown" || save.phase === "playing" || save.phase === "roundOver") &&
      Number.isInteger(save.roundIndex) &&
      save.roundIndex >= 1 &&
      save.roundIndex <= (save.singleGameKey ? 1 : TOTAL_ROUNDS) &&
      MINI_GAMES.some((game) => game.key === save.currentGameKey) &&
      typeof save.timerMs === "number" &&
      validGameKey &&
      Array.isArray(save.contestants) &&
      save.contestants.length === CONTESTANTS.length &&
      save.contestants.every(
        (player) =>
          Boolean(player) &&
          Number.isInteger(player.id) &&
          typeof player.name === "string" &&
          typeof player.sprite === "string" &&
          typeof player.color === "number" &&
          typeof player.uiColor === "string" &&
          typeof player.crowns === "number" &&
          typeof player.roundScore === "number" &&
          typeof player.totalScore === "number" &&
          typeof player.difficulty === "number" &&
          typeof player.mistakeRate === "number" &&
          typeof player.reactionMs === "number" &&
          typeof player.paintShapeIndex === "number",
      )
    );
  }

  clearPartyProgress() {
    this.lastPartySaveMs = 0;
    try {
      localStorage.removeItem(PARTY_SAVE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  createContestantViews() {
    this.views.clear();

    for (const player of this.contestants) {
      const label = new Label({ fontSize: 10, color: "#fff4d7", stroke: "#000000", strokeThickness: 3 }, 0.5, 0)
        .setText(player.isHuman ? "YOU" : player.name)
        .setPosition(0, 20);
      const score = new Label({ fontSize: 13, color: "#ffffff", stroke: "#000000", strokeThickness: 4 }).setPosition(0, -64);
      this.views.set(player.id, {
        x: player.x,
        y: player.y,
        sprite: { x: 0, y: -19, w: 58, h: 58, frame: 0, angle: 0, alpha: 1, flipX: false },
        accessory: new Gfx(),
        carryIcon: new Gfx(),
        label,
        score,
      });
    }
  }

  /** @param {MiniGameKey} [singleGameKey] */
  startParty(singleGameKey) {
    this.clearPartyProgress();
    this.singleGameKey = singleGameKey;
    this.phase = "playing";
    this.createContestants();
    this.createContestantViews();
    this.roundIndex = 0;
    this.menuPanel?.setAttribute("hidden", "true");
    this.miniGamePicker?.setAttribute("hidden", "true");
    this.resultPanel?.setAttribute("hidden", "true");
    this.rankMoves.clear();
    for (const player of this.contestants) {
      player.crowns = 0;
      player.totalScore = 0;
      player.roundScore = 0;
    }
    this.beginNextRound();
  }

  beginNextRound() {
    this.roundIndex += 1;
    const roundLimit = this.singleGameKey ? 1 : TOTAL_ROUNDS;
    if (this.roundIndex > roundLimit) {
      this.finishParty();
      return;
    }

    this.currentGame = this.singleGameKey
      ? (MINI_GAMES.find((game) => game.key === this.singleGameKey) ?? MINI_GAMES[0])
      : MINI_GAMES[(this.roundIndex - 1) % MINI_GAMES.length];
    this.timerMs = this.currentGame.durationMs;
    this.countdownMs = COUNTDOWN_MS;
    this.phase = "countdown";
    this.controls.consumeActionPress();
    this.resultPanel?.setAttribute("hidden", "true");
    this.toast?.classList.remove("is-visible");
    this.toastUntil = 0;
    this.ingredients = [];
    this.pearls = [];
    this.paintBoards = [];
    this.countCritters = [];
    this.memoryTiles = [];
    this.soccerBalls = [];
    this.dogBones = [];
    this.bursts = [];
    this.resetRoundPlayers();

    if (this.currentGame.key === "chef") {
      this.setupChef();
    } else if (this.currentGame.key === "paint") {
      this.setupPaint();
    } else if (this.currentGame.key === "claw") {
      this.setupClaw();
    } else if (this.currentGame.key === "soccer") {
      this.setupSoccer();
    } else if (this.currentGame.key === "dog") {
      this.setupDog();
    } else if (this.currentGame.key === "count") {
      this.setupCount();
    } else {
      this.setupMemory();
    }

    this.updateDom(true);
    this.savePartyProgress(true);
  }

  resetRoundPlayers() {
    for (const player of this.contestants) {
      player.roundScore = 0;
      player.carrying = undefined;
      player.carryingPearl = undefined;
      player.vx = 0;
      player.vy = 0;
      player.actionCooldownMs = 0;
      player.stunnedMs = 0;
      player.finishMs = undefined;
      player.coveredNodes = new Set();
      player.paintAccumulator = 0;
      player.paintPenalty = 0;
      player.paintShapeIndex = 0;
      player.countGuess = 0;
      player.countLocked = false;
      player.alive = true;
    }
  }

  setupChef() {
    const starts = this.cornerStarts(54);
    this.contestants.forEach((player, index) => {
      player.x = starts[index].x;
      player.y = starts[index].y;
      player.targetX = player.x;
      player.targetY = player.y;
    });
    for (let i = 0; i < 9; i += 1) {
      this.spawnIngredient();
    }
  }

  setupPaint() {
    this.contestants.forEach((player, index) => {
      player.paintShapeIndex = index;
    });
    this.restorePaintBrushes();
  }

  restorePaintBrushes() {
    this.layoutPaintBoards();
    this.contestants.forEach((player, index) => {
      const board = this.paintBoards[index];
      player.x = board.x + board.w * 0.5;
      player.y = board.y + board.h + 30;
      player.brushX = board.nodes[0].x;
      player.brushY = board.nodes[0].y;
      player.targetX = player.brushX;
      player.targetY = player.brushY;
    });
  }

  setupClaw() {
    this.contestants.forEach((player, index) => {
      const start = this.homeBase(player);
      player.x = start.x;
      player.y = start.y;
      player.targetX = player.x;
      player.targetY = player.y;
    });
    for (let i = 0; i < 8; i += 1) {
      this.spawnPearl();
    }
  }

  setupSoccer() {
    this.soccerKeeperId = between(0, this.contestants.length - 1);
    this.soccerShooterOrder = shuffle(this.contestants.filter((player) => player.id !== this.soccerKeeperId).map((player) => player.id));
    this.soccerShooterIndex = 0;
    this.soccerCurrentShooterId = this.soccerShooterOrder[0] ?? this.contestants[0].id;
    this.soccerPhase = "aim";
    this.soccerTurnMs = 0;
    this.soccerAimX = this.soccerGoalRect().x + this.soccerGoalRect().w * 0.5;
    this.soccerBalls = [
      {
        id: this.nextItemId++,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        cooldownMs: 0,
      },
    ];

    this.contestants.forEach((player) => {
      player.aiThinkMs = 0;
      player.targetX = player.x;
      player.targetY = player.y;
    });

    this.beginSoccerTurn(false);
  }

  beginSoccerTurn(advance = true) {
    if (advance) {
      this.soccerShooterIndex += 1;
    }
    if (this.soccerShooterIndex >= this.soccerShooterOrder.length) {
      this.soccerShooterOrder = shuffle(this.contestants.filter((player) => player.id !== this.soccerKeeperId).map((player) => player.id));
      this.soccerShooterIndex = 0;
    }

    const goal = this.soccerGoalRect();
    const zone = this.soccerKeeperZone();
    const spot = this.soccerShotSpot();
    const keeperLineY = this.soccerKeeperLineY();
    this.soccerCurrentShooterId = this.soccerShooterOrder[this.soccerShooterIndex] ?? this.contestants[0].id;
    this.soccerPhase = "aim";
    this.soccerTurnMs = 4_400;
    this.soccerAimX = clamp(goal.x + goal.w * floatBetween(0.18, 0.82), goal.x + 20, goal.x + goal.w - 20);

    const benchSpots = [
      { x: this.arena.left + 54, y: this.arena.bottom - 48 },
      { x: this.arena.right - 54, y: this.arena.bottom - 48 },
      { x: this.arena.left + 54, y: this.arena.bottom - 104 },
      { x: this.arena.right - 54, y: this.arena.bottom - 104 },
    ];

    this.contestants.forEach((player, index) => {
      player.vx = 0;
      player.vy = 0;
      if (player.id === this.soccerKeeperId) {
        player.x = clamp(player.x || goal.x + goal.w * 0.5, zone.x + 18, zone.x + zone.w - 18);
        player.y = keeperLineY;
      } else if (player.id === this.soccerCurrentShooterId) {
        player.x = spot.x;
        player.y = spot.y + 34;
      } else {
        const bench = benchSpots[index] ?? benchSpots[0];
        player.x = bench.x;
        player.y = bench.y;
      }
      player.targetX = player.x;
      player.targetY = player.y;
      player.aiThinkMs = player.isHuman ? 0 : player.reactionMs + between(560, 1_050);
    });

    const ball = this.soccerBalls[0] ?? {
      id: this.nextItemId++,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      cooldownMs: 0,
    };
    ball.x = spot.x;
    ball.y = spot.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.lastTouchId = undefined;
    ball.cooldownMs = 0;
    this.soccerBalls = [ball];
  }

  setupDog() {
    this.dogState = "sleep";
    this.dogStateMs = between(2_100, 3_800);
    this.dogGraceMs = 0;
    this.dogChase = undefined;
    const dog = this.dogPoint();
    const offsets = [
      { x: -76, y: 56 },
      { x: 76, y: -18 },
      { x: -76, y: -18 },
      { x: 76, y: 56 },
    ];

    this.contestants.forEach((player, index) => {
      const start = this.dogHomeBase(player);
      player.x = start.x;
      player.y = start.y;
      player.targetX = player.x;
      player.targetY = player.y;
      player.aiThinkMs = 0;
    });

    this.dogBones = this.contestants.map((player, index) => {
      const offset = offsets[index] ?? offsets[0];
      return {
        playerId: player.id,
        x: clamp(dog.x + offset.x, this.arena.left + 42, this.arena.right - 42),
        y: clamp(dog.y + offset.y, this.arena.top + 54, this.arena.bottom - 80),
        homeX: clamp(dog.x + offset.x, this.arena.left + 42, this.arena.right - 42),
        homeY: clamp(dog.y + offset.y, this.arena.top + 54, this.arena.bottom - 80),
        delivered: false,
        color: player.color,
      };
    });
  }

  setupCount() {
    this.countCritters = [];
    this.countActual = 0;
    this.countSpawnMs = 1_250;
    this.countWatchMs = 21_000;
    this.countTarget = between(18, 30);
    this.countGuessStarted = false;
    this.countGuessLockGraceMs = 0;
    this.contestants.forEach((player, index) => {
      const start = this.countLookoutSpot(index);
      player.x = start.x;
      player.y = start.y;
      player.targetX = player.x;
      player.targetY = player.y;
      player.countGuess = 0;
      player.countLocked = false;
      player.aiThinkMs = 0;
    });
  }

  countIslandY() {
    return this.arena.top + Math.min(78, Math.max(46, this.arena.height * 0.14));
  }

  countSeaTop() {
    return this.arena.top + Math.min(158, Math.max(108, this.arena.height * 0.3));
  }

  /** @param {number} index */
  countLookoutSpot(index) {
    const lanes = [0.2, 0.39, 0.61, 0.8];
    return {
      x: this.arena.left + this.arena.width * lanes[index],
      y: this.countIslandY() + (index % 2 === 0 ? 8 : -8),
    };
  }

  setupMemory() {
    this.memoryCycle = 0;
    this.memoryPhase = "show";
    this.memoryPhaseMs = 3_800;
    this.layoutMemoryTiles();
    const starts = this.cornerStarts(52);
    this.contestants.forEach((player, index) => {
      player.x = starts[index].x;
      player.y = starts[index].y;
      player.targetX = player.x;
      player.targetY = player.y;
      player.alive = true;
      player.aiThinkMs = 0;
    });
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateActiveMinigame(delta, deltaMs) {
    if (this.currentGame.key === "chef") {
      this.updateChef(delta, deltaMs);
    } else if (this.currentGame.key === "paint") {
      this.updatePaint(delta, deltaMs);
    } else if (this.currentGame.key === "claw") {
      this.updateClaw(delta, deltaMs);
    } else if (this.currentGame.key === "soccer") {
      this.updateSoccer(delta, deltaMs);
    } else if (this.currentGame.key === "dog") {
      this.updateDog(delta, deltaMs);
    } else if (this.currentGame.key === "count") {
      this.updateCount(delta, deltaMs);
    } else {
      this.updateMemory(delta, deltaMs);
    }
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateChef(delta, deltaMs) {
    this.drawChefArena();
    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      if (player.isHuman) {
        this.moveWithInput(player, delta, 166);
        this.tryChefAuto(player);
      } else {
        this.updateChefAi(player, delta, deltaMs);
      }
      if (player.carrying) {
        player.carrying.x = player.x;
        player.carrying.y = player.y - 40;
      }
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateChefAi(player, delta, deltaMs) {
    player.aiThinkMs -= deltaMs;
    const basket = this.homeBase(player);

    if (player.carrying) {
      this.steerTo(player, basket.x, basket.y, 82 + player.difficulty * 104, delta);
      if (distance(player.x, player.y, basket.x, basket.y) < 54) {
        this.deliverIngredient(player);
      }
      return;
    }

    if (player.aiThinkMs <= 0 || distance(player.x, player.y, player.targetX, player.targetY) < 16) {
      const target = this.pickAiIngredientTarget(player);
      if (target) {
        const drift = player.mistakeRate * 72;
        player.targetX = target.x + floatBetween(-drift, drift);
        player.targetY = target.y + floatBetween(-drift, drift);
      } else {
        player.targetX = between(this.arena.left + 40, this.arena.right - 40);
        player.targetY = between(this.arena.top + 60, this.arena.bottom - 40);
      }
      player.aiThinkMs = player.reactionMs + between(120, 420);
    }

    const target = this.nearestIngredient(player.x, player.y, 40);
    this.steerTo(player, player.targetX, player.targetY, 78 + player.difficulty * 104, delta);
    if (target) {
      if (Math.random() > player.mistakeRate * 0.38) {
        this.pickIngredient(player, target);
      }
    }
  }

  /** @param {Contestant} player */
  tryChefAuto(player) {
    const basket = this.homeBase(player);
    if (player.carrying && distance(player.x, player.y, basket.x, basket.y) < 58) {
      this.deliverIngredient(player);
      return;
    }
    const target = this.nearestIngredient(player.x, player.y, 38);
    if (target) {
      this.pickIngredient(player, target);
    }
  }

  /**
   * @param {Contestant} player
   * @param {Ingredient} ingredient
   */
  pickIngredient(player, ingredient) {
    if (ingredient.carriedBy !== undefined || player.carrying) {
      return;
    }
    ingredient.carriedBy = player.id;
    player.carrying = ingredient;
    this.bursts.push({ x: player.x, y: player.y - 30, lifeMs: 230, color: ingredient.color });
  }

  /** @param {Contestant} player */
  deliverIngredient(player) {
    if (!player.carrying) {
      return;
    }
    this.ingredients = this.ingredients.filter((ingredient) => ingredient.id !== player.carrying?.id);
    player.carrying = undefined;
    player.roundScore += 1;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 420, color: 0xffd75e });
    this.spawnIngredient();
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updatePaint(delta, deltaMs) {
    this.layoutPaintBoards();
    this.drawPaintArena();
    const elapsedMs = this.currentGame.durationMs - this.timerMs;

    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      const board = this.paintBoards[player.id];
      if (player.isHuman) {
        this.updateHumanPaint(player, board, delta);
        player.x = board.x + board.w * 0.5;
        player.y = Math.min(this.arena.bottom - 16, board.y + board.h + 30);
      } else {
        this.updatePaintAi(player, board, delta, elapsedMs);
      }

      if (this.isPaintShapeComplete(player, board)) {
        this.completePaintShape(player, board, elapsedMs);
      }
    }
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   * @param {number} delta
   */
  updateHumanPaint(player, board, delta) {
    const oldX = player.brushX;
    const oldY = player.brushY;
    const pointerOnBoard = this.paintPointer.down && this.isInsideRect(this.paintPointer.x, this.paintPointer.y, board);

    if (pointerOnBoard) {
      player.brushX = clamp(this.paintPointer.x, board.x + 10, board.x + board.w - 10);
      player.brushY = clamp(this.paintPointer.y, board.y + 10, board.y + board.h - 10);
    } else {
      const speed = Math.min(board.w, board.h) * 0.82;
      player.brushX = clamp(player.brushX + this.controls.x * speed * delta, board.x + 10, board.x + board.w - 10);
      player.brushY = clamp(player.brushY + this.controls.y * speed * delta, board.y + 10, board.y + board.h - 10);
    }

    const moved = distance(oldX, oldY, player.brushX, player.brushY) > 0.7;
    if (!moved) {
      return;
    }

    const nearLine = this.nearestPaintNodeDistance(player, board);
    if (nearLine <= PAINT_LINE_GRACE) {
      player.paintPenalty = Math.max(0, player.paintPenalty - delta * 10);
      this.coverPaintNodes(player, board, PAINT_TRACE_RADIUS);
    } else if (nearLine > PAINT_OFFLINE_GRACE) {
      this.penalizePaint(player, delta * (nearLine > 30 ? 110 : 72));
      if (Math.random() < 0.42) {
        this.bursts.push({ x: player.brushX, y: player.brushY, lifeMs: 180, color: 0xff3b26 });
      }
    }
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   * @param {number} delta
   * @param {number} elapsedMs
   */
  updatePaintAi(player, board, delta, elapsedMs) {
    const nextIndex = this.nextUncoveredNode(player, board);
    if (nextIndex === undefined) {
      this.completePaintShape(player, board, elapsedMs);
      return;
    }
    const node = board.nodes[nextIndex];
    const wobble = player.mistakeRate * 38;
    const targetX = node.x + Math.sin(this.time.now * 0.004 + player.id) * wobble;
    const targetY = node.y + Math.cos(this.time.now * 0.003 + player.id) * wobble;
    this.steerBrush(player, targetX, targetY, Math.min(board.w, board.h) * (0.24 + player.difficulty * 0.34), delta, board);
    player.x = board.x + board.w * 0.5;
    player.y = Math.min(this.arena.bottom - 16, board.y + board.h + 30);
    const nearLine = this.nearestPaintNodeDistance(player, board);
    if (nearLine > 19) {
      this.penalizePaint(player, delta * (10 + player.mistakeRate * 24));
    }
    player.paintAccumulator += delta * (0.9 + player.difficulty * 2.05);
    if (distance(player.brushX, player.brushY, node.x, node.y) < 10 && player.paintAccumulator > 0.92 && Math.random() > player.mistakeRate * 0.5) {
      player.coveredNodes.add(nextIndex);
      player.paintAccumulator = Math.max(0, player.paintAccumulator - 1);
    }
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   * @param {number} radius
   */
  coverPaintNodes(player, board, radius) {
    board.nodes.forEach((node, index) => {
      if (!player.coveredNodes.has(index) && distance(player.brushX, player.brushY, node.x, node.y) <= radius) {
        player.coveredNodes.add(index);
      }
    });
  }

  /**
   * @param {Contestant} player
   * @param {number} amount
   */
  penalizePaint(player, amount) {
    player.paintPenalty = Math.min(120, player.paintPenalty + amount);
    const eraseCount = Math.floor(player.paintPenalty / 7);
    if (eraseCount > 0) {
      this.erasePaintProgress(player, eraseCount);
      player.paintPenalty = Math.max(0, player.paintPenalty - eraseCount * 7);
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} count
   */
  erasePaintProgress(player, count) {
    const painted = [...player.coveredNodes].sort((a, b) => b - a);
    for (let i = 0; i < Math.min(count, painted.length); i += 1) {
      player.coveredNodes.delete(painted[i]);
    }
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   * @param {number} elapsedMs
   */
  completePaintShape(player, board, elapsedMs) {
    player.roundScore += 1;
    player.finishMs = elapsedMs;
    player.paintShapeIndex += 1;
    player.coveredNodes = new Set();
    player.paintPenalty = 0;
    player.paintAccumulator = 0;
    const nextNodes = this.shapeNodes(board.x, board.y, board.w, board.h, player.paintShapeIndex);
    player.brushX = nextNodes[0]?.x ?? board.x + board.w * 0.5;
    player.brushY = nextNodes[0]?.y ?? board.y + board.h * 0.5;
    player.targetX = player.brushX;
    player.targetY = player.brushY;
    this.bursts.push({ x: player.brushX, y: player.brushY, lifeMs: 500, color: player.color });
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateClaw(delta, deltaMs) {
    this.drawClawArena();
    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      if (player.isHuman) {
        this.moveWithInput(player, delta, 174);
        if (this.controls.consumeActionPress()) {
          this.trySnap(player);
        }
        this.tryPearlAuto(player);
      } else {
        this.updateClawAi(player, delta, deltaMs);
      }
      this.clampToBounds(player, this.clawBounds(), 24, 24);
      if (player.carryingPearl) {
        player.carryingPearl.x = player.x;
        player.carryingPearl.y = player.y - 40;
      }
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateClawAi(player, delta, deltaMs) {
    player.aiThinkMs -= deltaMs;
    const rival = this.nearestRival(player);
    if (rival && distance(player.x, player.y, rival.x, rival.y) < 62 && player.actionCooldownMs <= 0 && Math.random() < player.difficulty * 0.012) {
      this.trySnap(player);
    }

    const base = this.homeBase(player);
    if (player.carryingPearl) {
      this.steerTo(player, base.x, base.y, 84 + player.difficulty * 112, delta);
      if (distance(player.x, player.y, base.x, base.y) < 58) {
        this.deliverPearl(player);
      }
      return;
    }

    if (player.aiThinkMs <= 0 || distance(player.x, player.y, player.targetX, player.targetY) < 16) {
      const pearl = this.pickAiPearlTarget(player);
      const bounds = this.clawBounds();
      if (pearl) {
        const drift = player.mistakeRate * 86;
        player.targetX = pearl.x + floatBetween(-drift, drift);
        player.targetY = pearl.y + floatBetween(-drift, drift);
      } else {
        player.targetX = between(bounds.left + 40, bounds.right - 40);
        player.targetY = between(bounds.top + 44, bounds.bottom - 40);
      }
      player.targetX = clamp(player.targetX, bounds.left + 24, bounds.right - 24);
      player.targetY = clamp(player.targetY, bounds.top + 24, bounds.bottom - 24);
      player.aiThinkMs = player.reactionMs + between(150, 520);
    }
    this.steerTo(player, player.targetX, player.targetY, 82 + player.difficulty * 112, delta);
    this.tryPearlAuto(player);
  }

  /** @param {Contestant} player */
  trySnap(player) {
    if (player.actionCooldownMs > 0) {
      return;
    }
    player.actionCooldownMs = 560;
    this.bursts.push({ x: player.x, y: player.y - 24, lifeMs: 260, color: player.color });
    for (const rival of this.contestants) {
      if (rival.id === player.id) {
        continue;
      }
      const d = distance(player.x, player.y, rival.x, rival.y);
      if (d < 66) {
        rival.stunnedMs = 520;
        const awayX = (rival.x - player.x) / Math.max(d, 1);
        const awayY = (rival.y - player.y) / Math.max(d, 1);
        const bounds = this.currentGame.key === "claw" ? this.clawBounds() : this.arena;
        rival.x = clamp(rival.x + awayX * 32, bounds.left + 26, bounds.right - 26);
        rival.y = clamp(rival.y + awayY * 32, bounds.top + 36, bounds.bottom - 26);
        if (rival.roundScore > 0) {
          rival.roundScore -= 1;
          player.roundScore += 1;
        }
      }
    }
  }

  /** @param {Contestant} player */
  tryPearlAuto(player) {
    const base = this.homeBase(player);
    if (player.carryingPearl && distance(player.x, player.y, base.x, base.y) < 58) {
      this.deliverPearl(player);
      return;
    }
    if (player.carryingPearl) {
      return;
    }
    const pearl = this.pearls.find((item) => item.carriedBy === undefined && distance(player.x, player.y, item.x, item.y) < 31);
    if (!pearl) {
      return;
    }
    pearl.carriedBy = player.id;
    pearl.opened = true;
    player.carryingPearl = pearl;
    this.bursts.push({ x: pearl.x, y: pearl.y, lifeMs: 300, color: pearl.color });
  }

  /** @param {Contestant} player */
  deliverPearl(player) {
    if (!player.carryingPearl) {
      return;
    }
    this.pearls = this.pearls.filter((item) => item.id !== player.carryingPearl?.id);
    player.carryingPearl = undefined;
    player.roundScore += 1;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 420, color: 0x6ed7ff });
    this.spawnPearl();
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateSoccer(delta, deltaMs) {
    this.drawSoccerArena();
    const actionPressed = this.controls.consumeActionPress();
    const ball = this.soccerBalls[0];
    const shooter = this.contestants.find((player) => player.id === this.soccerCurrentShooterId);
    const keeper = this.contestants.find((player) => player.id === this.soccerKeeperId);
    const spot = this.soccerShotSpot();

    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      if (player.id === this.soccerKeeperId) {
        if (player.isHuman) {
          this.moveSoccerKeeper(player, delta);
          this.trySoccerKeeperDash(player, actionPressed);
        } else {
          this.updateSoccerKeeperAi(player, delta, deltaMs);
        }
      }
    }

    if (!ball || !shooter || !keeper) {
      return;
    }

    this.soccerTurnMs = Math.max(0, this.soccerTurnMs - deltaMs);

    if (this.soccerPhase === "aim") {
      ball.x = spot.x;
      ball.y = spot.y;
      ball.vx = 0;
      ball.vy = 0;

      if (shooter.isHuman) {
        const goal = this.soccerGoalRect();
        this.soccerAimX = clamp(this.soccerAimX + this.controls.x * this.arena.width * 0.68 * delta, goal.x + 18, goal.x + goal.w - 18);
        if (actionPressed || this.soccerTurnMs <= 0) {
          this.shootSoccerBall(shooter);
        }
      } else {
        this.updateSoccerShooterAi(shooter, deltaMs);
      }

      return;
    }

    if (this.soccerPhase === "shot") {
      ball.x += ball.vx * delta;
      ball.y += ball.vy * delta;
      this.resolveSoccerShot(ball, keeper);
      return;
    }

    if (this.soccerTurnMs <= 0) {
      this.beginSoccerTurn(true);
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} deltaMs
   */
  updateSoccerShooterAi(player, deltaMs) {
    player.aiThinkMs -= deltaMs;
    const goal = this.soccerGoalRect();
    const keeper = this.contestants.find((item) => item.id === this.soccerKeeperId);
    if (player.aiThinkMs <= 0) {
      const openSide = keeper && keeper.x < goal.x + goal.w * 0.5 ? 0.78 : 0.22;
      const drift = goal.w * (player.mistakeRate * 0.52 + floatBetween(-0.08, 0.08));
      this.soccerAimX = clamp(goal.x + goal.w * openSide + drift, goal.x + 18, goal.x + goal.w - 18);
      this.shootSoccerBall(player);
    } else if (Math.random() < 0.08) {
      const wobble = goal.w * player.mistakeRate * 0.34;
      this.soccerAimX = clamp(this.soccerAimX + floatBetween(-wobble, wobble), goal.x + 18, goal.x + goal.w - 18);
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateSoccerKeeperAi(player, delta, deltaMs) {
    player.aiThinkMs -= deltaMs;
    if (player.aiThinkMs <= 0) {
      const ball = this.soccerBalls[0];
      const zone = this.soccerKeeperZone();
      const drift = this.arena.width * (player.mistakeRate * 0.2);
      const targetX = this.soccerPhase === "shot" && ball ? ball.x : this.soccerAimX;
      player.targetX = clamp(targetX + floatBetween(-drift, drift), zone.x + 18, zone.x + zone.w - 18);
      player.aiThinkMs = Math.max(90, player.reactionMs * 0.36 + between(40, 140));
    }
    this.moveKeeperTowardX(player, player.targetX, 104 + player.difficulty * 112, delta);
  }

  /** @param {Contestant} player */
  shootSoccerBall(player) {
    if (this.soccerPhase !== "aim") {
      return;
    }
    const ball = this.soccerBalls[0];
    if (!ball) {
      return;
    }
    const goal = this.soccerGoalRect();
    const miss = player.isHuman ? 0 : floatBetween(-goal.w, goal.w) * player.mistakeRate * 0.14;
    const targetX = clamp(this.soccerAimX + miss, goal.x + 14, goal.x + goal.w - 14);
    const targetY = goal.y + goal.h * 0.45;
    const dx = targetX - ball.x;
    const dy = targetY - ball.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const power = 560;
    ball.vx = (dx / len) * power;
    ball.vy = (dy / len) * power;
    ball.lastTouchId = player.id;
    ball.cooldownMs = 0;
    player.actionCooldownMs = 520;
    this.soccerPhase = "shot";
    this.soccerTurnMs = 2_800;
    this.bursts.push({ x: ball.x, y: ball.y, lifeMs: 260, color: player.color });
  }

  /**
   * @param {SoccerBall} ball
   * @param {Contestant} keeper
   */
  resolveSoccerShot(ball, keeper) {
    const goal = this.soccerGoalRect();
    const keeperLineY = this.soccerKeeperLineY();
    const blockReach = keeper.actionCooldownMs > 310 ? 68 : 44;
    if (ball.vy < 0 && ball.y <= keeperLineY + 18 && ball.y >= keeperLineY - 24 && Math.abs(ball.x - keeper.x) < blockReach) {
      keeper.roundScore += 1;
      this.finishSoccerShot("BLOCK", keeper.color, ball.x, ball.y);
      return;
    }

    if (ball.y <= goal.y + goal.h * 0.68) {
      const scorer = this.contestants.find((player) => player.id === ball.lastTouchId && player.id !== this.soccerKeeperId);
      if (ball.x > goal.x + 14 && ball.x < goal.x + goal.w - 14 && scorer) {
        scorer.roundScore += 2;
        this.finishSoccerShot("GOAL", scorer.color, goal.x + goal.w * 0.5, goal.y + goal.h * 0.65);
      } else {
        this.finishSoccerShot("MISS", 0xfff4d7, ball.x, ball.y);
      }
      return;
    }

    if (ball.x < this.arena.left - 28 || ball.x > this.arena.right + 28 || ball.y < this.arena.top - 40 || this.soccerTurnMs <= 0) {
      this.finishSoccerShot("MISS", 0xfff4d7, ball.x, ball.y);
    }
  }

  /**
   * @param {string} label
   * @param {number} color
   * @param {number} x
   * @param {number} y
   */
  finishSoccerShot(label, color, x, y) {
    const ball = this.soccerBalls[0];
    if (ball) {
      ball.vx = 0;
      ball.vy = 0;
      ball.cooldownMs = 999;
    }
    this.soccerPhase = "reset";
    this.soccerTurnMs = 820;
    this.bursts.push({ x, y, lifeMs: 560, color });
    this.showToast(label, 620);
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   */
  moveSoccerKeeper(player, delta) {
    const zone = this.soccerKeeperZone();
    const speed = 194;
    player.vx = this.controls.x * speed;
    player.vy = 0;
    player.x = clamp(player.x + player.vx * delta, zone.x + 18, zone.x + zone.w - 18);
    player.y = this.soccerKeeperLineY();
  }

  /**
   * @param {Contestant} player
   * @param {boolean} actionPressed
   */
  trySoccerKeeperDash(player, actionPressed) {
    if (!actionPressed || player.actionCooldownMs > 0) {
      return;
    }
    const zone = this.soccerKeeperZone();
    const direction = Math.abs(this.controls.x) > 0.18 ? Math.sign(this.controls.x) : Math.sign(this.soccerAimX - player.x) || 1;
    player.x = clamp(player.x + direction * 82, zone.x + 18, zone.x + zone.w - 18);
    player.vx = direction * 520;
    player.actionCooldownMs = 620;
    this.bursts.push({ x: player.x, y: player.y - 20, lifeMs: 340, color: player.color });
  }

  /**
   * @param {Contestant} player
   * @param {number} targetX
   * @param {number} speed
   * @param {number} delta
   */
  moveKeeperTowardX(player, targetX, speed, delta) {
    const zone = this.soccerKeeperZone();
    const dx = targetX - player.x;
    if (Math.abs(dx) < 2) {
      player.vx = 0;
    } else {
      player.vx = Math.sign(dx) * speed;
      player.x = clamp(player.x + player.vx * delta, zone.x + 18, zone.x + zone.w - 18);
    }
    player.vy = 0;
    player.x = clamp(player.x, zone.x + 18, zone.x + zone.w - 18);
    player.y = this.soccerKeeperLineY();
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateDog(delta, deltaMs) {
    this.advanceDogChase(deltaMs);
    this.drawDogArena();
    if (!this.dogChase) {
      this.tickDogState(deltaMs);
    }

    const caughtThisFrame = [];
    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      const bone = this.dogBones.find((item) => item.playerId === player.id);
      if (!bone || bone.delivered) {
        player.vx = 0;
        player.vy = 0;
        continue;
      }
      if (this.isDogDragging(player.id)) {
        player.vx = 0;
        player.vy = 0;
        continue;
      }

      const oldX = player.x;
      const oldY = player.y;
      if (player.isHuman) {
        this.moveWithInput(player, delta, 158);
      } else {
        this.updateDogAi(player, bone, delta, deltaMs);
      }

      const moved = distance(oldX, oldY, player.x, player.y) > 0.8 || Math.hypot(player.vx, player.vy) > 20;
      if (this.dogState === "look" && this.dogGraceMs <= 0 && moved) {
        caughtThisFrame.push({ player, bone });
        continue;
      }

      this.tryDogBoneAuto(player, bone);
    }

    if (caughtThisFrame.length > 0) {
      this.catchByDog(caughtThisFrame);
    }
  }

  /** @param {number} deltaMs */
  tickDogState(deltaMs) {
    this.dogStateMs -= deltaMs;
    this.dogGraceMs = Math.max(0, this.dogGraceMs - deltaMs);
    if (this.dogStateMs > 0) {
      return;
    }

    if (this.dogState === "sleep") {
      this.dogState = "look";
      this.dogStateMs = between(1_250, 1_900);
      this.dogGraceMs = 460;
      for (const player of this.contestants) {
        if (!player.isHuman) {
          player.aiThinkMs = Math.max(80, player.reactionMs * (0.44 + player.mistakeRate) + between(-90, 150));
        }
      }
    } else {
      this.dogState = "sleep";
      this.dogStateMs = between(1_850, 3_450);
    }
  }

  /**
   * @param {Contestant} player
   * @param {DogBone} bone
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateDogAi(player, bone, delta, deltaMs) {
    if (this.dogState === "look") {
      player.aiThinkMs -= deltaMs;
      if (player.aiThinkMs <= 0) {
        player.vx = 0;
        player.vy = 0;
        return;
      }
    }

    const base = this.dogHomeBase(player);
    const target = bone.carriedBy === player.id ? base : bone;
    const caution = this.dogState === "look" ? 0.62 : 1;
    this.steerTo(player, target.x, target.y, (74 + player.difficulty * 118) * caution, delta);
  }

  /**
   * @param {Contestant} player
   * @param {DogBone} bone
   */
  tryDogBoneAuto(player, bone) {
    if (bone.carriedBy === player.id) {
      bone.x = player.x;
      bone.y = player.y - 48;
      const base = this.dogHomeBase(player);
      if (distance(player.x, player.y, base.x, base.y) < 56) {
        this.deliverDogBone(player, bone);
      }
      return;
    }

    if (bone.carriedBy === undefined && distance(player.x, player.y, bone.x, bone.y) < 36) {
      bone.carriedBy = player.id;
      this.bursts.push({ x: bone.x, y: bone.y, lifeMs: 320, color: player.color });
    }
  }

  /**
   * @param {Contestant} player
   * @param {DogBone} bone
   */
  deliverDogBone(player, bone) {
    bone.delivered = true;
    bone.carriedBy = undefined;
    player.finishMs = this.currentGame.durationMs - this.timerMs;
    player.roundScore = Math.max(1, Math.ceil(this.timerMs / 1_000));
    player.vx = 0;
    player.vy = 0;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 560, color: 0xffd75e });
  }

  /** @param {Array<{ player: Contestant, bone: DogBone }>} caught */
  catchByDog(caught) {
    if (this.dogChase) {
      return;
    }
    if (caught.length === 0) {
      return;
    }
    for (const { player, bone } of caught) {
      if (bone.carriedBy === player.id) {
        bone.carriedBy = undefined;
        bone.x = bone.homeX;
        bone.y = bone.homeY;
      }
      player.vx = 0;
      player.vy = 0;
      player.stunnedMs = 1_900;
      this.bursts.push({ x: player.x, y: player.y - 22, lifeMs: 520, color: 0xff3b26 });
    }
    this.startDogChase(caught);
  }

  /** @param {Array<{ player: Contestant, bone: DogBone }>} caught */
  startDogChase(caught) {
    const dog = this.dogPoint();
    this.dogState = "look";
    this.dogStateMs = 1_600;
    const targetX = caught.reduce((sum, item) => sum + item.player.x, 0) / caught.length;
    const targetY = caught.reduce((sum, item) => sum + item.player.y - 8, 0) / caught.length;
    this.dogChase = {
      caught: caught.map(({ player, bone }) => {
        const base = this.dogHomeBase(player);
        return {
          playerId: player.id,
          bonePlayerId: bone.playerId,
          fromX: player.x,
          fromY: player.y,
          homeX: base.x,
          homeY: base.y,
        };
      }),
      phase: "toPlayer",
      x: dog.x,
      y: dog.y,
      fromX: dog.x,
      fromY: dog.y,
      toX: targetX,
      toY: targetY,
      elapsedMs: 0,
      durationMs: 460,
    };
  }

  /** @param {number} deltaMs */
  advanceDogChase(deltaMs) {
    if (!this.dogChase) {
      return;
    }
    const chase = this.dogChase;
    chase.elapsedMs += deltaMs;
    const t = clamp(chase.elapsedMs / chase.durationMs, 0, 1);
    const eased = t * t * (3 - 2 * t);
    chase.x = lerp(chase.fromX, chase.toX, eased);
    chase.y = lerp(chase.fromY, chase.toY, eased);

    if (chase.phase === "toHome") {
      for (const caught of chase.caught) {
        const player = this.contestants.find((item) => item.id === caught.playerId);
        if (player) {
          player.x = lerp(caught.fromX, caught.homeX, eased);
          player.y = lerp(caught.fromY, caught.homeY, eased);
        }
      }
    }

    if (t < 1) {
      return;
    }

    const dog = this.dogPoint();
    if (chase.phase === "toPlayer") {
      const homeX = chase.caught.reduce((sum, item) => sum + item.homeX, 0) / chase.caught.length;
      const homeY = chase.caught.reduce((sum, item) => sum + item.homeY - 28, 0) / chase.caught.length;
      chase.phase = "toHome";
      chase.fromX = chase.x;
      chase.fromY = chase.y;
      chase.toX = homeX;
      chase.toY = homeY;
      chase.elapsedMs = 0;
      chase.durationMs = 620;
      return;
    }
    if (chase.phase === "toHome") {
      for (const caught of chase.caught) {
        const player = this.contestants.find((item) => item.id === caught.playerId);
        if (player) {
          player.x = caught.homeX;
          player.y = caught.homeY;
        }
      }
      chase.phase = "back";
      chase.fromX = chase.x;
      chase.fromY = chase.y;
      chase.toX = dog.x;
      chase.toY = dog.y;
      chase.elapsedMs = 0;
      chase.durationMs = 520;
      return;
    }

    this.dogChase = undefined;
    this.dogState = "sleep";
    this.dogStateMs = between(1_700, 2_800);
  }

  /** @param {number} playerId */
  isDogDragging(playerId) {
    return this.dogChase?.caught.some((caught) => caught.playerId === playerId) ?? false;
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateCount(delta, deltaMs) {
    this.drawCountArena();
    const elapsedMs = this.currentGame.durationMs - this.timerMs;
    const guessing = elapsedMs >= this.countWatchMs;

    if (!guessing) {
      this.countSpawnMs -= deltaMs;
      if (this.countSpawnMs <= 0 && this.countActual < this.countTarget) {
        const pace = clamp(elapsedMs / this.countWatchMs, 0, 1);
        const room = this.countTarget - this.countActual;
        const group =
          pace > 0.78 && room >= 3 && Math.random() < 0.38
            ? 3
            : pace > 0.55 && room >= 2 && Math.random() < 0.45
              ? 2
              : 1;
        for (let i = 0; i < Math.min(group, room); i += 1) {
          this.spawnCountCritter(i * 42);
        }
        this.countSpawnMs = between(1_250 - pace * 760, 1_680 - pace * 880);
      }
    } else if (!this.countGuessStarted) {
      this.countGuessStarted = true;
      this.countGuessLockGraceMs = 850;
      this.controls.consumeActionPress();
      for (const player of this.contestants) {
        if (player.isHuman) {
          player.countGuess = 0;
          player.countLocked = false;
        } else {
          player.countGuess = Math.max(0, this.countActual + this.cpuCountError(player));
          player.countLocked = true;
        }
      }
      this.showToast(`How many crossed? Up/down changes your guess`, 2_400);
    }

    for (const critter of this.countCritters) {
      critter.x += critter.vx * delta;
      critter.y += Math.sin(this.time.now * 0.006 + critter.wobble) * 0.18;
    }
    this.countCritters = this.countCritters.filter((critter) => critter.x > this.arena.left - 90 && critter.x < this.arena.right + 90);

    const human = this.contestants[0];
    this.countGuessLockGraceMs = Math.max(0, this.countGuessLockGraceMs - deltaMs);
    if (guessing && !human.countLocked) {
      this.tickGuessInput(human, deltaMs);
      if (this.countGuessLockGraceMs <= 0 && this.controls.consumeActionPress()) {
        human.countLocked = true;
        this.showToast(`Locked ${human.countGuess}`, 950);
      }
    }

    for (const player of this.contestants) {
      player.roundScore = guessing ? player.countGuess : 0;
    }
  }

  /**
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateMemory(delta, deltaMs) {
    this.layoutMemoryTiles();
    this.drawMemoryArena();
    this.memoryPhaseMs -= deltaMs;

    for (const player of this.contestants) {
      this.tickCooldowns(player, deltaMs);
      if (!player.alive) {
        continue;
      }
      if (player.isHuman) {
        this.moveWithInput(player, delta, 168);
      } else if (this.memoryPhase === "choose") {
        this.updateMemoryAi(player, delta, deltaMs);
      }
    }

    if (this.memoryPhaseMs > 0) {
      return;
    }

    if (this.memoryPhase === "show") {
      this.memoryPhase = "choose";
      this.memoryPhaseMs = Math.max(2_800, 5_200 - this.memoryCycle * 520);
      this.pickMemoryTarget();
      this.chooseMemoryTargets();
      this.showToast(`Stand on ${this.memoryTarget}`, 1_400);
    } else if (this.memoryPhase === "choose") {
      this.resolveMemoryCycle();
      this.memoryPhase = "resolve";
      this.memoryPhaseMs = 1_150;
    } else {
      this.memoryCycle += 1;
      this.memoryPhase = "show";
      this.memoryPhaseMs = Math.max(1_800, 3_800 - this.memoryCycle * 320);
      this.layoutMemoryTiles(true);
      this.showToast(`Memorize the colors`, 1_100);
    }
  }

  spawnCountCritter(offsetY = 0) {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const sprite = ["invader", "shrimp", "apple", "lobster"][between(0, 3)];
    this.countActual += 1;
    const seaTop = this.countSeaTop();
    const minY = seaTop + 22;
    const maxY = this.arena.bottom - 46;
    const y = between(minY, maxY);
    this.countCritters.push({
      id: this.nextItemId++,
      x: direction > 0 ? this.arena.left - 48 : this.arena.right + 48,
      y: clamp(y + offsetY * (Math.random() > 0.5 ? 1 : -1), minY, maxY),
      vx: direction * between(82, 156),
      sprite,
      wobble: Math.random() * 20,
    });
  }

  /**
   * @param {Contestant} player
   * @param {number} deltaMs
   */
  tickGuessInput(player, deltaMs) {
    player.actionCooldownMs = Math.max(0, player.actionCooldownMs - deltaMs);
    if (player.actionCooldownMs > 0) {
      return;
    }
    if (this.controls.y < -0.45) {
      player.countGuess = Math.min(99, player.countGuess + 1);
      player.actionCooldownMs = 170;
    } else if (this.controls.y > 0.45) {
      player.countGuess = Math.max(0, player.countGuess - 1);
      player.actionCooldownMs = 170;
    }
  }

  /** @param {Contestant} player */
  cpuCountError(player) {
    const spread = player.id === 1 ? 2 : player.id === 2 ? 4 : 7;
    const error = between(-spread, spread);
    if (Math.random() < 1 - player.mistakeRate) {
      return Math.round(error * 0.55);
    }
    return error;
  }

  layoutMemoryTiles(forceNew = false) {
    if (this.memoryTiles.length > 0 && !forceNew) {
      const cols = 4;
      const rows = 4;
      const gap = this.scale.width < 560 ? 4 : 7;
      const tileW = (this.arena.width - gap * (cols + 1)) / cols;
      const tileH = (this.arena.height - gap * (rows + 1)) / rows;
      this.memoryTiles.forEach((tile, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        tile.x = this.arena.left + gap + col * (tileW + gap);
        tile.y = this.arena.top + gap + row * (tileH + gap);
        tile.w = tileW;
        tile.h = tileH;
      });
      return;
    }

    const colors = [
      { name: "red", color: 0xff3b26 },
      { name: "blue", color: 0x6ed7ff },
      { name: "green", color: 0x79f2b1 },
      { name: "yellow", color: 0xffd75e },
    ];
    this.memoryTiles = Array.from({ length: 16 }, (_, index) => {
      const picked = colors[(index + between(0, colors.length - 1)) % colors.length];
      return { x: 0, y: 0, w: 0, h: 0, color: picked.color, name: picked.name, safe: false };
    });
    shuffle(this.memoryTiles);
    this.layoutMemoryTiles(false);
  }

  pickMemoryTarget() {
    const names = ["red", "blue", "green", "yellow"];
    this.memoryTarget = names[(this.roundIndex + this.memoryCycle + between(0, 3)) % names.length];
    for (const tile of this.memoryTiles) {
      tile.safe = tile.name === this.memoryTarget;
    }
  }

  chooseMemoryTargets() {
    for (const player of this.contestants) {
      if (player.isHuman || !player.alive) {
        continue;
      }
      const shouldMiss = Math.random() < player.mistakeRate * 0.55;
      const options = this.memoryTiles.filter((tile) => shouldMiss ? !tile.safe : tile.safe);
      const tile = options[between(0, Math.max(0, options.length - 1))] ?? this.memoryTiles[0];
      player.targetX = tile.x + tile.w * floatBetween(0.32, 0.68);
      player.targetY = tile.y + tile.h * floatBetween(0.32, 0.68);
      player.aiThinkMs = player.reactionMs + between(120, 520);
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   * @param {number} deltaMs
   */
  updateMemoryAi(player, delta, deltaMs) {
    player.aiThinkMs -= deltaMs;
    if (player.aiThinkMs > 0) {
      return;
    }
    this.steerTo(player, player.targetX, player.targetY, 88 + player.difficulty * 128, delta);
  }

  resolveMemoryCycle() {
    for (const player of this.contestants) {
      if (!player.alive) {
        continue;
      }
      const tile = this.tileAt(player.x, player.y);
      if (tile?.safe) {
        player.roundScore += 1;
        this.bursts.push({ x: player.x, y: player.y - 24, lifeMs: 420, color: player.color });
      } else {
        player.alive = false;
        player.stunnedMs = 1_000;
        this.bursts.push({ x: player.x, y: player.y - 24, lifeMs: 540, color: 0xff3b26 });
      }
    }
  }

  endRound() {
    if (this.phase !== "playing") {
      return;
    }
    const beforeRanks = this.overallRanks();
    this.phase = "roundOver";
    if (this.currentGame.key === "count") {
      for (const player of this.contestants) {
        player.roundScore = Math.max(0, 20 - Math.abs(player.countGuess - this.countActual) * 3);
      }
    }
    const winners = this.roundWinners();
    for (const player of this.contestants) {
      player.totalScore += player.roundScore;
    }
    for (const winner of winners) {
      winner.crowns += 1;
    }
    const afterRanks = this.overallRanks();
    this.rankMoves = this.rankMovement(beforeRanks, afterRanks);
    this.showResultPanel(winners);
    this.updateDom(true);
    this.savePartyProgress(true);
    this.time.delayedCall(6_200, () => this.beginNextRound());
  }

  finishParty() {
    this.phase = "final";
    this.clearPartyProgress();
    const winners = this.partyWinners();
    const title = winners.map((winner) => (winner.isHuman ? "YOU" : winner.name)).join(" + ");
    this.showToast(this.singleGameKey ? `${title} wins ${this.currentGame.name}` : `${title} takes Clawparty`, 5000);
    this.resultPanel?.setAttribute("hidden", "true");
    if (this.menuPanel) {
      this.menuPanel.removeAttribute("hidden");
    }
    if (this.menuSubtitle) {
      this.menuSubtitle.textContent = this.singleGameKey ? `${title} wins ${this.currentGame.name}` : `${title} wins with ${winners[0].crowns} crowns`;
    }
    if (this.startButton) {
      this.startButton.textContent = "Play Again";
    }
    this.updateDom(true);
  }

  isRoundComplete() {
    if (this.currentGame.key === "memory" && this.phase === "playing") {
      return this.contestants.every((player) => !player.alive);
    }
    if (this.currentGame.key === "dog" && this.phase === "playing") {
      return this.dogBones.filter((bone) => !bone.delivered).length <= 1;
    }
    return false;
  }

  roundWinners() {
    if (this.currentGame.key === "paint") {
      const topScore = Math.max(...this.contestants.map((player) => player.roundScore));
      return this.contestants.filter((player) => player.roundScore === topScore);
    }
    if (this.currentGame.key === "count") {
      const bestError = Math.min(...this.contestants.map((player) => Math.abs(player.countGuess - this.countActual)));
      return this.contestants.filter((player) => Math.abs(player.countGuess - this.countActual) === bestError);
    }
    const topScore = Math.max(...this.contestants.map((player) => player.roundScore));
    return this.contestants.filter((player) => player.roundScore === topScore);
  }

  roundStandings() {
    return [...this.contestants].sort((a, b) => {
      if (this.currentGame.key === "count") {
        const errorA = Math.abs(a.countGuess - this.countActual);
        const errorB = Math.abs(b.countGuess - this.countActual);
        return errorA - errorB || b.roundScore - a.roundScore;
      }
      if (this.currentGame.key === "paint") {
        const progressA = this.paintBoards[a.id] ? this.paintProgress(a, this.paintBoards[a.id]) : 0;
        const progressB = this.paintBoards[b.id] ? this.paintProgress(b, this.paintBoards[b.id]) : 0;
        return b.roundScore - a.roundScore || progressB - progressA || (a.finishMs ?? Number.POSITIVE_INFINITY) - (b.finishMs ?? Number.POSITIVE_INFINITY);
      }
      if (this.currentGame.key === "dog") {
        return b.roundScore - a.roundScore || (a.finishMs ?? Number.POSITIVE_INFINITY) - (b.finishMs ?? Number.POSITIVE_INFINITY);
      }
      return b.roundScore - a.roundScore || b.totalScore - a.totalScore;
    });
  }

  /** @param {Contestant[]} winners */
  showResultPanel(winners) {
    if (!this.resultPanel || !this.resultTitle || !this.resultSubtitle || !this.resultList) {
      return;
    }
    const winnerNames = winners.map((winner) => (winner.isHuman ? "YOU" : winner.name)).join(" + ");
    this.resultTitle.textContent = `${this.currentGame.name} Results`;
    this.resultSubtitle.textContent = `${winnerNames} earned ${winners.length > 1 ? "crowns" : "a crown"}`;
    const standings = this.roundStandings();
    this.resultList.innerHTML = standings
      .map((player, index) => {
        const won = winners.some((winner) => winner.id === player.id);
        return `<div class="result-row" style="--player-color:${player.uiColor}">
          <div class="result-row__rank">#${index + 1}</div>
          <div class="result-row__name"><span class="result-row__dot"></span><span>${player.isHuman ? "YOU" : player.name}</span></div>
          <div class="result-row__score">${this.resultScoreLabel(player)}</div>
          <div class="result-row__award">${won ? "+1C" : "+0"}</div>
        </div>`;
      })
      .join("");
    this.resultPanel.removeAttribute("hidden");
  }

  /** @param {Contestant} player */
  resultScoreLabel(player) {
    if (this.currentGame.key === "count") {
      return `guess ${player.countGuess} / ${this.countActual}`;
    }
    if (this.currentGame.key === "paint") {
      return `${player.roundScore}`;
    }
    if (this.currentGame.key === "memory") {
      return player.alive ? `${player.roundScore} safe` : `${player.roundScore} safe`;
    }
    if (this.currentGame.key === "soccer") {
      return player.id === this.soccerKeeperId ? `${player.roundScore} blocks` : `${player.roundScore} goal pts`;
    }
    if (this.currentGame.key === "dog") {
      const bone = this.dogBones.find((item) => item.playerId === player.id);
      return bone?.delivered ? `${player.roundScore}s left` : "not home";
    }
    return `${player.roundScore} pts`;
  }

  overallRanks() {
    const sorted = this.overallStandings();
    return new Map(sorted.map((player, index) => [player.id, index + 1]));
  }

  overallStandings() {
    return [...this.contestants].sort((a, b) => b.crowns - a.crowns || b.totalScore - a.totalScore || a.id - b.id);
  }

  /**
   * @param {Map<number, number>} before
   * @param {Map<number, number>} after
   */
  rankMovement(before, after) {
    const moves = new Map();
    for (const player of this.contestants) {
      moves.set(player.id, (before.get(player.id) ?? 0) - (after.get(player.id) ?? 0));
    }
    return moves;
  }

  partyWinners() {
    const bestCrowns = Math.max(...this.contestants.map((player) => player.crowns));
    const crownLeaders = this.contestants.filter((player) => player.crowns === bestCrowns);
    const bestTotal = Math.max(...crownLeaders.map((player) => player.totalScore));
    return crownLeaders.filter((player) => player.totalScore === bestTotal);
  }

  drawCurrentArena() {
    if (this.currentGame.key === "chef") {
      this.drawChefArena();
    } else if (this.currentGame.key === "paint") {
      this.drawPaintArena();
    } else if (this.currentGame.key === "claw") {
      this.drawClawArena();
    } else if (this.currentGame.key === "soccer") {
      this.drawSoccerArena();
    } else if (this.currentGame.key === "dog") {
      this.drawDogArena();
    } else if (this.currentGame.key === "count") {
      this.drawCountArena();
    } else {
      this.drawMemoryArena();
    }
  }

  drawCountdownOverlay() {
    const count = Math.max(1, Math.ceil(this.countdownMs / 1_000));
    const panelW = Math.min(this.arena.width - 28, 430);
    const panelH = Math.min(this.arena.height - 42, 284);
    const x = this.arena.cx - panelW * 0.5;
    const y = this.arena.cy - panelH * 0.5;
    this.effectsGfx.fillStyle(0x000000, 0.72);
    this.effectsGfx.fillRect(this.arena.left + 8, this.arena.top + 8, this.arena.width - 16, this.arena.height - 16);
    this.effectsGfx.fillStyle(0x07070a, 0.96);
    this.effectsGfx.fillRect(x, y, panelW, panelH);
    this.effectsGfx.lineStyle(5, 0xfff4d7, 1);
    this.effectsGfx.strokeRect(x, y, panelW, panelH);
    this.effectsGfx.fillStyle(0xffd75e, 1);
    for (let i = 0; i < count; i += 1) {
      this.effectsGfx.fillRect(this.arena.cx - count * 13 + i * 26, y + panelH - 36, 14, 14);
    }
    this.overlayText.setText(this.currentGame.name).setPosition(this.arena.cx, y + 42).setVisible(true);
    this.countdownText.setText(`${count}`).setPosition(this.arena.cx, this.arena.cy - 8).setVisible(true);
    this.overlayHint
      .setText(`COMMAND: ${this.currentGame.objective.toUpperCase()}`)
      .setPosition(this.arena.cx, y + panelH - 72)
      .setVisible(true);
  }

  controlHint() {
    if (this.currentGame.key === "chef") {
      return "Grab food automatically. Bring it home.";
    }
    if (this.currentGame.key === "paint") {
      return "Finish shapes to score. Off-line erases paint.";
    }
    if (this.currentGame.key === "claw") {
      return "Carry one pearl home. ! bumps rivals.";
    }
    if (this.currentGame.key === "soccer") {
      return this.contestants[0]?.id === this.soccerKeeperId ? "You are keeper. Slide left/right to block." : "When it is your turn, aim left/right and shoot.";
    }
    if (this.currentGame.key === "dog") {
      return "Move only while dog sleeps. Bring your bone home.";
    }
    if (this.currentGame.key === "count") {
      return "Count every critter that crosses.";
    }
    return "Memorize colors. Stand on the called color.";
  }

  /**
   * @param {number} time
   * @param {number} delta
   */
  drawLobbyScene(time, delta) {
    this.drawBackground(0x07070a);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x1c1b24, 0x2e2a31);
    this.worldGfx.fillStyle(0x111720, 1);
    this.worldGfx.fillRect(this.arena.left + 16, this.arena.cy - 34, this.arena.width - 32, 68);
    this.worldGfx.fillStyle(0x79f2b1, 0.9);
    this.worldGfx.fillRect(this.arena.cx - 20, this.arena.cy - 20, 40, 40);
    this.worldGfx.fillStyle(0x050505, 1);
    this.worldGfx.fillRect(this.arena.cx - 11, this.arena.cy - 11, 22, 22);

    const radius = Math.min(this.arena.width, this.arena.height) * 0.23;
    this.contestants.forEach((player, index) => {
      const angle = time * 0.00045 + index * Math.PI * 0.5;
      player.x = this.arena.cx + Math.cos(angle) * radius;
      player.y = this.arena.cy + Math.sin(angle) * radius * 0.48 + 60;
      player.roundScore = player.crowns;
    });
  }

  drawChefArena() {
    this.drawBackground(0x08090d);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x162023, 0x394247);
    this.drawHomeBases("basket");
    for (const ingredient of this.ingredients) {
      if (ingredient.carriedBy !== undefined) {
        continue;
      }
      this.drawIngredient(this.propGfx, ingredient.x, ingredient.y, ingredient.color);
    }
  }

  drawPaintArena() {
    this.drawBackground(0x08080b);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x14101b, 0x3f354f);

    for (const player of this.contestants) {
      const board = this.paintBoards[player.id];
      this.paintGfx.fillStyle(0xfff4d7, 1);
      this.paintGfx.fillRect(board.x, board.y, board.w, board.h);
      this.paintGfx.fillStyle(0x101016, 1);
      this.paintGfx.fillRect(board.x + 5, board.y + 5, board.w - 10, board.h - 10);
      this.paintGfx.fillStyle(0x272632, 1);
      for (let gx = board.x + 16; gx < board.x + board.w - 12; gx += 24) {
        this.paintGfx.fillRect(gx, board.y + 10, 2, board.h - 20);
      }
      for (let gy = board.y + 16; gy < board.y + board.h - 12; gy += 24) {
        this.paintGfx.fillRect(board.x + 10, gy, board.w - 20, 2);
      }

      board.nodes.forEach((node, index) => {
        const covered = player.coveredNodes.has(index);
        this.paintGfx.fillStyle(covered ? player.color : 0x6a6670, covered ? 1 : 0.86);
        this.paintGfx.fillRect(Math.round(node.x - 4), Math.round(node.y - 4), 8, 8);
      });
      this.paintGfx.fillStyle(player.color, 1);
      this.paintGfx.fillRect(Math.round(player.brushX - 6), Math.round(player.brushY - 6), 12, 12);
      this.paintGfx.fillStyle(0xfff4d7, 0.9);
      this.paintGfx.fillRect(Math.round(player.brushX - 2), Math.round(player.brushY - 2), 4, 4);
      this.paintGfx.fillStyle(player.color, 1);
      this.paintGfx.fillRect(board.x + 8, board.y + 8, Math.max(6, (board.w - 16) * (this.paintProgress(player, board) / 100)), 5);
      this.paintGfx.fillStyle(0xfff4d7, 1);
      this.paintGfx.fillRect(board.x + 8, board.y + 17, 10 + player.roundScore * 8, 4);
      if (player.paintPenalty > 0) {
        this.paintGfx.fillStyle(0xff3b26, 0.85);
        this.paintGfx.fillRect(board.x + 8, board.y + board.h - 13, Math.min(board.w - 16, player.paintPenalty * 7), 6);
      }
    }
  }

  drawClawArena() {
    const bounds = this.clawBounds();
    this.drawBackground(0x03151d);
    this.addSprite(0.2, "claw-seabed", bounds.left, bounds.top, bounds.width, bounds.height, { originX: 0, originY: 0 });
    this.propGfx.fillStyle(0x05253a, 0.24);
    this.propGfx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    this.propGfx.lineStyle(5, 0x1a5470, 1);
    this.propGfx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
    this.propGfx.lineStyle(2, 0x8ff0ff, 0.56);
    this.propGfx.strokeRect(bounds.left + 5, bounds.top + 5, bounds.width - 10, bounds.height - 10);
    this.drawHomeBases("tidepool");
    this.propGfx.fillStyle(0x6ed7ff, 0.16);
    this.propGfx.fillRect(bounds.cx - Math.min(172, bounds.width * 0.36), bounds.cy - 10, Math.min(344, bounds.width * 0.72), 20);
    this.propGfx.fillStyle(0xfff4d7, 0.13);
    this.propGfx.fillRect(bounds.cx - 36, bounds.cy - 36, 72, 72);
    this.propGfx.lineStyle(2, 0x8ff0ff, 0.28);
    this.propGfx.strokeCircle(bounds.cx, bounds.cy, Math.min(126, bounds.width * 0.32));
    for (const pearl of this.pearls) {
      if (pearl.carriedBy !== undefined) {
        continue;
      }
      this.addSprite(2.8, pearl.opened ? "clam-empty" : "clam-pearl", pearl.x, pearl.y, 62, 42);
      this.propGfx.fillStyle(0x000000, 0.28);
      this.propGfx.fillRect(pearl.x - 23, pearl.y + 19, 46, 6);
      this.propGfx.lineStyle(2, pearl.color, 0.8);
      this.propGfx.strokeCircle(pearl.x, pearl.y + 1, 23 + Math.sin(this.time.now * 0.006 + pearl.id) * 3);
      this.propGfx.fillStyle(pearl.color, 1);
      this.propGfx.fillRect(pearl.x - 8, pearl.y - 8, 16, 16);
      this.propGfx.fillStyle(0xffffff, 0.9);
      this.propGfx.fillRect(pearl.x - 3, pearl.y - 5, 4, 4);
    }

    for (const player of this.contestants) {
      if (!player.carryingPearl) {
        continue;
      }
      const base = this.homeBase(player);
      this.propGfx.lineStyle(3, player.color, 0.42);
      this.propGfx.lineBetween(player.x, player.y - 18, base.x, base.y);
    }
  }

  drawSoccerArena() {
    this.drawBackground(0x060d09);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x12381f, 0x6ed7ff);
    const goal = this.soccerGoalRect();
    const zone = this.soccerKeeperZone();

    this.propGfx.lineStyle(3, 0xfff4d7, 0.72);
    this.propGfx.strokeRect(this.arena.left + 18, this.arena.top + 18, this.arena.width - 36, this.arena.height - 36);
    this.propGfx.strokeCircle(this.arena.cx, this.arena.cy + 42, Math.min(52, this.arena.width * 0.16));
    this.propGfx.lineStyle(2, 0xfff4d7, 0.48);
    this.propGfx.strokeRect(zone.x, zone.y, zone.w, zone.h);
    this.propGfx.lineStyle(4, 0xffd75e, 0.58);
    this.propGfx.lineBetween(zone.x + 20, this.soccerKeeperLineY(), zone.x + zone.w - 20, this.soccerKeeperLineY());
    this.propGfx.fillStyle(0xfff4d7, 0.18);
    this.propGfx.fillRect(goal.x + 8, goal.y + goal.h - 8, goal.w - 16, 5);
    const spot = this.soccerShotSpot();
    this.propGfx.fillStyle(0xfff4d7, 0.52);
    this.propGfx.fillRect(spot.x - 5, spot.y - 5, 10, 10);

    this.addSprite(2.4, "soccer-goal", goal.x + goal.w * 0.5, goal.y + 26, Math.min(goal.w + 58, this.arena.width * 0.72), 78);

    for (const ball of this.soccerBalls) {
      this.addSprite(3.2, "soccer-ball", ball.x, ball.y, 36, 36, { alpha: this.soccerPhase === "reset" ? 0.58 : 1 });
    }
    this.drawSoccerGuide();

    const keeper = this.contestants.find((player) => player.id === this.soccerKeeperId);
    const shooter = this.contestants.find((player) => player.id === this.soccerCurrentShooterId);
    const hint =
      shooter?.isHuman
        ? "YOU SHOOT: AIM L/R + !"
        : keeper?.isHuman
          ? "YOU ARE GK: SLIDE L/R"
          : `${shooter?.name ?? "CPU"} SHOOTS`;
    this.overlayHint
      .setText(`${hint} G+2 B+1`)
      .setPosition(this.arena.cx, this.arena.top + 32)
      .setVisible(true);
  }

  drawSoccerGuide() {
    const ball = this.soccerBalls[0];
    if (!ball) {
      return;
    }
    const goal = this.soccerGoalRect();
    const shooter = this.contestants.find((player) => player.id === this.soccerCurrentShooterId);
    const keeper = this.contestants.find((player) => player.id === this.soccerKeeperId);
    if (keeper) {
      this.propGfx.lineStyle(3, 0xffd75e, 0.74);
      this.propGfx.strokeCircle(keeper.x, keeper.y, keeper.actionCooldownMs > 310 ? 68 : 42);
      this.propGfx.fillStyle(0xffd75e, 0.9);
      this.propGfx.fillRect(keeper.x - 20, keeper.y - 31, 40, 6);
    }

    if (shooter) {
      this.propGfx.lineStyle(4, shooter.isHuman ? 0xffd75e : 0x6ed7ff, 0.78);
      this.propGfx.strokeCircle(shooter.x, shooter.y - 18, 34);
    }

    const targetY = goal.y + goal.h * 0.45;
    this.propGfx.lineStyle(3, this.soccerPhase === "aim" ? 0xffd75e : 0x6ed7ff, 0.82);
    this.propGfx.lineBetween(ball.x, ball.y, this.soccerAimX, targetY);
    this.propGfx.fillStyle(0xffd75e, 0.95);
    this.propGfx.fillRect(this.soccerAimX - 18, targetY - 4, 36, 8);
    this.propGfx.fillRect(this.soccerAimX - 4, targetY - 18, 8, 36);

    if (this.soccerPhase === "aim") {
      const progress = clamp(this.soccerTurnMs / 4_400, 0, 1);
      this.propGfx.fillStyle(0x000000, 0.45);
      this.propGfx.fillRect(this.arena.cx - 74, this.arena.bottom - 92, 148, 8);
      this.propGfx.fillStyle(progress < 0.28 ? 0xff3b26 : 0xffd75e, 1);
      this.propGfx.fillRect(this.arena.cx - 74, this.arena.bottom - 92, 148 * progress, 8);
    }
  }

  drawDogArena() {
    this.drawBackground(0x08070a);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x172018, 0x4d3a2d);
    this.drawHomeBases("bone");
    const dog = this.dogPoint();
    const chase = this.dogChase;
    const dogW = chase ? Math.min(214, this.arena.width * 0.48) : Math.min(196, this.arena.width * 0.45);
    const dogH = dogW * 0.7;

    this.propGfx.fillStyle(0x2c241f, 0.7);
    this.propGfx.fillRect(this.arena.left + 22, dog.y + dogH * 0.36, this.arena.width - 44, 18);

    const dogTexture = chase ? "dog-run" : this.dogState === "look" ? "dog-alert" : "dog-sleep";
    const dogX = chase ? chase.x : dog.x;
    const dogY = chase ? chase.y : dog.y + (this.dogState === "look" ? -4 : 0);
    this.addSprite(2.5, dogTexture, dogX, dogY, dogW, dogH);

    if (this.dogState === "look" && !chase) {
      this.propGfx.fillStyle(0x050505, 1);
      this.propGfx.fillRect(dog.x - dogW * 0.16, dog.y - dogH * 0.08, 9, 13);
      this.propGfx.fillRect(dog.x + dogW * 0.08, dog.y - dogH * 0.08, 9, 13);
      this.propGfx.fillStyle(0xff3b26, 1);
      this.propGfx.fillRect(dog.x + dogW * 0.35, dog.y - dogH * 0.58, 12, 36);
      this.propGfx.fillRect(dog.x + dogW * 0.35, dog.y - dogH * 0.15, 12, 12);
    }

    for (const bone of this.dogBones) {
      const carrier = bone.carriedBy === undefined ? undefined : this.contestants.find((player) => player.id === bone.carriedBy);
      const base = this.dogHomeBase(this.contestants[bone.playerId]);
      const x = bone.delivered ? base.x : carrier ? carrier.x : bone.x;
      const y = bone.delivered ? base.y - 28 : carrier ? carrier.y - 52 : bone.y;
      this.addSprite(3.1, "bone", x, y, 42, 24, { tint: bone.color, alpha: bone.delivered ? 0.42 : 1 });
    }
  }

  drawCountArena() {
    this.drawBackground(0x03151d);
    this.addSprite(0.2, "count-beach-sea", this.arena.left, this.arena.top, this.arena.width, this.arena.height, { originX: 0, originY: 0 });

    const elapsedMs = this.currentGame.durationMs - this.timerMs;
    const guessing = elapsedMs >= this.countWatchMs;
    const seaTop = this.countSeaTop();
    this.propGfx.fillStyle(0x082d3a, 0.16);
    this.propGfx.fillRect(this.arena.left + 8, seaTop, this.arena.width - 16, this.arena.bottom - seaTop - 8);
    this.propGfx.lineStyle(3, 0xfff4d7, 0.62);
    this.propGfx.beginPath();
    for (let x = this.arena.left + 22; x < this.arena.right - 18; x += 18) {
      const y = seaTop + Math.sin((x + this.time.now * 0.018) * 0.04) * 4;
      if (x === this.arena.left + 22) {
        this.propGfx.moveTo(x, y);
      } else {
        this.propGfx.lineTo(x, y);
      }
    }
    this.propGfx.strokePath();

    for (const player of this.contestants) {
      this.propGfx.fillStyle(0x000000, 0.2);
      this.propGfx.fillRect(player.x - 24, player.y + 13, 48, 9);
    }

    const progressY = this.arena.bottom - 20;
    this.propGfx.fillStyle(0x001923, 0.44);
    this.propGfx.fillRect(this.arena.left + 24, progressY, this.arena.width - 48, 6);
    this.propGfx.fillStyle(guessing ? 0xffd75e : 0x6ed7ff, 1);
    this.propGfx.fillRect(this.arena.left + 24, progressY, Math.max(0, (this.arena.width - 48) * (elapsedMs / this.currentGame.durationMs)), 6);

    this.propGfx.lineStyle(5, 0x0a3142, 1);
    this.propGfx.strokeRect(this.arena.left, this.arena.top, this.arena.width, this.arena.height);
    this.propGfx.lineStyle(2, 0x8ff0ff, 0.58);
    this.propGfx.strokeRect(this.arena.left + 5, this.arena.top + 5, this.arena.width - 10, this.arena.height - 10);

    for (const critter of this.countCritters) {
      const bob = Math.sin(this.time.now * 0.01 + critter.wobble) * 4;
      this.drawCountCritter(critter.x, critter.y + bob, critter.sprite);
    }

    if (guessing) {
      this.propGfx.fillStyle(0x000000, 0.74);
      this.propGfx.fillRect(this.arena.cx - 112, this.arena.cy - 52, 224, 104);
      this.propGfx.lineStyle(3, 0xfff4d7, 1);
      this.propGfx.strokeRect(this.arena.cx - 112, this.arena.cy - 52, 224, 104);
      this.overlayText.setText(`${this.contestants[0].countGuess}`).setPosition(this.arena.cx, this.arena.cy - 8).setVisible(true);
      this.overlayHint
        .setText(this.contestants[0].countLocked ? "LOCKED" : "UP/DOWN + !")
        .setPosition(this.arena.cx, this.arena.cy + 38)
        .setVisible(true);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} sprite
   */
  drawCountCritter(x, y, sprite) {
    const color = sprite === "apple" ? 0xe62b5e : sprite === "shrimp" ? 0xff8b4c : sprite === "lobster" ? 0xff3b26 : 0x5cc8ff;
    this.propGfx.fillStyle(0x000000, 0.32);
    this.propGfx.fillRect(x - 18, y + 17, 36, 7);
    this.propGfx.fillStyle(color, 1);
    if (sprite === "shrimp") {
      this.propGfx.fillRect(x - 14, y - 11, 24, 18);
      this.propGfx.fillRect(x + 8, y - 2, 12, 10);
      this.propGfx.fillRect(x - 18, y + 5, 10, 9);
    } else if (sprite === "apple") {
      this.propGfx.fillRect(x - 13, y - 12, 27, 27);
      this.propGfx.fillStyle(0x79f2b1, 1);
      this.propGfx.fillRect(x + 5, y - 22, 14, 8);
    } else if (sprite === "lobster") {
      this.propGfx.fillRect(x - 10, y - 12, 20, 28);
      this.propGfx.fillRect(x - 25, y - 19, 12, 13);
      this.propGfx.fillRect(x + 13, y - 19, 12, 13);
    } else {
      this.propGfx.fillRect(x - 18, y - 11, 36, 22);
      this.propGfx.fillRect(x - 27, y - 4, 9, 11);
      this.propGfx.fillRect(x + 18, y - 4, 9, 11);
    }
    this.propGfx.fillStyle(0x050505, 1);
    this.propGfx.fillRect(x - 7, y - 4, 4, 12);
    this.propGfx.fillRect(x + 6, y - 4, 4, 12);
  }

  drawMemoryArena() {
    this.drawBackground(0x08080b);
    this.drawPixelFrame(this.arena.left, this.arena.top, this.arena.width, this.arena.height, 0x17131f, 0x4b3658);
    const showColors = this.memoryPhase === "show" || this.memoryPhase === "resolve";
    for (const tile of this.memoryTiles) {
      const tileColor = showColors ? tile.color : 0x232332;
      const alpha = this.memoryPhase === "resolve" && !tile.safe ? 0.2 : 1;
      this.propGfx.fillStyle(tileColor, alpha);
      this.propGfx.fillRect(tile.x, tile.y, tile.w, tile.h);
      this.propGfx.fillStyle(0x000000, 0.18);
      this.propGfx.fillRect(tile.x + 5, tile.y + 5, tile.w - 10, tile.h - 10);
      if (this.memoryPhase === "choose") {
        this.propGfx.fillStyle(0xfff4d7, 0.1);
        this.propGfx.fillRect(tile.x + tile.w * 0.5 - 3, tile.y + tile.h * 0.5 - 3, 6, 6);
      }
    }

    this.propGfx.fillStyle(0x000000, 0.72);
    this.propGfx.fillRect(this.arena.cx - 116, this.arena.top + 12, 232, 40);
    this.propGfx.lineStyle(2, 0xfff4d7, 1);
    this.propGfx.strokeRect(this.arena.cx - 116, this.arena.top + 12, 232, 40);
    if (this.memoryPhase !== "show") {
      const targetColor = this.memoryTiles.find((tile) => tile.name === this.memoryTarget)?.color ?? 0xfff4d7;
      this.propGfx.fillStyle(targetColor, 1);
      this.propGfx.fillRect(this.arena.cx - 98, this.arena.top + 23, 18, 18);
    }
    this.overlayHint
      .setText(this.memoryPhase === "show" ? "MEMORIZE COLORS" : `FIND ${this.memoryTarget.toUpperCase()}`)
      .setPosition(this.memoryPhase === "show" ? this.arena.cx : this.arena.cx + 16, this.arena.top + 32)
      .setVisible(true);
  }

  /** @param {number} color */
  drawBackground(color) {
    this.worldGfx.fillStyle(color, 1);
    this.worldGfx.fillRect(0, 0, this.scale.width, this.scale.height);
    this.worldGfx.fillStyle(0xffffff, 0.08);
    const offset = (this.roundIndex * 17) % 32;
    for (let x = 10 + offset; x < this.scale.width; x += 64) {
      for (let y = 24; y < this.scale.height; y += 58) {
        if ((x + y) % 3 === 0) {
          this.worldGfx.fillRect(x, y, 3, 3);
        }
      }
    }
  }

  /**
   * Queues an image for this frame. Depth orders images among themselves and
   * against the shape layers (world 0, paint 1, props 2, contestants 4).
   * @param {number} depth
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {Partial<SpriteDraw>} [options]
   */
  addSprite(depth, name, x, y, w, h, options = {}) {
    const image = this.images.get(name);
    if (image) {
      this.sprites.push({ depth, image, x, y, w, h, ...options });
    }
  }

  /**
   * Draws the frame: the shape layers, images and contestants in depth order,
   * then effects and text on top.
   */
  render() {
    const { ctx, dpr } = this.view;
    this.view.begin(BACKGROUND);
    const sprites = [...this.sprites].sort((a, b) => a.depth - b.depth);
    const drawSprites = (/** @type {number} */ below) => {
      while (sprites.length > 0 && sprites[0].depth < below) {
        drawSprite(ctx, /** @type {SpriteDraw} */ (sprites.shift()), dpr);
      }
    };

    this.worldGfx.draw(ctx, dpr);
    drawSprites(1);
    this.paintGfx.draw(ctx, dpr);
    drawSprites(2);
    this.propGfx.draw(ctx, dpr);
    drawSprites(4);

    for (const player of this.drawOrder) {
      const view = this.views.get(player.id);
      if (!view) {
        continue;
      }
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.beginPath();
      ctx.ellipse(view.x, view.y + 12, 21, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      const image = this.images.get(`${player.sprite}-walk`);
      if (image) {
        const sprite = view.sprite;
        drawSprite(ctx, { ...sprite, image, x: view.x + sprite.x, y: view.y + sprite.y }, dpr);
      }
      view.accessory.draw(ctx, dpr, view.x, view.y);
      view.carryIcon.draw(ctx, dpr, view.x, view.y);
      view.label.draw(ctx, view.x, view.y);
      view.score.draw(ctx, view.x, view.y);
    }

    drawSprites(Infinity);
    this.effectsGfx.draw(ctx, dpr);
    this.overlayText.draw(ctx);
    this.overlayHint.draw(ctx);
    this.countdownText.draw(ctx);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} fill
   * @param {number} border
   */
  drawPixelFrame(x, y, w, h, fill, border) {
    this.worldGfx.fillStyle(border, 1);
    this.worldGfx.fillRect(x, y, w, h);
    this.worldGfx.fillStyle(fill, 1);
    this.worldGfx.fillRect(x + 5, y + 5, w - 10, h - 10);
    this.worldGfx.fillStyle(0x000000, 0.22);
    for (let gx = x + 24; gx < x + w - 20; gx += 42) {
      this.worldGfx.fillRect(gx, y + 8, 2, h - 16);
    }
    for (let gy = y + 22; gy < y + h - 20; gy += 42) {
      this.worldGfx.fillRect(x + 8, gy, w - 16, 2);
    }
  }

  drawBursts() {
    for (const burst of this.bursts) {
      const t = clamp(burst.lifeMs / 500, 0, 1);
      const size = 12 + (1 - t) * 44;
      this.effectsGfx.fillStyle(burst.color, 0.85 * t);
      this.effectsGfx.fillRect(burst.x - size / 2, burst.y - 3, size, 6);
      this.effectsGfx.fillRect(burst.x - 3, burst.y - size / 2, 6, size);
    }
  }

  /** @param {number} deltaMs */
  updateBursts(deltaMs) {
    for (const burst of this.bursts) {
      burst.lifeMs -= deltaMs;
    }
    this.bursts = this.bursts.filter((burst) => burst.lifeMs > 0);
    this.drawBursts();
  }

  updateContestantViews() {
    const sorted = [...this.contestants].sort((a, b) => a.y - b.y);
    this.drawOrder = sorted;
    sorted.forEach((player) => {
      const view = this.views.get(player.id);
      if (!view) {
        return;
      }
      view.x = Math.round(player.x);
      view.y = Math.round(player.y);
      const scoreY =
        this.currentGame.key === "chef" || this.currentGame.key === "paint"
          ? -88
          : this.currentGame.key === "soccer" && player.id === this.soccerKeeperId
            ? 42
            : -72;
      view.score.setPosition(0, scoreY);
      view.score.setText(this.scoreLabel(player));
      view.sprite.alpha = !player.alive ? 0.32 : player.stunnedMs > 0 ? 0.58 : 1;
      const moving = this.phase === "playing" && Math.hypot(player.vx, player.vy) > 18;
      const walkFrame = moving ? Math.floor(this.time.now / 95 + player.id) % 4 : 0;
      view.sprite.frame = walkFrame;
      const step = moving ? Math.sin(this.time.now * 0.016 + player.id * 1.7) : 0;
      const bounce = Math.abs(step);
      view.sprite.x = step * 1.7;
      view.sprite.y = -19 + bounce * 3;
      view.sprite.w = 58 + bounce * 5;
      view.sprite.h = 58 - bounce * 3;
      view.sprite.angle = moving ? step * 3 : 0;
      if (Math.abs(player.vx) > 22) {
        view.sprite.flipX = player.vx < 0;
      }
      this.drawAccessory(player, view);
      this.drawCarry(player, view);
    });
  }

  /** @param {Contestant} player */
  scoreLabel(player) {
    if (this.phase === "lobby") {
      return `C${player.crowns}`;
    }
    if (this.currentGame.key === "paint") {
      return `${player.roundScore} shapes`;
    }
    if (this.currentGame.key === "count") {
      return this.countGuessStarted ? `${player.countGuess}` : "?";
    }
    if (this.currentGame.key === "memory" && !player.alive) {
      return "OUT";
    }
    if (this.currentGame.key === "soccer" && player.id === this.soccerKeeperId) {
      return `GK ${player.roundScore}`;
    }
    if (this.currentGame.key === "soccer" && player.id === this.soccerCurrentShooterId && this.phase === "playing") {
      return this.soccerPhase === "aim" ? "SHOT" : `${player.roundScore}`;
    }
    if (this.currentGame.key === "dog") {
      const bone = this.dogBones.find((item) => item.playerId === player.id);
      return bone?.delivered ? "HOME" : `${player.roundScore}`;
    }
    return `${player.roundScore}`;
  }

  /** @param {Contestant} player */
  scorebarValue(player) {
    if (this.currentGame.key === "paint" && (this.phase === "playing" || this.phase === "countdown")) {
      const board = this.paintBoards[player.id];
      const progress = board ? this.paintProgress(player, board) : 0;
      return `${player.roundScore}+${progress}%`;
    }
    if (this.currentGame.key === "count" && this.phase === "playing") {
      return this.countGuessStarted ? `G${player.countGuess}` : "?";
    }
    if (this.currentGame.key === "memory" && (this.phase === "playing" || this.phase === "countdown")) {
      return player.alive ? `${player.roundScore}` : "OUT";
    }
    if (this.currentGame.key === "soccer" && (this.phase === "playing" || this.phase === "countdown")) {
      if (player.id === this.soccerCurrentShooterId && this.phase === "playing" && this.soccerPhase === "aim") {
        return "SHOT";
      }
      return player.id === this.soccerKeeperId ? `GK ${player.roundScore}` : `${player.roundScore}`;
    }
    if (this.currentGame.key === "dog" && (this.phase === "playing" || this.phase === "countdown")) {
      const bone = this.dogBones.find((item) => item.playerId === player.id);
      return bone?.delivered ? "HOME" : `${player.roundScore}`;
    }
    return `${player.roundScore}`;
  }

  /**
   * @param {Contestant} player
   * @param {ContestantView} view
   */
  drawAccessory(player, view) {
    const g = view.accessory;
    g.clear();
    if (this.phase !== "playing") {
      return;
    }

    if (this.currentGame.key === "chef") {
      g.fillStyle(0xffffff, 1);
      g.fillRect(-17, -59, 34, 12);
      g.fillRect(-11, -69, 9, 13);
      g.fillRect(-1, -73, 12, 17);
      g.fillRect(11, -66, 9, 10);
      g.fillStyle(0xcfd6de, 1);
      g.fillRect(-17, -47, 34, 5);
    } else if (this.currentGame.key === "paint") {
      g.fillStyle(0x213d7a, 1);
      g.fillRect(-18, -57, 34, 8);
      g.fillRect(-8, -65, 28, 10);
      g.fillStyle(0xffd75e, 1);
      g.fillRect(20, -38, 5, 34);
      g.fillStyle(player.color, 1);
      g.fillRect(17, -44, 11, 10);
    } else if (this.currentGame.key === "claw") {
      g.fillStyle(0xffd75e, player.actionCooldownMs > 430 ? 1 : 0.78);
      g.fillRect(-23, -37, 8, 8);
      g.fillRect(15, -37, 8, 8);
      g.fillRect(-20, -43, 5, 5);
      g.fillRect(18, -43, 5, 5);
    } else if (this.currentGame.key === "soccer") {
      if (player.id === this.soccerKeeperId) {
        g.fillStyle(0xffd75e, 1);
        g.fillRect(-20, -58, 40, 8);
        g.fillRect(-25, -38, 10, 12);
        g.fillRect(15, -38, 10, 12);
      } else {
        g.fillStyle(0xffffff, 1);
        g.fillRect(-16, -58, 32, 8);
        g.fillStyle(player.color, 1);
        g.fillRect(-13, -50, 26, 7);
      }
    } else if (this.currentGame.key === "dog") {
      g.fillStyle(0xfff4d7, 1);
      g.fillRect(-18, -58, 36, 8);
      g.fillStyle(0x4d3a2d, 1);
      g.fillRect(18, -40, 18, 7);
    } else if (this.currentGame.key === "count") {
      g.fillStyle(0x6ed7ff, 1);
      g.fillRect(-18, -58, 36, 8);
      g.fillRect(-10, -66, 20, 8);
      g.fillStyle(0xfff4d7, 1);
      g.fillRect(18, -40, 7, 26);
    } else if (this.currentGame.key === "memory") {
      g.fillStyle(player.alive ? 0xffd75e : 0x6a6670, 1);
      g.fillRect(-17, -59, 34, 7);
      g.fillRect(-22, -52, 8, 8);
      g.fillRect(14, -52, 8, 8);
    }
  }

  /**
   * @param {Contestant} player
   * @param {ContestantView} view
   */
  drawCarry(player, view) {
    const g = view.carryIcon;
    g.clear();
    if (player.carrying) {
      this.drawIngredient(g, 0, -66, player.carrying.color);
    } else if (player.carryingPearl) {
      this.drawPearl(g, 0, -66, player.carryingPearl.color);
    } else if (this.currentGame.key === "dog" && this.dogBones.some((bone) => bone.carriedBy === player.id)) {
      this.drawBoneIcon(g, 0, -66, player.color);
    }
  }

  /**
   * @param {Gfx} g
   * @param {number} x
   * @param {number} y
   * @param {number} color
   */
  drawIngredient(g, x, y, color) {
    g.fillStyle(0x000000, 0.32);
    g.fillRect(x - 8, y + 8, 18, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 9, y - 8, 18, 18);
    g.fillStyle(0xfff4d7, 0.8);
    g.fillRect(x - 3, y - 5, 5, 5);
  }

  /**
   * @param {Gfx} g
   * @param {number} x
   * @param {number} y
   * @param {number} color
   */
  drawPearl(g, x, y, color) {
    g.fillStyle(0x000000, 0.3);
    g.fillRect(x - 8, y + 8, 18, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 8, y - 8, 16, 16);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(x - 3, y - 5, 4, 4);
  }

  /**
   * @param {Gfx} g
   * @param {number} x
   * @param {number} y
   * @param {number} color
   */
  drawBoneIcon(g, x, y, color) {
    g.fillStyle(0x000000, 0.3);
    g.fillRect(x - 13, y + 7, 26, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 13, y - 3, 26, 8);
    g.fillRect(x - 17, y - 7, 9, 9);
    g.fillRect(x + 8, y - 7, 9, 9);
    g.fillStyle(0xfff4d7, 0.72);
    g.fillRect(x - 9, y - 1, 18, 4);
  }

  /** @param {boolean} force */
  updateDom(force, deltaMs = 0) {
    this.domTickMs -= deltaMs;
    if (!force && this.domTickMs > 0) {
      this.updateToast();
      return;
    }
    this.domTickMs = 120;

    if (this.roundChip) {
      const roundLimit = this.singleGameKey ? 1 : TOTAL_ROUNDS;
      this.roundChip.textContent = this.phase === "lobby" ? "Lobby" : this.phase === "final" ? "Final" : `Round ${this.roundIndex}/${roundLimit}`;
    }
    if (this.modeChip) {
      this.modeChip.textContent = this.phase === "playing" || this.phase === "roundOver" || this.phase === "countdown" ? this.currentGame.name : "Party";
    }
    if (this.timerChip) {
      this.timerChip.textContent =
        this.phase === "countdown"
          ? `${Math.ceil(this.countdownMs / 1000)}`
          : this.phase === "playing"
            ? `${Math.ceil(this.timerMs / 1000).toString().padStart(2, "0")}`
            : "--";
    }
    if (this.scorebar) {
      this.scorebar.innerHTML = this.overallStandings()
        .map((player, index) => {
          const move = this.rankMoves.get(player.id) ?? 0;
          const moveText = move > 0 ? `+${move}` : move < 0 ? `-${Math.abs(move)}` : "=";
          const moveClass = move < 0 ? " scorebar__move is-down" : " scorebar__move";
          return `<div class="scorebar__player" style="--player-color:${player.uiColor}">
            <span class="scorebar__dot"></span>
            <span class="scorebar__rank">#${index + 1}<span class="${moveClass}">${moveText}</span></span>
            <span class="scorebar__name">${player.isHuman ? "YOU" : player.name}</span>
            <span>C${player.crowns} ${this.scorebarValue(player)}</span>
          </div>`;
        })
        .join("");
    }
    if (this.roster) {
      this.roster.innerHTML = this.contestants
        .map(
          (player) => `<div class="roster__slot" style="--player-color:${player.uiColor}">
            <div class="roster__name"><span class="roster__badge"></span><span>${player.isHuman ? "YOU" : player.name}</span></div>
            <div class="roster__meta">${player.skillLabel ?? "Player"}</div>
          </div>`,
        )
        .join("");
    }
    this.updateToast();
  }

  /**
   * @param {string} message
   * @param {number} durationMs
   */
  showToast(message, durationMs) {
    if (!this.toast) {
      return;
    }
    this.toast.textContent = message;
    this.toast.classList.add("is-visible");
    this.toastUntil = this.time.now + durationMs;
  }

  updateToast() {
    if (this.toast && this.toastUntil > 0 && this.time.now > this.toastUntil) {
      this.toast.classList.remove("is-visible");
      this.toastUntil = 0;
    }
  }

  /**
   * @param {Contestant} player
   * @param {number} deltaMs
   */
  tickCooldowns(player, deltaMs) {
    player.actionCooldownMs = Math.max(0, player.actionCooldownMs - deltaMs);
    player.stunnedMs = Math.max(0, player.stunnedMs - deltaMs);
  }

  /**
   * @param {Contestant} player
   * @param {number} delta
   * @param {number} speed
   */
  moveWithInput(player, delta, speed) {
    this.moveVector(player, this.controls.x, this.controls.y, speed, delta);
  }

  /**
   * @param {Contestant} player
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} speed
   * @param {number} delta
   */
  steerTo(player, targetX, targetY, speed, delta) {
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) {
      return;
    }
    this.moveVector(player, dx / len, dy / len, speed, delta);
  }

  /**
   * @param {Contestant} player
   * @param {number} x
   * @param {number} y
   * @param {number} speed
   * @param {number} delta
   */
  moveVector(player, x, y, speed, delta) {
    if (player.stunnedMs > 0) {
      return;
    }
    const len = Math.hypot(x, y);
    if (len < 0.08) {
      player.vx = 0;
      player.vy = 0;
      return;
    }
    const nx = x / Math.max(1, len);
    const ny = y / Math.max(1, len);
    player.vx = nx * speed;
    player.vy = ny * speed;
    player.x = clamp(player.x + player.vx * delta, this.arena.left + 24, this.arena.right - 24);
    player.y = clamp(player.y + player.vy * delta, this.arena.top + 34, this.arena.bottom - 24);
  }

  /**
   * @param {Contestant} player
   * @param {ArenaBounds} bounds
   * @param {number} padX
   * @param {number} padY
   */
  clampToBounds(player, bounds, padX, padY) {
    player.x = clamp(player.x, bounds.left + padX, bounds.right - padX);
    player.y = clamp(player.y, bounds.top + padY, bounds.bottom - padY);
  }

  /**
   * @param {Contestant} player
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} speed
   * @param {number} delta
   * @param {PaintBoard} board
   */
  steerBrush(player, targetX, targetY, speed, delta, board) {
    const dx = targetX - player.brushX;
    const dy = targetY - player.brushY;
    const len = Math.max(1, Math.hypot(dx, dy));
    player.brushX = clamp(player.brushX + (dx / len) * speed * delta, board.x + 10, board.x + board.w - 10);
    player.brushY = clamp(player.brushY + (dy / len) * speed * delta, board.y + 10, board.y + board.h - 10);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  nearestIngredient(x, y, maxDistance = Number.POSITIVE_INFINITY) {
    let best;
    let bestDistance = maxDistance;
    for (const ingredient of this.ingredients) {
      if (ingredient.carriedBy !== undefined) {
        continue;
      }
      const d = distance(x, y, ingredient.x, ingredient.y);
      if (d < bestDistance) {
        best = ingredient;
        bestDistance = d;
      }
    }
    return best;
  }

  /** @param {Contestant} player */
  pickAiIngredientTarget(player) {
    const open = this.ingredients.filter((ingredient) => ingredient.carriedBy === undefined);
    if (open.length === 0) {
      return undefined;
    }
    if (Math.random() < player.mistakeRate * 0.45) {
      return open[between(0, open.length - 1)];
    }
    return this.nearestIngredient(player.x, player.y);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  nearestPearl(x, y) {
    let best;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pearl of this.pearls) {
      if (pearl.carriedBy !== undefined) {
        continue;
      }
      const d = distance(x, y, pearl.x, pearl.y);
      if (d < bestDistance) {
        best = pearl;
        bestDistance = d;
      }
    }
    return best;
  }

  /** @param {Contestant} player */
  pickAiPearlTarget(player) {
    const open = this.pearls.filter((pearl) => pearl.carriedBy === undefined);
    if (open.length === 0) {
      return undefined;
    }
    if (Math.random() < player.mistakeRate * 0.48) {
      return open[between(0, open.length - 1)];
    }
    return this.nearestPearl(player.x, player.y);
  }

  /** @param {Contestant} player */
  nearestRival(player) {
    let best;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const rival of this.contestants) {
      if (rival.id === player.id) {
        continue;
      }
      const d = distance(player.x, player.y, rival.x, rival.y);
      if (d < bestDistance) {
        best = rival;
        bestDistance = d;
      }
    }
    return best;
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   */
  nextUncoveredNode(player, board) {
    for (let i = 0; i < board.nodes.length; i += 1) {
      if (!player.coveredNodes.has(i)) {
        return i;
      }
    }
    return undefined;
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   */
  paintProgress(player, board) {
    if (board.nodes.length === 0) {
      return 0;
    }
    return Math.floor((player.coveredNodes.size / board.nodes.length) * 100);
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   */
  isPaintShapeComplete(player, board) {
    if (board.nodes.length === 0) {
      return false;
    }
    const missing = board.nodes.length - player.coveredNodes.size;
    const maxMissing = Math.max(1, Math.floor(board.nodes.length * 0.012));
    const maxGap = Math.max(1, Math.floor(board.nodes.length * 0.018));
    return missing <= maxMissing && this.longestUncoveredPaintGap(player, board) <= maxGap;
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   */
  longestUncoveredPaintGap(player, board) {
    const uncovered = [];
    for (let i = 0; i < board.nodes.length; i += 1) {
      if (!player.coveredNodes.has(i)) {
        uncovered.push(i);
      }
    }
    if (uncovered.length === 0) {
      return 0;
    }

    let longest = 1;
    let run = 1;
    for (let i = 1; i < uncovered.length; i += 1) {
      if (uncovered[i] === uncovered[i - 1] + 1) {
        run += 1;
      } else {
        longest = Math.max(longest, run);
        run = 1;
      }
    }
    longest = Math.max(longest, run);

    if (uncovered[0] === 0 && uncovered[uncovered.length - 1] === board.nodes.length - 1) {
      let prefix = 0;
      while (uncovered[prefix] === prefix) {
        prefix += 1;
      }
      let suffix = 0;
      while (uncovered[uncovered.length - 1 - suffix] === board.nodes.length - 1 - suffix) {
        suffix += 1;
      }
      longest = Math.max(longest, prefix + suffix);
    }
    return longest;
  }

  /**
   * @param {Contestant} player
   * @param {PaintBoard} board
   */
  nearestPaintNodeDistance(player, board) {
    let best = Number.POSITIVE_INFINITY;
    for (const node of board.nodes) {
      best = Math.min(best, distance(player.brushX, player.brushY, node.x, node.y));
    }
    return best;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ x: number, y: number, w: number, h: number }} rect
   */
  isInsideRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  tileAt(x, y) {
    return this.memoryTiles.find((tile) => this.isInsideRect(x, y, tile));
  }

  soccerGoalRect() {
    const w = Math.min(240, Math.max(148, this.arena.width * 0.52));
    return {
      x: this.arena.cx - w * 0.5,
      y: this.arena.top + 14,
      w,
      h: 52,
    };
  }

  soccerKeeperZone() {
    const goal = this.soccerGoalRect();
    return {
      x: clamp(goal.x - 38, this.arena.left + 20, this.arena.right - goal.w - 20),
      y: goal.y + 26,
      w: Math.min(this.arena.width - 40, goal.w + 76),
      h: Math.min(124, this.arena.height * 0.34),
    };
  }

  soccerKeeperLineY() {
    const zone = this.soccerKeeperZone();
    return zone.y + zone.h * 0.62;
  }

  soccerShotSpot() {
    return {
      x: this.arena.cx,
      y: this.arena.bottom - Math.min(126, Math.max(92, this.arena.height * 0.24)),
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  nearestSoccerBall(x, y) {
    let best;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const ball of this.soccerBalls) {
      const d = distance(x, y, ball.x, ball.y);
      if (d < bestDistance) {
        best = ball;
        bestDistance = d;
      }
    }
    return best;
  }

  mostThreateningSoccerBall() {
    return [...this.soccerBalls].sort((a, b) => a.y - b.y || Math.abs(b.vy) - Math.abs(a.vy))[0] ?? this.soccerBalls[0];
  }

  dogPoint() {
    return {
      x: this.arena.cx,
      y: this.arena.top + Math.min(118, this.arena.height * 0.33),
    };
  }

  /** @param {Contestant} player */
  homeBase(player) {
    if (this.currentGame.key === "claw") {
      return this.clawHomeBase(player);
    }
    const padX = Math.min(82, Math.max(44, this.arena.width * 0.11));
    const padY = Math.min(68, Math.max(40, this.arena.height * 0.14));
    const bases = [
      { x: this.arena.left + padX, y: this.arena.bottom - padY },
      { x: this.arena.right - padX, y: this.arena.top + padY },
      { x: this.arena.left + padX, y: this.arena.top + padY },
      { x: this.arena.right - padX, y: this.arena.bottom - padY },
    ];
    return bases[player.id] ?? bases[0];
  }

  /** @param {Contestant} player */
  clawHomeBase(player) {
    const bounds = this.clawBounds();
    const spreadX = Math.min(128, Math.max(74, bounds.width * 0.28));
    const spreadY = Math.min(108, Math.max(64, bounds.height * 0.26));
    const bases = [
      { x: bounds.cx - spreadX, y: bounds.cy + spreadY },
      { x: bounds.cx + spreadX, y: bounds.cy - spreadY },
      { x: bounds.cx - spreadX, y: bounds.cy - spreadY },
      { x: bounds.cx + spreadX, y: bounds.cy + spreadY },
    ];
    const base = bases[player.id] ?? bases[0];
    return {
      x: clamp(base.x, bounds.left + 50, bounds.right - 50),
      y: clamp(base.y, bounds.top + 62, bounds.bottom - 54),
    };
  }

  clawSpawnRect() {
    const bounds = this.clawBounds();
    const marginX = Math.min(78, Math.max(38, bounds.width * 0.15));
    const marginY = Math.min(76, Math.max(44, bounds.height * 0.17));
    return {
      x: bounds.left + marginX,
      y: bounds.top + marginY,
      w: bounds.width - marginX * 2,
      h: bounds.height - marginY * 2,
    };
  }

  /** @param {Contestant} player */
  dogHomeBase(player) {
    const padX = Math.min(82, Math.max(44, this.arena.width * 0.11));
    const padY = Math.min(62, Math.max(40, this.arena.height * 0.12));
    const upperY = Math.max(this.arena.top + 180, this.arena.bottom - padY - 92);
    const bases = [
      { x: this.arena.left + padX, y: this.arena.bottom - padY },
      { x: this.arena.right - padX, y: this.arena.bottom - padY },
      { x: this.arena.left + padX, y: upperY },
      { x: this.arena.right - padX, y: upperY },
    ];
    return bases[player.id] ?? bases[0];
  }

  /** @returns {ArenaBounds} */
  clawBounds() {
    const maxWidth = this.arena.width * 0.94;
    const maxHeight = this.arena.height * 0.82;
    const widthFromHeight = maxHeight * PEARL_PANIC_ASPECT;
    const width = Math.min(maxWidth, widthFromHeight);
    const height = width / PEARL_PANIC_ASPECT;
    const left = this.arena.cx - width * 0.5;
    const top = this.arena.top + Math.max(96, (this.arena.height - height) * 0.46);
    const right = left + width;
    const bottom = top + height;
    return {
      left,
      right,
      top,
      bottom,
      width,
      height,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
    };
  }

  /** @param {"basket" | "tidepool" | "bone"} kind */
  drawHomeBases(kind) {
    for (const player of this.contestants) {
      const base = kind === "bone" ? this.dogHomeBase(player) : this.homeBase(player);
      this.propGfx.fillStyle(0x000000, 0.35);
      this.propGfx.fillRect(base.x - 32, base.y + 21, 64, 10);
      this.propGfx.fillStyle(player.color, 1);
      if (kind === "basket") {
        this.propGfx.fillRect(base.x - 28, base.y - 16, 56, 36);
        this.propGfx.fillStyle(0x101016, 1);
        this.propGfx.fillRect(base.x - 20, base.y - 8, 40, 18);
      } else if (kind === "bone") {
        this.propGfx.fillRect(base.x - 32, base.y - 15, 64, 32);
        this.propGfx.fillStyle(0x101016, 1);
        this.propGfx.fillRect(base.x - 22, base.y - 6, 44, 14);
        this.propGfx.fillStyle(0xfff4d7, 0.84);
        this.propGfx.fillRect(base.x - 17, base.y - 1, 34, 5);
      } else {
        this.propGfx.fillRect(base.x - 32, base.y - 14, 64, 32);
        this.propGfx.fillStyle(0x0d1930, 1);
        this.propGfx.fillRect(base.x - 22, base.y - 5, 44, 14);
        this.propGfx.fillStyle(0x6ed7ff, 0.7);
        this.propGfx.fillRect(base.x - 16, base.y - 1, 32, 6);
      }
    }
  }

  spawnIngredient() {
    const colors = [0xffd75e, 0x79f2b1, 0xff735c, 0x6ed7ff, 0xf5ead0];
    this.ingredients.push({
      id: this.nextItemId++,
      x: between(this.arena.left + 44, this.arena.right - 44),
      y: between(this.arena.top + 92, this.arena.bottom - 92),
      color: colors[between(0, colors.length - 1)],
      label: "bite",
    });
  }

  spawnPearl() {
    const colors = [0xfff4d7, 0x6ed7ff, 0xffd75e, 0x79f2b1];
    const rect = this.clawSpawnRect();
    let x = this.arena.cx;
    let y = this.arena.cy;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      x = between(rect.x, rect.x + rect.w);
      y = between(rect.y, rect.y + rect.h);
      if (this.pearls.every((pearl) => distance(pearl.x, pearl.y, x, y) > 58)) {
        break;
      }
    }
    this.pearls.push({
      id: this.nextItemId++,
      x,
      y,
      color: colors[between(0, colors.length - 1)],
      opened: false,
    });
  }

  chefPlate() {
    return { x: this.arena.cx, y: this.arena.top + 48 };
  }

  layoutPaintBoards() {
    const gap = this.scale.width < 560 ? 8 : 14;
    const boardW = (this.arena.width - gap * 3) / 2;
    const boardH = Math.max(86, (this.arena.height - gap * 3 - 64) / 2);
    const top = this.arena.top + 14;
    this.paintBoards = this.contestants.map((player, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = this.arena.left + gap + col * (boardW + gap);
      const y = top + row * (boardH + 42);
      const w = boardW;
      const h = Math.min(boardH, this.arena.bottom - y - 42);
      return { x, y, w, h, shapeIndex: player.paintShapeIndex, nodes: this.shapeNodes(x, y, w, h, player.paintShapeIndex) };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  shapeNodes(x, y, w, h, shapeIndex = 0) {
    const margin = Math.min(26, w * 0.15, h * 0.18);
    const variant = shapeIndex % 5;
    const points =
      variant === 0
        ? [
            [0.15, 0.18],
            [0.85, 0.18],
            [0.85, 0.78],
            [0.15, 0.78],
            [0.15, 0.18],
          ]
        : variant === 1
          ? [
              [0.5, 0.12],
              [0.88, 0.8],
              [0.12, 0.8],
              [0.5, 0.12],
            ]
          : variant === 2
            ? [
              [0.12, 0.26],
              [0.34, 0.64],
              [0.5, 0.28],
              [0.66, 0.64],
              [0.88, 0.26],
            ]
            : variant === 3
              ? [
                  [0.5, 0.13],
                  [0.63, 0.38],
                  [0.9, 0.42],
                  [0.68, 0.6],
                  [0.76, 0.86],
                  [0.5, 0.72],
                  [0.24, 0.86],
                  [0.32, 0.6],
                  [0.1, 0.42],
                  [0.37, 0.38],
                  [0.5, 0.13],
                ]
              : [
                  [0.5, 0.14],
                  [0.84, 0.32],
                  [0.7, 0.78],
                  [0.3, 0.78],
                  [0.16, 0.32],
                  [0.5, 0.14],
            ];
    const toNode = (/** @type {number[]} */ [px, py]) => point(x + margin + px * (w - margin * 2), y + margin + py * (h - margin * 2));
    const nodes = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = toNode(points[i]);
      const b = toNode(points[i + 1]);
      const samples = Math.max(10, Math.floor(distance(a.x, a.y, b.x, b.y) / PAINT_NODE_SPACING));
      for (let s = 0; s <= samples; s += 1) {
        const t = s / samples;
        nodes.push(point(lerp(a.x, b.x, t), lerp(a.y, b.y, t)));
      }
    }
    return nodes;
  }

  /** @param {number} pad */
  cornerStarts(pad) {
    return [
      { x: this.arena.left + pad, y: this.arena.bottom - pad },
      { x: this.arena.right - pad, y: this.arena.top + pad },
      { x: this.arena.left + pad, y: this.arena.top + pad },
      { x: this.arena.right - pad, y: this.arena.bottom - pad },
    ];
  }

  layoutLobby() {
    const starts = this.cornerStarts(64);
    this.contestants.forEach((player, index) => {
      player.x = starts[index].x;
      player.y = starts[index].y;
    });
  }

  clampContestants() {
    for (const player of this.contestants) {
      player.x = clamp(player.x, this.arena.left + 24, this.arena.right - 24);
      player.y = clamp(player.y, this.arena.top + 34, this.arena.bottom - 24);
    }
  }

  /** @returns {ArenaBounds} */
  makeArena() {
    const width = this.scale.width;
    const height = this.scale.height;
    const isShort = height < 650;
    const top = isShort ? 118 : 132;
    const bottomPad = width < 560 ? 176 : height < 560 ? 158 : 154;
    const bottom = Math.max(top + 230, height - bottomPad);
    const left = width < 560 ? 10 : 20;
    const right = width - left;
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
    };
  }
}
