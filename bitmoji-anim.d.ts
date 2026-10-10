import type { AppBase, Entity, GraphNode } from "playcanvas";

export interface LoadBitmojiOptions {
  /** The converter's .glb (or several), as URLs relative to your index.html or ArrayBuffers. */
  clips?: string | ArrayBuffer | (string | ArrayBuffer)[];
  /** Your own character on the same rig, for players without a Bitmoji, the desktop stub and failures. */
  fallback?: string;
  /** A GLB URL to load instead of asking Snapchat (desktop testing). null skips the Bitmoji. */
  url?: string | null;
  /** The Web Lens API object; defaults to window.snapchat (installed by @snap/web-lens-api). */
  snapchat?: unknown;
  /** Hide the mouth mesh (teeth, tongue), which sits below the chin without a face rig. Default true. */
  hideMouth?: boolean;
  /** Advance on app "update". Default true; pass false and call update(dt) yourself. */
  autoUpdate?: boolean;
  /** How long a GLB may take to load, ms. Default 30000 (Snapchat builds the avatar on the phone). */
  timeout?: number;
}

export interface PlayOptions {
  /** Crossfade from the current pose, seconds. Default 0.2. */
  fade?: number;
  /** Override the clip's own loop flag. */
  loop?: boolean;
  /** Playback rate. Default 1. */
  speed?: number;
  /** Start this far into the clip, seconds. */
  from?: number;
}

export declare class Bitmoji {
  /** Add this to your scene; move, turn and scale it, never `model`. */
  readonly entity: Entity;
  /** The GLB's own root, left untouched. */
  readonly model: Entity;
  /** True for the player's own Bitmoji, false for your fallback. */
  readonly isReal: boolean;
  /** How the rig's joints were found in this avatar: by "name", by "shape", or "none". */
  readonly mode: "name" | "shape" | "none";
  /** How many of the rig's 24 joints the avatar has (worth logging on a phone). */
  readonly found: number;
  /** The clip names you can play. */
  readonly clips: string[];
  /** The clip playing now, or null. */
  readonly current: string | null;
  /** Resolves when a one-shot ends or another clip replaces it. */
  play(name: string, opts?: PlayOptions): Promise<void>;
  /** Holds the current pose. */
  stop(): void;
  /** Advances the animation (only needed with autoUpdate: false). */
  update(dt: number): void;
  /** A joint by the rig's name ("Head", "RightHand"), to attach things to. */
  joint(name: string): GraphNode | null;
  /** Frees the avatar and its GLB. */
  destroy(): void;
}

export interface ParsedClip {
  name: string;
  length: number;
  loop: boolean;
  fps: number;
  frames: number;
}

/** Loads the player's Bitmoji, or your fallback, with your clips. Rejects only when neither loads. */
export declare function loadBitmoji(app: AppBase, opts?: LoadBitmojiOptions): Promise<Bitmoji>;

/** Parses the converter's .glb. */
export declare function parseClips(buffer: ArrayBuffer): { rig: unknown; clips: ParsedClip[] };
