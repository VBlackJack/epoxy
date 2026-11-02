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
 * Decides which edits of the level metadata open a new undo step. Typing in
 * one field is a single step: the step opens on the first edit after the field
 * took the focus, and later edits of that field fold into it. Fields that
 * change in one gesture (selects, buttons) record every edit.
 */
export class MetadataEditCoalescer {
  private openField: string | null = null;

  /** True when an edit of `field` starts a new step. Pass `coalesce` false for one-gesture fields. */
  public shouldRecord(field: string, coalesce: boolean = true): boolean {
    if (!coalesce) {
      this.openField = null;
      return true;
    }
    if (this.openField === field) return false;
    this.openField = field;
    return true;
  }

  /** The focus moved, or the history changed: the next edit starts a new step. */
  public reset(): void {
    this.openField = null;
  }
}
