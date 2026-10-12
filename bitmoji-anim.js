/**
 * bitmoji-anim.js: the player's 3D Bitmoji in a PlayCanvas Web Lens, playing Mixamo clips.
 *
 *   const bitmoji = await loadBitmoji(app, {
 *     clips: './animations.glb',              // from the converter (Mixamo FBX -> .glb)
 *     fallback: './avatar_default.glb',       // your own character on the same rig
 *   });
 *   app.root.addChild(bitmoji.entity);
 *   bitmoji.play('dance');
 *
 * It asks Snapchat for the avatar with every fallback Snap's docs ask for (no capability, no
 * Bitmoji, the desktop stub, a rejection, a timeout), loads it, steers clear of the GLB's traps
 * (its own root transform, skinned culling) and plays the clips with crossfades.
 *
 * The avatar Snapchat assembles on the phone need not name, orient or pose its joints as the rig
 * Snap publishes for animators. So the joints are found by name, or else by the skeleton's shape,
 * and each bone takes the clip's turn away from its source's T-pose in the character's frame,
 * from its own rest swung to point as the source's bone did: names, bone axes, rest pose and
 * units may all differ. Only dependency: playcanvas. MIT licence. https://github.com/bgeuze/bitmoji-mixamo
 */
import { Asset, ContainerHandler, Entity, Mat4, Quat, TextureHandler, Vec3 } from "playcanvas";

const URL_TIMEOUT = 15000;
const LOAD_TIMEOUT = 30000;

// ---- names ------------------------------------------------------------------

/** A joint name without a rig's dressing: "mixamorig:LeftArm" -> "leftarm". */
const bare = (n) => n.toLowerCase().replace(/^mixamorig\d*[:_]?/, "").replace(/[^a-z0-9]/g, "");

/** Also without a namespace, "C_" or "_bind_JNT": "C_spine0002_bind_JNT" -> "spine0002". */
function plainName(n) {
  let s = n.toLowerCase().replace(/^.*[:|]/, "").replace(/^mixamorig\d*[:_]?/, "").replace(/^(c|m|cn|ctr)_/, "");
  for (let t = ""; t !== s; ) { t = s; s = s.replace(/[_ ]?(jnt|joint|jt|bone|bnd|bind|ctrl|def|sk)$/, ""); }
  return s.replace(/[^a-z0-9]/g, "");
}

// ---- loading ----------------------------------------------------------------

function withTimeout(p, ms, what) {
  let id;
  return Promise.race([p, new Promise((_, rej) => { id = setTimeout(() => rej(new Error(`${what}: timed out`)), ms); })]).finally(() => clearTimeout(id));
}

function ensureHandlers(app) {
  // A bare AppBase has no loaders; without these a GLB silently never loads.
  if (!app.loader.getHandler("container")) app.loader.addHandler("container", new ContainerHandler(app));
  if (!app.loader.getHandler("texture")) app.loader.addHandler("texture", new TextureHandler(app));
}

function loadContainer(app, name, url, ms) {
  const asset = new Asset(name, "container", { url });
  const done = new Promise((resolve, reject) => {
    asset.ready(() => resolve(asset));
    asset.once("error", (e) => reject(new Error(String(e))));
    app.assets.add(asset);
    app.assets.load(asset);
  });
  return withTimeout(done, ms, name).catch((e) => {
    // A load cannot be cancelled: free it if it lands after all.
    asset.once("load", () => asset.unload());
    app.assets.remove(asset);
    throw e;
  });
}

/** The player's 3D Bitmoji URL, or null when Snap's docs say to use your default. */
async function bitmojiUrl(sdk) {
  if (!sdk?.bitmoji) return null;
  try { await sdk.init?.(); } catch { /* no host: the checks below say no */ }
  if (!sdk.isSupported?.("bitmoji") || sdk.isStub) return null;
  const { hasAvatar } = await sdk.bitmoji.getAvatarInfo();
  if (!hasAvatar) return null;
  const { url } = await sdk.bitmoji.get3DAvatar();
  return typeof url === "string" && url ? url : null;
}

