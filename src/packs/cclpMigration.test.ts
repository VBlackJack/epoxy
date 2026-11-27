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

import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CCLP_IMPORT_RELEASE_MS } from '../config/constants';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { CompiledLevel, LevelPack } from '../core/types';
import { documentFromLevel, levelFromDocument, LevelExportContext } from '../editor/editorLevelIo';
import { DatCodec } from '../formats/DatCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  CclpMoveContext,
  CclpReferenceSet,
  isKeptVerdict,
  moveClassicDatLevel,
  parseCclpMoveRecord,
  parseNoticedPackIds,
  planCclpPackMove
} from './cclpMigration';
import { scopeLevelIds } from './levelIds';
import { parsePackJson, serializePack } from './packJson';
import { passwordSignature } from './passwordSignature';
import { applyRulesProfile } from './rulesProfile';
import { storedPackNotice } from './storedPackNotices';

const SIZE = 32;
/** An import stamped before the cutoff, as every pack an old build imported. */
const OLD_STAMP = CCLP_IMPORT_RELEASE_MS - 1;
const PACK_ID = `pack_synth_${OLD_STAMP}`;
const isCloneMachine = (id: string): boolean => id === 'clone_machine';

/** A synthetic 32 x 32 level: walls around, two chips, an exit, a plain block, two bugs listed against reading order. */
function synthLevel(n: number, timeBonus = 0): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor')));
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  terrain[10][10 + n] = 'exit';
  items[3][3] = 'chip';
  items[4][4 + n] = 'chip';
  return {
    id: `synth_level_${n}`,
    number: n,
    customTitle: `Synthetic ${n}`,
    customHint: '',
    password: `PW${n}AB`,
    timeLimitSeconds: 100 + n + timeBonus,
    chipsRequired: 2,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain,
    items,
    entities: [
      { type: 'bug', x: 20, y: 20, dir: 'N' },
      { type: 'bug', x: 6, y: 8, dir: 'E' },
      { type: 'dirt_block', x: 7, y: 7, dir: 'N' }
    ],
    trapLinks: [],
    cloneLinks: []
  };
}

