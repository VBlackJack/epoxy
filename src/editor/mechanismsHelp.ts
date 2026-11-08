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

import type { RelationKind, RelationSystem } from '../core/DeviceRelations';
import { GRAY_BUTTON_RADIUS } from '../core/coreConstants';
import type { MessageParams } from '../i18n/messageFormat';
import { SYSTEM_NAME_KEYS } from './connectionRows';

/**
 * The "How mechanisms work" card: one row per mechanism, with how its parts find each other (an explicit link,
 * the same colour or group, or the whole level) and what happens when a part is left alone. Pure: it names
 * things by locale key, the editor translates them.
 */

export interface MechanismHelpRow {
  system: RelationSystem;
  /** How the parts of the mechanism find each other. */
  kind: RelationKind;
  /** Locale key of the mechanism's name (shared with the Connections rows). */
  nameKey: string;
  /** Locale key of the sentence saying how the parts are tied together. */
  howKey: string;
  /** Locale key of the sentence saying what happens when a part has no partner. */
  unlinkedKey: string;
  /** Values for the placeholders of the two sentences. */
  params?: MessageParams;
  /** True when the Lynx line already says what an unlinked part does, so the "unlinked" sentence is left out. */
  lynxCoversUnlinked?: boolean;
}

/** Locale key of the heading line of the card. */
export const MECHANISMS_HELP_TITLE_KEY = 'editor.connections.help.title';
/** Locale key of the line naming the editor keys that work on mechanisms. */
export const MECHANISMS_HELP_KEYS_KEY = 'editor.connections.help.keys.label';
/** Locale key of the line on the narrower mechanisms of a Lynx level. */
export const MECHANISMS_HELP_LYNX_KEY = 'editor.connections.help.lynx.label';

/** Locale key of the footer of the CC3D card: which devices work only from the top layer of their cell. */
export const MECHANISMS_HELP_CC3D_TOP_LAYER_KEY = 'editor.connections.help.cc3d.top_layer.label';

/** One row of the CC3D card: a CC3D level stores no link, so every row says how its parts find each other by position or colour. */
export interface Cc3dMechanismHelpRow {
  /** The mechanism: the Connections system it shows, or one golem colour. */
  system: 'trap' | 'teleport' | 'clone' | 'laser' | 'toggle' | 'hold' | 'golem_blue' | 'golem_yellow';
  /** Locale key of the mechanism's name. */
  nameKey: string;
  /** Locale key of the sentence saying how the parts find each other and what they do. */
  howKey: string;
}

/** The CC3D card's rows, in the order of the mechanisms; literal keys, so the locale checks see them. */
export const CC3D_MECHANISM_HELP_ROWS: readonly Cc3dMechanismHelpRow[] = [
  { system: 'trap', nameKey: 'editor.connections.help.cc3d.trap.name', howKey: 'editor.connections.help.cc3d.trap.label' },
  { system: 'teleport', nameKey: 'editor.connections.help.cc3d.teleport.name', howKey: 'editor.connections.help.cc3d.teleport.label' },
  { system: 'clone', nameKey: 'editor.connections.help.cc3d.clone.name', howKey: 'editor.connections.help.cc3d.clone.label' },
  { system: 'laser', nameKey: 'editor.connections.help.cc3d.laser.name', howKey: 'editor.connections.help.cc3d.laser.label' },
  { system: 'toggle', nameKey: 'editor.connections.help.cc3d.toggle.name', howKey: 'editor.connections.help.cc3d.toggle.label' },
  { system: 'hold', nameKey: 'editor.connections.help.cc3d.hold.name', howKey: 'editor.connections.help.cc3d.hold.label' },
  { system: 'golem_blue', nameKey: 'editor.connections.help.cc3d.golem_blue.name', howKey: 'editor.connections.help.cc3d.golem_blue.label' },
  { system: 'golem_yellow', nameKey: 'editor.connections.help.cc3d.golem_yellow.name', howKey: 'editor.connections.help.cc3d.golem_yellow.label' }
];

