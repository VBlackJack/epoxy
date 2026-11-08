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

import type { Direction } from '../types';
import { cc3dLevel } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { convertCc3dLevel } from './cc3dToEpoxy';
import { DifferentialPair, epoxyIdOf } from './cc3dToEpoxyDifferential';
import type { DiffMismatch } from './cc3dToEpoxyDifferential';
import { normalizeCell } from './model';
import type { Cc3dColor, Cc3dTerrain } from './model';

/**
 * Test support for the coverage evidence tests: a scenario is a tiny CC3D map, a string of moves, and the glyphs
 * the map uses; it is played move by move on the CC3D engine and on its conversion, and the two are compared after
 * every move (player, level state, terrain, items, blocks and monsters).
 */

const SEED = 1;
const MOVE_LETTERS = 'NESW';
/** Ticks both engines run after the last move, so that slides and releases have finished. */
const FINAL_REST_TICKS = 60;

export interface EvidenceScenario {
  rows: string[];
  glyphs?: Record<string, GlyphMeaning>;
  /** One letter per move: N, E, S or W. A move into a wall just lets time pass. */
  moves: string;
  /** Also compare the blocks and monsters (the default); false when a monster kind has no distinct Epoxy twin. */
  compareEntities?: boolean;
}

export interface EvidenceOutcome {
  pair: DifferentialPair;
  /** The first disagreement, or null when the engines agreed after every move. */
  mismatch: DiffMismatch | null;
}

/** Surrounds the rows with a wall, padding short rows with wall: write only the interior of the room. */
export function room(...inner: string[]): string[] {
  const width = Math.max(...inner.map((row) => row.length));
  const wall = '#'.repeat(width + 2);
  return [wall, ...inner.map((row) => `#${row.padEnd(width, '#')}#`), wall];
}

/** A cell stack in class order (floor-like base, devices, blockers), the way a level file stores it. */
export function stack(...layers: Cc3dTerrain[]): GlyphMeaning {
  return { stack: normalizeCell(layers) };
}

/** A cell holding a device or blocker over plain floor. */
export function device(kind: Cc3dTerrain['kind'], extra: Partial<Cc3dTerrain> = {}): GlyphMeaning {
  return stack({ kind, ...extra });
}

/** A cell with a block or monster standing on a given stack. */
export function withMob(meaning: GlyphMeaning, mob: NonNullable<GlyphMeaning['mob']>): GlyphMeaning {
  return { ...meaning, mob };
}

/** A pressure plate of a colour. */
export function plate(color: Cc3dColor): GlyphMeaning {
  return device('plate', { color });
}

/** A hold door of a colour, closed. */
export function holdDoor(color: Cc3dColor): GlyphMeaning {
  return device('hold_door', { color, open: false });
}

/** Plays a scenario; stops at the first disagreement. */
export function playScenario(scenario: EvidenceScenario): EvidenceOutcome {
  const source = cc3dLevel(scenario.rows, { glyphs: scenario.glyphs });
  const converted = convertCc3dLevel(source).level;
  const pair = new DifferentialPair(source, converted, SEED);
  const compare = (): DiffMismatch | null => pair.compare({ entities: scenario.compareEntities !== false, items: true });
  const initial = compare();
  if (initial) return { pair, mismatch: initial };
  for (const letter of scenario.moves) {
    if (!MOVE_LETTERS.includes(letter)) throw new Error(`Unknown move letter "${letter}"`);
    if (pair.ended) break;
    pair.step(letter as Direction);
    const mismatch = compare();
    if (mismatch) return { pair, mismatch };
  }
  // Let a block that is still sliding, or a clone on its way, come to rest in both engines before the last look.
  if (!pair.ended) {
    for (let i = 0; i < FINAL_REST_TICKS; i++) {
      pair.rig.tick(1);
      pair.epoxy.tick();
    }
    const mismatch = compare();
    if (mismatch) return { pair, mismatch };
  }
  return { pair, mismatch: null };
}

