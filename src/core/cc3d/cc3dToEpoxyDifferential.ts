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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction } from '../types';
import { displayTerrainId } from './display';
import type { Cc3dCell } from './model';
import { cellAt } from './cc3dWorld';
import type { World } from './cc3dWorld';
import { Cc3dRig } from './cc3dTestRig';

/**
 * Test support: plays a CC3D level on the CC3D engine and its conversion on the Epoxy engine, move by move, and
 * compares the two at the points where both are at rest. Tick timing is ignored on purpose: each engine is ticked
 * until its player stands still, so only the state reached is compared.
 */

/** Upper bound of ticks one engine may take to settle after a move. */
export const MAX_SETTLE_TICKS = 400;
/** Quiet ticks in a row that count as standing still. */
const STABLE_TICKS = 3;
/** Moves of the seeded random walk. */
export const WALK_MOVES = 500;
const WALK_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Mulberry32 constants. */
const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;

/** A field on which the two engines disagree. */
export interface DiffMismatch {
  /** Moves played when the mismatch was found (0 = at load). */
  move: number;
  field: 'player' | 'alive' | 'complete' | 'chips' | 'keys' | 'cells' | 'settle' | 'entities' | 'items';
  detail: string;
}

/** CC3D display ids that name another Epoxy id; every other CC3D display id is also the Epoxy id. */
export function epoxyIdOf(displayId: string): string {
  if (displayId === 'cc3d_socket_red') return 'socket';
  if (displayId === 'socket') return 'fish_gate';
  if (displayId === 'teleport_blue') return 'teleport_forward';
  if (displayId === 'teleport_red') return 'teleport_turning';
  if (displayId === 'cc3d_sand') return 'sand';
  if (displayId === 'cc3d_golem_control_yellow') return 'puppet_control';
  if (displayId === 'force_random') return 'force_cycle';
  // Format 15: the converter plays these CC3D terrains as their CC3D-rule twins.
  if (displayId === 'dirt') return 'dirt_3d';
  if (displayId === 'slime') return 'slime_3d';
  if (displayId === 'appearing_wall') return 'appearing_wall_any';
  // Format 17: the converter plays the CC3D ice corners as ice_corner_3d_<sides>.
  const iceCorner = /^ice_([ns][ew])$/.exec(displayId);
  if (iceCorner) return `ice_corner_3d_${iceCorner[1]}`;
  // The converter moves a bomb layer to the item grid (see compare with `items`), so the terrain below is floor.
  if (displayId === 'bomb') return 'floor';
  const hold = /^cc3d_hold_door_(\w+)$/.exec(displayId);
  if (hold) return `hold_door_${hold[1]}`;
  const toggle = /^cc3d_toggle_door_(\w+)$/.exec(displayId);
  if (toggle) return `toggle_wall_${toggle[1]}`;
  const control = /^cc3d_toggle_control_(\w+)$/.exec(displayId);
  if (control) return `toggle_button_${control[1]}`;
  const plate = /^cc3d_plate_(\w+)$/.exec(displayId);
  if (plate) return `pressure_plate_${plate[1]}`;
  return displayId;
}

/**
 * Tiles the Epoxy engine itself creates while it plays a converted level. Since format 16 the water a dirt block fills
 * is `dirt_3d` and an omni's trail is `slime_3d`, the tiles the converter places, so nothing needs reading as another
 * tile and the id is kept as it is. The sealed trap (format 17) is how the converter writes a CC3D trap no control
 * works; the CC3D engine shows every trap as a trap, so it is read as one.
 */
export function epoxyEngineIdOf(id: string): string {
  return id === 'trap_sealed' ? 'trap' : id;
}

