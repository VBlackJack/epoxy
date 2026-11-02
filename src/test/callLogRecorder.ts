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
 * A fake 2D context that records every canvas call and property assignment as one log line, and the
 * helpers that turn such a log into per-case hashes compared with a committed snapshot file. Used by
 * the call-log snapshot tests of the render styles.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, vi } from 'vitest';

const DIFF_DIR_FROM_ROOT = 'local/snapshot-diff';
const SECTION_PREFIX = '## ';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const ROUND_FACTOR = 10000;
const TEXT_WIDTH_PER_CHAR = 6;
const DEFAULT_CANVAS = { width: 300, height: 150 };

/** Collects the log lines of one case group; every context shares it so the order is global. */
export class CallLog {
  public readonly lines: string[] = [];
  private canvasCount = 0;
  private gradientCount = 0;

  public nextCanvasId(): number {
    return ++this.canvasCount;
  }

  public nextGradientId(): number {
    return ++this.gradientCount;
  }

  /** Starts a section; gradient numbers restart so identical drawings produce identical lines. */
  public section(title: string): void {
    this.gradientCount = 0;
    this.lines.push(`## ${title}`);
  }

  public text(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

interface Labelled {
  readonly label: string;
}

function isLabelled(value: unknown): value is Labelled {
  return typeof value === 'object' && value !== null && 'label' in value && typeof (value as Labelled).label === 'string';
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  const rounded = Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(',')}]`;
  if (isLabelled(value)) return value.label;
  return `<${typeof value}>`;
}

function formatArgs(args: readonly unknown[]): string {
  return args.map(formatValue).join(', ');
}

const INITIAL_PROPERTIES: Readonly<Record<string, unknown>> = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  filter: 'none'
};

export interface FakeCanvas {
  readonly label: string;
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D | null;
  toDataURL(): string;
}

/** A recording 2D context: every call and property assignment becomes one log line. */
function createRecordingContext(log: CallLog, canvas: FakeCanvas, prefix: string): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { ...INITIAL_PROPERTIES, canvas };
  let lineDash: number[] = [];
  const record = (line: string): void => {
    log.lines.push(prefix + line);
  };
  const gradient = (kind: string, args: unknown[]): Labelled & { addColorStop(offset: number, color: string): void } => {
    const label = `<${kind}#${log.nextGradientId()}>`;
    record(`${kind}(${formatArgs(args)}) -> ${label}`);
    return {
      label,
      addColorStop(offset: number, color: string): void {
        record(`${label}.addColorStop(${formatArgs([offset, color])})`);
      }
    };
  };

  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        switch (prop) {
          case 'createLinearGradient':
          case 'createRadialGradient':
            return gradient(prop, args);
          case 'createPattern': {
            const label = `<pattern#${log.nextGradientId()}>`;
            record(`createPattern(${formatArgs(args)}) -> ${label}`);
            return { label };
          }
          case 'measureText': {
            const width = String(args[0]).length * TEXT_WIDTH_PER_CHAR;
            record(`measureText(${formatArgs(args)}) -> ${width}`);
            return { width };
          }
          case 'getLineDash':
            return [...lineDash];
          case 'setLineDash':
            lineDash = [...(args[0] as number[])];
            record(`setLineDash(${formatArgs(args)})`);
            return undefined;
          default:
            record(`${prop}(${formatArgs(args)})`);
            return undefined;
        }
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      record(`${prop} = ${formatValue(value)}`);
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
}

/** A recorded main canvas context of the given size, whose lines carry no prefix. */
export function createMainContext(log: CallLog, width: number, height: number): CanvasRenderingContext2D {
  const canvas: FakeCanvas = {
    label: `<main ${width}x${height}>`,
    width,
    height,
    getContext: () => null,
    toDataURL: () => ''
  };
  const ctx = createRecordingContext(log, canvas, '');
  canvas.getContext = () => ctx;
  return ctx;
}

/** Makes `document.createElement('canvas')` hand out fake canvases with recorded contexts. */
export function installDocumentStub(log: CallLog): void {
  vi.stubGlobal('document', {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const id = log.nextCanvasId();
      let ctx: CanvasRenderingContext2D | null = null;
      const canvas: FakeCanvas = {
        get label() {
          return `<canvas#${id} ${canvas.width}x${canvas.height}>`;
        },
        width: DEFAULT_CANVAS.width,
        height: DEFAULT_CANVAS.height,
        getContext: () => {
          ctx ??= createRecordingContext(log, canvas, `[c${id}] `);
          return ctx;
        },
        toDataURL: () => `data:canvas#${id}`
      };
      return canvas;
    }
  });
}


export interface CaseLog {
  heading: string;
  text: string;
}

/** Splits a recorded log into its cases, one per section heading. */
export function splitCases(log: string): CaseLog[] {
  const cases: CaseLog[] = [];
  for (const line of log.split('\n')) {
    if (line.startsWith(SECTION_PREFIX)) cases.push({ heading: line.slice(SECTION_PREFIX.length), text: `${line}\n` });
    else if (cases.length > 0 && line !== '') cases[cases.length - 1].text += `${line}\n`;
  }
  return cases;
}

export function hashOf(text: string): string {
  return createHash(HASH_ALGORITHM).update(text).digest('hex').slice(0, HASH_HEX_LENGTH);
}

function safeFileName(heading: string): string {
  return heading.replace(/[^A-Za-z0-9._=-]+/g, '_');
}

function isUpdatingSnapshots(): boolean {
  const state = expect.getState() as unknown as { snapshotState?: { _updateSnapshot?: string } };
  return state.snapshotState?._updateSnapshot === 'all';
}

/**
 * Compares the case hashes of a recorded log with the committed snapshot file. On a mismatch the full
 * log of each failing case goes to `local/snapshot-diff/<group>/` and the assertion says so.
 */
export async function verifyCases(log: string, snapshotPath: string, testDir: string): Promise<void> {
  const cases = splitCases(log);
  expect(cases.length).toBeGreaterThan(0);
  const current = cases.map((c) => `${c.heading} ${hashOf(c.text)}`);
  const text = `${current.join('\n')}
`;
  const file = resolve(testDir, snapshotPath);
  if (existsSync(file) && !isUpdatingSnapshots()) {
    const expected = new Map(
      readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map((line) => [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)] as const)
    );
    const failing = cases.filter((c) => expected.get(c.heading) !== hashOf(c.text));
    const missing = [...expected.keys()].filter((heading) => !cases.some((c) => c.heading === heading));
    if (failing.length > 0 || missing.length > 0) {
      const group = safeFileName(snapshotPath.split('/').pop() ?? 'group');
      const dir = resolve(process.cwd(), DIFF_DIR_FROM_ROOT, group);
      mkdirSync(dir, { recursive: true });
      for (const c of failing) writeFileSync(resolve(dir, `${safeFileName(c.heading)}.txt`), c.text, 'utf-8');
      throw new Error(
        `${failing.length} case(s) differ and ${missing.length} case(s) vanished in ${snapshotPath}. ` +
          `Full current logs of the failing cases were written to ${DIFF_DIR_FROM_ROOT}/${group}/ ` +
          `(first: ${failing[0]?.heading ?? missing[0]}).`
      );
    }
  }
  await expect(text).toMatchFileSnapshot(snapshotPath);
}

