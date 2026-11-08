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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DEFAULT_PLAYER_CHARACTER, FIRE_LAUNCHERS_ACTION, FLEE_PLAYER_PATTERN, HIKING_BOOTS_ITEM_ID, PHASE_LINE_PATTERN, PULSE_WIRED_ACTION, STEER_MONSTERS_ACTION, channelOfButtonAction } from './coreConstants';
import { CompiledLevel } from './types';

/**
 * The play aids a ruleset supports. Each aid was built on the Epoxy engine,
 * so a Lynx level only gets the ones that do not depend on it.
 */
export interface RulesetFeatures {
  /** Click or tap on the board plans a path to the tile. */
  tapToPath: boolean;
  /** The objective marker and the help that points to the next goal. */
  objectiveMarker: boolean;
  /** The hint that plays the next push of a block puzzle. */
  blockHint: boolean;
  /** The watch that warns when block puzzles reach a dead end. */
  deadEndWatch: boolean;
  /** The stored solution and its replay. */
  solutionReplay: boolean;
  /** Putting a held key or pair of boots down. */
  itemDrop: boolean;
  /** Replaying the run behind a high score. */
  highScoreReplay: boolean;
}

const EPOXY_FEATURES: RulesetFeatures = {
  tapToPath: true,
  objectiveMarker: true,
  blockHint: true,
  deadEndWatch: true,
  solutionReplay: true,
  itemDrop: true,
  highScoreReplay: true
};

const LYNX_FEATURES: RulesetFeatures = {
  tapToPath: false,
  objectiveMarker: false,
  blockHint: false,
  deadEndWatch: false,
  solutionReplay: false,
  itemDrop: false,
  highScoreReplay: true
};

/** CC3D levels are played by their own engine: no Epoxy play aid applies, only the high score replay. */
const CC3D_FEATURES: RulesetFeatures = {
  tapToPath: false,
  objectiveMarker: false,
  blockHint: false,
  deadEndWatch: false,
  solutionReplay: false,
  itemDrop: false,
  highScoreReplay: true
};

/** The aids that stay off on a level with lasers: both search for pushes that cover buttons or targets. */
const LASER_LEVEL_FEATURES: RulesetFeatures = { ...EPOXY_FEATURES, blockHint: false, deadEndWatch: false };

/** The aids a laser level won by lighting receivers also loses: its goal is not a place to walk to. */
const RECEIVER_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, objectiveMarker: false };

/**
 * The aids that stay off on a level with colour channels (plates, hold doors, colour walls and blocks):
 * the hint and the watch model pushes onto buttons and targets, not plates, and a tapped path does not
 * press a plate to hold a door open.
 */
const COLOR_LEVEL_FEATURES: RulesetFeatures = {
  ...EPOXY_FEATURES,
  tapToPath: false,
  blockHint: false,
  deadEndWatch: false
};

/** Laser aids win for what a laser level already loses; the colour aids are turned off too. */
const LASER_COLOR_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, tapToPath: COLOR_LEVEL_FEATURES.tapToPath };

/** A receivers level with colour content: the receivers aids and the colour aids are both off. */
const RECEIVER_COLOR_LEVEL_FEATURES: RulesetFeatures = {
  ...RECEIVER_LEVEL_FEATURES,
  tapToPath: COLOR_LEVEL_FEATURES.tapToPath
};

/**
 * True when the tile id is a laser emitter, receiver or gate, a shot launcher or a shot trigger, as the tile
 * config defines them. Shots count as laser content: they are stopped and turned by the same mirrors and
 * walls, and the aids that skip laser levels skip them too.
 */
export function isLaserTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return (
    tile.laserEmitter !== undefined ||
    tile.laserReceiverGroup !== undefined ||
    tile.laserGateGroup !== undefined ||
    tile.shotLauncher !== undefined ||
    tile.buttonAction === FIRE_LAUNCHERS_ACTION
  );
}

/** True when the entity type is a laser mirror, as the monster config defines it. */
export function isMirrorEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.mirrorAxis !== undefined;
}

/** True when the entity type is a turret, a block that fires a short beam, as the monster config defines it. */
export function isTurretEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.turretBeam !== undefined;
}

/** True when the entity type is an arrow block, a pushable block that only moves toward a side showing an arrow, as the monster config defines it. */
export function isArrowBlockEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.pushArrows !== undefined;
}