/** CC3D display ids of mobs that name another Epoxy entity type. */
export const ENTITY_ID_MAP: Readonly<Record<string, string>> = {
  cc3d_golem_yellow: 'golem_yellow',
  cc3d_legs_green: 'legs_green',
  cc3d_legs_red: 'legs_red',
  cc3d_baby_blinky: 'baby_blinky',
  cc3d_baby_screamer: 'baby_screamer',
  // The CC3D engine draws its monsters as the Epoxy monsters they resemble; each one is its own Epoxy monster.
  walker: 'walker_3d',
  glider: 'blinky',
  bug: 'limpa',
  paramecium: 'limpy',
  pink_ball: 'bouncer',
  blob: 'omni',
  fireball: 'screamer',
  // The CC3D engine draws its blue golem as a tank.
  tank: 'golem_blue',
  cc3d_reflector_lu: 'one_sided_mirror_sw',
  cc3d_reflector_dl: 'one_sided_mirror_nw',
  cc3d_reflector_ur: 'one_sided_mirror_se',
  cc3d_reflector_rd: 'one_sided_mirror_ne',
  cc3d_bot_static: 'turret_fixed',
  cc3d_bot_cw: 'turret_cw',
  cc3d_bot_ccw: 'turret_ccw',
  cc3d_bot_multi: 'turret_multi',
  cc3d_block_red: 'color_block_3d_red',
  cc3d_block_green: 'color_block_3d_green',
  cc3d_block_blue: 'color_block_3d_blue',
  cc3d_block_yellow: 'color_block_3d_yellow',
  // Format 15: the converter plays the CC3D ice block as ice_block_3d.
  ice_block: 'ice_block_3d',
  // Format 16: the converter plays the CC3D dirt block as dirt_block_3d.
  dirt_block: 'dirt_block_3d'
};
/** CC3D display ids of items that name another Epoxy item id. */
const ITEM_ID_MAP: Readonly<Record<string, string>> = { stopwatch_bonus: 'slow_time', cc3d_fish_extra: 'chip' };
const BOMB_ID = 'bomb';
const BOMB_KIND = 'bomb';
const FLOOR_ID = 'floor';
/** The death message both engines give a player killed by a monster. */
export const MONSTER_DEATH_KEY = 'hud.messages.death_monster';
/** Cells (Manhattan distance) within which two dead players, or a dead player and the survivor, count as one step apart. */
const NEAR_CELLS = 1;
const MONSTER_KIND = 'monster';

/** Death reason keys that name the same cause in the two engines, to the common key (every other key is its own). */
const DEATH_KEY_ALIASES: Readonly<Record<string, string>> = {};

/** The common death cause of a death reason key. */
export function deathKindOf(key: string | null | undefined): string {
  if (key === null || key === undefined) return '';
  return DEATH_KEY_ALIASES[key] ?? key;
}

/**
 * The display id of a CC3D cell without its bomb layers: what the converter keeps as the terrain (it moves a bomb
 * layer to the item grid). A cell with nothing but bombs reads as floor.
 */
export function displayTerrainWithoutBomb(cell: Cc3dCell): string {
  const terrain = [...cell.terrain];
  while (terrain.length > 0 && terrain[terrain.length - 1].kind === BOMB_KIND) terrain.pop();
  if (terrain.length === 0) return cell.panels.length > 0 ? displayTerrainId({ ...cell, terrain: [{ kind: 'floor' }] }) : FLOOR_ID;
  return displayTerrainId({ ...cell, terrain });
}

/** True when two cells are the same or orthogonal neighbours (Manhattan distance of at most one). */
export function isWithinOneCell(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= NEAR_CELLS;
}

/** A monster by Epoxy type and cell. */
export interface MonsterAt {
  type: string;
  x: number;
  y: number;
}

/**
 * True when a monster death against a living survivor may be read as a one-tick timing difference: the dead player
 * stands within one step of the survivor; no monster shares the survivor's cell (that would mean shielding differs);
 * and a monster of the same type stands one step from the survivor in both engines. Returns the type, or null.
 */
export function monsterTimingKind(
  survivor: { x: number; y: number },
  dead: { x: number; y: number },
  survivorSide: ReadonlyArray<MonsterAt>,
  deadSide: ReadonlyArray<MonsterAt>
): string | null {
  if (!isWithinOneCell(survivor, dead)) return null;
  if (survivorSide.some((m) => m.x === survivor.x && m.y === survivor.y)) return null;
  const adjacent = (m: MonsterAt): boolean => isWithinOneCell(survivor, m);
  const near = survivorSide.filter(adjacent);
  const match = near.find((m) => deadSide.some((o) => o.type === m.type && adjacent(o)));
  return match ? match.type : null;
}