// ---- clips ------------------------------------------------------------------

/** An accessor as floats, normalized int16 (glTF allows it for rotations) included. */
function readAccessor(json, bin, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  const n = a.count * { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const T = { 5126: Float32Array, 5122: Int16Array }[a.componentType];
  const raw = new T(bin.buffer.slice(off, off + n * T.BYTES_PER_ELEMENT));
  return T === Float32Array ? raw : Float32Array.from(raw, (x) => Math.max(-1, x / 32767));
}

/**
 * Parses the converter's .glb. Each clip: per frame, every joint's turn from its source's
 * T-pose in character space (Y up, facing +Z) and the Hips' position in hip heights; and that
 * T-pose (each joint's position in hip heights, null for a joint the source lacks).
 */
export function parseClips(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("clips: not a .glb");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
  if (json.extras?.format !== "bitmoji-mixamo") throw new Error("clips: not made by the bitmoji-mixamo converter");
  if (!(json.extras.version >= 3)) throw new Error("clips: made by an older converter; convert the FBX again");
  const bin = new Uint8Array(buffer, 20 + jsonLen + 8, dv.getUint32(20 + jsonLen, true));
  const joints = json.nodes.map((n) => n.name), parent = json.extras.parent, NJ = joints.length;
  const clips = json.animations.map((anim) => {
    let times = null, hips = null, rot = null;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      times ??= readAccessor(json, bin, s.input);
      rot ??= new Float32Array(times.length * NJ * 4);
      const v = readAccessor(json, bin, s.output);
      if (ch.target.path === "translation") hips = v;
      else for (let f = 0; f < times.length; f++) rot.set(v.subarray(f * 4, f * 4 + 4), (f * NJ + ch.target.node) * 4);
    }
    const fps = anim.extras.fps, rest = anim.extras.rest;
    const has = rest.map(Boolean);
    // The T-pose as the player reads it: a joint the source lacks sits on its parent.
    const pos = [];
    rest.forEach((r, j) => pos.push(r ? new Vec3(...r) : parent[j] < 0 ? new Vec3() : pos[parent[j]].clone()));
    return { name: anim.name, loop: anim.extras.loop ?? true, fps, frames: times.length, length: (times.length - 1) / fps, rot, hips, rig: { joints, parent, pos, has, key: JSON.stringify(rest) } };
  });
  return { joints, parent, clips };
}

// ---- finding the joints by shape ---------------------------------------------

const tv = new Vec3();

/** How far along the rig's chain joint `to` is from its ancestor `from`. */
function arc(rig, from, to) {
  let s = 0;
  for (let j = to; j !== from && rig.parent[j] >= 0; j = rig.parent[j]) s += rig.pos[j].distance(rig.pos[rig.parent[j]]);
  return s;
}

/** Rig joints onto a chain of bones, in order: each taken by one bone or left out, solved exactly. */
function fit(nodes, at, targets, out) {
  const m = targets.length, n = nodes.length;
  const best = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const how = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) { best[i][0] = best[i - 1][0] + targets[i - 1].skip; how[i][0] = 1; }
  for (let i = 0; i <= m; i++) {
    for (let k = 1; k <= n; k++) {
      let c = best[i][k - 1], h = 0;
      if (i > 0) {
        const s = best[i - 1][k] + targets[i - 1].skip;
        if (s < c) { c = s; h = 1; }
        const t = best[i - 1][k - 1] + Math.abs(at[k - 1] - targets[i - 1].at);
        if (t < c) { c = t; h = 2; }
      }
      best[i][k] = c;
      how[i][k] = h;
    }
  }
  for (let i = m, k = n; i > 0;) {
    const h = how[i][k];
    if (h === 0) k--;
    else if (h === 1) i--;
    else { out[targets[i - 1].j] = nodes[k - 1]; i--; k--; }
  }
}

