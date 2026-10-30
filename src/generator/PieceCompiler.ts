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
import { decodeActions } from './PieceSolver';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { DEFAULT_FACING } from '../core/coreConstants';
import { isPlayerWalkable } from '../core/Walkability';
import { Direction, GridPoint, TileDefinition } from '../core/types';
import {
  CompiledPiece,
  PieceAnnotation,
  PieceDefinition,
  PieceLegendEntry,
  PieceOrientation
} from './PieceTypes';

const QUARTER_TURNS_PER_REVOLUTION = 4;

/** Every orientation a rotatable piece can take. */
export const ALL_ORIENTATIONS: readonly PieceOrientation[] = [false, true].flatMap((mirrored) =>
  ([0, 1, 2, 3] as const).map((quarterTurns) => ({ quarterTurns, mirrored }))
);

export const IDENTITY_ORIENTATION: PieceOrientation = { quarterTurns: 0, mirrored: false };

/** Raised for a malformed piece, or one whose tiles cannot take an orientation. */
export class PieceError extends Error {
  constructor(public readonly pieceId: string, detail: string) {
    super(`${pieceId}: ${detail}`);
    this.name = 'PieceError';
  }
}

export function rotateDirection(dir: Direction, quarterTurns: number): Direction {
  const index = ORDERED_DIRECTIONS.indexOf(dir);
  return ORDERED_DIRECTIONS[(index + quarterTurns) % QUARTER_TURNS_PER_REVOLUTION];
}

const MIRRORED_DIRECTION: Readonly<Record<Direction, Direction>> = { N: 'N', S: 'S', E: 'W', W: 'E' };

/** Mirror left-right first, then rotate clockwise. */
export function orientDirection(dir: Direction, o: PieceOrientation): Direction {
  return rotateDirection(o.mirrored ? MIRRORED_DIRECTION[dir] : dir, o.quarterTurns);
}

/** Maps a cell of a width x height grid to its place in the oriented grid. */
export function orientPoint(
  point: GridPoint,
  width: number,
  height: number,
  o: PieceOrientation
): GridPoint {
  let x = o.mirrored ? width - 1 - point.x : point.x;
  let y = point.y;
  let w = width;
  let h = height;
  for (let turn = 0; turn < o.quarterTurns; turn++) {
    const nx = h - 1 - y;
    const ny = x;
    x = nx;
    y = ny;
    [w, h] = [h, w];
  }
  return { x, y };
}

function sortedDirections(dirs: Direction[] | undefined): string {
  return dirs ? [...dirs].sort().join() : '';
}

/** The direction-bearing part of a tile, as a comparable string. */
function directionalSignature(
  tile: TileDefinition,
  transform: (dir: Direction) => Direction
): string {
  const force =
    tile.forceDirection && tile.forceDirection !== 'RANDOM'
      ? transform(tile.forceDirection)
      : tile.forceDirection ?? '';
  const deflection = tile.deflectionMap
    ? Object.entries(tile.deflectionMap)
        .map(([from, to]) => `${transform(from as Direction)}>${transform(to as Direction)}`)
        .sort()
        .join()
    : '';
  return [
    tile.slideType ?? '',
    tile.category,
    force,
    sortedDirections(tile.blockedEdges?.map(transform)),
    sortedDirections(tile.blockedEntryDirections?.map(transform)),
    deflection
  ].join('|');
}

function isDirectional(tile: TileDefinition): boolean {
  return Boolean(
    (tile.forceDirection && tile.forceDirection !== 'RANDOM') ||
      tile.blockedEdges ||
      tile.blockedEntryDirections ||
      tile.deflectionMap
  );
}

const orientedTileCache = new Map<string, string | null>();

/**
 * The tile that plays the role of `tileId` once the grid is oriented: a force
 * floor pointing north becomes the one pointing east after a clockwise turn.
 * Found from the tile config, so new directional tiles need no code. Returns
 * null when the config has no such tile (a corner thin wall with no mirror).
 */
