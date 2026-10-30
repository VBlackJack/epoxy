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
import { SeededRandom } from '../core/Random';
import { HubConfig, HubGateConfig } from '../core/types';
import { DifficultyProfile } from './DifficultyProfile';
import { helpfulItems, monsterCount } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece, MotifRule } from './PieceTypes';
import { LevelScript, ProgressionPlanner } from './ProgressionPlanner';

/** How a wing is closed: not at all, by a door, or by a hazard strip. */
export interface HubGate {
  kind: 'open' | 'door' | 'hazard';
  config?: HubGateConfig;
}

export interface HubWing {
  /** Unoriented; the assembler turns it so its entry faces the hub. In a loop wing, the first puzzle of the chain. */
  piece: CompiledPiece;
  /** The puzzles chained after `piece` in a loop wing, in the order they are met; empty otherwise. */
  then: CompiledPiece[];
  /**
   * A loop wing comes back to the hub through a one-way strip instead of ending in a
   * dead end, so its puzzles are never walked back and need not be reversible.
   */
  loop: boolean;
  gate: HubGate;
  /** Items left in the wing's reward room: what opens later wings. */
  rewards: string[];
  isFinal: boolean;
}

export interface HubPlan {
  /** The final wing, holding the exit, is last. */
  wings: HubWing[];
  /**
   * Indices of `wings` in an order that wins the level, found by an abstract search over
   * keys and boots; the proof visits the wings in this order. Without scarce keys it is
   * simply the order of `wings`.
   */
  order: number[];
  /** Key items that fewer keys than doors exist for until the right wing is opened. */
  scarce: string[];
  /** Items lying in the hub itself: boots an open wing needs. */
  hubItems: string[];
  motifs: string[];
  finale: CompiledPiece;
  /** Monsters wandering the hub region of a loop level, one id each; empty elsewhere. */
  openMonsters: string[];
  /** Chips scattered over the hub region of a loop level; 0 elsewhere (the hub holds `hubChips`). */
  openChips: number;
}

/**
 * Plans a hub level as a lock-and-key graph. Some wings are open from the
 * start; every other wing is locked, and the item that opens it lies in the
 * reward room of a wing visited earlier, picked at random among them. The
 * player therefore sees locks before owning their keys, and has to explore
 * and come back. A wing whose puzzle needs boots is locked by the matching
 * hazard, so the boots are always found first. Wing puzzles must not steal
 * boots, which later locks may need. A dead-end wing holds one puzzle that must
 * be walkable back (the player leaves the way they came). In the modes of
 * `cfg.loopModes` the wings are loops instead: chains of puzzles that return
 * through a one-way strip of force floor. Boots that defeat the strip must not
 * exist in such a level, so no puzzle holds or needs them and the strip's
 * material is never used as a lock.
 */
