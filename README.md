# bitmoji-mixamo

Mixamo animations on the player's 3D Bitmoji, in a Snapchat Web Lens built with PlayCanvas.

<img src="media/demo.gif" width="270" align="right" alt="The demo lens: tapping through Mixamo clips on a 3D Bitmoji">

`snapchat.bitmoji.get3DAvatar()` gives you the player's Bitmoji as a rigged GLB **with no animations**. This kit gets your Mixamo clips onto it:

1. **Convert.** Drop Mixamo FBX files into the [converter](https://bgeuze.github.io/bitmoji-mixamo/converter/). You get one small `animations.glb`. The page runs entirely in your browser.
2. **Play.** Copy `bitmoji-anim.js` into your lens (its only dependency is `playcanvas`):

```js
import { loadBitmoji } from './bitmoji-anim.js';

const bitmoji = await loadBitmoji(app, {
  clips: './animations.glb',
  fallback: './avatar_default.glb',   // for players without a Bitmoji, and the desktop stub
});
app.root.addChild(bitmoji.entity);
bitmoji.play('dance');
```

That's all. `bitmoji-anim.js` takes care of the rest:

- **Snap's fallback rules**: no capability, no Bitmoji, the desktop stub, `ERR_INTERNAL`, or a URL that never comes. Snapchat builds the avatar on the phone, which can take a while, so the URL gets 15 s and the GLB 30 s.
- **The GLB's traps.** It puts the model under its own pivot, because transforming the GLB's root lays the figure on its side. It turns culling off on the skinned meshes, whose bounds land metres off. It hides the mouth mesh, which sits below the chin without a face rig. It registers the GLB loaders when a bare `AppBase` lacks them.
- **Crossfades between clips**, plus one-shots you can `await`.

▶ [Full demo video (MP4)](media/demo.mp4): the demo lens tapping through 17 Mixamo clips converted with this kit, on Snap's template Bitmoji.

<br clear="right">

## Getting clips from Mixamo

- **Best:** upload Snap's `UploadToMixamo.fbx` ([Snap's "Animating Bitmoji 3D" guide](https://developers.snap.com/lens-studio/features/bitmoji-avatar/animating-bitmoji-3d)) to [mixamo.com](https://www.mixamo.com) and pick your animations on it. Clips made on Snap's rig fit the Bitmoji's proportions best.
- **Also works:** clips downloaded on Mixamo's stock characters (Y Bot, X Bot, …). The converter retargets them onto the Bitmoji rig.
- **Download settings:** FBX Binary, **Without Skin** (smaller; the skin is ignored anyway), 30 fps.
- Tick **In Place** for walks and runs when your game moves the character itself.

## The API

```ts
loadBitmoji(app, {
  clips?: string | ArrayBuffer | (string | ArrayBuffer)[],  // converter output(s)
  fallback?: string,       // your own character on Snap's rig
  url?: string | null,     // load this GLB instead of asking Snapchat (testing); null = fallback
  snapchat?: object,       // the Web Lens API; defaults to window.snapchat
  hideMouth?: boolean,     // default true
  autoUpdate?: boolean,    // default true: advances on app 'update'; false = call update(dt)
  timeout?: number,        // GLB load timeout, ms (default 30000)
}) → Promise<Bitmoji>

bitmoji.entity            // add to your scene; move, turn, scale this
bitmoji.isReal            // true = the player's own Bitmoji, false = your fallback
bitmoji.mode, .found      // 'name' | 'shape': how its joints were found, and how many of 24
bitmoji.clips             // ['idle', 'dance', …]
bitmoji.play(name, { fade = 0.2, loop, speed = 1, from = 0 })  → Promise (resolves when a one-shot ends)
bitmoji.stop()
bitmoji.joint('RightHand')    // attach a prop to a joint
bitmoji.destroy()
```

```js
// A one-shot, then back to the loop:
await bitmoji.play('wave', { loop: false });
bitmoji.play('idle', { fade: 0.4 });
```

Types are in `bitmoji-anim.d.ts`.

## The default avatar

Snap's guidelines ask for a default character on the same rig, for players without a Bitmoji and for the desktop stub, whose 3D avatar is an empty placeholder. Snap ships one, `avatar_default.glb`, with the `bitmoji-dance` example of the Web Lens API. Use that or your own model on Snap's rig, and pass it as `fallback`.

## Command line

```bash
npm install                      # three.js, for the FBX reader
node cli.mjs idle.fbx dance.fbx wave.fbx -o animations.glb --fps 30 --once wave
```

## Demo lens

`demo/` is a minimal Web Lens: the player's Bitmoji and a button for each clip. It ships with two hand-made sample clips (`idle`, `wave`). Put your converter output in `demo/public/animations.glb` and every clip in it gets a button too: loops keep playing, one-shots (1×) return to idle when they end. The status line shows whether the joints were found by name or by shape, which is worth a screenshot when you test on a phone.

```bash
cd demo && npm install && npm run dev        # desktop: put avatar_default.glb in demo/public
npm run zip                                  # demo.zip, ready for My Lenses (~525 KB + your clips)
```

Open `?bitmoji=./some.glb` to test with any GLB on Snap's rig.

## How it works

The Bitmoji rig names its joints the way Mixamo does (`Hips`, `Spine`, `LeftArm`, …) plus Snap's helpers (`C_spine0002_bind_JNT`, …). The two rigs still differ in three ways:
- Mixamo only exports FBX.
- Stock Mixamo bones are prefixed `mixamorig:`.
- The Bitmoji's Hips sit under a root that is scaled by 0.01 and turned 90°.

The converter (three.js FBX reader, browser or Node):
- matches each joint by name;
- each frame, stores every joint's **turn away from the source's T-pose**, in character space (Y up, facing +Z). A turn in space says nothing about any skeleton's bone axes, so the clip holds no data about the rig it will play on;
- stores the source's T-pose (joint positions) and the Hips' position, both in units of hip height.

Mixamo hands every character back in the same T-pose, so clips made on Snap's rig and on Y Bot are read the same way.

`bitmoji-anim.js` makes no assumptions about the avatar it gets. The Bitmoji that Snapchat builds on the phone does not name its joints the way the published rig does. So the player finds the joints by name, or else by the shape of the skeleton:
- the toes are the lowest bones;
- the hips are where the legs and the spine meet;
- the arms are the chains out to the bones furthest to each side.

Then each bone takes the clip's turn, starting from its own rest pose swung to point the way the source's bone pointed in the T-pose. Joint names, bone axes, rest pose (A or T), units and root transform can all differ.

The output is plain glTF 2.0: one node per joint, one animation per clip, rotations as normalized int16. That comes to about 7.5 KB per second of animation at 30 fps, and half that at 15.

Checked numerically against an independent Blender pipeline on Snap's rig (`scripts/check.mjs`):
- **joints found by name:** 0.3 cm per joint on average;
- **every node renamed, joints found by shape:** 0.6 cm on average, at most about 5 cm (the head's pivot).

## Licence

MIT, by [Baruch Geuze](https://baruchgeuze.nl/weblens). Mixamo animations are subject to Adobe's Mixamo terms, and Bitmoji to Snap's. This repository ships neither, nor any data taken from Snap's rig: the demo's two clips are hand-made.
