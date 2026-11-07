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

import { BUILTIN_PACK_IDS } from '../config/constants';

/**
 * Entry points of the built-in tutorial: the Help and phone drawer buttons, the first-launch
 * dialog buttons, the one-time notice and the "Play Epoxy" action of the last room. Every
 * entry shows only while the tutorial pack is listed, so the pack becoming public needs no UI work.
 */

const HIDDEN_CLASS = 'hidden';
/** Marks a control that exists only while the tutorial pack is visible. */
export const TUTORIAL_ENTRY_ATTR = 'data-tutorial-entry';
/** Marks a control of the first-launch dialog that only a visible tutorial adds. */
export const ONBOARDING_TUTORIAL_ATTR = 'data-onboarding-tutorial';
/** Locale key of the first-launch close button when the tutorial is offered ("Skip"). */
export const ONBOARDING_SKIP_KEY = 'tutorial.ui.onboarding.skip.action';
/** Locale key of the first-launch close button when there is no tutorial. */
export const ONBOARDING_CLOSE_KEY = 'hud.onboarding_modal.close_btn.action';
/** Value stored once a one-time dialog (first-launch card, tutorial notice) was shown. */
export const SEEN_FLAG_VALUE = '1';

/** True when the tutorial pack is among the packs on offer. */
export function isTutorialVisible(packs: ReadonlyArray<{ id: string }>): boolean {
  return packs.some((pack) => pack.id === BUILTIN_PACK_IDS.TUTORIAL);
}

/** Shows or hides every tutorial entry under `root`. */
export function syncTutorialEntries(root: ParentNode, visible: boolean): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${TUTORIAL_ENTRY_ATTR}]`))) {
    el.classList.toggle(HIDDEN_CLASS, !visible);
  }
}

/**
 * Dresses the first-launch dialog: with a visible tutorial the primary button starts it and
 * the close button reads "Skip"; without one the dialog is the plain "How to play" card.
 * `translate` turns a locale key into text.
 */
export function applyOnboardingTutorialMode(
  modal: ParentNode,
  tutorialOffered: boolean,
  translate: (key: string) => string
): void {
  for (const el of Array.from(modal.querySelectorAll<HTMLElement>(`[${ONBOARDING_TUTORIAL_ATTR}]`))) {
    el.classList.toggle(HIDDEN_CLASS, !tutorialOffered);
  }
  const close = modal.querySelector<HTMLElement>('#onboarding-close-btn');
  if (!close) return;
  const key = tutorialOffered ? ONBOARDING_SKIP_KEY : ONBOARDING_CLOSE_KEY;
  close.setAttribute('data-i18n', key);
  close.textContent = translate(key);
  close.classList.toggle('primary', !tutorialOffered);
}

/** Index of the first room not solved yet, or 0 when all are (or none is). */
export function firstUnsolvedIndex(levels: ReadonlyArray<{ id: string }>, solved: Readonly<Record<string, unknown>>): number {
  const index = levels.findIndex((level) => !solved[level.id]);
  return index < 0 ? 0 : index;
}

/** What decides whether the one-time "New: Tutorial" notice opens. */
export interface TutorialNoticeContext {
  tutorialVisible: boolean;
  /** The notice flag was read from storage or set earlier in this session. */
  noticeSeen: boolean;
  /** The first-launch dialog opened in this session: it already offers the tutorial. */
  onboardingShownThisSession: boolean;
  endless: boolean;
  mode: 'play' | 'editor';
  /** Another dialog is already open. */
  dialogOpen: boolean;
}

/** The notice shows once to a player who did not get the first-launch offer, saves or not. */
export function shouldShowTutorialNotice(context: TutorialNoticeContext): boolean {
  if (!context.tutorialVisible || context.noticeSeen || context.onboardingShownThisSession) return false;
  if (context.endless || context.dialogOpen) return false;
  return context.mode === 'play';
}

/** True when any of the stores holds the key; a blocked store is skipped. */
export function readSeenFlag(key: string, stores: ReadonlyArray<() => Storage>): boolean {
  for (const store of stores) {
    try {
      if (store().getItem(key) !== null) return true;
    } catch {
      // Storage blocked: try the next one
    }
  }
  return false;
}

/** Stores the flag in the first store that accepts writes. */
export function writeSeenFlag(key: string, stores: ReadonlyArray<() => Storage>): void {
  for (const store of stores) {
    try {
      store().setItem(key, SEEN_FLAG_VALUE);
      return;
    } catch {
      // Storage blocked: try the next one
    }
  }
}

/** What decides whether the won-room overlay offers "Play Epoxy". */
export interface PlayEpoxyContext {
  activePackId: string;
  /** The room just won is the last of the pack (later chapters are optional, so no need to solve them all). */
  onLastRoom: boolean;
  testPlaying: boolean;
  endless: boolean;
}

/** Only the end of the tutorial hands the player over to the campaign. */
export function shouldOfferPlayEpoxy(context: PlayEpoxyContext): boolean {
  return (
    context.activePackId === BUILTIN_PACK_IDS.TUTORIAL &&
    context.onLastRoom &&
    !context.testPlaying &&
    !context.endless
  );
}
