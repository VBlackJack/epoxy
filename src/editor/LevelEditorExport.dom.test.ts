// @vitest-environment happy-dom
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

import { beforeEach, describe, expect, it } from "vitest";
import { CompiledLevel } from "../core/types";
import { LevelValidator } from "../core/LevelValidator";
import { storedSolutionWins } from "../generator/SolutionReplay";
import { loadTestConfigs } from "../test/loadTestConfigs";
import { LevelEditor } from "./LevelEditor";

const SOLUTION = "EWSSS";

/** Two red doors, two red keys (one in the south room): opening the north door first strands the player. */
function trapLevel(): CompiledLevel {
  const rows = ["#####", "#...#", "#D###", "#Pr.#", "#D###", "#Er.#", "#####"];
  const codes: Record<string, string> = {
    "#": "wall",
    ".": "floor",
    P: "floor",
    E: "exit",
    D: "door_red",
    r: "floor",
  };
  return {
    id: "trap",
    number: 1,
    password: "TEST",
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 3, dir: "S" },
    terrain: rows.map((row) => [...row].map((ch) => codes[ch])),
    items: rows.map((row) =>
      [...row].map((ch) => (ch === "r" ? "key_red" : null)),
    ),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    solution: SOLUTION,
  };
}

describe("LevelEditor.exportCompiledLevel", () => {
  let editor: LevelEditor;

  beforeEach(() => {
    loadTestConfigs();
    const canvas = document.createElement("canvas");
    // Drawing is irrelevant here: every context and renderer call is a no-op.
    const noop = (): object =>
      new Proxy(() => undefined, { get: () => noop(), apply: () => undefined });
    canvas.getContext = (() =>
      noop()) as unknown as HTMLCanvasElement["getContext"];
    editor = new LevelEditor(canvas, noop() as never, noop() as never);
  });

  it("keeps the stored solution while the map is untouched", () => {
    editor.loadCompiledLevel(trapLevel());
    const exported = editor.exportCompiledLevel();
    expect(exported.solution).toBe(SOLUTION);
    expect(LevelValidator.validate(exported, storedSolutionWins).valid).toBe(
      true,
    );
  });
});
