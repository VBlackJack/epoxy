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

import type { ConversionReport } from '../core/cc3d/cc3dToEpoxy';
import { t } from '../i18n/I18nManager';
import { closeDialog, openDialog } from './dialog';

/**
 * Report of a CC3D to Epoxy conversion: counts first, the rules warning, then a collapsible detail of every
 * approximation and loss. The dialog only answers; saving the converted copy is the caller's job, so nothing
 * is stored before Continue.
 */

const MODAL_ID = 'convert-report-modal';
const TITLE_ID = 'convert-report-title';
const BODY_ID = 'convert-report-body';
const CANCEL_ID = 'convert-report-cancel-btn';
const CONTINUE_ID = 'convert-report-continue-btn';
const DETAIL_ID = 'convert-report-detail';
const HIDDEN_CLASS = 'hidden';
const COVERAGE_KEY_PREFIX = 'cc3d.coverage';

/** One approximation or loss, already translated. */
export interface ConvertReportEntryView {
  name: string;
  label: string;
}

/** What the dialog shows. */
export interface ConvertReportRequest {
  levelTitle: string;
  exactCount: number;
  approx: readonly ConvertReportEntryView[];
  lost: readonly ConvertReportEntryView[];
  /** Validator errors of the converted level, already translated. */
  errors: readonly string[];
}

/** Translation key of the name or of the reason of a coverage key. */
export function coverageKey(key: string, part: 'name' | 'label'): string {
  return `${COVERAGE_KEY_PREFIX}.${key}.${part}`;
}

function entryView(key: string): ConvertReportEntryView {
  return { name: t(coverageKey(key, 'name')), label: t(coverageKey(key, 'label')) };
}

/** The request for a converter report and the validator errors of the converted level. */
export function describeConversion(
  report: ConversionReport,
  levelTitle: string,
  errors: readonly string[]
): ConvertReportRequest {
  return {
    levelTitle,
    exactCount: report.exact.length,
    approx: report.approx.map((entry) => entryView(entry.key)),
    lost: report.lost.map((entry) => entryView(entry.key)),
    errors
  };
}

let pendingResolve: ((proceed: boolean) => void) | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function settle(proceed: boolean): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(proceed);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function actionButton(id: string, primary: boolean): HTMLButtonElement {
  const btn = element('button', primary ? 'action-btn primary' : 'action-btn');
  btn.id = id;
  btn.type = 'button';
  return btn;
}

/** Builds the modal on first use, in the page body, with the markup the other modals have. */
function ensureModal(): HTMLElement {
  const existing = byId(MODAL_ID);
  if (existing) return existing;
  const modal = element('div', `modal-backdrop ${HIDDEN_CLASS}`);
  modal.id = MODAL_ID;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', TITLE_ID);
  modal.setAttribute('aria-describedby', BODY_ID);
  const dialog = element('div', 'modal-dialog convert-report-dialog');
  const title = element('h3');
  title.id = TITLE_ID;
  const body = element('div', 'convert-report-body');
  body.id = BODY_ID;
  const actions = element('div', 'modal-actions');
  actions.append(actionButton(CANCEL_ID, false), actionButton(CONTINUE_ID, true));
  dialog.append(title, body, actions);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
  return modal;
}

function bindOnce(modal: HTMLElement): void {
  if (listenersBound) return;
  listenersBound = true;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
  byId(CANCEL_ID)?.addEventListener('click', () => closeDialog(modal));
  byId(CONTINUE_ID)?.addEventListener('click', () => {
    settle(true);
    closeDialog(modal);
  });
}

function entryList(entries: readonly ConvertReportEntryView[]): HTMLUListElement {
  const ul = element('ul', 'convert-report-list');
  for (const entry of entries) {
    const li = element('li');
    li.append(element('strong', undefined, entry.name), document.createTextNode(`: ${entry.label}`));
    ul.appendChild(li);
  }
  return ul;
}

function messageList(messages: readonly string[], className: string): HTMLUListElement {
  const ul = element('ul', className);
  for (const message of messages) ul.appendChild(element('li', undefined, message));
  return ul;
}

function detailSection(request: ConvertReportRequest): HTMLElement {
  const details = element('details', 'convert-report-detail');
  details.id = DETAIL_ID;
  details.appendChild(element('summary', undefined, t('app.packs.manager.convert.detail.summary.label')));
  const groups: Array<[string, readonly ConvertReportEntryView[]]> = [
    ['app.packs.manager.convert.detail.approx.label', request.approx],
    ['app.packs.manager.convert.detail.lost.label', request.lost]
  ];
  let listed = false;
  for (const [headingKey, entries] of groups) {
    if (entries.length === 0) continue;
    listed = true;
    details.append(element('h4', 'convert-report-heading', t(headingKey)), entryList(entries));
  }
  if (!listed) details.appendChild(element('p', 'hint-text', t('app.packs.manager.convert.detail.none.label')));
  return details;
}

function fillBody(request: ConvertReportRequest): void {
  const body = byId(BODY_ID);
  if (!body) return;
  body.replaceChildren();
  body.appendChild(
    element('p', 'convert-report-intro', t('app.packs.manager.convert.intro.label', { title: request.levelTitle }))
  );
  const counts = element('ul', 'convert-report-counts');
  const rows: Array<[string, number]> = [
    ['app.packs.manager.convert.count.exact.label', request.exactCount],
    ['app.packs.manager.convert.count.approx.label', request.approx.length],
    ['app.packs.manager.convert.count.lost.label', request.lost.length]
  ];
  for (const [key, count] of rows) counts.appendChild(element('li', undefined, t(key, { count })));
  body.append(counts, element('p', 'convert-report-warning', t('app.packs.manager.convert.warning.label')));
  body.appendChild(detailSection(request));
  if (request.errors.length > 0) {
    body.append(
      element('h4', 'convert-report-heading', t('app.packs.manager.convert.errors.title.label')),
      messageList(request.errors, 'convert-report-list convert-report-errors'),
      element('p', 'hint-text', t('app.packs.manager.convert.errors.note.label'))
    );
  }
}

/**
 * Shows the report and waits for the answer: true on Continue, false on Cancel, Escape or the backdrop.
 * Focus starts on Cancel. A report still open when another is asked for is abandoned (answers false).
 */
export function showConvertReport(request: ConvertReportRequest): Promise<boolean> {
  const modal = ensureModal();
  const cancel = byId(CANCEL_ID);
  const proceed = byId(CONTINUE_ID);
  if (!cancel || !proceed) return Promise.resolve(false);
  bindOnce(modal);
  settle(false);
  closeDialog(modal);

  const title = byId(TITLE_ID);
  if (title) title.textContent = t('app.packs.manager.convert.title.label');
  cancel.textContent = t('app.packs.manager.convert.cancel.action');
  proceed.textContent = t('app.packs.manager.convert.continue.action');
  fillBody(request);

  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: cancel,
      onClose: () => settle(false)
    });
  });
}