/** True when the level places a turret, or links a clone machine to a turret template. */
export function hasTurretContent(level: Pick<CompiledLevel, 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>): boolean {
  return (
    (level.entities ?? []).some((e) => isTurretEntityType(e.type)) ||
    (level.cloneLinks ?? []).some((link) => isTurretEntityType(link.templateType))
  );
}

/** True when the level places a laser tile (terrain or item layer), a mirror or a turret, as the configs define them. */
export function hasLaserContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks' | 'launcherLinks'>>
): boolean {
  // A launcher or trigger can hide under a removable top, where the grids do not show it: its link does.
  if ((level.launcherLinks?.length ?? 0) > 0) return true;
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isLaserTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isMirrorEntityType(e.type)) || hasTurretContent(level);
}

/** True when the entity type is a steered monster (a puppet), which moves only when a steering pad is worked. */
export function isSteeredEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.steeredBy !== undefined;
}

/** True when the entity type is a monster that steps away from the player (a skitter). */
export function isFleeingEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.movementPattern === FLEE_PLAYER_PATTERN;
}

/** True when the tile id is a steering pad, the button that makes the puppets step. */
export function isSteeringTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).buttonAction === STEER_MONSTERS_ACTION;
}

/**
 * True when the level places a steering pad or a puppet, or links a clone machine to a puppet template.
 * A control hidden under a removable top (underlays) is not counted here, which is harmless: DAT refuses
 * underlays anyway, and the aids turn off when a puppet is present.
 */
export function hasSteeringContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>
): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isSteeringTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (
    (level.entities ?? []).some((e) => isSteeredEntityType(e.type)) ||
    (level.cloneLinks ?? []).some((link) => isSteeredEntityType(link.templateType))
  );
}

/** True when the level places a transmogrifier (terrain or item layer): a swap can create a monster only Epoxy plays. */
function hasTransmogrifierContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isTransmogrifierTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the level places a turn plate (terrain or item layer): only the Epoxy engine turns an arrow block. */
function hasTurnPlateContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isTurnPlateTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the level places a monster only the Epoxy engine plays (a puppet, a skitter, a lurker, a wisp or an arrow block), a steering pad, a transmogrifier, a turn plate, or a turning force floor. */
export function hasEpoxyOnlyMonsterContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks' | 'underlays'>>
): boolean {
  if (hasSteeringContent(level) || hasTransmogrifierContent(level) || hasTurnPlateContent(level) || hasForceCycleContent(level)) return true;
  const epoxyOnly = (type: string): boolean =>
    isFleeingEntityType(type) || isArrowBlockEntityType(type) || isLurkerEntityType(type) || isPhasingEntityType(type);
  return (
    (level.entities ?? []).some((e) => epoxyOnly(e.type)) || (level.cloneLinks ?? []).some((link) => epoxyOnly(link.templateType))
  );
}

/** True when the tile id is a colour channel tile: a plate, a hold door, a colour wall or button, or a floating block. */
export function isColorChannelTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return (
    tile.plateColor !== undefined ||
    tile.holdDoorColor !== undefined ||
    tile.toggleChannel !== undefined ||
    tile.floatingBlockColor !== undefined ||
    channelOfButtonAction(tile.buttonAction) !== undefined
  );
}

/** True when the entity type is a colour block, as the monster config defines it. */
export function isColorBlockEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.plateColor !== undefined;
}

/** True when the tile slows the monsters down while held, which no Lynx or CC3D rule has. */
export function isSlowTimeTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).slowsMonsters !== undefined;
}

/** True when the tile hastes the player while held, which no Lynx or CC3D rule has. */
export function isSpeedBootsTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).hastesPlayer !== undefined;
}

/** True when the tile is boots that reveal the hidden walls while held, which no Lynx or CC3D rule has. */
export function isEyeBootsTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).revealsHiddenWalls !== undefined;
}

/** True when any of the boots held reveals the hidden walls, whatever their id. */
export function bootsRevealHiddenWalls(boots: Iterable<string>): boolean {
  for (const bootId of boots) {
    if (ConfigRegistry.getTile(bootId).revealsHiddenWalls === true) return true;
  }
  return false;
}

/** True when the tile is boots that pull resting pushable blocks while held, which no Lynx or CC3D rule has. */
export function isPullBootsTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).pullsBlocks !== undefined;
}

/** True when any of the boots held pulls blocks, whatever their id. */
export function bootsPullBlocks(boots: Iterable<string>): boolean {
  for (const bootId of boots) {
    if (ConfigRegistry.getTile(bootId).pullsBlocks === true) return true;
  }
  return false;
}