export function orientTileId(tileId: string, o: PieceOrientation): string | null {
  const cacheKey = `${tileId}|${o.quarterTurns}|${o.mirrored}`;
  const cached = orientedTileCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tile = ConfigRegistry.getTile(tileId);
  let result: string | null = tileId;
  if (isDirectional(tile)) {
    const wanted = directionalSignature(tile, (dir) => orientDirection(dir, o));
    const identity = (dir: Direction): Direction => dir;
    const match = Object.values(ConfigRegistry.getTiles().tiles).find(
      (candidate) => isDirectional(candidate) && directionalSignature(candidate, identity) === wanted
    );
    result = match ? match.id : null;
  }
  orientedTileCache.set(cacheKey, result);
  return result;
}

/** Clears the orientation cache; needed when tests install another tile config. */
export function resetPieceCaches(): void {
  orientedTileCache.clear();
}

/** Parses a piece definition with the merged levels.json and motifs.json legend. */
export function compilePiece(
  def: PieceDefinition,
  legend: Record<string, PieceLegendEntry>,
  annotation?: PieceAnnotation
): CompiledPiece {
  const height = def.rows.length;
  const width = height > 0 ? def.rows[0].length : 0;
  if (height === 0 || def.rows.some((row) => row.length !== width)) {
    throw new PieceError(def.id, 'rows must be non-empty and of equal length');
  }

  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  const entities = (def.entities ?? []).map((e) => ({ ...e }));
  let entry: GridPoint | null = null;
  let exit: GridPoint | null = null;

  def.rows.forEach((row, y) => {
    terrain.push([]);
    items.push([]);
    [...row].forEach((ch, x) => {
      const cell = legend[ch];
      if (!cell) throw new PieceError(def.id, `unknown legend character '${ch}'`);
      terrain[y].push(cell.terrain);
      items[y].push(cell.item ?? null);
      if (cell.entity) {
        entities.push({ x, y, type: cell.entity, dir: cell.entityDir ?? DEFAULT_FACING });
      }
      if (cell.port === 'entry') {
        if (entry) throw new PieceError(def.id, 'more than one entry port');
        entry = { x, y };
      }
      if (cell.port === 'exit') {
        if (exit) throw new PieceError(def.id, 'more than one exit port');
        exit = { x, y };
      }
    });
  });

  if (!entry || !exit) throw new PieceError(def.id, 'needs one entry and one exit port');
  // The forEach above hides the assignments from narrowing; restate the found ports.
  const ports: [GridPoint, GridPoint] = [entry, exit];
  for (const port of ports) {
    const onVerticalEdge = port.x === 0 || port.x === width - 1;
    const onHorizontalEdge = port.y === 0 || port.y === height - 1;
    if (!onVerticalEdge && !onHorizontalEdge) {
      throw new PieceError(def.id, 'ports must sit on the piece border');
    }
    // A corner port would open on two sides and could not be joined by one corridor.
    if (onVerticalEdge && onHorizontalEdge) {
      throw new PieceError(def.id, 'ports must not sit on a piece corner');
    }
  }
  const hasMonsters = entities.some((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster');
  if (hasMonsters) {
    const portTerrain = ConfigRegistry.getMotifs().monsterPortTerrain;
    for (const port of ports) terrain[port.y][port.x] = portTerrain;
  }
  // Corridors may run along a piece: any open border cell but the ports would be a side door.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const isPort = ports.some((p) => p.x === x && p.y === y);
      if (onBorder && !isPort && ConfigRegistry.getTile(terrain[y][x]).passableByPlayer !== false) {
        throw new PieceError(def.id, `border cell ${x},${y} must be a wall`);
      }
    }
  }

  return {
    id: def.id,
    motif: def.motif,
    tier: def.tier,
    width,
    height,
    terrain,
    items,
    entities,
    trapLinks: (def.trapLinks ?? []).map((l) => ({ ...l })),
    cloneLinks: (def.cloneLinks ?? []).map((l) => ({ ...l })),
    entry,
    exit,
    requires: [...(def.requires ?? [])],
    rotatable: def.rotatable ?? false,
    oneShot: def.oneShot ?? false,
    deadEnds: countDeadEnds(terrain, ports),
    solution: annotation ? decodeActions(annotation.solution) : undefined,
    reversible: annotation?.reversible,
    orientation: IDENTITY_ORIENTATION
  };
}

