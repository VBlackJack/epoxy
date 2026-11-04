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

import {
  BUILTIN_PACK_IDS,
  CONFIG_ENDPOINTS,
  CUSTOM_PACK_I18N_KEY,
  DEFAULT_LEVEL_PASSWORD,
  ENV_CONFIG,
  PILOT_LEVEL_ID_PREFIX,
  SAVE_SLOT_PACK_SEPARATOR,
  UNORDERED_PACK_RANK
} from './constants';
import { FLAG_ON as PLAYTEST_FLAG_ON } from '../playtest/PlaytestStore';
import {
  assertConfigShape,
  ConfigLoadError,
  ensureUniqueLevelIds,
  findColorChannelConfigErrors,
  findLaserConfigErrors,
  findSlowTimeConfigErrors,
  sanitizeStoredLevels,
  isSizeWithinBounds,
  levelSizeBoundsOf,
  GridSize,
  LevelSizeBounds,
  findBlockPuzzleConfigErrors,
  findCampaignGuardConfigErrors,
  isDirection,
  isFiniteNumber,
  isInBounds,
  isRuleset,
  isBlockBudget,
  normalizeCellEdges,
  normalizeUnderlays,
  isWinRule,
  findAudioConfigErrors,
  findCampaignConfigErrors,
  findPilotConfigErrors,
  findCc3dTileErrors,
  findDatFormatErrors,
  findGameTunableErrors,
  InvalidLevelError
} from './ConfigValidation';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { findGraphicsConfigErrors } from '../render/renderSettings';
import {
  AudioConfig,
  CampaignChapter,
  CampaignConfig,
  CompiledLevel,
  PilotLevelsConfig,
  DatFormatConfig,
  EntityDefinition,
  GameConfig,
  LevelBlueprint,
  LevelPack,
  LevelTextConfig,
  PlaytestConfig,
  LevelsConfig,
  MonstersConfig,
  TileDefinition,
  TilesConfig,
  UltimatePackDescriptor
} from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { MotifAnnotations, MotifsConfig, PieceLegendEntry } from '../generator/PieceTypes';
import { clampPackMetadata, PackMetadata, PackMetadataLimits, withPackMetadata } from '../packs/packMetadata';
import { PackJsonError, parsePackJson, serializePack } from '../packs/packJson';
import { readSharedPack, SharedPackResult } from '../packs/shareLink';
import { dedupeLevelIdsAcrossPacks, scopedLevelId, scopeLevelIds } from '../packs/levelIds';
import * as userPacks from '../packs/userPacks';
import { LevelPackStorage } from '../storage/LevelPackStorage';

/** Top-level keys each config file must define. */
const REQUIRED_CONFIG_KEYS = {
  GAME: ['grid', 'timing', 'storage', 'import', 'locales', 'keybindings', 'palette', 'blockPuzzle'],
  TILES: ['tiles'],
  CC3D_TILES: ['tiles'],
  MONSTERS: ['entities'],
  AUDIO: ['masterVolume', 'sfxVolume', 'musicVolume', 'effects'],
  LEVELS: ['legend', 'levels'],
  CAMPAIGN: ['chapters'],
  PILOT_LEVELS: ['levels'],
  PILOT_CAMPAIGN: ['chapters'],
  DAT_FORMAT: ['magicHeaders', 'rleMarkerByte', 'layerByteLength', 'fieldCodes', 'byteToElement'],
  MOTIFS: ['legend', 'pieces', 'monsterPortTerrain'],
  MOTIF_ANNOTATIONS: []
} as const;

/** Direction given to a level start that does not define a valid one. */
const DEFAULT_START_DIRECTION = 'S';

export interface ConfigBundle {
  game: GameConfig;
  tiles: TilesConfig;
  /** Tiles of the cc3d ruleset: looked up by getTile, never listed by getTiles. */
  cc3dTiles: Pick<TilesConfig, 'tiles'>;
  monsters: MonstersConfig;
  audio: AudioConfig;
  levels: LevelsConfig;
  campaign: CampaignConfig;
  /** The levels of the Epoxy pilot pack; absent means no pilot. */
  pilotLevels?: PilotLevelsConfig;
  /** The chapters of the pilot pack; absent means none. */
  pilotCampaign?: CampaignConfig;
  datFormat: DatFormatConfig;
  motifs: MotifsConfig;
  motifAnnotations: MotifAnnotations;
}

interface FetchedPack {
  descriptor: UltimatePackDescriptor;
  buffer: ArrayBuffer;
}

/** Outcome of a change to a pack: whether it applied, and whether it reached storage. */
export interface PackOperationResult {
  /** False when nothing changed (unknown pack or level, blank name). */
  ok: boolean;
  /** False when the write was refused; the change then lasts for this session only. */
  persisted: boolean;
}

/** Result of saving a level into a pack. */
export interface SaveLevelResult extends PackOperationResult {
  /** Position of the level in its pack, -1 when nothing was saved. */
  index: number;
}

/** Result of an operation that creates or returns a pack. */
export interface PackResult extends PackOperationResult {
  pack?: LevelPack;
}

/** Result of an operation that produces a level. */
export interface LevelResult extends PackOperationResult {
  level?: CompiledLevel;
}

export type ImportPackJsonResult =
  | { ok: true; pack: LevelPack; persisted: boolean }
  | { ok: false; error: PackJsonError };

const FAILED: PackOperationResult = { ok: false, persisted: false };

/** The levels of a legacy localStorage custom list, and whether some entries could not be kept. */
function parseLegacyCustomLevels(raw: string, bounds: LevelSizeBounds): { levels: CompiledLevel[]; dropped: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { levels: [], dropped: true };
  }
  if (!Array.isArray(parsed)) return { levels: [], dropped: true };
  const kept = sanitizeStoredLevels(parsed, bounds);
  return { levels: ensureUniqueLevelIds(kept, BUILTIN_PACK_IDS.CUSTOM), dropped: kept.length !== parsed.length };
}