export class HubPlanner {
  public static plan(
    profile: DifficultyProfile,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom,
    cfg: HubConfig,
    script?: LevelScript,
    piecesDropped = 0,
    lead?: string,
    avoid: string[] = []
  ): HubPlan {
    // Scripted levels keep the dead-end wings their briefs were written for.
    const loop = !script && cfg.loopModes.includes(profile.mode);
    const selection = ProgressionPlanner.selectPuzzles(
      profile,
      library,
      rules,
      rng,
      script,
      loop ? (piece) => HubPlanner.fitsLoopWing(piece, cfg) : HubPlanner.fitsWing,
      piecesDropped,
      lead,
      avoid
    );
    const pieces = loop
      ? HubPlanner.fitToArea(selection.puzzles, library, rules, profile, cfg)
      : selection.puzzles;
    // A lock whose item would make one of the level's puzzles trivial is not used:
    // boots carried into a matching hazard puzzle, a key matching a puzzle's doors.
    const spoiled = new Set(pieces.flatMap((p) => [...helpfulItems(p)].filter((id) => !p.requires.includes(id))));
    const unusedGates = [...cfg.doorGates, ...cfg.hazardGates].filter(
      (g) => !spoiled.has(g.item) && !(loop && g.item === cfg.returnGate.item)
    );
    rng.shuffle(unusedGates);
    const wings: HubWing[] = [];
    const hubItems: string[] = [];
    const groups = loop ? HubPlanner.chainGroups(pieces, cfg, rng) : pieces.map((piece) => [piece]);
    const openCount = Math.max(1, Math.min(cfg.openWings, groups.length - 1));

    groups.forEach((group, index) => {
      const piece = group[0];
      const isFinal = index === groups.length - 1;
      // Boots a chained puzzle needs wait in the hub: its wing cannot hold their lock.
      for (const later of group.slice(1)) {
        for (const id of later.requires) {
          if (ConfigRegistry.getTile(id).collectible === 'boot' && !hubItems.includes(id)) hubItems.push(id);
        }
      }      const boots = piece.requires.find((id) => ConfigRegistry.getTile(id).collectible === 'boot');
      let gate: HubGate = { kind: 'open' };
      const locked = isFinal || index >= openCount;
      if (boots) {
        const matching = cfg.hazardGates.find((g) => g.item === boots);
        // The piece needs these boots anyway, so its own lock may hand them over.
        if (matching && !unusedGates.includes(matching) && !wings.some((w) => w.gate.config === matching)) {
          unusedGates.push(matching);
        }
        const at = matching ? unusedGates.indexOf(matching) : -1;
        if (matching && at >= 0 && wings.length > 0) {
          unusedGates.splice(at, 1);
          gate = { kind: 'hazard', config: matching };
        } else {
          // No earlier wing to hold the boots, or the lock is taken: they wait in the hub.
          hubItems.push(boots);
        }
      } else if (locked && wings.length > 0) {
        const config = unusedGates.shift();
        if (config) {
          gate = { kind: cfg.doorGates.includes(config) ? 'door' : 'hazard', config };
        }
      }
      if (gate.config) {
        // The opening item lies in a wing the player can finish before this one.
        wings[rng.nextInt(0, wings.length - 1)].rewards.push(gate.config.item);
      }
      wings.push({ piece, then: group.slice(1), loop: loop && !isFinal, gate, rewards: [], isFinal });
    });

    const scarce = loop ? HubPlanner.makeScarce(wings, hubItems, cfg, profile, rng, unusedGates) : [];
    const asDrawn = wings.map((_, index) => index);
    const order = loop ? (HubPlanner.winningOrder(wings, hubItems) ?? asDrawn) : asDrawn;
    const openMonsters = loop ? HubPlanner.openMonsterTypes(pieces, selection.finale, profile, cfg, rng) : [];
    const openChips = loop ? HubPlanner.openChipCount(profile.pieceCount, cfg) : 0;
    return { wings, order, scarce, hubItems, motifs: selection.motifs, finale: selection.finale, openMonsters, openChips };
  }

  /**
   * Monsters left to the hub region: none under `fromPieces`, then one more per
   * `piecesPerMonster`, up to `max`. The pieces' own monsters count first against
   * the level's cap, so the open area never takes a fight the puzzles already hold.
   */
  public static openMonsterTypes(
    pieces: CompiledPiece[],
    finale: CompiledPiece,
    profile: DifficultyProfile,
    cfg: HubConfig,
    rng: SeededRandom
  ): string[] {
    const rule = cfg.openMonsters;
    if (profile.pieceCount < rule.fromPieces || rule.types.length === 0) return [];
    const wanted = Math.min(rule.max, 1 + Math.floor((profile.pieceCount - rule.fromPieces) / rule.piecesPerMonster));
    const held = [...pieces, finale].reduce((sum, p) => sum + monsterCount(p), 0);
    const room = Math.max(0, (ConfigRegistry.getGame().procedural?.maxMonstersPerLevel ?? 0) - held);
    const count = Math.min(wanted, room);
    // Different kinds first, so a level's open area is not three of the same.
    const kinds = [...rule.types];
    rng.shuffle(kinds);
    return Array.from({ length: count }, (_, i) => kinds[i % kinds.length]);
  }

  /** Chips in the hub region: `min`, one more per `piecesPerExtra` planned puzzles, up to `max`. */
  public static openChipCount(pieceCount: number, cfg: HubConfig): number {
    const rule = cfg.openChips;
    return Math.min(rule.max, rule.min + Math.floor(pieceCount / rule.piecesPerExtra));
  }

  /** Whether a puzzle can sit in a dead-end wing: walkable back, and no boot thief. */
  public static fitsWing = (piece: CompiledPiece): boolean =>
    PieceSolver.isReversible(piece) && !HubPlanner.stealsBoots(piece);

