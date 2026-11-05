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
 * The automatic check of the level editor runs in a worker: the badge says "checking" while it runs, an answer
 * for content that changed is dropped, a check that is too slow is skipped, and Test waits for its check only
 * as long as the test timeout. The Worker is stubbed; CC3D levels never reach it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));
const askSaveInto = vi.hoisted(() => vi.fn());
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto }));

import type { CompiledLevel, EntityPlacement, LevelValidationReport } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_AUTO_CHECK_TIMEOUT_MS, EDITOR_CHECK_DEBOUNCE_MS, EDITOR_TEST_CHECK_TIMEOUT_MS } from '../ui/uiConstants';
import type { LevelCheckWorkerRequest, LevelCheckWorkerResponse } from '../workers/levelCheckProtocol';
import { compiledCc3d } from './cc3dEditorFixtures';
import { emptyCc3dRoom } from './cc3dRoom';
import { LevelEditor } from './LevelEditor';

const SIZE = 9;
const CC3D_ROOM_SIZE = 12;
const TITLE_INPUT_ID = 'editor-meta-title';
const LEVEL_CHECK_WORKER = 'levelCheck.worker';
const DEEP = { doorOrderSearch: 'deep' } as const;

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let onTestPlay: ReturnType<typeof vi.fn>;
let onNotify: ReturnType<typeof vi.fn>;
let workers: StubWorker[];

