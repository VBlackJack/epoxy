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
 * Pixel-level regression guard for the 16-Bit Retro style. Every sprite, every composed tile,
 * item, label, monster and player stack and every dithered floor shadow is rasterized for every
 * retro palette theme, and the raw RGBA bytes are hashed. The committed snapshots hold one line
 * per group, `<heading> <sha256 of the group's pixel hashes>`, so a failing group names itself.
 * The 16-Bit output must stay byte-identical while the sprite size is parameterised.
 *
 * Run vitest in update mode (`-u`) to rewrite the snapshots on purpose. On a mismatch the
 * per-case hashes of every failing group are written to `local/snapshot-diff/` (git-ignored).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createTestBundle } from '../test/loadTestConfigs';
import { Direction } from '../core/types';
import { RETRO_BOOT_RAMPS, RETRO_PLAIN_TELEPORT_RAMP, RETRO_SWAP_RAMPS } from './paletteKeys';
import { resolveRenderSettings } from './renderSettings';
import {
  applyRetroShadow,
  composeRetroLayers,
  retroItemLayers,
  retroLabelLayers,
  retroLayersKey,
  retroMonsterSprite,
  retroPlayerSprite,
  retroShadowExtent,
  retroThinLayers,
  retroTileLayers,
  retroWallLayers,
  RetroLayer,
  RetroPass,
  RetroTileInput
} from './retroCompose';
import {
  RETRO_SHEET,
  RETRO_SPRITE_NAMES,
  RETRO_SPRITE_SIZE,
  RETRO_SWAP_RAMP_TOKEN,
  RetroRamps,
  RetroSprite,
  rasterizeSprite,
  resolveRetroRamps
} from './retroSprites';

const SNAPSHOT_DIR = './__snapshots__/retroStyle';
const DIFF_DIR_FROM_ROOT = 'local/snapshot-diff';
const REPO_ROOT_DEPTH = '../..';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const GROUP_SEPARATOR = ' ';
const BYTES_PER_PIXEL = 4;
const MIN_CASES = 1000;
const EXPECTED_THEMES = ['default', 'cyber_neon', 'arctic_lab', 'magma_core', 'lynx_lcd'];

const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const PASSES: readonly RetroPass[] = ['all', 'static', 'animated'];
const WALL_MASK_COUNT = 16;
const PHASES = [0, 1, 2, 3];
/** Hashes picking no floor detail (1) and floor detail kinds 0, 1 and 2 with floorDetailEvery 5. */
const FLOOR_HASHES = [1, 0, 2560, 1280];
const THIN_EDGES: readonly Direction[] = ['N', 'E', 'S', 'W'];
const THIN_EDGE_COMBINATIONS = 1 << THIN_EDGES.length;
const PLAYER_FRAMES = [0, 1, 2];
const MONSTER_FRAMES = [0, 1];
const SHADOW_SIGNATURE_COUNT = 8;
const ITEM_LAYER = 'item';
const EXTRA_LABELS = ['10', '100', '1K', '2K', 'x2', 'x3', '500', '+5', '-5', 'Q'];
const BLOCK_SPRITES = ['dirt_block', 'ice_block', 'block_on_target'];

const bundle = createTestBundle();
const tiles = bundle.tiles.tiles;
const palettes = bundle.game.retroPalettes;
const themeIds = Object.keys(palettes ?? {});
const settings = resolveRenderSettings(bundle.game.graphics);
const rampsByTheme = new Map<string, RetroRamps>(themeIds.map((id) => [id, resolveRetroRamps(palettes, id)]));

let hashedCases = 0;

function hashBytes(bytes: Uint8ClampedArray): string {
  hashedCases++;
  return createHash(HASH_ALGORITHM).update(bytes).digest('hex').slice(0, HASH_HEX_LENGTH);
}

function hashText(text: string): string {
  return createHash(HASH_ALGORITHM).update(text).digest('hex').slice(0, HASH_HEX_LENGTH);
}

/** One group: a heading and the per-case lines it aggregates. */
interface Group {
  heading: string;
  cases: string[];
}

const resolveTile = (id: string) => tiles[id] ?? tiles.floor;

function usesSwap(sprite: RetroSprite): boolean {
  return Object.values(sprite.legend).some((ref) => ref.startsWith(`${RETRO_SWAP_RAMP_TOKEN}.`));
}

/** Every ramp a template sprite may be drawn with. */
function swapCandidates(): string[] {
  return [...new Set([...Object.values(RETRO_SWAP_RAMPS), ...Object.values(RETRO_BOOT_RAMPS), RETRO_PLAIN_TELEPORT_RAMP])];
}

function spriteGroups(): Group[] {
  const groups: Group[] = [];
  for (const themeId of themeIds) {
    const ramps = rampsByTheme.get(themeId) as RetroRamps;
    for (const name of RETRO_SPRITE_NAMES) {
      const sprite = RETRO_SHEET.sprites[name];
      const cases: string[] = [];
      if (!sprite) {
        cases.push('missing');
      } else {
        cases.push(`plain ${hashBytes(rasterizeSprite(sprite, ramps))}`);
        if (usesSwap(sprite)) {
          for (const swap of swapCandidates()) cases.push(`swap=${swap} ${hashBytes(rasterizeSprite(sprite, ramps, swap))}`);
        }
      }
      groups.push({ heading: `sprite theme=${themeId} name=${name}`, cases });
    }
  }
  return groups;
}