class ConfigRegistryService {
  private gameConfig!: GameConfig;
  private tilesConfig!: TilesConfig;
  private cc3dTilesConfig: Pick<TilesConfig, 'tiles'> = { tiles: {} };
  private monstersConfig!: MonstersConfig;
  private audioConfig!: AudioConfig;
  private levelsConfig!: LevelsConfig;
  private campaignConfig: CampaignConfig = { chapters: [] };
  private pilotCampaignConfig: CampaignConfig = { chapters: [] };
  private pilotBlueprints: LevelBlueprint[] = [];
  private pilotLevels: CompiledLevel[] = [];
  /** The pilot pack is listed and playable only while this is true (Playtest mode on). */
  private pilotVisible = false;
  private datFormatConfig!: DatFormatConfig;
  private motifsConfig!: MotifsConfig;
  private motifAnnotations: MotifAnnotations = {};

  private builtInLevels: CompiledLevel[] = [];
  private ultimatePacks: LevelPack[] = [];
  private proceduralLevels: CompiledLevel[] = [];
  /** The library read from IndexedDB: imported packs and the packs the player created. */
  private storedPacks: LevelPack[] = [];
  /** True while IndexedDB cannot be read: the custom pack then lives in localStorage. */
  private legacyCustomStore = false;
  /** True when the legacy list could not be backed up: it must not be overwritten. */
  private legacyWriteBlocked = false;
  private activePackId: string = BUILTIN_PACK_IDS.CAMPAIGN;

  public async loadAll(): Promise<void> {
    const gamePromise = this.fetchJson<GameConfig>(CONFIG_ENDPOINTS.GAME, REQUIRED_CONFIG_KEYS.GAME);
    // Pack downloads only need game.json, so they overlap with the other config fetches.
    const packsPromise = gamePromise.then(
      (game) => this.fetchUltimatePacks(game.ultimatePacks || []),
      () => [] as FetchedPack[]
    );

    const [game, tiles, cc3dTiles, monsters, audio, levels, campaign, pilot, datFormat, motifs, motifAnnotations] = await Promise.all([
      gamePromise,
      this.fetchJson<TilesConfig>(CONFIG_ENDPOINTS.TILES, REQUIRED_CONFIG_KEYS.TILES),
      this.fetchJson<Pick<TilesConfig, 'tiles'>>(CONFIG_ENDPOINTS.CC3D_TILES, REQUIRED_CONFIG_KEYS.CC3D_TILES),
      this.fetchJson<MonstersConfig>(CONFIG_ENDPOINTS.MONSTERS, REQUIRED_CONFIG_KEYS.MONSTERS),
      this.fetchJson<AudioConfig>(CONFIG_ENDPOINTS.AUDIO, REQUIRED_CONFIG_KEYS.AUDIO),
      this.fetchJson<LevelsConfig>(CONFIG_ENDPOINTS.LEVELS, REQUIRED_CONFIG_KEYS.LEVELS),
      this.fetchOptionalCampaign(),
      this.fetchOptionalPilot(),
      this.fetchJson<DatFormatConfig>(CONFIG_ENDPOINTS.DAT_FORMAT, REQUIRED_CONFIG_KEYS.DAT_FORMAT),
      this.fetchJson<MotifsConfig>(CONFIG_ENDPOINTS.MOTIFS, REQUIRED_CONFIG_KEYS.MOTIFS),
      this.fetchJson<MotifAnnotations>(CONFIG_ENDPOINTS.MOTIF_ANNOTATIONS, REQUIRED_CONFIG_KEYS.MOTIF_ANNOTATIONS)
    ]);

    this.applyConfigs({
      game,
      tiles,
      cc3dTiles,
      monsters,
      audio,
      levels,
      campaign,
      pilotLevels: pilot.levels,
      pilotCampaign: pilot.campaign,
      datFormat,
      motifs,
      motifAnnotations
    });
    // Playtest mode decides whether the pilot pack exists for this page, before the saved pack is looked up.
    this.pilotVisible = this.readStorage(game.storage.playtestEnabledKey) === PLAYTEST_FLAG_ON;
    this.ultimatePacks = this.decodeUltimatePacks(await packsPromise);
    // The store name and the level size bounds come from game.json, so the
    // stored packs are read only once the configs are installed.
    await this.loadStoredPacks();

    const savedPackId = this.readStorage(this.gameConfig.storage.activePackKey);
    if (savedPackId && this.getAllPacks().some((p) => p.id === savedPackId && p.levels.length > 0)) {
      this.activePackId = savedPackId;
    } else if (savedPackId === BUILTIN_PACK_IDS.PILOT) {
      // The pilot is gone from this page (Playtest mode is off): forget it as the saved pack.
      this.resetActivePack();
    }
  }