class StubWorker {
  public onmessage: ((event: { data: LevelCheckWorkerResponse }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public readonly requests: LevelCheckWorkerRequest[] = [];
  public terminated = false;
  constructor(url: URL | string) {
    // The block check starts its own worker through the same constructor: only the level check's is tracked.
    if (String(url).includes(LEVEL_CHECK_WORKER)) workers.push(this);
  }
  public postMessage(message: LevelCheckWorkerRequest): void {
    this.requests.push(message);
  }
  public terminate(): void {
    this.terminated = true;
  }
  /** Answers the last request with a report. */
  public answer(report: LevelValidationReport): void {
    const last = this.requests[this.requests.length - 1];
    this.onmessage?.({ data: { type: 'report', id: last.id, report } });
  }
}

const STATS: LevelValidationReport['stats'] = {
  chipsPlaced: 0,
  chipsRequired: 0,
  exitCount: 1,
  reachableChips: 0,
  reachableExit: true,
  targetCount: 0
};
const VALID: LevelValidationReport = { valid: true, issues: [], stats: STATS };
const BROKEN: LevelValidationReport = {
  valid: false,
  issues: [{ severity: 'error', i18nKey: 'validator.issues.no_exit.label' }],
  stats: STATS
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const badge = (): HTMLElement => byId('editor-check-badge');
const status = (): string => byId('editor-status-bar').textContent ?? '';
const issuesList = (): HTMLElement => byId('editor-issues-list');
const click = (id: string): void => byId<HTMLButtonElement>(id).click();
/** The requests posted so far, over every worker the editor started. */
const posted = (): number => workers.reduce((total, worker) => total + worker.requests.length, 0);
const liveWorker = (): StubWorker => workers[workers.length - 1];
const lastRequest = (): LevelCheckWorkerRequest => liveWorker().requests[liveWorker().requests.length - 1];

function room(id = 'lvl_check_worker'): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [] as EntityPlacement[],
    trapLinks: [],
    cloneLinks: []
  };
}

/** Types a title: a content edit that schedules a check. */
function editTitle(value: string): void {
  const input = byId<HTMLInputElement>(TITLE_INPUT_ID);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Opens the room and lets the debounce fire: the check is then running in the worker. */
function openAndStartCheck(): void {
  editor.loadCompiledLevel(room());
  vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  confirmDialog.mockReset();
  askSaveInto.mockReset();
  workers = [];
  vi.stubGlobal('Worker', StubWorker);
  const store = new Map<string, string>();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => void store.set(name, value),
    removeItem: (name: string) => void store.delete(name)
  });
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  const context = new Proxy(() => undefined, { get: () => context, set: () => true, apply: () => undefined });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
  canvas.setPointerCapture = () => undefined;
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn(),
    drawBeamCells: vi.fn()
  };
  onTestPlay = vi.fn();
  onNotify = vi.fn();
  const hooks = { onTestPlay, onLevelSaved: vi.fn(), onNotify, openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  editor.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('the automatic check in a worker', () => {
  it('posts after the debounce, says checking, then shows the verdict', () => {
    editor.loadCompiledLevel(room());
    expect(posted()).toBe(0);
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(1);
    expect(badge().dataset.state).toBe('checking');
    expect(badge().textContent).toBe(t('editor.layout.check.checking.label'));
    liveWorker().answer(BROKEN);
    expect(badge().dataset.state).toBe('errors');
    expect(issuesList().querySelectorAll('.editor-issue-row')).toHaveLength(1);
  });

  it('keeps the previous issues, dimmed, while the next check runs', () => {
    openAndStartCheck();
    liveWorker().answer(BROKEN);
    expect(issuesList().dataset.stale).toBe('false');
    editTitle('Another title');
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(badge().dataset.state).toBe('checking');
    expect(issuesList().dataset.stale).toBe('true');
    expect(issuesList().querySelectorAll('.editor-issue-row')).toHaveLength(1);
    liveWorker().answer(VALID);
    expect(issuesList().dataset.stale).toBe('false');
    expect(badge().dataset.state).toBe('valid');
  });

  it('abandons the check at once on an edit, and drops its late answer', () => {
    openAndStartCheck();
    const first = liveWorker();
    editTitle('Edited');
    expect(first.terminated).toBe(true);
    // The abandoned worker answers late: nothing is shown.
    first.onmessage?.({ data: { type: 'report', id: first.requests[0].id, report: BROKEN } });
    expect(badge().dataset.state).not.toBe('errors');
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(2);
    liveWorker().answer(VALID);
    expect(badge().dataset.state).toBe('valid');
  });

  it('skips a check that is too slow and keeps the last issues, dimmed', () => {
    openAndStartCheck();
    liveWorker().answer(BROKEN);
    editTitle('Slow');
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    vi.advanceTimersByTime(EDITOR_AUTO_CHECK_TIMEOUT_MS);
    expect(badge().dataset.state).toBe('skipped');
    expect(badge().textContent).toBe(t('editor.layout.check.skipped.label'));
    expect(issuesList().dataset.stale).toBe('true');
    expect(issuesList().querySelectorAll('.editor-issue-row')).toHaveLength(1);
  });

  it('never posts a CC3D level', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(CC3D_ROOM_SIZE, CC3D_ROOM_SIZE)));
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(workers).toHaveLength(0);
    expect(['valid', 'warnings']).toContain(badge().dataset.state);
    click('editor-validate-btn');
    expect(workers).toHaveLength(0);
  });

  it('validates a CC3D Check inline with the deep options', async () => {
    const { LevelValidator } = await import('../core/LevelValidator');
    const spy = vi.spyOn(LevelValidator, 'validate');
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(CC3D_ROOM_SIZE, CC3D_ROOM_SIZE)));
    spy.mockClear();
    click('editor-validate-btn');
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(), DEEP);
  });

  it('is cancelled by loading another level', () => {
    openAndStartCheck();
    const running = liveWorker();
    editor.loadCompiledLevel(room('lvl_other'));
    expect(running.terminated).toBe(true);
    expect(badge().dataset.state).toBe('idle');
    expect(issuesList().dataset.stale).toBe('false');
  });

  it('terminates its worker when the editor view is left', () => {
    openAndStartCheck();
    editor.onLeave();
    expect(liveWorker().terminated).toBe(true);
    expect(badge().dataset.state).not.toBe('checking');
  });
});

