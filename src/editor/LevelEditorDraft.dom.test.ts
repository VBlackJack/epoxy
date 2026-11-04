// @vitest-environment happy-dom
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
 * The editor's draft autosave and crash recovery, in a DOM built from the real index.html, with fake timers
 * and a stubbed localStorage: every page writes and deletes only its own key, and a page offers the drafts
 * that earlier visits left under other keys.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));
const choiceDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/choiceDialog', () => ({ choiceDialog }));
const askSaveInto = vi.hoisted(() => vi.fn());
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { cellAt, topTerrain } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_DRAFT_MAX_CHARS, EDITOR_DRAFT_STORAGE_PREFIX, EDITOR_DRAFT_WRITE_DELAY_MS } from '../ui/uiConstants';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { DRAFT_VERSION, draftLevelOf, levelFingerprint, parseDraft, type EditorDraft } from './editorDraft';
import { LevelEditor } from './LevelEditor';

const CELL_PX = 10;
const GRID_WIDTH = 5;
const GRID_HEIGHT = 4;
const OTHER_TAB_ID = 'tab-of-another-page';
const THIRD_TAB_ID = 'tab-of-a-third-page';
const TITLE_INPUT_ID = 'editor-meta-title';
const LOCK_API_PROPERTY = 'locks';

const fake = new FakeIndexedDb();
let store: Map<string, string>;
let failSet = false;
let failGet = false;
let failList = false;
let setKeys: string[] = [];
let removeKeys: string[] = [];
let liveKeySet: Set<string>;
let editor: LevelEditor;
let extraEditors: LevelEditor[] = [];
let canvas: HTMLCanvasElement;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function fakeRenderer() {
  return {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn()
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function status(): string {
  return byId('editor-status-bar').textContent ?? '';
}

function keyFor(tabId: string): string {
  return ConfigRegistry.getStorageKey(`${EDITOR_DRAFT_STORAGE_PREFIX}${tabId}`);
}

/** The key of the page under test. */
function ownKey(): string {
  return keyFor(editor['draftTabId']);
}

function draftAt(key: string): EditorDraft | null {
  const raw = store.get(key);
  if (raw === undefined) return null;
  const parsed = parseDraft(raw, EDITOR_DRAFT_MAX_CHARS);
  if (!parsed.ok) throw new Error(`Stored draft is not valid: ${parsed.reason}`);
  return parsed.draft;
}

/** The draft the page under test wrote. */
function storedDraft(): EditorDraft | null {
  return draftAt(ownKey());
}

/** The draft a previous page left under its own key. */
function foreignDraft(tabId = OTHER_TAB_ID): EditorDraft | null {
  return draftAt(keyFor(tabId));
}

/** Every draft key in the storage, whoever wrote it. */
function draftKeys(): string[] {
  return [...store.keys()].filter((key) => key.startsWith(ConfigRegistry.getStorageKey(EDITOR_DRAFT_STORAGE_PREFIX))).sort();
}

/** A new page: the editor is built over the storage as it stands. */
function openEditor(keepPrevious = false): LevelEditor {
  // The page being replaced goes away with its listeners.
  if (keepPrevious) extraEditors.push(editor);
  else editor?.dispose();
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: GRID_WIDTH * CELL_PX, bottom: GRID_HEIGHT * CELL_PX, width: GRID_WIDTH * CELL_PX, height: GRID_HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  canvas.getContext = (() => noopContext()) as unknown as HTMLCanvasElement['getContext'];
  canvas.setPointerCapture = () => undefined;
  const hooks = { onTestPlay: vi.fn(), onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  const created = new LevelEditor(canvas, fakeRenderer() as never, hooks as never, { liveKeys: async () => liveKeySet });
  created.buildUI();
  return created;
}

function paintCell(x: number, y: number): void {
  const at = (type: string): void =>
    void canvas.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (y + 0.5) * CELL_PX })
    );
  at('pointerdown');
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function typeTitle(value: string): void {
  const input = byId<HTMLInputElement>(TITLE_INPUT_ID);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pause(ms = EDITOR_DRAFT_WRITE_DELAY_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A small Epoxy level with edges and a floor inside. */
function epoxyLevel(id = 'lvl_draft'): CompiledLevel {
  const width = 6;
  const height = 5;
  const terrain = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'floor'))
  );
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Stored room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

async function packWith(level: CompiledLevel): Promise<{ packId: string; stored: CompiledLevel }> {
  const created = await ConfigRegistry.createUserPack('Draft tests');
  if (!created.pack) throw new Error('The test pack was not created');
  await ConfigRegistry.saveLevelToPack(created.pack.id, level);
  const stored = ConfigRegistry.getAllPacks().find((pack) => pack.id === created.pack!.id)?.levels[0];
  if (!stored) throw new Error('The test level was not stored');
  return { packId: created.pack.id, stored };
}

/** Writes a draft the way a previous page (`tabId`) would have left it, under that page's own key. */
function seedDraft(draft: Partial<EditorDraft> & Pick<EditorDraft, 'level'>): EditorDraft {
  const full: EditorDraft = {
    v: DRAFT_VERSION,
    tabId: OTHER_TAB_ID,
    writtenAt: 1,
    source: { packId: null, levelId: null },
    currentLevelId: draft.level.id,
    baseHash: '',
    ...draft
  };
  store.set(keyFor(full.tabId), JSON.stringify(full));
  return full;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  loadTestConfigs();
  fake.records.clear();
  store = new Map();
  failSet = false;
  failGet = false;
  failList = false;
  setKeys = [];
  removeKeys = [];
  liveKeySet = new Set();
  extraEditors = [];
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    get length(): number {
      if (failList) throw new Error('storage cannot be listed');
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => {
      if (failGet) throw new Error('storage blocked');
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      setKeys.push(key);
      if (failSet) throw new Error('quota exceeded');
      store.set(key, value);
    },
    removeItem: (key: string) => {
      removeKeys.push(key);
      store.delete(key);
    }
  });
  confirmDialog.mockReset();
  choiceDialog.mockReset();
  askSaveInto.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
});

