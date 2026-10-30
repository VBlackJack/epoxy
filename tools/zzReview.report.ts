import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { profileFor } from '../src/generator/DifficultyProfile';
import { RegionSolver } from '../src/generator/RegionSolver';
import { cellReachableWithout } from '../src/generator/GuardCheck';
import { replays } from '../src/test/levelChecks';
import { createTestBundle } from '../src/test/loadTestConfigs';
import { measureOpenArea } from '../src/test/openAreaMetrics';
import { openAreaViolations } from '../src/test/openAreaChecks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.env.RV_TAG ?? 'x';
const SEEDS = Number(process.env.RV_SEEDS ?? 20);
const LEVELS = (process.env.RV_LEVELS ?? '1,10,20').split(',').map(Number);
const DET = Number(process.env.RV_DET ?? 5);

it('review', () => {
  const bundle = createTestBundle();
  if (process.env.RV_VARIANT) Object.assign(bundle.game.procedural!.hub, JSON.parse(process.env.RV_VARIANT));
  ConfigRegistry.applyConfigs(bundle);
  const cfg = ConfigRegistry.getGame().procedural!;
  let states = 0;
  let calls = 0;
  const orig = RegionSolver.collectInOrder.bind(RegionSolver);
  vi.spyOn(RegionSolver, 'collectInOrder').mockImplementation((...a: Parameters<typeof RegionSolver.collectInOrder>) => {
    const r = orig(...a);
    states += r.statesExplored;
    calls++;
    return r;
  });
  const rows: Record<string, unknown>[] = [];
  const det: string[] = [];
  for (const level of LEVELS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      states = 0;
      calls = 0;
      const t = performance.now();
      let g;
      try {
        g = ProceduralGenerator.generateEndlessLevel(level, seed);
      } catch (e) {
        rows.push({ level, seed, failed: String(e) });
        continue;
      }
      const ms = performance.now() - t;
      const m = measureOpenArea(g);
      const o = g.open;
      rows.push({
        level, seed, ms: Math.round(ms), regionStates: states, regionCalls: calls, attempts: g.attempts,
        planned: profileFor('endless', level, cfg).pieceCount, kept: g.pieceMotifs.length - 1,
        region: o?.region.length ?? 0, aprons: o?.aprons.length ?? 0, monsters: o?.monsters.length ?? 0,
        chips: o?.chips.length ?? 0, hazards: o?.hazards.length ?? 0, dividers: o?.dividers.length ?? 0,
        lanes: o?.lanes.length ?? 0, outside: m.outsideFloor, served: Math.round(m.outsideFloor * m.contentShare),
        unserved: m.outsideFloor - Math.round(m.outsideFloor * m.contentShare), share: m.contentShare,
        shape: g.hubShape, proven: replays(g.level, g.solution),
        bypass: g.guards.some((gd) => cellReachableWithout(g.level, gd.box, gd.guarded)),
        violations: openAreaViolations(g)
      });
      if (seed <= DET) {
        const a = JSON.stringify([g.level, g.solution]);
        const b = ProceduralGenerator.generateEndlessLevel(level, seed);
        if (JSON.stringify([b.level, b.solution]) !== a) det.push(`${level}/${seed}`);
      }
    }
  }
  const out = resolve(ROOT, 'local', `review.${TAG}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ det, rows }, null, 1));
});
