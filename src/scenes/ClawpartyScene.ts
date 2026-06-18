import Phaser from "phaser";
import type {
  Contestant,
  ContestantConfig,
  Ingredient,
  InputController,
  MiniGameDefinition,
  MiniGameKey,
  PaintBoard,
  Pearl,
} from "../game/types";

interface ContestantView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  accessory: Phaser.GameObjects.Graphics;
  carryIcon: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
}

interface ArenaBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

interface Burst {
  x: number;
  y: number;
  lifeMs: number;
  color: number;
}

interface CountCritter {
  id: number;
  x: number;
  y: number;
  vx: number;
  sprite: string;
  wobble: number;
}

interface MemoryTile {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  name: string;
  safe: boolean;
}

interface SoccerBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastTouchId?: number;
  cooldownMs: number;
}

interface DogBone {
  playerId: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  carriedBy?: number;
  delivered: boolean;
  color: number;
}

interface DogChase {
  caught: DogCatch[];
  phase: "toPlayer" | "toHome" | "back";
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  elapsedMs: number;
  durationMs: number;
}

interface DogCatch {
  playerId: number;
  bonePlayerId: number;
  fromX: number;
  fromY: number;
  homeX: number;
  homeY: number;
}

interface SavedContestant {
  id: number;
  name: string;
  sprite: string;
  color: number;
  uiColor: string;
  isHuman: boolean;
  skillLabel?: string;
  crowns: number;
  roundScore: number;
  totalScore: number;
  difficulty: number;
  mistakeRate: number;
  reactionMs: number;
  paintShapeIndex: number;
}

interface SavedPartyProgress {
  version: number;
  savedAt: number;
  phase: "countdown" | "playing" | "roundOver";
  roundIndex: number;
  currentGameKey: MiniGameKey;
  timerMs: number;
  singleGameKey?: MiniGameKey;
  contestants: SavedContestant[];
}

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