/**
 * The rig's joints in an avatar whose names say nothing, from its bind pose: the toes are the
 * lowest bones, the hips the joint the legs and the spine share, the arms the chains out to the
 * bones furthest to each side; along each chain a joint takes the bone whose share of the leg's
 * length is nearest its own on the rig. Ported from Top Bins (render/retarget.ts).
 */
function mapByShape(frame, bones, rig) {
  const J = (n) => rig.joints.indexOf(n);
  const out = rig.joints.map(() => null);
  if (bones.length < 12) return out;
  const inv = frame.getWorldTransform().clone().invert();
  const set = new Set();
  for (const b of bones) for (let n = b; n && n !== frame; n = n.parent) set.add(n);
  const P = new Map();
  for (const b of set) P.set(b, new Mat4().mul2(inv, b.getWorldTransform()).getTranslation());
  const pos = (n) => P.get(n);
  const ups = (n) => { const a = []; for (let p = n.parent; p; p = p.parent) if (set.has(p)) a.push(p); return a; };
  const lca = (...ns) => {
    let common = [ns[0], ...ups(ns[0])];
    for (const n of ns.slice(1)) { const s = new Set([n, ...ups(n)]); common = common.filter((c) => s.has(c)); }
    return common[0] ?? null;
  };
  const chain = (top, n) => {
    const line = [n, ...ups(n)], i = line.indexOf(top);
    const nodes = i < 0 ? [] : line.slice(0, i).reverse();
    const at = [];
    let s = 0, prev = pos(top);
    for (const b of nodes) { s += pos(b).distance(prev); prev = pos(b); at.push(s); }
    return { nodes, at };
  };

  const byY = [...bones].sort((a, b) => pos(a).y - pos(b).y);
  const lo = pos(byY[0]).y, H = pos(byY[byY.length - 1]).y - lo || 1;
  const toeA = byY[0];
  const toeB = byY.find((b) => b !== toeA && pos(b).y < lo + 0.05 * H && Math.hypot(pos(b).x - pos(toeA).x, pos(b).z - pos(toeA).z) > 0.06 * H && !ups(b).includes(toeA) && !ups(toeA).includes(b));
  if (!toeB) return out;
  const legRoot = lca(toeA, toeB);
  if (!legRoot) return out;
  const front = new Vec3();
  for (const t of [toeA, toeB]) {
    const a = ups(t).find((n) => pos(n).y > pos(t).y + 0.03 * H);
    if (a) front.add(new Vec3(pos(t).x - pos(a).x, 0, pos(t).z - pos(a).z));
  }
  if (front.lengthSq() < 1e-12) return out;
  const left = new Vec3().cross(Vec3.UP, front.normalize()).normalize();
  const side = (n) => tv.sub2(pos(n), pos(legRoot)).dot(left);

  const mids = bones.filter((b) => Math.abs(side(b)) < 0.03 * H && pos(b).y > pos(legRoot).y).sort((a, b) => pos(b).y - pos(a).y);
  let hips = null, top = null;
  for (const m of mids) {
    const h = lca(toeA, toeB, m);
    if (h && pos(h).distance(pos(legRoot)) < 0.12 * H) { hips = h; top = m; break; }
  }
  if (!hips) return out;
  const legA = chain(hips, toeA), legB = chain(hips, toeB);
  const L = ((legA.at[legA.at.length - 1] ?? 0) + (legB.at[legB.at.length - 1] ?? 0)) / 2;
  if (!(L > 0)) return out;
  const oL = arc(rig, 0, J("LeftToeBase"));
  const targets = (from, names) => names.map((n) => ({ j: J(n), at: arc(rig, from, J(n)) / oL, skip: /^C_/.test(n) ? 0.03 : 0.25 }));
  out[0] = hips;

  const sp = chain(hips, top);
  fit(sp.nodes, sp.at.map((a) => a / L), targets(0, ["Spine", "C_spine0002_bind_JNT", "Spine1", "Neck", "C_neck0002_bind_JNT", "Head"]), out);
  if (legRoot !== hips) out[J("C_pelvis0001_bind_JNT")] = legRoot;
  const thighs = [];
  for (const [leg, toe] of [[legA, toeA], [legB, toeB]]) {
    const s = side(toe) > 0 ? "Left" : "Right";
    const keep = leg.nodes.map((n, i) => (n === legRoot ? -1 : i)).filter((i) => i >= 0);
    if (keep.length) thighs.push(leg.nodes[keep[0]]);
    fit(keep.map((i) => leg.nodes[i]), keep.map((i) => leg.at[i] / L), targets(0, ["UpLeg", "Leg", "Foot", "ToeBase"].map((n) => s + n)), out);
  }
  const inLeg = (b) => thighs.includes(b) || ups(b).some((u) => thighs.includes(u));
  const arms = bones.filter((b) => b !== hips && !inLeg(b) && ups(b).includes(hips));
  if (arms.length) {
    const tipL = arms.reduce((a, b) => (side(b) > side(a) ? b : a));
    const tipR = arms.reduce((a, b) => (side(b) < side(a) ? b : a));
    const root = side(tipL) > 0.1 * H && side(tipR) < -0.1 * H ? lca(tipL, tipR) : null;
    if (root) {
      for (const [tip, s] of [[tipL, "Left"], [tipR, "Right"]]) {
        const a = chain(root, tip);
        fit(a.nodes, a.at.map((x) => x / L), targets(rig.parent[J("LeftShoulder")], ["Shoulder", "Arm", "ForeArm", "Hand"].map((n) => s + n)), out);
      }
    }
  }
  const seen = new Set();
  return out.map((n) => (n && !seen.has(n) ? (seen.add(n), n) : null));
}

