// The demo lens, built, headless and muted, in a phone-sized Chromium:
//  1. with a Bitmoji GLB (?bitmoji=, the local test rig): both sample clips, a tap between them;
//  2. with no avatar at all (the desktop stub and no fallback): the page says so instead of failing.
import { existsSync, mkdirSync } from "node:fs";
import { serve, chromium } from "./serve.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = `${ROOT}scripts/.work`;
const FIXTURE = new URL("../../top-bins/scripts/rig/.work/bitmoji.glb", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
if (!existsSync(`${ROOT}demo/dist/index.html`)) throw new Error("build the demo first: cd demo && npm run build");
const { server, url } = await serve({ "/fixture.glb": FIXTURE, "/": `${ROOT}demo/dist` });
const browser = await chromium();
let failed = false;

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("page error:", e.message); failed = true; });
await page.goto(`${url}/index.html?bitmoji=./fixture.glb`);
await page.waitForFunction(() => window.bitmoji, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/demo-idle.png` });
const s1 = await page.evaluate(() => ({ clips: bitmoji.clips, current: bitmoji.current, real: bitmoji.isReal, mode: bitmoji.mode, found: bitmoji.found }));
// A loop by its button, then a one-shot by its button, which must hand back to idle at its end.
await page.click("#clips button:text-is('wave')");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/demo-wave.png` });
const s2 = await page.evaluate(() => ({ current: bitmoji.current, hand: bitmoji.joint("RightHand").getPosition().y, head: bitmoji.joint("Head").getPosition().y }));
let s3 = null;
if (s1.clips.includes("jump")) {
  await page.click("#clips button:has-text('jump')");
  await page.waitForTimeout(300);
  const during = await page.evaluate(() => bitmoji.current);
  await page.waitForTimeout(3200);
  s3 = { during, after: await page.evaluate(() => bitmoji.current) };
}
console.log("with avatar:", JSON.stringify(s1), "wave:", JSON.stringify(s2), "jump:", JSON.stringify(s3));
if (s1.current !== (s1.clips.includes("idle") ? "idle" : s1.clips[0]) || s2.current !== "wave" || !(s2.hand > s2.head - 0.15) || (s3 && (s3.during !== "jump" || s3.after !== "idle"))) { console.log("FAIL: clips did not play as expected"); failed = true; }
// Every clip at 40% of its length, one frame each, for a contact sheet.
await page.evaluate(() => { bitmoji.app.timeScale = 0; });
for (const [i, name] of s1.clips.entries()) {
  await page.evaluate((n) => { bitmoji.play(n, { fade: 0 }); bitmoji.update(bitmoji._clips.get(n).length * 0.4); document.getElementById("status").innerHTML = "<b>" + n + "</b>"; }, name);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/sheet-${String(i).padStart(2, "0")}.png`, clip: { x: 0, y: 0, width: 390, height: 560 } });
}
await ctx.close();

const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
p2.on("pageerror", (e) => { console.log("page error:", e.message); failed = true; });
await p2.goto(`${url}/index.html`);
await p2.waitForFunction(() => /No avatar|joints by/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
console.log("no avatar:", await p2.textContent("#status"));
await ctx2.close();

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
