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
  'mage.staff', 'mage.orb', 'mage.orbCore', 'mage.shadow'
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
  'animation.bobAmplitude', 'animation.bobPeriodMs', 'animation.flowPeriodMs', 'animation.portalPeriodMs'
];

/** Periods divide the clock, so they must be strictly positive. */
const POSITIVE_PATHS: ReadonlySet<string> = new Set([
  'animation.bobPeriodMs', 'animation.flowPeriodMs', 'animation.portalPeriodMs'
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
