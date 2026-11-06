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
 * Shape and colour check of the Runeward art config. A config that is missing a section or holds a
 * colour the canvas would refuse must not break drawing: the style then falls back to the shared
 * drawing. The result is memoised per config object, so the check runs once per loaded config.
 */

import type { RunewardArtConfig } from '../../../core/types';
import { parseCssColour } from '../retroHdPalette';

/** Colour channels of the keys block, each with its own main, light and glyph colours. */
const KEY_COLOUR_CHANNELS: readonly string[] = ['red', 'blue', 'yellow', 'green'];

/** Leaf names of the shared colour groups of the later painter sections. */
const SOLID_LEAVES: readonly string[] = ['base', 'light', 'dark', 'edge'];
const GLOW_LEAVES: readonly string[] = ['base', 'glow', 'core'];
const CREATURE_LEAVES: readonly string[] = ['body', 'light', 'dark', 'eye'];
const CHANNEL_LEAVES: readonly string[] = ['main', 'light'];

/** Monster types (and the shot) that carry their own colours. */
const MONSTER_TYPES: readonly string[] = [
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob', 'puppet',
  'skitter', 'lurker', 'shot'
];
const LASER_CHANNELS: readonly string[] = ['red', 'blue'];
const BOOTS_KINDS: readonly string[] = ['water', 'fire', 'ice', 'force', 'speed', 'eye', 'pull', 'ward'];
const BUTTON_COLOURS: readonly string[] = ['orange', 'gray'];

/** Paths `prefix.<name>.<leaf>` for every name and leaf. */
function groupPaths(prefix: string, names: readonly string[], leaves: readonly string[]): string[] {
  return names.flatMap((name) => leaves.map((leaf) => `${prefix}.${name}.${leaf}`));
}

/** Paths `prefix.<leaf>` for every leaf. */
function leafPaths(prefix: string, leaves: readonly string[]): string[] {
  return leaves.map((leaf) => `${prefix}.${leaf}`);
}

/** Dotted paths of the colours of the block, mirror, monster, device, item, signal and mark sections. */
const OBJECT_COLOUR_PATHS: readonly string[] = [
  ...groupPaths('block', ['dirt', 'ice', 'arrow'], SOLID_LEAVES),
  'block.arrow.glyph',
  ...groupPaths('block.colour', KEY_COLOUR_CHANNELS, SOLID_LEAVES),
  ...leafPaths('mirror.frame', SOLID_LEAVES),
  'mirror.glass', 'mirror.glassLight',
  ...groupPaths('monster', MONSTER_TYPES, CREATURE_LEAVES),
  ...groupPaths('device', ['thinWall', 'swivel', 'shotLauncher', 'turret'], SOLID_LEAVES),
  ...groupPaths('device', ['turnPlate', 'transmogrifier', 'cloneMachine', 'flameJet', 'laser', 'puppetControl'], GLOW_LEAVES),
  ...groupPaths('device.laserChannel', LASER_CHANNELS, CHANNEL_LEAVES),
  ...groupPaths('item.boots', BOOTS_KINDS, CHANNEL_LEAVES),
  ...leafPaths('item.bomb', GLOW_LEAVES),
  ...leafPaths('item.score', SOLID_LEAVES),
  'item.stopwatch.face', 'item.stopwatch.rim', 'item.stopwatch.bonus', 'item.stopwatch.penalty',
  'item.forbid.ring', 'item.forbid.slash',
  ...leafPaths('item.slowTime', GLOW_LEAVES),
  'signal.box', 'signal.idle', 'signal.lit', 'signal.glyph',
  ...groupPaths('mark', ['gravel', 'dirt', 'recessedWall', 'turtle', 'thief'], SOLID_LEAVES),
  ...groupPaths('mark', ['hint', 'blockTarget', 'slime'], GLOW_LEAVES),
  ...groupPaths('mark.button', BUTTON_COLOURS, CHANNEL_LEAVES)
];

