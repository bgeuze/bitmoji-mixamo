// The demo: the player's 3D Bitmoji (or the fallback) and a button per clip.
import * as pc from "playcanvas";
import snapchat from "@snap/web-lens-api";
import { loadBitmoji } from "../bitmoji-anim.js";

const canvas = document.getElementById("view");
const status = document.getElementById("status");
const panel = document.getElementById("clips");
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());
app.scene.ambientLight = new pc.Color(0.55, 0.57, 0.66);
app.start();

const camera = new pc.Entity("camera");
camera.addComponent("camera", { clearColor: new pc.Color(0.85, 0.86, 0.95), fov: 40 });
camera.setPosition(0, 0.5, 3.9);
camera.lookAt(0, 0.15, 0);
app.root.addChild(camera);

const sun = new pc.Entity("sun");
sun.addComponent("light", { type: "directional", intensity: 1.2, castShadows: true, shadowDistance: 6, shadowResolution: 1024, shadowBias: 0.3, normalOffsetBias: 0.06 });
sun.setEulerAngles(50, 30, 0);
app.root.addChild(sun);

const floor = new pc.Entity("floor");
const floorMat = new pc.StandardMaterial();
floorMat.diffuse = new pc.Color(0.74, 0.76, 0.9);
floorMat.update();
floor.addComponent("render", { type: "cylinder", material: floorMat });
floor.setLocalScale(2.2, 0.02, 2.2);
floor.setPosition(0, -0.01, 0);
app.root.addChild(floor);

// ?bitmoji=./my-test.glb loads a local GLB instead of asking Snapchat (desktop testing).
const test = new URLSearchParams(location.search).get("bitmoji");

/** The sample clips always; your converter output too when it is there. */
async function clipFiles() {
  const files = ["./samples.glb"];
  try {
    const r = await fetch("./animations.glb");
    if (r.ok) files.push(await r.arrayBuffer());
  } catch { /* none */ }
  return files;
}

async function main() {
  status.innerHTML = "<b>Loading your Bitmoji…</b>";
  try {
    const bitmoji = await loadBitmoji(app, {
      snapchat,
      clips: await clipFiles(),
      fallback: "./avatar_default.glb",    // Snap's default avatar (see README)
      ...(test ? { url: test } : {}),
    });
    for (const r of bitmoji.model.findComponents("render")) r.castShadows = true;
    app.root.addChild(bitmoji.entity);
    window.bitmoji = bitmoji;

    // The camera follows the hips across the floor, so a clip that travels (a dive) stays in view.
    const look = new pc.Vec3(0, 0.15, 0);
    app.on("update", (dt) => {
      const h = bitmoji.joint("Hips").getPosition(), k = Math.min(1, dt * 9);
      look.x += (h.x - look.x) * k;
      look.z += (h.z - look.z) * k;
      camera.setPosition(look.x, 0.5, look.z + 3.9);
      camera.lookAt(look);
    });

    const rest = bitmoji.clips.includes("idle") ? "idle" : bitmoji.clips[0];
    const buttons = new Map();
    const show = (name) => {
      for (const [n, b] of buttons) b.classList.toggle("on", n === name);
      status.innerHTML = `<b>${name}</b>${bitmoji.isReal ? "your Bitmoji" : "default avatar"} · joints by ${bitmoji.mode} (${bitmoji.found}/24)`;
    };
    const play = async (name) => {
      show(name);
      const loops = bitmoji._clips.get(name).loop;
      await bitmoji.play(name, { fade: 0.25 });
      // A one-shot that ran to its end (not one cut off by a tap) goes back to the rest loop.
      if (!loops && bitmoji.current === name) { bitmoji.play(rest, { fade: 0.4 }); show(rest); }
    };
    for (const name of bitmoji.clips) {
      const b = document.createElement("button");
      const loops = bitmoji._clips.get(name).loop;
      b.className = loops ? "" : "once";
      b.innerHTML = name.replace(/_/g, " ") + (loops ? "" : "<small>1×</small>");
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); play(name); });
      panel.appendChild(b);
      buttons.set(name, b);
    }
    play(rest);
  } catch (e) {
    status.innerHTML = "<b>No avatar to show</b>Put avatar_default.glb in demo/public (see the README), or open with ?bitmoji=./your.glb";
    console.warn(e.message);
  }
}
main();
