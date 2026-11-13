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

/** A level file may not hold an id only the engine creates (a rolling ball, a picked-up yellow pad). */

import { beforeEach, describe, expect, it } from 'vitest';

import { loadTestConfigs } from '../test/loadTestConfigs';
import { ROOM_ROW, room } from '../test/cc2Room';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { MECHANICS_PARAM } from './coreConstants';
import { LevelValidator, runtimeOnlyIds } from './LevelValidator';

const ISSUE_KEY = 'validator.issues.runtime_only.label';
const RUNTIME_ENTITY = 'rolling_ball';
const RUNTIME_ITEM = 'teleport_yellow_item';

beforeEach(() => {
  loadTestConfigs();
});

describe('runtime-only ids in a level file', () => {
  it('refuses a runtime-only entity and item, listing them sorted and once', () => {
    const level = room({ mode: 'native', items: { [`4,${ROOM_ROW}`]: RUNTIME_ITEM }, entities: [
      { type: RUNTIME_ENTITY, x: 6, y: ROOM_ROW, dir: 'E' },
      { type: RUNTIME_ENTITY, x: 7, y: ROOM_ROW, dir: 'E' }
    ] });
    expect(runtimeOnlyIds(level)).toEqual([RUNTIME_ENTITY, RUNTIME_ITEM]);
    const report = LevelValidator.validate(level);
    const issue = report.issues.find((candidate) => candidate.i18nKey === ISSUE_KEY);
    expect(issue?.severity).toBe('error');
    expect(issue?.params?.[MECHANICS_PARAM]).toBe([RUNTIME_ENTITY, RUNTIME_ITEM].join(','));
    expect(report.valid).toBe(false);
  });

  it('refuses a runtime-only clone template', () => {
    const level = room({ mode: 'native' });
    level.cloneLinks = [{ buttonX: 2, buttonY: 2, machineX: 3, machineY: 3, templateType: RUNTIME_ENTITY } as never];
    expect(runtimeOnlyIds(level)).toEqual([RUNTIME_ENTITY]);
  });

  it('is absent from a level that holds none', () => {
    const level = room({ mode: 'cc2', entities: [{ type: 'glider', x: 6, y: ROOM_ROW, dir: 'E' }] });
    expect(runtimeOnlyIds(level)).toEqual([]);
    expect(LevelValidator.validate(level).issues.some((candidate) => candidate.i18nKey === ISSUE_KEY)).toBe(false);
  });

  it('has a message in both locales that names the elements', () => {
    for (const locale of [en, fr] as unknown as Array<{ validator: { issues: { runtime_only: { label: string } } } }>) {
      expect(locale.validator.issues.runtime_only.label).toContain(`{${MECHANICS_PARAM}}`);
    }
  });
});
