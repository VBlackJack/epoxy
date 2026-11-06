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
 * The Runeward monster painters: every type looks different from every other and from its own other
 * facings, the flyers read in their element colours, the bodies keep their contrast against the floor
 * in both variants, reduced motion freezes the bob, the sprite cache builds once per key, and the
 * shot trails its tail behind it. When a contrast pair fails, the colours in game.json change, never
 * the thresholds below.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { Direction, RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
// The dispatch module must load first: it reads the lot modules while it is evaluated, and the monster
// module reads its hooks back, so loading the monster module first would leave the dispatch with no table.
import { RUNEWARD_PAINTERS, type RunewardPaintEnv } from './runewardTiles';
import * as monsters from './runewardMonsters';

const MONSTER_TYPES = [
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob', 'puppet', 'skitter'
] as const;
const WISP_TYPES: readonly string[] = ['glider', 'fireball'];
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const FORWARD: Readonly<Record<Direction, readonly [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

const TILE = 48;
const SMALL_TILE = 12;
const FAR_TICK = 999;
const BOB_TICK = 22;
const STEP_TICKS = 15;
const BODY_ON_FLOOR_MIN = 3;
const MIN_SHAPES = 8;

const HEX_RADIX = 16;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const FLARE = 0.05;
const MAX_CHANNEL = 255;
const HUE_SECTOR = 60;
const HUE_WRAP = 360;
const BLUE_HUE_RANGE = [200, 260] as const;
const ORANGE_HUE_RANGE = [15, 45] as const;

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  return [match[1], match[2], match[3]].map((part) => parseInt(part, HEX_RADIX) / MAX_CHANNEL) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= SRGB_LINEAR_CUTOFF ? c / SRGB_LINEAR_DIVISOR : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA)));
  return LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b;
}

/** WCAG contrast ratio, at least 1. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + FLARE) / (Math.min(la, lb) + FLARE);
}

/** Hue of an opaque hex colour in degrees, 0 to 360. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * HUE_SECTOR + HUE_WRAP) % HUE_WRAP;
}

function plainArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArt as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

const VARIANTS = [
  { name: 'plain', art: plainArt },
  { name: 'parchment', art: parchmentArt }
] as const;

function envOf(art: RunewardArtConfig, timeTick = 0, reducedMotion = false, cache = new Map<string, unknown>()): RunewardPaintEnv {
  return { timeTick, signalPowered: false, reducedMotion, cache, art };
}

interface DrawOptions {
  readonly tick?: number;
  readonly reduced?: boolean;
  readonly size?: number;
  readonly env?: RunewardPaintEnv;
}

function monsterLog(type: string, dir: Direction, art: RunewardArtConfig, options: DrawOptions = {}): string[] {
  const { ctx, lines } = createRecordedContext();
  const env = options.env ?? envOf(art, options.tick ?? 0, options.reduced ?? false);
  RUNEWARD_PAINTERS.entities[type](ctx, dir, 0, 0, options.size ?? TILE, env);
  return lines;
}

function shotLog(dir: Direction, art: RunewardArtConfig): string[] {
  const { ctx, lines } = createRecordedContext();
  (RUNEWARD_PAINTERS.shot as NonNullable<typeof RUNEWARD_PAINTERS.shot>)(ctx, dir, 0, 0, TILE, envOf(art));
  return lines;
}

/** Ink colour of the outlines of an art variant. */
function outlineColour(art: RunewardArtConfig): string {
  return art.ink ? art.ink.line : art.block.dirt.edge;
}

/** Colour of the eye dots: the wisps have dark eyes on their pale core, the others their own eye colour. */
function eyeColour(type: string, art: RunewardArtConfig): string {
  return WISP_TYPES.includes(type) ? outlineColour(art) : art.monster[type as keyof RunewardArtConfig['monster']].eye;
}

/** Numbers inside a recorded call line such as `lineTo(1.5, 2)`. */
function argsOf(line: string): number[] {
  return line.slice(line.indexOf('(') + 1, line.lastIndexOf(')')).split(',').map(Number);
}