/** The CC3D display id both snappy and nibble are drawn with, and the Epoxy monster of each. */
const SNAPPY_NIBBLE_DISPLAY_ID = 'teeth';
const NIBBLE_KIND = 'nibble';
const SNAPPY_EPOXY_TYPE = 'snappy';
const NIBBLE_EPOXY_TYPE = 'nibble';

/** What stands where, as sorted `type@x,y` strings. */
function entityLines(entities: ReadonlyArray<{ type: string; x: number; y: number }>, map: (type: string) => string): string[] {
  return entities.map((e) => `${map(e.type)}@${e.x},${e.y}`).sort();
}

/** Epoxy shows a floating colour block as a terrain tile of this prefix, where CC3D keeps the block as a mob on water. */
const FLOATING_BLOCK_PREFIX = 'floating_block_';

interface MobProbe {
  x: number;
  y: number;
  kind: string;
}

interface FloatingProbe {
  x: number;
  y: number;
  color?: string;
  floating: boolean;
}

function nonZero(keys: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(keys).filter(([, count]) => count > 0));
}

/** Both engines on the same level, advanced one move at a time. */
export class DifferentialPair {
  public readonly rig: Cc3dRig;
  public readonly epoxy: GameEngine;
  public moves = 0;
  /** Both engines were still moving when the settle cap ran out: a perpetual slide, whose phase is not comparable. */
  public looping = false;
  /**
   * One player died by a monster while the other lives with a monster within one cell: the two engines resolve the
   * same encounter a tick apart. Reported as a timing difference, not a failure; the walk ends there.
   */
  public monsterTiming = false;
  /** The Epoxy type of the monster behind the last monster timing difference, or null. */
  public monsterTimingType: string | null = null;
  private cc3dSettled = true;
  private epoxySettled = true;
  /** The converted level holds a socket, so chips matter; without one it asks for none. */
  private readonly hasSocket: boolean;
  /** Thin walls the converter kept as cell edges (under a terrain that is not floor), by cell: their CC3D display id. */
  private readonly edgeIds: ReadonlyMap<string, string>;

  constructor(source: CompiledLevel, converted: CompiledLevel, seed: number) {
    this.rig = new Cc3dRig(source, seed);
    this.epoxy = new GameEngine();
    this.epoxy.loadLevel(converted, seed);
    this.hasSocket = converted.terrain.some((row) => row.includes('socket') || row.includes('fish_gate'));
    this.edgeIds = new Map(
      (converted.cellEdges ?? []).map((e) => [`${e.x},${e.y}`, displayTerrainId({ terrain: [{ kind: FLOOR_ID }], panels: [...e.sides], item: null })] as const)
    );
  }

  /**
   * Ticks an engine until its player has stood still, with nothing under way, for STABLE_TICKS ticks in a row: a
   * slide or a teleport exit may start one tick after the player arrived, so a single quiet tick proves nothing.
   */
  private settle(tick: () => void, read: () => { x: number; y: number; busy: boolean; over: boolean }): boolean {
    let quiet = 0;
    let last = read();
    for (let i = 0; i < MAX_SETTLE_TICKS && !last.over; i++) {
      tick();
      const now = read();
      quiet = !now.busy && !last.busy && now.x === last.x && now.y === last.y ? quiet + 1 : 0;
      last = now;
      if (quiet >= STABLE_TICKS) return true;
    }
    return last.over;
  }

  /** True once either engine has ended the level. */
  public get ended(): boolean {
    return !this.rig.player.alive || !this.epoxy.getPlayer().alive || this.rig.engine.isLevelCompleted() || this.epoxy.isLevelCompleted();
  }