/** Ticks a timeline runs for, long enough for a monster to cross a small room several times. */
export const TIMELINE_TICKS = 240;
/** Ticks between two presses of a timeline: enough for either engine to finish a step. */
const PRESS_SPACING_TICKS = 16;

/** One engine's run: what moved (blocks, monsters, the player) and what the terrain went through, in order. */
export interface EngineTimeline {
  /** Blocks and monsters (type and cell), the player's cell and life, collapsed to the changes. */
  bodies: string[];
  /** The terrain grid, collapsed to the changes. */
  terrain: string[];
  /** The last state of both, joined. */
  final: string;
}

/** What the two engines went through, collapsed so that pace does not count. */
export interface EvidenceTimeline {
  cc3d: EngineTimeline;
  epoxy: EngineTimeline;
  pair: DifferentialPair;
  /** Same bodies and same terrain changes, in the same order. */
  sameSequence: boolean;
  /** Same last state, whatever happened on the way. */
  sameFinal: boolean;
}

function collapse(frames: readonly string[]): string[] {
  return frames.filter((frame, index) => index === 0 || frame !== frames[index - 1]);
}

function timelineOf(bodies: readonly string[], terrain: readonly string[]): EngineTimeline {
  return {
    bodies: collapse(bodies),
    terrain: collapse(terrain),
    final: `${bodies[bodies.length - 1]} ${terrain[terrain.length - 1]}`
  };
}

/**
 * Plays both engines tick by tick and records the state each time it changes. The player presses `presses` (one
 * letter per press, every PRESS_SPACING_TICKS ticks, the first at tick 1) and otherwise stands still. Two
 * timelines that are equal went through the same states in the same order, whatever the pace of each engine.
 */
export function playTimeline(scenario: EvidenceScenario, presses = '', ticks = TIMELINE_TICKS): EvidenceTimeline {
  const source = cc3dLevel(scenario.rows, { glyphs: scenario.glyphs });
  const pair = new DifferentialPair(source, convertCc3dLevel(source).level, SEED);
  const bodiesA: string[] = [];
  const bodiesB: string[] = [];
  const terrainA: string[] = [];
  const terrainB: string[] = [];
  const flat = (grid: string[][], map: (id: string) => string): string => grid.map((row) => row.map(map).join(',')).join(';');
  for (let i = 0; i <= ticks; i++) {
    // Frame 0 is the level as loaded, before any tick.
    if (i > 0) {
      const pressIndex = Math.floor((i - 1) / PRESS_SPACING_TICKS);
      if ((i - 1) % PRESS_SPACING_TICKS === 0 && pressIndex < presses.length) {
        const dir = presses[pressIndex] as Direction;
        pair.rig.press(dir);
        pair.epoxy.attemptPlayerMove(dir);
      }
      pair.rig.tick(1);
      pair.epoxy.tick();
    }
    const a = pair.rig.player;
    const b = pair.epoxy.getPlayer();
    const linesA = pair.rig.entities.map((e) => `${pair.epoxyTypeOf(e)}@${e.x},${e.y}`).sort();
    const linesB = pair.epoxy.getEntities().map((e) => `${e.type}@${e.x},${e.y}`).sort();
    bodiesA.push(`${linesA.join(' ')} P${a.x},${a.y}${a.alive ? '' : 'x'}`);
    bodiesB.push(`${linesB.join(' ')} P${b.x},${b.y}${b.alive ? '' : 'x'}`);
    terrainA.push(flat(pair.rig.engine.getTerrain(), epoxyIdOf));
    terrainB.push(flat(pair.epoxy.getTerrain(), (id) => id));
  }
  const cc3d = timelineOf(bodiesA, terrainA);
  const epoxy = timelineOf(bodiesB, terrainB);
  return {
    cc3d,
    epoxy,
    pair,
    sameSequence: JSON.stringify(cc3d.bodies) === JSON.stringify(epoxy.bodies) && JSON.stringify(cc3d.terrain) === JSON.stringify(epoxy.terrain),
    sameFinal: cc3d.final === epoxy.final
  };
}