afterEach(async () => {
  editor?.dispose();
  for (const extra of extraEditors) extra.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, LOCK_API_PROPERTY);
  await LevelPackStorage.closeConnection();
});

describe('writing the draft', () => {
  it('writes after the pause that follows an edit, not before, under the page own key', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    expect(editor.hasUnsavedChanges()).toBe(true);
    await pause(EDITOR_DRAFT_WRITE_DELAY_MS - 1);
    expect(storedDraft()).toBeNull();
    await pause(1);
    const draft = storedDraft();
    expect(draft?.v).toBe(DRAFT_VERSION);
    expect(draft?.tabId).toBe(editor['draftTabId']);
    expect(draft?.currentLevelId).toBe(editor.exportCompiledLevel().id);
    expect(draft?.source).toEqual({ packId: null, levelId: null });
  });

  it('writes once for a run of edits', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('A');
    await pause(EDITOR_DRAFT_WRITE_DELAY_MS - 100);
    typeTitle('AB');
    await pause(EDITOR_DRAFT_WRITE_DELAY_MS - 100);
    expect(setKeys).toHaveLength(0);
    await pause(100);
    expect(setKeys).toHaveLength(1);
    expect(storedDraft()?.level.customTitle).toBe('AB');
  });

  it('waits for the end of a stroke', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 15, clientY: 25 }));
    await pause(EDITOR_DRAFT_WRITE_DELAY_MS * 2);
    expect(storedDraft()).toBeNull();
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await pause();
    expect(storedDraft()).not.toBeNull();
  });

  it('records where the level came from and the fingerprint of the stored version', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    editor = openEditor();
    expect(await editor.openLevel(packId, stored.id)).toBe(true);
    typeTitle('Changed');
    await pause();
    const draft = storedDraft();
    expect(draft?.source).toEqual({ packId, levelId: stored.id });
    expect(draft?.baseHash).toBe(levelFingerprint(stored));
    expect(draft?.level.customTitle).toBe('Changed');
  });

  it('deletes its draft when the level is saved', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    editor = openEditor();
    await editor.openLevel(packId, stored.id);
    typeTitle('Changed');
    await pause();
    expect(storedDraft()).not.toBeNull();
    await editor.save();
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(storedDraft()).toBeNull();
  });

  it('keeps the draft when a save keeps the editor dirty (the browser could not store the level)', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    expect(storedDraft()).not.toBeNull();
    // Dirty again after a save that was not persisted: the editor stays dirty and so does the draft.
    vi.spyOn(ConfigRegistry, 'saveLevelToPack').mockResolvedValue({ ok: true, persisted: false, index: 0 } as never);
    vi.spyOn(ConfigRegistry, 'createUserPack').mockResolvedValue({ ok: true, persisted: true, pack: { id: 'p', name: 'p', levels: [] } } as never);
    askSaveInto.mockResolvedValue({ kind: 'new', name: 'p' });
    await editor.save();
    expect(editor.hasUnsavedChanges()).toBe(true);
    await pause();
    expect(storedDraft()).not.toBeNull();
  });

  it('deletes its draft when undo returns to the saved state', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    expect(storedDraft()).not.toBeNull();
    editor.undo();
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(storedDraft()).toBeNull();
  });

  it('writes a pending draft at once when the page is hidden', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    expect(storedDraft()).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(storedDraft()?.tabId).toBe(editor['draftTabId']);
    expect(storedDraft()?.level.id).toBe(editor.exportCompiledLevel().id);
  });

  it('writes a pending draft when the tab turns hidden', () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    expect(storedDraft()).toBeNull();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(storedDraft()?.tabId).toBe(editor['draftTabId']);
    expect(storedDraft()?.level.id).toBe(editor.exportCompiledLevel().id);
  });

  it('writes a pending draft when the editor is left', () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    editor.onLeave();
    expect(storedDraft()).not.toBeNull();
  });

  it('stores a CC3D level without its derived layers, and they come back from the cc3d data', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    const draft = storedDraft();
    expect(draft?.level.ruleset).toBe('cc3d');
    expect(draft?.level.terrain).toEqual([]);
    expect(draft?.level.items).toEqual([]);
    expect(draft?.level.entities).toEqual([]);
    expect(draft?.level.cc3d).toBeDefined();
    // Restored on a new page, the layers are rebuilt from the cc3d data.
    const written = draft!;
    store.delete(ownKey());
    seedDraft({ level: written.level, source: written.source, baseHash: written.baseHash });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    const level = editor.exportCompiledLevel();
    expect(level.terrain.length).toBeGreaterThan(0);
    expect(level.terrain[2][1]).toBe('wall');
    const cell = cellAt(level.cc3d!, 1, 2);
    expect(cell && topTerrain(cell).kind).toBe('wall');
  });
});

