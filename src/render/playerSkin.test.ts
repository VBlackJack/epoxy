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

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTestBundle } from '../test/loadTestConfigs';
import type { Direction } from '../core/types';
import {
  DEFAULT_PLAYER_SKIN,
  PLAYER_SKIN_IDS,
  PLAYER_SKIN_RUNEWARD_CHARACTER,
  PLAYER_SKIN_SPRITE_PREFIX,
  effectivePlayerSkin,
  parsePlayerSkin,
  playerSkinLabelKey,
  playerSkinsForStyle
} from './playerSkin';
import { retroPlayerSprite } from './retroCompose';
import {
  RETRO_SHEET,
  findRetroSheetErrors,
  rasterizeSprite,
  resolveRetroRamps
} from './retroSprites';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const SNAPSHOT_PATH = './__snapshots__/skinJulien/sprites.snap.txt';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const FRAMES = [0, 1, 2];
/** Walking frames, swimming per facing and the dead pose: the 17 poses of the player. */
const POSE_COUNT = DIRECTIONS.length * FRAMES.length + DIRECTIONS.length + 1;

const bundle = createTestBundle();
const palettes = bundle.game.retroPalettes;
const themeIds = Object.keys(palettes ?? {});

function julienNames(): string[] {
  const names: string[] = [];
  for (const dir of DIRECTIONS) for (const frame of FRAMES) names.push(retroPlayerSprite(dir, false, true, frame, 'julien'));
  for (const dir of DIRECTIONS) names.push(retroPlayerSprite(dir, true, true, 0, 'julien'));
  names.push(retroPlayerSprite('S', false, false, 0, 'julien'));
  return names;
}

describe('parsePlayerSkin', () => {
  it('keeps the known skins', () => {
    for (const skin of PLAYER_SKIN_IDS) expect(parsePlayerSkin(skin)).toBe(skin);
  });

  it('falls back to the default skin for anything else', () => {
    for (const value of [undefined, null, '', 'Julien', 'unknown', 3, {}, ['julien']]) {
      expect(parsePlayerSkin(value)).toBe(DEFAULT_PLAYER_SKIN);
    }
    expect(DEFAULT_PLAYER_SKIN).toBe('default');
  });

  it('has a label in both locales for every skin', () => {
    for (const skin of PLAYER_SKIN_IDS) {
      const path = playerSkinLabelKey(skin).split('.');
      for (const locale of [en, fr]) {
        const label = path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], locale);
        expect(typeof label, `${skin}`).toBe('string');
      }
    }
  });
});

describe('retroPlayerSprite with a skin', () => {
  it('keeps the stock names for the default skin', () => {
    expect(retroPlayerSprite('N', false, true, 2)).toBe('player_N_2');
    expect(retroPlayerSprite('N', false, true, 2, 'default')).toBe('player_N_2');
    expect(retroPlayerSprite('W', true, true, 1, 'default')).toBe('player_swim_W');
    expect(retroPlayerSprite('S', true, false, 0, 'default')).toBe('player_dead');
  });

  it('picks the prefixed names for the Julien skin', () => {
    const prefix = PLAYER_SKIN_SPRITE_PREFIX.julien;
    expect(retroPlayerSprite('N', false, true, 2, 'julien')).toBe(`${prefix}player_N_2`);
    expect(retroPlayerSprite('W', true, true, 1, 'julien')).toBe(`${prefix}player_swim_W`);
    expect(retroPlayerSprite('S', true, false, 0, 'julien')).toBe(`${prefix}player_dead`);
  });
});

describe('the Julien sprites', () => {
  it('cover all the poses of the player and exist in the sheet', () => {
    const names = julienNames();
    expect(new Set(names).size).toBe(POSE_COUNT);
    for (const name of names) expect(name in RETRO_SHEET.sprites, name).toBe(true);
  });

  it('pass the sheet validation in every theme', () => {
    expect(findRetroSheetErrors(RETRO_SHEET, palettes)).toEqual([]);
  });

  it('differ from the stock player pose by pose', () => {
    const ramps = resolveRetroRamps(palettes, 'default');
    for (const dir of DIRECTIONS) {
      const stock = rasterizeSprite(RETRO_SHEET.sprites[retroPlayerSprite(dir, false, true, 0)], ramps);
      const skin = rasterizeSprite(RETRO_SHEET.sprites[retroPlayerSprite(dir, false, true, 0, 'julien')], ramps);
      expect(Buffer.from(skin).equals(Buffer.from(stock)), dir).toBe(false);
    }
  });

  it('keep their pixels: one hash per sprite and theme', async () => {
    const lines: string[] = [];
    for (const themeId of themeIds) {
      const ramps = resolveRetroRamps(palettes, themeId);
      for (const name of julienNames()) {
        const hash = createHash(HASH_ALGORITHM)
          .update(rasterizeSprite(RETRO_SHEET.sprites[name], ramps))
          .digest('hex')
          .slice(0, HASH_HEX_LENGTH);
        lines.push(`theme=${themeId} name=${name} ${hash}`);
      }
    }
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(SNAPSHOT_PATH);
  });
});