function holdsMonsters(piece: CompiledPiece): boolean {
  return piece.entities.some((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster');
}

/** Dead ends of a piece: walkable cells with one walkable neighbour, a port counting an outside one. */
function countDeadEnds(terrain: string[][], ports: GridPoint[]): number {
  const walkable = terrain.map((row) => row.map((id) => isPlayerWalkable(ConfigRegistry.getTile(id))));
  let deadEnds = 0;
  walkable.forEach((row, y) =>
    row.forEach((open, x) => {
      if (!open) return;
      let neighbours = ports.some((p) => p.x === x && p.y === y) ? 1 : 0;
      for (const dir of ORDERED_DIRECTIONS) {
        if (walkable[y + DIRECTION_VECTORS[dir].dy]?.[x + DIRECTION_VECTORS[dir].dx]) neighbours++;
      }
      if (neighbours === 1) deadEnds++;
    })
  );
  return deadEnds;
}

/**
 * Returns the piece turned and mirrored by `o`; throws if a tile has no
 * oriented counterpart. `orientation` records `o`, which describes the result
 * only when the input came straight from compilePiece.
 */
export function orientPiece(piece: CompiledPiece, o: PieceOrientation): CompiledPiece {
  if (o.quarterTurns === 0 && !o.mirrored) return piece;
  const { width, height } = piece;
  const swapped = o.quarterTurns % 2 === 1;
  const newWidth = swapped ? height : width;
  const newHeight = swapped ? width : height;
  const terrain = Array.from({ length: newHeight }, () => new Array<string>(newWidth));
  const items = Array.from({ length: newHeight }, () => new Array<string | null>(newWidth));
  const at = (p: GridPoint): GridPoint => orientPoint(p, width, height, o);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = at({ x, y });
      const tileId = orientTileId(piece.terrain[y][x], o);
      if (tileId === null) {
        throw new PieceError(piece.id, `tile '${piece.terrain[y][x]}' has no oriented counterpart`);
      }
      terrain[target.y][target.x] = tileId;
      items[target.y][target.x] = piece.items[y][x];
    }
  }

  return {
    ...piece,
    width: newWidth,
    height: newHeight,
    terrain,
    items,
    entities: piece.entities.map((e) => ({ ...e, ...at(e), dir: orientDirection(e.dir, o) })),
    trapLinks: piece.trapLinks.map((l) => {
      const button = at({ x: l.buttonX, y: l.buttonY });
      const trap = at({ x: l.trapX, y: l.trapY });
      return { buttonX: button.x, buttonY: button.y, trapX: trap.x, trapY: trap.y };
    }),
    cloneLinks: piece.cloneLinks.map((l) => {
      const button = at({ x: l.buttonX, y: l.buttonY });
      const cloner = at({ x: l.clonerX, y: l.clonerY });
      return {
        ...l,
        buttonX: button.x,
        buttonY: button.y,
        clonerX: cloner.x,
        clonerY: cloner.y,
        templateDir: orientDirection(l.templateDir, o)
      };
    }),
    entry: at(piece.entry),
    exit: at(piece.exit),
    // Rules are the same in every rotation, so the solution turns with the piece. A mirror
    // image flips the handedness of wall-following monsters: their timing no longer matches.
    solution:
      o.mirrored && holdsMonsters(piece)
        ? undefined
        : piece.solution?.map((a) => (a === 'WAIT' ? a : orientDirection(a, o))),
    orientation: o
  };
}

/** Boots that tame a hazard of the piece and keys that open its doors. */
export function helpfulItems(piece: CompiledPiece): Set<string> {
  const items = new Set<string>();
  for (const row of piece.terrain) {
    for (const id of row) {
      const tile = ConfigRegistry.getTile(id);
      if (tile.protectedByItem && (tile.hazard || tile.slideType)) items.add(tile.protectedByItem);
      if (tile.requiredKey) items.add(tile.requiredKey);
    }
  }
  return items;
}
