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
 * The Chip's Challenge 2 track cells (terrain `rail_junction`). The rules follow Lexy's Labyrinth
 * (js/tiletypes.js: `railroad`, `railroad_sign`; js/game.js: `can_actor_leave_cell`; js/format-c2g.js: the railroad
 * modifier). A cell holds up to six track segments (north-east, south-east, south-west, north-west, east-west,
 * north-south); a cell with a switch has one active segment and only that one is open.
 *
 * - An actor may enter only through a side an open segment touches (`blocks`).
 * - It leaves only along an open segment that joins the side it came in by; stepping straight back out of the side it
 *   came in by is refused, except for blocks, which may back out (`blocks_leaving`, `can_reverse_on_railroad`).
 * - A step that cannot leave is turned: the same direction, then right, left and back are tried in that order
 *   (`redirect_exit`). Only the player and the blocks the player pushes are redirected here; a monster chooses among its
 *   own turns, which already exclude what the track forbids.
 * - A switch advances to the next segment of the cell when an actor leaves along the active segment, unless the
 *   cell is wired; a wire pulse or a gray button advances it too (`on_depart`, `on_power`, `on_gray_button`).
 * - The holder of the railroad sign ignores all of this (`trackproof`).
 *
 * Nothing here runs on a level without track cells: `w.railCells` is empty then.
 */

import { AudioManager } from '../../audio/AudioManager';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import {
  OPPOSITE_DIRECTION,
  RAILROAD_SIGN_ITEM_ID,
  RAIL_DEFAULT_ENTRY,
  RAIL_TRACK_COUNT,
  RAIL_TRACK_SIDES
} from '../coreConstants';
import type { Direction } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

/** How an actor meets the tracks: a walker obeys them, a block may also back out, the railroad sign holder ignores them. */
export type RailActor = 'walker' | 'block' | 'railproof';

/** Value of `active` on a track cell without a switch. */
export const RAIL_NO_SWITCH = -1;

/** The state of one track cell while a level plays. */
export interface RailCellState {
  /** The track segments the cell holds, one bit per segment (see RAIL_TRACK_SIDES). */
  mask: number;
  /** The one open segment of a cell with a switch (0 to 5); RAIL_NO_SWITCH when the cell has none. */
  active: number;
  /** The side the last actor came in by. */
  entry: Direction;
}

/** The side clockwise of each side, and the side counter-clockwise: the right and the left of a move in that direction. */
const RIGHT_OF: Readonly<Record<Direction, Direction>> = { N: 'E', E: 'S', S: 'W', W: 'N' };
const LEFT_OF: Readonly<Record<Direction, Direction>> = { N: 'W', W: 'S', S: 'E', E: 'N' };

/** Sound played when a track switch moves. */
const SWITCH_SFX = 'door';

function widthOf(w: EpoxyWorld): number {
  return w.terrain[0]?.length ?? 0;
}

/**
 * Reads the track cells of the level into the world: every cell of terrain `rail_junction` gets a state, from its
 * `railTracks` entry when the level has one (a cell with none holds no track and lets nobody in).
 */
export function buildRailCells(w: EpoxyWorld): void {
  w.railCells.clear();
  const width = widthOf(w);
  const listed = new Map<number, { mask: number; active?: number; entry?: Direction }>();
  for (const cell of w.level.railTracks ?? []) listed.set(cell.y * width + cell.x, cell);
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < width; x++) {
      if (ConfigRegistry.getTile(w.terrain[y][x]).railJunction !== true) continue;
      const entry = listed.get(y * width + x);
      w.railCells.set(y * width + x, {
        mask: entry?.mask ?? 0,
        active: entry?.active ?? RAIL_NO_SWITCH,
        entry: entry?.entry ?? RAIL_DEFAULT_ENTRY
      });
    }
  }
}

/** The state of the track cell at (x, y), or undefined when the cell holds no track cell now. */
function railCellAt(w: EpoxyWorld, x: number, y: number): RailCellState | undefined {
  if (w.railCells.size === 0) return undefined;
  const state = w.railCells.get(y * widthOf(w) + x);
  return state !== undefined && ConfigRegistry.getTile(w.terrain[y][x]).railJunction === true ? state : undefined;
}

/** The segments that are open now: the active one when the cell has a switch, else every segment it holds. */
function openTracks(state: RailCellState): number[] {
  if (state.active !== RAIL_NO_SWITCH) return [state.active];
  const open: number[] = [];
  for (let track = 0; track < RAIL_TRACK_COUNT; track++) if ((state.mask & (1 << track)) !== 0) open.push(track);
  return open;
}

/** Whether an open segment touches the side. */
function opensSide(state: RailCellState, side: Direction): boolean {
  return openTracks(state).some((track) => RAIL_TRACK_SIDES[track].includes(side));
}

/** The kind of actor the player is: a holder of the railroad sign ignores the tracks. */
export function playerRailActor(w: EpoxyWorld): RailActor {
  return w.player.boots.has(RAILROAD_SIGN_ITEM_ID) ? 'railproof' : 'walker';
}