describe('thin walls in a draft', () => {
  it('are written to the draft and come back when it is restored', async () => {
    const edges = [{ x: 2, y: 2, sides: ['N', 'W'] as Array<'N' | 'W'> }];
    editor = openEditor();
    editor.loadCompiledLevel({ ...epoxyLevel(), cellEdges: edges });
    typeTitle('Edged');
    await pause();
    const written = storedDraft()!;
    expect(written.level.cellEdges).toEqual(edges);
    store.delete(ownKey());
    seedDraft({ level: written.level, source: written.source, baseHash: written.baseHash });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(editor.exportCompiledLevel().cellEdges).toEqual(edges);
  });
});

describe('hidden terrain in a draft', () => {
  it('is written to the draft and comes back when it is restored', async () => {
    const hidden = [{ x: 2, y: 2, terrain: 'ice' }];
    const level = epoxyLevel();
    level.terrain[2][2] = 'door_red';
    editor = openEditor();
    editor.loadCompiledLevel({ ...level, underlays: hidden });
    typeTitle('Hidden');
    await pause();
    const written = storedDraft()!;
    expect(written.level.underlays).toEqual(hidden);
    store.delete(ownKey());
    seedDraft({ level: written.level, source: written.source, baseHash: written.baseHash });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(editor.exportCompiledLevel().underlays).toEqual(hidden);
  });
});

describe('a page touches only its own key', () => {
  it('writes and removes nothing but its own key, whatever other drafts the storage holds', async () => {
    seedDraft({ level: epoxyLevel('lvl_old'), tabId: OTHER_TAB_ID });
    seedDraft({ level: epoxyLevel('lvl_older'), tabId: THIRD_TAB_ID });
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    editor.undo();
    paintCell(2, 2);
    window.dispatchEvent(new Event('pagehide'));
    typeTitle('Changed');
    await pause();
    expect(setKeys.length).toBeGreaterThan(0);
    expect(new Set(setKeys)).toEqual(new Set([ownKey()]));
    expect(new Set(removeKeys)).toEqual(new Set([ownKey()]));
    expect(foreignDraft(OTHER_TAB_ID)?.level.id).toBe('lvl_old');
    expect(foreignDraft(THIRD_TAB_ID)?.level.id).toBe('lvl_older');
  });

  it('removes only its own draft when the work becomes clean', async () => {
    seedDraft({ level: epoxyLevel('lvl_old') });
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    expect(storedDraft()).not.toBeNull();
    editor.undo();
    expect(storedDraft()).toBeNull();
    expect(foreignDraft()?.level.id).toBe('lvl_old');
  });

  it('keeps writing its own draft before the offer is answered, and does not touch the draft waiting', async () => {
    seedDraft({ level: epoxyLevel('lvl_old') });
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    expect(storedDraft()?.level.ruleset).toBe('cc3d');
    expect(foreignDraft()?.level.id).toBe('lvl_old');
  });

  it('keeps a draft when a clean level is loaded before the offer', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.initBlankMap();
    editor.loadCompiledLevel(epoxyLevel('other'));
    await pause(EDITOR_DRAFT_WRITE_DELAY_MS * 3);
    expect(foreignDraft()?.level.id).toBe('lvl_draft');
    expect(draftKeys()).toEqual([keyFor(OTHER_TAB_ID)]);
  });

  it('ignores keys of the earlier scheme: they are neither offered nor removed', async () => {
    const old = JSON.stringify({ v: DRAFT_VERSION, tabId: OTHER_TAB_ID, writtenAt: 1, source: { packId: null, levelId: null }, currentLevelId: 'x', baseHash: '', level: epoxyLevel('x') });
    const singleKey = ConfigRegistry.getStorageKey('editor_draft');
    const pendingKey = ConfigRegistry.getStorageKey('editor_draft_pending');
    store.set(singleKey, old);
    store.set(pendingKey, old);
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(store.get(singleKey)).toBe(old);
    expect(store.get(pendingKey)).toBe(old);
    expect(removeKeys).not.toContain(singleKey);
    expect(removeKeys).not.toContain(pendingKey);
  });
});

