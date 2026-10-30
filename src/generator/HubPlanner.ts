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
import { helpfulItems } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece, MotifRule, PieceExchangeKind } from './PieceTypes';
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

/** Two puzzles of a plan where the first hands something to the second: a block pushed along, or a key. */
export interface HubDependency {
  exporter: string;
  consumer: string;
  kind: PieceExchangeKind;
  item?: string;
}

/** Fewest planned puzzles a dependency pair can be swapped into: the pair, and a plain final puzzle. */
const MIN_PIECES_FOR_PAIR = 3;
/** Divides a piece's area so that it only breaks ties between otherwise equal replacement slots. */
const AREA_TIEBREAK_SCALE = 10000;

export interface HubPlan {
  /** The final wing, holding the exit, is last. */
  wings: HubWing[];
  /** Exporter and consumer pairs of the plan; the consumer comes after the exporter in `order`. */
  dependencies: HubDependency[];
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
    const paired = loop
      ? HubPlanner.addDependencies(selection.puzzles, selection.motifs, library, rules, profile, cfg, rng)
      : { puzzles: selection.puzzles, motifs: selection.motifs, dependencies: [], bonds: new Set<number>() };
    const pieces = loop ? HubPlanner.fitToArea(paired.puzzles, library, rules, profile, cfg) : paired.puzzles;
    // A lock whose item would make one of the level's puzzles trivial is not used:
    // boots carried into a matching hazard puzzle, a key matching a puzzle's doors,
    // and the items the puzzles hand to one another.
    const spoiled = new Set(pieces.flatMap((p) => [...helpfulItems(p)].filter((id) => !p.requires.includes(id))));
    for (const p of pieces) {
      for (const exchange of [p.exports, p.imports]) {
        if (exchange?.kind === 'item' && exchange.item) spoiled.add(exchange.item);
      }
    }
    const unusedGates = [...cfg.doorGates, ...cfg.hazardGates].filter(
      (g) => !spoiled.has(g.item) && !(loop && g.item === cfg.returnGate.item)
    );
    rng.shuffle(unusedGates);
    const wings: HubWing[] = [];
    const hubItems: string[] = [];
    const groups = loop ? HubPlanner.chainGroups(pieces, cfg, rng, paired.bonds) : pieces.map((piece) => [piece]);
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
    return {
      wings,
      dependencies: paired.dependencies,
      order,
      scarce,
      hubItems,
      motifs: paired.motifs,
      finale: selection.finale
    };
  }

  /** Dependency pairs asked for at a difficulty: none under `fromPieces`, then one more per `piecesPerPair`, up to `max`. */
  public static dependencyCount(pieceCount: number, cfg: HubConfig): number {
    const rule = cfg.dependencies;
    if (pieceCount < rule.fromPieces) return 0;
    return Math.min(rule.max, 1 + Math.floor((pieceCount - rule.fromPieces) / rule.piecesPerPair));
  }

  /**
   * Swaps pairs of puzzles that depend on each other into a selection. An
   * exporter hands a block or a key over, a consumer needs it. A block pair is
   * bonded: the consumer follows the exporter in the same wing, the block being
   * pushed along the corridor between them. A key pair puts the consumer at a
   * later index, so the winning order visits the exporter first. A level gets
   * one block pair at most while key pairs are available. The pieces
   * replaced are those of motifs the level has several of, smallest first, and
   * monster arenas last; the final puzzle is never replaced. Returns the
   * puzzles, the focus motifs (those left without a puzzle dropped, the pairs'
   * motifs added while the motif budget has room) and the indices where a
   * bonded pair starts.
   */
  public static addDependencies(
    puzzles: CompiledPiece[],
    motifs: string[],
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    profile: DifficultyProfile,
    cfg: HubConfig,
    rng: SeededRandom
  ): { puzzles: CompiledPiece[]; motifs: string[]; dependencies: HubDependency[]; bonds: Set<number> } {
    const result = [...puzzles];
    const focus = [...motifs];
    const dependencies: HubDependency[] = [];
    const bonds = new Set<number>();
    const wanted = HubPlanner.dependencyCount(profile.pieceCount, cfg);
    if (wanted === 0 || result.length < MIN_PIECES_FOR_PAIR) return { puzzles: result, motifs: focus, dependencies, bonds };

    const pool = library.filter(
      (p) =>
        (p.exports !== null || p.imports !== null) &&
        rules[p.motif]?.role === undefined &&
        p.tier <= profile.maxTier &&
        HubPlanner.fitsLoopWing(p, cfg)
    );
    const couples = pool
      .filter((e) => e.exports)
      .flatMap((e) =>
        pool
          .filter((c) => c.imports && c.imports.kind === e.exports?.kind && c.imports.item === e.exports?.item)
          .map((c) => ({ exporter: e, consumer: c }))
      );
    rng.shuffle(couples);
    const used = new Set(result.map((p) => p.id));
    const taken = new Set<number>();
    // A block lane is the costliest to lay out: a level gets one, then key pairs, unless only block pairs are left.
    const itemCouples = couples.filter((c) => c.exporter.exports?.kind === 'item');
    for (const { exporter, consumer } of couples) {
      if (dependencies.length >= wanted) break;
      if (used.has(exporter.id) || used.has(consumer.id)) continue;
      const exchange = exporter.exports as NonNullable<CompiledPiece['exports']>;
      const blockTaken = dependencies.some((d) => d.kind === 'block');
      const itemLeft = itemCouples.some((c) => !used.has(c.exporter.id) && !used.has(c.consumer.id));
      if (exchange.kind === 'block' && blockTaken && itemLeft) continue;
      const slots = HubPlanner.replaceSlots(result, taken, exchange.kind === 'block', rng);
      if (!slots) break;
      const [at, later] = slots;
      result[at] = exporter;
      result[later] = consumer;
      used.add(exporter.id);
      used.add(consumer.id);
      taken.add(at);
      taken.add(later);
      if (exchange.kind === 'block') bonds.add(at);
      dependencies.push({ exporter: exporter.id, consumer: consumer.id, kind: exchange.kind, item: exchange.item });
    }
    // The lead motif is kept whatever happens: it names and themes the level.
    const kept = focus.filter((m, i) => i === 0 || result.some((p) => p.motif === m));
    for (const p of result) {
      if (kept.length >= profile.motifCount) break;
      if (!kept.includes(p.motif)) kept.push(p.motif);
    }
    return { puzzles: result, motifs: kept, dependencies, bonds };
  }

  /**
   * The two indices a pair replaces: never the final puzzle nor a slot already
   * taken; a bonded pair takes two neighbouring slots. Among the candidates,
   * puzzles of a motif the level has several of go first, monster arenas last,
   * smaller puzzles before larger ones (the level keeps its floor), ties broken at random.
   */
  private static replaceSlots(
    puzzles: CompiledPiece[],
    taken: Set<number>,
    bonded: boolean,
    rng: SeededRandom
  ): [number, number] | null {
    const counts = new Map<string, number>();
    for (const p of puzzles) counts.set(p.motif, (counts.get(p.motif) ?? 0) + 1);
    const cost = (index: number): number => {
      const piece = puzzles[index];
      const area = (piece.width * piece.height) / AREA_TIEBREAK_SCALE;
      return ((counts.get(piece.motif) ?? 0) > 1 ? 0 : 2) + (PieceSolver.hasMonsters(piece) ? 1 : 0) + area;
    };
    const free = puzzles.map((_, i) => i).filter((i) => i < puzzles.length - 1 && !taken.has(i));
    rng.shuffle(free);
    if (bonded) {
      const starts = free.filter((i) => free.includes(i + 1)).sort((a, b) => cost(a) + cost(a + 1) - cost(b) - cost(b + 1));
      return starts.length > 0 ? [starts[0], starts[0] + 1] : null;
    }
    const best = free.sort((a, b) => cost(a) - cost(b)).slice(0, 2);
    if (best.length < 2) return null;
    return best[0] < best[1] ? [best[0], best[1]] : [best[1], best[0]];
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
   * Inside a wing the puzzles come in chain order: a key a puzzle imports must
   * be held (and is spent when the puzzle's door consumes it), a key it exports
   * is gained, and a block it imports must come from the puzzle just before it.
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
        const nextKeys = new Map(keys);
        const nextBoots = new Set(boots);
        if (wing.gate.kind === 'door' && lock) nextKeys.set(lock.item, (nextKeys.get(lock.item) ?? 0) - 1);
        if (!HubPlanner.chainWins([wing.piece, ...wing.then], nextKeys, nextBoots)) continue;
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
   * Walks the puzzles of a wing in order with the inventory, which it updates:
   * false when a puzzle needs boots or an imported key the player lacks, or a
   * block that the puzzle before it does not push out.
   */
  private static chainWins(chain: CompiledPiece[], keys: Map<string, number>, boots: Set<string>): boolean {
    const isBoot = (id: string): boolean => ConfigRegistry.getTile(id).collectible === 'boot';
    let previous: CompiledPiece | null = null;
    for (const piece of chain) {
      if (piece.requires.some((id) => isBoot(id) && !boots.has(id))) return false;
      const imported = piece.imports;
      if (imported?.kind === 'block' && previous?.exports?.kind !== 'block') return false;
      if (imported?.kind === 'item' && imported.item) {
        if (isBoot(imported.item)) {
          if (!boots.has(imported.item)) return false;
        } else {
          if ((keys.get(imported.item) ?? 0) < 1) return false;
          if (HubPlanner.consumesKey(piece, imported.item)) keys.set(imported.item, (keys.get(imported.item) ?? 0) - 1);
        }
      }
      const exported = piece.exports;
      if (exported?.kind === 'item' && exported.item) {
        if (isBoot(exported.item)) boots.add(exported.item);
        else keys.set(exported.item, (keys.get(exported.item) ?? 0) + 1);
      }
      previous = piece;
    }
    return true;
  }

  /** Whether a door of the piece spends a key of this colour (a green door does not). */
  private static consumesKey(piece: CompiledPiece, item: string): boolean {
    return piece.terrain.some((row) =>
      row.some((id) => {
        const tile = ConfigRegistry.getTile(id);
        return tile.requiredKey === item && tile.consumesKey === true;
      })
    );
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
        // Exchange pieces have no siblings: the pair they belong to is kept as planned.
        if (piece.exports || piece.imports) return;
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
   * A bonded pair (`bonds` holds the index of its first puzzle) is never split: the
   * chain grows to take the second puzzle in, or gives both up to the next chain.
   */
  private static chainGroups(
    pieces: CompiledPiece[],
    cfg: HubConfig,
    rng: SeededRandom,
    bonds: Set<number> = new Set()
  ): CompiledPiece[][] {
    const groups: CompiledPiece[][] = [];
    const chained = pieces.slice(0, -1);
    const longest = Math.max(MIN_PIECES_FOR_PAIR - 1, cfg.maxPiecesPerWing);
    for (let at = 0; at < chained.length; ) {
      let size = rng.nextInt(1, Math.min(cfg.maxPiecesPerWing, chained.length - at));
      while (bonds.has(at + size - 1) && at + size < chained.length) {
        size = size < longest ? size + 1 : size - 1;
      }
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
