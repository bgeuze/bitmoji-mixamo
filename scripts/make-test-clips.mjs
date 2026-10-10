// A test set of real Mixamo clips for the demo, for checking on a phone: clips made on Snap's rig
// (top-bins' downloads) and clips from a stock Mixamo character (retargeted). Never committed:
// demo/public/animations.glb is in .gitignore (Mixamo's terms forbid redistributing the files).
//   node scripts/make-test-clips.mjs   -> demo/public/animations.glb
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { convertFbx, writeGlb } from "../converter/convert.js";

const TB = `${homedir()}/Downloads/top-bins-mixamo`, DL = `${homedir()}/Downloads`;
// [name, file, loop]
const SET = [
  ["idle", `${TB}/idle.fbx`, true], ["cheer", `${TB}/cheer.fbx`, true], ["clap", `${TB}/clap.fbx`, true],
  ["excited", `${TB}/excited.fbx`, false], ["victory", `${TB}/victory.fbx`, false], ["defeated", `${TB}/defeated.fbx`, false],
  ["disappointed", `${TB}/disappointed.fbx`, false], ["jump", `${TB}/jump.fbx`, false], ["shot", `${TB}/shot.fbx`, false],
  ["header", `${TB}/header_inplace.fbx`, false], ["tackle", `${TB}/tackle.fbx`, false], ["dive", `${TB}/gk_dive_l.fbx`, false],
  ["jog", `${TB}/jog.fbx`, true], ["run", `${TB}/run.fbx`, true],
  ["stock_idle", `${DL}/Idle.fbx`, true], ["stock_walk", `${DL}/Walking.fbx`, true], ["stock_run", `${DL}/Running.fbx`, true],
];
const clips = [];
for (const [name, file, loop] of SET) {
  if (!existsSync(file)) { console.log(`skip ${name}: ${file} missing`); continue; }
  const c = convertFbx(readFileSync(file), { name, loop, fps: 20 });
  console.log(`${name.padEnd(14)} ${c.report.duration.toFixed(1).padStart(5)} s  ${c.report.source}`);
  clips.push(c);
}
const glb = writeGlb(clips);
writeFileSync(new URL("../demo/public/animations.glb", import.meta.url), glb);
console.log(`wrote demo/public/animations.glb, ${clips.length} clips, ${(glb.byteLength / 1024).toFixed(0)} KB`);
