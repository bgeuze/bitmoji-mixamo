// The demo video: the demo lens on the local test rig with the test clip set, a finger tapping
// through the buttons, stepped frame by frame (smooth whatever the machine), muted and headless.
//   node scripts/make-test-clips.mjs && (cd demo && npm run build) && node scripts/capture-video.mjs
//   -> media/demo.mp4 (for sharing) and media/demo.gif (for the README)
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { serve, chromium } from "./serve.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const WORK = `${ROOT}scripts/.work/video`;
const FIXTURE = new URL("../../top-bins/scripts/rig/.work/bitmoji.glb", import.meta.url).pathname;
if (!existsSync(`${ROOT}demo/dist/animations.glb`)) throw new Error("build the demo with the test clips first (see the header)");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const FPS = 30;
// [button, seconds on it]
const SCRIPT = [["idle", 1.6], ["wave", 2.2], ["cheer", 2.4], ["jump", 3.3], ["dive", 3.6], ["clap", 1.8], ["victory", 3.2], ["stock_run", 2.0], ["defeated", 3.2]];

const { server, url } = await serve({ "/fixture.glb": FIXTURE, "/": `${ROOT}demo/dist` });
const browser = await chromium();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${url}/index.html?bitmoji=./fixture.glb`);
await page.waitForFunction(() => window.bitmoji, null, { timeout: 60000 });
// Time stands still unless we step it; a finger dot and a caption where Snapchat's own band would be.
await page.evaluate(() => {
  window.bitmoji.app.timeScale = 0;
  const dot = document.createElement("div");
  dot.id = "finger";
  dot.style.cssText = "position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid rgba(27,30,58,.55);pointer-events:none;opacity:0;z-index:9";
  document.body.appendChild(dot);
  const cap = document.createElement("div");
  cap.style.cssText = "position:fixed;left:0;right:0;bottom:5vh;text-align:center;font:600 15px system-ui,sans-serif;color:#1b1e3a;opacity:.7";
  cap.textContent = "Mixamo clips on the player's 3D Bitmoji · github.com/bgeuze/bitmoji-mixamo";
  document.body.appendChild(cap);
});
const step = (dt) => page.evaluate((dt) => new Promise((r) => { window.bitmoji.app.fire("update", dt); requestAnimationFrame(() => requestAnimationFrame(r)); }), dt);
let f = 0;
const frame = async (dt) => { await step(dt); await page.screenshot({ path: `${WORK}/f${String(f++).padStart(4, "0")}.png` }); };

for (const [name, secs] of SCRIPT) {
  const box = await page.locator(`#clips button`).filter({ hasText: new RegExp(`^${name.replace(/_/g, " ")}`) }).first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const n = Math.round(secs * FPS);
  for (let i = 0; i < n; i++) {
    if (i === 6) await page.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y })), [x, y]);
    // The finger: in for 6 frames, the tap, out over 8.
    const a = i < 6 ? i / 6 : i < 14 ? 1 - (i - 6) / 8 : 0;
    await page.evaluate(([x, y, a, s]) => { const d = document.getElementById("finger"); d.style.left = x + "px"; d.style.top = y + "px"; d.style.opacity = a; d.style.transform = `scale(${s})`; }, [x, y, a, i < 6 ? 1.3 - 0.05 * i : 1]);
    await frame(1 / FPS);
  }
}
await browser.close();
server.close();
console.log(`${f} frames`);

execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${WORK}/f%04d.png`, "-vf", "scale=720:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", `${ROOT}media/demo.mp4`]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${WORK}/f%04d.png`, "-vf", "fps=12,scale=270:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", `${ROOT}media/demo.gif`]);
console.log("wrote media/demo.mp4 and media/demo.gif");
