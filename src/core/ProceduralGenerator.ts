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
import { LevelValidator } from './LevelValidator';
import { CloneLink, CompiledLevel, Direction, EntityPlacement, TrapLink } from './types';

interface SectorNode {
  gx: number;
  gy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  orderIndex: number;
  parent: SectorNode | null;
  entryDoorX: number;
  entryDoorY: number;
  entryDir: Direction;
  doors: Record<Direction, boolean>;
}

type MapTopology =
  | 'ASYMMETRIC_COMPLEX'
  | 'SPIRAL_CITADEL'
  | 'GRAND_CANAL'
  | 'TELEPORT_ARCHIPELAGO'
  | 'MECHANICAL_FOUNDRY';

type VaultArchetype =
  | 'bomb_defusal_lab'
  | 'ice_ricochet_arena'
  | 'sokoban_canal'
  | 'mirage_labyrinth'
  | 'dirt_excavation_tunnels'
  | 'conveyor_slalom'
  | 'trap_brown_vault'
  | 'cloner_red_vault'
  | 'teleport_vault'
  | 'glider_lagoon'
  | 'fireball_foundry';

interface ProgressionStep {
  doorwayTile: string;
  vaultArchetype: VaultArchetype;
  rewardItem: string | null;
  rewardTerrain?: string;
}

export class ProceduralGenerator {
  public static generatePack(count?: number): CompiledLevel[] {
    const cfg = ConfigRegistry.getGame().procedural;
    const total = count || cfg?.defaultLevelCount || 10;
    const levels: CompiledLevel[] = [];

    for (let i = 1; i <= total; i++) {
      levels.push(this.generateLevel(i));
    }

    return levels;
  }

  public static generateLevel(levelNumber: number): CompiledLevel {
    const procCfg = ConfigRegistry.getGame().procedural;
    const maxAttempts = procCfg?.maxGenerationAttempts || 25;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = this.buildOrganicComplex(levelNumber);
      const report = LevelValidator.validate(candidate);
      if (report.valid && report.stats.chipsPlaced >= 12) {
        return candidate;
      }
    }

