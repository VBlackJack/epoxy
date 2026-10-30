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

import { Direction, EntityPlacement, GridPoint } from '../core/types';
import { AssembledLevel, Box } from './LevelAssembler';
import { CompiledPiece } from './PieceTypes';

export const EXIT_TILE_ID = 'exit';
export const CHIP_ITEM_ID = 'chip';
export const MAP_MARGIN = 1;
/** Segment id of the hub floor; wings use two ids each, before and after their puzzle. */
export const HUB_SEGMENT = 0;
export const NO_SEGMENT = -1;

/** Where a guard is checked: walling `box` must cut `guarded` off from the start. */
export interface LevelGuard {
  box: Box;
  guarded: GridPoint;
}

/**
 * The open floor of a loop level's hub: the only region where monsters wander
 * outside the puzzles, and what the prover searches in time.
 */
export interface OpenArea {
  /** Every cell of the hub region, gravel aprons included. */
  region: GridPoint[];
  /** Gravel cells that close the region at gates and strip ends: the player crosses them, monsters do not. */
  aprons: GridPoint[];
  /** Monsters standing in the region at the start (also listed in the level's entities). */
  monsters: EntityPlacement[];
  /** Cells the monsters walk over, traced ahead of time. */
  lanes: GridPoint[];
  /** Chips lying in the region. */
  chips: GridPoint[];
  /** Fire and water cells in the region. */
  hazards: GridPoint[];
  /** Wall cells set into the region to cut it into lanes. */
  dividers: GridPoint[];
}

export interface AssembledHubLevel extends AssembledLevel {
  guards: LevelGuard[];
  /** Set for a loop level. */
  open?: OpenArea;
  /** Id of the hub outline used, from game.json. */
  hubShape: string;
}

/** A wing placement that fits but is not written yet: what it costs the level's density, and how to write it. */
export interface WingTrial {
  /** Bounding box growth weighed by the fill target, minus the walkable cells added: lower is better. */
  cost: number;
  commit: () => WingPlacement;
}

/** A puzzle chained after another in a loop wing, and the corridor leading to it. */
export interface ChainLink {
  piece: CompiledPiece;
  origin: GridPoint;
  /** Cells between the previous puzzle's exit and this one's entry port, the first one past the exit. */
  connector: GridPoint[];
  /** Direction of the last step, into the entry port. */
  approachDir: Direction;
  exitDir: Direction;
}

/** What makes a wing a loop: more puzzles in a chain, and the one-way way back to the hub. */
export interface LoopPlacement {
  links: ChainLink[];
  /** Cells from the one past the last puzzle's exit to the cell before the return strip. */
  tail: GridPoint[];
  /** The one-way strip, its cell in the hub's wall ring first. */
  strip: GridPoint[];
  /** Direction of a step along the strip toward the hub. */
  toHub: Direction;
}

export interface WingPlacement {
  piece: CompiledPiece;
  origin: GridPoint;
  outward: Direction;
  /** Gate cells then connector cells, from the hub outwards. */
  approach: GridPoint[];
  gateLength: number;
  exitDir: Direction;
  /** Room cells (non-final wings), the first one touching the exit port. */
  room: GridPoint[];
  /** Set for a loop wing, which has no room. */
  loop?: LoopPlacement;
  finale?: {
    piece: CompiledPiece;
    origin: GridPoint;
    /** Moves from the cell past the puzzle exit to the cell before the finale. */
    path: Direction[];
    /** Direction of the last step, into the finale's entry port. */
    approachDir: Direction;
  };
}
