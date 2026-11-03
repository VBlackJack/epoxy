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
 * UI tuning values that have no key in game.json. Optional game.json values
 * keep their fallback here so every default has a name.
 */

/** Difficulty range offered by the editor's level generator. */
export const EDITOR_GENERATOR_MIN_LEVEL = 1;
export const EDITOR_GENERATOR_MAX_LEVEL = 50;

/** How long a transient status toast stays visible. */
export const TOAST_DURATION_MS = 4500;

/** Storage key suffix (under the game prefix) remembering whether the drawer's Advanced section is open. */
export const DRAWER_ADVANCED_STORAGE_SUFFIX = 'drawer_advanced_open';
/** Values stored under that key. */
export const DRAWER_ADVANCED_OPEN_VALUE = '1';
export const DRAWER_ADVANCED_CLOSED_VALUE = '0';

/** Delay before an object URL handed to a download link is revoked. */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/** Fallbacks for the optional game.json "touch" section. */
export const TOUCH_DEFAULTS = {
  swipeDeadzonePx: 20,
  tapMaxDistancePx: 14,
  tapMaxDurationMs: 280,
  hapticPulseMs: 10
} as const;

/**
 * Fraction of the swipe dead zone the anchor trails behind the finger, so a
 * 90 or 180 degree turn mid-drag registers immediately.
 */
export const SWIPE_ANCHOR_FOLLOW_RATIO = 0.55;

/** Fallbacks for optional game.json "timing" values. */
export const TIMING_DEFAULTS = {
  goldTimeRatio: 0.5,
  silverTimeRatio: 0.25,
  lowTimeWarningSeconds: 10,
  maxUndoSnapshots: 100
} as const;

/** Fallback for the optional game.json "graphics" theme value. */
export const DEFAULT_THEME_ID = 'cyber_neon';
/** Theme setting meaning: each level shows its own theme. */
export const AUTO_THEME_ID = 'auto';

/** Gamepad handling (standard mapping). */
export const GAMEPAD_INDEX = 0;
export const GAMEPAD_AXIS_THRESHOLD = 0.5;
export const GAMEPAD_AXIS_X = 0;
export const GAMEPAD_AXIS_Y = 1;
export const GAMEPAD_BUTTONS = {
  B: 1,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15
} as const;

/** Canvas sizing. */
export const MIN_VIEWPORT_SYNC_PX = 64;
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const CANVAS_RESIZE_TOLERANCE_PX = 2;

/** Number of digits shown on the LED counters of the HUD. */
export const HUD_COUNTER_DIGITS = 3;

/** CSS variable holding the accent colour of the biome on screen. */
export const BIOME_ACCENT_CSS_VAR = '--biome-accent';

/** Class that replays a short pop animation on a HUD element; removed when it ends. */
export const HUD_BUMP_CLASS = 'hud-bump';

/** Key items whose count is unlimited once collected. */
export const INFINITE_KEY_IDS: ReadonlySet<string> = new Set(['key_green']);