describe('the Check button', () => {
  it('posts no deep option for the automatic check', () => {
    openAndStartCheck();
    expect(liveWorker().requests[0].options).toBeUndefined();
  });

  it('does not reuse a default cached report: it posts its own deep check, whose report it then reuses', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    click('editor-validate-btn');
    expect(posted()).toBe(2);
    expect(lastRequest().options).toEqual(DEEP);
    expect(badge().dataset.state).toBe('checking');
    liveWorker().answer(BROKEN);
    expect(badge().dataset.state).toBe('errors');
    expect(byId<HTMLDetailsElement>('editor-issues-section').open).toBe(true);
    expect(status()).not.toBe('');
    click('editor-validate-btn');
    expect(posted()).toBe(2);
  });

  it('does not reuse a report worded in another language', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    i18n.setLocale('fr');
    click('editor-validate-btn');
    expect(posted()).toBe(2);
  });

  it('checks off the UI thread when nothing is cached, and reports when the answer comes', () => {
    editor.loadCompiledLevel(room());
    click('editor-validate-btn');
    expect(posted()).toBe(1);
    expect(badge().dataset.state).toBe('checking');
    expect(status()).toBe(t('editor.check.running.label'));
    liveWorker().answer(BROKEN);
    expect(badge().dataset.state).toBe('errors');
    expect(status()).toContain(t('validator.issues.no_exit.label'));
    expect(byId<HTMLDetailsElement>('editor-issues-section').open).toBe(true);
    // The pending debounce was taken over by the explicit check: no second post.
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(1);
  });

  it('keeps the cached default verdict on the badge when the deep run times out, with the notice on the status line', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    click('editor-validate-btn');
    expect(badge().dataset.state).toBe('checking');
    vi.advanceTimersByTime(EDITOR_AUTO_CHECK_TIMEOUT_MS);
    expect(badge().dataset.state).toBe('valid');
    expect(status()).toBe(t('editor.check.skipped.label'));
  });

  it('keeps the cached default verdict on the badge when the deep run errors', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    click('editor-validate-btn');
    const worker = liveWorker();
    worker.onmessage?.({ data: { type: 'error', id: worker.requests[worker.requests.length - 1].id, message: 'boom' } });
    expect(badge().dataset.state).toBe('valid');
    expect(status()).toBe(t('editor.check.error.label'));
  });

  it('says the check was skipped when it is too slow', () => {
    editor.loadCompiledLevel(room());
    click('editor-validate-btn');
    vi.advanceTimersByTime(EDITOR_AUTO_CHECK_TIMEOUT_MS);
    expect(badge().dataset.state).toBe('skipped');
    expect(status()).toBe(t('editor.check.skipped.label'));
  });

  it('puts the status line back when an edit abandons the check', () => {
    editor.loadCompiledLevel(room());
    const before = status();
    click('editor-validate-btn');
    editTitle('Edited');
    expect(status()).toBe(before);
  });
});