/** True when the level places pull boots (terrain or item layer). */
export function hasPullBootsContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isPullBootsTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the tile is a ward, the boots that destroy the first monster touched and are used up by it. */
export function isWardTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).absorbsMonsterContact === true;
}

/** True when the tile is a blast charge, carried and dropped by the player, or the lit form it turns into. */
export function isChargeTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return tile.collectible === 'charge' || tile.litCharge === true;
}

/** True when the level places a blast charge (terrain or item layer). */
export function hasChargeContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isChargeTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the tile is a pocket gate, carried and set down by the player, or the portable pad it turns into. */
export function isPocketGateTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return tile.collectible === 'gate' || tile.portableTeleporter === true;
}

/** True when the level places a pocket gate or one of its pads (terrain, hidden terrain or item layer). */
export function hasPocketGateContent(
  level: Pick<CompiledLevel, 'terrain' | 'items'> & Partial<Pick<CompiledLevel, 'underlays'>>
): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isPocketGateTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items) || (level.underlays ?? []).some((under) => isPocketGateTileId(under.terrain));
}

/** True when the tile is a relay pad, lit or dark. */
export function isRelayPadTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).relayPad !== undefined;
}

/** True when the level places a relay pad (terrain layer; the level normalisation never keeps one hidden). */
export function hasRelayPadContent(level: Pick<CompiledLevel, 'terrain'>): boolean {
  return level.terrain?.some((row) => row.some(isRelayPadTileId)) ?? false;
}

/**
 * True when the tile is a wired device of the Chip's Challenge 2 family that no other rule carries: a purple wall or
 * floor, a wired flame jet (`wireTogglesTo`), a wired trap, or a gray area button. The toggle switch and the black
 * button are signal sources and are caught by isSignalTileId.
 */
export function isWiredDeviceTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return tile.wireTogglesTo !== undefined || tile.wiredTrap === true || tile.buttonAction === PULSE_WIRED_ACTION;
}

/**
 * True when the tile is part of the Chip's Challenge 2 items and characters: a green chip or bomb (`itemTogglesTo`), a
 * steel wall (`blastProof`), a gender sign (`characterOnly`), the hiking boots or a no-sign on the item layer.
 */
export function isCharacterContentTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id === HIKING_BOOTS_ITEM_ID) return true;
  const tile = ConfigRegistry.getTile(id);
  return (
    tile.itemTogglesTo !== undefined ||
    tile.blastProof === true ||
    tile.characterOnly !== undefined ||
    (tile.layer === 'item' && tile.forbiddenItem !== undefined)
  );
}

/** True when the tile is a hurl stone, carried and thrown by the player. */
export function isStoneTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).collectible === 'stone';
}

/** True when the level places a hurl stone (terrain or item layer). */
export function hasStoneContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isStoneTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the tile is a toll token, carried by the player and spent at a thief. */
export function isTokenTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).collectible === 'token';
}

/** True when the level places a toll token (terrain or item layer). */
export function hasTokenContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isTokenTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the tile is a rail piece (a straight, a bend or a switch), which closes the sides it is not open on. */
export function isRailTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).railSides !== undefined;
}

/** True when the tile id is a reserved id of a mechanic Epoxy does not play (a cc2_* terrain or item). */
export function isUnimplementedTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).unimplemented !== undefined;
}

/** True when the entity type is a reserved id of a monster or block Epoxy does not play (a cc2_* entity). */
export function isUnimplementedEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.unimplemented !== undefined;
}

/**
 * True when the item only exists under the Epoxy rules: the slow-time boots, the speed boots, the eye boots, the pull
 * boots, the ward, a blast charge, a hurl stone, a toll token, a pocket gate with its pad, a relay pad, a wired device, a reserved id of an unimplemented mechanic, or a rail piece (the pads and the
 * rails are terrain, but a DAT export would write them as a plain teleporter and as floor, so they are refused with the items).
 */
export function isEpoxyOnlyItemId(id: string | null | undefined): boolean {
  return (
    isSlowTimeTileId(id) || isSpeedBootsTileId(id) || isEyeBootsTileId(id) || isPullBootsTileId(id) || isWardTileId(id) ||
    isChargeTileId(id) || isStoneTileId(id) || isTokenTileId(id) || isPocketGateTileId(id) || isRelayPadTileId(id) || isWiredDeviceTileId(id) || isRailTileId(id) ||
    isCharacterContentTileId(id) || isUnimplementedTileId(id)
  );
}

/** True when the entity type is a lurker, asleep or awake, which only the Epoxy engine plays. */
export function isLurkerEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.epoxyOnly === true;
}