describe('storage failures and size', () => {
  it('says once that a draft could not be stored, goes on editing, and says it again after a success', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    failSet = true;
    typeTitle('A');
    await pause();
    expect(status()).toBe(t('editor.draft.status.write_failed.label'));
    typeTitle('AB');
    expect(byId<HTMLInputElement>(TITLE_INPUT_ID).value).toBe('AB');
    editor['setStatusText']('other');
    await pause();
    expect(status()).toBe('other');
    expect(editor.hasUnsavedChanges()).toBe(true);
    failSet = false;
    typeTitle('ABC');
    await pause();
    expect(storedDraft()?.level.customTitle).toBe('ABC');
    failSet = true;
    typeTitle('ABCD');
    await pause();
    expect(status()).toBe(t('editor.draft.status.write_failed.label'));
  });

  it('skips a draft above the cap and says so once', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('x'.repeat(EDITOR_DRAFT_MAX_CHARS));
    await pause();
    expect(setKeys).toHaveLength(0);
    expect(status()).toBe(t('editor.draft.status.too_large.label'));
  });

  it('mentions the drafts still waiting when a write fails, and never deletes them', async () => {
    seedDraft({ level: epoxyLevel('lvl_old') });
    editor = openEditor();
    choiceDialog.mockResolvedValueOnce(null);
    await editor.offerDraftOnce();
    failSet = true;
    editor.loadCompiledLevel(epoxyLevel('new_work'));
    typeTitle('New work');
    await pause();
    expect(status()).toBe(`${t('editor.draft.status.write_failed.label')} ${t('editor.draft.status.others_waiting.label')}`);
    expect(foreignDraft()?.level.id).toBe('lvl_old');
    expect(removeKeys).not.toContain(keyFor(OTHER_TAB_ID));
  });

  it('makes no offer and does not crash when the storage cannot be read', async () => {
    failGet = true;
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    expect(editor.hasUnsavedChanges()).toBe(true);
    await pause();
    editor.undo();
    expect(editor.hasUnsavedChanges()).toBe(false);
  });

  it('makes no offer and does not crash when the storage cannot be listed', async () => {
    seedDraft({ level: epoxyLevel('lvl_old') });
    failList = true;
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(status()).not.toBe(t('editor.draft.status.invalid.label'));
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    await pause();
    expect(storedDraft()).not.toBeNull();
  });
});

