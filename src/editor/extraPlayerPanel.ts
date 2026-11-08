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
 * The Cell section panel of the start of another player: the choice of its character and a button that removes it.
 * Every edit goes through extraPlayerEdits and the editor history.
 */

import { PLAYER_CHARACTERS } from '../core/coreConstants';
import { t } from '../i18n/I18nManager';
import { CELL_FOCUS_ATTRIBUTE, CELL_FOCUS_FALLBACK_ATTRIBUTE, type CellPanel, type CellPanelHost } from './cellPanel';
import type { EditorDocument } from './editorDocument';
import { extraPlayerAt } from './editorExtraPlayers';
import { CHARACTER_NAME_KEYS, removeExtraPlayerAt, setExtraPlayerCharacter } from './extraPlayerEdits';

/** Name of the radio group of the character. */
const CHARACTER_RADIO_NAME = 'editor-extra-player-character';

const HEADING_KEY = 'editor.extra_players.heading';
const LEGEND_KEY = 'editor.extra_players.character.legend';
const REMOVE_KEY = 'editor.extra_players.remove.action';
const ROTATE_HINT_KEY = 'editor.extra_players.rotate.hint';
const CHARACTER_STATUS_KEY = 'editor.extra_players.status.character.label';
const REMOVED_STATUS_KEY = 'editor.extra_players.status.removed.label';

/** Class names of the panel parts (styled in style.css, shared with the track cell panel). */
const PANEL_CLASS = 'editor-rail-panel editor-extra-player-panel';
const HEADING_CLASS = 'editor-rail-heading';
const CHOICE_CLASS = 'editor-rail-active';

export class ExtraPlayerPanel implements CellPanel {
  constructor(private readonly host: CellPanelHost, private readonly getDoc: () => EditorDocument) {}

  public render(doc: EditorDocument, x: number, y: number): HTMLElement | null {
    const player = doc.cc3d ? undefined : extraPlayerAt(doc, x, y);
    if (!player) return null;
    const root = document.createElement('div');
    root.className = PANEL_CLASS;

    const heading = document.createElement('h4');
    heading.className = HEADING_CLASS;
    heading.textContent = t(HEADING_KEY, { x, y });
    root.appendChild(heading);

    const fieldset = document.createElement('fieldset');
    fieldset.className = CHOICE_CLASS;
    const legend = document.createElement('legend');
    legend.textContent = t(LEGEND_KEY);
    fieldset.appendChild(legend);
    for (const character of PLAYER_CHARACTERS) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = CHARACTER_RADIO_NAME;
      radio.value = character;
      radio.checked = player.character === character;
      radio.setAttribute(CELL_FOCUS_ATTRIBUTE, `character-${character}`);
      if (player.character === character) radio.setAttribute(CELL_FOCUS_FALLBACK_ATTRIBUTE, '');
      const name = t(CHARACTER_NAME_KEYS[character]);
      radio.addEventListener('change', () => {
        const map = setExtraPlayerCharacter(this.getDoc(), x, y, character);
        if (map) this.host.commit(map, [{ key: CHARACTER_STATUS_KEY, params: { x, y, name } }]);
      });
      label.append(radio, ` ${name}`);
      fieldset.appendChild(label);
    }
    root.appendChild(fieldset);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'hud-btn small';
    remove.dataset.action = 'remove-extra-player';
    remove.setAttribute(CELL_FOCUS_ATTRIBUTE, 'remove');
    remove.textContent = t(REMOVE_KEY);
    remove.addEventListener('click', () => {
      const map = removeExtraPlayerAt(this.getDoc(), x, y);
      if (map) this.host.commit(map, [{ key: REMOVED_STATUS_KEY, params: { x, y } }]);
    });
    root.appendChild(remove);

    const hint = document.createElement('p');
    hint.className = 'hint-text';
    hint.textContent = t(ROTATE_HINT_KEY);
    root.appendChild(hint);
    return root;
  }
}