/** The bones a model's skins use (every node below it but the meshes, when it has none). */
function skinBones(root) {
  const s = new Set(), all = [];
  const walk = (n) => {
    const r = n.render;
    if (!r) all.push(n);
    for (const mi of r?.meshInstances ?? []) for (const b of mi.skinInstance?.bones ?? []) s.add(b);
    n.children.forEach(walk);
  };
  walk(root);
  return s.size ? [...s] : all;
}

// ---- retargeting -------------------------------------------------------------

const qP = new Quat(), tvh = new Vec3();

/**
 * A clip's pose, a turn of every bone away from its source's T-pose in character space (D), onto
 * the avatar's bones: each takes the same turn from its own rest, first swung to point as the
 * source's bone did in the T-pose (G, which also undoes an A-pose), with the source turned to
 * face as the avatar does (A): W = A D A^-1 G W_avatar, set as a local rotation under whatever its
 * parent now is. One per clip source (their T-poses differ a little). From Top Bins'
 * render/retarget.ts.
 */
class Retarget {
  constructor(frame, joints, rig) {
    const NJ = rig.joints.length, PARENT = rig.parent, J = (n) => rig.joints.indexOf(n);
    const CHILD = rig.joints.map((name, j) => {
      if (j === 0) return -1;
      const sided = /Left|Right/.test(name);
      return PARENT.findIndex((p, k) => p === j && (sided || !/Left|Right/.test(rig.joints[k])));
    });
    const inv = frame.getWorldTransform().clone().invert();
    const inFrame = (n) => new Mat4().mul2(inv, n.getWorldTransform());
    const Rr = joints.map((n) => (n ? new Quat().setFromMat4(inFrame(n)) : null));
    const Pr = joints.map((n) => (n ? inFrame(n).getTranslation() : null));

    // A: the rig's front onto the avatar's, a turn about the vertical (toes ahead of the feet).
    const frontOf = (p) => {
      const f = new Vec3();
      for (const s of ["Left", "Right"]) { const t = p(J(s + "ToeBase")), a = p(J(s + "Foot")); if (t && a) f.add(new Vec3(t.x - a.x, 0, t.z - a.z)); }
      return f;
    };
    const fo = frontOf((j) => rig.pos[j]), fr = frontOf((j) => Pr[j]);
    this.A = new Quat();
    if (fo.lengthSq() > 1e-12 && fr.lengthSq() > 1e-12) {
      const yaw = Math.atan2(fo.z * fr.x - fo.x * fr.z, fo.x * fr.x + fo.z * fr.z);
      this.A.setFromAxisAngle(Vec3.UP, (yaw * 180) / Math.PI);
    }
    this.Ainv = this.A.clone().invert();

    // G: down each chain, the avatar's bone swung to point where the rig's points in the T-pose.
    const G = [];
    for (let j = 0; j < NJ; j++) {
      const g = j === 0 ? new Quat() : G[PARENT[j]].clone();
      let c = CHILD[j];
      while (c >= 0 && !(Pr[c] && rig.has[c])) c = CHILD[c];
      if (j > 0 && Pr[j] && rig.has[j] && c >= 0) {
        const dr = g.transformVector(new Vec3().sub2(Pr[c], Pr[j]));
        const dO = this.A.transformVector(new Vec3().sub2(rig.pos[c], rig.pos[j]));
        if (dr.lengthSq() > 1e-12 && dO.lengthSq() > 1e-12) g.mul2(new Quat().setFromDirections(dr.normalize(), dO.normalize()), g);
      }
      G.push(g);
    }

    // The driven bones, parents first, each tied to its nearest driven ancestor.
    const depth = (n) => { let d = 0; for (let p = n.parent; p; p = p.parent) d++; return d; };
    // A joint its clip's source lacks is not driven: it keeps its rest under its driven parent.
    const order = joints.map((n, j) => ({ n, j })).filter((e) => e.n && rig.has[e.j]).sort((a, b) => depth(a.n) - depth(b.n));
    const at = new Map();
    this.nodes = []; this.jointOf = []; this.anc = []; this.K = []; this.Q = []; this.T = [];
    for (const e of order) {
      if (at.has(e.n)) continue;
      let a = -1;
      for (let p = e.n.parent; p; p = p.parent) { const k = at.get(p); if (k !== undefined) { a = k; break; } }
      const par = e.n.parent ? new Quat().setFromMat4(inFrame(e.n.parent)) : new Quat();
      at.set(e.n, this.nodes.length);
      this.nodes.push(e.n);
      this.jointOf.push(e.j);
      this.anc.push(a);
      this.K.push(a >= 0 ? Rr[this.jointOf[a]].clone().invert().mul(par) : par);
      this.Q.push(new Quat().mul2(G[e.j], Rr[e.j]));
      this.T.push(new Quat());
    }

    // The avatar's joints this source does not drive: held at their rest under their driven parent.
    this.held = joints.map((n, j) => (n && !rig.has[j] ? [n, n.getLocalRotation().clone()] : null)).filter(Boolean);

    // The hips: the clip places them in hip heights in character space (Y up, the origin on
    // the floor between the feet); here that is turned to the avatar's front and scaled by the
    // avatar's own hip height above its origin, then put in its hips' parent frame. Hip height,
    // not leg length: Mixamo hands Snap's rig back with other leg proportions but the same hips.
    this.hips = joints[0];
    this.hipsH = Pr[0] && Pr[0].y > 0 ? Pr[0].y : 1;
    this.hipsXf = new Mat4();
    if (this.hips?.parent) this.hipsXf.copy(inFrame(this.hips.parent)).invert().mul(new Mat4().setTRS(Vec3.ZERO, this.A, Vec3.ONE));
  }

