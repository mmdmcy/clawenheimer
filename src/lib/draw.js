// Drawing helpers for the browser's 2D canvas: colours, a recorded list of
// shapes (Gfx), text with an outline (Label), and images with an optional tint.
// Every coordinate is in CSS pixels; the canvas context carries the device
// pixel ratio as its transform.

/**
 * A 0xRRGGBB colour as a CSS colour.
 * @param {number} color
 * @param {number} [alpha]
 */
export function cssColor(color, alpha = 1) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.max(0, alpha)})`;
}

/**
 * A list of shapes recorded during a frame's update and drawn later, so that
 * layers can be drawn in a fixed order whatever order the game logic ran in.
 * Rectangles snap to whole device pixels, as the old WebGL renderer drew them
 * without anti-aliasing.
 */
export class Gfx {
  constructor() {
    /** @type {Array<(ctx: CanvasRenderingContext2D, dpr: number, ox: number, oy: number) => void>} */
    this.ops = [];
    this.fill = "#000";
    this.stroke = "#000";
    this.lineWidth = 1;
    /** @type {Array<[number, number]>} */
    this.path = [];
  }

  clear() {
    this.ops.length = 0;
    this.path = [];
    return this;
  }

  /** @param {number} color @param {number} [alpha] */
  fillStyle(color, alpha = 1) {
    this.fill = cssColor(color, alpha);
    return this;
  }

  /** @param {number} width @param {number} color @param {number} [alpha] */
  lineStyle(width, color, alpha = 1) {
    this.lineWidth = width;
    this.stroke = cssColor(color, alpha);
    return this;
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  fillRect(x, y, w, h) {
    this.#rect(this.fill, x, y, w, h);
    return this;
  }

  /** The outline is four bars centred on the edges; the top and bottom bars reach over the corners. */
  strokeRect(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) {
    const half = this.lineWidth / 2;
    const style = this.stroke;
    this.#rect(style, x - half, y, this.lineWidth, h);
    this.#rect(style, x + w - half, y, this.lineWidth, h);
    this.#rect(style, x - half, y - half, w + this.lineWidth, this.lineWidth);
    this.#rect(style, x - half, y + h - half, w + this.lineWidth, this.lineWidth);
    return this;
  }

  /** @param {number} x @param {number} y @param {number} radius */
  strokeCircle(x, y, radius) {
    const style = this.stroke;
    const width = this.lineWidth;
    this.ops.push((ctx, _dpr, ox, oy) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(ox + x, oy + y, Math.max(0, radius), 0, Math.PI * 2);
      ctx.stroke();
    });
    return this;
  }

  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  lineBetween(x1, y1, x2, y2) {
    const half = this.lineWidth / 2;
    if (y1 === y2) {
      this.#rect(this.stroke, Math.min(x1, x2), y1 - half, Math.abs(x2 - x1), this.lineWidth);
      return this;
    }
    if (x1 === x2) {
      this.#rect(this.stroke, x1 - half, Math.min(y1, y2), this.lineWidth, Math.abs(y2 - y1));
      return this;
    }
    this.beginPath();
    this.moveTo(x1, y1);
    this.lineTo(x2, y2);
    return this.strokePath();
  }

  beginPath() {
    this.path = [];
    return this;
  }

  /** @param {number} x @param {number} y */
  moveTo(x, y) {
    this.path.push([x, y]);
    return this;
  }

  /** @param {number} x @param {number} y */
  lineTo(x, y) {
    this.path.push([x, y]);
    return this;
  }

  strokePath() {
    const points = this.path;
    const style = this.stroke;
    const width = this.lineWidth;
    this.path = [];
    if (points.length < 2) {
      return this;
    }
    this.ops.push((ctx, _dpr, ox, oy) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.beginPath();
      ctx.moveTo(ox + points[0][0], oy + points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(ox + points[i][0], oy + points[i][1]);
      }
      ctx.stroke();
    });
    return this;
  }

  /** @param {number} x centre @param {number} y centre @param {number} w @param {number} h */
  fillEllipse(x, y, w, h) {
    const style = this.fill;
    this.ops.push((ctx, _dpr, ox, oy) => {
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.ellipse(ox + x, oy + y, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    return this;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dpr
   * @param {number} [ox] offset x
   * @param {number} [oy] offset y
   */
  draw(ctx, dpr, ox = 0, oy = 0) {
    for (const op of this.ops) {
      op(ctx, dpr, ox, oy);
    }
  }

  /** @param {string} style @param {number} x @param {number} y @param {number} w @param {number} h */
  #rect(style, x, y, w, h) {
    this.ops.push((ctx, dpr, ox, oy) => {
      const x0 = Math.round((ox + Math.min(x, x + w)) * dpr);
      const x1 = Math.round((ox + Math.max(x, x + w)) * dpr);
      const y0 = Math.round((oy + Math.min(y, y + h)) * dpr);
      const y1 = Math.round((oy + Math.max(y, y + h)) * dpr);
      if (x1 > x0 && y1 > y0) {
        ctx.fillStyle = style;
        ctx.fillRect(x0 / dpr, y0 / dpr, (x1 - x0) / dpr, (y1 - y0) / dpr);
      }
    });
  }
}

/** @type {Map<string, { ascent: number, descent: number }>} */
const fontMetrics = new Map();

/**
 * @typedef {object} LabelStyle
 * @property {number} fontSize - in px
 * @property {string} color
 * @property {string} stroke
 * @property {number} strokeThickness
 * @property {"left" | "center"} [align]
 * @property {number} [wrapWidth] - wrap lines longer than this, in px
 */

/**
 * Outlined monospace text, laid out the way the game's text looked before:
 * the box is as wide as the widest line plus the outline, and as tall as
 * each line's ascent, descent and outline; the origin is a fraction of that box.
 */
export class Label {
  /**
   * @param {LabelStyle} style
   * @param {number} [originX]
   * @param {number} [originY]
   */
  constructor(style, originX = 0.5, originY = 0.5) {
    this.style = style;
    this.font = `${style.fontSize}px monospace`;
    this.originX = originX;
    this.originY = originY;
    this.text = "";
    this.x = 0;
    this.y = 0;
    this.visible = true;
    /** @type {{ lines: string[], widths: number[], width: number, lineHeight: number, ascent: number } | null} */
    this.layout = null;
  }

  /** @param {string} text */
  setText(text) {
    if (text !== this.text) {
      this.text = text;
      this.layout = null;
    }
    return this;
  }

  /** @param {number} x @param {number} y */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.visible = visible;
    return this;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [ox] offset x
   * @param {number} [oy] offset y
   */
  draw(ctx, ox = 0, oy = 0) {
    if (!this.visible || this.text === "") {
      return;
    }
    const style = this.style;
    const stroke = style.strokeThickness;
    ctx.font = this.font;
    const layout = (this.layout ??= this.#layout(ctx));
    const height = layout.lineHeight * layout.lines.length;
    const left = Math.round(ox + this.x - layout.width * this.originX);
    const top = Math.round(oy + this.y - height * this.originY);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.lineWidth = stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = style.stroke;
    ctx.fillStyle = style.color;
    layout.lines.forEach((line, i) => {
      let x = stroke / 2;
      if (style.align === "center") {
        x += (layout.width - layout.widths[i]) / 2;
      }
      const y = stroke / 2 + i * layout.lineHeight + layout.ascent;
      const lx = left + Math.round(x);
      const ly = top + Math.round(y);
      if (stroke) {
        ctx.strokeText(line, lx, ly);
      }
      ctx.fillText(line, lx, ly);
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  #layout(ctx) {
    let metrics = fontMetrics.get(this.font);
    if (!metrics) {
      const m = ctx.measureText("|MÉqgy");
      metrics = { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
      fontMetrics.set(this.font, metrics);
    }
    const stroke = this.style.strokeThickness;
    const lines = this.style.wrapWidth ? wordWrap(ctx, this.text, this.style.wrapWidth) : this.text.split(/\r\n|\r|\n/);
    const widths = lines.map((line) => Math.ceil(stroke + ctx.measureText(line).width));
    return {
      lines,
      widths,
      width: Math.max(0, ...widths),
      lineHeight: metrics.ascent + metrics.descent + stroke,
      ascent: metrics.ascent,
    };
  }
}

/**
 * Breaks text into lines no wider than `width`, splitting a word only when it
 * does not fit on a line by itself.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} width
 */
function wordWrap(ctx, text, width) {
  const input = text.replace(/ +/g, " ").split(/\r\n|\r|\n/);
  const output = [];
  for (let i = 0; i < input.length; i += 1) {
    const line = input[i].replace(/^ *|\s*$/g, "");
    if (ctx.measureText(line).width < width) {
      output.push(line);
      continue;
    }
    let out = "";
    let room = width;
    const words = line.split(" ");
    for (let j = 0; j < words.length; j += 1) {
      const withSpace = `${words[j]} `;
      const wordWidth = ctx.measureText(withSpace).width;
      if (wordWidth <= room) {
        out += withSpace;
        room -= wordWidth;
        continue;
      }
      if (j === 0) {
        let piece = withSpace;
        while (piece.length > 1 && ctx.measureText(piece).width > room) {
          piece = piece.slice(0, -1);
        }
        words[j] = words[j].slice(piece.length);
        out += piece;
      }
      const rest = words.slice(words[j].length ? j : j + 1).join(" ").replace(/[ \n]*$/g, "");
      input.splice(i + 1, 0, rest);
      break;
    }
    output.push(out.replace(/[ \n]*$/g, ""));
  }
  while (output.length > 1 && output[output.length - 1] === "") {
    output.pop();
  }
  return output;
}

/**
 * Loads images by name.
 * @param {Record<string, string>} sources - name to URL
 * @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function loadImages(sources) {
  const entries = await Promise.all(
    Object.entries(sources).map(
      ([name, url]) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve([name, image]);
          image.onerror = () => reject(new Error(`could not load ${url}`));
          image.src = url;
        }),
    ),
  );
  return new Map(/** @type {Array<[string, HTMLImageElement]>} */ (entries));
}

/** @type {WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>} */
const tinted = new WeakMap();

/**
 * The image with every pixel's colour multiplied by `tint`, its transparency kept.
 * @param {HTMLImageElement} image
 * @param {number} tint - 0xRRGGBB
 */
function tintedImage(image, tint) {
  let byTint = tinted.get(image);
  if (!byTint) {
    byTint = new Map();
    tinted.set(image, byTint);
  }
  let canvas = byTint.get(tint);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = cssColor(tint);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    byTint.set(tint, canvas);
  }
  return canvas;
}

/**
 * @typedef {object} SpriteDraw
 * @property {HTMLImageElement} image
 * @property {number} x
 * @property {number} y
 * @property {number} w - drawn width
 * @property {number} h - drawn height
 * @property {number} [originX] - 0 left, 0.5 centre (default)
 * @property {number} [originY]
 * @property {number} [alpha]
 * @property {number} [tint] - 0xRRGGBB
 * @property {number} [frame] - index into a strip of square frames
 * @property {number} [angle] - degrees
 * @property {boolean} [flipX]
 */

/**
 * Draws an image (or one frame of a horizontal strip) at a position.
 * @param {CanvasRenderingContext2D} ctx
 * @param {SpriteDraw} s
 * @param {number} dpr
 */
export function drawSprite(ctx, s, dpr) {
  const source = s.tint === undefined ? s.image : tintedImage(s.image, s.tint);
  const frameSize = s.frame === undefined ? 0 : s.image.naturalHeight;
  const sx = frameSize * (s.frame ?? 0);
  const sw = frameSize || s.image.naturalWidth;
  const sh = s.image.naturalHeight;
  const originX = s.originX ?? 0.5;
  const originY = s.originY ?? 0.5;
  ctx.globalAlpha = s.alpha ?? 1;
  if (s.angle || s.flipX) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(((s.angle ?? 0) * Math.PI) / 180);
    ctx.scale(s.flipX ? -1 : 1, 1);
    ctx.drawImage(source, sx, 0, sw, sh, -s.w * originX, -s.h * originY, s.w, s.h);
    ctx.restore();
  } else {
    const x = Math.round((s.x - s.w * originX) * dpr) / dpr;
    const y = Math.round((s.y - s.h * originY) * dpr) / dpr;
    ctx.drawImage(source, sx, 0, sw, sh, x, y, s.w, s.h);
  }
  ctx.globalAlpha = 1;
}