  /** Presses a direction on both engines, then lets each settle. */
  public step(dir: Direction): void {
    this.moves += 1;
    this.rig.press(dir);
    this.cc3dSettled = this.settle(
      () => this.rig.tick(1),
      () => {
        const p = this.rig.player;
        return { x: p.x, y: p.y, busy: p.moveCooldown > 0 || p.isSliding, over: !p.alive || this.rig.engine.isLevelCompleted() };
      }
    );
    this.epoxy.attemptPlayerMove(dir);
    this.epoxySettled = this.settle(
      () => this.epoxy.tick(),
      () => {
        const p = this.epoxy.getPlayer();
        return { x: p.x, y: p.y, busy: p.moveCooldown > 0 || p.isSliding, over: !p.alive || this.epoxy.isLevelCompleted() };
      }
    );
  }

  /** The kind of each CC3D mob by cell (read from the simulation): the display id alone does not tell snappy from nibble. */
  private mobKinds(): ReadonlyMap<string, string> {
    const sim = (this.rig.engine as unknown as { sim: { world: { mobs: MobProbe[] } } | null }).sim;
    return new Map((sim?.world.mobs ?? []).map((mob) => [`${mob.x},${mob.y}`, mob.kind] as const));
  }

  /** The Epoxy entity type of a CC3D engine entity. */
  public epoxyTypeOf(entity: { type: string; x: number; y: number }, kinds: ReadonlyMap<string, string> = this.mobKinds()): string {
    if (entity.type === SNAPPY_NIBBLE_DISPLAY_ID) {
      return kinds.get(`${entity.x},${entity.y}`) === NIBBLE_KIND ? NIBBLE_EPOXY_TYPE : SNAPPY_EPOXY_TYPE;
    }
    return ENTITY_ID_MAP[entity.type] ?? entity.type;
  }

  /** The monsters of an engine's entity list, by cell (CC3D types read through their Epoxy twin). */
  private monstersOf(entities: ReadonlyArray<{ type: string; x: number; y: number }>, cc3d: boolean): MonsterAt[] {
    const kinds = cc3d ? this.mobKinds() : new Map<string, string>();
    return entities
      .map((e) => ({ type: cc3d ? this.epoxyTypeOf(e, kinds) : e.type, x: e.x, y: e.y }))
      .filter((m) => ConfigRegistry.getEntityDef(m.type)?.kind === MONSTER_KIND);
  }

  /** The CC3D cell at a position (read from the simulation, which the engine keeps private). */
  private cc3dCellAt(x: number, y: number): Cc3dCell | undefined {
    const sim = (this.rig.engine as unknown as { sim: { world: World } | null }).sim;
    return sim ? cellAt(sim.world, x, y) : undefined;
  }

  /** The CC3D colour blocks that float on water now, by cell (read from the simulation, which the engine keeps private). */
  private floatingBlocks(): ReadonlyMap<string, string> {
    const sim = (this.rig.engine as unknown as { sim: { world: { mobs: FloatingProbe[] } } | null }).sim;
    const found = new Map<string, string>();
    for (const mob of sim?.world.mobs ?? []) if (mob.floating && mob.color !== undefined) found.set(`${mob.x},${mob.y}`, mob.color);
    return found;
  }