  /** turns: each joint's turn from the T-pose in character space; hips: where the Hips are, in hip heights. */
  apply(turns, hips) {
    for (const [n, q] of this.held) n.setLocalRotation(q);
    for (let e = 0; e < this.nodes.length; e++) {
      this.T[e].mul2(this.A, turns[this.jointOf[e]]).mul(this.Ainv).mul(this.Q[e]);
      const a = this.anc[e];
      if (a >= 0) qP.mul2(this.T[a], this.K[e]);
      else qP.copy(this.K[e]);
      this.nodes[e].setLocalRotation(qP.invert().mul(this.T[e]));
    }
    if (this.hips) this.hips.setLocalPosition(this.hipsXf.transformPoint(tvh.copy(hips).mulScalar(this.hipsH), tvh));
  }
}

// ---- playing ----------------------------------------------------------------

/** A clip at time t: each joint's turn (nlerped) and where the Hips are (hip heights). */
function sample(clip, t, local, hips) {
  const x = Math.max(0, Math.min(clip.frames - 1, t * clip.fps));
  const f0 = Math.floor(x), f1 = Math.min(clip.frames - 1, f0 + 1), u = x - f0;
  const r = clip.rot, NJ = local.length, P = clip.rig.parent;
  for (let j = 0; j < NJ; j++) {
    // A joint the source lacks turns with its parent (it is not driven, but a crossfade reads it).
    if (!clip.rig.has[j]) { if (P[j] < 0) local[j].set(0, 0, 0, 1); else local[j].copy(local[P[j]]); continue; }
    const a = (f0 * NJ + j) * 4, b = (f1 * NJ + j) * 4;
    const s = r[a] * r[b] + r[a + 1] * r[b + 1] + r[a + 2] * r[b + 2] + r[a + 3] * r[b + 3] < 0 ? -1 : 1;
    local[j].set(r[a] + (s * r[b] - r[a]) * u, r[a + 1] + (s * r[b + 1] - r[a + 1]) * u, r[a + 2] + (s * r[b + 2] - r[a + 2]) * u, r[a + 3] + (s * r[b + 3] - r[a + 3]) * u).normalize();
  }
  const h = clip.hips, a = f0 * 3, b = f1 * 3;
  hips.set(h[a] + (h[b] - h[a]) * u, h[a + 1] + (h[b + 1] - h[a + 1]) * u, h[a + 2] + (h[b + 2] - h[a + 2]) * u);
}