describe('Runeward monster painters', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('paints the eleven monster types and the shot, with nothing left pending', () => {
    expect(Object.keys(monsters.ENTITIES).sort()).toEqual([...MONSTER_TYPES].sort());
    expect(monsters.PENDING).toEqual([]);
    expect(monsters.SHOT).not.toBeNull();
    expect(RUNEWARD_PAINTERS.shot).toBe(monsters.SHOT);
  });

  describe.each(VARIANTS)('$name variant', ({ art }) => {
    it('draws every type with ink, a shadow and eyes', () => {
      for (const type of MONSTER_TYPES) {
        const lines = monsterLog(type, 'S', art());
        expect(lines.filter((line) => line.startsWith('beginPath(')).length).toBeGreaterThan(MIN_SHAPES);
        expect(lines).toContain(`fillStyle = ${JSON.stringify(art().mage.shadow)}`);
        expect(lines).toContain(`fillStyle = ${JSON.stringify(eyeColour(type, art()))}`);
        expect(lines.some((line) => line.startsWith('stroke('))).toBe(true);
      }
    });

    it.each(DIRECTIONS)('gives every pair of types a different drawing facing %s', (dir) => {
      const logs = MONSTER_TYPES.map((type) => monsterLog(type, dir, art()).join('\n'));
      expect(new Set(logs).size).toBe(MONSTER_TYPES.length);
    });

    it.each(MONSTER_TYPES)('draws %s differently on each of the four facings', (type) => {
      const logs = DIRECTIONS.map((dir) => monsterLog(type, dir, art()).join('\n'));
      expect(new Set(logs).size).toBe(DIRECTIONS.length);
    });

    it.each(MONSTER_TYPES)('keeps the %s body apart from the floor', (type) => {
      expect(contrast(art().monster[type].body, art().floor.base)).toBeGreaterThanOrEqual(BODY_ON_FLOOR_MIN);
    });

    it('fills each body with its own body colour', () => {
      for (const type of MONSTER_TYPES) {
        expect(monsterLog(type, 'E', art())).toContain(`fillStyle = ${JSON.stringify(art().monster[type].body)}`);
      }
    });

    it('reads the glider as blue and the fireball as orange', () => {
      const glider = art().monster.glider.body;
      const fireball = art().monster.fireball.body;
      expect(monsterLog('glider', 'E', art())).toContain(`fillStyle = ${JSON.stringify(glider)}`);
      expect(monsterLog('fireball', 'E', art())).toContain(`fillStyle = ${JSON.stringify(fireball)}`);
      expect(hue(glider)).toBeGreaterThanOrEqual(BLUE_HUE_RANGE[0]);
      expect(hue(glider)).toBeLessThanOrEqual(BLUE_HUE_RANGE[1]);
      expect(hue(fireball)).toBeGreaterThanOrEqual(ORANGE_HUE_RANGE[0]);
      expect(hue(fireball)).toBeLessThanOrEqual(ORANGE_HUE_RANGE[1]);
    });

    it('keeps the runner blue', () => {
      const skitter = hue(art().monster.skitter.body);
      expect(skitter).toBeGreaterThanOrEqual(BLUE_HUE_RANGE[0]);
      expect(skitter).toBeLessThanOrEqual(BLUE_HUE_RANGE[1]);
    });

    it.each(MONSTER_TYPES)('freezes the %s under reduced motion', (type) => {
      expect(monsterLog(type, 'E', art(), { tick: FAR_TICK, reduced: true })).toEqual(monsterLog(type, 'E', art(), { tick: 0, reduced: true }));
    });

    it('bobs with the clock otherwise', () => {
      expect(monsterLog('blob', 'E', art(), { tick: BOB_TICK })).not.toEqual(monsterLog('blob', 'E', art(), { tick: 0 }));
    });

    it.each(MONSTER_TYPES)('steps the %s between its two walk frames', (type) => {
      expect(monsterLog(type, 'E', art(), { tick: STEP_TICKS }).join('\n')).not.toEqual(monsterLog(type, 'E', art(), { tick: 0 }).join('\n'));
    });

    it('draws on tiles as small as twelve pixels', () => {
      for (const type of MONSTER_TYPES) {
        expect(monsterLog(type, 'W', art(), { size: SMALL_TILE }).length).toBeGreaterThan(0);
      }
    });

    it('builds a sprite once per type, facing, frame and size', () => {
      const cache = new Map<string, unknown>();
      const draw = (type: string, dir: Direction, tick: number, size = TILE): string[] =>
        monsterLog(type, dir, art(), { env: envOf(art(), tick, false, cache), size });
      const first = draw('tank', 'E', 0);
      expect(cache.size).toBe(1);
      const [key] = [...cache.keys()];
      const sprite = cache.get(key);
      expect(draw('tank', 'E', 0)).toEqual(first);
      expect(cache.size).toBe(1);
      expect(cache.get(key)).toBe(sprite);
      draw('tank', 'W', 0);
      expect(cache.size).toBe(2);
      draw('tank', 'E', STEP_TICKS);
      expect(cache.size).toBe(3);
      draw('tank', 'E', 0, SMALL_TILE);
      expect(cache.size).toBe(4);
      draw('bug', 'E', 0);
      expect(cache.size).toBe(5);
    });
  });

  describe('plain variant', () => {
    it('outlines with the block edge ink and rings glows without gold', () => {
      const art = plainArt();
      const lines = monsterLog('tank', 'E', art);
      expect(lines).toContain(`strokeStyle = ${JSON.stringify(outlineColour(art))}`);
      expect(art.ink).toBeUndefined();
    });
  });

  describe('parchment variant', () => {
    it('outlines in ink and turns the glow into a gold-ink halo', () => {
      const art = parchmentArt();
      const ink = art.ink as NonNullable<RunewardArtConfig['ink']>;
      for (const type of ['tank', 'puppet', 'teeth', 'glider', 'fireball']) {
        const lines = monsterLog(type, 'S', art);
        expect(lines).toContain(`strokeStyle = ${JSON.stringify(ink.line)}`);
        expect(lines).toContain(`strokeStyle = ${JSON.stringify(ink.gold)}`);
      }
    });

    it('draws no gold halo on the plain art', () => {
      const gold = (parchmentArt().ink as NonNullable<RunewardArtConfig['ink']>).gold;
      expect(monsterLog('tank', 'S', plainArt())).not.toContain(`strokeStyle = ${JSON.stringify(gold)}`);
    });
  });

  describe.each(VARIANTS)('shot, $name variant', ({ art }) => {
    it('draws a rune bolt in the rune core and glow colours', () => {
      const lines = shotLog('E', art());
      expect(lines.some((line) => line.startsWith('fill('))).toBe(true);
      expect(lines).toContain(`fillStyle = ${JSON.stringify(art().rune.glow)}`);
      expect(lines).toContain(`fillStyle = ${JSON.stringify(art().rune.core)}`);
    });

    it.each(DIRECTIONS)('trails its tail opposite the way it flies, facing %s', (dir) => {
      const centre = TILE / 2;
      const points = shotLog(dir, art())
        .filter((line) => line.startsWith('moveTo(') || line.startsWith('lineTo('))
        .map((line) => argsOf(line).map((value) => value - centre));
      const [fx, fy] = FORWARD[dir];
      const along = points.map(([x, y]) => x * fx + y * fy);
      const farthest = along.reduce((far, value) => (Math.abs(value) > Math.abs(far) ? value : far), 0);
      expect(farthest).toBeLessThan(0);
      expect(Math.max(...along)).toBeGreaterThan(0);
      expect(Math.abs(farthest)).toBeGreaterThan(Math.max(...along));
    });

    it('draws each facing differently and caches one sprite per facing', () => {
      const cache = new Map<string, unknown>();
      const logs = DIRECTIONS.map((dir) => {
        const { ctx, lines } = createRecordedContext();
        (RUNEWARD_PAINTERS.shot as NonNullable<typeof RUNEWARD_PAINTERS.shot>)(ctx, dir, 0, 0, TILE, envOf(art(), 0, false, cache));
        return lines.join('\n');
      });
      expect(new Set(logs).size).toBe(DIRECTIONS.length);
      expect(cache.size).toBe(DIRECTIONS.length);
    });
  });
});
