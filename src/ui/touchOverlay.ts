/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Phone full screen overlay layout: the board fills the screen and the controls float over it.
 * This module holds the decision (pure), the body classes, and the measurements the renderer needs.
 */

/** Which side of the screen the directional pad sits on. */
export type DpadSide = 'left' | 'right';

/** The owner's reference layout puts the pad on the right. */
export const DEFAULT_DPAD_SIDE: DpadSide = 'right';

/** A phone is a screen whose short side is at most this wide, in CSS pixels. */
export const TOUCH_OVERLAY_MAX_SHORT_SIDE_PX = 600;

/** Class of the pad cell a finger holds down. */
export const DPAD_PRESSED_CLASS = 'pressed';

/** Body class of the overlay layout. */
export const TOUCH_OVERLAY_CLASS = 'touch-overlay';
/** Body class set by full screen mode (native or CSS only). */
export const FULLSCREEN_CLASS = 'fullscreen-mode';
export const DPAD_SIDE_CLASSES: Record<DpadSide, string> = { left: 'dpad-left', right: 'dpad-right' };
export const ORIENTATION_CLASSES = { landscape: 'orientation-landscape', portrait: 'orientation-portrait' } as const;

/** Media queries the decision reads. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
export const STANDALONE_QUERIES: readonly string[] = ['(display-mode: fullscreen)', '(display-mode: standalone)'];

/** Ids of the overlay elements. */
export const TOUCH_PAD_ID = 'mobile-touch-bar';
export const TOUCH_CLUSTER_ID = 'touch-overlay-controls';
/** The pad itself: the part of the touch bar the camera must keep the player clear of. */
export const TOUCH_PAD_AREA_SELECTOR = '#mobile-touch-bar .dpad-container';
export const OVERLAY_HUD_SELECTOR = '.hud-panel';
/** The Pause / Undo / Menu button cluster. */
export const TOUCH_CLUSTER_SELECTOR = `#${TOUCH_CLUSTER_ID}`;
/** Every element that sits in the strip the camera keeps clear: the pad, the button cluster and the HUD. */
export const OVERLAY_STRIP_SELECTORS: readonly string[] = [
  TOUCH_PAD_AREA_SELECTOR,
  TOUCH_CLUSTER_SELECTOR,
  OVERLAY_HUD_SELECTOR
];

/** Attribute names the module toggles. */
const INERT_ATTRIBUTE = 'inert';

/** Largest fraction of the canvas a camera inset may take, matching the renderer contract. */
export const MAX_CAMERA_INSET = 0.5;
/** The camera keeps the player this fraction of a tile clear of the pad. */
export const CAMERA_INSET_TILE_MARGIN = 0.5;

export interface TouchOverlayInput {
  /** `body.fullscreen-mode` is present. Read from the class, not from document.fullscreenElement: iPhone Safari keeps the class when requestFullscreen fails. */
  fullscreenClass: boolean;
  /** The page runs as an installed app in full screen or standalone display mode. */
  standalone: boolean;
  /** The primary pointer is a finger. */
  coarse: boolean;
  /** Smaller of the window width and height, in CSS pixels. */
  shortSide: number;
  /** Which view is on screen. */
  mode: 'play' | 'editor';
}

/** True when the overlay layout applies: full screen on a touch phone, in the play view. */
export function resolveTouchOverlay(input: TouchOverlayInput): boolean {
  if (input.mode !== 'play') return false;
  if (!input.coarse) return false;
  if (!(input.fullscreenClass || input.standalone)) return false;
  return input.shortSide <= TOUCH_OVERLAY_MAX_SHORT_SIDE_PX;
}

/** Anything but 'left' is the default side: a stored value can be edited or stale. */
export function parseDpadSide(value: unknown): DpadSide {
  return value === 'left' ? 'left' : DEFAULT_DPAD_SIDE;
}

/** Reads the browser state the decision needs. */
export function readTouchOverlayInput(win: Window, body: HTMLElement, mode: 'play' | 'editor'): TouchOverlayInput {
  const matches = (query: string): boolean => typeof win.matchMedia === 'function' && win.matchMedia(query).matches;
  return {
    fullscreenClass: body.classList.contains(FULLSCREEN_CLASS),
    standalone: STANDALONE_QUERIES.some(matches),
    coarse: matches(COARSE_POINTER_QUERY),
    shortSide: Math.min(win.innerWidth, win.innerHeight),
    mode
  };
}

export interface TouchOverlayState {
  active: boolean;
  side: DpadSide;
  landscape: boolean;
}

/** Sets the overlay body classes; an inactive overlay leaves no class behind. */
export function applyTouchOverlayClasses(body: HTMLElement, state: TouchOverlayState): void {
  const all = [
    TOUCH_OVERLAY_CLASS,
    ...Object.values(DPAD_SIDE_CLASSES),
    ...Object.values(ORIENTATION_CLASSES)
  ];
  body.classList.remove(...all);
  if (!state.active) return;
  body.classList.add(
    TOUCH_OVERLAY_CLASS,
    DPAD_SIDE_CLASSES[state.side],
    state.landscape ? ORIENTATION_CLASSES.landscape : ORIENTATION_CLASSES.portrait
  );
}

