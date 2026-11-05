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
import type { CloneLink, TrapLink } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { i18n, t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { DAT_MAX_CLONE_LINKS, DAT_MAX_TRAP_LINKS, datLinkCapNotice } from './datLinkCap';

const trapLinks = (count: number): TrapLink[] =>
  Array.from({ length: count }, (_, i) => ({ buttonX: 1, buttonY: 1, trapX: 2 + (i % 8), trapY: 1 + Math.floor(i / 8) }));
const cloneLinks = (count: number): CloneLink[] =>
  Array.from({ length: count }, (_, i) => ({ buttonX: 1, buttonY: 1, clonerX: 2 + (i % 8), clonerY: 1 + Math.floor(i / 8), templateType: 'dirt_block', templateDir: 'S' }));

describe('datLinkCapNotice', () => {
  beforeEach(() => {
    loadTestConfigs();
    i18n.setLocale('en');
  });

  it('says nothing while every link fits', () => {
    expect(datLinkCapNotice({ trapLinks: trapLinks(DAT_MAX_TRAP_LINKS), cloneLinks: cloneLinks(DAT_MAX_CLONE_LINKS) })).toBeNull();
  });

  it('counts the trap and the clone links over the cap, in both languages', () => {
    const level = { trapLinks: trapLinks(DAT_MAX_TRAP_LINKS + 3), cloneLinks: cloneLinks(DAT_MAX_CLONE_LINKS + 1) };
    const en = datLinkCapNotice(level) ?? '';
    expect(en).toContain(t('app.export.trap_links_capped.label', { max: DAT_MAX_TRAP_LINKS, count: 3 }));
    expect(en).toContain(t('app.export.clone_links_capped.label', { max: DAT_MAX_CLONE_LINKS, count: 1 }));
    i18n.setLocale('fr');
    const fr = datLinkCapNotice(level);
    expect(fr).toBe(
      'Export .CCL avec pertes : le format .DAT garde au plus 25 liens de piège, 3 ont été laissés de côté. ' +
        'Export .CCL avec pertes : le format .DAT garde au plus 31 liens de clonage, 1 a été laissé de côté.'
    );
    expect(fr).not.toBe(en);
  });

  it('matches what the codec really keeps', () => {
    // The codec writes a one-byte length per link field: the caps must stay equal to what it keeps.
    const [encoded] = DatCodec.decodeBuffer(
      DatCodec.encodeLevelsWithReport([
        {
          id: 'cap',
          number: 1,
          password: 'CAPS',
          timeLimitSeconds: 0,
          chipsRequired: 0,
          customTitle: 'cap',
          playerStart: { x: 1, y: 1, dir: 'S' },
          terrain: Array.from({ length: 32 }, (_, y) =>
            Array.from({ length: 32 }, (_, x) => (x === 0 || y === 0 || x === 31 || y === 31 ? 'wall' : 'floor'))
          ),
          items: Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => null as string | null)),
          entities: [],
          trapLinks: trapLinks(DAT_MAX_TRAP_LINKS + 5),
          cloneLinks: cloneLinks(DAT_MAX_CLONE_LINKS + 5)
        }
      ]).bytes.slice().buffer,
      'cap',
      'lynx'
    );
    expect(encoded.trapLinks).toHaveLength(DAT_MAX_TRAP_LINKS);
    expect(encoded.cloneLinks).toHaveLength(DAT_MAX_CLONE_LINKS);
  });
});
