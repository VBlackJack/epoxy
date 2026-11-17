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
import { evaluateAudit, type AllowlistEntry } from '../../scripts/auditGate.mjs';

const ID = 'GHSA-aaaa-bbbb-cccc';
const OTHER_ID = 'GHSA-dddd-eeee-ffff';
const TODAY = new Date('2026-11-17T12:00:00Z');

const advisory = (id: string, severity = 'high') => ({
  source: 1,
  name: 'pkg',
  url: `https://github.com/advisories/${id}`,
  severity
});
const entry = (id: string, reviewBy = '2026-12-17'): AllowlistEntry => ({
  id,
  package: 'pkg',
  reason: 'test',
  reviewBy
});

describe('evaluateAudit', () => {
  it('ignores an allowlisted direct advisory', () => {
    const audit = { vulnerabilities: { pkg: { severity: 'high', via: [advisory(ID)] } } };
    expect(evaluateAudit(audit, [entry(ID)], TODAY)).toEqual({ ok: true, problems: [] });
  });

  it('ignores a transitive entry resolving only to allowlisted advisories', () => {
    const audit = {
      vulnerabilities: {
        pkg: { severity: 'high', via: [advisory(ID)] },
        mid: { severity: 'high', via: ['pkg'] },
        top: { severity: 'high', via: ['mid'] }
      }
    };
    expect(evaluateAudit(audit, [entry(ID)], TODAY).ok).toBe(true);
  });

  it('fails on a non-allowlisted advisory', () => {
    const audit = { vulnerabilities: { other: { severity: 'moderate', via: [advisory(OTHER_ID, 'moderate')] } } };
    const result = evaluateAudit(audit, [], TODAY);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain(OTHER_ID);
  });

  it('fails on a mixed via chain', () => {
    const audit = {
      vulnerabilities: {
        pkg: { severity: 'high', via: [advisory(ID)] },
        other: { severity: 'high', via: [advisory(OTHER_ID)] },
        mid: { severity: 'high', via: ['pkg', 'other'] }
      }
    };
    const result = evaluateAudit(audit, [entry(ID)], TODAY);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('mid'))).toBe(true);
  });

  it('fails on an expired entry', () => {
    const audit = { vulnerabilities: { pkg: { severity: 'high', via: [advisory(ID)] } } };
    const result = evaluateAudit(audit, [entry(ID, '2026-11-16')], TODAY);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('recheck');
  });

  it('fails on a stale entry matching no finding', () => {
    const audit = { vulnerabilities: {} };
    const result = evaluateAudit(audit, [entry(ID)], TODAY);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('stale');
  });

  it('ignores findings below moderate', () => {
    const audit = { vulnerabilities: { low: { severity: 'low', via: [advisory(OTHER_ID, 'low')] } } };
    expect(evaluateAudit(audit, [], TODAY).ok).toBe(true);
  });
});
