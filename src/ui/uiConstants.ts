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

/** Delay before an object URL handed to a download link is revoked. */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/** Fallbacks for the optional game.json "touch" section. */
export const TOUCH_DEFAULTS = {
  swipeDeadzonePx: 20,
  tapMaxDistancePx: 14,
  tapMaxDurationMs: 280,
  pinchZoomStepPx: 42,
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

/** Fallbacks for optional game.json "graphics" values. */
export const DEFAULT_GRAPHICS_STYLE = 'modern';
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

/** Pixel size of one tile on the radar minimap. */
export const MINIMAP_TILE_PX = 3;

/** Number of digits shown on the LED counters of the HUD. */
export const HUD_COUNTER_DIGITS = 3;

/** CSS variable holding the accent colour of the biome on screen. */
export const BIOME_ACCENT_CSS_VAR = '--biome-accent';

/** Class that replays a short pop animation on a HUD element; removed when it ends. */
export const HUD_BUMP_CLASS = 'hud-bump';

/** Music track played for each visual theme. */
export const THEME_MUSIC_TRACKS: Readonly<Record<string, string>> = {
  cyber_neon: 'cyber_pulse',
  arctic_lab: 'arctic_synth',
  magma_core: 'magma_drive',
  lynx_lcd: 'cyber_pulse'
};

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
