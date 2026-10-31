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
  DEFAULT_LEVEL_PASSWORD,
  ENV_CONFIG,
  UNORDERED_PACK_RANK
} from './constants';
import {
  assertConfigShape,
  ConfigLoadError,
  ensureUniqueLevelIds,
  sanitizeStoredLevels,
  isSizeWithinBounds,
  levelSizeBoundsOf,
  GridSize,
  LevelSizeBounds,
  findBlockPuzzleConfigErrors,
  isDirection,
  isFiniteNumber,
  isInBounds,
  isWinRule,
  findDatFormatErrors,
  findGameTunableErrors,
  InvalidLevelError
} from './ConfigValidation';
import { findGraphicsConfigErrors } from '../render/renderSettings';
import {
  AudioConfig,
  CompiledLevel,
  DatFormatConfig,
  EntityDefinition,
  GameConfig,
  LevelBlueprint,
  LevelPack,
  LevelsConfig,
  MonstersConfig,
  TileDefinition,
  TilesConfig,
  UltimatePackDescriptor
} from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { MotifAnnotations, MotifsConfig, PieceLegendEntry } from '../generator/PieceTypes';
import { LevelPackStorage } from '../storage/LevelPackStorage';

/** Top-level keys each config file must define. */
const REQUIRED_CONFIG_KEYS = {
  GAME: ['grid', 'timing', 'storage', 'import', 'locales', 'keybindings', 'palette', 'blockPuzzle'],
  TILES: ['tiles'],
  MONSTERS: ['entities'],
  AUDIO: ['masterVolume', 'sfxVolume', 'musicVolume', 'effects'],
  LEVELS: ['legend', 'levels'],
  DAT_FORMAT: ['magicHeaders', 'rleMarkerByte', 'layerByteLength', 'fieldCodes', 'byteToElement'],
  MOTIFS: ['legend', 'pieces', 'monsterPortTerrain'],
  MOTIF_ANNOTATIONS: []
} as const;

/** Direction given to a level start that does not define a valid one. */
const DEFAULT_START_DIRECTION = 'S';

export interface ConfigBundle {
  game: GameConfig;
  tiles: TilesConfig;
  monsters: MonstersConfig;
  audio: AudioConfig;
  levels: LevelsConfig;
  datFormat: DatFormatConfig;
  motifs: MotifsConfig;
  motifAnnotations: MotifAnnotations;
}

interface FetchedPack {
  descriptor: UltimatePackDescriptor;
  buffer: ArrayBuffer;
}

class ConfigRegistryService {
  private gameConfig!: GameConfig;
  private tilesConfig!: TilesConfig;
  private monstersConfig!: MonstersConfig;
  private audioConfig!: AudioConfig;
  private levelsConfig!: LevelsConfig;
  private datFormatConfig!: DatFormatConfig;
  private motifsConfig!: MotifsConfig;
  private motifAnnotations: MotifAnnotations = {};

  private builtInLevels: CompiledLevel[] = [];
  private ultimatePacks: LevelPack[] = [];
  private customLevels: CompiledLevel[] = [];
  private proceduralLevels: CompiledLevel[] = [];
  private importedPacks: LevelPack[] = [];
  private activePackId: string = BUILTIN_PACK_IDS.CAMPAIGN;

