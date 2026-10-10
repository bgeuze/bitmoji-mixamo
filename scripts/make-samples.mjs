// Two hand-made clips for the demo, so it plays without any Mixamo file in this repo:
// "idle" (arms down, breathing) and "wave". Same format as the converter writes.
//   node scripts/make-samples.mjs   -> demo/public/samples.glb
import { writeFileSync } from "node:fs";
import { Quaternion, Vector3 } from "three";
import { writeGlb, JOINTS, PARENT } from "../converter/convert.js";

const NJ = JOINTS.length;
// A plain T-pose of our own, in hip heights: arms straight out along x, legs straight down,
// facing +z. The clips below are turns from it.
const REST = {
  Hips: [0, 1, 0], Spine: [0, 1.04, 0], C_spine0002_bind_JNT: [0, 1.12, 0], Spine1: [0, 1.2, 0], Neck: [0, 1.5, 0],
  C_neck0002_bind_JNT: [0, 1.56, 0], Head: [0, 1.65, 0], C_pelvis0001_bind_JNT: [0, 1, 0],
  LeftShoulder: [0.08, 1.42, 0], LeftArm: [0.22, 1.44, 0], LeftForeArm: [0.52, 1.44, 0], LeftHand: [0.82, 1.44, 0],
  LeftUpLeg: [0.12, 0.9, 0], LeftLeg: [0.12, 0.5, 0], LeftFoot: [0.12, 0.07, 0], LeftToeBase: [0.12, -0.02, 0.18],
};
for (const [n, p] of Object.entries(REST)) if (n.startsWith("Left")) REST[n.replace("Left", "Right")] = [-p[0], p[1], p[2]];
const rest = JOINTS.map((n) => REST[n]);
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const rot = (axis, deg) => new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);

/** extra(t) -> {joint: Quaternion}, each a rotation in character axes on top of its parent's. */
function clip(name, length, fps, extra, bob) {
  const frames = Math.round(length * fps) + 1;
  const r = new Float32Array(frames * NJ * 4), hips = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const t = f / fps, e = extra(t), D = [];
    for (let j = 0; j < NJ; j++) {
      const p = PARENT[j];
      D[j] = (p < 0 ? new Quaternion() : D[p].clone()).multiply(e[JOINTS[j]] ?? new Quaternion()).normalize();
      r.set(D[j].toArray(), (f * NJ + j) * 4);
    }
    hips.set([0, 1 + bob(t), 0], f * 3);
  }
  return { name, fps, loop: true, frames, rot: r, hips, rest };
}

const TAU = Math.PI * 2;
const armsDown = { LeftArm: rot(Z, -74), RightArm: rot(Z, 74), LeftForeArm: rot(Y, -12), RightForeArm: rot(Y, 12) };
const idle = clip("idle", 3, 20, (t) => {
  const s = Math.sin((TAU * t) / 3);
  return { ...armsDown, Spine: rot(X, 2.5 * s), Head: rot(Y, 6 * Math.sin((TAU * t) / 3 + 1)).multiply(rot(X, -2 * s)) };
}, (t) => 0.006 * Math.sin((TAU * t) / 3));
const wave = clip("wave", 2, 30, (t) => {
  const s = Math.sin(TAU * t * 1.5);
  return {
    LeftArm: rot(Z, -74), LeftForeArm: rot(Y, -12),
    Spine: rot(Z, 4),
    RightArm: rot(Z, -22).multiply(rot(Y, 10)),
    // Raised in the frontal plane, turned a quarter about its own axis so the palm faces forward.
    RightForeArm: rot(Z, -58 + 24 * s).multiply(rot(X, -90)),
    RightHand: rot(Z, -8 * s),
    Head: rot(Z, -4).multiply(rot(Y, -8)),
  };
}, (t) => 0.004 * Math.sin(TAU * t));

writeFileSync(new URL("../demo/public/samples.glb", import.meta.url), writeGlb([idle, wave]));
console.log("wrote demo/public/samples.glb");
