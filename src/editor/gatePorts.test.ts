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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { deviceRelations } from '../core/DeviceRelations';
import { checkSignalWiring } from '../core/signalChecks';
import type { CompiledLevel, LevelBlueprint, SignalLink, ValidationIssue } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import citadelLevels from '../../public/configs/citadel-levels.json';
import { describeEditorCell } from './cellDescription';
import { connectionRows, type ConnectionRow } from './connectionRows';
import { deviceOverlayFor } from './deviceOverlay';
import { cloneMap, type EditorMap } from './editorDocument';
import { appendSignalLink, setSignalLinks, swapSignalPorts, type SignalLinkHolder } from './editorSignalLinks';
import { swapGatePorts } from './signalPortEdits';
import { gateKindOfTile, PORT_ROLE_TAG_KEYS } from './signalPortRoles';

const SIZE = 8;
const SOURCE_A = { x: 1, y: 1 };
const SOURCE_B = { x: 1, y: 3 };
const GATE = { x: 3, y: 2 };
const SINK_A = { x: 6, y: 1 };
const SINK_B = { x: 6, y: 3 };

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

function holder(gate: string): SignalLinkHolder {
  const terrain: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
  terrain[SOURCE_A.y][SOURCE_A.x] = 'signal_plate';
  terrain[SOURCE_B.y][SOURCE_B.x] = 'signal_plate';
  terrain[GATE.y][GATE.x] = gate;
  terrain[SINK_A.y][SINK_A.x] = 'hold_door_red_closed';
  terrain[SINK_B.y][SINK_B.x] = 'hold_door_blue_closed';
  return { terrain };
}

function editorMap(map: SignalLinkHolder): EditorMap {
  return {
    terrain: map.terrain,
    items: map.terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 0, y: 0, dir: 'S' },
    ...(map.signalLinks ? { signalLinks: map.signalLinks } : {})
  };
}

function levelOf(map: SignalLinkHolder): CompiledLevel {
  return {
    id: 'ports',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 0, y: 0, dir: 'S' },
    terrain: map.terrain,
    items: map.terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(map.signalLinks ? { signalLinks: map.signalLinks } : {})
  };
}

const rowAt = (rows: ConnectionRow[], cell: { x: number; y: number }): ConnectionRow => {
  const row = rows.find((r) => r.x === cell.x && r.y === cell.y);
  if (!row) throw new Error('No row for the cell');
  return row;
};

describe('the role of each gate port in the Connections rows', () => {
  it('labels the wires into a data latch as data then clock, and offers a swap on the input side', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    const rows = connectionRows(levelOf(map), GATE.x, GATE.y).controlledBy?.rows ?? [];
    expect(rowAt(rows, SOURCE_A).ports).toEqual({ in: 'data' });
    expect(rowAt(rows, SOURCE_B).ports).toEqual({ in: 'clock' });
    expect(rowAt(rows, SOURCE_A).swaps).toEqual([{ cell: GATE, side: 'input' }]);
  });

  it('labels a counter wires as count up and count down in, overflow and underflow out', () => {
    const map = holder('signal_counter_3');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    appendSignalLink(map, GATE, SINK_A);
    appendSignalLink(map, GATE, SINK_B);
    const view = connectionRows(levelOf(map), GATE.x, GATE.y);
    expect(rowAt(view.controlledBy?.rows ?? [], SOURCE_A).ports).toEqual({ in: 'count_up' });
    expect(rowAt(view.controlledBy?.rows ?? [], SOURCE_B).ports).toEqual({ in: 'count_down' });
    expect(rowAt(view.controls?.rows ?? [], SINK_A).ports).toEqual({ out: 'overflow' });
    expect(rowAt(view.controls?.rows ?? [], SINK_B).ports).toEqual({ out: 'underflow' });
    expect(rowAt(view.controls?.rows ?? [], SINK_A).swaps).toEqual([{ cell: GATE, side: 'output' }]);
  });

  it('shows the same roles from the source side of the wire', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    const rows = connectionRows(levelOf(map), SOURCE_B.x, SOURCE_B.y).controls?.rows ?? [];
    expect(rowAt(rows, GATE).ports).toEqual({ in: 'clock' });
  });

  it('labels nothing on plain gates', () => {
    const map = holder('signal_gate_and');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    const rows = connectionRows(levelOf(map), GATE.x, GATE.y).controlledBy?.rows ?? [];
    for (const row of rows) {
      expect(row.ports).toBeUndefined();
      expect(row.swaps).toBeUndefined();
    }
  });
});

