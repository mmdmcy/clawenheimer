import { createViewport, startLoop } from "./lib/loop.js";
import { ClawpartyScene } from "./scenes/ClawpartyScene.js";
import { createInputController } from "./ui/controls.js";

const input = createInputController();
const root = /** @type {HTMLElement} */ (document.querySelector("#game-root"));
const scene = new ClawpartyScene(input, createViewport(root));

await scene.preload();
scene.create();
startLoop((time, deltaMs) => scene.step(time, deltaMs));
