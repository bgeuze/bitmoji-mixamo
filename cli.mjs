#!/usr/bin/env node
// The converter from the command line: Mixamo FBX files -> one animations.glb.
//   node cli.mjs idle.fbx dance.fbx wave.fbx -o animations.glb [--fps 30] [--once wave,jump]
// A clip is named after its file; --once lists clips that play once instead of looping.
// (Mixamo's own messages about texture maps it cannot read are muted: only the skeleton matters.)
const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).startsWith("THREE.FBXLoader")) warn(...a); };
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { convertFbx, writeGlb, safeName } from "./converter/convert.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt("-o", "animations.glb");
const fps = Number(opt("--fps", "30"));
const once = new Set(opt("--once", "").split(",").filter(Boolean).map(safeName));
if (!(fps > 0)) { console.error("--fps needs a number: 30, 20 or 15"); process.exit(1); }
if (!args.length) {
  console.log("usage: node cli.mjs clip.fbx [more.fbx ...] -o animations.glb [--fps 30|20|15] [--once name,name]");
  process.exit(1);
}
const clips = args.map((file) => {
  const name = safeName(basename(file));
  const c = convertFbx(readFileSync(file), { name, fps, loop: !once.has(name) });
  const r = c.report;
  console.log(`${name.padEnd(20)} ${r.duration.toFixed(2).padStart(6)} s  ${r.found}/${r.total} joints  ${r.source === "snap-rig" ? "Snap's rig" : "Mixamo character"}${c.loop ? "" : "  once"}`);
  return c;
});
const glb = writeGlb(clips);
writeFileSync(out, glb);
console.log(`wrote ${out}, ${(glb.byteLength / 1024).toFixed(1)} KB`);