/** The loaded avatar. `entity` goes in your scene; `play()` runs a clip. */
export class Bitmoji {
  constructor(app, entity, model, lib, isReal, assets, opts) {
    /** Add this to your scene; move, turn and scale it, never `model`. */
    this.entity = entity;
    /** The GLB's own root, left untouched: setting its transform lays the figure on its side. */
    this.model = model;
    /** True for the player's own Bitmoji (or the url you passed), false for your fallback. */
    this.isReal = isReal;
    this.app = app;
    this._assets = assets;
    this._clips = new Map();
    for (const c of lib.clips) {
      if (this._clips.has(c.name)) console.warn(`bitmoji: two clips named "${c.name}"; the last one plays`);
      this._clips.set(c.name, c);
    }
    this._cur = this._fade = null;
    this._hasLast = false;

    const all = [];
    const walk = (n) => { all.push(n); n.children.forEach(walk); };
    walk(model);
    const index = (key) => { const m = new Map(); for (const n of all) if (!m.has(key(n.name))) m.set(key(n.name), n); return m; };
    this._exact = new Map(all.map((n) => [n.name, n]));
    this._bare = index(bare);
    this._plain = index(plainName);

    /** How the rig's joints were found: "name", "shape", or "none" (nothing animates). */
    this.mode = "none";
    /** How many of the rig's joints the avatar has. */
    this.found = 0;
    this._joints = [];
    this._retargets = new Map();
    if (lib.clips.length) {
      // The joints are found once, against the clip source with the most of them.
      const ref = lib.clips.reduce((a, c) => (c.rig.has.filter(Boolean).length > a.rig.has.filter(Boolean).length ? c : a)).rig;
      const named = ref.joints.map((n) => this._byName(n));
      const core = ["Hips", "Spine", "Head", "LeftArm", "RightArm", "LeftHand", "RightHand", "LeftUpLeg", "RightUpLeg", "LeftFoot", "RightFoot"];
      let joints = named, mode = "name";
      if (!core.every((n) => named[ref.joints.indexOf(n)])) {
        const shape = mapByShape(entity, skinBones(model), ref);
        const used = new Set(shape.filter(Boolean));
        joints = shape.map((n, j) => n ?? (named[j] && !used.has(named[j]) ? named[j] : null));
        mode = "shape";
      }
      this.found = joints.filter(Boolean).length;
      if (this.found >= 12) {
        this._joints = joints;
        // One retarget per clip source, measured now, while the avatar stands in its rest pose.
        for (const c of lib.clips) if (!this._retargets.has(c.rig.key)) this._retargets.set(c.rig.key, new Retarget(entity, joints, c.rig));
        this._local = ref.joints.map(() => new Quat());
        this._last = ref.joints.map(() => new Quat());
        this._hips = new Vec3();
        this._lastHips = new Vec3();
        this.mode = mode;
      }
    }
    this._jointNames = lib.joints ?? [];

    if (opts.autoUpdate !== false) {
      this._tick = (dt) => this.update(dt);
      app.on("update", this._tick);
    }
  }