/**
 * While the pause / end card shows, the pad and the button cluster must never take a touch
 * meant for the card (the pad could sit over Resume): they are made inert.
 */
export function syncOverlayInert(doc: Document, overlayActive: boolean, cardVisible: boolean): void {
  const inert = overlayActive && cardVisible;
  for (const id of [TOUCH_PAD_ID, TOUCH_CLUSTER_ID]) {
    const el = doc.getElementById(id);
    if (!el) continue;
    // Called every tick: touch the DOM only when the state changes.
    if (inert === el.hasAttribute(INERT_ATTRIBUTE)) continue;
    if (inert) el.setAttribute(INERT_ATTRIBUTE, '');
    else el.removeAttribute(INERT_ATTRIBUTE);
  }
}

/** Groups the HUD for assistive technology while it floats over the board; plain markup otherwise. */
export function syncHudGroup(hud: Element | null, overlayActive: boolean, label: string): void {
  if (!hud) return;
  if (overlayActive) {
    hud.setAttribute('role', 'group');
    hud.setAttribute('aria-label', label);
  } else {
    hud.removeAttribute('role');
    hud.removeAttribute('aria-label');
  }
}

/**
 * The owned items shown in the floating HUD are a status strip: a tap, a key or a screen reader
 * must never drop one. The strip is inert in the overlay layout and active again elsewhere.
 */
export function syncInventoryInert(hud: Element | null, overlayActive: boolean): void {
  if (!hud) return;
  for (const strip of Array.from(hud.querySelectorAll('.inventory-row-split'))) {
    if (overlayActive) strip.setAttribute(INERT_ATTRIBUTE, '');
    else strip.removeAttribute(INERT_ATTRIBUTE);
  }
}

export interface InsetRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CameraInsetsFractions {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_CAMERA_INSETS: CameraInsetsFractions = { left: 0, right: 0, top: 0, bottom: 0 };

function fractionOf(covered: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(covered)) return 0;
  return Math.min(MAX_CAMERA_INSET, Math.max(0, covered / total));
}

/** A box with no area (a hidden element) takes no part in the strip. */
function hasArea(rect: InsetRect): boolean {
  return rect.right > rect.left && rect.bottom > rect.top;
}

/**
 * The part of the canvas the pad, the button cluster and the HUD hide, as fractions of the canvas,
 * plus half a tile of air. Landscape: the pad's side, up to the extreme edge of the rects.
 * Portrait: the bottom, up to the highest rect. Zeros outside overlay mode.
 */
export function computeCameraInsets(args: {
  active: boolean;
  landscape: boolean;
  side: DpadSide;
  canvas: InsetRect;
  /** Boxes of the elements that float over the reserved strip; empty boxes are ignored. */
  rects: readonly InsetRect[];
  tilePx: number;
}): CameraInsetsFractions {
  if (!args.active) return NO_CAMERA_INSETS;
  const { canvas } = args;
  const used = args.rects.filter(hasArea);
  if (used.length === 0) return NO_CAMERA_INSETS;
  const top = Math.min(...used.map((r) => r.top));
  const left = Math.min(...used.map((r) => r.left));
  const right = Math.max(...used.map((r) => r.right));
  const margin = Math.max(0, args.tilePx) * CAMERA_INSET_TILE_MARGIN;
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  if (!args.landscape) {
    return { ...NO_CAMERA_INSETS, bottom: fractionOf(canvas.bottom - top + margin, height) };
  }
  if (args.side === 'left') {
    return { ...NO_CAMERA_INSETS, left: fractionOf(right - canvas.left + margin, width) };
  }
  return { ...NO_CAMERA_INSETS, right: fractionOf(canvas.right - left + margin, width) };
}

/** Shows the saved side in the select and reports each change by the player. */
export function bindDpadSideSelect(
  select: HTMLSelectElement | null,
  initial: DpadSide,
  onChange: (side: DpadSide) => void
): void {
  if (!select) return;
  select.value = initial;
  select.addEventListener('change', () => onChange(parseDpadSide(select.value)));
}

/**
 * Watches the HUD and the button cluster: their size changes with the level, the items held and the
 * language, and the camera insets come from their rects. Returns a function that stops the watch;
 * a no-op where ResizeObserver does not exist.
 */
export function observeOverlayStrip(doc: Document, onChange: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => onChange());
  for (const selector of [OVERLAY_HUD_SELECTOR, TOUCH_CLUSTER_SELECTOR]) {
    const el = doc.querySelector(selector);
    if (el) observer.observe(el);
  }
  return () => observer.disconnect();
}