/** True when the entity type is a wisp: a monster that walks through every tile (movement pattern phase_line). */
export function isPhasingEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.movementPattern === PHASE_LINE_PATTERN;
}

/** True when the tile id is a transmogrifier, which swaps a monster arriving on it for its pair. */
export function isTransmogrifierTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).transmogrifies === true;
}

/** True when the tile id is a turn plate, which turns the arrows of an arrow block arriving on it. */
export function isTurnPlateTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).facingTurn !== undefined;
}

/** True when the tile id is a swivel door, which turns a quarter turn behind whoever passes through it. */
export function isSwivelTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).swivelTurns !== undefined;
}

/** True when the level places a swivel door (terrain or item layer). */
export function hasSwivelContent(level: Pick<CompiledLevel, 'terrain' | 'items'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isSwivelTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items);
}

/** True when the tile id is a signal source or a signal gate, which only exist under the Epoxy rules. */
export function isSignalTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return tile.signalSource !== undefined || tile.signalGate !== undefined;
}

/** True when the tile id is a turning force floor, whose direction is the next one of the level's shared turn. */
export function isForceCycleTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).forceCycle === true;
}

/** True when the tile only exists under the Epoxy rules: a laser tile, a colour channel tile, an Epoxy-only item (slow-time, speed or eye boots), a steering pad, a swivel door, a transmogrifier, a turn plate, a turning force floor or a signal tile. */
export function isEpoxyOnlyTileId(id: string | null | undefined): boolean {
  return (
    isLaserTileId(id) || isColorChannelTileId(id) || isEpoxyOnlyItemId(id) ||
    isSteeringTileId(id) || isSwivelTileId(id) || isTransmogrifierTileId(id) || isTurnPlateTileId(id) ||
    isSignalTileId(id) || isForceCycleTileId(id)
  );
}

/** True when the entity only exists under the Epoxy rules: a laser mirror, a turret, an arrow block, a colour block, a puppet, a skitter, a lurker or a wisp. */
export function isEpoxyOnlyEntityType(type: string): boolean {
  return (
    isMirrorEntityType(type) ||
    isTurretEntityType(type) ||
    isArrowBlockEntityType(type) ||
    isColorBlockEntityType(type) ||
    isSteeredEntityType(type) ||
    isFleeingEntityType(type) ||
    isLurkerEntityType(type) ||
    isPhasingEntityType(type)
  );
}

/** True when the level places a colour channel tile (terrain or item layer) or a colour block. */
export function hasColorChannelContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isColorChannelTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isColorBlockEntityType(e.type));
}

/** True when the level has signal wires, or places a signal source or gate (terrain or underlay layer). */
export function hasSignalContent(
  level: Partial<Pick<CompiledLevel, 'terrain' | 'underlays' | 'signalLinks'>>
): boolean {
  if ((level.signalLinks?.length ?? 0) > 0) return true;
  const underlays = level.underlays ?? [];
  if (!level.terrain?.length && underlays.length === 0) return false;
  // Without loaded configs no tile has a signal role (a level can be read before the configs are).
  const isSignalTile = (id: string | null | undefined): boolean => {
    if (!id) return false;
    try {
      const tile = ConfigRegistry.getTile(id);
      return tile.signalSource !== undefined || tile.signalGate !== undefined;
    } catch {
      return false;
    }
  };
  if (level.terrain?.some((row) => row.some(isSignalTile))) return true;
  return underlays.some((u) => isSignalTile(u.terrain));
}

/** True when the level places a turning force floor (terrain, item layer or an underlay hiding one). */
export function hasForceCycleContent(
  level: Pick<CompiledLevel, 'terrain' | 'items'> & Partial<Pick<CompiledLevel, 'underlays'>>
): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isForceCycleTileId)) ?? false;
  return hasTile(level.terrain) || hasTile(level.items) || (level.underlays ?? []).some((u) => isForceCycleTileId(u.terrain));
}

/** True when the level uses a mechanic that only the Epoxy engine plays: lasers, colour channels, slow time, speed or eye boots, swivel doors, steered monsters, fleeing monsters, arrow blocks, transmogrifiers, turn plates, turning force floors or signal wiring. */
export function hasEpoxyOnlyContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> &
    Partial<Pick<CompiledLevel, 'cloneLinks' | 'underlays' | 'signalLinks' | 'character'>>
): boolean {
  const hasEpoxyOnlyItem = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isEpoxyOnlyItemId)) ?? false;
  return (
    hasLaserContent(level) ||
    hasColorChannelContent(level) ||
    hasEpoxyOnlyItem(level.terrain) ||
    hasEpoxyOnlyItem(level.items) ||
    hasSwivelContent(level) ||
    hasForceCycleContent(level) ||
    hasEpoxyOnlyMonsterContent(level) ||
    hasSignalContent(level) ||
    (level.character !== undefined && level.character !== DEFAULT_PLAYER_CHARACTER)
  );
}