  /** A joint of the avatar by the rig's name ("Head", "RightHand"), to attach things to. */
  joint(name) {
    const j = this._jointNames.indexOf(name);
    return (j >= 0 ? this._joints[j] : null) ?? this._byName(name);
  }

  /** The clip names you can play. */
  get clips() { return [...this._clips.keys()]; }

  /** The clip playing now, or null. */
  get current() { return this._cur?.clip.name ?? null; }

  /** Whether a clip loops unless told otherwise (the converter's loop setting). */
  isLoop(name) { return this._clips.get(name)?.loop ?? false; }

  /** A clip's length in seconds (0 for a name it does not have). */
  length(name) { return this._clips.get(name)?.length ?? 0; }

  /**
   * Plays a clip, crossfading from the pose on screen. Resolves true when a one-shot plays to
   * its end, false when anything stops it first (another play(), stop(), destroy()); a loop
   * only resolves when it is stopped.
   * @param {string} name
   * @param {{fade?: number, loop?: boolean, speed?: number, from?: number}} [o]
   * @returns {Promise<boolean>}
   */
  play(name, o = {}) {
    const clip = this._clips.get(name);
    if (!clip) { console.warn(`bitmoji: no clip "${name}" (have: ${this.clips.join(", ")})`); return Promise.resolve(false); }
    this._cur?.resolve(false);
    const fade = o.fade ?? 0.2;
    // Fade from what is on screen now, a fade in progress included, so nothing pops.
    this._fade = fade > 0 && this._hasLast ? { from: this._last.map((q) => q.clone()), hips: this._lastHips.clone(), t: 0, dur: fade } : null;
    const speed = o.speed ?? 1;
    return new Promise((resolve) => {
      this._cur = { clip, t: o.from ?? (speed < 0 ? clip.length : 0), speed, loop: o.loop ?? clip.loop, resolve };
    });
  }

  /** Holds the current pose (the next play() fades from it). */
  stop() { this._cur?.resolve(false); this._cur = null; }

  /** Advances the animation. Called for you on app "update" unless you passed autoUpdate: false. */
  update(dt) {
    const cur = this._cur;
    if (!cur) return;
    cur.t += dt * cur.speed;
    const len = cur.clip.length;
    if (!cur.loop && (cur.speed >= 0 ? cur.t >= len : cur.t <= 0)) cur.resolve(true);
    if (this.mode === "none") return;
    sample(cur.clip, this._time(cur), this._local, this._hips);
    const f = this._fade;
    if (f) {
      f.t += dt;
      const w = Math.min(1, f.t / f.dur), k = w * w * (3 - 2 * w);
      if (w >= 1) this._fade = null;
      else {
        for (let j = 0; j < this._local.length; j++) {
          const a = f.from[j], b = this._local[j];
          if (a.dot(b) < 0) b.set(-b.x, -b.y, -b.z, -b.w);
          b.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k, a.w + (b.w - a.w) * k).normalize();
        }
        this._hips.lerp(f.hips, this._hips, k);
      }
    }
    this._retargets.get(cur.clip.rig.key).apply(this._local, this._hips);
    for (let j = 0; j < this._local.length; j++) this._last[j].copy(this._local[j]);
    this._lastHips.copy(this._hips);
    this._hasLast = true;
  }

  /** Frees the avatar and its GLB. */
  destroy() {
    this.stop();
    this.mode = "none";
    if (this._tick) this.app.off("update", this._tick);
    this.entity.destroy();
    for (const a of this._assets) { a.unload(); this.app.assets.remove(a); }
    this._assets = [];
  }

  _byName(name) {
    return this._exact.get(name) ?? this._bare.get(bare(name)) ?? this._plain.get(plainName(name)) ?? null;
  }

  _time(layer) {
    const len = layer.clip.length;
    return layer.loop && len > 0 ? ((layer.t % len) + len) % len : Math.max(0, Math.min(layer.t, len));
  }
}