const MINI_GAMES: MiniGameDefinition[] = [
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

const CONTESTANTS: ContestantConfig[] = [
  { id: 0, name: "Invado", sprite: "invader", color: 0x5cc8ff, uiColor: "#5cc8ff", isHuman: true },
  { id: 1, name: "Shrimpy", sprite: "shrimp", color: 0xff8b4c, uiColor: "#ff8b4c", isHuman: false },
  { id: 2, name: "Pip", sprite: "apple", color: 0xe62b5e, uiColor: "#e62b5e", isHuman: false },
  { id: 3, name: "Lobstar", sprite: "lobster", color: 0xff3b26, uiColor: "#ff3b26", isHuman: false },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class ClawpartyScene extends Phaser.Scene {
  private readonly controls: InputController;
  private contestants: Contestant[] = [];
  private views = new Map<number, ContestantView>();
  private arena: ArenaBounds = this.makeArena();
  private phase: "lobby" | "countdown" | "playing" | "roundOver" | "final" = "lobby";
  private roundIndex = 0;
  private currentGame: MiniGameDefinition = MINI_GAMES[0];
  private timerMs = 0;
  private countdownMs = COUNTDOWN_MS;
  private ingredients: Ingredient[] = [];
  private pearls: Pearl[] = [];
  private paintBoards: PaintBoard[] = [];
  private countCritters: CountCritter[] = [];
  private countActual = 0;
  private countSpawnMs = 0;
  private countWatchMs = 18_000;
  private countTarget = 0;
  private countGuessStarted = false;
  private countGuessLockGraceMs = 0;
  private memoryTiles: MemoryTile[] = [];
  private memoryCycle = 0;
  private memoryPhase: "show" | "choose" | "resolve" = "show";
  private memoryPhaseMs = 0;
  private memoryTarget = "red";
  private soccerBalls: SoccerBall[] = [];
  private soccerKeeperId = 0;
  private soccerShooterOrder: number[] = [];
  private soccerShooterIndex = 0;
  private soccerCurrentShooterId = 0;
  private soccerPhase: "aim" | "shot" | "reset" = "aim";
  private soccerTurnMs = 0;
  private soccerAimX = 0;
  private dogBones: DogBone[] = [];
  private dogState: "sleep" | "look" = "sleep";
  private dogStateMs = 0;
  private dogGraceMs = 0;
  private dogChase?: DogChase;
  private paintPointer = { down: false, x: 0, y: 0 };
  private bursts: Burst[] = [];
  private nextItemId = 1;
  private toastUntil = 0;
  private domTickMs = 0;
  private lastPartySaveMs = 0;
  private rankMoves = new Map<number, number>();
  private soccerBallImages = new Map<number, Phaser.GameObjects.Image>();
  private dogBoneImages = new Map<number, Phaser.GameObjects.Image>();
  private clamImages = new Map<number, Phaser.GameObjects.Image>();
  private soccerGoalImage?: Phaser.GameObjects.Image;
  private dogImage?: Phaser.GameObjects.Image;
  private countBgImage?: Phaser.GameObjects.Image;
  private clawBgImage?: Phaser.GameObjects.Image;

  private worldGfx!: Phaser.GameObjects.Graphics;
  private propGfx!: Phaser.GameObjects.Graphics;
  private paintGfx!: Phaser.GameObjects.Graphics;
  private effectsGfx!: Phaser.GameObjects.Graphics;
  private countdownText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private roundChip: HTMLElement | null = null;
  private modeChip: HTMLElement | null = null;
  private timerChip: HTMLElement | null = null;
  private scorebar: HTMLElement | null = null;
  private roster: HTMLElement | null = null;
  private menuPanel: HTMLElement | null = null;
  private menuSubtitle: HTMLElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private shuffleButton: HTMLButtonElement | null = null;
  private miniGameToggleButton: HTMLButtonElement | null = null;
  private miniGamePicker: HTMLElement | null = null;
  private resultPanel: HTMLElement | null = null;
  private resultTitle: HTMLElement | null = null;
  private resultSubtitle: HTMLElement | null = null;
  private resultList: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private singleGameKey?: MiniGameKey;

  constructor(controls: InputController) {
    super("ClawpartyScene");
    this.controls = controls;
  }

  preload() {
    this.load.image("invader", "/assets/sprites/invader.png");
    this.load.image("shrimp", "/assets/sprites/shrimp.png");
    this.load.image("apple", "/assets/sprites/apple.png");
    this.load.image("lobster", "/assets/sprites/lobster.png");
    for (const contestant of CONTESTANTS) {
      this.load.spritesheet(`${contestant.sprite}-walk`, `/assets/sprites/${contestant.sprite}-walk.png`, { frameWidth: 96, frameHeight: 96 });
    }
    this.load.image("dog", "/assets/sprites/dog.png");
    this.load.image("dog-sleep", "/assets/sprites/dog-sleep.png");
    this.load.image("dog-alert", "/assets/sprites/dog-alert.png");
    this.load.image("dog-run", "/assets/sprites/dog-run.png");
    this.load.image("bone", "/assets/sprites/bone.png");
    this.load.image("soccer-ball", "/assets/sprites/soccer-ball.png");
    this.load.image("soccer-goal", "/assets/sprites/soccer-goal.png");
    this.load.image("count-beach-sea", "/assets/sprites/critter-count-beach-sea.png");
    this.load.image("claw-seabed", "/assets/sprites/pearl-panic-seabed.png");
    this.load.image("clam-closed", "/assets/sprites/clam-closed.png");
    this.load.image("clam-pearl", "/assets/sprites/clam-pearl.png");
    this.load.image("clam-empty", "/assets/sprites/clam-empty.png");
  }

  create() {
    this.worldGfx = this.add.graphics().setDepth(0);
    this.propGfx = this.add.graphics().setDepth(2);
    this.paintGfx = this.add.graphics().setDepth(1);
    this.effectsGfx = this.add.graphics().setDepth(6);
    this.countdownText = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "92px",
        color: "#fff4d7",
        stroke: "#000000",
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.overlayText = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "46px",
        color: "#fff4d7",
        stroke: "#000000",
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(18)
      .setVisible(false);
    this.overlayHint = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#6ed7ff",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
        wordWrap: { width: 280, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(18)
      .setVisible(false);
    this.setupDom();
    this.setupPointerInput();
    this.createContestants();
    this.createContestantViews();
    this.layoutLobby();
    this.updateDom(true);
    this.tryRestorePartyProgress();

    this.scale.on("resize", () => {
      this.arena = this.makeArena();
      this.clampContestants();
    });

    window.addEventListener("beforeunload", () => {
      this.savePartyProgress(true);
    });
  }

  update(time: number, deltaMs: number) {
    const delta = Math.min(deltaMs, 48) / 1000;
    this.arena = this.makeArena();
    this.worldGfx.clear();
    this.propGfx.clear();
    this.paintGfx.clear();
    this.effectsGfx.clear();
    this.hidePropImages();
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

  private setupDom() {
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

    this.miniGamePicker?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-minigame-key]");
      const key = button?.dataset.minigameKey as MiniGameKey | undefined;
      if (!key) {
        return;
      }
      this.startParty(key);
    });
  }

  private setupPointerInput() {
    const setPointer = (pointer: Phaser.Input.Pointer, down: boolean) => {
      this.paintPointer.down = down;
      this.paintPointer.x = pointer.x;
      this.paintPointer.y = pointer.y;
    };

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => setPointer(pointer, true));
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.paintPointer.x = pointer.x;
      this.paintPointer.y = pointer.y;
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => setPointer(pointer, false));
    this.input.on("pointerout", () => {
      this.paintPointer.down = false;
    });
  }

  private createContestants() {
    const roster = Phaser.Utils.Array.Shuffle([...CONTESTANTS]);
    this.contestants = roster.map((config, index) => this.makeContestant(config, index));
  }

  private makeContestant(config: ContestantConfig, index: number): Contestant {
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
      coveredNodes: new Set<number>(),
      paintAccumulator: 0,
      paintPenalty: 0,
      paintShapeIndex: 0,
      countGuess: 0,
      countLocked: false,
      alive: true,
    };
  }

  private shuffleCpuDifficulties() {
    for (const player of this.contestants) {
      if (!player.isHuman) {
        const preset = CPU_PRESETS[player.id];
        player.difficulty = clamp(preset.difficulty + Phaser.Math.FloatBetween(-0.04, 0.04), 0.12, 0.62);
        player.mistakeRate = clamp(preset.mistakeRate + Phaser.Math.FloatBetween(-0.04, 0.04), 0.12, 0.62);
        player.reactionMs = preset.reactionMs + Phaser.Math.Between(-80, 120);
      }
    }
  }

  private savePartyProgress(force = false) {
    if (this.phase !== "countdown" && this.phase !== "playing" && this.phase !== "roundOver") {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastPartySaveMs < 900) {
      return;
    }
    this.lastPartySaveMs = now;

    const save: SavedPartyProgress = {
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

  private tryRestorePartyProgress() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PARTY_SAVE_KEY);
    } catch {
      return;
    }
    if (!raw) {
      return;
    }

    let parsed: unknown;
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

  private isSavedPartyProgress(value: unknown): value is SavedPartyProgress {
    const save = value as SavedPartyProgress;
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

  private clearPartyProgress() {
    this.lastPartySaveMs = 0;
    try {
      localStorage.removeItem(PARTY_SAVE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  private createContestantViews() {
    for (const view of this.views.values()) {
      view.container.destroy(true);
    }
    this.views.clear();

    for (const player of this.contestants) {
      const shadow = this.add.ellipse(0, 12, 42, 13, 0x000000, 0.42);
      const sprite = this.add.image(0, -19, `${player.sprite}-walk`, 0).setDisplaySize(58, 58);
      const accessory = this.add.graphics();
      const carryIcon = this.add.graphics();
      const label = this.add
        .text(0, 20, player.isHuman ? "YOU" : player.name, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#fff4d7",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0);
      const score = this.add
        .text(0, -64, "", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0.5);
      const container = this.add.container(player.x, player.y, [shadow, sprite, accessory, carryIcon, label, score]).setDepth(4);
      this.views.set(player.id, { container, sprite, accessory, carryIcon, label, score });
    }
  }

  private startParty(singleGameKey?: MiniGameKey) {
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

  private beginNextRound() {
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

  private resetRoundPlayers() {
    for (const player of this.contestants) {
      player.roundScore = 0;
      player.carrying = undefined;
      player.carryingPearl = undefined;
      player.vx = 0;
      player.vy = 0;
      player.actionCooldownMs = 0;
      player.stunnedMs = 0;
      player.finishMs = undefined;
      player.coveredNodes = new Set<number>();
      player.paintAccumulator = 0;
      player.paintPenalty = 0;
      player.paintShapeIndex = 0;
      player.countGuess = 0;
      player.countLocked = false;
      player.alive = true;
    }
  }

  private setupChef() {
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

  private setupPaint() {
    this.contestants.forEach((player, index) => {
      player.paintShapeIndex = index;
    });
    this.restorePaintBrushes();
  }

  private restorePaintBrushes() {
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

  private setupClaw() {
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

  private setupSoccer() {
    this.soccerKeeperId = Phaser.Math.Between(0, this.contestants.length - 1);
    this.soccerShooterOrder = Phaser.Utils.Array.Shuffle(this.contestants.filter((player) => player.id !== this.soccerKeeperId).map((player) => player.id));
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

  private beginSoccerTurn(advance = true) {
    if (advance) {
      this.soccerShooterIndex += 1;
    }
    if (this.soccerShooterIndex >= this.soccerShooterOrder.length) {
      this.soccerShooterOrder = Phaser.Utils.Array.Shuffle(this.contestants.filter((player) => player.id !== this.soccerKeeperId).map((player) => player.id));
      this.soccerShooterIndex = 0;
    }

    const goal = this.soccerGoalRect();
    const zone = this.soccerKeeperZone();
    const spot = this.soccerShotSpot();
    const keeperLineY = this.soccerKeeperLineY();
    this.soccerCurrentShooterId = this.soccerShooterOrder[this.soccerShooterIndex] ?? this.contestants[0].id;
    this.soccerPhase = "aim";
    this.soccerTurnMs = 4_400;
    this.soccerAimX = clamp(goal.x + goal.w * Phaser.Math.FloatBetween(0.18, 0.82), goal.x + 20, goal.x + goal.w - 20);

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
      player.aiThinkMs = player.isHuman ? 0 : player.reactionMs + Phaser.Math.Between(560, 1_050);
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

  private setupDog() {
    this.dogState = "sleep";
    this.dogStateMs = Phaser.Math.Between(2_100, 3_800);
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

  private setupCount() {
    this.countCritters = [];
    this.countActual = 0;
    this.countSpawnMs = 1_250;
    this.countWatchMs = 21_000;
    this.countTarget = Phaser.Math.Between(18, 30);
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

  private countIslandY() {
    return this.arena.top + Math.min(78, Math.max(46, this.arena.height * 0.14));
  }

  private countSeaTop() {
    return this.arena.top + Math.min(158, Math.max(108, this.arena.height * 0.3));
  }

  private countLookoutSpot(index: number) {
    const lanes = [0.2, 0.39, 0.61, 0.8];
    return {
      x: this.arena.left + this.arena.width * lanes[index],
      y: this.countIslandY() + (index % 2 === 0 ? 8 : -8),
    };
  }

  private setupMemory() {
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

  private updateActiveMinigame(delta: number, deltaMs: number) {
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

  private updateChef(delta: number, deltaMs: number) {
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

  private updateChefAi(player: Contestant, delta: number, deltaMs: number) {
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
        player.targetX = target.x + Phaser.Math.FloatBetween(-drift, drift);
        player.targetY = target.y + Phaser.Math.FloatBetween(-drift, drift);
      } else {
        player.targetX = Phaser.Math.Between(this.arena.left + 40, this.arena.right - 40);
        player.targetY = Phaser.Math.Between(this.arena.top + 60, this.arena.bottom - 40);
      }
      player.aiThinkMs = player.reactionMs + Phaser.Math.Between(120, 420);
    }

    const target = this.nearestIngredient(player.x, player.y, 40);
    this.steerTo(player, player.targetX, player.targetY, 78 + player.difficulty * 104, delta);
    if (target) {
      if (Math.random() > player.mistakeRate * 0.38) {
        this.pickIngredient(player, target);
      }
    }
  }

  private tryChefAuto(player: Contestant) {
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

  private pickIngredient(player: Contestant, ingredient: Ingredient) {
    if (ingredient.carriedBy !== undefined || player.carrying) {
      return;
    }
    ingredient.carriedBy = player.id;
    player.carrying = ingredient;
    this.bursts.push({ x: player.x, y: player.y - 30, lifeMs: 230, color: ingredient.color });
  }

  private deliverIngredient(player: Contestant) {
    if (!player.carrying) {
      return;
    }
    this.ingredients = this.ingredients.filter((ingredient) => ingredient.id !== player.carrying?.id);
    player.carrying = undefined;
    player.roundScore += 1;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 420, color: 0xffd75e });
    this.spawnIngredient();
  }

  private updatePaint(delta: number, deltaMs: number) {
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

  private updateHumanPaint(player: Contestant, board: PaintBoard, delta: number) {
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

  private updatePaintAi(player: Contestant, board: PaintBoard, delta: number, elapsedMs: number) {
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

  private coverPaintNodes(player: Contestant, board: PaintBoard, radius: number) {
    board.nodes.forEach((node, index) => {
      if (!player.coveredNodes.has(index) && distance(player.brushX, player.brushY, node.x, node.y) <= radius) {
        player.coveredNodes.add(index);
      }
    });
  }

  private penalizePaint(player: Contestant, amount: number) {
    player.paintPenalty = Math.min(120, player.paintPenalty + amount);
    const eraseCount = Math.floor(player.paintPenalty / 7);
    if (eraseCount > 0) {
      this.erasePaintProgress(player, eraseCount);
      player.paintPenalty = Math.max(0, player.paintPenalty - eraseCount * 7);
    }
  }

  private erasePaintProgress(player: Contestant, count: number) {
    const painted = [...player.coveredNodes].sort((a, b) => b - a);
    for (let i = 0; i < Math.min(count, painted.length); i += 1) {
      player.coveredNodes.delete(painted[i]);
    }
  }

  private completePaintShape(player: Contestant, board: PaintBoard, elapsedMs: number) {
    player.roundScore += 1;
    player.finishMs = elapsedMs;
    player.paintShapeIndex += 1;
    player.coveredNodes = new Set<number>();
    player.paintPenalty = 0;
    player.paintAccumulator = 0;
    const nextNodes = this.shapeNodes(board.x, board.y, board.w, board.h, player.paintShapeIndex);
    player.brushX = nextNodes[0]?.x ?? board.x + board.w * 0.5;
    player.brushY = nextNodes[0]?.y ?? board.y + board.h * 0.5;
    player.targetX = player.brushX;
    player.targetY = player.brushY;
    this.bursts.push({ x: player.brushX, y: player.brushY, lifeMs: 500, color: player.color });
  }

  private updateClaw(delta: number, deltaMs: number) {
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

  private updateClawAi(player: Contestant, delta: number, deltaMs: number) {
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
        player.targetX = pearl.x + Phaser.Math.FloatBetween(-drift, drift);
        player.targetY = pearl.y + Phaser.Math.FloatBetween(-drift, drift);
      } else {
        player.targetX = Phaser.Math.Between(bounds.left + 40, bounds.right - 40);
        player.targetY = Phaser.Math.Between(bounds.top + 44, bounds.bottom - 40);
      }
      player.targetX = clamp(player.targetX, bounds.left + 24, bounds.right - 24);
      player.targetY = clamp(player.targetY, bounds.top + 24, bounds.bottom - 24);
      player.aiThinkMs = player.reactionMs + Phaser.Math.Between(150, 520);
    }
    this.steerTo(player, player.targetX, player.targetY, 82 + player.difficulty * 112, delta);
    this.tryPearlAuto(player);
  }

  private trySnap(player: Contestant) {
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

  private tryPearlAuto(player: Contestant) {
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

  private deliverPearl(player: Contestant) {
    if (!player.carryingPearl) {
      return;
    }
    this.pearls = this.pearls.filter((item) => item.id !== player.carryingPearl?.id);
    player.carryingPearl = undefined;
    player.roundScore += 1;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 420, color: 0x6ed7ff });
    this.spawnPearl();
  }

  private updateSoccer(delta: number, deltaMs: number) {
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

  private updateSoccerShooterAi(player: Contestant, deltaMs: number) {
    player.aiThinkMs -= deltaMs;
    const goal = this.soccerGoalRect();
    const keeper = this.contestants.find((item) => item.id === this.soccerKeeperId);
    if (player.aiThinkMs <= 0) {
      const openSide = keeper && keeper.x < goal.x + goal.w * 0.5 ? 0.78 : 0.22;
      const drift = goal.w * (player.mistakeRate * 0.52 + Phaser.Math.FloatBetween(-0.08, 0.08));
      this.soccerAimX = clamp(goal.x + goal.w * openSide + drift, goal.x + 18, goal.x + goal.w - 18);
      this.shootSoccerBall(player);
    } else if (Math.random() < 0.08) {
      const wobble = goal.w * player.mistakeRate * 0.34;
      this.soccerAimX = clamp(this.soccerAimX + Phaser.Math.FloatBetween(-wobble, wobble), goal.x + 18, goal.x + goal.w - 18);
    }
  }

  private updateSoccerKeeperAi(player: Contestant, delta: number, deltaMs: number) {
    player.aiThinkMs -= deltaMs;
    if (player.aiThinkMs <= 0) {
      const ball = this.soccerBalls[0];
      const zone = this.soccerKeeperZone();
      const drift = this.arena.width * (player.mistakeRate * 0.2);
      const targetX = this.soccerPhase === "shot" && ball ? ball.x : this.soccerAimX;
      player.targetX = clamp(targetX + Phaser.Math.FloatBetween(-drift, drift), zone.x + 18, zone.x + zone.w - 18);
      player.aiThinkMs = Math.max(90, player.reactionMs * 0.36 + Phaser.Math.Between(40, 140));
    }
    this.moveKeeperTowardX(player, player.targetX, 104 + player.difficulty * 112, delta);
  }

  private shootSoccerBall(player: Contestant) {
    if (this.soccerPhase !== "aim") {
      return;
    }
    const ball = this.soccerBalls[0];
    if (!ball) {
      return;
    }
    const goal = this.soccerGoalRect();
    const miss = player.isHuman ? 0 : Phaser.Math.FloatBetween(-goal.w, goal.w) * player.mistakeRate * 0.14;
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

  private resolveSoccerShot(ball: SoccerBall, keeper: Contestant) {
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

  private finishSoccerShot(label: string, color: number, x: number, y: number) {
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

  private moveSoccerKeeper(player: Contestant, delta: number) {
    const zone = this.soccerKeeperZone();
    const speed = 194;
    player.vx = this.controls.x * speed;
    player.vy = 0;
    player.x = clamp(player.x + player.vx * delta, zone.x + 18, zone.x + zone.w - 18);
    player.y = this.soccerKeeperLineY();
  }

  private trySoccerKeeperDash(player: Contestant, actionPressed: boolean) {
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

  private moveKeeperTowardX(player: Contestant, targetX: number, speed: number, delta: number) {
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

  private updateDog(delta: number, deltaMs: number) {
    this.advanceDogChase(deltaMs);
    this.drawDogArena();
    if (!this.dogChase) {
      this.tickDogState(deltaMs);
    }

    const caughtThisFrame: Array<{ player: Contestant; bone: DogBone }> = [];
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

  private tickDogState(deltaMs: number) {
    this.dogStateMs -= deltaMs;
    this.dogGraceMs = Math.max(0, this.dogGraceMs - deltaMs);
    if (this.dogStateMs > 0) {
      return;
    }

    if (this.dogState === "sleep") {
      this.dogState = "look";
      this.dogStateMs = Phaser.Math.Between(1_250, 1_900);
      this.dogGraceMs = 460;
      for (const player of this.contestants) {
        if (!player.isHuman) {
          player.aiThinkMs = Math.max(80, player.reactionMs * (0.44 + player.mistakeRate) + Phaser.Math.Between(-90, 150));
        }
      }
    } else {
      this.dogState = "sleep";
      this.dogStateMs = Phaser.Math.Between(1_850, 3_450);
    }
  }

  private updateDogAi(player: Contestant, bone: DogBone, delta: number, deltaMs: number) {
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

  private tryDogBoneAuto(player: Contestant, bone: DogBone) {
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

  private deliverDogBone(player: Contestant, bone: DogBone) {
    bone.delivered = true;
    bone.carriedBy = undefined;
    player.finishMs = this.currentGame.durationMs - this.timerMs;
    player.roundScore = Math.max(1, Math.ceil(this.timerMs / 1_000));
    player.vx = 0;
    player.vy = 0;
    this.bursts.push({ x: player.x, y: player.y - 28, lifeMs: 560, color: 0xffd75e });
  }

  private catchByDog(caught: Array<{ player: Contestant; bone: DogBone }>) {
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

  private startDogChase(caught: Array<{ player: Contestant; bone: DogBone }>) {
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

  private advanceDogChase(deltaMs: number) {
    if (!this.dogChase) {
      return;
    }
    const chase = this.dogChase;
    chase.elapsedMs += deltaMs;
    const t = clamp(chase.elapsedMs / chase.durationMs, 0, 1);
    const eased = t * t * (3 - 2 * t);
    chase.x = Phaser.Math.Linear(chase.fromX, chase.toX, eased);
    chase.y = Phaser.Math.Linear(chase.fromY, chase.toY, eased);

    if (chase.phase === "toHome") {
      for (const caught of chase.caught) {
        const player = this.contestants.find((item) => item.id === caught.playerId);
        if (player) {
          player.x = Phaser.Math.Linear(caught.fromX, caught.homeX, eased);
          player.y = Phaser.Math.Linear(caught.fromY, caught.homeY, eased);
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
    this.dogStateMs = Phaser.Math.Between(1_700, 2_800);
  }

  private isDogDragging(playerId: number) {
    return this.dogChase?.caught.some((caught) => caught.playerId === playerId) ?? false;
  }

  private updateCount(delta: number, deltaMs: number) {
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
        this.countSpawnMs = Phaser.Math.Between(1_250 - pace * 760, 1_680 - pace * 880);
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

  private updateMemory(delta: number, deltaMs: number) {
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

  private spawnCountCritter(offsetY = 0) {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const sprite = ["invader", "shrimp", "apple", "lobster"][Phaser.Math.Between(0, 3)];
    this.countActual += 1;
    const seaTop = this.countSeaTop();
    const minY = seaTop + 22;
    const maxY = this.arena.bottom - 46;
    const y = Phaser.Math.Between(minY, maxY);
    this.countCritters.push({
      id: this.nextItemId++,
      x: direction > 0 ? this.arena.left - 48 : this.arena.right + 48,
      y: clamp(y + offsetY * (Math.random() > 0.5 ? 1 : -1), minY, maxY),
      vx: direction * Phaser.Math.Between(82, 156),
      sprite,
      wobble: Math.random() * 20,
    });
  }

  private tickGuessInput(player: Contestant, deltaMs: number) {
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

  private cpuCountError(player: Contestant) {
    const spread = player.id === 1 ? 2 : player.id === 2 ? 4 : 7;
    const error = Phaser.Math.Between(-spread, spread);
    if (Math.random() < 1 - player.mistakeRate) {
      return Math.round(error * 0.55);
    }
    return error;
  }

  private layoutMemoryTiles(forceNew = false) {
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
      const picked = colors[(index + Phaser.Math.Between(0, colors.length - 1)) % colors.length];
      return { x: 0, y: 0, w: 0, h: 0, color: picked.color, name: picked.name, safe: false };
    });
    Phaser.Utils.Array.Shuffle(this.memoryTiles);
    this.layoutMemoryTiles(false);
  }

  private pickMemoryTarget() {
    const names = ["red", "blue", "green", "yellow"];
    this.memoryTarget = names[(this.roundIndex + this.memoryCycle + Phaser.Math.Between(0, 3)) % names.length];
    for (const tile of this.memoryTiles) {
      tile.safe = tile.name === this.memoryTarget;
    }
  }

  private chooseMemoryTargets() {
    for (const player of this.contestants) {
      if (player.isHuman || !player.alive) {
        continue;
      }
      const shouldMiss = Math.random() < player.mistakeRate * 0.55;
      const options = this.memoryTiles.filter((tile) => shouldMiss ? !tile.safe : tile.safe);
      const tile = options[Phaser.Math.Between(0, Math.max(0, options.length - 1))] ?? this.memoryTiles[0];
      player.targetX = tile.x + tile.w * Phaser.Math.FloatBetween(0.32, 0.68);
      player.targetY = tile.y + tile.h * Phaser.Math.FloatBetween(0.32, 0.68);
      player.aiThinkMs = player.reactionMs + Phaser.Math.Between(120, 520);
    }
  }

  private updateMemoryAi(player: Contestant, delta: number, deltaMs: number) {
    player.aiThinkMs -= deltaMs;
    if (player.aiThinkMs > 0) {
      return;
    }
    this.steerTo(player, player.targetX, player.targetY, 88 + player.difficulty * 128, delta);
  }

  private resolveMemoryCycle() {
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

  private endRound() {
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

  private finishParty() {
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

  private isRoundComplete() {
    if (this.currentGame.key === "memory" && this.phase === "playing") {
      return this.contestants.every((player) => !player.alive);
    }
    if (this.currentGame.key === "dog" && this.phase === "playing") {
      return this.dogBones.filter((bone) => !bone.delivered).length <= 1;
    }
    return false;
  }

  private roundWinners() {
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

  private roundStandings() {
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

  private showResultPanel(winners: Contestant[]) {
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

  private resultScoreLabel(player: Contestant) {
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

  private overallRanks() {
    const sorted = this.overallStandings();
    return new Map(sorted.map((player, index) => [player.id, index + 1]));
  }

  private overallStandings() {
    return [...this.contestants].sort((a, b) => b.crowns - a.crowns || b.totalScore - a.totalScore || a.id - b.id);
  }

  private rankMovement(before: Map<number, number>, after: Map<number, number>) {
    const moves = new Map<number, number>();
    for (const player of this.contestants) {
      moves.set(player.id, (before.get(player.id) ?? 0) - (after.get(player.id) ?? 0));
    }
    return moves;
  }

  private partyWinners() {
    const bestCrowns = Math.max(...this.contestants.map((player) => player.crowns));
    const crownLeaders = this.contestants.filter((player) => player.crowns === bestCrowns);
    const bestTotal = Math.max(...crownLeaders.map((player) => player.totalScore));
    return crownLeaders.filter((player) => player.totalScore === bestTotal);
  }

  private drawCurrentArena() {
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

  private drawCountdownOverlay() {
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

  private controlHint() {
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

  private drawLobbyScene(time: number, delta: number) {
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

  private drawChefArena() {
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

  private drawPaintArena() {
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

  private drawClawArena() {
    const bounds = this.clawBounds();
    this.drawBackground(0x03151d);
    this.clawBgImage ??= this.add.image(0, 0, "claw-seabed").setDepth(0.2).setVisible(false);
    this.clawBgImage
      .setVisible(true)
      .setOrigin(0, 0)
      .setPosition(bounds.left, bounds.top)
      .setDisplaySize(bounds.width, bounds.height);
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
      let clam = this.clamImages.get(pearl.id);
      if (!clam) {
        clam = this.add.image(0, 0, "clam-pearl").setDepth(2.8).setVisible(false);
        this.clamImages.set(pearl.id, clam);
      }
      clam
        .setVisible(true)
        .setTexture(pearl.opened ? "clam-empty" : "clam-pearl")
        .setPosition(pearl.x, pearl.y)
        .setDisplaySize(62, 42);
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

  private drawSoccerArena() {
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

    this.soccerGoalImage ??= this.add.image(0, 0, "soccer-goal").setDepth(2.4).setVisible(false);
    this.soccerGoalImage
      .setVisible(true)
      .setPosition(goal.x + goal.w * 0.5, goal.y + 26)
      .setDisplaySize(Math.min(goal.w + 58, this.arena.width * 0.72), 78);

    for (const ball of this.soccerBalls) {
      let image = this.soccerBallImages.get(ball.id);
      if (!image) {
        image = this.add.image(0, 0, "soccer-ball").setDepth(3.2).setVisible(false);
        this.soccerBallImages.set(ball.id, image);
      }
      image.setVisible(true).setPosition(ball.x, ball.y).setDisplaySize(36, 36).setAlpha(this.soccerPhase === "reset" ? 0.58 : 1);
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
      .setText(`${hint}  G+2 B+1`)
      .setPosition(this.arena.cx, this.arena.top + 32)
      .setVisible(true);
  }

  private drawSoccerGuide() {
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

  private drawDogArena() {
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
    this.dogImage ??= this.add.image(0, 0, dogTexture).setDepth(2.5).setVisible(false);
    this.dogImage
      .setTexture(dogTexture)
      .setVisible(true)
      .setPosition(dogX, dogY)
      .setDisplaySize(dogW, dogH);

    if (this.dogState === "look" && !chase) {
      this.propGfx.fillStyle(0x050505, 1);
      this.propGfx.fillRect(dog.x - dogW * 0.16, dog.y - dogH * 0.08, 9, 13);
      this.propGfx.fillRect(dog.x + dogW * 0.08, dog.y - dogH * 0.08, 9, 13);
      this.propGfx.fillStyle(0xff3b26, 1);
      this.propGfx.fillRect(dog.x + dogW * 0.35, dog.y - dogH * 0.58, 12, 36);
      this.propGfx.fillRect(dog.x + dogW * 0.35, dog.y - dogH * 0.15, 12, 12);
    }

    for (const bone of this.dogBones) {
      let image = this.dogBoneImages.get(bone.playerId);
      if (!image) {
        image = this.add.image(0, 0, "bone").setDepth(3.1).setVisible(false);
        this.dogBoneImages.set(bone.playerId, image);
      }
      const carrier = bone.carriedBy === undefined ? undefined : this.contestants.find((player) => player.id === bone.carriedBy);
      const base = this.dogHomeBase(this.contestants[bone.playerId]);
      const x = bone.delivered ? base.x : carrier ? carrier.x : bone.x;
      const y = bone.delivered ? base.y - 28 : carrier ? carrier.y - 52 : bone.y;
      image
        .setVisible(true)
        .setTint(bone.color)
        .setAlpha(bone.delivered ? 0.42 : 1)
        .setPosition(x, y)
        .setDisplaySize(42, 24);
    }
  }

  private drawCountArena() {
    this.drawBackground(0x03151d);
    this.countBgImage ??= this.add.image(0, 0, "count-beach-sea").setDepth(0.2).setVisible(false);
    this.countBgImage
      .setVisible(true)
      .setOrigin(0, 0)
      .setPosition(this.arena.left, this.arena.top)
      .setDisplaySize(this.arena.width, this.arena.height);

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

  private drawCountCritter(x: number, y: number, sprite: string) {
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

  private drawMemoryArena() {
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

  private drawBackground(color: number) {
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

  private hidePropImages() {
    this.soccerGoalImage?.setVisible(false);
    this.dogImage?.setVisible(false);
    this.countBgImage?.setVisible(false);
    this.clawBgImage?.setVisible(false);
    for (const image of this.soccerBallImages.values()) {
      image.setVisible(false);
    }
    for (const image of this.dogBoneImages.values()) {
      image.setVisible(false);
    }
    for (const image of this.clamImages.values()) {
      image.setVisible(false);
    }
  }

  private drawPixelFrame(x: number, y: number, w: number, h: number, fill: number, border: number) {
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

  private drawBursts() {
    for (const burst of this.bursts) {
      const t = clamp(burst.lifeMs / 500, 0, 1);
      const size = 12 + (1 - t) * 44;
      this.effectsGfx.fillStyle(burst.color, 0.85 * t);
      this.effectsGfx.fillRect(burst.x - size / 2, burst.y - 3, size, 6);
      this.effectsGfx.fillRect(burst.x - 3, burst.y - size / 2, 6, size);
    }
  }

  private updateBursts(deltaMs: number) {
    for (const burst of this.bursts) {
      burst.lifeMs -= deltaMs;
    }
    this.bursts = this.bursts.filter((burst) => burst.lifeMs > 0);
    this.drawBursts();
  }

  private updateContestantViews() {
    const sorted = [...this.contestants].sort((a, b) => a.y - b.y);
    sorted.forEach((player, index) => {
      const view = this.views.get(player.id);
      if (!view) {
        return;
      }
      view.container.setPosition(Math.round(player.x), Math.round(player.y));
      view.container.setDepth(4 + index * 0.01);
      const scoreY =
        this.currentGame.key === "chef" || this.currentGame.key === "paint"
          ? -88
          : this.currentGame.key === "soccer" && player.id === this.soccerKeeperId
            ? 42
            : -72;
      view.score.setPosition(0, scoreY);
      view.score.setText(this.scoreLabel(player));
      view.sprite.setAlpha(!player.alive ? 0.32 : player.stunnedMs > 0 ? 0.58 : 1);
      const moving = this.phase === "playing" && Math.hypot(player.vx, player.vy) > 18;
      const walkFrame = moving ? Math.floor(this.time.now / 95 + player.id) % 4 : 0;
      view.sprite.setFrame(walkFrame);
      const step = moving ? Math.sin(this.time.now * 0.016 + player.id * 1.7) : 0;
      const bounce = Math.abs(step);
      view.sprite.setPosition(step * 1.7, -19 + bounce * 3);
      view.sprite.setDisplaySize(58 + bounce * 5, 58 - bounce * 3);
      view.sprite.setAngle(moving ? step * 3 : 0);
      if (Math.abs(player.vx) > 22) {
        view.sprite.setFlipX(player.vx < 0);
      }
      this.drawAccessory(player, view);
      this.drawCarry(player, view);
    });
  }

  private scoreLabel(player: Contestant) {
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

  private scorebarValue(player: Contestant) {
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

  private drawAccessory(player: Contestant, view: ContestantView) {
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

  private drawCarry(player: Contestant, view: ContestantView) {
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

  private drawIngredient(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    g.fillStyle(0x000000, 0.32);
    g.fillRect(x - 8, y + 8, 18, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 9, y - 8, 18, 18);
    g.fillStyle(0xfff4d7, 0.8);
    g.fillRect(x - 3, y - 5, 5, 5);
  }

  private drawPearl(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    g.fillStyle(0x000000, 0.3);
    g.fillRect(x - 8, y + 8, 18, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 8, y - 8, 16, 16);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(x - 3, y - 5, 4, 4);
  }

  private drawBoneIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    g.fillStyle(0x000000, 0.3);
    g.fillRect(x - 13, y + 7, 26, 4);
    g.fillStyle(color, 1);
    g.fillRect(x - 13, y - 3, 26, 8);
    g.fillRect(x - 17, y - 7, 9, 9);
    g.fillRect(x + 8, y - 7, 9, 9);
    g.fillStyle(0xfff4d7, 0.72);
    g.fillRect(x - 9, y - 1, 18, 4);
  }

  private updateDom(force: boolean, deltaMs = 0) {
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

  private showToast(message: string, durationMs: number) {
    if (!this.toast) {
      return;
    }
    this.toast.textContent = message;
    this.toast.classList.add("is-visible");
    this.toastUntil = this.time.now + durationMs;
  }

  private updateToast() {
    if (this.toast && this.toastUntil > 0 && this.time.now > this.toastUntil) {
      this.toast.classList.remove("is-visible");
      this.toastUntil = 0;
    }
  }

  private tickCooldowns(player: Contestant, deltaMs: number) {
    player.actionCooldownMs = Math.max(0, player.actionCooldownMs - deltaMs);
    player.stunnedMs = Math.max(0, player.stunnedMs - deltaMs);
  }

  private moveWithInput(player: Contestant, delta: number, speed: number) {
    this.moveVector(player, this.controls.x, this.controls.y, speed, delta);
  }

  private steerTo(player: Contestant, targetX: number, targetY: number, speed: number, delta: number) {
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) {
      return;
    }
    this.moveVector(player, dx / len, dy / len, speed, delta);
  }

  private moveVector(player: Contestant, x: number, y: number, speed: number, delta: number) {
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

  private clampToBounds(player: Contestant, bounds: ArenaBounds, padX: number, padY: number) {
    player.x = clamp(player.x, bounds.left + padX, bounds.right - padX);
    player.y = clamp(player.y, bounds.top + padY, bounds.bottom - padY);
  }

  private steerBrush(player: Contestant, targetX: number, targetY: number, speed: number, delta: number, board: PaintBoard) {
    const dx = targetX - player.brushX;
    const dy = targetY - player.brushY;
    const len = Math.max(1, Math.hypot(dx, dy));
    player.brushX = clamp(player.brushX + (dx / len) * speed * delta, board.x + 10, board.x + board.w - 10);
    player.brushY = clamp(player.brushY + (dy / len) * speed * delta, board.y + 10, board.y + board.h - 10);
  }

  private nearestIngredient(x: number, y: number, maxDistance = Number.POSITIVE_INFINITY) {
    let best: Ingredient | undefined;
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

  private pickAiIngredientTarget(player: Contestant) {
    const open = this.ingredients.filter((ingredient) => ingredient.carriedBy === undefined);
    if (open.length === 0) {
      return undefined;
    }
    if (Math.random() < player.mistakeRate * 0.45) {
      return open[Phaser.Math.Between(0, open.length - 1)];
    }
    return this.nearestIngredient(player.x, player.y);
  }

  private nearestPearl(x: number, y: number) {
    let best: Pearl | undefined;
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

  private pickAiPearlTarget(player: Contestant) {
    const open = this.pearls.filter((pearl) => pearl.carriedBy === undefined);
    if (open.length === 0) {
      return undefined;
    }
    if (Math.random() < player.mistakeRate * 0.48) {
      return open[Phaser.Math.Between(0, open.length - 1)];
    }
    return this.nearestPearl(player.x, player.y);
  }

  private nearestRival(player: Contestant) {
    let best: Contestant | undefined;
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

  private nextUncoveredNode(player: Contestant, board: PaintBoard) {
    for (let i = 0; i < board.nodes.length; i += 1) {
      if (!player.coveredNodes.has(i)) {
        return i;
      }
    }
    return undefined;
  }

  private paintProgress(player: Contestant, board: PaintBoard) {
    if (board.nodes.length === 0) {
      return 0;
    }
    return Math.floor((player.coveredNodes.size / board.nodes.length) * 100);
  }

  private isPaintShapeComplete(player: Contestant, board: PaintBoard) {
    if (board.nodes.length === 0) {
      return false;
    }
    const missing = board.nodes.length - player.coveredNodes.size;
    const maxMissing = Math.max(1, Math.floor(board.nodes.length * 0.012));
    const maxGap = Math.max(1, Math.floor(board.nodes.length * 0.018));
    return missing <= maxMissing && this.longestUncoveredPaintGap(player, board) <= maxGap;
  }

  private longestUncoveredPaintGap(player: Contestant, board: PaintBoard) {
    const uncovered: number[] = [];
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

  private nearestPaintNodeDistance(player: Contestant, board: PaintBoard) {
    let best = Number.POSITIVE_INFINITY;
    for (const node of board.nodes) {
      best = Math.min(best, distance(player.brushX, player.brushY, node.x, node.y));
    }
    return best;
  }

  private isInsideRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  private tileAt(x: number, y: number) {
    return this.memoryTiles.find((tile) => this.isInsideRect(x, y, tile));
  }

  private soccerGoalRect() {
    const w = Math.min(240, Math.max(148, this.arena.width * 0.52));
    return {
      x: this.arena.cx - w * 0.5,
      y: this.arena.top + 14,
      w,
      h: 52,
    };
  }

  private soccerKeeperZone() {
    const goal = this.soccerGoalRect();
    return {
      x: clamp(goal.x - 38, this.arena.left + 20, this.arena.right - goal.w - 20),
      y: goal.y + 26,
      w: Math.min(this.arena.width - 40, goal.w + 76),
      h: Math.min(124, this.arena.height * 0.34),
    };
  }

  private soccerKeeperLineY() {
    const zone = this.soccerKeeperZone();
    return zone.y + zone.h * 0.62;
  }

  private soccerShotSpot() {
    return {
      x: this.arena.cx,
      y: this.arena.bottom - Math.min(126, Math.max(92, this.arena.height * 0.24)),
    };
  }

  private nearestSoccerBall(x: number, y: number) {
    let best: SoccerBall | undefined;
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

  private mostThreateningSoccerBall() {
    return [...this.soccerBalls].sort((a, b) => a.y - b.y || Math.abs(b.vy) - Math.abs(a.vy))[0] ?? this.soccerBalls[0];
  }

  private dogPoint() {
    return {
      x: this.arena.cx,
      y: this.arena.top + Math.min(118, this.arena.height * 0.33),
    };
  }

  private homeBase(player: Contestant) {
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

  private clawHomeBase(player: Contestant) {
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

  private clawSpawnRect() {
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

  private dogHomeBase(player: Contestant) {
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

  private clawBounds(): ArenaBounds {
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

  private drawHomeBases(kind: "basket" | "tidepool" | "bone") {
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

  private spawnIngredient() {
    const colors = [0xffd75e, 0x79f2b1, 0xff735c, 0x6ed7ff, 0xf5ead0];
    this.ingredients.push({
      id: this.nextItemId++,
      x: Phaser.Math.Between(this.arena.left + 44, this.arena.right - 44),
      y: Phaser.Math.Between(this.arena.top + 92, this.arena.bottom - 92),
      color: colors[Phaser.Math.Between(0, colors.length - 1)],
      label: "bite",
    });
  }

  private spawnPearl() {
    const colors = [0xfff4d7, 0x6ed7ff, 0xffd75e, 0x79f2b1];
    const rect = this.clawSpawnRect();
    let x = this.arena.cx;
    let y = this.arena.cy;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      x = Phaser.Math.Between(rect.x, rect.x + rect.w);
      y = Phaser.Math.Between(rect.y, rect.y + rect.h);
      if (this.pearls.every((pearl) => distance(pearl.x, pearl.y, x, y) > 58)) {
        break;
      }
    }
    this.pearls.push({
      id: this.nextItemId++,
      x,
      y,
      color: colors[Phaser.Math.Between(0, colors.length - 1)],
      opened: false,
    });
  }

  private chefPlate() {
    return { x: this.arena.cx, y: this.arena.top + 48 };
  }

  private layoutPaintBoards() {
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

  private shapeNodes(x: number, y: number, w: number, h: number, shapeIndex = 0) {
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
    const toNode = ([px, py]: number[]) => new Phaser.Math.Vector2(x + margin + px * (w - margin * 2), y + margin + py * (h - margin * 2));
    const nodes: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = toNode(points[i]);
      const b = toNode(points[i + 1]);
      const samples = Math.max(10, Math.floor(distance(a.x, a.y, b.x, b.y) / PAINT_NODE_SPACING));
      for (let s = 0; s <= samples; s += 1) {
        const t = s / samples;
        nodes.push(new Phaser.Math.Vector2(Phaser.Math.Linear(a.x, b.x, t), Phaser.Math.Linear(a.y, b.y, t)));
      }
    }
    return nodes;
  }

  private cornerStarts(pad: number) {
    return [
      { x: this.arena.left + pad, y: this.arena.bottom - pad },
      { x: this.arena.right - pad, y: this.arena.top + pad },
      { x: this.arena.left + pad, y: this.arena.top + pad },
      { x: this.arena.right - pad, y: this.arena.bottom - pad },
    ];
  }

  private layoutLobby() {
    const starts = this.cornerStarts(64);
    this.contestants.forEach((player, index) => {
      player.x = starts[index].x;
      player.y = starts[index].y;
    });
  }

  private clampContestants() {
    for (const player of this.contestants) {
      player.x = clamp(player.x, this.arena.left + 24, this.arena.right - 24);
      player.y = clamp(player.y, this.arena.top + 34, this.arena.bottom - 24);
    }
  }

  private makeArena(): ArenaBounds {
    const width = this.scale?.width ?? window.innerWidth;
    const height = this.scale?.height ?? window.innerHeight;
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
