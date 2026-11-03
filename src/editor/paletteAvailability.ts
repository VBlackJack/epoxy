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

import { isLaserTileId, isMirrorEntityType } from '../core/RulesetFeatures';
import { Ruleset, WinRule } from '../core/types';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { EPOXY_ONLY_WIN_RULES } from './metadataFields';

/** Rulesets the editor can open: every ruleset the game plays. */
export type EditableRuleset = Ruleset;

/** i18n key of the reason given for anything only the Epoxy rules play. */
export const EPOXY_ONLY_REASON_KEY = 'editor.palette.unavailable.epoxy_only.label';

/** Whether a palette entry can be used, and if not, the i18n key that says why. */
export type Availability = { available: true } | { available: false; reasonKey: string };

const AVAILABLE: Availability = { available: true };
const EPOXY_ONLY: Availability = { available: false, reasonKey: EPOXY_ONLY_REASON_KEY };

/** Under Lynx everything that needs the Epoxy engine is out; under Epoxy everything is in. */
function epoxyOnlyUnless(ruleset: EditableRuleset, needsEpoxy: boolean): Availability {
  return ruleset === 'lynx' && needsEpoxy ? EPOXY_ONLY : AVAILABLE;
}

/** Availability of a tile (terrain or item id): laser emitters, receivers and gates need Epoxy rules. */
export function tileAvailability(ruleset: EditableRuleset, tileId: string): Availability {
  return epoxyOnlyUnless(ruleset, isLaserTileId(tileId));
}

/** Availability of an entity (block or monster id): laser mirrors need Epoxy rules. */
export function entityAvailability(ruleset: EditableRuleset, entityType: string): Availability {
  return epoxyOnlyUnless(ruleset, isMirrorEntityType(entityType));
}

/** Availability of a win rule: 'targets' and 'receivers' need Epoxy rules. */
export function winRuleAvailability(ruleset: EditableRuleset, winRule: WinRule): Availability {
  return epoxyOnlyUnless(ruleset, EPOXY_ONLY_WIN_RULES.includes(winRule));
}

/**
 * The ruleset most levels of the list use, a level with no ruleset counting as Epoxy. Epoxy wins a tie,
 * and an empty list; Lynx and CC3D each need strictly more levels than the others.
 */
export function majorityRuleset(levels: ReadonlyArray<{ ruleset?: Ruleset }>): EditableRuleset {
  let lynx = 0;
  let epoxy = 0;
  let cc3d = 0;
  for (const level of levels) {
    const ruleset = level.ruleset ?? DEFAULT_RULESET;
    if (ruleset === 'lynx') lynx++;
    else if (ruleset === 'cc3d') cc3d++;
    else epoxy++;
  }
  if (cc3d > lynx && cc3d > epoxy) return 'cc3d';
  return lynx > epoxy ? 'lynx' : 'epoxy';
}