describe('Test', () => {
  it('plays at once when the level was just checked', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    click('editor-test-btn');
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(posted()).toBe(1);
  });

  it('plays at once with a cached default report, without a deep check', () => {
    openAndStartCheck();
    expect(liveWorker().requests[0].options).toBeUndefined();
    liveWorker().answer(VALID);
    click('editor-test-btn');
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(posted()).toBe(1);
  });

  it('plays at once with a cached deep report', () => {
    editor.loadCompiledLevel(room());
    click('editor-validate-btn');
    liveWorker().answer(VALID);
    click('editor-test-btn');
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(posted()).toBe(1);
  });

  it('runs a deep check when nothing is cached', () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    expect(lastRequest().options).toEqual(DEEP);
  });

  it('puts the cached verdict back on the badge when the cold deep check times out', async () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    const internals = editor as unknown as {
      exportCompiledLevel(): CompiledLevel;
      currentCheckKey(): string;
      checkBeforeTest(c: CompiledLevel, key: string, cacheable: boolean): Promise<unknown>;
    };
    const pending = internals.checkBeforeTest(internals.exportCompiledLevel(), internals.currentCheckKey(), true);
    expect(badge().dataset.state).toBe('checking');
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS);
    await pending;
    expect(badge().dataset.state).toBe('valid');
  });

  it('waits for the check of a level not checked yet, and ignores a repeated click', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    click('editor-test-btn');
    expect(posted()).toBe(1);
    expect(onTestPlay).not.toHaveBeenCalled();
    liveWorker().answer(VALID);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onNotify).not.toHaveBeenCalled();
    // The report that was waited for is kept: the badge shows it and Check does not post again.
    expect(badge().dataset.state).toBe('valid');
    click('editor-validate-btn');
    expect(posted()).toBe(1);
  });

  it('dims the badge and the issues while a cold Test check runs', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    expect(posted()).toBe(1);
    expect(badge().dataset.state).toBe('checking');
    expect(issuesList().dataset.stale).toBe('true');
    liveWorker().answer(VALID);
    await vi.advanceTimersByTimeAsync(0);
    expect(badge().dataset.state).toBe('valid');
    expect(issuesList().dataset.stale).toBe('false');
  });

  it('asks before testing a level the check found invalid', async () => {
    confirmDialog.mockResolvedValue(false);
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    liveWorker().answer(BROKEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(onTestPlay).not.toHaveBeenCalled();
  });

  it('tests anyway, with a notice, when the check outlasts the test timeout', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(t('editor.check.test_skipped.label'));
  });

  it('does not play when another level is loaded during the wait', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    editor.loadCompiledLevel(room('lvl_other'));
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS);
    expect(onTestPlay).not.toHaveBeenCalled();
  });

  it('does not play when the editor view is left during the wait', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    editor.onLeave();
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS);
    expect(onTestPlay).not.toHaveBeenCalled();
  });
});

describe('leaving and entering the editor view', () => {
  it('clears the pending check timer when the view is left', () => {
    editor.loadCompiledLevel(room());
    editor.onLeave();
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS * 2);
    expect(posted()).toBe(0);
  });

  it('does not schedule a check after a Test wait that ended because the view was left', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    editor.onLeave();
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS + EDITOR_CHECK_DEBOUNCE_MS * 2);
    expect(posted()).toBe(1);
    expect(onTestPlay).not.toHaveBeenCalled();
  });

  it('shows the check as interrupted, never the old verdict nor "too slow", when it was cut short by leaving', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    editTitle('Edited');
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(badge().dataset.state).toBe('checking');
    editor.onLeave();
    expect(badge().dataset.state).toBe('interrupted');
    expect(badge().textContent).toBe(t('editor.layout.check.interrupted.label'));
    expect(badge().textContent).not.toBe(t('editor.layout.check.skipped.label'));
    i18n.setLocale('fr');
    expect(t('editor.layout.check.interrupted.label')).toBe('Vérification interrompue');
    i18n.setLocale('en');
    expect(issuesList().dataset.stale).toBe('true');
    expect(issuesList().getAttribute('aria-description')).toBe(t('editor.issues.stale.label'));
  });

  it('shows interrupted when the view is left before the debounce fired, over a previous verdict', () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    editTitle('Edited');
    editor.onLeave();
    expect(badge().dataset.state).toBe('interrupted');
  });

  it('checks again on entering when the content has no report, and not when it has', () => {
    openAndStartCheck();
    editor.onLeave();
    expect(badge().dataset.state).toBe('interrupted');
    editor.onEnter();
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(2);
    liveWorker().answer(BROKEN);
    expect(badge().dataset.state).toBe('errors');
    editor.onLeave();
    editor.onEnter();
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(2);
    expect(badge().dataset.state).toBe('errors');
  });
});

describe('Save during a check', () => {
  it('lets a check of unchanged content continue, and Test uses its result', async () => {
    askSaveInto.mockResolvedValue({ kind: 'new', name: 'p' });
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    const running = liveWorker();
    await editor.save();
    expect(running.terminated).toBe(false);
    expect(posted()).toBe(1);
    running.answer(BROKEN);
    confirmDialog.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
  });
});