describe('the offer at startup', () => {
  it('restores on top of the stored level: the editor is dirty and undo returns to the stored version', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({
      level: { ...stored, customTitle: 'Draft title' },
      source: { packId, levelId: stored.id },
      baseHash: levelFingerprint(stored)
    });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
    expect(choiceDialog.mock.calls[0][0].message).toBe(t('editor.draft.offer.restore.label', { title: 'Draft title' }));
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(byId<HTMLInputElement>(TITLE_INPUT_ID).value).toBe('Draft title');
    expect(status()).toBe(t('editor.draft.status.restored.label'));
    // It is written again under this page's own key at once, and the earlier page's key is gone.
    expect(storedDraft()?.level.customTitle).toBe('Draft title');
    expect(foreignDraft()).toBeNull();
    editor.undo();
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(byId<HTMLInputElement>(TITLE_INPUT_ID).value).toBe('Stored room');
    expect(storedDraft()).toBeNull();
    // Saved afterwards, it updates the level it came from.
    editor.redo();
    await editor.save();
    const levels = ConfigRegistry.getAllPacks().find((pack) => pack.id === packId)?.levels ?? [];
    expect(levels).toHaveLength(1);
    expect(levels[0].customTitle).toBe('Draft title');
  });

  it('warns when the stored level changed since the draft started from it', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({
      level: { ...stored, customTitle: 'Draft title' },
      source: { packId, levelId: stored.id },
      baseHash: levelFingerprint({ ...stored, customHint: 'an older version' })
    });
    editor = openEditor();
    choiceDialog.mockResolvedValue('discard');
    await editor.offerDraftOnce();
    expect(choiceDialog.mock.calls[0][0].message).toBe(t('editor.draft.offer.conflict.label', { title: 'Draft title' }));
  });

  it('removes a draft the editor wrote that makes the same document as its source, without asking', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    editor = openEditor();
    await editor.openLevel(packId, stored.id);
    // An edit and its reverse: the editor stays dirty and writes a draft that holds the stored document.
    typeTitle('Changed');
    typeTitle('Stored room');
    await pause();
    expect(storedDraft()).not.toBeNull();
    const earlierKey = ownKey();
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(store.has(earlierKey)).toBe(false);
    expect(editor.hasUnsavedChanges()).toBe(false);
  });

  it('removes a draft whose level equals its source as stored', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({ level: draftLevelOf(stored), source: { packId, levelId: stored.id }, baseHash: levelFingerprint(stored) });
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()).toBeNull();
  });

  it('discards on request: the draft is deleted and the editor stays clean', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({ level: { ...stored, customTitle: 'Draft title' }, source: { packId, levelId: stored.id }, baseHash: levelFingerprint(stored) });
    editor = openEditor();
    choiceDialog.mockResolvedValue('discard');
    await editor.offerDraftOnce();
    expect(foreignDraft()).toBeNull();
    expect(editor.hasUnsavedChanges()).toBe(false);
    typeTitle('New edit');
    await pause();
    expect(storedDraft()?.level.customTitle).toBe('New edit');
  });

  it('offers a level whose source is gone as a new unsaved level in its pack', async () => {
    const { packId } = await packWith(epoxyLevel());
    seedDraft({ level: epoxyLevel('lvl_deleted'), source: { packId, levelId: 'lvl_deleted' }, baseHash: 'whatever' });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(choiceDialog.mock.calls[0][0].message).toBe(t('editor.draft.offer.orphan.label', { title: 'Stored room' }));
    expect(editor.hasUnsavedChanges()).toBe(true);
    // A save adds a level to the pack instead of replacing one.
    askSaveInto.mockResolvedValue({ kind: 'pack', packId });
    await editor.save();
    const levels = ConfigRegistry.getAllPacks().find((pack) => pack.id === packId)?.levels ?? [];
    expect(levels).toHaveLength(2);
  });

  it('opens an orphan of a pack that no longer exists with no pack', async () => {
    seedDraft({ level: epoxyLevel('lvl_deleted'), source: { packId: 'gone', levelId: 'lvl_deleted' } });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(editor.exportCompiledLevel().customTitle).toBe('Stored room');
  });

  it('finds a level that moved to another pack by its id, and saves into that pack', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({
      level: { ...stored, customTitle: 'Draft title' },
      source: { packId: 'the-old-pack', levelId: stored.id },
      baseHash: levelFingerprint(stored)
    });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(choiceDialog.mock.calls[0][0].message).toBe(t('editor.draft.offer.restore.label', { title: 'Draft title' }));
    expect(editor.hasUnsavedChanges()).toBe(true);
    await editor.save();
    const levels = ConfigRegistry.getAllPacks().find((pack) => pack.id === packId)?.levels ?? [];
    expect(levels).toHaveLength(1);
    expect(levels[0].customTitle).toBe('Draft title');
  });

  it('asks once per page', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    editor = openEditor();
    choiceDialog.mockResolvedValue('discard');
    await Promise.all([editor.offerDraftOnce(), editor.offerDraftOnce()]);
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
  });

  it('offers the newest draft first, ties broken by key', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_a'), customTitle: 'Oldest' }, tabId: 'tab-a', writtenAt: 1 });
    seedDraft({ level: { ...epoxyLevel('lvl_b'), customTitle: 'Newest' }, tabId: 'tab-b', writtenAt: 9 });
    seedDraft({ level: { ...epoxyLevel('lvl_c'), customTitle: 'Tied later key' }, tabId: 'tab-d', writtenAt: 5 });
    seedDraft({ level: { ...epoxyLevel('lvl_d'), customTitle: 'Tied earlier key' }, tabId: 'tab-c', writtenAt: 5 });
    editor = openEditor();
    choiceDialog.mockResolvedValue('discard');
    await editor.offerDraftOnce();
    const titles = choiceDialog.mock.calls.map((call) => call[0].message);
    expect(titles).toEqual(
      ['Newest', 'Tied earlier key', 'Tied later key', 'Oldest'].map((title) => t('editor.draft.offer.orphan.label', { title }))
    );
    expect(draftKeys()).toEqual([]);
  });

  it('drops the draft of a living page, found through the live keys seam, without asking or deleting it', async () => {
    seedDraft({ level: epoxyLevel('lvl_live'), tabId: OTHER_TAB_ID });
    seedDraft({ level: { ...epoxyLevel('lvl_dead'), customTitle: 'Dead' }, tabId: THIRD_TAB_ID });
    liveKeySet = new Set([keyFor(OTHER_TAB_ID)]);
    editor = openEditor();
    choiceDialog.mockResolvedValue('discard');
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
    expect(choiceDialog.mock.calls[0][0].message).toBe(t('editor.draft.offer.orphan.label', { title: 'Dead' }));
    expect(foreignDraft(OTHER_TAB_ID)?.level.id).toBe('lvl_live');
    expect(foreignDraft(THIRD_TAB_ID)).toBeNull();
  });

  it('offers everything when the browser has no Web Locks', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    // The default seam, without navigator.locks.
    const plain = new LevelEditor(canvas, fakeRenderer() as never, {} as never);
    extraEditors.push(plain);
    choiceDialog.mockResolvedValue(null);
    await plain.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
  });

  it('offers everything when the lock query throws', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    const request = vi.fn(() => new Promise<void>(() => undefined));
    const query = vi.fn(async () => {
      throw new Error('query refused');
    });
    Object.defineProperty(navigator, LOCK_API_PROPERTY, { value: { request, query }, configurable: true });
    const plain = new LevelEditor(canvas, fakeRenderer() as never, {} as never);
    extraEditors.push(plain);
    choiceDialog.mockResolvedValue(null);
    await plain.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
  });

  it('offers everything when the browser has request but no query', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    const request = vi.fn(() => new Promise<void>(() => undefined));
    Object.defineProperty(navigator, LOCK_API_PROPERTY, { value: { request }, configurable: true });
    const plain = new LevelEditor(canvas, fakeRenderer() as never, {} as never);
    extraEditors.push(plain);
    choiceDialog.mockResolvedValue(null);
    await plain.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
  });

  it('counts a pending lock as a living page', async () => {
    seedDraft({ level: epoxyLevel('lvl_live') });
    const request = vi.fn(() => new Promise<void>(() => undefined));
    const query = vi.fn(async () => ({ held: [], pending: [{ name: keyFor(OTHER_TAB_ID) }] }));
    Object.defineProperty(navigator, LOCK_API_PROPERTY, { value: { request, query }, configurable: true });
    const plain = new LevelEditor(canvas, fakeRenderer() as never, {} as never);
    extraEditors.push(plain);
    await plain.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()?.level.id).toBe('lvl_live');
  });

  it('reads the held Web Locks of the browser by default, and holds its own until it is disposed', async () => {
    seedDraft({ level: epoxyLevel('lvl_live') });
    let held: Promise<void> | null = null;
    let lockName = '';
    const request = vi.fn((name: string, callback: () => Promise<void>) => {
      lockName = name;
      held = callback();
      return held;
    });
    const query = vi.fn(async () => ({ held: [{ name: keyFor(OTHER_TAB_ID) }], pending: [] }));
    Object.defineProperty(navigator, LOCK_API_PROPERTY, { value: { request, query }, configurable: true });
    const plain = new LevelEditor(canvas, fakeRenderer() as never, {} as never);
    extraEditors.push(plain);
    expect(lockName).toBe(keyFor(plain['draftTabId']));
    let released = false;
    void held!.then(() => {
      released = true;
    });
    await plain.offerDraftOnce();
    expect(query).toHaveBeenCalled();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()?.level.id).toBe('lvl_live');
    await Promise.resolve();
    expect(released).toBe(false);
    plain.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(true);
  });

  it('stops the queue at "decide later" and keeps every draft', async () => {
    seedDraft({ level: epoxyLevel('lvl_a'), tabId: 'tab-a', writtenAt: 2 });
    seedDraft({ level: epoxyLevel('lvl_b'), tabId: 'tab-b', writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockResolvedValue(null);
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
    expect(draftKeys()).toEqual([keyFor('tab-a'), keyFor('tab-b')]);
    expect(removeKeys.filter((key) => key !== ownKey())).toEqual([]);
    expect(editor.hasUnsavedChanges()).toBe(false);
  });

  it('treats a refused confirmation about work in the editor as "decide later"', async () => {
    seedDraft({ level: epoxyLevel('lvl_draft') });
    editor = openEditor();
    editor.loadCompiledLevel(smallCc3dLevel());
    paintCell(1, 2);
    choiceDialog.mockResolvedValue('restore');
    confirmDialog.mockResolvedValue(false);
    await editor.offerDraftOnce();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(foreignDraft()?.level.id).toBe('lvl_draft');
    expect(editor.exportCompiledLevel().ruleset).toBe('cc3d');
    // The work in the editor is protected under its own key meanwhile.
    await pause();
    expect(storedDraft()?.tabId).toBe(editor['draftTabId']);
  });

  it('stops the queue after a restore: the older drafts are left for the next visit', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_a'), customTitle: 'Newer' }, tabId: 'tab-a', writtenAt: 2 });
    seedDraft({ level: { ...epoxyLevel('lvl_b'), customTitle: 'Older' }, tabId: 'tab-b', writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
    expect(editor.exportCompiledLevel().customTitle).toBe('Newer');
    expect(foreignDraft('tab-a')).toBeNull();
    expect(foreignDraft('tab-b')?.level.customTitle).toBe('Older');
  });

  it('goes on to the next draft after a discard', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_a'), customTitle: 'Newer' }, tabId: 'tab-a', writtenAt: 2 });
    seedDraft({ level: { ...epoxyLevel('lvl_b'), customTitle: 'Older' }, tabId: 'tab-b', writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockResolvedValueOnce('discard').mockResolvedValueOnce('restore');
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(2);
    expect(editor.exportCompiledLevel().customTitle).toBe('Older');
    expect(draftKeys()).toEqual([ownKey()]);
  });

  it('skips a draft that another page answered while the queue was waiting', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_a'), customTitle: 'Newer' }, tabId: 'tab-a', writtenAt: 2 });
    seedDraft({ level: { ...epoxyLevel('lvl_b'), customTitle: 'Older' }, tabId: 'tab-b', writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockImplementationOnce(async () => {
      store.delete(keyFor('tab-b'));
      return 'discard';
    });
    await editor.offerDraftOnce();
    expect(choiceDialog).toHaveBeenCalledTimes(1);
  });

  it('does not erase a draft that changed while its question was open (discard)', async () => {
    seedDraft({ level: epoxyLevel('lvl_old'), writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockImplementation(async () => {
      // While the question is open, the page that owns the key writes a newer draft.
      seedDraft({ level: epoxyLevel('lvl_newer'), writtenAt: 5 });
      return 'discard';
    });
    await editor.offerDraftOnce();
    expect(foreignDraft()?.level.id).toBe('lvl_newer');
    expect(foreignDraft()?.writtenAt).toBe(5);
  });

  it('does not erase a draft that changed while its question was open (restore)', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_old'), customTitle: 'Asked' }, writtenAt: 1 });
    editor = openEditor();
    choiceDialog.mockImplementation(async () => {
      seedDraft({ level: { ...epoxyLevel('lvl_newer'), customTitle: 'Changed meanwhile' }, writtenAt: 5 });
      return 'restore';
    });
    await editor.offerDraftOnce();
    expect(editor.exportCompiledLevel().customTitle).toBe('Asked');
    expect(storedDraft()?.level.customTitle).toBe('Asked');
    expect(foreignDraft()?.level.customTitle).toBe('Changed meanwhile');
  });

  it('keeps the restored draft until its own copy is written, then removes it', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({ level: { ...stored, customTitle: 'Draft title' }, source: { packId, levelId: stored.id }, baseHash: levelFingerprint(stored) });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    failSet = true;
    await editor.offerDraftOnce();
    // The copy under this page's key failed: the restored draft is the only copy, and it stays.
    expect(storedDraft()).toBeNull();
    expect(foreignDraft()?.level.customTitle).toBe('Draft title');
    expect(status()).toContain(t('editor.draft.status.write_failed.label'));
    failSet = false;
    typeTitle('Draft title 2');
    await pause();
    expect(storedDraft()?.level.customTitle).toBe('Draft title 2');
    expect(foreignDraft()).toBeNull();
  });

  it('removes the restored draft when the work becomes clean before the own copy was ever written', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({ level: { ...stored, customTitle: 'Draft title' }, source: { packId, levelId: stored.id }, baseHash: levelFingerprint(stored) });
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    failSet = true;
    await editor.offerDraftOnce();
    expect(foreignDraft()?.level.customTitle).toBe('Draft title');
    failSet = false;
    editor.undo();
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(foreignDraft()).toBeNull();
  });

  it('opens the draft as new unsaved work when its source level cannot be loaded', async () => {
    const { packId, stored } = await packWith(epoxyLevel());
    seedDraft({ level: { ...stored, customTitle: 'Draft title' }, source: { packId, levelId: stored.id }, baseHash: levelFingerprint(stored) });
    editor = openEditor();
    const original = editor.loadCompiledLevel.bind(editor);
    vi.spyOn(editor, 'loadCompiledLevel').mockImplementationOnce(() => false).mockImplementation(original);
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(editor.exportCompiledLevel().customTitle).toBe('Draft title');
    expect(foreignDraft()).toBeNull();
    expect(storedDraft()?.level.customTitle).toBe('Draft title');
  });

  it('loses nothing when two pages restore the same draft', async () => {
    seedDraft({ level: { ...epoxyLevel('lvl_shared'), customTitle: 'Shared' } });
    editor = openEditor();
    const first = editor;
    const second = openEditor(true);
    let calls = 0;
    choiceDialog.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        // The second page answers the same question while the first one is still waiting.
        await second.offerDraftOnce();
      }
      return 'restore';
    });
    await first.offerDraftOnce();
    expect(foreignDraft()).toBeNull();
    expect(draftAt(keyFor(first['draftTabId']))?.level.customTitle).toBe('Shared');
    expect(draftAt(keyFor(second['draftTabId']))?.level.customTitle).toBe('Shared');
    editor = second;
  });
});