describe('swapSignalPorts', () => {
  const portsOf = (map: SignalLinkHolder): Array<[number, string | undefined]> => (map.signalLinks ?? []).map((l) => [l.fromY, l.port]);

  it('exchanges data and clock of a data latch', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    expect(swapSignalPorts(map, GATE, 'input')).toBe(2);
    expect(portsOf(map)).toEqual([[1, 'in1'], [3, 'in0']]);
    expect(swapSignalPorts(map, GATE, 'input')).toBe(2);
    expect(portsOf(map)).toEqual([[1, 'in0'], [3, 'in1']]);
  });

  it('moves a single wire to the other port', () => {
    const map = holder('signal_counter_0');
    appendSignalLink(map, SOURCE_A, GATE);
    swapSignalPorts(map, GATE, 'input');
    expect(portsOf(map)).toEqual([[1, 'in1']]);
  });

  it('swaps the outputs of a counter and keeps the input port of the other end', () => {
    const map = holder('signal_counter_0');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, GATE, SINK_A);
    appendSignalLink(map, GATE, SINK_B);
    swapSignalPorts(map, GATE, 'output');
    const out = (map.signalLinks ?? []).filter((l) => l.fromX === GATE.x).map((l) => [l.toY, l.port]);
    expect(out).toEqual([[1, 'out1'], [3, 'out0']]);
    expect((map.signalLinks ?? []).find((l) => l.toX === GATE.x)?.port).toBe('in0');
  });

  it('does nothing on a gate with no ordered ports, or on the wrong side', () => {
    const map = holder('signal_gate_and');
    appendSignalLink(map, SOURCE_A, GATE);
    expect(swapSignalPorts(map, GATE, 'input')).toBe(0);
    const latch = holder('signal_gate_dlatch');
    appendSignalLink(latch, SOURCE_A, GATE);
    expect(swapSignalPorts(latch, GATE, 'output')).toBe(0);
  });

  it('is one edit on a copy: the source map is untouched, and a CC3D room is refused', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    const source = editorMap(map);
    const before = JSON.stringify(source.signalLinks);
    const result = swapGatePorts(source, GATE, 'input');
    expect(result.changed).toBe(true);
    expect(JSON.stringify(source.signalLinks)).toBe(before);
    expect(result.map.signalLinks).not.toEqual(source.signalLinks);
    const plain = swapGatePorts(editorMap(holder('floor')), GATE, 'input');
    expect(plain.changed).toBe(false);
    expect(swapGatePorts({ ...cloneMap(source), cc3d: {} as never }, GATE, 'input').changed).toBe(false);
  });
});

