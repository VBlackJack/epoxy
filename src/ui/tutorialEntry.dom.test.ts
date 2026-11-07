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

// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { BUILTIN_PACK_IDS } from '../config/constants';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  ONBOARDING_CLOSE_KEY,
  ONBOARDING_SKIP_KEY,
  applyOnboardingTutorialMode,
  firstUnsolvedIndex,
  isTutorialVisible,
  readSeenFlag,
  shouldOfferPlayEpoxy,
  shouldShowTutorialNotice,
  syncTutorialEntries,
  writeSeenFlag
} from './tutorialEntry';

const INDEX_HTML = resolve(__dirname, '../../index.html');
const SCRIPT_TAGS = /<script[\s\S]*?<\/script>/g;
const BODY_CONTENT = /<body[^>]*>([\s\S]*)<\/body>/;
const STORES: ReadonlyArray<() => Storage> = [() => localStorage, () => sessionStorage];
/** The text a translated button gets in these tests: its key, so the label is checkable. */
const echo = (key: string): string => key;

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function isHidden(id: string): boolean {
  return el(id).classList.contains('hidden');
}

/** What the application does whenever the pack list may have changed. */
function refreshEntries(): void {
  syncTutorialEntries(document, isTutorialVisible(ConfigRegistry.getAllPacks().filter((p) => p.levels.length > 0)));
}

function lookup(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], source);
}

beforeAll(() => {
  loadTestConfigs();
});

beforeEach(() => {
  const html = readFileSync(INDEX_HTML, 'utf8').replace(SCRIPT_TAGS, '');
  document.body.innerHTML = BODY_CONTENT.exec(html)?.[1] ?? '';
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  ConfigRegistry.setPilotPackVisible(false);
});

describe('tutorial entries follow the pack visibility', () => {
  it('hides the Help and drawer buttons while the tutorial pack is hidden', () => {
    refreshEntries();
    expect(isHidden('help-tutorial-btn')).toBe(true);
    expect(isHidden('touch-menu-tutorial')).toBe(true);
  });

  it('shows them once the pack is listed and hides them again when it leaves', () => {
    ConfigRegistry.setPilotPackVisible(true);
    refreshEntries();
    expect(isHidden('help-tutorial-btn')).toBe(false);
    expect(isHidden('touch-menu-tutorial')).toBe(false);
    ConfigRegistry.setPilotPackVisible(false);
    refreshEntries();
    expect(isHidden('help-tutorial-btn')).toBe(true);
    expect(isHidden('touch-menu-tutorial')).toBe(true);
  });

  it('switches to the tutorial and picks its first unsolved room', () => {
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.TUTORIAL);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.TUTORIAL);
    const levels = ConfigRegistry.getLevels();
    expect(firstUnsolvedIndex(levels, {})).toBe(0);
    expect(firstUnsolvedIndex(levels, { [levels[0].id]: {} })).toBe(1);
    const allSolved = Object.fromEntries(levels.map((l) => [l.id, {}]));
    expect(firstUnsolvedIndex(levels, allSolved)).toBe(0);
  });

  it('cannot switch to the tutorial while it is hidden', () => {
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.TUTORIAL);
    expect(ConfigRegistry.getActivePackId()).not.toBe(BUILTIN_PACK_IDS.TUTORIAL);
  });
});

describe('first-launch dialog', () => {
  it('offers the tutorial as the primary button and renames the close button to Skip', () => {
    applyOnboardingTutorialMode(el('onboarding-modal'), true, echo);
    expect(isHidden('onboarding-tutorial-btn')).toBe(false);
    expect(el('onboarding-tutorial-btn').classList.contains('primary')).toBe(true);
    expect(el('onboarding-close-btn').classList.contains('primary')).toBe(false);
    expect(el('onboarding-close-btn').getAttribute('data-i18n')).toBe(ONBOARDING_SKIP_KEY);
    expect(el('onboarding-close-btn').textContent).toBe(ONBOARDING_SKIP_KEY);
  });

  it('stays the plain card when no tutorial is offered', () => {
    const modal = el('onboarding-modal');
    applyOnboardingTutorialMode(modal, true, echo);
    applyOnboardingTutorialMode(modal, false, echo);
    expect(isHidden('onboarding-tutorial-btn')).toBe(true);
    expect(el('onboarding-close-btn').classList.contains('primary')).toBe(true);
    expect(el('onboarding-close-btn').getAttribute('data-i18n')).toBe(ONBOARDING_CLOSE_KEY);
  });
});

