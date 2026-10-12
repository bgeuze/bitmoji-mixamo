/**
 * Mixamo FBX -> a clip for the player's 3D Bitmoji.
 *
 * Runs in the browser (converter/index.html) and in Node (cli.mjs). The only dependency is
 * three.js, and only for its FBX reader; the output is a small animation-only .glb that
 * bitmoji-anim.js plays without three.js.
 *
 * What a clip holds, for the rig's 24 joints (Mixamo's names plus Snap's in-between helpers):
 *  - each frame, every joint's turn away from the source's T-pose, in character space (Y up,
 *    facing +Z): D = W_pose W_Tpose^-1. A turn in space says nothing about any skeleton's bone
 *    axes, so the clip carries no data about the rig it will play on;
 *  - the source's T-pose itself (each joint's position), which tells bitmoji-anim.js where each
 *    bone pointed when the turns were zero;
 *  - the Hips' position each frame, in units of the source's hip height.
 * Mixamo hands every character back in the same T-pose, so a clip made on Snap's
 * UploadToMixamo.fbx and one made on Y Bot are read the same way.
 */
import { AnimationMixer, LoopOnce, Quaternion, Vector3 } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

export const FORMAT = "bitmoji-mixamo";
export const VERSION = 3;

/** The joints a clip drives, and their parents: Mixamo's skeleton with Snap's helpers in between. */
export const JOINTS = ["Hips", "Spine", "C_spine0002_bind_JNT", "Spine1", "Neck", "C_neck0002_bind_JNT", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "C_pelvis0001_bind_JNT", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
export const PARENT = [-1, 0, 1, 2, 3, 4, 5, 3, 7, 8, 9, 3, 11, 12, 13, 0, 15, 16, 17, 18, 15, 20, 21, 22];

/** A clip name as the converter writes it: letters, digits, "_" and "-". */
export function safeName(name) {
  return String(name).replace(/\.fbx$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_") || "clip";
}

/** A joint name without a rig's dressing: "mixamorig:LeftArm", "mixamorig1_LeftArm" -> "leftarm". */
function bare(name) {
  return name.toLowerCase().replace(/^mixamorig\d*[:_]?/, "").replace(/[^a-z0-9]/g, "");
}

/** Also without a namespace, a "C_" prefix or "_bind_JNT"-style ends: "C_spine0002_bind_JNT" -> "spine0002". */
function plainName(name) {
  let s = name.toLowerCase().replace(/^.*[:|]/, "").replace(/^mixamorig\d*[:_]?/, "").replace(/^(c|m|cn|ctr)_/, "");
  for (;;) {
    const t = s.replace(/[_ ]?(jnt|joint|jt|bone|bnd|bind|ctrl|def|sk)$/, "");
    if (t === s) break;
    s = t;
  }
  return s.replace(/[^a-z0-9]/g, "");
}

/** The source bone that plays each joint, or null. */
function matchJoints(bones) {
  const byBare = new Map(), byPlain = new Map();
  for (const b of bones) {
    if (!byBare.has(bare(b.name))) byBare.set(bare(b.name), b);
    if (!byPlain.has(plainName(b.name))) byPlain.set(plainName(b.name), b);
  }
  const out = JOINTS.map((n) => byBare.get(bare(n)) ?? byPlain.get(plainName(n)) ?? null);
  // A stock Mixamo character has three spine joints where the rig has two and a helper: the
  // chest (Spine1, the shoulders' parent) is Mixamo's Spine2, the helper between takes Spine1.
  const spine2 = byBare.get("spine2");
  if (spine2) {
    out[JOINTS.indexOf("Spine1")] = spine2;
    out[JOINTS.indexOf("C_spine0002_bind_JNT")] = byBare.get("spine1") ?? null;
  }
  return out;
}

/** World rotation as the product of local rotations: Snap's rig carries scale on its joints, which a matrix decomposition would smear into it. */
function worldQuat(o, out) {
  out.identity();
  const chain = [];
  for (let n = o; n; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
  return out.normalize();
}

function parseFbx(buffer) {
  // In Node, an FBX "With Skin" asks three.js for its textures through the DOM: give it an image
  // that never loads (only the skeleton and the animation are read).
  const stub = typeof document === "undefined";
  if (stub) {
    const img = { addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} };
    globalThis.document = { createElementNS: () => img, createElement: () => img };
  }
  try {
    const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return new FBXLoader().parse(ab, "");
  } finally {
    if (stub) delete globalThis.document;
  }
}

/**
 * One Mixamo FBX -> one clip.
 * @param {ArrayBuffer|Uint8Array} buffer the .fbx file
 * @param {{name?: string, loop?: boolean, fps?: number}} [opts]
 */
export function convertFbx(buffer, opts = {}) {
  const scene = parseFbx(buffer);
  const anim = scene.animations?.[0];
  if (!anim || anim.duration <= 0) throw new Error("this FBX holds no animation");
  const bones = [];
  scene.traverse((o) => { if (o.isBone || o.type === "Bone") bones.push(o); });
  if (!bones.length) throw new Error("this FBX holds no skeleton");
  const src = matchJoints(bones);
  const NJ = JOINTS.length;
  const hipsSrc = src[0];
  if (!hipsSrc) throw new Error("no Hips joint: is this a Mixamo FBX?");
  for (const n of ["LeftUpLeg", "RightUpLeg", "LeftArm", "RightArm", "Head"]) if (!src[JOINTS.indexOf(n)]) throw new Error(`no ${n} joint: is this a Mixamo FBX?`);
  const missing = JOINTS.filter((_, j) => !src[j]);

  // The source's rest: Mixamo's T-pose. Its turns, and where each joint is (for the player).
  scene.updateMatrixWorld(true);
  const restInv = src.map((b) => (b ? worldQuat(b, new Quaternion()).invert() : null));
  const hipHeight = hipsSrc.getWorldPosition(new Vector3()).y;
  if (!(hipHeight > 0)) throw new Error("the Hips rest below the floor: not a standing Mixamo character");
  const rest = src.map((b) => (b ? b.getWorldPosition(new Vector3()).toArray().map((x) => Math.round((x / hipHeight) * 1e4) / 1e4) : null));

  const fps = opts.fps ?? 30;
  if (!(fps > 0 && fps <= 120)) throw new Error(`fps must be between 1 and 120, not ${opts.fps}`);
  const loop = opts.loop ?? true;
  const frames = Math.max(2, Math.round(anim.duration * fps) + 1);
  const rot = new Float32Array(frames * NJ * 4);
  const hips = new Float32Array(frames * 3);
  const mixer = new AnimationMixer(scene);
  // Once and clamped: a repeating action wraps setTime(duration) back to the first frame, which
  // would end every one-shot on its start pose.
  const action = mixer.clipAction(anim);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const q = new Quaternion(), p = new Vector3();
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(anim.duration - 1e-4, f / fps));
    scene.updateMatrixWorld(true);
    for (let j = 0; j < NJ; j++) {
      if (!src[j]) continue;
      worldQuat(src[j], q).multiply(restInv[j]).normalize();
      // Neighbouring frames in the same hemisphere, so a plain lerp interpolates them.
      const o = ((f - 1) * NJ + j) * 4;
      if (f > 0 && q.x * rot[o] + q.y * rot[o + 1] + q.z * rot[o + 2] + q.w * rot[o + 3] < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      rot.set([q.x, q.y, q.z, q.w], (f * NJ + j) * 4);
    }
    hipsSrc.getWorldPosition(p);
    hips.set([p.x / hipHeight, p.y / hipHeight, p.z / hipHeight], f * 3);
  }
  mixer.stopAllAction();

  return {
    name: safeName(opts.name ?? (anim.name && anim.name !== "mixamo.com" ? anim.name : "clip")),
    fps,
    loop,
    frames,
    rot,
    hips,
    rest,
    report: {
      found: NJ - missing.length,
      total: NJ,
      missing,
      source: missing.length === 0 ? "snap-rig" : "mixamo",
      duration: anim.duration,
    },
  };
}

/**
 * Clips -> one animation-only .glb. Plain glTF 2.0: a node per joint (the names and hierarchy
 * above), one animation per clip with a rotation channel for each joint its source has
 * (normalized int16, allowed by the core spec) and the Hips' translation. The extras say how
 * to read it: rotations are turns from the T-pose in character space, the T-pose is in each
 * animation's extras, positions are in hip heights.
 * @param {ReturnType<typeof convertFbx>[]} clips
 */
export function writeGlb(clips) {
  const NJ = JOINTS.length;
  // Every clip under its own name: a second "idle" becomes "idle_2".
  const used = new Map();
  const names = clips.map((c) => { const n = used.get(c.name) ?? 0; used.set(c.name, n + 1); return n ? `${c.name}_${n + 1}` : c.name; });
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const push = (typed, accessor) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    accessors.push({ bufferView: bufferViews.length - 1, ...accessor });
    return accessors.length - 1;
  };

  const animations = clips.map((c, ci) => {
    const times = new Float32Array(c.frames);
    for (let f = 0; f < c.frames; f++) times[f] = f / c.fps;
    const input = push(times, { componentType: 5126, count: c.frames, type: "SCALAR", min: [0], max: [times[c.frames - 1]] });
    const samplers = [], channels = [];
    for (let j = 0; j < NJ; j++) {
      if (!c.rest[j]) continue;
      const q = new Int16Array(c.frames * 4);
      for (let f = 0; f < c.frames; f++) {
        for (let k = 0; k < 4; k++) q[f * 4 + k] = Math.round(Math.max(-1, Math.min(1, c.rot[(f * NJ + j) * 4 + k])) * 32767);
      }
      samplers.push({ input, output: push(q, { componentType: 5122, normalized: true, count: c.frames, type: "VEC4" }), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: j, path: "rotation" } });
    }
    samplers.push({ input, output: push(c.hips, { componentType: 5126, count: c.frames, type: "VEC3" }), interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node: 0, path: "translation" } });
    return { name: names[ci], samplers, channels, extras: { loop: c.loop, fps: c.fps, rest: c.rest } };
  });

  const nodes = JOINTS.map((name, j) => {
    const children = PARENT.map((p, i) => (p === j ? i : -1)).filter((i) => i >= 0);
    return { name, ...(children.length ? { children } : {}) };
  });

  const json = {
    asset: { version: "2.0", generator: `${FORMAT} ${VERSION}` },
    extras: {
      format: FORMAT,
      version: VERSION,
      parent: PARENT,
      // Rotations: each joint's turn from the source's T-pose, in character space (Y up, facing
      // +Z). rest (per animation): the T-pose, each joint's position in hip heights. The Hips'
      // translation: in hip heights, the origin on the floor.
      space: "character",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    animations,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPad) jsonBytes = enc.encode(JSON.stringify(json) + " ".repeat(jsonPad));
  const binPad = (4 - (byteLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.byteLength + 8 + byteLength + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.byteLength;
  dv.setUint32(o, byteLength + binPad, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
