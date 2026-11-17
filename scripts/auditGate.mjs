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

// Audit gate: runs `npm audit --json` and fails on any advisory at moderate
// severity or above that is not listed in audit-allowlist.json.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_FILE = new URL('../audit-allowlist.json', import.meta.url);
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const FAIL_SEVERITY = 'moderate';
const ADVISORY_URL_PATTERN = /(GHSA-[a-z0-9-]+)\s*$/i;
const AUDIT_COMMAND = 'npm audit --json';
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const MAX_AUDIT_BUFFER_BYTES = 64 * 1024 * 1024;

/** Advisory id of an audit `via` object, taken from its advisory URL. */
function advisoryId(via) {
  const match = ADVISORY_URL_PATTERN.exec(via.url ?? '');
  return match ? match[1] : String(via.source ?? '');
}

function isFailing(severity) {
  return (SEVERITY_RANK[severity] ?? SEVERITY_RANK[FAIL_SEVERITY]) >= SEVERITY_RANK[FAIL_SEVERITY];
}

/**
 * Pure filtering logic.
 * @param {{ vulnerabilities?: Record<string, any> }} audit parsed `npm audit --json`
 * @param {Array<{ id: string, package: string, reason: string, reviewBy: string }>} allowlist
 * @param {Date} today
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function evaluateAudit(audit, allowlist, today) {
  const vulnerabilities = audit?.vulnerabilities ?? {};
  const problems = [];
  const todayIso = today.toISOString().slice(0, 10);
  const allowedIds = new Set();

  for (const entry of allowlist) {
    if (entry.reviewBy < todayIso) {
      problems.push(
        `Allowlist entry ${entry.id} (${entry.package}) expired on ${entry.reviewBy}: recheck the advisory and extend or remove the entry.`
      );
    } else {
      allowedIds.add(entry.id);
    }
  }

  const seenIds = new Set();
  for (const vuln of Object.values(vulnerabilities)) {
    for (const via of vuln.via ?? []) {
      if (typeof via === 'object') seenIds.add(advisoryId(via));
    }
  }
  for (const entry of allowlist) {
    if (!seenIds.has(entry.id)) {
      problems.push(`Allowlist entry ${entry.id} (${entry.package}) matches no finding: stale exception, remove it.`);
    }
  }

  const memo = new Map();
  /** True when every advisory behind this package is allowlisted. */
  const isCovered = (name, visiting) => {
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name)) return true;
    const vuln = vulnerabilities[name];
    if (!vuln) return true;
    visiting.add(name);
    let covered = true;
    for (const via of vuln.via ?? []) {
      if (typeof via === 'string') {
        if (!isCovered(via, visiting)) covered = false;
      } else if (isFailing(via.severity) && !allowedIds.has(advisoryId(via))) {
        covered = false;
      }
    }
    visiting.delete(name);
    memo.set(name, covered);
    return covered;
  };

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    if (!isFailing(vuln.severity)) continue;
    if (!isCovered(name, new Set())) {
      const ids = (vuln.via ?? []).map((via) => (typeof via === 'object' ? advisoryId(via) : `via ${via}`));
      problems.push(`Unallowlisted ${vuln.severity} vulnerability in ${name}: ${ids.join(', ')}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

function main() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
  const result = spawnSync(AUDIT_COMMAND, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: MAX_AUDIT_BUFFER_BYTES
  });
  let audit;
  try {
    audit = JSON.parse(result.stdout);
  } catch {
    audit = undefined;
  }
  // npm exits non-zero when it finds vulnerabilities, so only a missing report counts as an audit error.
  if (!audit || audit.error || !audit.vulnerabilities) {
    console.error('npm audit failed to produce a report:');
    console.error(audit?.error?.summary ?? result.stderr ?? result.error?.message ?? 'no output');
    return EXIT_FAIL;
  }
  const { ok, problems } = evaluateAudit(audit, allowlist, new Date());
  if (!ok) {
    console.error('Audit gate failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return EXIT_FAIL;
  }
  console.log(`Audit gate passed (${allowlist.length} allowlisted advisory entries).`);
  return EXIT_PASS;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
