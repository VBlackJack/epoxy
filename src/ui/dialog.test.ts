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

import { describe, expect, it } from 'vitest';
import { FOCUSABLE_SELECTOR, getFocusableElements } from './dialog';

interface FakeNode {
  name: string;
  tagName: string;
  open: boolean;
  parentElement: FakeNode | null;
  closest: (selector: string) => FakeNode | null;
  getClientRects: () => { length: number };
}

/** A minimal element: only what the focus trap reads. Every node reports a box, as Chrome does inside a closed details. */
function node(name: string, tagName: string, parent: FakeNode | null = null, open = true): FakeNode {
  const self: FakeNode = {
    name,
    tagName,
    open,
    parentElement: parent,
    closest: (selector: string) => {
      let cur: FakeNode | null = self;
      while (cur) {
        if (selector === 'details' && cur.tagName === 'DETAILS') return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    getClientRects: () => ({ length: 1 })
  };
  return self;
}

/** The names getFocusableElements keeps among the given nodes. */
function focusableNames(nodes: FakeNode[]): { names: string[]; selectors: string[] } {
  const selectors: string[] = [];
  const container = {
    querySelectorAll: (selector: string) => {
      selectors.push(selector);
      return nodes;
    }
  } as unknown as HTMLElement;
  return { names: getFocusableElements(container).map((el) => (el as unknown as FakeNode).name), selectors };
}

describe('getFocusableElements', () => {
  it('asks for the summary of a native details element', () => {
    expect(FOCUSABLE_SELECTOR.split(',')).toContain('details > summary:first-of-type');
  });

  it('keeps the summary of a closed details and drops its inner select', () => {
    const details = node('details', 'DETAILS', null, false);
    const result = focusableNames([node('summary', 'SUMMARY', details), node('select', 'SELECT', details)]);
    expect(result.names).toEqual(['summary']);
    expect(result.selectors).toEqual([FOCUSABLE_SELECTOR]);
  });

  it('keeps both the summary and the inner select of an open details', () => {
    const details = node('details', 'DETAILS', null, true);
    const result = focusableNames([node('summary', 'SUMMARY', details), node('select', 'SELECT', details)]);
    expect(result.names).toEqual(['summary', 'select']);
  });

  it('hides the content of a closed nested details, summary included, but keeps the outer summary', () => {
    const outer = node('outer', 'DETAILS', null, false);
    const inner = node('inner', 'DETAILS', outer, true);
    const result = focusableNames([
      node('outer-summary', 'SUMMARY', outer),
      node('inner-summary', 'SUMMARY', inner),
      node('inner-select', 'SELECT', inner)
    ]);
    expect(result.names).toEqual(['outer-summary']);
  });

  it('hides only the closed inner details content when the outer one is open', () => {
    const outer = node('outer', 'DETAILS', null, true);
    const inner = node('inner', 'DETAILS', outer, false);
    const result = focusableNames([
      node('inner-summary', 'SUMMARY', inner),
      node('inner-select', 'SELECT', inner),
      node('outer-button', 'BUTTON', outer)
    ]);
    expect(result.names).toEqual(['inner-summary', 'outer-button']);
  });
});
