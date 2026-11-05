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

import { FLOOR_TILE_ID } from '../core/coreConstants';
import type { Direction, Ruleset } from '../core/types';
import {
  EDITOR_CLONE_BUTTON_TILE,
  EDITOR_CLONER_TILE,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_SHOT_LAUNCHER_TILES,
  EDITOR_SHOT_TRIGGER_TILE,
  EDITOR_TRAP_BUTTON_TILE,
  EDITOR_TRAP_TILE
} from '../ui/uiConstants';
import type { LinkSystem } from './mapEdits';
import type { Clip } from './selectionEdits';

/**
 * Mechanism stamps: small ready-made clips (a button, one floor cell, the device it works) with their link, loaded into
 * the floating paste. They are plain data: the editor places them through the one paste path, so the preview, the ring,
 * the ruleset rules and the single undo step are the paste's own.
 */

/** How a stamp lies on the map: its three cells in a row, or in a column. */
export type StampLayout = 'horizontal' | 'vertical';

/** Cells of a stamp: the button, one floor cell, the device it works. */
const STAMP_LENGTH = 3;
/** Position of the button in the row (or column) of a stamp. */
const STAMP_BUTTON_INDEX = 0;
/** Position of the device the button works in the row (or column) of a stamp. */
const STAMP_TARGET_INDEX = STAMP_LENGTH - 1;
/** The side of the device on which the button lies, by layout: what a cloned creature or block faces. */
const SIDE_OF_BUTTON: Readonly<Record<StampLayout, Direction>> = { horizontal: 'W', vertical: 'N' };
/**
 * The way a stamp's launcher faces, by layout: away from its trigger. A launcher that faced the trigger would send its
 * shot over the player standing on it (the shot reaches the trigger cell within the player's move cooldown).
 */
const LAUNCHER_FACING: Readonly<Record<StampLayout, Direction>> = { horizontal: 'E', vertical: 'S' };

/** The first layout of a stamp, and the one Shift+R turns it to and from. */
export const STAMP_DEFAULT_LAYOUT: StampLayout = 'horizontal';

/** The layout a stamp takes when it is turned. */
export function turnedStampLayout(layout: StampLayout): StampLayout {
  return layout === 'horizontal' ? 'vertical' : 'horizontal';
}

export interface MechanismStamp {
  id: string;
  /** Locale key of the stamp's name. */
  i18nKey: string;
  /** Locale key of its one-line description. */
  descI18nKey: string;
  /** The link system the stamp's pair works in. */
  system: LinkSystem;
  /** The rulesets whose rules play it. */
  rulesets: readonly Ruleset[];
  /** Terrain of the button end. */
  buttonTile: string;
  /** Terrain of the device end, given the way a launcher placed there would face. */
  targetTile: (launcherFacing: Direction) => string;
  /** The entity that stands on the device end (the creature or block a clone machine clones), if any. */
  targetEntity?: string;
}

/**
 * The stamps, in menu order. A launcher faces away from its trigger, so its shot never crosses the cell the player
 * presses the trigger from; the author places the stamp with floor in front of the launcher (the validator warns when a
 * launcher faces a wall).
 */
export const MECHANISM_STAMPS: readonly MechanismStamp[] = [
  {
    id: 'trap',
    i18nKey: 'editor.stamps.trap.label',
    descI18nKey: 'editor.stamps.trap.desc.label',
    system: 'trap',
    rulesets: ['epoxy', 'lynx'],
    buttonTile: EDITOR_TRAP_BUTTON_TILE,
    targetTile: () => EDITOR_TRAP_TILE
  },
  {
    id: 'clone',
    i18nKey: 'editor.stamps.clone.label',
    descI18nKey: 'editor.stamps.clone.desc.label',
    system: 'clone',
    rulesets: ['epoxy', 'lynx'],
    buttonTile: EDITOR_CLONE_BUTTON_TILE,
    targetTile: () => EDITOR_CLONER_TILE,
    targetEntity: EDITOR_DEFAULT_CLONE_TEMPLATE
  },
  {
    id: 'shot',
    i18nKey: 'editor.stamps.shot.label',
    descI18nKey: 'editor.stamps.shot.desc.label',
    system: 'shot',
    rulesets: ['epoxy'],
    buttonTile: EDITOR_SHOT_TRIGGER_TILE,
    targetTile: (launcherFacing) => EDITOR_SHOT_LAUNCHER_TILES[launcherFacing]
  }
];

/** The stamps a level of this ruleset can place, in menu order; none for a CC3D level. */
export function mechanismStampsFor(ruleset: Ruleset): MechanismStamp[] {
  return MECHANISM_STAMPS.filter((stamp) => stamp.rulesets.includes(ruleset));
}

const clipCache = new Map<string, Clip>();

/** The cell `index` of a stamp, relative to the stamp's top-left cell. */
function cellOf(layout: StampLayout, index: number): { dx: number; dy: number } {
  return layout === 'horizontal' ? { dx: index, dy: 0 } : { dx: 0, dy: index };
}

/**
 * The stamp as a clip in the given layout, links included. The clip is shared between calls: it is never changed once
 * built, as a clip never is.
 */
export function mechanismStampClip(stamp: MechanismStamp, layout: StampLayout): Clip {
  const key = `${stamp.id}:${layout}`;
  const cached = clipCache.get(key);
  if (cached) return cached;
  const side = SIDE_OF_BUTTON[layout];
  const width = layout === 'horizontal' ? STAMP_LENGTH : 1;
  const height = layout === 'horizontal' ? 1 : STAMP_LENGTH;
  const terrain: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => FLOOR_TILE_ID));
  const button = cellOf(layout, STAMP_BUTTON_INDEX);
  const target = cellOf(layout, STAMP_TARGET_INDEX);
  terrain[button.dy][button.dx] = stamp.buttonTile;
  terrain[target.dy][target.dx] = stamp.targetTile(LAUNCHER_FACING[layout]);
  const ends = { buttonX: button.dx, buttonY: button.dy };
  const clip: Clip = {
    width,
    height,
    terrain,
    items: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
    entities: stamp.targetEntity ? [{ dx: target.dx, dy: target.dy, type: stamp.targetEntity, dir: side }] : [],
    ...(stamp.system === 'trap' ? { trapLinks: [{ ...ends, trapX: target.dx, trapY: target.dy }] } : {}),
    ...(stamp.system === 'clone'
      ? { cloneLinks: [{ ...ends, clonerX: target.dx, clonerY: target.dy, templateType: stamp.targetEntity ?? EDITOR_DEFAULT_CLONE_TEMPLATE, templateDir: side }] }
      : {}),
    ...(stamp.system === 'shot' ? { launcherLinks: [{ ...ends, launcherX: target.dx, launcherY: target.dy }] } : {}),
    playerStart: null
  };
  clipCache.set(key, clip);
  return clip;
}