describe('unreadable and unsupported drafts', () => {
  const wrongShape = JSON.stringify({ v: DRAFT_VERSION, tabId: 3 });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a draft of the wrong shape', wrongShape]
  ])('removes %s and says so once, at the end', async (_label, raw) => {
    const key = keyFor('tab-broken');
    store.set(key, raw);
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(store.has(key)).toBe(false);
    expect(status()).toBe(t('editor.draft.status.invalid.label'));
  });

  it('removes a draft whose payload names another page than its key', async () => {
    const key = keyFor('tab-a');
    const full = { v: DRAFT_VERSION, tabId: 'tab-b', writtenAt: 1, source: { packId: null, levelId: null }, currentLevelId: 'x', baseHash: '', level: epoxyLevel('x') };
    store.set(key, JSON.stringify(full));
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(store.has(key)).toBe(false);
    expect(status()).toBe(t('editor.draft.status.invalid.label'));
  });

  it('leaves a draft of another version and an oversized one alone, without a question or a status', async () => {
    const otherVersion = JSON.stringify({ v: 9 });
    const oversized = 'x'.repeat(EDITOR_DRAFT_MAX_CHARS + 1);
    store.set(keyFor('tab-v'), otherVersion);
    store.set(keyFor('tab-big'), oversized);
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(store.get(keyFor('tab-v'))).toBe(otherVersion);
    expect(store.get(keyFor('tab-big'))).toBe(oversized);
    expect(removeKeys.filter((key) => key !== ownKey())).toEqual([]);
    expect(status()).not.toBe(t('editor.draft.status.invalid.label'));
  });

  it('removes a draft whose level the editor cannot hold, with one status', async () => {
    seedDraft({ level: { ...epoxyLevel(), terrain: [] } });
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()).toBeNull();
    expect(status()).toBe(t('editor.draft.status.invalid.label'));
  });

  it('removes a CC3D draft whose cc3d data is damaged', async () => {
    seedDraft({ level: { ...epoxyLevel(), ruleset: 'cc3d', terrain: [], items: [], entities: [], cc3d: { width: 'x' } as never } });
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()).toBeNull();
    expect(status()).toBe(t('editor.draft.status.invalid.label'));
  });

  it.each([
    ['an unknown ruleset', { ruleset: 'bogus' }],
    ['an unknown win rule', { winRule: 'bogus' }]
  ])('refuses %s instead of restoring it as Epoxy, with one status', async (_label, extra) => {
    seedDraft({ level: { ...epoxyLevel(), ...extra } as unknown as CompiledLevel });
    editor = openEditor();
    await editor.offerDraftOnce();
    expect(choiceDialog).not.toHaveBeenCalled();
    expect(foreignDraft()).toBeNull();
    expect(status()).toBe(t('editor.draft.status.invalid.label'));
    expect(editor.hasUnsavedChanges()).toBe(false);
  });
});

