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

import type { PlayEngine } from '../core/PlayEngine';
import type { PlayerCharacter } from '../core/types';

/** The character a level is played with when it names none. */
const FALLBACK_CHARACTER: PlayerCharacter = 'chip';

/** Display name of each character. */
const CHARACTER_NAME_KEYS: Readonly<Record<PlayerCharacter, string>> = {
  chip: 'hud.players.character_chip.label',
  melinda: 'hud.players.character_melinda.label'
};

/** Message shown (and announced by the status live region) after a swap. */
export const SWAP_DONE_KEY = 'hud.messages.swap_done.label';
/** Message shown when the swap key is pressed and nobody can take over. */
export const SWAP_REFUSED_KEY = 'hud.messages.swap_refused.label';
/** The HUD line naming the controlled player. */
export const PLAYER_CURRENT_KEY = 'hud.players.current.label';
/** The HUD line counting the players on the map and the ones that left. */
export const PLAYER_SUMMARY_KEY = 'hud.players.summary.label';

/** True when the level has several players, so that the swap key, its buttons and the players HUD apply. */
export function hasSeveralPlayers(engine: PlayEngine): boolean {
  return (engine.getLevel().extraPlayers?.length ?? 0) > 0;
}

/** What the HUD shows about the players of a level with several. */
export interface PlayersState {
  /** The controlled player's character. */
  character: PlayerCharacter;
  /** i18n key of the controlled player's name. */
  nameKey: string;
  /** Players still on the map, the controlled one included. */
  remaining: number;
  /** Players that already left through an exit. */
  exited: number;
}

/** The players state of the engine; null on a level with one player. */
export function playersState(engine: PlayEngine): PlayersState | null {
  if (!hasSeveralPlayers(engine)) return null;
  const character = engine.getPlayer().character ?? engine.getPlayerCharacter?.() ?? engine.getLevel().character ?? FALLBACK_CHARACTER;
  return {
    character,
    nameKey: CHARACTER_NAME_KEYS[character],
    remaining: 1 + (engine.getParkedPlayers?.()?.length ?? 0),
    exited: engine.getExitedPlayers?.() ?? 0
  };
}

export type SwapOutcome =
  | { kind: 'unavailable' }
  | { kind: 'refused' }
  | { kind: 'swapped'; state: PlayersState };

/**
 * Presses the swap key on the engine. A level with one player ignores it ('unavailable': nothing is shown);
 * a level with several refuses it while nobody else can take over, the engine is paused or the level ended.
 */
export function swapPlayers(engine: PlayEngine): SwapOutcome {
  if (!hasSeveralPlayers(engine) || engine.swapPlayer === undefined) return { kind: 'unavailable' };
  if (!engine.swapPlayer()) return { kind: 'refused' };
  const state = playersState(engine);
  return state === null ? { kind: 'unavailable' } : { kind: 'swapped', state };
}

/** The elements of the players HUD. */
export interface PlayersHudElements {
  container: HTMLElement | null;
  portrait: HTMLImageElement | null;
  current: HTMLElement | null;
  summary: HTMLElement | null;
  /** Every swap button (HUD and touch strip), shown only on a level with several players. */
  swapButtons: ReadonlyArray<HTMLElement | null>;
}

/** Class that takes an element out of the page. */
const HIDDEN_CLASS = 'hidden';

/**
 * Writes the players state to the HUD and the swap buttons. Everything is hidden on a level with one player,
 * and a swap button is disabled while nobody else is on the map. Returns true when a swap button is shown.
 */
export function renderPlayersHud(
  els: PlayersHudElements,
  state: PlayersState | null,
  text: (key: string, params?: Record<string, string | number>) => string,
  portraitUrl: string
): boolean {
  const shown = state !== null;
  els.container?.classList.toggle(HIDDEN_CLASS, !shown);
  for (const button of els.swapButtons) {
    if (!button) continue;
    button.classList.toggle(HIDDEN_CLASS, !shown);
    if (button instanceof HTMLButtonElement) button.disabled = !shown || state.remaining < 2;
  }
  if (state === null) return false;
  const name = text(state.nameKey);
  if (els.current) els.current.textContent = text(PLAYER_CURRENT_KEY, { name });
  if (els.summary) els.summary.textContent = text(PLAYER_SUMMARY_KEY, { remaining: state.remaining, exited: state.exited });
  if (els.portrait && portraitUrl !== '' && els.portrait.getAttribute('src') !== portraitUrl) els.portrait.src = portraitUrl;
  return true;
}