describe('the Runeward characters as skins', () => {
  const RUNEWARD_SKINS = ['runeward_scribe', 'runeward_adventurer'] as const;

  it('keeps every value stored by an earlier version valid', () => {
    expect(parsePlayerSkin('default')).toBe('default');
    expect(parsePlayerSkin('julien')).toBe('julien');
    expect(parsePlayerSkin(undefined)).toBe('default');
    expect(PLAYER_SKIN_IDS.slice(0, 2)).toEqual(['default', 'julien']);
  });

  it('parses the Runeward ids and refuses near misses', () => {
    for (const skin of RUNEWARD_SKINS) expect(parsePlayerSkin(skin)).toBe(skin);
    for (const value of ['scribe', 'runeward_mage', 'Runeward_scribe', 'runeward_scribe ']) {
      expect(parsePlayerSkin(value), value).toBe(DEFAULT_PLAYER_SKIN);
    }
  });

  it('maps each skin to a character: the default skin is the mage', () => {
    expect(PLAYER_SKIN_RUNEWARD_CHARACTER.default).toBe('mage');
    expect(PLAYER_SKIN_RUNEWARD_CHARACTER.runeward_scribe).toBe('scribe');
    expect(PLAYER_SKIN_RUNEWARD_CHARACTER.runeward_adventurer).toBe('adventurer');
  });

  it('offers the Runeward characters in the Runeward style only', () => {
    expect(playerSkinsForStyle(true)).toEqual(['default', 'julien', 'runeward_scribe', 'runeward_adventurer']);
    expect(playerSkinsForStyle(false)).toEqual(['default', 'julien']);
  });

  it('draws a Runeward-only skin as the default elsewhere and keeps the others', () => {
    for (const skin of RUNEWARD_SKINS) {
      expect(effectivePlayerSkin(skin, false)).toBe('default');
      expect(effectivePlayerSkin(skin, true)).toBe(skin);
    }
    for (const skin of ['default', 'julien'] as const) {
      expect(effectivePlayerSkin(skin, false)).toBe(skin);
      expect(effectivePlayerSkin(skin, true)).toBe(skin);
    }
  });

  it('keeps the stock sprite names for a Runeward-only skin', () => {
    for (const skin of RUNEWARD_SKINS) {
      expect(PLAYER_SKIN_SPRITE_PREFIX[skin]).toBe('');
      expect(retroPlayerSprite('E', false, true, 1, skin)).toBe(retroPlayerSprite('E', false, true, 1));
      expect(retroPlayerSprite('S', true, false, 0, skin)).toBe(retroPlayerSprite('S', true, false, 0));
    }
  });

  it('names the default skin the mage in Runeward, in both languages', () => {
    expect(playerSkinLabelKey('default')).toBe('app.player_skin.default.label');
    expect(playerSkinLabelKey('default', true)).toBe('app.player_skin.runeward_mage.label');
    expect(playerSkinLabelKey('runeward_scribe', true)).toBe('app.player_skin.runeward_scribe.label');
    const labels = (locale: unknown, skin: string): unknown =>
      (locale as { app: { player_skin: Record<string, { label: string }> } }).app.player_skin[skin]?.label;
    for (const locale of [en, fr]) {
      for (const name of ['runeward_mage', 'runeward_scribe', 'runeward_adventurer']) {
        expect(typeof labels(locale, name), name).toBe('string');
      }
    }
    expect(labels(fr, 'runeward_scribe')).toBe('Scribe des runes');
    expect(labels(fr, 'runeward_adventurer')).toBe('Mage aventurier');
  });
});