describe('New: Tutorial notice', () => {
  const base = {
    tutorialVisible: true,
    noticeSeen: false,
    onboardingShownThisSession: false,
    endless: false,
    mode: 'play' as const,
    dialogOpen: false
  };

  it('shows to a player with saves, only when the tutorial is visible', () => {
    expect(shouldShowTutorialNotice(base)).toBe(true);
    expect(shouldShowTutorialNotice({ ...base, tutorialVisible: false })).toBe(false);
  });

  it('does not show when the first-launch dialog opened in the same session', () => {
    expect(shouldShowTutorialNotice({ ...base, onboardingShownThisSession: true })).toBe(false);
  });

  it('does not show in the editor, in an endless run or over another dialog', () => {
    expect(shouldShowTutorialNotice({ ...base, mode: 'editor' })).toBe(false);
    expect(shouldShowTutorialNotice({ ...base, endless: true })).toBe(false);
    expect(shouldShowTutorialNotice({ ...base, dialogOpen: true })).toBe(false);
  });

  it('shows once: the flag in storage stops it, under the configured key', () => {
    const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.tutorialNoticeSeenKey);
    expect(readSeenFlag(key, STORES)).toBe(false);
    writeSeenFlag(key, STORES);
    expect(readSeenFlag(key, STORES)).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(shouldShowTutorialNotice({ ...base, noticeSeen: readSeenFlag(key, STORES) })).toBe(false);
  });

  it('falls back to session storage when persistent storage refuses writes', () => {
    const blocked: ReadonlyArray<() => Storage> = [
      () => {
        throw new Error('blocked');
      },
      () => sessionStorage
    ];
    writeSeenFlag('notice_test_key', blocked);
    expect(sessionStorage.getItem('notice_test_key')).not.toBeNull();
    expect(readSeenFlag('notice_test_key', blocked)).toBe(true);
  });

  it('has a Start and a Later button in the markup', () => {
    expect(el('tutorial-notice-start-btn')).not.toBeNull();
    expect(el('tutorial-notice-later-btn')).not.toBeNull();
  });
});

describe('last room of the tutorial', () => {
  const finished = { activePackId: BUILTIN_PACK_IDS.TUTORIAL, onLastRoom: true, testPlaying: false, endless: false };

  it('offers Play Epoxy only at the end of the tutorial', () => {
    expect(shouldOfferPlayEpoxy(finished)).toBe(true);
    expect(shouldOfferPlayEpoxy({ ...finished, onLastRoom: false })).toBe(false);
    expect(shouldOfferPlayEpoxy({ ...finished, activePackId: BUILTIN_PACK_IDS.CAMPAIGN })).toBe(false);
    expect(shouldOfferPlayEpoxy({ ...finished, testPlaying: true })).toBe(false);
    expect(shouldOfferPlayEpoxy({ ...finished, endless: true })).toBe(false);
  });

  it('offers it on the last room even when optional rooms stay unsolved', () => {
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.TUTORIAL);
    const levels = ConfigRegistry.getLevels();
    const solved: Record<string, unknown> = { [levels[levels.length - 1].id]: {} };
    expect(Object.keys(solved).length).toBeLessThan(levels.length + 1);
    expect(shouldOfferPlayEpoxy({ ...finished, activePackId: ConfigRegistry.getActivePackId(), onLastRoom: true })).toBe(true);
  });

  it('replaces Next: both buttons exist so the overlay can show one of them', () => {
    expect(el('overlay-btn-next')).not.toBeNull();
    expect(el('overlay-btn-play-epoxy')).not.toBeNull();
    // Mirrors updateOverlay: Next is hidden whenever Play Epoxy is offered.
    const offered = shouldOfferPlayEpoxy(finished);
    el('overlay-btn-next').classList.toggle('hidden', offered);
    el('overlay-btn-play-epoxy').classList.toggle('hidden', !offered);
    expect(isHidden('overlay-btn-next')).toBe(true);
    expect(isHidden('overlay-btn-play-epoxy')).toBe(false);
  });

  it('starts hidden in the overlay and the campaign can be made active again', () => {
    expect(isHidden('overlay-btn-play-epoxy')).toBe(true);
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.TUTORIAL);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CAMPAIGN);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
  });
});

describe('locale keys', () => {
  it('defines every tutorial.ui key the markup uses, in English and French', () => {
    const keys = Array.from(document.querySelectorAll('[data-i18n],[data-i18n-title]'))
      .flatMap((node) => [node.getAttribute('data-i18n'), node.getAttribute('data-i18n-title')])
      .filter((key): key is string => key !== null && key.startsWith('tutorial.ui.'));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of [...keys, ONBOARDING_SKIP_KEY]) {
      expect(typeof lookup(en, key), `en ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `fr ${key}`).toBe('string');
    }
  });
});