describe('self-healing of the own key', () => {
  function ownKeyRemoved(): void {
    store.delete(ownKey());
    window.dispatchEvent(new StorageEvent('storage', { key: ownKey(), newValue: null, oldValue: 'x' }));
  }

  it('rewrites at once when the own key is removed while the page has unsaved work', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('Mine');
    await pause();
    expect(storedDraft()).not.toBeNull();
    ownKeyRemoved();
    expect(storedDraft()?.level.customTitle).toBe('Mine');
  });

  it('rewrites at once when the whole storage is cleared (key null)', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('Mine');
    await pause();
    store.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    expect(storedDraft()?.level.customTitle).toBe('Mine');
  });

  it('does nothing for a clean page, for another key, or for a write of another page', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    ownKeyRemoved();
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    typeTitle('Mine');
    await pause();
    setKeys = [];
    window.dispatchEvent(new StorageEvent('storage', { key: keyFor(OTHER_TAB_ID), newValue: null, oldValue: 'x' }));
    window.dispatchEvent(new StorageEvent('storage', { key: keyFor(OTHER_TAB_ID), newValue: '{}', oldValue: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else', newValue: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: ownKey(), newValue: store.get(ownKey()) ?? null }));
    expect(setKeys).toHaveLength(0);
  });

  it('rewrites a missing draft when the page becomes visible again while it has unsaved work', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('Mine');
    await pause();
    store.delete(ownKey());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(storedDraft()?.level.customTitle).toBe('Mine');
  });

  it('rewrites a missing draft on pageshow, and leaves an existing one alone', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('Mine');
    await pause();
    setKeys = [];
    window.dispatchEvent(new Event('pageshow'));
    expect(setKeys).toHaveLength(0);
    store.delete(ownKey());
    window.dispatchEvent(new Event('pageshow'));
    expect(storedDraft()?.level.customTitle).toBe('Mine');
  });

  it('does not rewrite when the page is clean', () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    expect(setKeys).toHaveLength(0);
  });
});

