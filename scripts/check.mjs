// The numeric check: clips converted from Mixamo FBX, played by bitmoji-anim.js on Snap's
// rig, against top-bins' proven path (the same FBX through Blender, local rotations copied).
// Needs top-bins' local test rig and the FBX it was built from; neither ships with this repo.
// Every rig joint's position is compared, in cm, over each whole clip.
//   node scripts/check.mjs [slug ...]       (FBX from ~/Downloads/top-bins-mixamo)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { convertFbx, writeGlb } from "../converter/convert.js";
import { serve, chromium } from "./serve.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const TB = new URL("../../top-bins/scripts/rig/.work/", import.meta.url).pathname;
const FBX = `${homedir()}/Downloads/top-bins-mixamo`;
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ["idle", "cheer", "shot", "jump", "gk_dive_l", "victory", "run", "tackle"];
if (!existsSync(`${TB}/bitmoji.glb`)) throw new Error("needs top-bins/scripts/rig/.work/bitmoji.glb (scripts/rig/convert.py there)");

mkdirSync(`${ROOT}scripts/.work`, { recursive: true });
const clips = slugs.map((s) => convertFbx(readFileSync(`${FBX}/${s}.fbx`), { name: s }));
writeFileSync(`${ROOT}scripts/.work/ours.glb`, writeGlb(clips));

// The rig with every node renamed (the GLB's JSON only): the phone's avatar does not spell its joints as the FBX does.
{
  const buf = readFileSync(`${TB}bitmoji.glb`);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString("utf8"));
  json.nodes.forEach((n, i) => { if (n.name && !n.mesh) n.name = `node_${(i * 7919) % 1000}`; });
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jl);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8);
  head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(`${ROOT}scripts/.work/scrambled.glb`, Buffer.concat([head, js, rest]));
}