function encode(levels: CompiledLevel[]): ArrayBuffer {
  const encoded = DatCodec.encodeLevels(levels);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

async function referenceOf(buffer: ArrayBuffer): Promise<CclpReferenceSet> {
  const classic = DatCodec.decodeBuffer(buffer, 'REF', DEFAULT_RULESET);
  const lynx = DatCodec.decodeBuffer(buffer, 'REF', 'lynx');
  applyRulesProfile(lynx, 'cclp');
  return { signature: await passwordSignature(classic), classic, lynx };
}

let bytes: ArrayBuffer;
let reference: CclpReferenceSet;

function ctx(overrides: Partial<CclpMoveContext> = {}): CclpMoveContext {
  return {
    isCloneMachine,
    mapWidth: SIZE,
    mapHeight: SIZE,
    passwordSignature,
    officialSignatures: [],
    references: async () => [reference],
    oldImportCutoffMs: CCLP_IMPORT_RELEASE_MS,
    ...overrides
  };
}
const unheld = (): CclpMoveContext => ctx({ references: async () => [] });

/** The pack record an import of 2.29 to 2.43 wrote: the classic reading, ids scoped to the pack. */
function storedClassicPack(id = PACK_ID): LevelPack {
  const levels = DatCodec.decodeBuffer(bytes, 'SYNTH', DEFAULT_RULESET);
  return { id, name: 'SYNTH', builtIn: false, levels: structuredClone(scopeLevelIds(levels, id)) };
}

/** The pack record an import of 2.10 to 2.28 wrote: the plain Lynx reading. */
function storedLynxPack(id = PACK_ID): LevelPack {
  const levels = DatCodec.decodeBuffer(bytes, 'SYNTH', 'lynx');
  return { id, name: 'SYNTH', builtIn: false, levels: structuredClone(scopeLevelIds(levels, id)) };
}

/** The level as the editor writes it back when the player saves it. */
function resavedByEditor(level: CompiledLevel): CompiledLevel {
  const doc = documentFromLevel(level, { title: level.customTitle ?? '', hint: level.customHint ?? '' });
  const context: LevelExportContext = { id: level.id, number: level.number, password: level.password, fallbackTitle: level.customTitle ?? '' } as LevelExportContext;
  return levelFromDocument(doc, context);
}

const entityList = (level: CompiledLevel): string[] => level.entities.map((e) => `${e.type}@${e.x},${e.y}${e.dir}`);

describe('stored .DAT packs move to the CCLP engine', () => {
  beforeAll(async () => {
    loadTestConfigs();
    bytes = encode([synthLevel(1), synthLevel(2), synthLevel(3)]);
    reference = await referenceOf(bytes);
    expect(ConfigRegistry.getTile('clone_machine').isCloneMachine).toBe(true);
  });

  it('moves a classic pack of a held set to the Lynx reading of the bytes, keeping pack and level ids', async () => {
    const stored = storedClassicPack();
    const plan = await planCclpPackMove(stored, ctx());
    expect(plan.verdict).toBe('moved');
    expect(plan.moved).toBe(3);
    expect(plan.pack.id).toBe(PACK_ID);
    expect(plan.pack.levels.map((l) => l.id)).toEqual(stored.levels.map((l) => l.id));
    expect(plan.pack.levels.map((l) => l.number)).toEqual([1, 2, 3]);
    for (const [i, level] of plan.pack.levels.entries()) {
      expect(level.ruleset).toBe('lynx');
      expect(level.rulesProfile).toBe('cclp');
      expect(level.rulesFlavor).toBeUndefined();
      expect({ ...level, id: '', number: 0 }).toEqual({ ...reference.lynx[i], id: '', number: 0 });
    }
    // The classic reading listed the bugs in monster list order and faced the plain block S; the Lynx reading does neither.
    expect(entityList(stored.levels[0])).toEqual(['bug@20,20N', 'bug@6,8E', 'dirt_block@7,7S']);
    expect(entityList(plan.pack.levels[0])).toEqual(['dirt_block@7,7N', 'bug@6,8E', 'bug@20,20N']);
  });

  it('is a no-op on a pack it already moved', async () => {
    const moved = (await planCclpPackMove(storedClassicPack(), ctx())).pack;
    const again = await planCclpPackMove(moved, ctx());
    expect(again.verdict).toBe('not_dat');
    expect(again.pack).toBe(moved);
  });

  it('leaves a held set whole when one level was edited', async () => {
    const stored = storedClassicPack();
    stored.levels[1] = { ...resavedByEditor(stored.levels[1]), timeLimitSeconds: 999 };
    const plan = await planCclpPackMove(stored, ctx());
    expect(plan.verdict).toBe('changed');
    expect(isKeptVerdict(plan.verdict)).toBe(true);
    expect(plan.moved).toBe(0);
    expect(plan.pack).toBe(stored);
  });

  it.each([
    ['cellEdges', [{ x: 5, y: 5, edges: 1 }]],
    ['cellHints', [{ x: 5, y: 5, text: 'Hint' }]],
    ['extraPlayers', [{ x: 6, y: 6, dir: 'S', character: 'melinda' }]],
    ['character', 'melinda'],
    ['winRule', 'targets'],
    ['railTracks', [{ x: 5, y: 5, segments: [] }]],
    ['launcherLinks', [{ triggerX: 1, triggerY: 1, launcherX: 2, launcherY: 2 }]],
    ['signalLinks', [{ fromX: 1, fromY: 1, toX: 2, toY: 2 }]],
    ['theme', 'ice']
  ])('leaves a held set whole when a level gained %s', async (key, value) => {
    const stored = storedClassicPack();
    (stored.levels[2] as unknown as Record<string, unknown>)[key] = value;
    expect((await planCclpPackMove(stored, ctx())).verdict).toBe('changed');
  });

  it('leaves a held set whose bundled file changed since the import', async () => {
    const changedBytes = encode([synthLevel(1), synthLevel(2, 5), synthLevel(3)]);
    const changedReference = await referenceOf(changedBytes);
    expect(changedReference.signature).toBe(reference.signature);
    const plan = await planCclpPackMove(storedClassicPack(), ctx({ references: async () => [changedReference] }));
    expect(plan.verdict).toBe('changed');
  });

  it('counts an edit that only touched the hidden layer as a change', async () => {
    const stored = storedClassicPack();
    stored.levels[1] = { ...stored.levels[1], underlays: [{ x: 9, y: 9, terrain: 'wall' }] };
    const plan = await planCclpPackMove(stored, ctx());
    expect(plan.verdict).toBe('changed');
    expect(plan.moved).toBe(0);
    expect(plan.pack).toBe(stored);
  });

  it('leaves a pack whose level was added or removed', async () => {
    const added = storedLynxPack();
    added.levels.push({ ...structuredClone(added.levels[0]), id: 'lvl_custom_1700000000001', number: 4 });
    expect((await planCclpPackMove(added, unheld())).verdict).toBe('changed');
    const removed = storedLynxPack();
    removed.levels = removed.levels.slice(1).map((l, i) => ({ ...l, number: i + 1 }));
    expect((await planCclpPackMove(removed, unheld())).verdict).toBe('changed');
  });

  it('keeps an official set on its engine', async () => {
    const stored = storedClassicPack();
    const plan = await planCclpPackMove(stored, ctx({ officialSignatures: [reference.signature] }));
    expect(plan.verdict).toBe('official');
    expect(isKeptVerdict(plan.verdict)).toBe(false);
    expect(plan.pack).toBe(stored);
  });

  it('never touches a pack the player made, a shared pack or the custom pack', async () => {
    const base = storedClassicPack();
    for (const pack of [{ ...base, userCreated: true }, { ...base, sourceHash: 'a'.repeat(64) }, { ...base, i18nKey: 'app.packs.custom.label' }]) {
      expect((await planCclpPackMove(pack, ctx())).verdict).toBe('not_dat');
    }
  });

  it('never calls a CC2 pack a .DAT pack, even with an edited 32 x 32 level', async () => {
    const small = { ...synthLevel(1), rulesFlavor: 'cc' as const, terrain: synthLevel(1).terrain.slice(0, 20), items: synthLevel(1).items.slice(0, 20) };
    expect((await planCclpPackMove({ id: 'pack_cc2_1', name: 'CC2', builtIn: false, levels: [small] }, ctx())).verdict).toBe('not_dat');
    const cc2Level = { ...synthLevel(1), rulesFlavor: 'cc' as const, cc2: { sha256: 'a'.repeat(64) } as unknown as CompiledLevel['cc2'] };
    const edited = { ...synthLevel(2), rulesFlavor: 'cc' as const };
    const plan = await planCclpPackMove({ id: `pack_cc2_${OLD_STAMP}`, name: 'CC2', builtIn: false, levels: [cc2Level, edited] }, ctx());
    expect(plan.verdict).toBe('mixed');
    expect(isKeptVerdict(plan.verdict)).toBe(false);
  });

  it('leaves a classic pack of a set it does not hold, and says so', async () => {
    const plan = await planCclpPackMove(storedClassicPack(), unheld());
    expect(plan.verdict).toBe('unknown');
    expect(isKeptVerdict(plan.verdict)).toBe(true);
  });

  it('gives an untouched plain Lynx pack the CCLP rules and nothing else', async () => {
    const stored = storedLynxPack();
    const plan = await planCclpPackMove(stored, unheld());
    expect(plan.verdict).toBe('moved');
    plan.pack.levels.forEach((level, i) => {
      const { rulesProfile, ...rest } = level;
      expect(rulesProfile).toBe('cclp');
      expect(rest).toEqual(stored.levels[i]);
    });
  });

  it('leaves a plain Lynx pack of an unheld set once the editor saved one of its levels', async () => {
    const stored = storedLynxPack();
    stored.levels[0] = resavedByEditor(stored.levels[0]);
    expect((await planCclpPackMove(stored, unheld())).verdict).toBe('changed');
  });

  it('never vouches from the record alone for a pack imported by a build that already reads .DAT files the CCLP way', async () => {
    expect((await planCclpPackMove(storedLynxPack(`pack_synth_${CCLP_IMPORT_RELEASE_MS}`), unheld())).verdict).toBe('not_dat');
    expect((await planCclpPackMove(storedLynxPack('pack_synth_nostamp'), unheld())).verdict).toBe('not_dat');
  });

  it('treats a pack file of untouched plain Lynx levels by its import time', async () => {
    const text = serializePack('SYNTH', storedLynxPack().levels);
    const parsed = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), () => OLD_STAMP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pack: LevelPack = { id: `pack_synth_${OLD_STAMP}`, name: parsed.name, builtIn: false, levels: parsed.levels };
    expect(pack.levels.every((l) => l.ruleset === 'lynx' && l.rulesProfile === undefined)).toBe(true);
    // Imported before the cutoff, the content is an untouched old reading: it moves like the .DAT import it came from.
    expect((await planCclpPackMove(pack, unheld())).verdict).toBe('moved');
    // Imported after, it is no old import: it stays, and nothing is said.
    expect((await planCclpPackMove({ ...pack, id: `pack_synth_${CCLP_IMPORT_RELEASE_MS + 1}` }, unheld())).verdict).toBe('not_dat');
    // Edited before it was exported: it stays.
    const editedText = serializePack('SYNTH', [resavedByEditor(storedLynxPack().levels[0]), ...storedLynxPack().levels.slice(1)]);
    const edited = parsePackJson(editedText, ConfigRegistry.getLevelSizeBounds(), new Set(), () => OLD_STAMP);
    if (!edited.ok) throw new Error('parse');
    expect((await planCclpPackMove({ ...pack, levels: edited.levels }, unheld())).verdict).toBe('changed');
  });

  it('turns a classic level into the Lynx reading', () => {
    const level: CompiledLevel = {
      ...synthLevel(1),
      rulesFlavor: 'cc',
      underlays: [{ x: 9, y: 9, terrain: 'wall' }],
      entities: [
        { type: 'dirt_block', x: 4, y: 9, dir: 'S' },
        { type: 'dirt_block', x: 3, y: 9, dir: 'S' },
        { type: 'bug', x: 1, y: 1, dir: 'W' }
      ]
    };
    level.terrain[9][4] = 'clone_machine';
    const moved = moveClassicDatLevel(level, isCloneMachine);
    expect(entityList(moved)).toEqual(['bug@1,1W', 'dirt_block@3,9N', 'dirt_block@4,9S']);
    expect(moved.underlays).toBeUndefined();
    expect(moved.rulesFlavor).toBeUndefined();
    expect(moved.ruleset).toBe('lynx');
    expect(moved.rulesProfile).toBe('cclp');
  });

  it('reads the stored records defensively', () => {
    expect(parseNoticedPackIds(null)).toEqual([]);
    expect(parseNoticedPackIds('not json')).toEqual([]);
    expect(parseNoticedPackIds('{"a":1}')).toEqual([]);
    expect(parseNoticedPackIds('["p1",2,"p2"]')).toEqual(['p1', 'p2']);
    expect(parseCclpMoveRecord(null)).toBeNull();
    expect(parseCclpMoveRecord('[1]')).toBeNull();
    expect(parseCclpMoveRecord('{"version":"1","kept":[]}')).toBeNull();
    expect(parseCclpMoveRecord('{"version":1,"kept":["a",3]}')).toEqual({ version: 1, kept: ['a'] });
  });
});

