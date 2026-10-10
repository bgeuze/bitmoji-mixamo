// The converter page, headless and muted: three.js served from node_modules instead of the
// CDN, three FBX files added, a screenshot per theme, and the downloaded .glb compared with
// the one the Node path writes from the same files.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { serve, chromium } from "./serve.mjs";
import { convertFbx, writeGlb } from "../converter/convert.js";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = `${ROOT}scripts/.work`;
mkdirSync(OUT, { recursive: true });
const fbx = (process.argv.slice(2).length ? process.argv.slice(2) : ["idle", "cheer", "shot"].map((s) => `${homedir()}/Downloads/top-bins-mixamo/${s}.fbx`));
const { server, url } = await serve({ "/": `${ROOT}converter` });
const browser = await chromium();
let failed = false;
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1300 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("page error:", e.message); failed = true; });
  await page.route("https://cdn.jsdelivr.net/npm/three@0.186.1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/npm/three@0.186.1/", "");
    route.fulfill({ body: readFileSync(`${ROOT}node_modules/three/${path}`), contentType: "text/javascript" });
  });
  await page.route("https://fonts.**", (r) => r.abort());
  await page.goto(`${url}/index.html`);
  await page.setInputFiles("#file", fbx);
  await page.waitForFunction(() => !document.getElementById("save").disabled, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/converter-${scheme}.png`, fullPage: true });
  if (scheme === "light") {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
    const got = readFileSync(await dl.path());
    const want = writeGlb(fbx.map((f) => convertFbx(readFileSync(f), { name: f.split("/").pop().replace(/\.fbx$/i, "") })));
    const same = got.byteLength === want.byteLength && Buffer.compare(got, Buffer.from(want)) === 0;
    console.log(`download ${dl.suggestedFilename()} ${got.byteLength} bytes, identical to the Node path: ${same}`);
    if (!same) failed = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log("phone width overflows:", wide);
    if (wide) failed = true;
    await page.screenshot({ path: `${OUT}/converter-phone.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log("screenshots in scripts/.work/");
process.exit(failed ? 1 : 0);