const page = `<!doctype html><script type=importmap>{"imports":{"playcanvas":"/pc.mjs"}}</script><canvas id=c width=64 height=64></canvas><script type=module>
import * as pc from "/pc.mjs";
import { loadBitmoji } from "/bitmoji-anim.js";
const app = new pc.Application(document.getElementById("c"), {});
app.start();
const slugs = ${JSON.stringify(slugs)};
const names = ${JSON.stringify(["Hips","Spine","Spine1","Neck","Head","LeftShoulder","LeftArm","LeftForeArm","LeftHand","RightShoulder","RightArm","RightForeArm","RightHand","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"])};

// The avatar as the published rig names it, and as one whose names say nothing (the phone's case).
const byName = await loadBitmoji(app, { url: "/fixture/bitmoji.glb", clips: "/ours.glb", autoUpdate: false });
const scrambled = await loadBitmoji(app, { url: "/fixture/scrambled.glb", clips: "/ours.glb", autoUpdate: false });

// The truth: top-bins' Blender clips, local rotations and the hips' translation copied straight onto the rig.
const asset = new pc.Asset("truth", "container", { url: "/fixture/bitmoji.glb" });
await new Promise((r) => { asset.ready(r); app.assets.add(asset); app.assets.load(asset); });
const truthPivot = new pc.Entity(); const truthModel = asset.resource.instantiateRenderEntity(); truthPivot.addChild(truthModel);
const find = (n) => truthModel.findByName(n);
async function truthClip(s) {
  const buf = await (await fetch("/truth/" + s + ".glb")).arrayBuffer();
  const dv = new DataView(buf), jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bin = 20 + jl + 8;
  const acc = (i) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = a.count * { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]; return new Float32Array(buf.slice(bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + n * 4)); };
  const anim = json.animations[0], tracks = [];
  let t0 = Infinity;
  for (const ch of anim.channels) {
    if (ch.target.path === "scale") continue;
    const name = json.nodes[ch.target.node].name;
    if (ch.target.path === "translation" && name !== "Hips") continue;
    const node = find(name); if (!node) continue;
    const sm = anim.samplers[ch.sampler], times = acc(sm.input);
    t0 = Math.min(t0, times[0]);
    tracks.push({ node, path: ch.target.path, times, values: acc(sm.output) });
  }
  return (t) => {
    for (const tr of tracks) {
      const w = tr.path === "rotation" ? 4 : 3, ts = tr.times, tt = t + t0;
      let i = 0; while (i < ts.length - 2 && ts[i + 1] <= tt) i++;
      const u = Math.max(0, Math.min(1, (tt - ts[i]) / ((ts[i + 1] ?? ts[i]) - ts[i] || 1)));
      const j = Math.min(ts.length - 1, i + 1), v = tr.values, o = [];
      for (let c = 0; c < w; c++) o.push(v[i * w + c] + (v[j * w + c] - v[i * w + c]) * u);
      if (w === 4) tr.node.setLocalRotation(new pc.Quat(...o).normalize()); else tr.node.setLocalPosition(...o);
    }
  };
}

if (location.search.includes("debug")) {
  const pose = await truthClip("${slugs[0]}");
  const inv = byName.entity.getWorldTransform().clone().invert();
  const P = (n) => new pc.Mat4().mul2(inv, n.getWorldTransform()).getTranslation();
  console.log(["Hips","C_pelvis0001_bind_JNT","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase"].map((j) => j + " " + P(byName.joint(j) ?? find(j)).toString()).join(" | "));
  console.log("A " + byName._retarget.A.toString() + " hipsXf " + Array.from(byName._retarget.hipsXf.data).map((x) => x.toFixed(4)).join(","));
  for (const t of [0, 0.5]) {
    for (const b of [byName, scrambled]) {
      b.play("${slugs[0]}", { fade: 0, loop: false }); b.update(t); pose(t);
      console.log(b.mode + " t=" + t + " " + names.map((j) => j + ":" + (b.joint(j).getPosition().distance(find(j).getPosition()) * 100).toFixed(1)).join(" "));
    }
    console.log("scrambled map: " + ${JSON.stringify(["Hips","Spine","C_spine0002_bind_JNT","Spine1","Neck","C_neck0002_bind_JNT","Head","LeftShoulder","LeftArm","LeftForeArm","LeftHand","RightShoulder","RightArm","RightForeArm","RightHand","C_pelvis0001_bind_JNT","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightUpLeg","RightLeg","RightFoot","RightToeBase"])}.map((j, i) => j + "=" + (scrambled._joints[i] ? "y" : "-")).join(" "));
    const a = byName.joint("Hips").getPosition(), b = find("Hips").getPosition();
    console.log("hips ours " + a.toString() + " truth " + b.toString());
  }
}
const out = { modes: byName.mode + " / " + scrambled.mode + " (" + scrambled.found + " joints)" };
for (const s of slugs) {
  const pose = await truthClip(s);
  const r = {};
  for (const [label, b] of [["byName", byName], ["scrambled", scrambled]]) {
    let worst = 0, sum = 0, n = 0;
    const len = b._clips.get(s).length;
    for (let t = 0; t <= len; t += 0.1) {
      b.play(s, { fade: 0, loop: false }); b.update(t);
      pose(t);
      for (const j of names) {
        const d = b.joint(j).getPosition().distance(find(j).getPosition()) * 100;
        sum += d; n++; worst = Math.max(worst, d);
      }
    }
    r[label + "Worst"] = +worst.toFixed(2); r[label + "Mean"] = +(sum / n).toFixed(3);
  }
  out[s] = r;
}
window.result = out;
</script>`;

const { server, url } = await serve({
  "/check.html": () => page,
  "/pc.mjs": `${ROOT}node_modules/playcanvas/build/playcanvas.mjs`,
  "/bitmoji-anim.js": `${ROOT}bitmoji-anim.js`,
  "/fixture/bitmoji.glb": `${TB}bitmoji.glb`,
  "/fixture/scrambled.glb": `${ROOT}scripts/.work/scrambled.glb`,
  "/truth/": `${TB}clips`,
  "/ours.glb": `${ROOT}scripts/.work/ours.glb`,
});
const browser = await chromium();
const p = await browser.newPage();
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning" || (process.env.DEBUG && m.type() === "log")) console.log("page:", m.text()); });
p.on("pageerror", (e) => console.log("page error:", e.message));
await p.goto(`${url}/check.html${process.env.DEBUG ? "?debug" : ""}`);
const result = await p.waitForFunction(() => window.result, null, { timeout: 60000 }).then((h) => h.jsonValue());
await browser.close();
server.close();
console.log("joints found:", result.modes);
delete result.modes;
console.table(result);
// The bar. By name: under 3 cm anywhere, 0.5 cm on average (the toes sit ~1.8 cm off: each bone
// starts from the rig's T-pose as Mixamo hands it back, whose feet are proportioned a little
// differently). By shape: under 6 cm, 1 cm on average (a helper joint the shape cannot tell apart
// leaves the head's pivot ~5 cm low).
const bad = Object.values(result).filter((r) => r.byNameWorst >= 3 || r.byNameMean >= 0.5 || r.scrambledWorst >= 6 || r.scrambledMean >= 1);
process.exit(bad.length ? 1 : 0);