  public async loadAll(): Promise<void> {
    const gamePromise = this.fetchJson<GameConfig>(CONFIG_ENDPOINTS.GAME, REQUIRED_CONFIG_KEYS.GAME);
    // Pack downloads only need game.json, so they overlap with the other config fetches.
    const packsPromise = gamePromise.then(
      (game) => this.fetchUltimatePacks(game.ultimatePacks || []),
      () => [] as FetchedPack[]
    );

    const [game, tiles, monsters, audio, levels, datFormat, motifs, motifAnnotations] = await Promise.all([
      gamePromise,
      this.fetchJson<TilesConfig>(CONFIG_ENDPOINTS.TILES, REQUIRED_CONFIG_KEYS.TILES),
      this.fetchJson<MonstersConfig>(CONFIG_ENDPOINTS.MONSTERS, REQUIRED_CONFIG_KEYS.MONSTERS),
      this.fetchJson<AudioConfig>(CONFIG_ENDPOINTS.AUDIO, REQUIRED_CONFIG_KEYS.AUDIO),
      this.fetchJson<LevelsConfig>(CONFIG_ENDPOINTS.LEVELS, REQUIRED_CONFIG_KEYS.LEVELS),
      this.fetchJson<DatFormatConfig>(CONFIG_ENDPOINTS.DAT_FORMAT, REQUIRED_CONFIG_KEYS.DAT_FORMAT),
      this.fetchJson<MotifsConfig>(CONFIG_ENDPOINTS.MOTIFS, REQUIRED_CONFIG_KEYS.MOTIFS),
      this.fetchJson<MotifAnnotations>(CONFIG_ENDPOINTS.MOTIF_ANNOTATIONS, REQUIRED_CONFIG_KEYS.MOTIF_ANNOTATIONS)
    ]);

    this.applyConfigs({ game, tiles, monsters, audio, levels, datFormat, motifs, motifAnnotations });
    this.ultimatePacks = this.decodeUltimatePacks(await packsPromise);
    this.customLevels = this.loadCustomLevelsFromStorage();
    // The store name and the level size bounds come from game.json, so the
    // stored packs are read only once the configs are installed.
    this.importedPacks = await LevelPackStorage.loadAllPacks();

    const savedPackId = this.readStorage(this.gameConfig.storage.activePackKey);
    if (savedPackId && this.getAllPacks().some((p) => p.id === savedPackId && p.levels.length > 0)) {
      this.activePackId = savedPackId;
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
      new Set(Object.keys(bundle.tiles.tiles))
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
    const tunableErrors = findGameTunableErrors(bundle.game);
    if (tunableErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.GAME, tunableErrors.join('; '));
    }
    const datFormatErrors = findDatFormatErrors(bundle.datFormat, bundle.game.grid);
    if (datFormatErrors.length > 0) {
      throw new ConfigLoadError(CONFIG_ENDPOINTS.DAT_FORMAT, datFormatErrors.join('; '));
    }
    this.gameConfig = bundle.game;
    this.tilesConfig = bundle.tiles;
    this.monstersConfig = bundle.monsters;
    this.audioConfig = bundle.audio;
    this.levelsConfig = bundle.levels;
    this.datFormatConfig = bundle.datFormat;
    this.motifsConfig = bundle.motifs;
    this.motifAnnotations = bundle.motifAnnotations;

    this.builtInLevels = bundle.levels.levels.map((bp) => this.compileBlueprint(bp));
    this.ultimatePacks = [];
    this.customLevels = [];
    this.proceduralLevels = [];
    this.importedPacks = [];
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
        const decoded = DatCodec.decodeBuffer(buffer, descriptor.prefix);
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

  public getTile(id: string): TileDefinition {
    return this.tilesConfig.tiles[id] || this.tilesConfig.tiles.floor;
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
      ...this.ultimatePacks,
      ...this.importedPacks
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
    if (this.customLevels.length > 0) {
      packs.push({
        id: BUILTIN_PACK_IDS.CUSTOM,
        name: 'Custom',
        i18nKey: 'app.packs.custom.label',
        builtIn: true,
        levels: this.customLevels
      });
    }
    return packs;
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

  public getLevels(): CompiledLevel[] {
    const pack = this.getAllPacks().find((p) => p.id === this.activePackId);
    if (pack && pack.levels.length > 0) {
      return pack.levels;
    }
    return this.builtInLevels;
  }

  /**
   * Registers an imported pack for this session and persists it. Levels get
   * unique ids first. A failed write keeps the pack in memory: `persisted`
   * is false and the caller tells the user it lasts for this session only.
   */
  public async registerImportedPack(
    name: string,
    levels: CompiledLevel[]
  ): Promise<{ pack: LevelPack; persisted: boolean }> {
    const cleanId = `pack_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    const pack: LevelPack = {
      id: cleanId,
      name,
      builtIn: false,
      levels: ensureUniqueLevelIds(levels, cleanId)
    };
    this.importedPacks.push(pack);
    const persisted = await LevelPackStorage.savePack(pack);
    this.setActivePackId(pack.id);
    return { pack, persisted };
  }

  public async deleteImportedPack(packId: string): Promise<void> {
    this.importedPacks = this.importedPacks.filter((p) => p.id !== packId);
    await LevelPackStorage.deletePack(packId);
    if (this.activePackId === packId) {
      this.setActivePackId(BUILTIN_PACK_IDS.CAMPAIGN);
    }
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

    return {
      id: levelId,
      ...(typeof bp.theme === 'string' ? { theme: bp.theme } : {}),
      ...(typeof bp.solution === 'string' ? { solution: bp.solution } : {}),
      ...(isWinRule(bp.winRule) ? { winRule: bp.winRule } : {}),
      number: bp.number,
      ...(typeof bp.titleKey === 'string' ? { titleKey: bp.titleKey } : {}),
      ...(typeof bp.customTitle === 'string' ? { customTitle: bp.customTitle } : {}),
      ...(typeof bp.hintKey === 'string' ? { hintKey: bp.hintKey } : {}),
      ...(typeof bp.customHint === 'string' ? { customHint: bp.customHint } : {}),
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

  /**
   * Stores a custom level. The in-memory list is updated whatever happens;
   * `persisted` is false when localStorage refused the write.
   */
  public addOrUpdateCustomLevel(level: CompiledLevel): { index: number; persisted: boolean } {
    const existingIdx = this.customLevels.findIndex((l) => l.id === level.id);
    if (existingIdx >= 0) {
      this.customLevels[existingIdx] = level;
    } else {
      level.number = this.customLevels.length + 1;
      this.customLevels.push(level);
    }
    const persisted = this.saveCustomLevelsToStorage();
    this.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);
    return { index: existingIdx >= 0 ? existingIdx : this.customLevels.length - 1, persisted };
  }

  private loadCustomLevelsFromStorage(): CompiledLevel[] {
    try {
      const raw = localStorage.getItem(
        this.getStorageKey(this.gameConfig.storage.customLevelsKey)
      );
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const bounds = this.getLevelSizeBounds();
      return sanitizeStoredLevels(parsed, bounds);
    } catch {
      return [];
    }
  }

  /** Writes the custom levels; false when storage is full or unavailable. */
  private saveCustomLevelsToStorage(): boolean {
    try {
      localStorage.setItem(
        this.getStorageKey(this.gameConfig.storage.customLevelsKey),
        JSON.stringify(this.customLevels)
      );
      return true;
    } catch {
      return false;
    }
  }
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
