// Shared shapes, as JSDoc types. This module exports nothing at run time;
// other modules refer to these with `import("../game/types.js").Name`.

/** @typedef {"chef" | "paint" | "claw" | "count" | "memory" | "soccer" | "dog"} MiniGameKey */

/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} InputController
 * @property {number} x - stick or keys, -1 (left) to 1 (right)
 * @property {number} y - stick or keys, -1 (up) to 1 (down)
 * @property {boolean} action - the action button or Space/Enter is held
 * @property {() => boolean} consumeActionPress - true once per press
 */

/**
 * @typedef {object} ContestantConfig
 * @property {number} id
 * @property {string} name
 * @property {string} sprite
 * @property {number} color - 0xRRGGBB
 * @property {string} uiColor - CSS colour
 * @property {boolean} isHuman
 * @property {string} [skillLabel]
 */

/**
 * @typedef {ContestantConfig & {
 *   x: number, y: number, vx: number, vy: number,
 *   crowns: number, roundScore: number, totalScore: number,
 *   difficulty: number, mistakeRate: number, reactionMs: number,
 *   carrying?: Ingredient, carryingPearl?: Pearl,
 *   targetX: number, targetY: number, aiThinkMs: number,
 *   actionCooldownMs: number, stunnedMs: number, finishMs?: number,
 *   brushX: number, brushY: number, coveredNodes: Set<number>,
 *   paintAccumulator: number, paintPenalty: number, paintShapeIndex: number,
 *   countGuess: number, countLocked: boolean, alive: boolean,
 * }} Contestant
 */

/**
 * @typedef {object} Ingredient
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} color
 * @property {string} [label]
 * @property {number} [carriedBy]
 */

/**
 * @typedef {object} Pearl
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} color
 * @property {number} [carriedBy]
 * @property {boolean} [opened]
 */

/**
 * @typedef {object} PaintBoard
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} shapeIndex
 * @property {Point[]} nodes
 */

/**
 * @typedef {object} MiniGameDefinition
 * @property {MiniGameKey} key
 * @property {string} name
 * @property {string} objective
 * @property {number} durationMs
 */

export {};
