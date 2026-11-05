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

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../style.css'), 'utf8');

interface Rule {
  selectors: string[];
  media: string[];
  body: string;
}

/** Minimal scanner: style rules with their enclosing @media/@supports prelude. Keyframes are skipped. */
function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const stack: string[] = [];
  let prelude = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const head = prelude.replace(/\s+/g, ' ').trim();
      prelude = '';
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        stack.push(head);
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      if (!head.startsWith('@')) {
        rules.push({
          selectors: head.split(',').map((x) => x.trim()),
          media: [...stack],
          body: text.slice(i + 1, j - 1),
        });
      }
      i = j;
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
      i++;
    } else {
      prelude += ch;
      i++;
    }
  }
  return rules;
}

const RULES = parseRules(CSS);

const PORTRAIT_MEDIA = '(max-width: 980px) and (orientation: portrait)';

/** Style rules whose selector list mentions the given selector text. */
function rulesFor(selector: string) {
  return RULES.filter((r) => r.selectors.some((s) => s.includes(selector)));
}

/** Declaration value of a property in a rule body, or null. */
function decl(body: string, property: string): string | null {
  const match = new RegExp(String.raw`(?:^|[;\s])${property}\s*:\s*([^;]+)`).exec(body);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

describe('landscape board layout (text checks)', () => {
  it('the scanner reaches rules inside media queries', () => {
    expect(rulesFor('.viewport-wrapper').some((r) => r.media.length > 0)).toBe(true);
  });

  it('no wrapper rule outside the classic portrait query keeps a square aspect ratio', () => {
    const offenders = rulesFor('.viewport-wrapper').filter((r) => {
      const ratio = decl(r.body, 'aspect-ratio');
      return ratio !== null && /^1(\s*\/\s*1)?$/.test(ratio) && !r.media.some((m) => m.includes(PORTRAIT_MEDIA));
    });
    expect(offenders).toEqual([]);
  });

  it('the classic portrait query keeps the board square', () => {
    const portrait = rulesFor('.viewport-wrapper').filter((r) => r.media.some((m) => m.includes(PORTRAIT_MEDIA)));
    expect(portrait.length).toBeGreaterThan(0);
    for (const rule of portrait) expect(decl(rule.body, 'aspect-ratio')).toBe('1');
  });

  it('the landscape phone board size variable is gone', () => {
    expect(CSS).not.toContain('--land-board-size');
  });

  it('the wrapper and the overlay screen paint the board backdrop variable', () => {
    const wrapper = RULES.find((r) => r.selectors.includes('.viewport-wrapper') && r.media.length === 0);
    expect(wrapper && decl(wrapper.body, 'background')).toBe('var(--board-backdrop, #000)');
    const overlay = RULES.find((r) => r.selectors.includes('body.touch-overlay .play-shell .lcd-screen'));
    expect(overlay && decl(overlay.body, 'background')).toBe('var(--board-backdrop, #000)');
  });

  it('the desktop board has an explicit clamped width and a height from one variable chain', () => {
    const desktop = RULES.find((r) => r.selectors.includes('.play-shell .viewport-wrapper') && r.media.length === 0);
    expect(desktop).toBeDefined();
    const body = desktop!.body;
    expect(decl(body, 'height')).toBe('var(--board-h)');
    const width = decl(body, 'width') ?? '';
    expect(width).toMatch(/^clamp\(/);
    expect(width).toContain('var(--board-fit-width)');
    expect(width).not.toBe('auto');
    expect(decl(body, 'aspect-ratio')).toBeNull();
    expect(decl(body, '--board-h')).toContain('3 / 4');
  });

  it('the classic landscape chrome height covers the real top chrome', () => {
    expect(CSS).toMatch(/--land-chrome-height:\s*51px;/);
  });

  it('the classic landscape phone grid gives the board the flexible column', () => {
    const grid = RULES.find((r) => r.selectors.includes('.lcd-screen') && decl(r.body, 'grid-template-columns') !== null && r.media.some((m) => m.includes('orientation: landscape')));
    expect(grid && decl(grid.body, 'grid-template-columns')).toBe(
      'var(--land-pad-col) minmax(0, 1fr) var(--land-hud-min)',
    );
  });

  it('the hint banner and the status toast are capped and centred', () => {
    for (const selector of ['.hint-banner', '.status-toast']) {
      const rule = RULES.find((r) => r.selectors.includes(selector) && r.media.length === 0);
      expect(rule, selector).toBeDefined();
      expect(decl(rule!.body, 'max-width'), selector).toBe('min(calc(100% - 16px), 40rem)');
      expect(decl(rule!.body, 'margin-inline'), selector).toBe('auto');
    }
  });
});