describe('why Test went ahead without a report', () => {
  it('says the level changed when an edit abandons the check during the wait, and tests the version before the edit', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    editTitle('Edited during the wait');
    await vi.advanceTimersByTimeAsync(0);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onTestPlay.mock.calls[0][0].title).not.toBe('Edited during the wait');
    expect(onNotify).toHaveBeenCalledWith(t('editor.check.test_cancelled.label'));
    // The edited content is checked once the edits settle.
    await vi.advanceTimersByTimeAsync(EDITOR_CHECK_DEBOUNCE_MS);
    expect(posted()).toBe(2);
  });

  it('says the check failed when the worker errors, and the badge says so for an automatic check', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    const worker = liveWorker();
    worker.onmessage?.({ data: { type: 'error', id: worker.requests[0].id, message: 'boom' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(t('editor.check.test_error.label'));
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS);
    const next = liveWorker();
    next.onmessage?.({ data: { type: 'error', id: next.requests[next.requests.length - 1].id, message: 'boom' } });
    expect(badge().dataset.state).toBe('error');
    expect(badge().textContent).toBe(t('editor.layout.check.error.label'));
  });

  it('puts the status line back after a Test wait, and a Check click during the wait shows the running status again', async () => {
    editor.loadCompiledLevel(room());
    const before = status();
    click('editor-test-btn');
    expect(status()).toBe(t('editor.check.running.label'));
    click('editor-validate-btn');
    expect(posted()).toBe(1);
    expect(status()).toBe(t('editor.check.running.label'));
    liveWorker().answer(VALID);
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toBe(before);
  });
});

describe('Test from here', () => {
  it('always validates the moved-start copy and never uses the cached report', async () => {
    openAndStartCheck();
    liveWorker().answer(VALID);
    expect(posted()).toBe(1);
    const play = (editor as unknown as { testPlay(cell: { x: number; y: number }): Promise<void> }).testPlay(
      { x: 2, y: 2 }
    );
    expect(onTestPlay).not.toHaveBeenCalled();
    expect(posted()).toBe(2);
    expect(lastRequest().options).toEqual(DEEP);
    const moved = liveWorker().requests[liveWorker().requests.length - 1].level;
    expect(moved.playerStart).toMatchObject({ x: 2, y: 2 });
    liveWorker().answer(VALID);
    await play;
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onTestPlay.mock.calls[0][0].playerStart).toMatchObject({ x: 2, y: 2 });
    // The cache still holds the report of the real content: a normal Test plays at once.
    click('editor-test-btn');
    expect(posted()).toBe(2);
    expect(onTestPlay).toHaveBeenCalledTimes(2);
  });
});

describe('status tokens', () => {
  it('keeps the Test wait line when a check it joined ends first, then restores the line from before both', async () => {
    editor.loadCompiledLevel(room());
    const before = status();
    click('editor-validate-btn');
    const JOIN_AT_MS = EDITOR_AUTO_CHECK_TIMEOUT_MS - EDITOR_TEST_CHECK_TIMEOUT_MS + 1000;
    vi.advanceTimersByTime(JOIN_AT_MS);
    click('editor-test-btn');
    expect(posted()).toBe(1);
    // The Check ends (too slow) while Test still waits: the line stays the Test wait's.
    vi.advanceTimersByTime(EDITOR_AUTO_CHECK_TIMEOUT_MS - JOIN_AT_MS);
    expect(badge().dataset.state).toBe('skipped');
    expect(status()).toBe(t('editor.check.running.label'));
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toBe(before);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
  });
});