describe('what the draft holds', () => {
  it('says so once when the level cannot be built for the draft, and not that the browser refused it', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    const real = editor['compileDocument'].bind(editor);
    vi.spyOn(editor as unknown as { compileDocument: typeof real }, 'compileDocument').mockImplementation((doc) => {
      if (new Error().stack?.includes('writeDraft')) throw new Error('cannot compile');
      return real(doc);
    });
    typeTitle('A');
    await pause();
    expect(status()).toBe(t('editor.draft.status.export_failed.label'));
    expect(status()).not.toBe(t('editor.draft.status.write_failed.label'));
    expect(storedDraft()).toBeNull();
  });

  it('writes the document a stroke started from when the page is hidden mid-stroke', () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('A');
    const before = editor.exportCompiledLevel().terrain;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 2.5 * CELL_PX, clientY: 2.5 * CELL_PX }));
    // The stroke has changed the map already.
    expect(editor.exportCompiledLevel().terrain).not.toEqual(before);
    window.dispatchEvent(new Event('pagehide'));
    expect(storedDraft()?.level.terrain).toEqual(before);
    expect(storedDraft()?.level.customTitle).toBe('A');
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });

  it('restores a CC3D draft on top of its stored CC3D level, and undo returns the source', async () => {
    const { packId, stored } = await packWith(smallCc3dLevel());
    editor = openEditor();
    await editor.openLevel(packId, stored.id);
    paintCell(1, 2);
    await pause();
    expect(storedDraft()?.level.cc3d).toBeDefined();
    editor = openEditor();
    choiceDialog.mockResolvedValue('restore');
    await editor.offerDraftOnce();
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(editor.exportCompiledLevel().cc3d).not.toEqual(stored.cc3d);
    editor.undo();
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(editor.exportCompiledLevel().cc3d).toEqual(stored.cc3d);
  });
});

describe('disposing the editor', () => {
  it('stops the page listeners and the pending write', async () => {
    editor = openEditor();
    editor.loadCompiledLevel(epoxyLevel());
    typeTitle('A');
    editor.dispose();
    window.dispatchEvent(new Event('pagehide'));
    expect(storedDraft()).toBeNull();
    await pause();
    expect(storedDraft()).toBeNull();
    store.delete(ownKey());
    window.dispatchEvent(new StorageEvent('storage', { key: ownKey(), newValue: null }));
    expect(storedDraft()).toBeNull();
  });
});