/**
 * Loads the player's Bitmoji (or your fallback) with your clips.
 * @param {import("playcanvas").AppBase} app
 * @param {{
 *   clips?: string | ArrayBuffer | (string | ArrayBuffer)[],
 *   fallback?: string,
 *   url?: string | null,
 *   snapchat?: any,
 *   hideMouth?: boolean,
 *   autoUpdate?: boolean,
 *   timeout?: number,
 * }} [opts]
 * @returns {Promise<Bitmoji>}
 */
export async function loadBitmoji(app, opts = {}) {
  ensureHandlers(app);
  // The clips load alongside the avatar. A clips file that cannot be read is the lens's own bug:
  // it is said as such, not hidden behind the fallback.
  const read = async (s) => {
    if (typeof s !== "string") return parseClips(s);
    const r = await fetch(s);
    if (!r.ok) throw new ClipsError(`clips: ${s} answered ${r.status}`);
    try { return parseClips(await r.arrayBuffer()); } catch (e) { throw new ClipsError(`${e.message} (${s})`); }
  };
  const libP = Promise.all([].concat(opts.clips ?? []).map(read)).then((libs) => ({
    joints: libs[0]?.joints ?? [],
    clips: libs.flatMap((l) => l.clips),
  }));
  libP.catch(() => {}); // awaited below; no unhandled-rejection noise meanwhile

  const build = async (url, name, real) => {
    const asset = await loadContainer(app, name, url, opts.timeout ?? LOAD_TIMEOUT);
    let model = null;
    try {
      model = asset.resource.instantiateRenderEntity();
      for (const r of model.findComponents("render")) {
        // Skinned bounds land metres off under the GLB's scaled root: the mesh would vanish.
        for (const mi of r.meshInstances) mi.cull = false;
        // The mouth (teeth, tongue) sits below the chin until a face rig drives it.
        if ((opts.hideMouth ?? true) && /mouth/i.test(r.entity.name)) r.enabled = false;
      }
      const entity = new Entity("bitmoji");
      entity.addChild(model);
      const lib = await libP;
      const b = new Bitmoji(app, entity, model, lib, real, [asset], opts);
      if (lib.clips.length && b.mode === "none") { b.destroy(); model = null; throw new Error(`${name}: ${b.found} of the rig's joints found, too few to animate`); }
      return b;
    } catch (e) {
      model?.destroy();
      if (asset.resource || asset.loaded) asset.unload();
      app.assets.remove(asset);
      throw e;
    }
  };

  let url = opts.url;
  if (url === undefined) {
    url = await withTimeout(bitmojiUrl(opts.snapchat ?? globalThis.snapchat), URL_TIMEOUT, "get3DAvatar").catch((e) => { console.warn("bitmoji: using the fallback:", e.message); return null; });
  }
  if (url) {
    try { return await build(url, "bitmoji", true); } catch (e) {
      if (e instanceof ClipsError) throw e;
      console.warn("bitmoji: using the fallback:", e.message);
    }
  }
  if (!opts.fallback) { await libP; throw new Error("bitmoji: no Bitmoji and no fallback"); }
  return build(opts.fallback, "bitmoji-fallback", false).catch((e) => {
    if (e instanceof ClipsError) throw e;
    throw new Error(`bitmoji: no Bitmoji, and the fallback ${opts.fallback} did not load (${e.message})`);
  });
}

/** A clips file that could not be read: thrown as is, never answered with the fallback. */
class ClipsError extends Error {}
