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
 * The Cell section panel of a Chip's Challenge 2 track cell: six toggles, one per track segment, drawn as small icons;
 * a choice of the open segment when the cell holds two or more (that makes it a switch); and a button that clears the
 * cell. Every edit goes through railTrackEdits and the editor history.
 */

import { RAIL_TRACK_COUNT } from '../core/coreConstants';
import type { Direction } from '../core/types';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { t } from '../i18n/I18nManager';
import { CELL_FOCUS_ATTRIBUTE, CELL_FOCUS_FALLBACK_ATTRIBUTE, type CellPanel, type CellPanelHost } from './cellPanel';
import type { EditorDocument } from './editorDocument';
import { canHoldSwitch, clearRailTracksAt, railTrackAt, segmentsOfMask, setRailActiveSegment, sidesOfSegment, toggleRailSegment } from './railTrackEdits';

/** Side of the icon grid of a segment, in the units of its view box. */
const ICON_SIZE = 24;
const ICON_MID = ICON_SIZE / 2;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_STROKE_WIDTH = 3;

/** Name of the radio group of the open segment. */
const ACTIVE_RADIO_NAME = 'editor-rail-active';

/** The i18n key of the name of each segment, in mask order (see RAIL_TRACK_SIDES). */
const SEGMENT_NAME_KEYS: readonly string[] = [
  'editor.rail_tracks.segment.ne.label',
  'editor.rail_tracks.segment.se.label',
  'editor.rail_tracks.segment.sw.label',
  'editor.rail_tracks.segment.nw.label',
  'editor.rail_tracks.segment.ew.label',
  'editor.rail_tracks.segment.ns.label'
];

const HEADING_KEY = 'editor.rail_tracks.heading';
const SEGMENTS_LABEL_KEY = 'editor.rail_tracks.segments.label';
const EMPTY_KEY = 'editor.rail_tracks.empty.note';
const ACTIVE_LEGEND_KEY = 'editor.rail_tracks.active.legend';
const ACTIVE_NONE_KEY = 'editor.rail_tracks.active.none.label';
const CLEAR_KEY = 'editor.rail_tracks.clear.action';
const ROTATE_HINT_KEY = 'editor.rail_tracks.rotate.hint';

/** Class names of the panel parts (styled in style.css). */
const PANEL_CLASS = 'editor-rail-panel';
const SEGMENTS_CLASS = 'editor-rail-segments';
const SEGMENT_CLASS = 'editor-rail-segment';
const ACTIVE_CLASS = 'editor-rail-active';
const HEADING_CLASS = 'editor-rail-heading';

/** The middle of the edge of the icon a side is on. */
function edgePoint(side: Direction): [number, number] {
  switch (side) {
    case 'N':
      return [ICON_MID, 0];
    case 'S':
      return [ICON_MID, ICON_SIZE];
    case 'E':
      return [ICON_SIZE, ICON_MID];
    default:
      return [0, ICON_MID];
  }
}

/** The path of a segment: a straight line between opposite sides, a bend through the middle between adjacent ones. */
function segmentPath(segment: number): string {
  const [a, b] = sidesOfSegment(segment);
  const [ax, ay] = edgePoint(a);
  const [bx, by] = edgePoint(b);
  const straight = ax === bx || ay === by;
  return straight ? `M${ax} ${ay} L${bx} ${by}` : `M${ax} ${ay} Q${ICON_MID} ${ICON_MID} ${bx} ${by}`;
}

