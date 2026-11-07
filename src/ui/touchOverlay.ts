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
/** Body class: the side drawers and the top status strip replace the HUD panel (phone layout with the floating control). */
export const TOUCH_DRAWERS_CLASS = 'touch-drawers';
/** Body class: the floating joystick steers, the fixed pad is hidden. */
export const JOYSTICK_FLOATING_CLASS = 'joystick-floating';
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

/** The status strip at the top of the board in the drawer layout. */
export const TOUCH_STRIP_ID = 'touch-strip';
export const TOUCH_STRIP_SELECTOR = `#${TOUCH_STRIP_ID}`;
/** The bottom corner cluster (Undo and the drop buttons) in the drawer layout; the same element as the old button cluster. */
export const TOUCH_BOTTOM_CLUSTER_SELECTOR = TOUCH_CLUSTER_SELECTOR;
/**
 * What the camera keeps clear in the drawer layout: the top strip and the bottom cluster. The drawers
 * are never measured: they cover the board only while open, and an open drawer freezes the game.
 */
export const DRAWER_STRIP_SELECTORS: readonly string[] = [TOUCH_STRIP_SELECTOR, TOUCH_BOTTOM_CLUSTER_SELECTOR];
/** The selectors the camera insets read, and the strip observer watches. */
export function getOverlayStripSelectors(drawers: boolean): readonly string[] {
  return drawers ? DRAWER_STRIP_SELECTORS : OVERLAY_STRIP_SELECTORS;
}

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

/** How a phone player steers: a joystick that appears under the thumb, or the fixed directional pad. */
export type TouchControl = 'floating' | 'fixed';

/** Phones get the floating joystick unless the player switched back to the fixed pad. */
export const DEFAULT_TOUCH_CONTROL: TouchControl = 'floating';

/** Anything but 'fixed' is the default: a stored value can be edited or stale. */
export function parseTouchControl(value: unknown): TouchControl {
  return value === 'fixed' ? 'fixed' : DEFAULT_TOUCH_CONTROL;
}

/** Haptics are on unless the stored value is explicitly false. */
export function parseHapticsEnabled(value: unknown): boolean {
  return value !== false;
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
  /** Drawer layout: the `touch-drawers` class. Ignored while the overlay is off. */
  drawers?: boolean;
  /** Floating joystick: the `joystick-floating` class. Ignored while the overlay is off. */
  floating?: boolean;
}

/** The layout modes a touch control setting selects: both belong to the floating control, neither to the fixed pad. */
export function resolveTouchLayoutModes(active: boolean, control: TouchControl): { drawers: boolean; floating: boolean } {
  const floating = active && control === 'floating';
  return { drawers: floating, floating };
}

/** Sets the overlay body classes; an inactive overlay leaves no class behind. */
export function applyTouchOverlayClasses(body: HTMLElement, state: TouchOverlayState): void {
  const all = [
    TOUCH_OVERLAY_CLASS,
    ...Object.values(DPAD_SIDE_CLASSES),
    ...Object.values(ORIENTATION_CLASSES),
    TOUCH_DRAWERS_CLASS,
    JOYSTICK_FLOATING_CLASS
  ];
  body.classList.remove(...all);
  if (!state.active) return;
  body.classList.add(
    TOUCH_OVERLAY_CLASS,
    DPAD_SIDE_CLASSES[state.side],
    state.landscape ? ORIENTATION_CLASSES.landscape : ORIENTATION_CLASSES.portrait
  );
  if (state.drawers) body.classList.add(TOUCH_DRAWERS_CLASS);
  if (state.floating) body.classList.add(JOYSTICK_FLOATING_CLASS);
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

/**
 * Groups the HUD for assistive technology while it floats over the board; plain markup otherwise.
 * While the drawers are active the HUD panel is a dialog (see touchDrawers.ts) and keeps no group role:
 * a leftover group role and label from the floating HUD are removed, the dialog attributes are not touched.
 */
export function syncHudGroup(hud: Element | null, overlayActive: boolean, label: string, drawersActive = false): void {
  if (!hud) return;
  if (overlayActive && drawersActive) {
    if (hud.getAttribute('role') === 'group') hud.removeAttribute('role');
    // The drawer is named by aria-labelledby: a label left from the floating HUD would override it.
    hud.removeAttribute('aria-label');
    return;
  }
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
  /**
   * Top mode (drawer layout): boxes pinned to the top of the board, such as the status strip. The camera
   * keeps clear of them down to the lowest bottom edge, plus half a tile. Absent in the classic layout,
   * where the result is exactly what it was before this mode existed.
   */
  topRects?: readonly InsetRect[];
}): CameraInsetsFractions {
  if (!args.active) return NO_CAMERA_INSETS;
  const { canvas } = args;
  const margin = Math.max(0, args.tilePx) * CAMERA_INSET_TILE_MARGIN;
  const height = canvas.bottom - canvas.top;
  const usedTop = (args.topRects ?? []).filter(hasArea);
  const topInset =
    usedTop.length === 0
      ? 0
      : fractionOf(Math.max(...usedTop.map((r) => r.bottom)) - canvas.top + margin, height);
  const used = args.rects.filter(hasArea);
  if (used.length === 0) return topInset > 0 ? { ...NO_CAMERA_INSETS, top: topInset } : NO_CAMERA_INSETS;
  const top = Math.min(...used.map((r) => r.top));
  const left = Math.min(...used.map((r) => r.left));
  const right = Math.max(...used.map((r) => r.right));
  const width = canvas.right - canvas.left;
  if (!args.landscape) {
    return { ...NO_CAMERA_INSETS, top: topInset, bottom: fractionOf(canvas.bottom - top + margin, height) };
  }
  if (args.side === 'left') {
    return { ...NO_CAMERA_INSETS, top: topInset, left: fractionOf(right - canvas.left + margin, width) };
  }
  return { ...NO_CAMERA_INSETS, top: topInset, right: fractionOf(canvas.right - left + margin, width) };
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
export function observeOverlayStrip(
  doc: Document,
  onChange: () => void,
  selectors: readonly string[] = [OVERLAY_HUD_SELECTOR, TOUCH_CLUSTER_SELECTOR]
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => onChange());
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) observer.observe(el);
  }
  return () => observer.disconnect();
}
