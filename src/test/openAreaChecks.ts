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
import { ORDERED_DIRECTIONS } from '../config/constants';
import { GeneratedLevel } from '../core/ProceduralGenerator';
import { GridPoint } from '../core/types';
import { isPlayerWalkable } from '../core/Walkability';

/** Fewest chips an endless hub level scatters over its open area. */
const MIN_OPEN_CHIPS = 3;

const key = (width: number, p: GridPoint): number => p.y * width + p.x;
const step = (p: GridPoint, d: string): GridPoint => ({
  x: p.x + (d === 'E' ? 1 : d === 'W' ? -1 : 0),
  y: p.y + (d === 'S' ? 1 : d === 'N' ? -1 : 0)
});

/**
 * Every rule of the hub open area that holds level by level, as a list of
 * violations (empty when the level is sound). One definition for the unit
 * test and the metrics report, so the 8-level test sample and the 40-level
 * report sample check the same things.
 */
export function openAreaViolations(generated: GeneratedLevel): string[] {
  const cfg = ConfigRegistry.getGame().procedural;
  if (!cfg) throw new Error('game.json has no procedural section');
  const { level, pieceBoxes, open } = generated;
  const id = level.id;
  if (!open) return [`${id}: no open area`];
  const problems: string[] = [];
  const width = level.terrain[0].length;
  const region = new Set(open.region.map((c) => key(width, c)));

  const monsterEntities = level.entities.filter((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster');
  if (monsterEntities.length > cfg.maxMonstersPerLevel) problems.push(`${id}: monsters over the cap`);
  if (open.monsters.length > cfg.hub.openMonsters.max) problems.push(`${id}: too many hub monsters`);
  for (const m of open.monsters) {
    if (!cfg.hub.openMonsters.types.includes(m.type)) problems.push(`${id}: ${m.type} is not a deterministic mover`);
    if (!region.has(key(width, m))) problems.push(`${id}: ${m.type} starts outside the region`);
    if (!level.entities.some((e) => e.x === m.x && e.y === m.y && e.type === m.type)) {
      problems.push(`${id}: ${m.type} missing from the entities`);
    }
  }

  if (open.chips.length < MIN_OPEN_CHIPS) problems.push(`${id}: fewer than ${MIN_OPEN_CHIPS} open chips`);
  for (const c of open.chips) {
    if (ConfigRegistry.getTile(level.items[c.y][c.x] ?? '').collectible !== 'chip') problems.push(`${id}: no chip at ${c.x},${c.y}`);
  }
  const placed = level.items.flat().filter((item) => item && ConfigRegistry.getTile(item).collectible === 'chip').length;
  if (level.chipsRequired !== placed) problems.push(`${id}: chipsRequired ${level.chipsRequired} for ${placed} chips`);

  // No monster can leave the region, whatever its starting cell.
  for (const monster of open.monsters) {
    const def = ConfigRegistry.getEntityDef(monster.type);
    const enter = (p: GridPoint): boolean => {
      if (p.x < 0 || p.y < 0 || p.y >= level.terrain.length || p.x >= width) return false;
      const tile = ConfigRegistry.getTile(level.terrain[p.y][p.x]);
      return Boolean(tile.passableByMonster) || (tile.hazard === 'fire' && Boolean(def?.immuneToFire));
    };
    const seen = new Set<number>([key(width, monster)]);
    const queue: GridPoint[] = [monster];
    for (let i = 0; i < queue.length; i++) {
      for (const d of ORDERED_DIRECTIONS) {
        const n = step(queue[i], d);
        if (seen.has(key(width, n)) || !enter(n)) continue;
        seen.add(key(width, n));
        queue.push(n);
      }
    }
    for (const k of seen) {
      const cell = { x: k % width, y: Math.floor(k / width) };
      if (!region.has(k)) problems.push(`${id}: ${monster.type} reaches ${cell.x},${cell.y} outside the region`);
      if (pieceBoxes.some((b) => cell.x >= b.x0 && cell.x <= b.x1 && cell.y >= b.y0 && cell.y <= b.y1)) {
        problems.push(`${id}: ${monster.type} reaches a piece at ${cell.x},${cell.y}`);
      }
    }
  }

  // Gravel on every region cell that touches player ground outside the region.
  const apron = cfg.hub.apronTerrain;
  if (open.aprons.length === 0) problems.push(`${id}: no apron`);
  for (const cell of open.region) {
    const leaks = ORDERED_DIRECTIONS.some((d) => {
      const n = step(cell, d);
      return !region.has(key(width, n)) && isPlayerWalkable(ConfigRegistry.getTile(level.terrain[n.y][n.x]));
    });
    if (leaks && level.terrain[cell.y][cell.x] !== apron) problems.push(`${id}: no gravel at ${cell.x},${cell.y}`);
  }

  // Trap and clone links stay out of the region.
  for (const l of level.trapLinks) {
    if (region.has(key(width, { x: l.buttonX, y: l.buttonY })) || region.has(key(width, { x: l.trapX, y: l.trapY }))) {
      problems.push(`${id}: trap link in the region`);
    }
  }
  for (const l of level.cloneLinks) {
    if (region.has(key(width, { x: l.buttonX, y: l.buttonY })) || region.has(key(width, { x: l.clonerX, y: l.clonerY }))) {
      problems.push(`${id}: clone link in the region`);
    }
  }

  // Patches stay off the lanes, and on foot every bare region cell stays reachable.
  const lanes = new Set(open.lanes.map((c) => key(width, c)));
  const hazards = new Set(open.hazards.map((c) => key(width, c)));
  for (const h of open.hazards) {
    if (!['fire', 'water'].includes(level.terrain[h.y][h.x])) problems.push(`${id}: odd hazard at ${h.x},${h.y}`);
    if (lanes.has(key(width, h))) problems.push(`${id}: hazard on a lane at ${h.x},${h.y}`);
  }
  const bare = (p: GridPoint): boolean => region.has(key(width, p)) && !hazards.has(key(width, p)) && !level.items[p.y][p.x];
  const start = { x: level.playerStart.x, y: level.playerStart.y };
  const seen = new Set<number>([key(width, start)]);
  const queue: GridPoint[] = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const d of ORDERED_DIRECTIONS) {
      const n = step(queue[i], d);
      if (seen.has(key(width, n)) || !bare(n)) continue;
      seen.add(key(width, n));
      queue.push(n);
    }
  }
  if (seen.size !== open.region.filter((c) => bare(c)).length) problems.push(`${id}: bare region cells unreachable on foot`);
  return problems;
}