/** The icon of a segment: its path on a square, drawn in the colour of the text. */
export function segmentIcon(segment: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ICON_SIZE} ${ICON_SIZE}`);
  svg.setAttribute('width', String(ICON_SIZE));
  svg.setAttribute('height', String(ICON_SIZE));
  svg.setAttribute('aria-hidden', 'true');
  const frame = document.createElementNS(SVG_NS, 'rect');
  frame.setAttribute('width', String(ICON_SIZE));
  frame.setAttribute('height', String(ICON_SIZE));
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', 'currentColor');
  frame.setAttribute('stroke-opacity', '0.3');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', segmentPath(segment));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', String(ICON_STROKE_WIDTH));
  path.setAttribute('stroke-linecap', 'round');
  svg.append(frame, path);
  return svg;
}

export class RailTrackPanel implements CellPanel {
  constructor(private readonly host: CellPanelHost, private readonly getDoc: () => EditorDocument) {}

  public render(doc: EditorDocument, x: number, y: number): HTMLElement | null {
    const topId = doc.terrain[y]?.[x];
    if (doc.cc3d || topId === undefined || !ConfigRegistry.isTerrainTile(topId) || ConfigRegistry.getTile(topId).railJunction !== true) return null;
    const entry = railTrackAt(doc, x, y);
    const mask = entry?.mask ?? 0;
    const root = document.createElement('div');
    root.className = PANEL_CLASS;

    const heading = document.createElement('h4');
    heading.className = HEADING_CLASS;
    heading.textContent = t(HEADING_KEY, { x, y });
    root.appendChild(heading);

    const group = document.createElement('div');
    group.className = SEGMENTS_CLASS;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(SEGMENTS_LABEL_KEY));
    for (let segment = 0; segment < RAIL_TRACK_COUNT; segment++) {
      const on = (mask & (1 << segment)) !== 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = SEGMENT_CLASS;
      button.dataset.segment = String(segment);
      button.setAttribute(CELL_FOCUS_ATTRIBUTE, `segment-${segment}`);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', t(SEGMENT_NAME_KEYS[segment]));
      button.title = t(SEGMENT_NAME_KEYS[segment]);
      if (segment === 0) button.setAttribute(CELL_FOCUS_FALLBACK_ATTRIBUTE, '');
      button.appendChild(segmentIcon(segment));
      button.addEventListener('click', () =>
        this.apply(toggleRailSegment(this.getDoc(), x, y, segment), {
          key: on ? 'editor.rail_tracks.status.segment_off.label' : 'editor.rail_tracks.status.segment_on.label',
          params: { x, y, segment: t(SEGMENT_NAME_KEYS[segment]) }
        })
      );
      group.appendChild(button);
    }
    root.appendChild(group);

    if (mask === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint-text';
      empty.textContent = t(EMPTY_KEY);
      root.appendChild(empty);
    }

    if (canHoldSwitch(mask)) root.appendChild(this.activeChoice(x, y, mask, entry?.active));

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'hud-btn small';
    clear.dataset.action = 'clear';
    clear.setAttribute(CELL_FOCUS_ATTRIBUTE, 'clear');
    clear.disabled = mask === 0;
    clear.textContent = t(CLEAR_KEY);
    clear.addEventListener('click', () => this.apply(clearRailTracksAt(this.getDoc(), x, y), { key: 'editor.rail_tracks.status.cleared.label', params: { x, y } }));
    root.appendChild(clear);

    const hint = document.createElement('p');
    hint.className = 'hint-text';
    hint.textContent = t(ROTATE_HINT_KEY);
    root.appendChild(hint);
    return root;
  }

  /** The choice of the open segment of a switch: no switch, or one of the segments the cell holds. */
  private activeChoice(x: number, y: number, mask: number, active: number | undefined): HTMLElement {
    const fieldset = document.createElement('fieldset');
    fieldset.className = ACTIVE_CLASS;
    const legend = document.createElement('legend');
    legend.textContent = t(ACTIVE_LEGEND_KEY);
    fieldset.appendChild(legend);
    const options: Array<{ segment: number | null; label: string }> = [
      { segment: null, label: t(ACTIVE_NONE_KEY) },
      ...segmentsOfMask(mask).map((segment) => ({ segment, label: t(SEGMENT_NAME_KEYS[segment]) }))
    ];
    for (const option of options) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = ACTIVE_RADIO_NAME;
      radio.value = option.segment === null ? '' : String(option.segment);
      radio.checked = (active ?? null) === option.segment;
      radio.setAttribute(CELL_FOCUS_ATTRIBUTE, `active-${option.segment ?? 'none'}`);
      radio.addEventListener('change', () =>
        this.apply(setRailActiveSegment(this.getDoc(), x, y, option.segment), {
          key: option.segment === null ? 'editor.rail_tracks.status.switch_none.label' : 'editor.rail_tracks.status.switch.label',
          params: { x, y, segment: option.label }
        })
      );
      label.append(radio, ` ${option.label}`);
      fieldset.appendChild(label);
    }
    return fieldset;
  }

  private apply(map: ReturnType<typeof toggleRailSegment>, message: { key: string; params: Record<string, string | number> }): void {
    if (map) this.host.commit(map, [message]);
  }
}
