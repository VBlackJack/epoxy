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

/**
 * The prefix of every validator message must tell the severity the core emits for it. The table below is read from
 * LevelValidator.ts and cc3dValidator.ts and kept fixed: a key added there must be added here, or the coverage test fails.
 * The `_proven` keys are left out: their severity is chosen at run time (a warning when a stored solution wins).
 */

import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

type Severity = 'error' | 'warning' | 'info';

const ERR: Severity = 'error';
const WARN: Severity = 'warning';
const INFO: Severity = 'info';

// A new validator.issues key must be added here with the severity that core emits.
const EMITTED_SEVERITY: Record<string, Severity> = {
  no_exit: ERR, missing_chips: ERR, no_matching_key: ERR, fewer_keys_than_doors: WARN, unreachable_chips: ERR,
  unreachable_exit: ERR, socket_bypass: ERR, invalid_start: ERR, no_start: ERR, no_targets: ERR, fewer_blocks_than_targets: ERR,
  no_emitter: ERR, no_receiver: ERR,
  targets_unsolvable: WARN, hidden_by_block: WARN, laser_gate_on_beam: WARN, exit_on_receivers_level: WARN,
  start_on_wall: WARN, start_on_entity: WARN, trap_link_button: WARN, trap_link_target: WARN,
  clone_link_button: WARN, clone_link_target: WARN,
  channel_button_no_walls: WARN, channel_walls_no_button: WARN, hold_door_no_plate: WARN, hold_door_wrong_start: WARN,
  steering_pad_no_puppet: WARN, puppet_no_steering_pad: WARN, puppet_no_steering_pad_nowhere: WARN, lurker_not_on_floor: WARN, wisp_cloned: ERR,
  rail_track_empty: WARN,
  shot_trigger_no_link: WARN, shot_launcher_unlinked: WARN, shot_launcher_faces_wall: WARN,
  trap_button_no_trap: INFO, clone_button_nothing: INFO,
  trap_no_button: INFO, teleport_alone: WARN, teleport_alone_plain: WARN, gate_no_pair: WARN, relay_pad_dark_unlinked: INFO, relay_group_alone: INFO, laser_gate_no_receiver: WARN,
  flame_jets_no_button: INFO, swivel_sealed: INFO, arrow_block_locked: INFO, turn_plate_idle: INFO, rail_switch_no_button: INFO,
  signal_sink_inputs: ERR, signal_colour_mixed: ERR, signal_not_inputs: ERR, signal_gate_no_input: ERR,
  signal_cycle: ERR, signal_link_dangling: WARN, signal_source_unlinked: WARN,
  signal_world_loop_odd: ERR, signal_world_loop_even: WARN,
  signal_pulse_door: WARN, signal_cloner_self_feed: WARN,
  cc3d_bad_grid: ERR, cc3d_empty_stack: ERR, cc3d_unknown_terrain: ERR, cc3d_base_not_floor: ERR, cc3d_stack_order: ERR,
  cc3d_duplicate_layer: ERR, cc3d_missing_color: ERR, cc3d_missing_dir: ERR, cc3d_missing_corner: ERR,
  cc3d_missing_mirror: ERR, cc3d_invalid_value: ERR, cc3d_unknown_item: ERR, cc3d_unknown_mob: ERR,
  cc3d_mob_off_grid: ERR, cc3d_two_mobs: ERR, cc3d_no_player: ERR, cc3d_player_off_grid: ERR, cc3d_no_exit: ERR,
  cc3d_trap_control_no_trap: WARN, cc3d_clone_switch_no_machine: WARN, cc3d_machine_no_template: WARN,
  cc3d_toggle_control_no_door: WARN, cc3d_plate_no_door: WARN, cc3d_golem_control_no_golem: WARN,
  cc3d_laser_controller_no_shooter: WARN, cc3d_key_no_door: WARN, cc3d_single_teleport: WARN,
  cc3d_start_on_blocker: WARN, cc3d_start_on_hazard: WARN,
  cc2_unsupported: ERR
};

const RUNTIME_SEVERITY_KEYS = ['unreachable_chips_proven', 'unreachable_exit_proven'];

const PREFIXES: Record<'en' | 'fr', Record<Severity, string[]>> = {
  en: { error: ['Error: '], warning: ['Warning: '], info: ['Info: '] },
  fr: { error: ['Erreur : '], warning: ['Attention : ', 'Avertissement : '], info: ['Info : '] }
};

const messages = { en: en.validator.issues, fr: fr.validator.issues } as unknown as Record<
  'en' | 'fr',
  Record<string, { label: string }>
>;

describe('validator message prefixes', () => {
  it('covers every validator.issues key, once', () => {
    const covered = [...Object.keys(EMITTED_SEVERITY), ...RUNTIME_SEVERITY_KEYS].sort();
    expect(Object.keys(messages.en).sort()).toEqual(covered);
    expect(Object.keys(messages.fr).sort()).toEqual(covered);
  });

  for (const locale of ['en', 'fr'] as const) {
    it(`opens each ${locale} message with the prefix of the severity the core emits`, () => {
      for (const [key, severity] of Object.entries(EMITTED_SEVERITY)) {
        const label = messages[locale][key].label;
        expect(
          PREFIXES[locale][severity].some((prefix) => label.startsWith(prefix)),
          `${locale} ${key}`
        ).toBe(true);
      }
    });
  }
});