/** Editor defaults for a blank map. */
export const CUSTOM_LEVEL_ID_PREFIX = 'custom_';
export const EDITOR_DEFAULT_PASSWORD = 'EDIT';
export const EDITOR_PASSWORD_LENGTH = 4;
export const EDITOR_DEFAULT_TIME_LIMIT_SECONDS = 180;
export const EDITOR_DEFAULT_CHIPS_REQUIRED = 4;
export const EDITOR_DEFAULT_CLONE_TEMPLATE = 'dirt_block';
export const EDITOR_LINK_LINE_WIDTH = 2;
export const EDITOR_TRAP_LINK_COLOR = '#ffb300';
export const EDITOR_CLONE_LINK_COLOR = '#ff1744';
/** Offset that puts a link line end at the center of its tile. */
export const EDITOR_TILE_CENTER_OFFSET = 0.5;
/** Terrain a wire tool places at each end of a link. */
export const EDITOR_TRAP_BUTTON_TILE = 'button_brown';
export const EDITOR_TRAP_TILE = 'trap';
export const EDITOR_CLONE_BUTTON_TILE = 'button_red';
export const EDITOR_CLONER_TILE = 'clone_machine';
/** Largest tile the editor canvas shows, in CSS pixels; the smallest is the configured editor tile size. */
export const EDITOR_MAX_TILE_SIZE = 64;
/** CSS pixels one zoom step adds to or removes from the tile, and how many steps each way from the fit. */
export const EDITOR_ZOOM_TILE_STEP = 8;
export const EDITOR_ZOOM_STEPS_EACH_WAY = 6;
/** Mouse button number of a pen eraser. */
export const POINTER_ERASER_BUTTON = 5;
/** Editor layout: the view width, in CSS pixels, under which it drops to two columns, then to one. */
export const EDITOR_TWO_COLUMN_BELOW_WIDTH = 1100;
export const EDITOR_ONE_COLUMN_BELOW_WIDTH = 680;
/** Delay after the last edit before the Check badge is recomputed. */
export const EDITOR_CHECK_DEBOUNCE_MS = 400;
/** How long the block check may search before it is reported as not checked. */
export const EDITOR_BLOCK_CHECK_TIMEOUT_MS = 30000;
/** Colours of the canvas overlays: hover outline, keyboard cursor, pending wire source. */
export const EDITOR_HOVER_OUTLINE_COLOR = '#ffffff';
export const EDITOR_CURSOR_OUTLINE_COLOR = '#00e5ff';
export const EDITOR_WIRE_SOURCE_COLOR = '#ffd600';
export const EDITOR_OVERLAY_LINE_WIDTH = 2;
/** Selection overlay: outline colour, dash pattern (on, off in pixels), and the dim laid over cells outside it. */
export const EDITOR_SELECTION_OUTLINE_COLOR = '#ff4081';
export const EDITOR_SELECTION_DASH: readonly number[] = [6, 4];
export const EDITOR_SELECTION_DIM_COLOR = 'rgba(0, 0, 0, 0.35)';
/** Opacity of the floating paste preview and of the outline of a selection being dragged. */
export const EDITOR_PASTE_PREVIEW_ALPHA = 0.65;
/** CC3D editing: colours of the link overlay arrows, by kind of link. */
export const EDITOR_CC3D_LINK_COLORS = {
  trap: '#ffb300',
  teleport: '#00e5ff',
  clone: '#ff1744',
  template: '#ff80ab',
  laser: '#76ff03',
  group: '#ffffff'
} as const;
/** CC3D link overlay: arrow head length and half-width as a share of the tile, and the badge radius. */
export const EDITOR_CC3D_ARROW_HEAD_TILE = 0.3;
export const EDITOR_CC3D_ARROW_HEAD_SPREAD = 0.5;
export const EDITOR_CC3D_BADGE_RADIUS_TILE = 0.18;
/** CC3D link overlay: opacity of the arrows and of the highlighted group cells. */
export const EDITOR_CC3D_OVERLAY_ALPHA = 0.9;
/** CC3D editing: swatch colours of the colour chooser. */
export const EDITOR_CC3D_SWATCH_COLORS = {
  red: '#e53935',
  green: '#43a047',
  blue: '#1e88e5',
  yellow: '#fdd835'
} as const;
/** CC3D thin wall mode: line width of the bar that shows the side a click toggles. */
export const EDITOR_CC3D_SIDE_HINT_LINE_WIDTH = 4;
/** Largest canvas, in pixels, whose CC3D map is also kept in an off-screen layer (beyond it the map is drawn directly). */
export const EDITOR_STATIC_LAYER_MAX_PIXELS = 16_777_216;
/** Share of a CC3D map's cells that may have changed for the off-screen layer to be patched cell by cell rather than redrawn whole. */
export const EDITOR_STATIC_LAYER_REDRAW_SHARE = 0.25;
/** Most link changes the status line spells out after one edit; the rest are counted. */
export const EDITOR_CC3D_MAX_LINK_MESSAGES = 3;
/** Size of the "Empty CC3D room" the New dialog offers, in cells. */
export const EDITOR_CC3D_ROOM_WIDTH = 16;
export const EDITOR_CC3D_ROOM_HEIGHT = 12;
/** Zoom shown as a percentage of the base tile size. */
export const EDITOR_PERCENT_BASE = 100;
/** Pack-manager level row: the buttons whose focus is restored after the list is redrawn. */
export const PACK_MANAGER_FOCUS_ATTRIBUTE = 'data-focus-key';
/** Arrows of the compact move buttons of a pack level row. */
export const PACK_MOVE_UP_GLYPH = '↑';
export const PACK_MOVE_DOWN_GLYPH = '↓';
/** Pack-manager thumbnails: bytes per RGBA pixel and the alpha of a painted one. */
export const THUMBNAIL_BYTES_PER_PIXEL = 4;
export const THUMBNAIL_OPAQUE_ALPHA = 255;
/** Colours of the single pixels that mark entities and the player start, and of a tile the table does not know. */
export const THUMBNAIL_ENTITY_COLOR = '#ff2bd6';
export const THUMBNAIL_PLAYER_COLOR = '#00e5ff';
export const THUMBNAIL_FALLBACK_COLOR = '#808080';
/** Side, in cells, and palette keys of the chequerboard shown for a level whose map is not read (cc3d). */
export const THUMBNAIL_PLACEHOLDER_CELLS = 8;
export const THUMBNAIL_PLACEHOLDER_PALETTE_KEYS = ['floorBorder', 'wallBase'] as const;
/** Box, in CSS pixels, a level thumbnail and a library row thumbnail are fitted in. */
export const THUMBNAIL_LEVEL_BOX = 64;
export const THUMBNAIL_LIBRARY_BOX = 32;
/** Levels of a shared pack drawn as thumbnails in its preview. */
export const SHARE_PREVIEW_THUMBNAIL_COUNT = 6;
/** Longest wait for the clipboard before the link is shown for a copy by hand, in ms. */
export const SHARE_COPY_TIMEOUT_MS = 2000;
/** Glyph of the drag handle of a pack level row. */
export const PACK_DRAG_HANDLE_GLYPH = '\u2807';
/** Pack-manager drag: how close to the edge of the scrolling list, in CSS pixels, the pointer starts scrolling it, and by how much per move. */
export const PACK_DRAG_SCROLL_EDGE_PX = 32;
export const PACK_DRAG_SCROLL_STEP_PX = 10;
/** Pixels the pointer must travel before a press on a handle counts as a drag. */
export const PACK_DRAG_START_DISTANCE_PX = 4;
