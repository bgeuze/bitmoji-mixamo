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
  /** Crossfade from the pose on screen, seconds. Default 0.2. */
  fade?: number;
  /** Override the clip's own loop flag. */
  loop?: boolean;
  /** Playback rate; negative plays backwards from the end. Default 1. */
  speed?: number;
  /** Start this far into the clip, seconds (default 0, or the end when speed < 0). */
  from?: number;
}

export declare class Bitmoji {
  /** Add this to your scene; move, turn and scale it, never `model`. */
  readonly entity: Entity;
  /** The GLB's own root, left untouched. */
  readonly model: Entity;
  /** True for the player's own Bitmoji (or the url you passed), false for your fallback. */
  readonly isReal: boolean;
  /** How the rig's joints were found in this avatar: by "name", by "shape", or "none" (no clips given). */
  readonly mode: "name" | "shape" | "none";
  /** How many of the rig's 24 joints the avatar has (worth logging on a phone). */
  readonly found: number;
  /** The clip names you can play. */
  readonly clips: string[];
  /** The clip playing now, or null. */
  readonly current: string | null;
  /** Whether a clip loops unless play() says otherwise. */
  isLoop(name: string): boolean;
  /** A clip's length in seconds (0 for a name it does not have). */
  length(name: string): number;
  /**
   * Plays a clip, crossfading from the pose on screen. Resolves true when a one-shot plays to
   * its end, false when something stops it first (another play(), stop(), destroy()). A loop
   * resolves only when stopped. An unknown name warns and resolves false.
   */
  play(name: string, opts?: PlayOptions): Promise<boolean>;
  /** Holds the current pose; the next play() fades from it. */
  stop(): void;
  /** Advances the animation (only needed with autoUpdate: false). */
  update(dt: number): void;
  /** A joint by the rig's name ("Head", "RightHand"), to attach things to. */
  joint(name: string): GraphNode | null;
  /** Frees the avatar and its GLB, and stops any clip (its promise resolves false). Safe to call twice. */
  destroy(): void;
}

export interface ParsedClip {
  name: string;
  length: number;
  loop: boolean;
  fps: number;
  frames: number;
}

export interface ParsedClips {
  /** The joint names, in the file's order. */
  joints: string[];
  /** Each joint's parent index (-1 for the Hips). */
  parent: number[];
  clips: ParsedClip[];
}

/**
 * Loads the player's Bitmoji, or your fallback, with your clips. Rejects when neither avatar
 * loads, or when a clips file cannot be read (that error is never answered with the fallback).
 */
export declare function loadBitmoji(app: AppBase, opts?: LoadBitmojiOptions): Promise<Bitmoji>;

/** Parses the converter's .glb. */
export declare function parseClips(buffer: ArrayBuffer): ParsedClips;
