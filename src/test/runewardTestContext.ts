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
 * Test helper: a 2D context that records every call and property assignment as one line, with
 * gradients reduced to a label, so two drawings can be compared as plain text.
 */

export interface RecordedContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly lines: string[];
}

const ROUND_FACTOR = 10000;

function formatArg(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * ROUND_FACTOR) / ROUND_FACTOR);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null && 'label' in value) return String((value as { label: string }).label);
  return String(value);
}

/** Creates a recording context; `lines` fills as the drawing runs. */
export function createRecordedContext(): RecordedContext {
  const lines: string[] = [];
  let gradients = 0;
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        lines.push(`${prop}(${args.map(formatArg).join(', ')})`);
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          gradients += 1;
          const label = `<gradient#${gradients}>`;
          return {
            label,
            addColorStop: (offset: number, color: string): number => lines.push(`${label}.stop(${offset}, ${color})`)
          };
        }
        return undefined;
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      lines.push(`${prop} = ${formatArg(value)}`);
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, lines };
}

/** Number of recorded calls to the named method. */
export function countCalls(lines: readonly string[], method: string): number {
  return lines.filter((line) => line.startsWith(`${method}(`)).length;
}