describe('port tags on the overlay and in the hover description', () => {
  it('tags the ends of the wires of a data latch and a counter, and no other wire', () => {
    const latch = holder('signal_gate_dlatch');
    appendSignalLink(latch, SOURCE_A, GATE);
    appendSignalLink(latch, SOURCE_B, GATE);
    const level = levelOf(latch);
    const kindAt = (p: { x: number; y: number }): string | undefined => gateKindOfTile(level.terrain[p.y]?.[p.x]);
    const overlay = deviceOverlayFor(deviceRelations(level, GATE.x, GATE.y), GATE, kindAt);
    const tags = overlay.arrows.map((a) => [a.from.y, a.tags]);
    expect(tags).toEqual([
      [1, { to: PORT_ROLE_TAG_KEYS.data }],
      [3, { to: PORT_ROLE_TAG_KEYS.clock }]
    ]);
    const and = holder('signal_gate_and');
    appendSignalLink(and, SOURCE_A, GATE);
    const plainLevel = levelOf(and);
    const plain = deviceOverlayFor(deviceRelations(plainLevel, GATE.x, GATE.y), GATE, (p) => gateKindOfTile(plainLevel.terrain[p.y]?.[p.x]));
    expect(plain.arrows[0].tags).toBeUndefined();
    const noLookup = deviceOverlayFor(deviceRelations(level, GATE.x, GATE.y), GATE);
    expect(noLookup.arrows.every((a) => a.tags === undefined)).toBe(true);
  });

  it('keeps two wires of one pair on different ports as two arrows, tagged at both ends of a counter chain', () => {
    const map = holder('signal_counter_0');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, GATE, SINK_A);
    appendSignalLink(map, GATE, SINK_B);
    const level = levelOf(map);
    const overlay = deviceOverlayFor(deviceRelations(level, GATE.x, GATE.y), GATE, (p) => gateKindOfTile(level.terrain[p.y]?.[p.x]));
    const out = overlay.arrows.filter((a) => a.from.x === GATE.x).map((a) => a.tags?.from);
    expect(out).toEqual([PORT_ROLE_TAG_KEYS.overflow, PORT_ROLE_TAG_KEYS.underflow]);
  });

  it('puts the tags of two wires from one source to one latch on different lanes', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_A, GATE);
    const level = levelOf(map);
    expect(level.signalLinks?.map((l) => l.port)).toEqual(['in0', 'in1']);
    const overlay = deviceOverlayFor(deviceRelations(level, GATE.x, GATE.y), GATE, (p) => gateKindOfTile(level.terrain[p.y]?.[p.x]));
    expect(overlay.arrows.map((a) => [a.tags?.to, a.lane])).toEqual([
      [PORT_ROLE_TAG_KEYS.data, 0],
      [PORT_ROLE_TAG_KEYS.clock, 1]
    ]);
  });

  it('speaks the input roles of a latch and the output roles of a counter', () => {
    const latch = holder('signal_gate_dlatch');
    appendSignalLink(latch, SOURCE_A, GATE);
    appendSignalLink(latch, SOURCE_B, GATE);
    const spoken = describeEditorCell({ map: editorMap(latch), x: GATE.x, y: GATE.y }).map((p) => t(p.key, p.params));
    expect(spoken).toContain(`${t('editor.signal_ports.data.label')} input from (${SOURCE_A.x}, ${SOURCE_A.y})`);
    expect(spoken).toContain(`${t('editor.signal_ports.clock.label')} input from (${SOURCE_B.x}, ${SOURCE_B.y})`);
    const counter = holder('signal_counter_0');
    appendSignalLink(counter, GATE, SINK_A);
    appendSignalLink(counter, GATE, SINK_B);
    const outs = describeEditorCell({ map: editorMap(counter), x: GATE.x, y: GATE.y }).map((p) => t(p.key, p.params));
    expect(outs).toContain(`${t('editor.signal_ports.overflow.label')} output to (${SINK_A.x}, ${SINK_A.y})`);
    expect(outs).toContain(`${t('editor.signal_ports.underflow.label')} output to (${SINK_B.x}, ${SINK_B.y})`);
    const quiet = describeEditorCell({ map: editorMap(holder('signal_gate_and')), x: GATE.x, y: GATE.y });
    expect(quiet.some((p) => p.key.includes('port_'))).toBe(false);
  });
});