    return this.buildOrganicComplex(levelNumber);
  }

  private static buildOrganicComplex(levelNumber: number): CompiledLevel {
    const width = 32;
    const height = 32;

    const topologies: MapTopology[] = [
      'ASYMMETRIC_COMPLEX',
      'SPIRAL_CITADEL',
      'GRAND_CANAL',
      'TELEPORT_ARCHIPELAGO',
      'MECHANICAL_FOUNDRY'
    ];
    const topology = topologies[(levelNumber - 1) % topologies.length];

    const terrain: string[][] = Array.from({ length: height }, () =>
      new Array<string>(width).fill('wall')
    );
    const items: (string | null)[][] = Array.from({ length: height }, () =>
      new Array<string | null>(width).fill(null)
    );
    const entities: EntityPlacement[] = [];
    const trapLinks: TrapLink[] = [];
    const cloneLinks: CloneLink[] = [];

    // Asymmetric sector widths and heights (summing to 28, plus 4 single-tile dividers = 32)
    const dimensionPresets: Array<[number, number, number]> = [
      [8, 11, 9],
      [10, 9, 9],
      [9, 8, 11],
      [11, 9, 8],
      [8, 10, 10],
      [10, 10, 8]
    ];
    const colWidths = dimensionPresets[this.randInt(0, dimensionPresets.length - 1)];
    const rowHeights = dimensionPresets[this.randInt(0, dimensionPresets.length - 1)];

    const colStarts = [1, 1 + colWidths[0] + 1, 1 + colWidths[0] + 1 + colWidths[1] + 1];
    const rowStarts = [1, 1 + rowHeights[0] + 1, 1 + rowHeights[0] + 1 + rowHeights[1] + 1];

    // Style outer perimeter moat according to topology while keeping inter-sector walls 100% sealed
    if (topology === 'GRAND_CANAL' || topology === 'TELEPORT_ARCHIPELAGO') {
      const moatTile = topology === 'GRAND_CANAL' ? 'water' : 'ice';
      for (let y = 0; y < height; y++) {
        terrain[y][0] = moatTile;
        terrain[y][width - 1] = moatTile;
      }
      for (let x = 0; x < width; x++) {
        terrain[0][x] = moatTile;
        terrain[height - 1][x] = moatTile;
      }
    }

    const grid: SectorNode[][] = [];
    for (let gy = 0; gy < 3; gy++) {
      const row: SectorNode[] = [];
      for (let gx = 0; gx < 3; gx++) {
        const x0 = colStarts[gx];
        const y0 = rowStarts[gy];
        const w = colWidths[gx];
        const h = rowHeights[gy];
        const x1 = x0 + w - 1;
        const y1 = y0 + h - 1;

        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            terrain[yy][xx] = 'floor';
          }
        }

        row.push({
          gx,
          gy,
          x0,
          y0,
          x1,
          y1,
          w,
          h,
          orderIndex: -1,
          parent: null,
          entryDoorX: x0 + 1,
          entryDoorY: y0 + 1,
          entryDir: 'N',
          doors: { N: false, E: false, S: false, W: false }
        });
      }
      grid.push(row);
    }

    const orderedSectors: SectorNode[] = [];

    const connectSectors = (from: SectorNode, to: SectorNode, dir: Direction): void => {
      to.orderIndex = orderedSectors.length;
      to.parent = from;
      to.entryDir = dir;

      if (dir === 'N') {
        from.doors.N = true;
        to.doors.S = true;
        to.entryDoorX = from.x0 + 1;
        to.entryDoorY = from.y0 - 1;
      } else if (dir === 'S') {
        from.doors.S = true;
        to.doors.N = true;
        to.entryDoorX = from.x0 + 1;
        to.entryDoorY = to.y0 - 1;
      } else if (dir === 'W') {
        from.doors.W = true;
        to.doors.E = true;
        to.entryDoorX = from.x0 - 1;
        to.entryDoorY = from.y0 + 1;
      } else {
        from.doors.E = true;
        to.doors.W = true;
        to.entryDoorX = to.x0 - 1;
        to.entryDoorY = from.y0 + 1;
      }

      // Reinforce doorway bridge abutments with solid wall when dividers are water canals
      const dx = to.entryDoorX;
      const dy = to.entryDoorY;
      if (dir === 'N' || dir === 'S') {
        if (dx - 1 >= 1) terrain[dy][dx - 1] = 'wall';
        if (dx + 1 < width - 1) terrain[dy][dx + 1] = 'wall';
      } else {
        if (dy - 1 >= 1) terrain[dy - 1][dx] = 'wall';
        if (dy + 1 < height - 1) terrain[dy + 1][dx] = 'wall';
      }

      terrain[dy][dx] = 'floor';
      orderedSectors.push(to);
    };

    if (topology === 'SPIRAL_CITADEL') {
      // Clockwise inward spiral ending at the central citadel core (1,1)
      const spiralCoords: Array<{ gx: number; gy: number; dir: Direction }> = [
        { gx: 0, gy: 0, dir: 'E' },
        { gx: 1, gy: 0, dir: 'E' },
        { gx: 2, gy: 0, dir: 'E' },
        { gx: 2, gy: 1, dir: 'S' },
        { gx: 2, gy: 2, dir: 'S' },
        { gx: 1, gy: 2, dir: 'W' },
        { gx: 0, gy: 2, dir: 'W' },
        { gx: 0, gy: 1, dir: 'N' },
        { gx: 1, gy: 1, dir: 'E' }
      ];
      const first = grid[spiralCoords[0].gy][spiralCoords[0].gx];
      first.orderIndex = 0;
      orderedSectors.push(first);
      for (let i = 1; i < spiralCoords.length; i++) {
        const prev = orderedSectors[i - 1];
        const curr = grid[spiralCoords[i].gy][spiralCoords[i].gx];
        connectSectors(prev, curr, spiralCoords[i].dir);
      }
    } else {
      const startCoords = [
        { gx: 1, gy: 1 },
        { gx: 0, gy: 0 },
        { gx: 2, gy: 0 },
        { gx: 0, gy: 2 },
        { gx: 2, gy: 2 }
      ];
      const chosenStart = startCoords[(levelNumber - 1) % startCoords.length];
      const startSector = grid[chosenStart.gy][chosenStart.gx];
      startSector.orderIndex = 0;
      orderedSectors.push(startSector);

      const frontier: Array<{ from: SectorNode; to: SectorNode; dir: Direction }> = [];
      const addNeighbors = (node: SectorNode): void => {
        const deltas: Array<{ dx: number; dy: number; dir: Direction }> = [
          { dx: 0, dy: -1, dir: 'N' },
          { dx: 1, dy: 0, dir: 'E' },
          { dx: 0, dy: 1, dir: 'S' },
          { dx: -1, dy: 0, dir: 'W' }
        ];
        for (const d of deltas) {
          const nx = node.gx + d.dx;
          const ny = node.gy + d.dy;
          if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3 && grid[ny][nx].orderIndex === -1) {
            frontier.push({ from: node, to: grid[ny][nx], dir: d.dir });
          }
        }
      };

      addNeighbors(startSector);

      while (frontier.length > 0) {
        const idx = this.randInt(0, frontier.length - 1);
        const edge = frontier.splice(idx, 1)[0];
        if (edge.to.orderIndex !== -1) continue;
        connectSectors(edge.from, edge.to, edge.dir);
        addNeighbors(edge.to);
      }
    }

    const startSector = orderedSectors[0];

    // Shuffle the 4 key/door colors
    const keyDoorPairs = [
      { key: 'key_red', door: 'door_red' },
      { key: 'key_blue', door: 'door_blue' },
      { key: 'key_yellow', door: 'door_yellow' },
      { key: 'key_green', door: 'door_green' }
    ];
    this.shuffleArray(keyDoorPairs);

    // Pool of 9 distinct dry-vault archetypes (including Teleporters, Bear Traps, and Clone Machines!)
    const allDryArchetypes: VaultArchetype[] = [
      'bomb_defusal_lab',
      'ice_ricochet_arena',
      'sokoban_canal',
      'mirage_labyrinth',
      'dirt_excavation_tunnels',
      'conveyor_slalom',
      'trap_brown_vault',
      'cloner_red_vault',
      'teleport_vault'
    ];
    this.shuffleArray(allDryArchetypes);

    // Ensure topology-specific signature mechanics appear in their matching topology
    if (topology === 'TELEPORT_ARCHIPELAGO') {
      const tIdx = allDryArchetypes.indexOf('teleport_vault');
      if (tIdx > 5) {
        [allDryArchetypes[2], allDryArchetypes[tIdx]] = [allDryArchetypes[tIdx], allDryArchetypes[2]];
      }
    } else if (topology === 'MECHANICAL_FOUNDRY') {
      const trIdx = allDryArchetypes.indexOf('trap_brown_vault');
      if (trIdx > 5) {
        [allDryArchetypes[1], allDryArchetypes[trIdx]] = [allDryArchetypes[trIdx], allDryArchetypes[1]];
      }
      const clIdx = allDryArchetypes.indexOf('cloner_red_vault');
      if (clIdx > 5) {
        [allDryArchetypes[3], allDryArchetypes[clIdx]] = [allDryArchetypes[clIdx], allDryArchetypes[3]];
      }
    }

    const progression: ProgressionStep[] = [
      {
        doorwayTile: 'floor',
        vaultArchetype: allDryArchetypes[0],
        rewardItem: keyDoorPairs[0].key
      },
      {
        doorwayTile: keyDoorPairs[0].door,
        vaultArchetype: allDryArchetypes[1],
        rewardItem: keyDoorPairs[1].key
      },
      {
        doorwayTile: keyDoorPairs[1].door,
        vaultArchetype: allDryArchetypes[2],
        rewardItem: keyDoorPairs[2].key
      },
      {
        doorwayTile: keyDoorPairs[2].door,
        vaultArchetype: allDryArchetypes[3],
        rewardItem: keyDoorPairs[3].key
      },
      {
        doorwayTile: keyDoorPairs[3].door,
        vaultArchetype: allDryArchetypes[4],
        rewardItem: null,
        rewardTerrain: 'button_green'
      },
      {
        doorwayTile: 'toggle_wall_closed',
        vaultArchetype: allDryArchetypes[5],
        rewardItem: 'boots_water'
      },
      {
        doorwayTile: 'water',
        vaultArchetype: 'glider_lagoon',
        rewardItem: 'boots_fire'
      },
      {
        doorwayTile: 'fire',
        vaultArchetype: 'fireball_foundry',
        rewardItem: 'chip'
      }
    ];

    const startX = startSector.x0 + 1;
    const startY = startSector.y0 + 1;
    terrain[startY][startX + 1] = 'hint';

    for (let i = 0; i < 8; i++) {
      const sec = orderedSectors[i];
      const step = progression[i];

      if (i > 0) {
        terrain[sec.entryDoorY][sec.entryDoorX] = step.doorwayTile;
      }

      const rewardSpot = this.buildIntegratedSectorWing(
        sec,
        step.vaultArchetype,
        terrain,
        items,
        entities,
        trapLinks,
        cloneLinks,
        levelNumber + i
      );

      if (step.rewardTerrain) {
        terrain[rewardSpot.y][rewardSpot.x] = step.rewardTerrain;
        items[rewardSpot.y][rewardSpot.x] = null;
      } else if (step.rewardItem) {
        items[rewardSpot.y][rewardSpot.x] = step.rewardItem;
      }
    }

    // Chamber 8: Final Sanctum gated by Socket (requires 100% of all chips)
    const finalSec = orderedSectors[8];
    terrain[finalSec.entryDoorY][finalSec.entryDoorX] = 'socket';
    this.buildFinalSanctumWing(finalSec, terrain, items, entities);

    let totalChips = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (items[y][x] === 'chip') {
          totalChips++;
        }
      }
    }

    const topologyTitleKeys: Record<MapTopology, string> = {
      ASYMMETRIC_COMPLEX: 'levels.procedural.asymmetric_complex.title',
      SPIRAL_CITADEL: 'levels.procedural.spiral_citadel.title',
      GRAND_CANAL: 'levels.procedural.grand_canal.title',
      TELEPORT_ARCHIPELAGO: 'levels.procedural.teleport_archipelago.title',
      MECHANICAL_FOUNDRY: 'levels.procedural.mechanical_foundry.title'
    };

    return {
      id: `proc_level_${levelNumber}`,
      number: levelNumber,
      titleKey: topologyTitleKeys[topology],
      hintKey: 'levels.procedural.default.hint',
      password: this.generatePassword(levelNumber),
      timeLimitSeconds: 260 + levelNumber * 10,
      chipsRequired: Math.max(1, totalChips),
      playerStart: { x: startX, y: startY, dir: 'E' },
      terrain,
      items,
      entities,
      trapLinks,
      cloneLinks
    };
  }

  private static buildIntegratedSectorWing(
    sec: SectorNode,
    archetype: VaultArchetype,
    terrain: string[][],
    items: (string | null)[][],
    entities: EntityPlacement[],
    trapLinks: TrapLink[],
    cloneLinks: CloneLink[],
    seed: number
  ): { x: number; y: number } {
    const { x0, y0, x1, y1 } = sec;
    const px = x0 + 2;
    const py = y0 + 2;

    // Single-thickness L-partition walls T-junctioning into y1+1 and x1+1
    for (let yy = py; yy <= y1; yy++) {
      terrain[yy][px] = 'wall';
    }
    for (let xx = px; xx <= x1; xx++) {
      terrain[py][xx] = 'wall';
    }

    // Eliminate dead-end West corridor when there is no South doorway:
    // seal the corridor at y = py and annex (x0..x0+1, py+1..y1) into the room as a West Alcove
    if (!sec.doors.S) {
      terrain[py][x0] = 'wall';
      terrain[py][x0 + 1] = 'wall';
    }

    const annexWestAlcove = (doorY: number): void => {
      if (!sec.doors.S) {
        terrain[doorY][px] = 'dirt';
        if (y1 - py >= 4) {
          terrain[py + 2][x0] = 'wall';
        }
      }
    };

    switch (archetype) {
      case 'bomb_defusal_lab': {
        const midY = py + 3;
        const midX = px + 3;
        for (let xx = px; xx <= x1; xx++) {
          terrain[midY][xx] = 'wall';
        }
        for (let yy = midY; yy <= y1; yy++) {
          terrain[yy][midX] = 'wall';
        }

        terrain[py][px + 2] = 'floor';
        items[py][px + 2] = 'bomb';
        entities.push({ x: px + 2, y: py - 1, type: 'dirt_block', dir: 'S' });

        terrain[midY][px + 1] = 'dirt';
        terrain[y1 - 1][midX] = 'dirt';

        items[py + 1][x1 - 1] = 'chip';
        items[y1][px + 1] = 'chip';
        terrain[y1 - 1][x1 - 1] = 'gravel';
        annexWestAlcove(py + 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'ice_ricochet_arena': {
        const divX = px + 4;
        for (let yy = py + 1; yy <= y1; yy++) {
          for (let xx = px + 1; xx <= x1; xx++) {
            if (xx <= px + 3 && yy <= py + 3) {
              terrain[yy][xx] = 'ice';
            } else if (xx === divX || (xx <= px + 3 && yy === py + 4)) {
              terrain[yy][xx] = 'wall';
            } else {
              terrain[yy][xx] = 'floor';
            }
          }
        }
        terrain[py][px + 3] = 'ice';
        terrain[py + 1][px + 3] = 'floor';
        terrain[py + 2][px + 2] = 'wall';

        terrain[py + 1][px + 1] = 'ice_nw';
        terrain[py + 3][px + 1] = 'ice_sw';
        terrain[py + 3][px + 3] = 'ice_se';

        // Connect ice hub (px+3, py+1) to East Treasure Vault via dirt lock at (divX, py+1)
        terrain[py + 1][divX] = 'dirt';
        if (y1 >= py + 5) {
          terrain[py + 4][px + 2] = 'dirt';
        }

        items[py + 1][px + 2] = 'chip';
        items[py + 3][px + 2] = 'chip';
        annexWestAlcove(y1 - 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'sokoban_canal': {
        const riverY = py + 2;
        for (let xx = px + 1; xx <= x1; xx++) {
          terrain[riverY][xx] = 'water';
        }
        const midX = px + 3;
        for (let yy = riverY + 1; yy <= y1; yy++) {
          terrain[yy][midX] = 'wall';
        }
        terrain[y1 - 1][midX] = 'dirt';

        terrain[py][px + 2] = 'water';
        terrain[py + 1][px + 2] = 'dirt';
        terrain[riverY][px + 2] = 'gravel';
        entities.push({ x: px + 2, y: py - 1, type: 'dirt_block', dir: 'S' });

        items[py + 1][x1 - 1] = 'chip';
        items[y1][px + 1] = 'chip';
        annexWestAlcove(y1 - 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'mirage_labyrinth': {
        for (let yy = py; yy <= y1; yy++) {
          terrain[yy][px] = 'blue_wall_real';
        }
        for (let xx = px; xx <= x1; xx++) {
          terrain[py][xx] = 'blue_wall_real';
        }
        const midY = py + 2;
        const midX = px + 3;
        for (let xx = px + 1; xx <= x1; xx++) {
          terrain[midY][xx] = 'blue_wall_real';
        }
        for (let yy = py + 1; yy <= y1; yy++) {
          terrain[yy][midX] = 'blue_wall_real';
        }

        terrain[py + 1][px] = 'blue_wall_fake';
        terrain[py + 1][midX] = 'blue_wall_fake';
        terrain[midY][px + 1] = 'blue_wall_fake';
        terrain[y1 - 1][midX] = 'blue_wall_fake';

        if (!sec.doors.S) {
          terrain[py][x0] = 'floor';
          terrain[py][x0 + 1] = 'floor';
        }

        items[py + 1][x1] = 'chip';
        items[y1][px + 1] = 'chip';
        entities.push({
          x: x1,
          y: y0 + 1,
          type: seed % 2 === 0 ? 'bug' : 'paramecium',
          dir: 'W'
        });
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'dirt_excavation_tunnels': {
        const midY = py + 3;
        const midX = px + 3;
        for (let xx = px + 1; xx <= x1; xx++) {
          terrain[midY][xx] = 'wall';
        }
        for (let yy = py + 1; yy <= y1; yy++) {
          terrain[yy][midX] = 'wall';
        }

        // Carve compacted dirt seams connecting the 3 subterranean chambers
        terrain[py][px + 2] = 'dirt';
        terrain[py + 1][px + 2] = 'dirt';
        terrain[py + 2][px + 2] = 'dirt';
        terrain[py + 1][midX] = 'dirt';
        terrain[py + 1][midX + 1] = 'dirt';
        terrain[midY][px + 1] = 'dirt';
        terrain[midY + 1][px + 1] = 'dirt';
        terrain[y1 - 1][midX] = 'dirt';
        terrain[y1 - 1][midX + 1] = 'dirt';

        items[py + 1][x1 - 1] = 'chip';
        items[y1 - 1][px + 1] = 'chip';
        annexWestAlcove(py + 1);
        entities.push({ x: x1, y: y0 + 1, type: 'walker', dir: 'W' });
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'conveyor_slalom': {
        for (let yy = py + 1; yy <= y1; yy++) {
          for (let xx = px + 1; xx <= x1; xx++) {
            terrain[yy][xx] = 'gravel';
          }
        }
        terrain[py][px + 1] = 'gravel';

        for (let xx = px + 1; xx < x1; xx++) terrain[py + 1][xx] = 'force_e';
        for (let yy = py + 1; yy < y1; yy++) terrain[yy][x1] = 'force_s';
        for (let xx = px + 2; xx <= x1; xx++) terrain[y1][xx] = 'force_w';
        for (let yy = py + 2; yy <= y1; yy++) terrain[yy][px + 1] = 'force_n';

        terrain[py + 2][px + 3] = 'wall';
        if (y1 - py >= 5) {
          terrain[py + 4][px + 3] = 'wall';
        }

        items[py + 2][x1 - 1] = 'chip';
        items[y1 - 1][px + 2] = 'chip';
        annexWestAlcove(py + 2);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'trap_brown_vault': {
        // Divided into West Control Room (px+1..px+2) and East Treasure Vault (px+4..x1)
        const midX = px + 3;
        for (let yy = py; yy <= y1; yy++) {
          terrain[yy][midX] = 'wall';
        }
        // Enter West Control Room via dirt lock at (px + 1, py)
        terrain[py][px + 1] = 'dirt';
        // Push dirt_block at (px + 1, py + 2) South onto button_brown at (px + 1, py + 3)
        entities.push({ x: px + 1, y: py + 2, type: 'dirt_block', dir: 'S' });
        terrain[py + 3][px + 1] = 'button_brown';

        // Bear trap guarding East Treasure Vault at (px + 4, py)
        terrain[py][px + 4] = 'trap';
        trapLinks.push({
          buttonX: px + 1,
          buttonY: py + 3,
          trapX: px + 4,
          trapY: py
        });

        items[y1 - 1][px + 2] = 'chip';
        items[py + 1][x1 - 1] = 'chip';
        annexWestAlcove(y1 - 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'cloner_red_vault': {
        // Clone Machine Factory: press button_red to spawn dirt_blocks and bridge the water river
        const riverY = py + 3;
        for (let xx = px + 1; xx <= x1; xx++) {
          terrain[riverY][xx] = 'water';
        }
        terrain[py][px + 1] = 'gravel';
        terrain[py + 1][px + 1] = 'button_red';
        terrain[py + 1][px + 3] = 'clone_machine';
        terrain[py + 2][px + 3] = 'force_s';
        entities.push({ x: px + 3, y: py + 1, type: 'dirt_block', dir: 'S' });
        cloneLinks.push({
          buttonX: px + 1,
          buttonY: py + 1,
          clonerX: px + 3,
          clonerY: py + 1,
          templateType: 'dirt_block',
          templateDir: 'S'
        });

        items[py + 1][x1 - 1] = 'chip';
        items[y1 - 1][px + 1] = 'chip';
        annexWestAlcove(py + 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'teleport_vault': {
        // Divided into North Departure Chamber (py+1..py+2) and 100% sealed South Quantum Vault (py+4..y1)
        const midY = py + 3;
        for (let xx = px + 1; xx <= x1; xx++) {
          terrain[midY][xx] = 'wall';
        }
        terrain[py][px + 1] = 'dirt';

        // Both teleporters are inside chambers with open floor tiles on multiple cardinal sides
        terrain[py + 1][px + 2] = 'teleport';
        terrain[y1 - 1][px + 2] = 'teleport';

        items[py + 1][x1 - 1] = 'chip';
        items[y1 - 1][px + 1] = 'chip';
        annexWestAlcove(py + 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'glider_lagoon': {
        for (let yy = py + 1; yy <= y1; yy++) {
          for (let xx = px + 1; xx <= x1; xx++) {
            terrain[yy][xx] = 'water';
          }
        }
        terrain[py][px + 2] = 'water';
        terrain[py + 2][px + 2] = 'wall';
        if (x1 - px >= 6 && y1 - py >= 5) {
          terrain[y1 - 1][x1 - 2] = 'wall';
        }

        items[py + 2][x1 - 1] = 'chip';
        items[y1 - 1][px + 2] = 'chip';
        entities.push({ x: px + 1, y: py + 1, type: 'glider', dir: 'E' });
        annexWestAlcove(py + 1);
        return { x: x1 - 1, y: y1 - 1 };
      }

      case 'fireball_foundry': {
        for (let yy = py + 1; yy <= y1; yy++) {
          for (let xx = px + 1; xx <= x1; xx++) {
            terrain[yy][xx] = 'fire';
          }
        }
        terrain[py][px + 2] = 'fire';
        terrain[py + 2][px + 2] = 'wall';
        if (x1 - px >= 6 && y1 - py >= 5) {
          terrain[y1 - 1][x1 - 2] = 'wall';
        }

        items[py + 2][x1 - 1] = 'chip';
        items[y1 - 1][px + 2] = 'chip';
        entities.push({ x: px + 1, y: py + 1, type: 'fireball', dir: 'E' });
        annexWestAlcove(py + 1);
        return { x: x1 - 1, y: y1 - 1 };
      }
    }
  }

  private static buildFinalSanctumWing(
    sec: SectorNode,
    terrain: string[][],
    items: (string | null)[][],
    entities: EntityPlacement[]
  ): void {
    const { x0, y0, x1, y1 } = sec;
    const px = x0 + 2;
    const py = y0 + 2;

    for (let yy = py; yy <= y1; yy++) {
      terrain[yy][px] = 'wall';
    }
    for (let xx = px; xx <= x1; xx++) {
      terrain[py][xx] = 'wall';
    }
    if (!sec.doors.S) {
      terrain[py][x0] = 'wall';
      terrain[py][x0 + 1] = 'wall';
      terrain[py + 1][px] = 'dirt';
    }

    // Divide Final Sanctum into Outer Guardian Courtyard and Inner Exit Shrine
    const midY = py + 3;
    for (let xx = px + 1; xx <= x1; xx++) {
      terrain[midY][xx] = 'blue_wall_real';
    }
    terrain[midY][px + 3] = 'dirt';

    for (let xx = px + 1; xx <= px + 3; xx++) {
      terrain[py + 1][xx] = 'gravel';
      terrain[py + 2][xx] = 'gravel';
    }

    terrain[py][px + 2] = 'socket';
    terrain[y1 - 1][x1 - 1] = 'exit';
    items[y1 - 1][x1 - 1] = null;
    entities.push({ x: x1, y: y0 + 1, type: 'teeth', dir: 'W' });
  }

  private static shuffleArray<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randInt(0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  private static generatePassword(seed: number): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let n = (seed * 7919 + 104729) >>> 0;
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += alphabet[n % alphabet.length];
      n = Math.floor(n / alphabet.length);
    }
    return out;
  }

  private static randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