describe('start-up message about stored packs', () => {
  const translate = (key: string, params?: Record<string, number>): string => `${key}${JSON.stringify(params ?? {})}`;

  it('puts the CC3D conversion and the .DAT packs in one message', () => {
    const notice = storedPackNotice({ converted: 2, kept: 1 }, { movedPacks: 3, keptPackIds: ['a', 'b'] }, [], translate);
    expect(notice.message).toBe(
      'cc3d.import.migration.converted.label{"count":2} cc3d.import.migration.kept.label{"kept":1} app.packs.cclp_move.moved.label{"packs":3} app.packs.cclp_move.kept.label{"count":2}'
    );
    expect(notice.keptPackIdsTold).toEqual(['a', 'b']);
  });

  it('tells each kept pack once', () => {
    const notice = storedPackNotice(null, { movedPacks: 0, keptPackIds: ['a', 'b'] }, ['a'], translate);
    expect(notice.message).toBe('app.packs.cclp_move.kept.label{"count":1}');
    expect(notice.keptPackIdsTold).toEqual(['b']);
    expect(storedPackNotice(null, { movedPacks: 0, keptPackIds: ['a', 'b'] }, ['a', 'b'], translate)).toEqual({ message: null, keptPackIdsTold: [] });
  });

  it('keeps the kept line back, and unmarked, while a dialog is open or about to open', () => {
    const busy = storedPackNotice(null, { movedPacks: 1, keptPackIds: ['a'] }, [], translate, true);
    expect(busy.message).toBe('app.packs.cclp_move.moved.label{"packs":1}');
    expect(busy.keptPackIdsTold).toEqual([]);
    expect(storedPackNotice(null, { movedPacks: 0, keptPackIds: ['a'] }, [], translate, true)).toEqual({ message: null, keptPackIdsTold: [] });
  });

  it('says nothing when nothing happened', () => {
    expect(storedPackNotice(null, null, [], translate)).toEqual({ message: null, keptPackIdsTold: [] });
  });
});