  /**
   * Whether a puzzle can sit in a loop wing. The player never walks back through
   * it, so it may be irreversible; it must still not steal boots, and must not
   * need or hold the boots that would let the player enter the return strip.
   */
  public static fitsLoopWing(piece: CompiledPiece, cfg: HubConfig): boolean {
    const item = cfg.returnGate.item;
    return (
      !HubPlanner.stealsBoots(piece) &&
      !piece.requires.includes(item) &&
      !piece.items.some((row) => row.includes(item))
    );
  }

  /** Scarce colours asked for at a difficulty: none under `fromPieces`, then one more per `piecesPerGate`, up to `max`. */
  public static scarceCount(pieceCount: number, cfg: HubConfig): number {
    const rule = cfg.scarceGates;
    if (pieceCount < rule.fromPieces) return 0;
    return Math.min(rule.max, 1 + Math.floor((pieceCount - rule.fromPieces) / rule.piecesPerGate));
  }

  /**
   * Gives some door colours more doors than keys at first. A later door is
   * re-locked with the colour of an earlier one and the earlier wing holds the
   * extra key, so the planned order wins while opening the later door first
   * spends the only key and strands the earlier wing: the level is then
   * restarted, as in the original game. With `scarceRecovery`, a spare key is
   * also left behind the later door and no order strands. A change is kept only
   * when the abstract search still finds a winning order. Returns the colours.
   */
  private static makeScarce(
    wings: HubWing[],
    hubItems: string[],
    cfg: HubConfig,
    profile: DifficultyProfile,
    rng: SeededRandom,
    spare: HubGateConfig[]
  ): string[] {
    const wanted = HubPlanner.scarceCount(profile.pieceCount, cfg);
    const scarce: string[] = [];
    const used = new Set<number>();
    const candidates = wings.map((_, i) => i).filter((i) => !wings[i].isFinal);
    rng.shuffle(candidates);
    for (const x of candidates) {
      if (scarce.length >= wanted) break;
      const opening = wings[x].gate.kind === 'open';
      const colour = opening ? spare.find((g) => cfg.doorGates.includes(g)) : wings[x].gate.config;
      if (used.has(x) || !colour || (wings[x].gate.kind !== 'door' && !opening)) continue;
      // The later door may replace another door, or a hazard its puzzles do not need the boots of.
      const later = wings
        .map((_, i) => i)
        .filter((y) => {
          const lock = wings[y].gate;
          if (y <= x || used.has(y) || !lock.config || lock.config === colour) return false;
          const needs = [wings[y].piece, ...wings[y].then].some((p) => p.requires.includes(lock.config?.item ?? ''));
          return lock.kind === 'door' || (lock.kind === 'hazard' && !needs);
        });
      if (later.length === 0) continue;
      const y = later[rng.nextInt(0, later.length - 1)];
      const kept = wings.map((w) => ({ gate: w.gate, rewards: [...w.rewards] }));
      const keptHub = [...hubItems];
      const replaced = (wings[y].gate.config as HubGateConfig).item;
      // The item that opened the later wing is no longer needed: take it out of the wing holding it.
      const holder = wings.find((w) => w.rewards.includes(replaced));
      if (holder) holder.rewards.splice(holder.rewards.indexOf(replaced), 1);
      // An open wing is locked with a key lying in the hub: the first choice the player makes.
      if (opening) {
        wings[x].gate = { kind: 'door', config: colour };
        hubItems.push(colour.item);
      }
      wings[y].gate = { kind: 'door', config: colour };
      wings[x].rewards.push(colour.item);
      if (cfg.scarceRecovery) wings[y].rewards.push(colour.item);
      if (HubPlanner.winningOrder(wings, hubItems)) {
        scarce.push(colour.item);
        used.add(x);
        used.add(y);
        if (opening) spare.splice(spare.indexOf(colour), 1);
      } else {
        wings.forEach((w, i) => {
          w.gate = kept[i].gate;
          w.rewards = kept[i].rewards;
        });
        hubItems.splice(0, hubItems.length, ...keptHub);
      }
    }
    return scarce;
  }

