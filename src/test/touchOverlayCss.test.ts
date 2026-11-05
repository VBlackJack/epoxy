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

/** A style rule with the media queries it sits in. */
interface CssRule {
  selectors: string[];
  media: string[];
  body: string;
}

/** At-rules whose block holds style rules: the parser looks inside them. */
const NESTING_AT_RULES = ['@media', '@supports', '@container', '@layer', '@scope', '@document'];

/**
 * Splits a stylesheet into style rules, tracking the enclosing at-rules. Comments and strings are
 * skipped, statements such as @import and @charset are dropped, and blocks of at-rules that hold
 * no style rules (@keyframes, @font-face...) are skipped.
 */
export function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let prelude = '';
  let i = 0;

  const readString = (quote: string): string => {
    let out = quote;
    i++;
    while (i < css.length) {
      const ch = css[i];
      out += ch;
      i++;
      if (ch === '\\') {
        out += css[i] ?? '';
        i++;
      } else if (ch === quote) break;
    }
    return out;
  };
  const skipComment = (): void => {
    const end = css.indexOf('*/', i + 2);
    i = end < 0 ? css.length : end + 2;
  };
  /** Reads a block body up to its closing brace; strings and comments may hold braces. */
  const readBlock = (): string => {
    let depth = 0;
    let out = '';
    while (i < css.length) {
      const ch = css[i];
      if (ch === '"' || ch === "'") out += readString(ch);
      else if (ch === '/' && css[i + 1] === '*') skipComment();
      else if (ch === '{') {
        depth++;
        out += ch;
        i++;
      } else if (ch === '}') {
        i++;
        if (depth === 0) return out;
        depth--;
        out += ch;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  };

  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      prelude += readString(ch);
    } else if (ch === '/' && css[i + 1] === '*') {
      skipComment();
    } else if (ch === ';') {
      // A statement (@import, @charset, @layer a, b;) has no block.
      prelude = '';
      i++;
    } else if (ch === '{') {
      const head = prelude.replace(/\s+/g, ' ').trim();
      i++;
      prelude = '';
      if (NESTING_AT_RULES.some((name) => head.startsWith(name))) {
        stack.push(head);
      } else if (head.startsWith('@')) {
        readBlock();
      } else {
        const body = readBlock();
        rules.push({
          selectors: head.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean),
          media: [...stack],
          body
        });
      }
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

const OVERLAY_SCOPE = 'body.touch-overlay';
const MOBILE_MEDIA = /max-width|max-height|pointer:\s*coarse/;

describe('stylesheet parser', () => {
  it('looks inside @media, @supports, @container and @layer blocks', () => {
    const rules = parseRules(
      '@media (max-width: 1px) { .a { color: red; } } @supports (display: grid) { .b { color: red; } } ' +
        '@container (min-width: 1px) { .c { color: red; } } @layer base { .d { color: red; } } .e { color: red; }'
    );
    expect(rules.map((r) => r.selectors[0])).toEqual(['.a', '.b', '.c', '.d', '.e']);
    expect(rules[0].media).toEqual(['@media (max-width: 1px)']);
    expect(rules[3].media).toEqual(['@layer base']);
    expect(rules[4].media).toEqual([]);
  });

  it('nests at-rules and pops them on the closing brace', () => {
    const rules = parseRules('@media print { @supports (a: b) { .a { x: y; } } .b { x: y; } } .c { x: y; }');
    expect(rules.map((r) => r.media.length)).toEqual([2, 1, 0]);
  });

  it('drops statements such as @import and @charset', () => {
    const rules = parseRules('@charset "utf-8"; @import url("x.css") layer(base); @layer a, b; .a { x: y; }');
    expect(rules).toHaveLength(1);
    expect(rules[0].selectors).toEqual(['.a']);
    expect(rules[0].media).toEqual([]);
  });

  it('ignores braces and semicolons inside strings and comments', () => {
    const rules = parseRules(`/* .x { } */ .a::after { content: "} .fake { "; } /* } */ .b { content: '{'; } .c { x: y; }`);
    expect(rules.map((r) => r.selectors[0])).toEqual(['.a::after', '.b', '.c']);
    expect(rules[0].body).toContain('.fake');
  });

  it('skips the blocks of at-rules that hold no style rules', () => {
    const rules = parseRules('@keyframes k { from { x: y; } to { x: z; } } @font-face { font-family: f; } .a { x: y; }');
    expect(rules.map((r) => r.selectors[0])).toEqual(['.a']);
  });

  it('reads the whole stylesheet', () => {
    expect(parseRules(CSS).length).toBeGreaterThan(500);
  });
});

describe('touch overlay stylesheet scoping', () => {
  const rules = parseRules(CSS);

  it('finds the overlay rules (the parser reaches the end of the file)', () => {
    expect(rules.filter((r) => r.selectors.some((s) => s.startsWith(OVERLAY_SCOPE))).length).toBeGreaterThan(20);
  });

  it('scopes every selector that mentions touch-overlay or dpad-side under body.touch-overlay or a mobile media query', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (!/touch-overlay|dpad-side/.test(selector)) continue;
        const scoped = selector.startsWith(OVERLAY_SCOPE);
        const mobile = rule.media.some((m) => m.startsWith('@media') && MOBILE_MEDIA.test(m));
        if (!scoped && !mobile) offenders.push(selector);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only styles the body direction classes together with the overlay class', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (/body\.(dpad-|orientation-)/.test(selector) && !selector.startsWith(OVERLAY_SCOPE)) offenders.push(selector);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the touch-only drawer row hidden by default and shows it on narrow or coarse screens', () => {
    const base = rules.find((r) => r.selectors.includes('.drawer-section .touch-setting-row') && r.media.length === 0);
    expect(base?.body).toMatch(/display:\s*none/);
    const shown = rules.find(
      (r) => r.selectors.includes('.drawer-section .touch-setting-row') && r.media.some((m) => /pointer:\s*coarse/.test(m))
    );
    expect(shown?.media[0]).toContain('max-width: 980px');
    expect(shown?.body).toMatch(/display:\s*flex/);
  });

  it('makes the board fill the screen: explicit sizes that outweigh every other rule sizing the wrapper', () => {
    const SELECTOR = 'body.touch-overlay .play-shell .lcd-screen .viewport-wrapper';
    const fill = rules.find((r) => r.selectors.includes(SELECTOR) && r.media.length === 0);
    expect(fill, 'overlay wrapper rule').toBeDefined();
    const body = fill?.body ?? '';
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/(^|[;\s])width:\s*100%/);
    expect(body).toMatch(/(^|[;\s])height:\s*100%/);
    expect(body).toMatch(/aspect-ratio:\s*auto/);
    // The desktop rule centres the box (align-self), which sizes an absolute box to its content.
    expect(body).toMatch(/align-self:\s*stretch/);

    // Rank = [ids, classes and attributes, elements] of the selector.
    const rank = (selector: string): number[] => [
      (selector.match(/#[\w-]+/g) ?? []).length,
      (selector.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length,
      (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
    ];
    const beats = (a: number[], b: number[]): boolean => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    const ours = rank(SELECTOR);
    const sizing = /(^|[;\s])(width|height|min-width|min-height|max-width|max-height|aspect-ratio|grid-area):/;
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (selector === SELECTOR || !/viewport-wrapper/.test(selector) || !sizing.test(rule.body)) continue;
        if (/!important/.test(rule.body) || !beats(ours, rank(selector))) offenders.push(selector);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not use backdrop blur on the floating controls', () => {
    const blurred = rules.filter(
      (r) =>
        r.selectors.some((s) => s.startsWith(OVERLAY_SCOPE)) &&
        (/backdrop-filter:\s*([^;]+);/.exec(r.body)?.[1].trim() ?? 'none') !== 'none'
    );
    expect(blurred).toEqual([]);
  });

  it('adds the accessibility variants for transparency, contrast and forced colors', () => {
    const queries = new Set(rules.flatMap((r) => r.media));
    expect(queries.has('@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)')).toBe(true);
    expect(queries.has('@media (forced-colors: active)')).toBe(true);
  });

  it('sets viewport-fit=cover and pads fixed elements with the safe area insets', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    for (const selector of ['#app', '.options-drawer', '.modal-backdrop', '.drop-overlay', '.floating-fs-exit']) {
      const rule = rules.find((r) => r.selectors.includes(selector) && r.media.length === 0);
      expect(rule?.body, selector).toMatch(/var\(--safe-(top|right|bottom|left)\)/);
    }
    expect(CSS).toContain('env(safe-area-inset-top, 0px)');
  });
});
