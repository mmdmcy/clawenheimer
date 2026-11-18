// The frame loop, a clock with delayed calls, and a canvas that fills its
// parent element and follows the device pixel ratio.

/**
 * Game time and calls that run after a delay of game time.
 */
export class Clock {
  constructor() {
    /** Time of the current frame, in ms. */
    this.now = 0;
    /** @type {Array<{ elapsed: number, delay: number, callback: () => void }>} */
    this.timers = [];
  }

  /**
   * Runs `callback` once, `delay` ms of game time from now.
   * @param {number} delay
   * @param {() => void} callback
   */
  delayedCall(delay, callback) {
    this.timers.push({ elapsed: 0, delay, callback });
  }

  /** @param {number} time @param {number} deltaMs */
  tick(time, deltaMs) {
    this.now = time;
    /** @type {typeof this.timers} */
    const due = [];
    for (const timer of this.timers) {
      timer.elapsed += deltaMs;
      if (timer.elapsed >= timer.delay) {
        due.push(timer);
      }
    }
    if (due.length > 0) {
      this.timers = this.timers.filter((timer) => !due.includes(timer));
      for (const timer of due) {
        timer.callback();
      }
    }
  }
}

/**
 * Calls `step(time, deltaMs)` once per display frame with the real time since
 * the last frame, so the game runs at the same speed at 60 or 120 Hz. A gap
 * longer than 200 ms (a hidden tab, a stall) counts as one ordinary frame.
 * @param {(time: number, deltaMs: number) => void} step
 */
export function startLoop(step) {
  let last = performance.now();
  let lastSane = 1000 / 60;
  /** @param {number} time */
  const frame = (time) => {
    let delta = Math.max(0, time - last);
    last = time;
    if (delta > 200) {
      delta = lastSane;
    } else {
      lastSane = delta;
    }
    step(time, delta);
    requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      last = performance.now();
    }
  });
  requestAnimationFrame(frame);
}

/**
 * A canvas that fills `parent`. Its backing store has device pixels; draw in
 * CSS pixels. Call `fit()` once per frame: it resizes the canvas when the
 * parent's size or the device pixel ratio changed, and returns true then.
 * @param {HTMLElement} parent
 */
export function createViewport(parent) {
  const canvas = document.createElement("canvas");
  parent.append(canvas);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { alpha: false }));
  const view = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    fit() {
      const width = Math.max(1, parent.clientWidth || window.innerWidth);
      const height = Math.max(1, parent.clientHeight || window.innerHeight);
      const dpr = window.devicePixelRatio || 1;
      if (width === view.width && height === view.height && dpr === view.dpr) {
        return false;
      }
      view.width = width;
      view.height = height;
      view.dpr = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      return true;
    },
    /** Clears to `color` and sets the transform to CSS pixels. */
    begin(/** @type {string} */ color) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    },
  };
  view.fit();
  return view;
}
