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

import { beforeEach, describe, expect, it } from 'vitest';
import { LevelMetrics, MECHANICS } from '../LevelMetrics';
import { LevelValidator } from '../LevelValidator';
import { CompiledLevel, LauncherLink } from '../types';
import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';

const TRIGGER_KEY = 'validator.issues.shot_trigger_no_link.label';
const UNLINKED_KEY = 'validator.issues.shot_launcher_unlinked.label';
const WALL_KEY = 'validator.issues.shot_launcher_faces_wall.label';
const LINK: LauncherLink = { buttonX: 1, buttonY: 1, launcherX: 3, launcherY: 1 };

/** A row with a trigger at x=1 and an east launcher at x=3, open floor to its right. */
function wired(links?: LauncherLink[]): CompiledLevel {
  const level = buildTestLevel(['#######', '#@....#', '#.....#', '#######']);
  level.terrain[1][1] = 'shot_trigger';
  level.terrain[1][3] = 'shot_launcher_e';
  return links ? { ...level, launcherLinks: links } : level;
}

const keys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);

beforeEach(() => {
  loadTestConfigs();
});

describe('shots: validator warnings', () => {
  it('warns about a trigger that fires nothing and a launcher no trigger is linked to', () => {
    const found = keys(wired());
    expect(found).toContain(TRIGGER_KEY);
    expect(found).toContain(UNLINKED_KEY);
  });

  it('is quiet about a wired pair', () => {
    const found = keys(wired([LINK]));
    expect(found).not.toContain(TRIGGER_KEY);
    expect(found).not.toContain(UNLINKED_KEY);
    expect(found).not.toContain(WALL_KEY);
  });

  it('warns about a launcher that faces a wall, and gives every shot warning the warning severity', () => {
    const level = wired([LINK]);
    level.terrain[1][4] = 'wall';
    const issues = LevelValidator.validate(level).issues;
    expect(issues.find((i) => i.i18nKey === WALL_KEY)?.severity).toBe('warning');
    const lone = LevelValidator.validate(wired()).issues;
    expect(lone.find((i) => i.i18nKey === TRIGGER_KEY)?.severity).toBe('warning');
    expect(lone.find((i) => i.i18nKey === UNLINKED_KEY)?.severity).toBe('warning');
  });

  it('has English and French messages that open with the warning prefix', () => {
    for (const key of ['shot_trigger_no_link', 'shot_launcher_unlinked', 'shot_launcher_faces_wall']) {
      expect(en.validator.issues[key as keyof typeof en.validator.issues].label.startsWith('Warning: ')).toBe(true);
      expect(fr.validator.issues[key as keyof typeof fr.validator.issues].label.startsWith('Avertissement : ')).toBe(true);
    }
  });
});

describe('shots: metrics and exports', () => {
  it('counts launchers, triggers and one-sided mirrors as laser mechanics', () => {
    expect(LevelMetrics.mechanicsOfElement('shot_launcher_n')).toContain(MECHANICS.LASERS);
    expect(LevelMetrics.mechanicsOfElement('shot_trigger')).toContain(MECHANICS.LASERS);
    expect(LevelMetrics.mechanicsOfElement('one_sided_mirror_ne')).toContain(MECHANICS.LASERS);
  });

  it('refuses a .DAT export for any level with shot content, even launchers hidden under a top', () => {
    expect(datRefusalReason(wired())).toBe('laser_content');
    const plain = buildTestLevel(['#####', '#@..#', '#####']);
    expect(datRefusalReason(plain)).toBeNull();
    expect(datRefusalReason({ ...plain, launcherLinks: [LINK] })).toBe('laser_content');
    const mirror = { ...plain, entities: [{ type: 'one_sided_mirror_sw', x: 2, y: 1, dir: 'E' as const }] };
    expect(datRefusalReason(mirror)).toBe('laser_content');
  });
});