  /**
   * Installs an already parsed config bundle and compiles the built-in levels.
   * Used by loadAll and by tests, which read the config files from disk.
   */
  public applyConfigs(bundle: ConfigBundle): void {
    const graphicsErrors = findGraphicsConfigErrors(
      bundle.game.graphics,
      bundle.game.palette,
      new Set(Object.keys(bundle.tiles.tiles)),
      new Set(Object.keys(bundle.monsters.entities))
    );
    if (graphicsErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, graphicsErrors.join('; '));
    }
    const maxFileBytes: unknown = bundle.game.import?.maxFileBytes;
    if (typeof maxFileBytes !== 'number' || !Number.isInteger(maxFileBytes) || maxFileBytes <= 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, 'import.maxFileBytes must be a positive integer');
    }
    const blockPuzzleErrors = findBlockPuzzleConfigErrors(bundle.game.blockPuzzle);
    if (blockPuzzleErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, blockPuzzleErrors.join('; '));
    }
    const campaignGuardErrors = findCampaignGuardConfigErrors(bundle.game.campaignGuard);
    if (campaignGuardErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, campaignGuardErrors.join('; '));
    }
    const tunableErrors = findGameTunableErrors(bundle.game);
    if (tunableErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, tunableErrors.join('; '));
    }
    const laserErrors = findLaserConfigErrors(bundle.tiles.tiles);
    if (laserErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.TILES, laserErrors.join('; '));
    }
    const colorErrors = findColorChannelConfigErrors(bundle.tiles.tiles, bundle.monsters.entities);
    if (colorErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.TILES, colorErrors.join('; '));
    }
    const slowTimeErrors = findSlowTimeConfigErrors(bundle.tiles.tiles);
    if (slowTimeErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.TILES, slowTimeErrors.join('; '));
    }
    const cc3dTileErrors = findCc3dTileErrors(bundle.cc3dTiles, bundle.tiles.tiles);
    if (cc3dTileErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.CC3D_TILES, cc3dTileErrors.join('; '));
    }
    const datFormatErrors = findDatFormatErrors(bundle.datFormat, bundle.game.grid);
    if (datFormatErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.DAT_FORMAT, datFormatErrors.join('; '));
    }
    const audioErrors = findAudioConfigErrors(bundle.audio, bundle.game.themes, bundle.game.endlessUi?.musicTrackIds);
    if (audioErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.AUDIO, audioErrors.join('; '));
    }
    const campaignErrors = findCampaignConfigErrors(
      bundle.campaign,
      bundle.levels.levels.map((level) => level.id)
    );
    if (campaignErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.CAMPAIGN, campaignErrors.join('; '));
    }
    let pilotLevels = bundle.pilotLevels ?? { levels: [] };
    let pilotCampaign = bundle.pilotCampaign ?? { chapters: [] };
    const pilotErrors = findPilotConfigErrors(
      pilotLevels.levels,
      pilotCampaign,
      bundle.levels.levels.map((level) => level.id),
      PILOT_LEVEL_ID_PREFIX
    );
    if (pilotErrors.length > 0) {
      // The pilot is optional: a broken one is left out rather than stopping the game.
      console.warn(`Pilot pack ignored: ${pilotErrors.join('; ')}`);
      pilotLevels = { levels: [] };
      pilotCampaign = { chapters: [] };
    }
    this.gameConfig = bundle.game;
    this.tilesConfig = bundle.tiles;
    this.cc3dTilesConfig = bundle.cc3dTiles;
    this.monstersConfig = bundle.monsters;
    this.audioConfig = bundle.audio;
    this.levelsConfig = bundle.levels;
    this.campaignConfig = bundle.campaign;
    this.pilotCampaignConfig = pilotCampaign;
    this.pilotBlueprints = pilotLevels.levels;
    this.datFormatConfig = bundle.datFormat;
    this.motifsConfig = bundle.motifs;
    this.motifAnnotations = bundle.motifAnnotations;

    this.builtInLevels = bundle.levels.levels.map((bp) => this.compileBlueprint(bp));
    this.pilotLevels = this.pilotBlueprints.map((bp) => this.compileBlueprint(bp));
    this.ultimatePacks = [];
    this.proceduralLevels = [];
    this.storedPacks = [];
    this.legacyCustomStore = false;
    this.legacyWriteBlocked = false;
    this.activePackId = BUILTIN_PACK_IDS.CAMPAIGN;
  }

  private async fetchUltimatePacks(descriptors: UltimatePackDescriptor[]): Promise<FetchedPack[]> {
    const results = await Promise.all(
      descriptors.map(async (descriptor): Promise<FetchedPack | null> => {
        try {
          const response = await fetch(descriptor.url);
          if (!response.ok) return null;
          return { descriptor, buffer: await response.arrayBuffer() };
        } catch {
          return null;
        }
      })
    );
    return results.filter((r): r is FetchedPack => r !== null);
  }

  private decodeUltimatePacks(fetched: FetchedPack[]): LevelPack[] {
    const descriptors = this.gameConfig.ultimatePacks || [];
    const loaded: LevelPack[] = [];

    for (const { descriptor, buffer } of fetched) {
      try {
        const decoded = DatCodec.decodeBuffer(buffer, descriptor.prefix, descriptor.ruleset ?? DEFAULT_RULESET);
        if (decoded.length > 0) {
          loaded.push({
            id: descriptor.id,
            name: descriptor.name,
            i18nKey: descriptor.i18nKey,
            builtIn: true,
            levels: decoded
          });
        }
      } catch {
        // A corrupt bundled pack is skipped, the others stay playable
      }
    }

    const orderMap = new Map(descriptors.map((d, idx) => [d.id, idx]));
    loaded.sort(
      (a, b) =>
        (orderMap.get(a.id) ?? UNORDERED_PACK_RANK) - (orderMap.get(b.id) ?? UNORDERED_PACK_RANK)
    );
    return loaded;
  }

  /** The chapter list is optional: without it the game loads and the campaign shows as a flat list. */
  private async fetchOptionalCampaign(): Promise<CampaignConfig> {
    try {
      return await this.fetchJson<CampaignConfig>(CONFIG_ENDPOINTS.CAMPAIGN, REQUIRED_CONFIG_KEYS.CAMPAIGN);
    } catch (err) {
      console.warn(`Campaign chapters unavailable, the levels are listed without chapters: ${String(err)}`);
      return { chapters: [] };
    }
  }

  /** The pilot pack is optional: without its files the game loads and the pack is simply absent. */
  private async fetchOptionalPilot(): Promise<{ levels?: PilotLevelsConfig; campaign?: CampaignConfig }> {
    try {
      const [levels, campaign] = await Promise.all([
        this.fetchJson<PilotLevelsConfig>(CONFIG_ENDPOINTS.PILOT_LEVELS, REQUIRED_CONFIG_KEYS.PILOT_LEVELS),
        this.fetchJson<CampaignConfig>(CONFIG_ENDPOINTS.PILOT_CAMPAIGN, REQUIRED_CONFIG_KEYS.PILOT_CAMPAIGN)
      ]);
      return { levels, campaign };
    } catch (err) {
      console.warn(`Pilot pack unavailable: ${String(err)}`);
      return {};
    }
  }

  private async fetchJson<T>(url: string, requiredKeys: readonly string[]): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new ConfigLoadError(url, err instanceof Error ? err.message : String(err));
    }
    if (!response.ok) {
      throw new ConfigLoadError(url, `HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ConfigLoadError(url, 'malformed JSON');
    }
    assertConfigShape(url, parsed, requiredKeys);
    return parsed as T;
  }

  private readStorage(suffix: string): string | null {
    try {
      return localStorage.getItem(this.getStorageKey(suffix));
    } catch {
      // Storage blocked (privacy mode, sandboxed frame)
      return null;
    }
  }

  public getGame(): GameConfig {
    return this.gameConfig;
  }

  public getTiles(): TilesConfig {
    return this.tilesConfig;
  }

  /** The cc3d tile definitions, for the bundle handed to the workers. */
  public getCc3dTiles(): Pick<TilesConfig, 'tiles'> {
    return this.cc3dTilesConfig;
  }

  public getTile(id: string): TileDefinition {
    return this.tilesConfig.tiles[id] || this.cc3dTilesConfig.tiles[id] || this.tilesConfig.tiles.floor;
  }

  /** True when the id names a tile of the terrain layer in the Epoxy tile set (items and unknown ids are not). */
  public isTerrainTile(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.tilesConfig.tiles, id) && this.tilesConfig.tiles[id].layer === 'terrain';
  }

  public getMonsters(): MonstersConfig {
    return this.monstersConfig;
  }

  public getEntityDef(id: string): EntityDefinition | undefined {
    return this.monstersConfig.entities[id];
  }

  public getAudio(): AudioConfig {
    return this.audioConfig;
  }

  public getDatFormat(): DatFormatConfig {
    return this.datFormatConfig;
  }

  public getMotifs(): MotifsConfig {
    return this.motifsConfig;
  }

  public getMotifAnnotations(): MotifAnnotations {
    return this.motifAnnotations;
  }

  /** The levels.json legend extended, and overridden, by the motifs.json one. */
  public getPieceLegend(): Record<string, PieceLegendEntry> {
    return { ...this.levelsConfig.legend, ...this.motifsConfig.legend };
  }

  public getAllPacks(): LevelPack[] {
    const packs: LevelPack[] = [
      {
        id: BUILTIN_PACK_IDS.CAMPAIGN,
        name: 'Epoxy',
        i18nKey: 'app.packs.campaign.label',
        builtIn: true,
        levels: this.builtInLevels
      },
      ...this.pilotPacks(),
      ...this.ultimatePacks,
      ...this.storedPacks
    ];
    if (this.proceduralLevels.length > 0) {
      packs.push({
        id: BUILTIN_PACK_IDS.PROCEDURAL,
        name: 'Procedural',
        i18nKey: 'app.packs.procedural.label',
        builtIn: true,
        levels: this.proceduralLevels
      });
    }
    return packs;
  }

  /** The pilot pack, only while it is visible and holds a level. */
  private pilotPacks(): LevelPack[] {
    if (!this.pilotVisible || this.pilotLevels.length === 0) return [];
    return [
      {
        id: BUILTIN_PACK_IDS.PILOT,
        name: 'Epoxy pilot',
        i18nKey: 'app.packs.pilot.label',
        builtIn: true,
        levels: this.pilotLevels
      }
    ];
  }

  /**
   * Shows or hides the pilot pack (it follows Playtest mode). Hiding it while
   * it is the active pack falls back to the campaign. Returns whether the
   * visibility changed.
   */
  public setPilotPackVisible(visible: boolean): boolean {
    if (visible === this.pilotVisible) return false;
    this.pilotVisible = visible;
    if (!visible && this.activePackId === BUILTIN_PACK_IDS.PILOT) this.resetActivePack();
    return true;
  }

  /**
   * Storage key of the resume point for a pack. The pilot has a slot of its own so playing it never
   * overwrites the campaign resume point; every other pack shares the historical slot.
   */
  public getSaveSlotKey(packId: string): string {
    const base = this.gameConfig.storage.saveSlotKey;
    return this.getStorageKey(packId === BUILTIN_PACK_IDS.PILOT ? `${base}${SAVE_SLOT_PACK_SEPARATOR}${packId}` : base);
  }

  /** The pilot levels whether or not the pack is visible, for the authoring tools and tests. */
  public getPilotLevels(): CompiledLevel[] {
    return this.pilotLevels;
  }

  /** The pilot level blueprints as loaded, with their authoring fields such as reworkOf. */
  public getPilotBlueprints(): LevelBlueprint[] {
    return this.pilotBlueprints;
  }

  /** The chapters of the pilot pack, in play order. */
  public getPilotChapters(): CampaignChapter[] {
    return this.pilotCampaignConfig.chapters;
  }

  /** The chapters of the pack being played; empty for a pack without chapters. */
  public getActivePackChapters(): CampaignChapter[] {
    if (this.activePackId === BUILTIN_PACK_IDS.CAMPAIGN) return this.campaignConfig.chapters;
    if (this.activePackId === BUILTIN_PACK_IDS.PILOT) return this.pilotCampaignConfig.chapters;
    return [];
  }

  public setProceduralLevels(levels: CompiledLevel[]): void {
    this.proceduralLevels = levels;
    this.setActivePackId(BUILTIN_PACK_IDS.PROCEDURAL);
  }

  public getActivePackId(): string {
    return this.activePackId;
  }

  public setActivePackId(packId: string): void {
    const found = this.getAllPacks().find((p) => p.id === packId);
    if (found && found.levels.length > 0) {
      this.activePackId = packId;
      try {
        localStorage.setItem(this.getStorageKey(this.gameConfig.storage.activePackKey), packId);
      } catch {
        // Ignore storage error
      }
    }
  }

  /** The chapters of the Epoxy campaign, in play order. */
  public getCampaignChapters(): CampaignChapter[] {
    return this.campaignConfig.chapters;
  }

  public getLevels(): CompiledLevel[] {
    const pack = this.getAllPacks().find((p) => p.id === this.activePackId);
    if (pack && pack.levels.length > 0) {
      return pack.levels;
    }
    return this.builtInLevels;
  }

  // ---------------------------------------------------------------------------
  // Library of stored packs: imported packs and the packs the player creates
  // ---------------------------------------------------------------------------

  /**
   * Reads the stored library, then moves the levels the editor used to keep in
   * localStorage into the custom pack. Called once the configs are installed.
   */
  public async loadStoredPacks(): Promise<void> {
    const stored = await LevelPackStorage.loadAllPacks();
    // null means unreadable, not empty: the custom pack then stays in localStorage.
    this.legacyCustomStore = stored === null;
    this.legacyWriteBlocked = false;
    this.storedPacks = stored ?? [];
    await this.migrateLegacyCustomLevels();
    await this.dedupeStoredLevelIds();
  }

  /**
   * Imports used to keep the ids from the file, so two packs could hold the same
   * level id and share its records. The first holder keeps its ids; a later pack
   * gets scoped ids and is written again. A failed write keeps the new ids in memory.
   */
  private async dedupeStoredLevelIds(): Promise<void> {
    const builtIn = this.getAllPacks().filter((p) => p.builtIn === true);
    const { packs, changed } = dedupeLevelIdsAcrossPacks(builtIn, this.storedPacks);
    if (changed.length === 0) return;
    this.storedPacks = packs;
    // A refused write is not reported: the next start finds the same duplicates and renames them again.
    for (const pack of changed) await this.persistPack(pack);
  }

  /**
   * The legacy list is removed only after the custom pack holding it is
   * written; entries that fail validation are copied, raw, to a backup key
   * first. A failed write leaves localStorage untouched and the levels
   * playable from memory. Running it again changes nothing.
   */
  private async migrateLegacyCustomLevels(): Promise<void> {
    const key = this.getStorageKey(this.gameConfig.storage.customLevelsKey);
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return;
    }
    if (!raw) return;
    const legacy = parseLegacyCustomLevels(raw, this.getLevelSizeBounds());

    if (this.legacyCustomStore) {
      // The first write to the legacy key replaces the entries that were dropped,
      // so the raw text is kept aside before anything can overwrite it.
      if (legacy.dropped && !this.backUpRawLegacy(raw)) this.legacyWriteBlocked = true;
      if (legacy.levels.length > 0) {
        const custom = userPacks.createLabelledPack(BUILTIN_PACK_IDS.CUSTOM, CUSTOM_PACK_I18N_KEY);
        this.storedPacks.push({ ...custom, levels: userPacks.renumberLevels(legacy.levels) });
      }
      return;
    }

    const existing = this.storedPacks.find((p) => p.id === BUILTIN_PACK_IDS.CUSTOM);
    const known = new Set(existing?.levels.map((l) => l.id));
    // A level the dedupe renamed in the custom pack is still known under its original id.
    const isKnown = (id: string) => known.has(id) || known.has(scopedLevelId(BUILTIN_PACK_IDS.CUSTOM, id));
    const fresh = legacy.levels.filter((l) => !isKnown(l.id));
    // The stored pack wins for an id both hold; the legacy version is kept aside when it differs.
    const overridden = legacy.levels.some((l) => {
      const held = existing?.levels.find((e) => e.id === l.id);
      return held !== undefined && !sameLevelContent(held, l);
    });
    if (fresh.length > 0) {
      const base = existing ?? userPacks.createLabelledPack(BUILTIN_PACK_IDS.CUSTOM, CUSTOM_PACK_I18N_KEY);
      const merged: LevelPack = { ...base, levels: userPacks.renumberLevels([...base.levels, ...fresh]) };
      this.upsertStoredPack(merged);
      if (!(await LevelPackStorage.savePack(merged))) return;
    }
    if ((legacy.dropped || overridden) && !this.backUpRawLegacy(raw)) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // The legacy list stays; the next start finds nothing new to add and tries again.
    }
  }

  /** Copies the raw legacy text to the backup key. False when storage refused it. */
  private backUpRawLegacy(raw: string): boolean {
    try {
      localStorage.setItem(this.getStorageKey(this.gameConfig.storage.customLevelsBackupKey), raw);
      return true;
    } catch {
      return false;
    }
  }

  private findStoredPack(packId: string): LevelPack | undefined {
    return this.storedPacks.find((p) => p.id === packId);
  }

  private upsertStoredPack(pack: LevelPack): void {
    const index = this.storedPacks.findIndex((p) => p.id === pack.id);
    if (index >= 0) this.storedPacks[index] = pack;
    else this.storedPacks.push(pack);
  }

  /** Writes one pack; the custom pack goes to localStorage while IndexedDB is unreadable. */
  private async persistPack(pack: LevelPack): Promise<boolean> {
    if (this.legacyCustomStore && pack.id === BUILTIN_PACK_IDS.CUSTOM) {
      return this.writeLegacyCustom(pack.levels);
    }
    return LevelPackStorage.savePack(pack);
  }

  private async persistDeletion(packId: string): Promise<boolean> {
    if (this.legacyCustomStore && packId === BUILTIN_PACK_IDS.CUSTOM) {
      return this.writeLegacyCustom([]);
    }
    return LevelPackStorage.deletePack(packId);
  }

  private writeLegacyCustom(levels: readonly CompiledLevel[]): boolean {
    if (this.legacyWriteBlocked) return false;
    try {
      const key = this.getStorageKey(this.gameConfig.storage.customLevelsKey);
      if (levels.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(levels));
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps the pack in memory whatever happens, then writes it. Returns whether the write committed. */
  private async commitPack(pack: LevelPack): Promise<boolean> {
    this.applyPack(pack);
    return this.persistPack(pack);
  }

  /** Puts the pack in memory, and leaves the campaign if that emptied the active pack. */
  private applyPack(pack: LevelPack): void {
    this.upsertStoredPack(pack);
    if (pack.levels.length === 0 && this.activePackId === pack.id) this.resetActivePack();
  }

  /** Writes what memory holds for a pack now, not an older snapshot; true when it was deleted since. */
  private async persistLatest(packId: string): Promise<boolean> {
    const latest = this.findStoredPack(packId);
    return latest ? this.persistPack(latest) : true;
  }

  /** Falls back to the campaign, for when the active pack disappears or empties. */
  private resetActivePack(): void {
    this.activePackId = BUILTIN_PACK_IDS.CAMPAIGN;
    try {
      localStorage.setItem(this.getStorageKey(this.gameConfig.storage.activePackKey), this.activePackId);
    } catch {
      // Ignore storage error
    }
  }

  private takenPackIds(): Set<string> {
    return new Set(this.getAllPacks().map((p) => p.id));
  }

  private takenLevelIds(): Set<string> {
    return new Set(this.getAllPacks().flatMap((p) => p.levels.map((l) => l.id)));
  }

  /** Ids of every level of every pack. */
  public getTakenLevelIds(): Set<string> {
    return this.takenLevelIds();
  }

  /** A level id no pack of the library holds. */
  public newLevelId(): string {
    return userPacks.generateLevelId(this.takenLevelIds());
  }

  /** The packs the player can edit: every pack but the built-in ones, empty ones included. */
  public getEditablePacks(): LevelPack[] {
    return this.storedPacks.filter((p) => p.builtIn !== true);
  }

  public isEditablePack(packId: string): boolean {
    return this.getEditablePacks().some((p) => p.id === packId);
  }

  /**
   * Registers an imported pack for this session and persists it. Levels get
   * unique ids first. A failed write keeps the pack in memory: `persisted`
   * is false and the caller tells the user it lasts for this session only.
   */
  public async registerImportedPack(
    name: string,
    levels: CompiledLevel[],
    options: { scopeIds?: boolean; metadata?: PackMetadata; sourceHash?: string } = {}
  ): Promise<{ pack: LevelPack; persisted: boolean }> {
    const baseId = `pack_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const takenPacks = this.takenPackIds();
    let stamp = Date.now();
    while (takenPacks.has(`${baseId}_${stamp}`)) stamp += 1;
    const cleanId = `${baseId}_${stamp}`;
    const pack: LevelPack = {
      id: cleanId,
      name,
      builtIn: false,
      ...clampPackMetadata(options.metadata, this.gameConfig.packMetadata),
      ...(options.sourceHash ? { sourceHash: options.sourceHash } : {}),
      levels: ensureUniqueLevelIds(options.scopeIds === false ? levels : scopeLevelIds(levels, cleanId), cleanId)
    };
    this.storedPacks.push(pack);
    const persisted = await this.persistPack(pack);
    this.setActivePackId(pack.id);
    return { pack, persisted };
  }

  /** Creates an empty pack the player owns. */
  public async createUserPack(name: string): Promise<PackResult> {
    const pack = userPacks.createUserPack(name, this.takenPackIds());
    if (!pack) return FAILED;
    return { ok: true, pack, persisted: await this.commitPack(pack) };
  }

  public async renamePack(packId: string, name: string): Promise<PackResult> {
    const pack = this.findStoredPack(packId);
    const renamed = pack ? userPacks.renamePack(pack, name) : null;
    if (!renamed) return FAILED;
    return { ok: true, pack: renamed, persisted: await this.commitPack(renamed) };
  }

  /** Sets the author and/or description of a pack; a blank value clears the field. */
  public async setPackMetadata(packId: string, patch: PackMetadata): Promise<PackResult> {
    const pack = this.findStoredPack(packId);
    if (!pack) return FAILED;
    const next = withPackMetadata(pack, patch, this.gameConfig.packMetadata);
    if (next === pack) return { ok: true, pack, persisted: true };
    return { ok: true, pack: next, persisted: await this.commitPack(next) };
  }

  /** Deletes any pack that is not built in. The active pack falls back to the campaign. */
  public async deletePack(packId: string): Promise<PackOperationResult> {
    if (!this.findStoredPack(packId)) return FAILED;
    this.storedPacks = this.storedPacks.filter((p) => p.id !== packId);
    if (this.activePackId === packId) this.resetActivePack();
    return { ok: true, persisted: await this.persistDeletion(packId) };
  }

  public async deleteImportedPack(packId: string): Promise<PackOperationResult> {
    return this.deletePack(packId);
  }

  /**
   * Saves a level into a pack: replaces the level holding the same id, else
   * appends it. The custom pack is created on first use. `number` is set from
   * the position in that pack.
   */
  public async saveLevelToPack(packId: string, level: CompiledLevel): Promise<SaveLevelResult> {
    let pack = this.findStoredPack(packId);
    if (!pack && packId === BUILTIN_PACK_IDS.CUSTOM) {
      pack = userPacks.createLabelledPack(BUILTIN_PACK_IDS.CUSTOM, CUSTOM_PACK_I18N_KEY);
    }
    if (!pack) return { ...FAILED, index: -1 };
    const next = userPacks.upsertLevel(pack, level);
    return {
      ok: true,
      index: next.levels.findIndex((l) => l.id === level.id),
      persisted: await this.commitPack(next)
    };
  }

  public async removeLevelFromPack(packId: string, levelId: string): Promise<PackOperationResult> {
    const pack = this.findStoredPack(packId);
    if (!pack || !pack.levels.some((l) => l.id === levelId)) return FAILED;
    return { ok: true, persisted: await this.commitPack(userPacks.removeLevel(pack, levelId)) };
  }

  /** Moves the level at index `from` so it ends up at index `to`. */
  public async moveLevelInPack(packId: string, from: number, to: number): Promise<PackOperationResult> {
    const pack = this.findStoredPack(packId);
    if (!pack) return FAILED;
    const next = userPacks.moveLevel(pack, from, to);
    if (next === pack) return FAILED;
    return { ok: true, persisted: await this.commitPack(next) };
  }

  /** Moves the level with this id so it ends up at `index`; a level already there is a success with nothing to store. */
  public async moveLevelToIndex(packId: string, levelId: string, index: number): Promise<PackOperationResult> {
    const pack = this.findStoredPack(packId);
    if (!pack) return FAILED;
    const next = userPacks.moveLevelTo(pack, levelId, index);
    if (next === pack) return pack.levels[index]?.id === levelId ? { ok: true, persisted: true } : FAILED;
    return { ok: true, persisted: await this.commitPack(next) };
  }

  /** Inserts a copy of the level right after it, under a new id. */
  public async duplicateLevelInPack(packId: string, levelId: string): Promise<LevelResult> {
    const pack = this.findStoredPack(packId);
    const next = pack ? userPacks.duplicateLevel(pack, levelId, this.newLevelId()) : null;
    if (!next || !pack) return FAILED;
    const index = pack.levels.findIndex((l) => l.id === levelId) + 1;
    return { ok: true, level: next.levels[index], persisted: await this.commitPack(next) };
  }

  /** Appends a copy of a level to another pack, under a new id. */
  public async copyLevelToPack(fromPackId: string, levelId: string, toPackId: string): Promise<LevelResult> {
    const source = this.getAllPacks().find((p) => p.id === fromPackId);
    const destination = this.findStoredPack(toPackId);
    if (!source || !destination || fromPackId === toPackId) return FAILED;
    const next = userPacks.copyLevelToPack(source, levelId, destination, this.newLevelId());
    if (!next) return FAILED;
    return { ok: true, level: next.levels[next.levels.length - 1], persisted: await this.commitPack(next) };
  }

  /** Moves a level to another pack. It keeps its id unless the destination already holds it. */
  public async moveLevelToPack(fromPackId: string, levelId: string, toPackId: string): Promise<LevelResult> {
    const source = this.findStoredPack(fromPackId);
    const destination = this.findStoredPack(toPackId);
    if (!source || !destination || fromPackId === toPackId) return FAILED;
    const moved = userPacks.moveLevelToPack(source, levelId, destination);
    if (!moved) return FAILED;
    // Both packs change in memory before any write is awaited, and each write reads the pack as it is
    // then, so a save made during the first write is neither lost nor overwritten by a stale snapshot.
    // The destination is written first so a failure in between duplicates the level instead of losing it.
    this.applyPack(moved.destination);
    this.applyPack(moved.source);
    const destinationOk = await this.persistLatest(toPackId);
    const sourceOk = await this.persistLatest(fromPackId);
    return {
      ok: true,
      level: moved.destination.levels[moved.destination.levels.length - 1],
      persisted: destinationOk && sourceOk
    };
  }

  /**
   * The pack as a shareable file, or null for an unknown or empty pack. The caller passes the
   * display name (the translated label of a pack that has an i18n key); it defaults to the pack name.
   */
  public exportPackJson(packId: string, displayName?: string, compact = false): string | null {
    const pack = this.getAllPacks().find((p) => p.id === packId);
    return pack && pack.levels.length > 0
      ? serializePack(displayName?.trim() || pack.name, pack.levels, { author: pack.author, description: pack.description }, compact)
      : null;
  }

  /** Reads the pack held by a share link, validated as a file import would be; nothing is stored. */
  public readSharedPack(hash: string): Promise<SharedPackResult> {
    return readSharedPack(hash, {
      bounds: this.getLevelSizeBounds(),
      takenLevelIds: this.takenLevelIds(),
      metadataLimits: this.gameConfig.packMetadata,
      textLimits: this.gameConfig.levelText,
      share: this.gameConfig.share
    });
  }

  /** The pack imported from the shared text with this hash, if the library still holds it. */
  public findPackBySourceHash(sourceHash: string): LevelPack | null {
    return this.getAllPacks().find((p) => p.sourceHash === sourceHash) ?? null;
  }

  /**
   * Adds the pack held by a file made with exportPackJson. `sourceHash` marks a pack that
   * came from a share link, so the same link can be recognised later.
   */
  public async importPackJson(text: string, options: { sourceHash?: string } = {}): Promise<ImportPackJsonResult> {
    const parsed = parsePackJson(
      text,
      this.getLevelSizeBounds(),
      this.takenLevelIds(),
      Date.now,
      this.gameConfig.packMetadata,
      this.gameConfig.levelText
    );
    if (!parsed.ok) return parsed;
    const { pack, persisted } = await this.registerImportedPack(parsed.name, parsed.levels, {
      scopeIds: false,
      metadata: { author: parsed.author, description: parsed.description },
      sourceHash: options.sourceHash
    });
    return { ok: true, pack, persisted };
  }

  public getStorageKey(suffix: string): string {
    return `${ENV_CONFIG.STORAGE_PREFIX}${suffix}`;
  }

  /**
   * Compiles a blueprint into a playable level. Blueprints may come from an
   * imported file, so coordinates are bounds-checked: an invalid player start
   * rejects the level, out-of-grid entities and links are dropped.
   */
  public compileBlueprint(bp: LevelBlueprint): CompiledLevel {
    const levelId = typeof bp.id === 'string' ? bp.id : String(bp.number);
    const { width: mapWidth, height: mapHeight } = this.blueprintSize(bp, levelId);
    const inGrid = (x: unknown, y: unknown) => isInBounds(x, y, mapWidth, mapHeight);

    if (bp.ruleset === 'cc3d') {
      // A blueprint cannot carry the cc3d data the engine of that ruleset reads.
      throw new Error(`${levelId}: the cc3d ruleset cannot be declared by a JSON level`);
    }
    const start = bp.playerStart;
    if (!start || !inGrid(start.x, start.y)) {
      throw new InvalidLevelError(levelId, 'player start missing or outside the grid');
    }
    if (!isFiniteNumber(bp.number)) {
      throw new InvalidLevelError(levelId, 'level number is not a number');
    }
    const terrain: string[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => 'floor')
    );
    const items: (string | null)[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => null)
    );

    // An exported level carries its items as a grid; a hand-written one as placements.
    const itemGrid = bp.itemGrid ?? (isItemGrid(bp.items) ? bp.items : undefined);
    const placements = isItemGrid(bp.items) ? undefined : bp.items;
    if (bp.terrain) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          terrain[y][x] = bp.terrain[y]?.[x] || 'floor';
          items[y][x] = itemGrid?.[y]?.[x] || null;
        }
      }
    } else if (bp.rows) {
      for (let y = 0; y < Math.min(mapHeight, bp.rows.length); y++) {
        const row = bp.rows[y];
        for (let x = 0; x < Math.min(mapWidth, row.length); x++) {
          const ch = row[x];
          const entry = this.levelsConfig.legend[ch];
          if (entry) {
            terrain[y][x] = entry.terrain;
            if (entry.item) {
              items[y][x] = entry.item;
            }
          }
        }
      }
    }

    if (bp.terrainOverrides) {
      for (const ov of bp.terrainOverrides) {
        if (ov.y >= 0 && ov.y < mapHeight && ov.x >= 0 && ov.x < mapWidth) {
          terrain[ov.y][ov.x] = ov.id;
        }
      }
    }

    if (placements) {
      for (const it of placements) {
        if (it.y >= 0 && it.y < mapHeight && it.x >= 0 && it.x < mapWidth) {
          items[it.y][it.x] = it.id;
        }
      }
    }

    const cellEdges = normalizeCellEdges(bp.cellEdges, terrain, bp.ruleset);
    const underlays = normalizeUnderlays(bp.underlays, terrain, bp.ruleset);

    return {
      id: levelId,
      ...(typeof bp.theme === 'string' ? { theme: bp.theme } : {}),
      ...(typeof bp.solution === 'string' ? { solution: bp.solution } : {}),
      ...(isBlockBudget(bp.blockBudget) ? { blockBudget: { waters: bp.blockBudget.waters, targets: bp.blockBudget.targets } } : {}),
      ...(isWinRule(bp.winRule) ? { winRule: bp.winRule } : {}),
      ...(isRuleset(bp.ruleset) && bp.ruleset !== DEFAULT_RULESET ? { ruleset: bp.ruleset } : {}),
      number: bp.number,
      ...(typeof bp.titleKey === 'string' ? { titleKey: bp.titleKey } : {}),
      ...(typeof bp.customTitle === 'string' ? { customTitle: bp.customTitle } : {}),
      ...(typeof bp.hintKey === 'string' ? { hintKey: bp.hintKey } : {}),
      ...(typeof bp.customHint === 'string' ? { customHint: bp.customHint } : {}),
      ...(typeof bp.author === 'string' && bp.author.trim() ? { author: bp.author.trim() } : {}),
      password: (typeof bp.password === 'string' && bp.password
        ? bp.password
        : DEFAULT_LEVEL_PASSWORD
      ).toUpperCase(),
      timeLimitSeconds: toNonNegative(bp.timeLimitSeconds),
      chipsRequired: toNonNegative(bp.chipsRequired),
      playerStart: {
        x: start.x,
        y: start.y,
        dir: isDirection(start.dir) ? start.dir : DEFAULT_START_DIRECTION
      },
      terrain,
      items,
      ...(cellEdges ? { cellEdges } : {}),
      ...(underlays ? { underlays } : {}),
      entities: asArray(bp.entities)
        .filter((e) => inGrid(e.x, e.y) && typeof e.type === 'string')
        .map((e) => ({ ...e, dir: isDirection(e.dir) ? e.dir : DEFAULT_START_DIRECTION })),
      trapLinks: asArray(bp.trapLinks)
        .filter((l) => inGrid(l.buttonX, l.buttonY) && inGrid(l.trapX, l.trapY))
        .map((l) => ({ ...l })),
      cloneLinks: asArray(bp.cloneLinks)
        .filter((l) => inGrid(l.buttonX, l.buttonY) && inGrid(l.clonerX, l.clonerY))
        .map((l) => ({ ...l }))
    };
  }

  /** Longest author and description a pack keeps. */
  public getPackMetadataLimits(): PackMetadataLimits {
    return this.gameConfig.packMetadata;
  }

  /** Bounds of the Playtest recorder and of its rating form. */
  public getPlaytestConfig(): PlaytestConfig {
    return this.gameConfig.playtest;
  }

  /** Longest text fields a stored, imported or shared level keeps. */
  public getLevelTextLimits(): LevelTextConfig {
    return this.gameConfig.levelText;
  }

  /** Width and height a .json level or a custom pack may have. */
  public getLevelSizeBounds(): LevelSizeBounds {
    return levelSizeBoundsOf(this.gameConfig.grid);
  }

  /**
   * The size of a blueprint comes from its terrain grid when it has one, else
   * from its legend rows (their count and the widest row); a blueprint with
   * neither gets the default map size. A size outside the configured bounds
   * rejects the level.
   */
  private blueprintSize(bp: LevelBlueprint, levelId: string): GridSize {
    const grid = this.gameConfig.grid;
    const source: ReadonlyArray<{ length: number }> | null =
      Array.isArray(bp.terrain) && bp.terrain.length > 0
        ? bp.terrain
        : Array.isArray(bp.rows) && bp.rows.length > 0
          ? bp.rows
          : null;
    if (!source) {
      return { width: grid.mapWidth, height: grid.mapHeight };
    }
    const size = {
      width: source.reduce((widest, row) => Math.max(widest, row.length), 0),
      height: source.length
    };
    if (!isSizeWithinBounds(size, levelSizeBoundsOf(grid))) {
      throw new InvalidLevelError(
        levelId,
        `level size ${size.width}x${size.height} is outside ${grid.minLevelSize}..${grid.maxLevelSize}`
      );
    }
    return size;
  }
}

/** True when two levels hold the same data; their position in a pack (`number`) does not count. */
function sameLevelContent(a: CompiledLevel, b: CompiledLevel): boolean {
  return deepEqual({ ...a, number: 0 }, { ...b, number: 0 });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) => key in b && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

function toNonNegative(value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;
}

function isItemGrid(
  items: LevelBlueprint['items']
): items is (string | null)[][] {
  return Array.isArray(items) && Array.isArray(items[0]);
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export const ConfigRegistry = new ConfigRegistryService();
