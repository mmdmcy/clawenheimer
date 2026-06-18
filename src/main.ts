import Phaser from "phaser";
import "./styles.css";
import { ClawpartyScene } from "./scenes/ClawpartyScene";
import { createInputController } from "./ui/controls";

const input = createInputController();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  backgroundColor: "#050505",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [new ClawpartyScene(input)],
};

const game = new Phaser.Game(config);

if (import.meta.env.DEV) {
  Object.assign(window, { __clawpartyGame: game });
}
