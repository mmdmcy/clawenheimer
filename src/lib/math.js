// Small number helpers. `between`, `floatBetween`, `shuffle` and `lerp` give
// the same results as the Phaser functions the game used before.

/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** @param {number} ax @param {number} ay @param {number} bx @param {number} by */
export const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** A whole number from min to max, both included. */
export const between = (/** @type {number} */ min, /** @type {number} */ max) =>
  Math.floor(Math.random() * (max - min + 1) + min);

/** A number from min up to max. */
export const floatBetween = (/** @type {number} */ min, /** @type {number} */ max) =>
  Math.random() * (max - min) + min;

/** Linear interpolation from a (t = 0) to b (t = 1). */
export const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => (b - a) * t + a;

/**
 * Shuffles an array in place (Fisher-Yates) and returns it.
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
