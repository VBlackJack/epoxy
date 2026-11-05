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

/** Element ids of the help modal parts the editor shortcuts open on. */
export const EDITOR_HELP_SECTION_ID = 'help-editor-section';
export const EDITOR_HELP_HEADING_ID = 'help-editor-heading';

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when keystrokes at this element are typing, so a shortcut must not take them. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TEXT_ENTRY_TAGS.has(target.tagName) || target.isContentEditable;
}

/** The parts of a keydown the editor help key reads. */
export interface EditorHelpKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/**
 * True for the "?" key outside text fields and without Ctrl, Meta or Alt. The produced character
 * decides, so AZERTY (Shift on the M key) works.
 */
export function isEditorHelpKey(e: EditorHelpKeyEvent): boolean {
  return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntryTarget(e.target);
}

/**
 * Expands the "More" section of the help modal, scrolls the editor section into view and
 * focuses its heading. Returns a function that restores the section's earlier open state,
 * or null when the modal has no such section.
 */
export function revealEditorHelp(modal: ParentNode): (() => void) | null {
  const section = modal.querySelector<HTMLElement>(`#${EDITOR_HELP_SECTION_ID}`);
  const heading = modal.querySelector<HTMLElement>(`#${EDITOR_HELP_HEADING_ID}`);
  if (!section || !heading) return null;
  const more = section.closest('details');
  const wasOpen = more?.open ?? false;
  if (more) more.open = true;
  section.scrollIntoView?.({ block: 'start' });
  heading.focus();
  return () => {
    if (more) more.open = wasOpen;
  };
}