function tileInput(tileId: string, over: Partial<RetroTileInput>): RetroTileInput {
  return {
    tileId,
    def: resolveTile(tileId),
    resolve: resolveTile,
    pass: 'all',
    hash: 1,
    wallMask: 0,
    floorDetailEvery: settings.floorDetailEvery,
    isEditor: false,
    isClosedTrap: true,
    phase: 0,
    reducedMotion: false,
    ...over
  };
}

/** Distinct layer stacks a tile can produce over every pass and input, keyed by their cache key. */
function tileStacks(tileId: string): Map<string, RetroLayer[]> {
  const stacks = new Map<string, RetroLayer[]>();
  const masks = tileId === 'wall' ? Array.from({ length: WALL_MASK_COUNT }, (_, i) => i) : [0];
  for (const pass of PASSES) {
    for (const wallMask of masks) {
      for (const hash of FLOOR_HASHES) {
        for (const isEditor of [false, true]) {
          for (const isClosedTrap of [true, false]) {
            for (const phase of PHASES) {
              for (const reducedMotion of [false, true]) {
                const layers = retroTileLayers(
                  tileInput(tileId, { pass, wallMask, hash, isEditor, isClosedTrap, phase, reducedMotion })
                );
                stacks.set(`${pass}|${retroLayersKey(layers)}`, layers);
              }
            }
          }
        }
      }
    }
  }
  return stacks;
}

/** Composes keyed layer stacks with the ramps of every theme, one group per theme. */
function stackGroups(kind: string, subject: string, stacks: Map<string, RetroLayer[]>): Group[] {
  return themeIds.map((themeId) => {
    const ramps = rampsByTheme.get(themeId) as RetroRamps;
    const cases = [...stacks.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, layers]) => `${key} ${hashBytes(composeRetroLayers(layers, ramps))}`);
    return { heading: `${kind} theme=${themeId} ${subject}`, cases };
  });
}

function tileGroups(): Group[] {
  const groups: Group[] = [];
  for (const tileId of Object.keys(tiles)) groups.push(...stackGroups('tile', `id=${tileId}`, tileStacks(tileId)));
  const walls = new Map<string, RetroLayer[]>();
  for (let mask = 0; mask < WALL_MASK_COUNT; mask++) {
    const layers = retroWallLayers(mask);
    walls.set(`wallMask=${mask}|${retroLayersKey(layers)}`, layers);
  }
  groups.push(...stackGroups('wall', 'masks', walls));
  const thin = new Map<string, RetroLayer[]>();
  for (let bits = 0; bits < THIN_EDGE_COMBINATIONS; bits++) {
    const edges = THIN_EDGES.filter((_, i) => bits & (1 << i));
    const layers = retroThinLayers(edges);
    thin.set(`edges=${edges.join('')}|${retroLayersKey(layers)}`, layers);
  }
  groups.push(...stackGroups('thin', 'edges', thin));
  return groups;
}

function itemGroups(): Group[] {
  const groups: Group[] = [];
  const labels = new Set<string>(EXTRA_LABELS);
  for (const [id, def] of Object.entries(tiles)) {
    if (def.layer !== ITEM_LAYER) continue;
    const layers = retroItemLayers(id, def);
    groups.push(...stackGroups('item', `id=${id}`, new Map([[retroLayersKey(layers), layers]])));
    if (def.scoreBonus !== undefined) labels.add(String(def.scoreBonus));
    if (def.scoreMultiplier !== undefined) labels.add(`x${def.scoreMultiplier}`);
  }
  for (const label of labels) {
    const layers = retroLabelLayers(label);
    groups.push(...stackGroups('label', `text=${label}`, new Map([[retroLayersKey(layers), layers]])));
  }
  return groups;
}

function actorGroups(): Group[] {
  const groups: Group[] = [];
  const monsters = Object.keys(bundle.monsters.entities).filter((type) => !BLOCK_SPRITES.includes(type));
  for (const type of monsters) {
    const stacks = new Map<string, RetroLayer[]>();
    for (const dir of DIRECTIONS) {
      for (const frame of MONSTER_FRAMES) {
        const name = retroMonsterSprite(type, dir, frame);
        stacks.set(name, [{ name }]);
      }
    }
    groups.push(...stackGroups('monster', `type=${type}`, stacks));
  }
  for (const name of BLOCK_SPRITES) groups.push(...stackGroups('block', `name=${name}`, new Map([[name, [{ name }]]])));
  const player = new Map<string, RetroLayer[]>();
  for (const inWater of [false, true]) {
    for (const alive of [true, false]) {
      for (const dir of DIRECTIONS) {
        for (const frame of PLAYER_FRAMES) {
          const name = retroPlayerSprite(dir, inWater, alive, frame);
          player.set(`inWater=${inWater} alive=${alive} dir=${dir} frame=${frame} ${name}`, [{ name }]);
        }
      }
    }
  }
  groups.push(...stackGroups('player', 'all', player));
  return groups;
}