/** The card's rows, in the order of the mechanisms; literal keys, so the locale checks see them. */
export const MECHANISM_HELP_ROWS: readonly MechanismHelpRow[] = [
  {
    system: 'trap',
    kind: 'link',
    nameKey: SYSTEM_NAME_KEYS.trap,
    howKey: 'editor.connections.help.system.trap.how.label',
    unlinkedKey: 'editor.connections.help.system.trap.unlinked.label',
    lynxCoversUnlinked: true
  },
  {
    system: 'clone',
    kind: 'link',
    nameKey: SYSTEM_NAME_KEYS.clone,
    howKey: 'editor.connections.help.system.clone.how.label',
    unlinkedKey: 'editor.connections.help.system.clone.unlinked.label',
    lynxCoversUnlinked: true
  },
  {
    system: 'shot',
    kind: 'link',
    nameKey: SYSTEM_NAME_KEYS.shot,
    howKey: 'editor.connections.help.system.shot.how.label',
    unlinkedKey: 'editor.connections.help.system.shot.unlinked.label'
  },
  {
    system: 'signal',
    kind: 'link',
    nameKey: SYSTEM_NAME_KEYS.signal,
    howKey: 'editor.connections.help.system.signal.how.label',
    unlinkedKey: 'editor.connections.help.system.signal.unlinked.label'
  },
  {
    system: 'plate',
    kind: 'colour',
    nameKey: SYSTEM_NAME_KEYS.plate,
    howKey: 'editor.connections.help.system.plate.how.label',
    unlinkedKey: 'editor.connections.help.system.plate.unlinked.label'
  },
  {
    system: 'toggle',
    kind: 'colour',
    nameKey: SYSTEM_NAME_KEYS.toggle,
    howKey: 'editor.connections.help.system.toggle.how.label',
    unlinkedKey: 'editor.connections.help.system.toggle.unlinked.label'
  },
  {
    system: 'teleport',
    kind: 'colour',
    nameKey: SYSTEM_NAME_KEYS.teleport,
    howKey: 'editor.connections.help.system.teleport.how.label',
    unlinkedKey: 'editor.connections.help.system.teleport.unlinked.label'
  },
  {
    system: 'laser',
    kind: 'colour',
    nameKey: SYSTEM_NAME_KEYS.laser,
    howKey: 'editor.connections.help.system.laser.how.label',
    unlinkedKey: 'editor.connections.help.system.laser.unlinked.label'
  },
  {
    system: 'tank',
    kind: 'level',
    nameKey: SYSTEM_NAME_KEYS.tank,
    howKey: 'editor.connections.help.system.tank.how.label',
    unlinkedKey: 'editor.connections.help.system.tank.unlinked.label'
  },
  {
    system: 'flame',
    kind: 'level',
    nameKey: SYSTEM_NAME_KEYS.flame,
    howKey: 'editor.connections.help.system.flame.how.label',
    unlinkedKey: 'editor.connections.help.system.flame.unlinked.label'
  },
  {
    system: 'swap',
    kind: 'level',
    nameKey: SYSTEM_NAME_KEYS.swap,
    howKey: 'editor.connections.help.system.swap.how.label',
    unlinkedKey: 'editor.connections.help.system.swap.unlinked.label',
    params: { radius: GRAY_BUTTON_RADIUS }
  },
  {
    system: 'puppet',
    kind: 'level',
    nameKey: SYSTEM_NAME_KEYS.puppet,
    howKey: 'editor.connections.help.system.puppet.how.label',
    unlinkedKey: 'editor.connections.help.system.puppet.unlinked.label'
  }
];

/** One row of the authoring part of the card: a mechanism the editor places or edits without a link of its own. */
export interface AuthoringHelpRow {
  /** Stable id, carried by the row element. */
  id: 'track' | 'ports' | 'chain' | 'canopy' | 'players';
  /** Locale key of the mechanism's name. */
  nameKey: string;
  /** Locale key of the sentence saying how to place or configure it. */
  howKey: string;
}

/**
 * The Epoxy-rules rows that follow the link mechanisms: Chip's Challenge 2 track cells, gate ports, chain pushing,
 * the canopy and several players. Literal keys, so the locale checks see them.
 */
export const AUTHORING_HELP_ROWS: readonly AuthoringHelpRow[] = [
  { id: 'track', nameKey: 'editor.connections.help.authoring.track.name', howKey: 'editor.connections.help.authoring.track.label' },
  { id: 'ports', nameKey: 'editor.connections.help.authoring.ports.name', howKey: 'editor.connections.help.authoring.ports.label' },
  { id: 'chain', nameKey: 'editor.connections.help.authoring.chain.name', howKey: 'editor.connections.help.authoring.chain.label' },
  { id: 'canopy', nameKey: 'editor.connections.help.authoring.canopy.name', howKey: 'editor.connections.help.authoring.canopy.label' },
  { id: 'players', nameKey: 'editor.connections.help.authoring.players.name', howKey: 'editor.connections.help.authoring.players.label' }
];