/**
 * The aids of a level with turrets and nothing else that already turns tapToPath off: the turrets fire
 * on a clock a tapped path does not wait for, and the hint and the watch do not model them.
 */
const TURRET_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, tapToPath: false };
/** A receivers level with turrets: the receivers aids and no tapped path. */
const TURRET_RECEIVER_LEVEL_FEATURES: RulesetFeatures = { ...RECEIVER_LEVEL_FEATURES, tapToPath: false };

/** The parts of a level that decide its aids; a level without a grid only gets the ruleset's aids. */
type FeatureLevel = Pick<CompiledLevel, 'ruleset'> &
  Partial<Pick<CompiledLevel, 'terrain' | 'items' | 'entities' | 'winRule' | 'cloneLinks' | 'underlays' | 'signalLinks'>>;

/** Laser and colour content never change on a compiled level, so the answers are kept per level object. */
const laserContentCache = new WeakMap<object, boolean>();
const colorContentCache = new WeakMap<object, boolean>();
const turretContentCache = new WeakMap<object, boolean>();
const steeringContentCache = new WeakMap<object, boolean>();
const swivelContentCache = new WeakMap<object, boolean>();
const signalContentCache = new WeakMap<object, boolean>();
const pullBootsContentCache = new WeakMap<object, boolean>();
/** The aids of a steering level, kept per aid set so a level of one kind always gets the same object. */
const steeringFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();

/**
 * The aids a level with puppets or swivel doors loses on top of what its other mechanics already turn off: a tapped path
 * and the push hint and watch do not know the pads' steps nor the doors that turn. An overlay on the result of the other rules,
 * so a pad never has to be combined by hand with each laser and colour case.
 */
function withoutSteeringAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = steeringFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, tapToPath: false, blockHint: false, deadEndWatch: false };
    steeringFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/** The aids of a signal level, kept per aid set like the steering overlay. */
const signalFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const pullBootsFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const chargeFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const chargeContentCache = new WeakMap<object, boolean>();
const pocketGateFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const pocketGateContentCache = new WeakMap<object, boolean>();
const relayFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const relayContentCache = new WeakMap<object, boolean>();
const stoneFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();
const stoneContentCache = new WeakMap<object, boolean>();

/**
 * The aids a level with hurl stones loses on top of what its other mechanics already turn off: a thrown stone destroys
 * monsters and melts ice blocks, which the push hint and the dead-end watch do not model.
 */
function withoutStoneAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = stoneFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, blockHint: false, deadEndWatch: false };
    stoneFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/**
 * The aids a level with relay pads loses on top of what its other mechanics already turn off: a lit pad sends blocks
 * and monsters across the map and a signal changes which pads are lit, which the push hint and the dead-end watch do not model.
 */
function withoutRelayAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = relayFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, blockHint: false, deadEndWatch: false };
    relayFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/**
 * The aids a level with pocket gates loses on top of what its other mechanics already turn off: a pad can be set down
 * anywhere and links blocks and monsters too, which the push hint and the dead-end watch do not model.
 */
function withoutPocketGateAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = pocketGateFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, blockHint: false, deadEndWatch: false };
    pocketGateFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/**
 * The aids a level with blast charges loses on top of what its other mechanics already turn off: a blast removes
 * monsters and blocks, which the push hint and the dead-end watch do not model.
 */
function withoutChargeAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = chargeFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, blockHint: false, deadEndWatch: false };
    chargeFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

function withoutPullBootsAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = pullBootsFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, blockHint: false, deadEndWatch: false };
    pullBootsFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/**
 * The aids a level with signal wiring loses on top of what its other mechanics already turn off: gates and sources
 * change the board as the player moves, which a tapped path, the push hint and the watch do not model.
 */
function withoutSignalAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = signalFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, tapToPath: false, blockHint: false, deadEndWatch: false };
    signalFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/** The aids available on a level, by the ruleset it is played under and the mechanics it uses. */
