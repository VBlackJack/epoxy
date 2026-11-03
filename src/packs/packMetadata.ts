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

import { LevelPack, PackMetadataConfig } from '../core/types';

/**
 * Optional author and description of a pack. Pure helpers shared by the
 * editing flow, the stored-record sanitizer and the pack file import, so every
 * source is clamped the same way.
 */

/** The metadata fields of a pack; an absent field means none. */
export interface PackMetadata {
  author?: string;
  description?: string;
}

/** Longest values kept, from `game.json`. */
export type PackMetadataLimits = PackMetadataConfig;

const LINE_BREAKS = /\r\n?/g;

/** Trimmed author cut to the longest length kept; empty when nothing usable is left. */
export function normalizePackAuthor(text: string, limits: PackMetadataLimits): string {
  return text.trim().slice(0, limits.authorMaxLength).trim();
}

/** Trimmed description with line breaks unified to LF, cut to the longest length kept. */
export function normalizePackDescription(text: string, limits: PackMetadataLimits): string {
  return text.replace(LINE_BREAKS, '\n').trim().slice(0, limits.descriptionMaxLength).trim();
}

/**
 * The author and description found in an untrusted record, clamped. A field
 * that is not a string, or is blank once trimmed, is left out.
 */
export function clampPackMetadata(raw: unknown, limits: PackMetadataLimits): PackMetadata {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const result: PackMetadata = {};
  if (typeof source.author === 'string') {
    const author = normalizePackAuthor(source.author, limits);
    if (author !== '') result.author = author;
  }
  if (typeof source.description === 'string') {
    const description = normalizePackDescription(source.description, limits);
    if (description !== '') result.description = description;
  }
  return result;
}

/**
 * The pack with the given fields replaced; a blank value removes the field and
 * a field left out of `patch` is kept. The pack is returned as is when nothing changes.
 */
export function withPackMetadata(pack: LevelPack, patch: PackMetadata, limits: PackMetadataLimits): LevelPack {
  const { author: oldAuthor, description: oldDescription, ...rest } = pack;
  const author = patch.author === undefined ? oldAuthor : normalizePackAuthor(patch.author, limits);
  const description =
    patch.description === undefined ? oldDescription : normalizePackDescription(patch.description, limits);
  if ((author ?? '') === (oldAuthor ?? '') && (description ?? '') === (oldDescription ?? '')) return pack;
  return {
    ...rest,
    ...(author ? { author } : {}),
    ...(description ? { description } : {})
  };
}