/** Dotted paths of every colour the painters hand to the canvas. */
const COLOUR_PATHS: readonly string[] = [
  'clear',
  'floor.base', 'floor.light', 'floor.dark', 'floor.grout', 'floor.sheen',
  'wall.top', 'wall.topLight', 'wall.topDark', 'wall.front', 'wall.frontDark', 'wall.edge',
  'blueWall.tint', 'blueWall.line',
  'shadow.color',
  'seal.base', 'seal.glyph', 'seal.glow',
  'exit.base', 'exit.ring', 'exit.core', 'exit.glow',
  'water.deep', 'water.light', 'water.crest',
  'lava.deep', 'lava.light', 'lava.crest',
  'mage.robe', 'mage.robeLight', 'mage.hat', 'mage.hatLight', 'mage.band', 'mage.skin', 'mage.eyes',
  'mage.staff', 'mage.orb', 'mage.orbCore', 'mage.shadow',
  ...KEY_COLOUR_CHANNELS.flatMap((channel) => [`keys.${channel}.main`, `keys.${channel}.light`, `keys.${channel}.glyph`]),
  'door.frame', 'door.keyhole',
  'gate.bar', 'gate.barLight', 'gate.frame',
  'plate.rim', 'plate.face', 'plate.pressed', 'plate.highlight',
  'rune.stone', 'rune.glow', 'rune.core', 'rune.halo', 'rune.haloClear',
  'trap.pit', 'trap.jaw', 'trap.jawLight',
  'portal.base', 'portal.ring', 'portal.core', 'portal.glow',
  'ice.base', 'ice.light', 'ice.line', 'ice.edge',
  'force.base', 'force.arrow', 'force.arrowLight',
  ...OBJECT_COLOUR_PATHS
];

/** Dotted paths of every colour of the optional ink section, checked only when the section is present. */
const INK_COLOUR_PATHS: readonly string[] = [
  'ink.line', 'ink.hatch', 'ink.paperFleck', 'ink.paperStain', 'ink.gold', 'ink.wood', 'ink.torch.color'
];

/** Dotted path of the torch reach, which must be above zero when the ink section is present. */
const INK_TORCH_RADIUS_PATH = 'ink.torch.radiusTile';

/** Dotted paths of every number the painters compute with. */
const NUMBER_PATHS: readonly string[] = [
  'floor.variants', 'shadow.depth',
  'animation.bobAmplitude', 'animation.bobPeriodMs', 'animation.flowPeriodMs', 'animation.portalPeriodMs',
  'animation.pulsePeriodMs', 'animation.forceScrollPeriodMs', 'animation.monsterStepMs'
];

/** Periods divide the clock, so they must be strictly positive. */
const POSITIVE_PATHS: ReadonlySet<string> = new Set([
  'animation.bobPeriodMs', 'animation.flowPeriodMs', 'animation.portalPeriodMs', 'animation.pulsePeriodMs',
  'animation.forceScrollPeriodMs', 'animation.monsterStepMs'
]);

function valueAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** True when every section, colour and number the painters read is present and usable. */
export function isRunewardArtValid(art: unknown): art is RunewardArtConfig {
  if (typeof art !== 'object' || art === null) return false;
  for (const path of COLOUR_PATHS) {
    const value = valueAt(art, path);
    if (typeof value !== 'string' || parseCssColour(value) === null) return false;
  }
  for (const path of NUMBER_PATHS) {
    const value = valueAt(art, path);
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (POSITIVE_PATHS.has(path) && value <= 0) return false;
  }
  if (valueAt(art, 'ink') !== undefined) {
    for (const path of INK_COLOUR_PATHS) {
      const value = valueAt(art, path);
      if (typeof value !== 'string' || parseCssColour(value) === null) return false;
    }
    const radius = valueAt(art, INK_TORCH_RADIUS_PATH);
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) return false;
  }
  return true;
}

const verdicts = new WeakMap<object, boolean>();

/** The art config when it is usable, else null; checked once per config object. */
export function validRunewardArt(art: unknown): RunewardArtConfig | null {
  if (typeof art !== 'object' || art === null) return null;
  let ok = verdicts.get(art);
  if (ok === undefined) {
    ok = isRunewardArtValid(art);
    verdicts.set(art, ok);
  }
  return ok ? (art as RunewardArtConfig) : null;
}