/** Whether a track cell refuses an actor that would step out of it towards `dir` (see the module comment). */
function leaveRefused(state: RailCellState, dir: Direction, actor: RailActor): boolean {
  if (actor === 'railproof') return false;
  if (dir === state.entry) return actor !== 'block';
  return !openTracks(state).some((track) => {
    const [a, b] = RAIL_TRACK_SIDES[track];
    return (a === state.entry && b === dir) || (b === state.entry && a === dir);
  });
}

/**
 * Whether the tracks stop a step from (fromX, fromY) to the adjacent (toX, toY) in `dir`: the cell left refuses to let
 * the actor out that way, or the cell entered has no open segment on the side the actor would come in by.
 */
export function railEdgeBlocked(
  w: EpoxyWorld,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dir: Direction,
  actor: RailActor
): boolean {
  if (actor === 'railproof' || w.railCells.size === 0) return false;
  const from = railCellAt(w, fromX, fromY);
  if (from !== undefined && leaveRefused(from, dir, actor)) return true;
  const to = railCellAt(w, toX, toY);
  return to !== undefined && !opensSide(to, OPPOSITE_DIRECTION[dir]);
}

/**
 * The direction an actor standing on a track cell really moves when it tries `dir`: `dir` itself when the cell lets it
 * out that way, else the first of right, left and back that it lets out; `dir` again when none does (the step then fails
 * where it was going to). A cell that is not a track cell, or an actor that ignores the tracks, changes nothing.
 */
export function railRedirect(w: EpoxyWorld, x: number, y: number, dir: Direction, actor: RailActor): Direction {
  if (actor === 'railproof') return dir;
  const state = railCellAt(w, x, y);
  if (state === undefined) return dir;
  for (const candidate of [dir, RIGHT_OF[dir], LEFT_OF[dir], OPPOSITE_DIRECTION[dir]]) {
    if (!leaveRefused(state, candidate, actor)) return candidate;
  }
  return dir;
}

/** An actor arrived in the cell by moving `dir`: a track cell remembers the side it came in by. */
export function enterRail(w: EpoxyWorld, x: number, y: number, dir: Direction): void {
  const state = railCellAt(w, x, y);
  if (state !== undefined) state.entry = OPPOSITE_DIRECTION[dir];
}

/** Whether a signal link ends on the cell: a wired switch moves by wire only. */
function isWiredCell(w: EpoxyWorld, cell: number): boolean {
  const runtime = w.signals;
  if (runtime === undefined) return false;
  return runtime.network.sinkIndexes.some((index) => runtime.network.nodes[index].cell === cell);
}

/** Moves the switch of the track cell at (x, y) to its next segment; a cell without a switch does nothing. */
export function advanceRailSwitch(w: EpoxyWorld, x: number, y: number): void {
  const state = railCellAt(w, x, y);
  if (state === undefined || state.active === RAIL_NO_SWITCH) return;
  let next = state.active;
  for (let step = 0; step < RAIL_TRACK_COUNT; step++) {
    next = (next + 1) % RAIL_TRACK_COUNT;
    if ((state.mask & (1 << next)) !== 0) break;
  }
  state.active = next;
  AudioManager.playSfx(SWITCH_SFX);
}

/**
 * An actor is about to leave the cell by `exit`: a track cell with a switch moves on to its next segment when the side the
 * actor came in by and the exit both lie on the active segment, unless the cell is wired.
 */
export function leaveRail(w: EpoxyWorld, x: number, y: number, exit: Direction): void {
  const state = railCellAt(w, x, y);
  if (state === undefined || state.active === RAIL_NO_SWITCH) return;
  if (isWiredCell(w, y * widthOf(w) + x)) return;
  const sides = RAIL_TRACK_SIDES[state.active];
  if (sides.includes(state.entry) && sides.includes(exit)) advanceRailSwitch(w, x, y);
}

/** The state of the track cells for a snapshot: [cell index, active segment, entry side], by cell; empty without track cells. */
export function railStateOf(w: EpoxyWorld): [number, number, Direction][] {
  return [...w.railCells].sort((a, b) => a[0] - b[0]).map(([cell, state]) => [cell, state.active, state.entry]);
}

/** Puts the track cell state of a snapshot back; the masks are static and stay as built at load. */
export function restoreRailState(w: EpoxyWorld, saved: readonly [number, number, Direction][] | undefined): void {
  for (const [cell, active, entry] of saved ?? []) {
    const state = w.railCells.get(cell);
    if (state === undefined) continue;
    state.active = active;
    state.entry = entry;
  }
}

/** The search state key of the track cells: the active segment and the entry side of each, by cell; empty without track cells. */
export function railStateKey(w: EpoxyWorld): string {
  return railStateOf(w)
    .map(([cell, active, entry]) => `${cell}:${active}${entry}`)
    .join(',');
}