  /**
   * Searches the orders in which the wings can be opened for one that wins:
   * a door spends a key of its colour, a hazard needs its boots, a puzzle needs
   * the boots it requires, and what lies in a wing is kept once it is opened.
   * The final wing comes last. Null when no order wins. Orders are tried in the
   * plan's own order first, so a plan that wins as drawn keeps it.
   */
  public static winningOrder(wings: HubWing[], hubItems: string[]): number[] | null {
    const count = wings.length;
    const dead = new Set<string>();
    const walk = (done: number[], keys: Map<string, number>, boots: Set<string>): number[] | null => {
      if (done.length === count) return done;
      const state = `${done.slice().sort().join()}|${[...keys].filter(([, n]) => n > 0).sort().join()}|${[...boots].sort().join()}`;
      if (dead.has(state)) return null;
      for (let i = 0; i < count; i++) {
        if (done.includes(i) || (wings[i].isFinal && done.length < count - 1)) continue;
        const wing = wings[i];
        const lock = wing.gate.config;
        if (wing.gate.kind === 'door' && lock && (keys.get(lock.item) ?? 0) < 1) continue;
        if (wing.gate.kind === 'hazard' && lock && !boots.has(lock.item)) continue;
        const needed = [wing.piece, ...wing.then].flatMap((p) => p.requires);
        if (needed.some((id) => ConfigRegistry.getTile(id).collectible === 'boot' && !boots.has(id))) continue;
        const nextKeys = new Map(keys);
        const nextBoots = new Set(boots);
        if (wing.gate.kind === 'door' && lock) nextKeys.set(lock.item, (nextKeys.get(lock.item) ?? 0) - 1);
        for (const id of wing.rewards) {
          if (ConfigRegistry.getTile(id).collectible === 'boot') nextBoots.add(id);
          else nextKeys.set(id, (nextKeys.get(id) ?? 0) + 1);
        }
        const found = walk([...done, i], nextKeys, nextBoots);
        if (found) return found;
      }
      dead.add(state);
      return null;
    };
    const keys = new Map<string, number>();
    for (const id of hubItems) {
      if (ConfigRegistry.getTile(id).collectible !== 'boot') keys.set(id, (keys.get(id) ?? 0) + 1);
    }
    return walk([], keys, new Set(hubItems));
  }

  /**
   * Swaps the largest puzzles for smaller ones of the same motif until their
   * boxes together fit the area the map can hold around a hub. A swap keeps the
   * highest tier it can; puzzles that have no smaller sibling stay.
   */
  private static fitToArea(
    puzzles: CompiledPiece[],
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    profile: DifficultyProfile,
    cfg: HubConfig
  ): CompiledPiece[] {
    const area = (p: CompiledPiece): number => p.width * p.height;
    const siblings = ProgressionPlanner.playablePieces(
      profile,
      library,
      rules,
      profile.maxTier,
      (piece) => HubPlanner.fitsLoopWing(piece, cfg)
    );
    const result = [...puzzles];
    const used = new Set(result.map((p) => p.id));
    for (;;) {
      if (result.reduce((sum, p) => sum + area(p), 0) <= cfg.puzzleAreaBudget) return result;
      let swap: { at: number; with: CompiledPiece } | null = null;
      result.forEach((piece, at) => {
        for (const alt of siblings) {
          if (alt.motif !== piece.motif || used.has(alt.id) || area(alt) >= area(piece)) continue;
          const better =
            !swap ||
            alt.tier > swap.with.tier ||
            (alt.tier === swap.with.tier && area(piece) - area(alt) > area(result[swap.at]) - area(swap.with));
          if (better) swap = { at, with: alt };
        }
      });
      if (!swap) return result;
      const chosen: { at: number; with: CompiledPiece } = swap;
      used.delete(result[chosen.at].id);
      used.add(chosen.with.id);
      result[chosen.at] = chosen.with;
    }
  }

  /**
   * Splits the puzzles into wings: chains of one to `maxPiecesPerWing` puzzles for
   * the loop wings, and the last puzzle alone in the final wing, which holds the exit.
   */
  private static chainGroups(pieces: CompiledPiece[], cfg: HubConfig, rng: SeededRandom): CompiledPiece[][] {
    const groups: CompiledPiece[][] = [];
    const chained = pieces.slice(0, -1);
    for (let at = 0; at < chained.length; ) {
      const size = rng.nextInt(1, Math.min(cfg.maxPiecesPerWing, chained.length - at));
      groups.push(chained.slice(at, at + size));
      at += size;
    }
    groups.push(pieces.slice(-1));
    return groups;
  }

  private static stealsBoots(piece: CompiledPiece): boolean {
    return piece.terrain.some((row) => row.some((id) => ConfigRegistry.getTile(id).stealsBoots));
  }
}
