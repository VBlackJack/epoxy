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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CC1_DAT_RULES_PROFILE, CC1_DAT_RULESET, IMPORTED_PACK_RULESET } from '../config/constants';
import { CompiledLevel } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { passwordSignature } from './passwordSignature';
import { applyRulesProfile } from './rulesProfile';

export { passwordSignature };

/** True for a level set that is an official Chip's Challenge 1 set (its password signature is listed in game.json). */
export async function isOfficialCc1(levels: readonly Pick<CompiledLevel, 'password'>[]): Promise<boolean> {
  const listed = ConfigRegistry.getGame().officialCc1Signatures ?? [];
  return listed.length > 0 && listed.includes(await passwordSignature(levels));
}

/**
 * Decodes a .DAT or .CCL file the player imports. The engine is chosen by content: an official Chip's Challenge 1 set keeps
 * the classic Epoxy rules (as its Steam version does); any other set, community or not, is read the Lynx way and plays the
 * CCLP engine.
 */
export async function decodeImportedDat(buffer: ArrayBuffer, packName: string): Promise<CompiledLevel[]> {
  const classic = DatCodec.decodeBuffer(buffer, packName, IMPORTED_PACK_RULESET);
  if (await isOfficialCc1(classic)) return classic;
  const levels = DatCodec.decodeBuffer(buffer, packName, CC1_DAT_RULESET);
  applyRulesProfile(levels, CC1_DAT_RULES_PROFILE);
  return levels;
}