describe('Test from here during a check', () => {
  const testFrom = (cell: { x: number; y: number }): Promise<void> =>
    (editor as unknown as { testPlay(cell: { x: number; y: number }): Promise<void> }).testPlay(cell);

  it('is not cancelled by a Save of the same content', async () => {
    askSaveInto.mockResolvedValue({ kind: 'new', name: 'p' });
    editor.loadCompiledLevel(room());
    const play = testFrom({ x: 2, y: 2 });
    const running = liveWorker();
    await editor.save();
    expect(running.terminated).toBe(false);
    expect(posted()).toBe(1);
    running.answer(VALID);
    await play;
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onTestPlay.mock.calls[0][0].playerStart).toMatchObject({ x: 2, y: 2 });
  });

  it('is cancelled by an edit', async () => {
    editor.loadCompiledLevel(room());
    const play = testFrom({ x: 2, y: 2 });
    const running = liveWorker();
    editTitle('Edited');
    expect(running.terminated).toBe(true);
    await play;
    expect(onNotify).toHaveBeenCalledWith(t('editor.check.test_cancelled.label'));
  });

  it('is not joined by a Check click, which refreshes the line instead', async () => {
    editor.loadCompiledLevel(room());
    const before = status();
    const play = testFrom({ x: 2, y: 2 });
    click('editor-validate-btn');
    expect(posted()).toBe(1);
    expect(status()).toBe(t('editor.check.running.label'));
    liveWorker().answer(VALID);
    await play;
    expect(status()).toBe(before);
  });

  it('returns early when a Test check is pending, without writing its status', async () => {
    editor.loadCompiledLevel(room());
    click('editor-test-btn');
    expect(status()).toBe(t('editor.check.running.label'));
    await (editor as unknown as { testFromHere(): Promise<void> }).testFromHere();
    expect(status()).toBe(t('editor.check.running.label'));
    expect(posted()).toBe(1);
  });
});

describe('joining the automatic check', () => {
  it('lets a Check click replace it with its own deep check', () => {
    openAndStartCheck();
    const auto = liveWorker();
    click('editor-validate-btn');
    expect(posted()).toBe(2);
    expect(auto.terminated).toBe(true);
    expect(status()).toBe(t('editor.check.running.label'));
    const running = liveWorker();
    expect(running.requests[0].options).toEqual(DEEP);
    running.answer(BROKEN);
    expect(badge().dataset.state).toBe('errors');
    expect(status()).toContain(t('validator.issues.no_exit.label'));
    expect(byId<HTMLDetailsElement>('editor-issues-section').open).toBe(true);
  });

  it('lets a Test wait for it, and plays with its report', async () => {
    openAndStartCheck();
    const running = liveWorker();
    click('editor-test-btn');
    expect(posted()).toBe(1);
    expect(running.terminated).toBe(false);
    running.answer(VALID);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onNotify).not.toHaveBeenCalled();
    expect(badge().dataset.state).toBe('valid');
  });

  it('keeps the Test timeout counted from its own click, and the check goes on', async () => {
    openAndStartCheck();
    const running = liveWorker();
    vi.advanceTimersByTime(EDITOR_AUTO_CHECK_TIMEOUT_MS - EDITOR_TEST_CHECK_TIMEOUT_MS - 1000);
    click('editor-test-btn');
    await vi.advanceTimersByTimeAsync(EDITOR_TEST_CHECK_TIMEOUT_MS);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(t('editor.check.test_skipped.label'));
    expect(running.terminated).toBe(false);
    expect(posted()).toBe(1);
    running.answer(VALID);
    expect(badge().dataset.state).toBe('valid');
  });

  it('lets a Test join a deep Check already running instead of restarting it', async () => {
    editor.loadCompiledLevel(room());
    click('editor-validate-btn');
    const running = liveWorker();
    click('editor-test-btn');
    expect(posted()).toBe(1);
    expect(running.terminated).toBe(false);
    running.answer(VALID);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTestPlay).toHaveBeenCalledTimes(1);
  });
});

describe('beam preview key', () => {
  it('is the content key without the language, so a language change does not dim the beams', () => {
    editor.loadCompiledLevel(room());
    const internals = editor as unknown as {
      refreshBeamPreview(compiled: CompiledLevel, announce: boolean, redraw: boolean): void;
      exportCompiledLevel(): CompiledLevel;
      currentBeamPreviewKey(): string;
      beamPreviewKey: string;
    };
    internals.refreshBeamPreview(internals.exportCompiledLevel(), false, false);
    expect(internals.beamPreviewKey).toBe(internals.currentBeamPreviewKey());
    i18n.setLocale('fr');
    expect(internals.beamPreviewKey).toBe(internals.currentBeamPreviewKey());
  });
});