  /**
   * The first field on which the engines differ, or null. `entities` also compares the blocks and monsters (type
   * and cell), `items` the item grids (a CC3D bomb layer counts as the item `bomb`, as the converter plays it).
   */
  public compare(options: { entities?: boolean; items?: boolean } = {}): DiffMismatch | null {
    const at = (field: DiffMismatch['field'], detail: string): DiffMismatch => ({ move: this.moves, field, detail });
    if (!this.cc3dSettled && !this.epoxySettled) {
      this.looping = true;
      return null;
    }
    if (this.cc3dSettled !== this.epoxySettled) return at('settle', `cc3d settles ${this.cc3dSettled} epoxy settles ${this.epoxySettled}`);
    const a = this.rig.player;
    const b = this.epoxy.getPlayer();
    let timing = false;
    if (a.alive !== b.alive) {
      const deadIsCc3d = !a.alive;
      const dead = deadIsCc3d ? a : b;
      const survivor = deadIsCc3d ? b : a;
      const survivorSide = deadIsCc3d ? this.monstersOf(this.epoxy.getEntities(), false) : this.monstersOf(this.rig.entities, true);
      const deadSide = deadIsCc3d ? this.monstersOf(this.rig.entities, true) : this.monstersOf(this.epoxy.getEntities(), false);
      const kind = dead.deathReasonKey === MONSTER_DEATH_KEY ? monsterTimingKind(survivor, dead, survivorSide, deadSide) : null;
      if (kind === null) return at('alive', `cc3d ${a.alive} epoxy ${b.alive}`);
      timing = true;
      this.monsterTimingType = kind;
    } else {
      const bothKilledByMonster = !a.alive && a.deathReasonKey === MONSTER_DEATH_KEY && b.deathReasonKey === MONSTER_DEATH_KEY;
      // Documented gap: two players killed by a monster may stand one step apart, the engines resolve the strike a tick apart.
      const samePlace = a.x === b.x && a.y === b.y;
      if (!samePlace && !(bothKilledByMonster && isWithinOneCell(a, b))) return at('player', `cc3d ${a.x},${a.y} epoxy ${b.x},${b.y}`);
    }
    const doneA = this.rig.engine.isLevelCompleted();
    const doneB = this.epoxy.isLevelCompleted();
    if (doneA !== doneB) return at('complete', `cc3d ${doneA} epoxy ${doneB}`);
    // The level is over in both engines: Epoxy ends it when the last step starts (water, fire, exit), CC3D when it
    // ends, so the world ran a different number of ticks afterwards. The outcome is compared (alive, complete, and the
    // death reason of two dead players); the time left is not, because the converter does not carry the CC3D time
    // limit yet (the converted level has none). Not compared after this point: chips, keys, terrain cells, items and
    // entities.
    if (!a.alive && !b.alive && deathKindOf(a.deathReasonKey) !== deathKindOf(b.deathReasonKey)) {
      return at('alive', `death cc3d ${String(a.deathReasonKey)} epoxy ${String(b.deathReasonKey)}`);
    }
    if ((!a.alive && !b.alive) || (doneA && doneB)) {
      if (timing) this.monsterTiming = true;
      return null;
    }
    const chipsA = this.rig.engine.getChipsRemaining();
    const chipsB = this.epoxy.getChipsRemaining();
    // Without a socket the converted level needs no chips (chipsRequired 0), while CC3D still counts its fish.
    if (this.hasSocket && chipsA !== chipsB) return at('chips', `cc3d ${chipsA} epoxy ${chipsB}`);
    const keysA = JSON.stringify(Object.entries(nonZero(a.keys)).sort());
    const keysB = JSON.stringify(Object.entries(nonZero(b.keys)).sort());
    if (keysA !== keysB) return at('keys', `cc3d ${keysA} epoxy ${keysB}`);
    const terrainA = this.rig.engine.getTerrain();
    const terrainB = this.epoxy.getTerrain();
    const floating = this.floatingBlocks();
    for (let y = 0; y < terrainA.length; y++) {
      for (let x = 0; x < terrainA[y].length; x++) {
        const floatingColor = floating.get(`${x},${y}`);
        // A top bomb is compared apart (see `items`): its ground is the cell without the bomb layer.
        const cell = terrainA[y][x] === BOMB_ID ? this.cc3dCellAt(x, y) : undefined;
        const ground = cell ? displayTerrainWithoutBomb(cell) : terrainA[y][x];
        const mapped = floatingColor === undefined ? epoxyIdOf(ground) : `${FLOATING_BLOCK_PREFIX}${floatingColor}`;
        // A thin wall kept as a cell edge: once the terrain above it is gone Epoxy shows floor, and the CC3D cell must
        // then show exactly the thin wall(s) the converter stored, so a panel lost by either engine is a mismatch.
        const edgeId = this.edgeIds.get(`${x},${y}`);
        const expected = edgeId !== undefined && terrainB[y][x] === FLOOR_ID ? edgeId : epoxyEngineIdOf(terrainB[y][x]);
        if (mapped !== expected) return at('cells', `${x},${y} cc3d ${terrainA[y][x]} epoxy ${terrainB[y][x]}`);
      }
    }
    // Bombs are always compared, one by one: a bomb layer is the item `bomb` of the converted level.
    const itemsB = this.epoxy.getItems();
    if (!options.items) {
      for (let y = 0; y < terrainA.length; y++) {
        for (let x = 0; x < terrainA[y].length; x++) {
          const bombA = terrainA[y][x] === BOMB_ID;
          if (bombA !== (itemsB[y][x] === BOMB_ID)) return at('items', `${x},${y} cc3d bomb ${bombA} epoxy ${String(itemsB[y][x])}`);
        }
      }
    }
    if (options.items) {
      const itemsA = this.rig.engine.getItems();
      for (let y = 0; y < itemsA.length; y++) {
        for (let x = 0; x < itemsA[y].length; x++) {
          const raw = itemsA[y][x];
          const mapped = raw === null ? (terrainA[y][x] === BOMB_ID ? BOMB_ID : null) : (ITEM_ID_MAP[raw] ?? raw);
          if (mapped !== itemsB[y][x]) return at('items', `${x},${y} cc3d ${String(mapped)} epoxy ${String(itemsB[y][x])}`);
        }
      }
    }
    if (options.entities) {
      const resting = this.rig.entities.filter((e) => !(e.type in ENTITY_ID_MAP && floating.has(`${e.x},${e.y}`)));
      const kinds = this.mobKinds();
      const linesA = resting.map((e) => `${this.epoxyTypeOf(e, kinds)}@${e.x},${e.y}`).sort();
      const linesB = entityLines(this.epoxy.getEntities(), (type) => type);
      if (linesA.join(';') !== linesB.join(';')) return at('entities', `cc3d ${linesA.join(' ')} epoxy ${linesB.join(' ')}`);
    }
    if (timing) this.monsterTiming = true;
    return null;
  }
}