export function featuresFor(level: FeatureLevel | undefined): RulesetFeatures {
  const base = baseFeaturesFor(level);
  // Lynx and CC3D levels already have these aids off; a level without a grid has no content to read.
  if (!level?.terrain || level.ruleset === 'lynx' || level.ruleset === 'cc3d') return base;
  let steering = steeringContentCache.get(level);
  if (steering === undefined) {
    steering = hasSteeringContent({
      terrain: level.terrain,
      items: level.items ?? [],
      entities: level.entities ?? [],
      cloneLinks: level.cloneLinks ?? []
    });
    steeringContentCache.set(level, steering);
  }
  let swivel = swivelContentCache.get(level);
  if (swivel === undefined) {
    swivel = hasSwivelContent({ terrain: level.terrain, items: level.items ?? [] });
    swivelContentCache.set(level, swivel);
  }
  let signal = signalContentCache.get(level);
  if (signal === undefined) {
    signal = hasSignalContent(level);
    signalContentCache.set(level, signal);
  }
  const steered = steering || swivel ? withoutSteeringAids(base) : base;
  const signaled = signal ? withoutSignalAids(steered) : steered;
  let pullBoots = pullBootsContentCache.get(level);
  if (pullBoots === undefined) {
    pullBoots = hasPullBootsContent({ terrain: level.terrain, items: level.items ?? [] });
    pullBootsContentCache.set(level, pullBoots);
  }
  const pulling = pullBoots ? withoutPullBootsAids(signaled) : signaled;
  let charge = chargeContentCache.get(level);
  if (charge === undefined) {
    charge = hasChargeContent({ terrain: level.terrain, items: level.items ?? [] });
    chargeContentCache.set(level, charge);
  }
  const charged = charge ? withoutChargeAids(pulling) : pulling;
  let gate = pocketGateContentCache.get(level);
  if (gate === undefined) {
    gate = hasPocketGateContent({ terrain: level.terrain, items: level.items ?? [], underlays: level.underlays });
    pocketGateContentCache.set(level, gate);
  }
  const gated = gate ? withoutPocketGateAids(charged) : charged;
  let stone = stoneContentCache.get(level);
  if (stone === undefined) {
    stone = hasStoneContent({ terrain: level.terrain, items: level.items ?? [] });
    stoneContentCache.set(level, stone);
  }
  const stoned = stone ? withoutStoneAids(gated) : gated;
  let relay = relayContentCache.get(level);
  if (relay === undefined) {
    relay = hasRelayPadContent({ terrain: level.terrain });
    relayContentCache.set(level, relay);
  }
  return relay ? withoutRelayAids(stoned) : stoned;
}

function baseFeaturesFor(level: FeatureLevel | undefined): RulesetFeatures {
  if (!level) return EPOXY_FEATURES;
  switch (level.ruleset) {
    case 'lynx':
      return LYNX_FEATURES;
    case 'cc3d':
      return CC3D_FEATURES;
    case 'epoxy':
    case undefined:
      break;
    default: {
      const unreachable: never = level.ruleset;
      throw new Error(`Unknown ruleset: ${String(unreachable)}`);
    }
  }
  const receivers = level.winRule === 'receivers';
  if (!level.terrain) return receivers ? RECEIVER_LEVEL_FEATURES : EPOXY_FEATURES;
  let laser = laserContentCache.get(level);
  if (laser === undefined) {
    laser = hasLaserContent({
      terrain: level.terrain,
      items: level.items ?? [],
      entities: level.entities ?? [],
      cloneLinks: level.cloneLinks ?? []
    });
    laserContentCache.set(level, laser);
  }
  let color = colorContentCache.get(level);
  if (color === undefined) {
    color = hasColorChannelContent({ terrain: level.terrain, items: level.items ?? [], entities: level.entities ?? [] });
    colorContentCache.set(level, color);
  }
  let turret = turretContentCache.get(level);
  if (turret === undefined) {
    turret = hasTurretContent({ entities: level.entities ?? [], cloneLinks: level.cloneLinks ?? [] });
    turretContentCache.set(level, turret);
  }
  if (receivers) {
    if (color) return RECEIVER_COLOR_LEVEL_FEATURES;
    return turret ? TURRET_RECEIVER_LEVEL_FEATURES : RECEIVER_LEVEL_FEATURES;
  }
  if (!color) {
    if (turret) return TURRET_LEVEL_FEATURES;
    return laser ? LASER_LEVEL_FEATURES : EPOXY_FEATURES;
  }
  return laser ? LASER_COLOR_LEVEL_FEATURES : COLOR_LEVEL_FEATURES;
}
