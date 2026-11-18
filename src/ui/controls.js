

import { clamp } from "../lib/math.js";

/**
 * Reads the on-screen stick and action button, and the keyboard as a fallback.
 * @returns {import("../game/types.js").InputController}
 */
export function createInputController() {
  const stick = /** @type {HTMLDivElement | null} */ (document.querySelector("#stick"));
  const thumb = /** @type {HTMLDivElement | null} */ (document.querySelector("#stick-thumb"));
  const actionButton = /** @type {HTMLButtonElement | null} */ (document.querySelector("#action-button"));
  /** @type {Record<string, boolean>} */
  const keys = {};
  /** @type {number | null} */
  let stickPointerId = null;
  let originX = 0;
  let originY = 0;
  let stickX = 0;
  let stickY = 0;
  let action = false;
  let actionPressed = false;

  /** @type {import("../game/types.js").InputController} */
  const state = {
    get x() {
      const keyboardX = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0);
      return clamp(stickX + keyboardX, -1, 1);
    },
    get y() {
      const keyboardY = (keys.arrowdown || keys.s ? 1 : 0) - (keys.arrowup || keys.w ? 1 : 0);
      return clamp(stickY + keyboardY, -1, 1);
    },
    get action() {
      return action || keys[" "] || keys.enter;
    },
    consumeActionPress() {
      if (actionPressed) {
        actionPressed = false;
        return true;
      }
      return false;
    },
  };

  const setStick = (/** @type {number} */ clientX, /** @type {number} */ clientY) => {
    const maxRadius = 46;
    const dx = clientX - originX;
    const dy = clientY - originY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxRadius ? maxRadius / distance : 1;
    const px = dx * scale;
    const py = dy * scale;
    stickX = px / maxRadius;
    stickY = py / maxRadius;
    if (thumb) {
      thumb.style.transform = `translate(${px}px, ${py}px)`;
    }
  };

  const releaseStick = () => {
    stickPointerId = null;
    stickX = 0;
    stickY = 0;
    if (thumb) {
      thumb.style.transform = "translate(0, 0)";
    }
  };

  stick?.addEventListener("pointerdown", (event) => {
    stickPointerId = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    const rect = stick.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    setStick(event.clientX, event.clientY);
  });

  stick?.addEventListener("pointermove", (event) => {
    if (stickPointerId !== event.pointerId) {
      return;
    }
    setStick(event.clientX, event.clientY);
  });

  stick?.addEventListener("pointerup", releaseStick);
  stick?.addEventListener("pointercancel", releaseStick);

  const pressAction = () => {
    if (!action) {
      actionPressed = true;
    }
    action = true;
  };
  const releaseAction = () => {
    action = false;
  };

  actionButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    actionButton.setPointerCapture(event.pointerId);
    pressAction();
  });
  actionButton?.addEventListener("pointerup", releaseAction);
  actionButton?.addEventListener("pointercancel", releaseAction);
  actionButton?.addEventListener("lostpointercapture", releaseAction);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " ", "enter"].includes(key)) {
      event.preventDefault();
      if ((key === " " || key === "enter") && !keys[key]) {
        actionPressed = true;
      }
      keys[key] = true;
    }
  });

  window.addEventListener("keyup", (event) => {
    keys[event.key.toLowerCase()] = false;
  });

  return state;
}