describe('arity warnings of the data latch and the counter', () => {
  const keysFor = (gate: string, links: SignalLink[]): string[] => {
    const map = holder(gate);
    setSignalLinks(map, [...links, { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y }]);
    const issues: ValidationIssue[] = [];
    checkSignalWiring(levelOf(map), issues);
    return issues.map((i) => i.i18nKey);
  };
  const wire = (from: { x: number; y: number }, port?: string): SignalLink => ({
    fromX: from.x,
    fromY: from.y,
    toX: GATE.x,
    toY: GATE.y,
    ...(port ? { port } : {})
  });

  it('warns about a data latch without a clock, and one without data', () => {
    expect(keysFor('signal_gate_dlatch', [wire(SOURCE_A, 'in0')])).toContain('validator.issues.signal_dlatch_no_clock.label');
    expect(keysFor('signal_gate_dlatch', [wire(SOURCE_A, 'in1')])).toContain('validator.issues.signal_dlatch_no_data.label');
    expect(keysFor('signal_gate_dlatch', [wire(SOURCE_A, 'in1')])).not.toContain('validator.issues.signal_dlatch_no_clock.label');
  });

  it('accepts a data latch with both inputs, and keeps the existing error when there is no input', () => {
    const both = keysFor('signal_gate_dlatch', [wire(SOURCE_A, 'in0'), wire(SOURCE_B, 'in1')]);
    expect(both).not.toContain('validator.issues.signal_dlatch_no_clock.label');
    expect(both).not.toContain('validator.issues.signal_dlatch_no_data.label');
    const none = keysFor('signal_gate_dlatch', []);
    expect(none).toContain('validator.issues.signal_gate_no_input.label');
    expect(none).not.toContain('validator.issues.signal_dlatch_no_clock.label');
  });

  it('warns about a counter that only counts down, not about one that counts up', () => {
    // Counting down with nothing on the underflow output does nothing.
    expect(keysFor('signal_counter_2', [wire(SOURCE_A, 'in1')])).toContain('validator.issues.signal_counter_no_up.label');
    expect(keysFor('signal_counter_2', [wire(SOURCE_A)])).not.toContain('validator.issues.signal_counter_no_up.label');
    expect(keysFor('signal_counter_2', [])).toContain('validator.issues.signal_gate_no_input.label');
  });

  it('accepts a counter that counts down only when its underflow output is wired', () => {
    const map = holder('signal_counter_2');
    setSignalLinks(map, [wire(SOURCE_A, 'in1'), { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y, port: 'out1' }]);
    const issues: ValidationIssue[] = [];
    checkSignalWiring(levelOf(map), issues);
    expect(issues.map((i) => i.i18nKey)).not.toContain('validator.issues.signal_counter_no_up.label');
    // An unported output is the overflow, which never fires on a counter that cannot count up.
    expect(keysFor('signal_counter_2', [wire(SOURCE_A, 'in1')])).toContain('validator.issues.signal_counter_no_up.label');
  });

  it('has the warnings in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      for (const code of ['signal_dlatch_no_clock', 'signal_dlatch_no_data', 'signal_counter_no_up']) {
        const key = `validator.issues.${code}.label`;
        expect(t(key, { x: 1, y: 2, count: 3 }), `${locale} ${code}`).not.toBe(key);
      }
    }
  });
});

describe('native levels keep their signal links', () => {
  it('carries no port on a native link, and shows no port role or swap on its rows', () => {
    const natives = (citadelLevels as unknown as { levels: LevelBlueprint[] }).levels.filter((l) => (l.signalLinks?.length ?? 0) > 0);
    expect(natives.length).toBeGreaterThan(0);
    for (const blueprint of natives) {
      const level = ConfigRegistry.compileBlueprint(blueprint);
      expect(level.signalLinks, blueprint.id).toEqual(blueprint.signalLinks);
      for (const link of level.signalLinks ?? []) {
        expect(link.port, blueprint.id).toBeUndefined();
        const rows = connectionRows(level, link.toX, link.toY).controlledBy?.rows ?? [];
        for (const row of rows) {
          expect(row.ports, blueprint.id).toBeUndefined();
          expect(row.swaps, blueprint.id).toBeUndefined();
        }
      }
    }
  });
});
