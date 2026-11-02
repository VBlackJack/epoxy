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
import { CompiledLevel, LevelPack } from '../core/types';
import type { LevelEditor } from '../editor/LevelEditor';
import { serializePack } from '../packs/packJson';

/** What the play side must do after the library changed. */
export interface LibraryChangePlan {
  /** The pack being played is gone: start again from the first level of the fallback pack. */
  restart: boolean;
  /** Index the level on screen now has in the active pack, null when it did not move or is not there. */
  newIndex: number | null;
}

export interface LibraryChangeInput {
  deletedPackIds: readonly string[];
  /** Pack the level on screen was started from. */
  playedPackId: string;
  activePackId: string;
  /** Ids of the active pack's levels, in order. */
  activeLevelIds: readonly string[];
  /** Id of the level on screen. */
  engineLevelId: string;
}

/** Decides how the play engine follows a change made in the pack manager. */
export function planLibraryChange(input: LibraryChangeInput): LibraryChangePlan {
  if (input.deletedPackIds.includes(input.playedPackId)) return { restart: true, newIndex: null };
  if (input.playedPackId !== input.activePackId) return { restart: false, newIndex: null };
  const index = input.activeLevelIds.indexOf(input.engineLevelId);
  return { restart: false, newIndex: index >= 0 ? index : null };
}

/** What the pack flows need from the application around them. */
export interface PackFlowsHost {
  editor: () => LevelEditor;
  engineLevel: () => CompiledLevel;
  playedPackId: () => string;
  /** Tells the application the editor now holds this engine level, so showing it reloads nothing. */
  markEditorSynced: (level: CompiledLevel) => void;
  switchMode: (mode: 'play' | 'editor') => void;
  /** Redraws the pack selectors and the Levels table. */
  refreshLibraryViews: () => void;
  restartFromFirstLevel: () => void;
  setCurrentLevelIndex: (index: number) => void;
  announceImportedPack: (pack: LevelPack, persisted: boolean, skipped: number, skippedKey: string) => void;
  showStatus: (message: string) => void;
  importErrorMessage: () => string;
}

const SKIPPED_TOAST_KEY = 'app.packs.imported_skipped_toast.label';

/** The flows that tie the pack library, the editor and the play side together. */
export class PackFlows {
  public constructor(private readonly host: PackFlowsHost) {}

  /** The library changed in the manager: views catch up, the editor's source is reconciled, the engine stays coherent. */
  public handleLibraryChange(deletedPackIds: readonly string[]): void {
    this.host.refreshLibraryViews();
    this.host.editor().reconcileSourceWithLibrary();
    const activePackId = ConfigRegistry.getActivePackId();
    const plan = planLibraryChange({
      deletedPackIds,
      playedPackId: this.host.playedPackId(),
      activePackId,
      activeLevelIds: ConfigRegistry.getLevels().map((lvl) => lvl.id),
      engineLevelId: this.host.engineLevel().id
    });
    if (plan.restart) this.host.restartFromFirstLevel();
    else if (plan.newIndex !== null) this.host.setCurrentLevelIndex(plan.newIndex);
  }

  /** Runs an editor opening (which may ask about unsaved work) and shows the editor once it succeeded. */
  public async openInEditor(open: () => Promise<boolean>): Promise<boolean> {
    if (!(await open())) return false;
    // The editor holds what was just opened: showing it must not reload the engine level over it.
    this.host.markEditorSynced(this.host.engineLevel());
    this.host.switchMode('editor');
    return true;
  }

  /** Imports a file written by "Export JSON" of the pack manager; false when the text is not a pack file. */
  public async tryImportPackFile(text: string): Promise<boolean> {
    const result = await ConfigRegistry.importPackJson(text);
    if (result.ok) {
      this.host.announceImportedPack(result.pack, result.persisted, 0, SKIPPED_TOAST_KEY);
      return true;
    }
    if (result.error === 'format' || result.error === 'malformed') return false;
    this.host.showStatus(this.host.importErrorMessage());
    return true;
  }

  /**
   * Registers levels read from a file as an imported pack. They go through the
   * pack file path, so their ids are made unique across the whole library.
   */
  public async importLevelsAsPack(name: string, levels: CompiledLevel[], skipped: number): Promise<void> {
    const result = await ConfigRegistry.importPackJson(serializePack(name, levels));
    if (result.ok) {
      this.host.announceImportedPack(result.pack, result.persisted, skipped, SKIPPED_TOAST_KEY);
      return;
    }
    this.host.showStatus(this.host.importErrorMessage());
  }
}