function shadowGroups(): Group[] {
  const { depth, side } = retroShadowExtent(settings.floorShadowDepthTile);
  const floors: Record<string, RetroLayer[]> = {
    plain: [{ name: 'floor' }],
    detail: [{ name: 'floor' }, { name: 'floor_detail_1' }]
  };
  const groups: Group[] = [];
  for (const themeId of themeIds) {
    const ramps = rampsByTheme.get(themeId) as RetroRamps;
    const cases: string[] = [`extent depth=${depth} side=${side}`];
    for (const [floorName, layers] of Object.entries(floors)) {
      for (let signature = 0; signature < SHADOW_SIGNATURE_COUNT; signature++) {
        const buffer = composeRetroLayers(layers, ramps);
        applyRetroShadow(buffer, RETRO_SPRITE_SIZE, signature, ramps, depth, side);
        cases.push(`floor=${floorName} signature=${signature} ${hashBytes(buffer)}`);
      }
    }
    groups.push({ heading: `shadow theme=${themeId}`, cases });
  }
  return groups;
}

function isUpdatingSnapshots(): boolean {
  const state = expect.getState() as unknown as { snapshotState?: { _updateSnapshot?: string } };
  return state.snapshotState?._updateSnapshot === 'all';
}

function safeFileName(heading: string): string {
  return heading.replace(/[^A-Za-z0-9._=-]+/g, '_');
}

/**
 * Compares the group hashes with the committed snapshot file, reading it with either line ending.
 * On a mismatch the per-case hashes of each failing group go to `local/snapshot-diff/<file>/`.
 */
async function verifyGroups(groups: Group[], snapshotPath: string): Promise<void> {
  expect(groups.length).toBeGreaterThan(0);
  const hashed = groups.map((g) => ({ ...g, text: `${g.heading}\n${g.cases.join('\n')}\n` }));
  const current = hashed.map((g) => `${g.heading}${GROUP_SEPARATOR}${hashText(g.text)}`);
  const text = `${current.join('\n')}\n`;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolvePath(here, snapshotPath);
  if (existsSync(file) && !isUpdatingSnapshots()) {
    const expected = new Map(
      readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map(
          (line) =>
            [line.slice(0, line.lastIndexOf(GROUP_SEPARATOR)), line.slice(line.lastIndexOf(GROUP_SEPARATOR) + 1)] as const
        )
    );
    const failing = hashed.filter((g) => expected.get(g.heading) !== hashText(g.text));
    const missing = [...expected.keys()].filter((heading) => !hashed.some((g) => g.heading === heading));
    if (failing.length > 0 || missing.length > 0) {
      const name = safeFileName(snapshotPath.split('/').pop() ?? 'group');
      const dir = resolvePath(here, REPO_ROOT_DEPTH, DIFF_DIR_FROM_ROOT, name);
      mkdirSync(dir, { recursive: true });
      for (const g of failing) writeFileSync(resolvePath(dir, `${safeFileName(g.heading)}.txt`), g.text, 'utf-8');
      throw new Error(
        `${failing.length} group(s) differ and ${missing.length} group(s) vanished in ${snapshotPath}. ` +
          `Per-case hashes of the failing groups were written to ${DIFF_DIR_FROM_ROOT}/${name}/ ` +
          `(first: ${failing[0]?.heading ?? missing[0]}).`
      );
    }
  }
  await expect(text).toMatchFileSnapshot(snapshotPath);
}

describe('16-Bit Retro render style pixel snapshots', () => {
  it('covers the default theme and the four shipped themes', () => {
    expect(themeIds).toEqual(EXPECTED_THEMES);
    expect(composeRetroLayers([], {}).length).toBe(RETRO_SPRITE_SIZE * RETRO_SPRITE_SIZE * BYTES_PER_PIXEL);
  });

  it('rasterizes every sprite for every theme and swap ramp', async () => {
    await verifyGroups(spriteGroups(), `${SNAPSHOT_DIR}/sprites.snap.txt`);
  });

  it('composes every tile, wall mask and thin edge set', async () => {
    await verifyGroups(tileGroups(), `${SNAPSHOT_DIR}/tiles.snap.txt`);
  });

  it('composes items and labels', async () => {
    await verifyGroups(itemGroups(), `${SNAPSHOT_DIR}/items.snap.txt`);
  });

  it('composes monsters, blocks and the player', async () => {
    await verifyGroups(actorGroups(), `${SNAPSHOT_DIR}/actors.snap.txt`);
  });

  it('dithers the floor shadow for every signature', async () => {
    await verifyGroups(shadowGroups(), `${SNAPSHOT_DIR}/shadow.snap.txt`);
  });

  it('hashed a meaningful number of cases', () => {
    expect(hashedCases).toBeGreaterThan(MIN_CASES);
    console.info(`retro snapshot cases hashed: ${hashedCases}`);
  });
});
