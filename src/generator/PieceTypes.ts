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

import { CloneLink, Direction, EntityPlacement, GridPoint, TrapLink } from '../core/types';

/**
 * One legend character of motifs.json. It extends the levels.json legend: a
 * character may also place an entity (a block, a monster) or mark a port,
 * the cell where the player enters or leaves the piece.
 */
export interface PieceLegendEntry {
  terrain: string;
  item?: string;
  entity?: string;
  entityDir?: Direction;
  port?: 'entry' | 'exit';
}

/**
 * A hand-drawn piece of a level, built around one motif (key and door,
 * fire and boots, block into water...). The player comes in through the
 * entry port carrying the items in `requires`, collects every chip inside,
 * and leaves through the exit port. Coordinates in entities and links are
 * local to the rows.
 */
export interface PieceDefinition {
  id: string;
  motif: string;
  /** 1 introduces the mechanic, higher tiers combine or twist it. */
  tier: number;
  rows: string[];
  /** Items the player must bring in from elsewhere in the level. */
  requires?: string[];
  /** Whether the generator may rotate and mirror the piece. */
  rotatable?: boolean;
  /**
   * The piece can be left unfinished for good (its twist is an irreversible
   * choice, like walking past a thief too early). Kept out of early levels.
   */
  oneShot?: boolean;
  entities?: EntityPlacement[];
  trapLinks?: TrapLink[];
  cloneLinks?: CloneLink[];
  /** Where an adapted piece comes from (collection, author), kept for attribution. */
  credit?: string;
}

/**
 * Level-wide rules of a motif. Teleporters and toggle walls act on the whole
 * map, so two such pieces in one level would interfere: maxPerLevel caps
 * them. Role pieces are not puzzles: the finale closes every level (socket,
 * then exit) and rest rooms pace the puzzles out.
 */
export interface MotifRule {
  maxPerLevel?: number;
  /** finale: closes every level. rest: an open chip room placed between puzzles. */
  role?: 'finale' | 'rest';
}

/**
 * Facts about a piece computed offline by npm run annotate:pieces and checked
 * by the tests: a winning action list (N, E, S, W, and '.' to wait) and
 * whether every winning state can walk back out. The generator reads them
 * instead of searching again in the browser.
 */
export interface PieceAnnotation {
  solution: string;
  reversible: boolean;
}

export type MotifAnnotations = Record<string, PieceAnnotation>;

export interface MotifsConfig {
  legend: Record<string, PieceLegendEntry>;
  /**
   * Terrain given to the ports of a piece holding monsters: one the player
   * crosses and monsters cannot, so monsters stay in their piece.
   */
  monsterPortTerrain: string;
  motifRules?: Record<string, MotifRule>;
  pieces: PieceDefinition[];
}

/** A piece parsed into grids, ready to be transformed, solved or placed. */
export interface CompiledPiece {
  id: string;
  motif: string;
  tier: number;
  width: number;
  height: number;
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  entry: GridPoint;
  exit: GridPoint;
  requires: string[];
  rotatable: boolean;
  oneShot: boolean;
  /** Precomputed winning actions, already turned with the piece. */
  solution?: Array<Direction | 'WAIT'>;
  /** Precomputed: every winning state can walk back out through the entry. */
  reversible?: boolean;
  /** Orientation applied to the definition's rows. */
  orientation: PieceOrientation;
}

/** A rotation by quarter turns clockwise, optionally after a left-right mirror. */
export interface PieceOrientation {
  quarterTurns: 0 | 1 | 2 | 3;
  mirrored: boolean;
}
