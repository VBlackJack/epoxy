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

import { BUILTIN_PACK_IDS, CONFIG_ENDPOINTS, ENV_CONFIG } from './constants';
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
  TilesConfig
} from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { LevelPackStorage } from '../storage/LevelPackStorage';

class ConfigRegistryService {
  private gameConfig!: GameConfig;
  private tilesConfig!: TilesConfig;
  private monstersConfig!: MonstersConfig;
  private audioConfig!: AudioConfig;
  private levelsConfig!: LevelsConfig;
  private datFormatConfig!: DatFormatConfig;

  private builtInLevels: CompiledLevel[] = [];
  private ultimatePacks: LevelPack[] = [];
  private customLevels: CompiledLevel[] = [];
  private proceduralLevels: CompiledLevel[] = [];
  private importedPacks: LevelPack[] = [];
  private activePackId: string = BUILTIN_PACK_IDS.CAMPAIGN;

  public async loadAll(): Promise<void> {
    const [game, tiles, monsters, audio, levels, datFormat] = await Promise.all([
      this.fetchJson<GameConfig>(CONFIG_ENDPOINTS.GAME),
      this.fetchJson<TilesConfig>(CONFIG_ENDPOINTS.TILES),
      this.fetchJson<MonstersConfig>(CONFIG_ENDPOINTS.MONSTERS),
      this.fetchJson<AudioConfig>(CONFIG_ENDPOINTS.AUDIO),
      this.fetchJson<LevelsConfig>(CONFIG_ENDPOINTS.LEVELS),
      this.fetchJson<DatFormatConfig>(CONFIG_ENDPOINTS.DAT_FORMAT)
    ]);

    this.gameConfig = game;
    this.tilesConfig = tiles;
    this.monstersConfig = monsters;
    this.audioConfig = audio;
    this.levelsConfig = levels;
    this.datFormatConfig = datFormat;

    this.builtInLevels = levels.levels.map((bp) => this.compileBlueprint(bp));
    await this.loadUltimatePacks();
    this.appendCampaignUltimateSelection();
    this.customLevels = this.loadCustomLevelsFromStorage();
    this.importedPacks = await LevelPackStorage.loadAllPacks();

    const savedPackId = localStorage.getItem(
      this.getStorageKey(this.gameConfig.storage.activePackKey)
    );
    if (savedPackId && this.getAllPacks().some((p) => p.id === savedPackId && p.levels.length > 0)) {
      this.activePackId = savedPackId;
    }
  }

  private async loadUltimatePacks(): Promise<void> {
    const descriptors = this.gameConfig.ultimatePacks || [];
    const loaded: LevelPack[] = [];

    await Promise.all(
      descriptors.map(async (desc) => {
        try {
          const response = await fetch(desc.url);
          if (!response.ok) return;
          const buffer = await response.arrayBuffer();
          const decoded = DatCodec.decodeBuffer(buffer, desc.prefix);
          if (decoded.length > 0) {
            loaded.push({
              id: desc.id,
              name: desc.name,
              i18nKey: desc.i18nKey,
              builtIn: true,
              levels: decoded
            });
          }
        } catch {
          // Pack unavailable
        }
      })
    );

    const orderMap = new Map(descriptors.map((d, idx) => [d.id, idx]));
    loaded.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    this.ultimatePacks = loaded;
  }

  private appendCampaignUltimateSelection(): void {
    const selections = this.gameConfig.campaignUltimateSelection || [];
    for (const sel of selections) {
      const pack = this.ultimatePacks.find((p) => p.id === sel.packId);
      if (!pack) continue;
      for (const lvlNum of sel.levelNumbers) {
        const found = pack.levels.find((l) => l.number === lvlNum);
        if (found) {
          const nextNumber = this.builtInLevels.length + 1;
          this.builtInLevels.push({
            ...found,
            id: `campaign_${sel.packId}_${lvlNum}`,
            number: nextNumber,
            customTitle: found.customTitle
              ? `${found.customTitle} (${pack.name})`
              : `${pack.name} #${lvlNum}`,
            terrain: found.terrain.map((row) => [...row]),
            items: found.items.map((row) => [...row]),
            entities: found.entities.map((e) => ({ ...e })),
            trapLinks: found.trapLinks.map((t) => ({ ...t })),
            cloneLinks: found.cloneLinks.map((c) => ({ ...c }))
          });
        }
      }
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json() as Promise<T>;
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
        builtIn: true,
        levels: this.proceduralLevels
      });
    }
    if (this.customLevels.length > 0) {
      packs.push({
        id: BUILTIN_PACK_IDS.CUSTOM,
        name: 'Custom',
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

  public async registerImportedPack(name: string, levels: CompiledLevel[]): Promise<LevelPack> {
    const cleanId = `pack_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    const pack: LevelPack = {
      id: cleanId,
      name,
      builtIn: false,
      levels
    };
    this.importedPacks.push(pack);
    await LevelPackStorage.savePack(pack);
    this.setActivePackId(pack.id);
    return pack;
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

  public compileBlueprint(bp: LevelBlueprint): CompiledLevel {
    const { mapWidth, mapHeight } = this.gameConfig.grid;
    const terrain: string[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => 'floor')
    );
    const items: (string | null)[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => null)
    );

    if (bp.terrain && bp.itemGrid) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          terrain[y][x] = bp.terrain[y]?.[x] || 'floor';
          items[y][x] = bp.itemGrid[y]?.[x] || null;
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

    if (bp.items) {
      for (const it of bp.items) {
        if (it.y >= 0 && it.y < mapHeight && it.x >= 0 && it.x < mapWidth) {
          items[it.y][it.x] = it.id;
        }
      }
    }

    return {
      id: bp.id,
      number: bp.number,
      titleKey: bp.titleKey,
      customTitle: bp.customTitle,
      hintKey: bp.hintKey,
      customHint: bp.customHint,
      password: (bp.password || 'EPOX').toUpperCase(),
      timeLimitSeconds: bp.timeLimitSeconds,
      chipsRequired: bp.chipsRequired,
      playerStart: { ...bp.playerStart },
      terrain,
      items,
      entities: (bp.entities || []).map((e) => ({ ...e })),
      trapLinks: (bp.trapLinks || []).map((l) => ({ ...l })),
      cloneLinks: (bp.cloneLinks || []).map((l) => ({ ...l }))
    };
  }

  public addOrUpdateCustomLevel(level: CompiledLevel): number {
    const existingIdx = this.customLevels.findIndex((l) => l.id === level.id);
    if (existingIdx >= 0) {
      this.customLevels[existingIdx] = level;
    } else {
      level.number = this.customLevels.length + 1;
      this.customLevels.push(level);
    }
    this.saveCustomLevelsToStorage();
    this.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);
    return existingIdx >= 0 ? existingIdx : this.customLevels.length - 1;
  }

  private loadCustomLevelsFromStorage(): CompiledLevel[] {
    try {
      const raw = localStorage.getItem(
        this.getStorageKey(this.gameConfig.storage.customLevelsKey)
      );
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CompiledLevel[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveCustomLevelsToStorage(): void {
    try {
      localStorage.setItem(
        this.getStorageKey(this.gameConfig.storage.customLevelsKey),
        JSON.stringify(this.customLevels)
      );
    } catch {
      // Storage full or unavailable
    }
  }
}

export const ConfigRegistry = new ConfigRegistryService();
