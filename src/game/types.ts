import type Phaser from "phaser";

export type MiniGameKey = "chef" | "paint" | "claw" | "count" | "memory" | "soccer" | "dog";

export interface InputController {
  x: number;
  y: number;
  action: boolean;
  consumeActionPress: () => boolean;
}

export interface ContestantConfig {
  id: number;
  name: string;
  sprite: string;
  color: number;
  uiColor: string;
  isHuman: boolean;
  skillLabel?: string;
}

export interface Contestant extends ContestantConfig {
  x: number;
  y: number;
  vx: number;
  vy: number;
  crowns: number;
  roundScore: number;
  totalScore: number;
  difficulty: number;
  mistakeRate: number;
  reactionMs: number;
  carrying?: Ingredient;
  carryingPearl?: Pearl;
  targetX: number;
  targetY: number;
  aiThinkMs: number;
  actionCooldownMs: number;
  stunnedMs: number;
  finishMs?: number;
  brushX: number;
  brushY: number;
  coveredNodes: Set<number>;
  paintAccumulator: number;
  paintPenalty: number;
  paintShapeIndex: number;
  countGuess: number;
  countLocked: boolean;
  alive: boolean;
}

export interface Ingredient {
  id: number;
  x: number;
  y: number;
  color: number;
  label?: string;
  carriedBy?: number;
}

export interface Pearl {
  id: number;
  x: number;
  y: number;
  color: number;
  carriedBy?: number;
  opened?: boolean;
}

export interface PaintBoard {
  x: number;
  y: number;
  w: number;
  h: number;
  shapeIndex: number;
  nodes: Phaser.Math.Vector2[];
}

export interface MiniGameDefinition {
  key: MiniGameKey;
  name: string;
  objective: string;
  durationMs: number;
}
