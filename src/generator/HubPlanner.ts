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
import { PieceSolver } from './PieceSolver';
import { CompiledPiece, MotifRule } from './PieceTypes';
import { LevelScript, ProgressionPlanner } from './ProgressionPlanner';

/** How a wing is closed: not at all, by a door, or by a hazard strip. */
export interface HubGate {
  kind: 'open' | 'door' | 'hazard';
  config?: HubGateConfig;
}

export interface HubWing {
  /** Unoriented; the assembler turns it so its entry faces the hub. */
  piece: CompiledPiece;
  gate: HubGate;
  /** Items left in the wing's reward room: what opens later wings. */
  rewards: string[];
  isFinal: boolean;
}

export interface HubPlan {
  /** In the order the proof visits them; the final wing, holding the exit, is last. */
  wings: HubWing[];
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
 * hazard, so the boots are always found first. Wing puzzles must be walkable
 * back (the player leaves a wing the way they came) and must not steal boots,
 * which later locks may need.
 */
export class HubPlanner {
  public static plan(
    levelNumber: number,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom,
    cfg: HubConfig,
    script?: LevelScript,
    piecesDropped = 0
  ): HubPlan {
    const selection = ProgressionPlanner.selectPuzzles(
      levelNumber,
      library,
      rules,
      rng,
      script,
      (p) => PieceSolver.isReversible(p) && !this.stealsBoots(p),
      piecesDropped
    );
    const pieces = selection.puzzles;
    // A lock whose item would make one of the level's puzzles trivial is not used:
    // boots carried into a matching hazard puzzle, a key matching a puzzle's doors.
    const spoiled = new Set(pieces.flatMap((p) => [...this.helpfulItems(p)].filter((id) => !p.requires.includes(id))));
    const unusedGates = [...cfg.doorGates, ...cfg.hazardGates].filter((g) => !spoiled.has(g.item));
    rng.shuffle(unusedGates);
    const wings: HubWing[] = [];
    const hubItems: string[] = [];
    const openCount = Math.max(1, Math.min(cfg.openWings, pieces.length - 1));

    pieces.forEach((piece, index) => {
      const isFinal = index === pieces.length - 1;
      const boots = piece.requires.find((id) => ConfigRegistry.getTile(id).collectible === 'boot');
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
      wings.push({ piece, gate, rewards: [], isFinal });
    });

    return { wings, hubItems, motifs: selection.motifs, finale: selection.finale };
  }

  /** Boots that tame a hazard of the piece and keys that open its doors. */
  private static helpfulItems(piece: CompiledPiece): Set<string> {
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

  private static stealsBoots(piece: CompiledPiece): boolean {
    return piece.terrain.some((row) => row.some((id) => ConfigRegistry.getTile(id).stealsBoots));
  }
}