/** A seeded generator of numbers in [0, 1), so a walk is the same on every run. */
export function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export interface WalkResult {
  /** The walk changed something: a chip or a key was taken, or a cell changed. */
  touched: boolean;
  moves: number;
  /** The walk stopped because both engines slide for ever. */
  looping: boolean;
  /** The walk ended on a monster timing difference (see DifferentialPair.monsterTiming): not a failure. */
  monsterTiming?: boolean;
  /** With monsterTiming: the Epoxy type of the monster involved. */
  monsterType?: string;
  mismatch: DiffMismatch | null;
}

/** Plays a seeded random walk on both engines, stopping at the first mismatch or when the level ends. */
export function differentialWalk(source: CompiledLevel, converted: CompiledLevel, seed: number, moves = WALK_MOVES): WalkResult {
  const pair = new DifferentialPair(source, converted, seed);
  const next = seededUnit(seed);
  const snapshot = (): string => pair.epoxy.getTerrain().map((row) => row.join(',')).join(';');
  const startTerrain = snapshot();
  const startChips = pair.epoxy.getChipsRemaining();
  let touched = false;
  const initial = pair.compare();
  if (initial) return { touched, moves: 0, looping: false, mismatch: initial };
  for (let i = 0; i < moves && !pair.ended && !pair.looping; i++) {
    pair.step(WALK_DIRECTIONS[Math.floor(next() * WALK_DIRECTIONS.length)]);
    const mismatch = pair.compare();
    if (mismatch) return { touched, moves: pair.moves, looping: false, mismatch };
    if (pair.monsterTiming) return { touched, moves: pair.moves, looping: false, monsterTiming: true, monsterType: pair.monsterTimingType ?? undefined, mismatch: null };
    if (!touched) {
      touched =
        pair.epoxy.getChipsRemaining() !== startChips ||
        Object.values(pair.epoxy.getPlayer().keys).some((count) => count > 0) ||
        snapshot() !== startTerrain;
    }
  }
  return { touched, moves: pair.moves, looping: pair.looping, mismatch: null };
}
