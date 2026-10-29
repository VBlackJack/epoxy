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
import { isInBounds } from '../config/ConfigValidation';
import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import {
  DEFAULT_CLONE_TEMPLATE_TYPE,
  DEFAULT_FACING,
  FLOOR_TILE_ID
} from '../core/coreConstants';
import {
  CloneLink,
  CompiledLevel,
  DatElementMapping,
  DatFormatConfig,
  Direction,
  EntityPlacement,
  TrapLink
} from '../core/types';

/** Pack header: uint32 magic + uint16 level count. */
const PACK_HEADER_BYTES = 6;
const PACK_LEVEL_COUNT_OFFSET = 4;
/** Every length and numeric field of the format is a little-endian uint16. */
const UINT16_BYTES = 2;
/** Fixed level header: number, time limit, chips required, map detail. */
const LEVEL_FIXED_HEADER_BYTES = 8;
/** Length prefixes that follow the fixed header: layer 1, layer 2, optional area. */
const LEVEL_LENGTH_PREFIX_COUNT = 3;
/** Smallest level record that can hold every mandatory field. */
const MIN_LEVEL_RECORD_BYTES = LEVEL_FIXED_HEADER_BYTES + LEVEL_LENGTH_PREFIX_COUNT * UINT16_BYTES;
/** Value written in the map detail field, ignored on read. */
const MAP_DETAIL_DEFAULT = 1;
/** Level count used when dat_format.json does not set maxLevelCount. */
const DEFAULT_MAX_LEVEL_COUNT = 1000;

/** Optional field header: one type byte, one length byte. */
const FIELD_HEADER_BYTES = 2;
/** The optional field length is a single byte. */
const MAX_FIELD_PAYLOAD_BYTES = 255;
/** Trap link record: button x/y, trap x/y, unused word. */
const TRAP_LINK_RECORD_BYTES = 10;
/** Clone link record: button x/y, cloner x/y. */
const CLONE_LINK_RECORD_BYTES = 8;
/** Monster list record: x and y as single bytes. */
const MONSTER_RECORD_BYTES = 2;
/** Text and password fields may be cut at any byte. */
const TEXT_RECORD_BYTES = 1;

/** RLE run: marker, count, value. Runs longer than this are written literally. */
const RLE_MIN_RUN_LENGTH = 4;
const RLE_MAX_RUN_LENGTH = 255;

/** Text fields are null terminated: this many characters plus the terminator fit one field. */
const MAX_TEXT_FIELD_CHARS = 120;
/** Passwords are four characters in the format. */
const PASSWORD_LENGTH = 4;
/** Highest code a text field keeps as is; anything above is written as REPLACEMENT_CHAR_CODE. */
const MAX_ASCII_CODE = 0x7e;
const MIN_PRINTABLE_CODE = 0x20;
const REPLACEMENT_CHAR_CODE = 0x3f;

const FALLBACK_ELEMENT: DatElementMapping = { kind: 'terrain', id: FLOOR_TILE_ID };

export class DatCodec {
  /**
   * Decodes a .DAT / .CCL pack. The header must be valid, but a malformed
   * level record is skipped instead of failing the whole pack: every read is
   * checked against the end of its own record.
   */
  public static decodeBuffer(buffer: ArrayBuffer, packPrefix: string = 'cclp'): CompiledLevel[] {
    const datCfg = ConfigRegistry.getDatFormat();
    const view = new DataView(buffer);

    if (buffer.byteLength < PACK_HEADER_BYTES) {
      throw new Error('Buffer too small for .DAT/.CCL header');
    }

    const magic = view.getUint32(0, true);
    if (!datCfg.magicHeaders.includes(magic)) {
      throw new Error(`Invalid .DAT/.CCL magic header: 0x${magic.toString(16)}`);
    }

    const maxLevelCount = datCfg.maxLevelCount ?? DEFAULT_MAX_LEVEL_COUNT;
    const levelCount = Math.min(view.getUint16(PACK_LEVEL_COUNT_OFFSET, true), maxLevelCount);
    const levels: CompiledLevel[] = [];
    let offset = PACK_HEADER_BYTES;

    for (let idx = 0; idx < levelCount; idx++) {
      if (offset + UINT16_BYTES > buffer.byteLength) break;
      const levelByteLength = view.getUint16(offset, true);
      offset += UINT16_BYTES;
      const levelEndOffset = offset + levelByteLength;
      if (levelEndOffset > buffer.byteLength) break;

      if (levelByteLength >= MIN_LEVEL_RECORD_BYTES) {
        const level = this.decodeLevel(buffer, offset, levelEndOffset, idx, packPrefix, datCfg);
        if (level) {
          levels.push(level);
        }
      }

      offset = levelEndOffset;
    }

    return levels;
  }

  /** Decodes one level record in [start, end). Returns null when the record is malformed. */
  private static decodeLevel(
    buffer: ArrayBuffer,
    start: number,
    end: number,
    idx: number,
    packPrefix: string,
    datCfg: DatFormatConfig
  ): CompiledLevel | null {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let cursor = start;
    const levelNumber = view.getUint16(cursor, true);
    const timeLimitSeconds = view.getUint16(cursor + UINT16_BYTES, true);
    const chipsRequired = view.getUint16(cursor + 2 * UINT16_BYTES, true);
    cursor += LEVEL_FIXED_HEADER_BYTES; // the map detail word is ignored

    const readLayer = (): Uint8Array | null => {
      if (cursor + UINT16_BYTES > end) return null;
      const compressedLen = view.getUint16(cursor, true);
      cursor += UINT16_BYTES;
      if (cursor + compressedLen > end) return null;
      const layer = this.decompressLayer(
        bytes.subarray(cursor, cursor + compressedLen),
        datCfg.layerByteLength,
        datCfg.rleMarkerByte
      );
      cursor += compressedLen;
      return layer;
    };

    const layer1 = readLayer();
    if (!layer1) return null;
    const layer2 = readLayer();
    if (!layer2) return null;

    if (cursor + UINT16_BYTES > end) return null;
    const optionalBytesLen = view.getUint16(cursor, true);
    cursor += UINT16_BYTES;
    const optionalEnd = Math.min(end, cursor + optionalBytesLen);

    let customTitle = `Level ${levelNumber}`;
    let customHint = '';
    let password = DEFAULT_LEVEL_PASSWORD;
    const rawTrapLinks: TrapLink[] = [];
    const rawCloneLinks: Array<{
      buttonX: number;
      buttonY: number;
      clonerX: number;
      clonerY: number;
    }> = [];
    const monsterOrderCoords: Array<{ x: number; y: number }> = [];

    while (cursor + FIELD_HEADER_BYTES <= optionalEnd) {
      const fieldType = bytes[cursor];
      const fieldLen = bytes[cursor + 1];
      cursor += FIELD_HEADER_BYTES;
      if (cursor + fieldLen > optionalEnd) break;

      const fieldBytes = bytes.subarray(cursor, cursor + fieldLen);
      const fieldView = new DataView(buffer, cursor, fieldLen);

      if (fieldType === datCfg.fieldCodes.title) {
        customTitle = this.decodeAsciiString(fieldBytes);
      } else if (fieldType === datCfg.fieldCodes.hint) {
        customHint = this.decodeAsciiString(fieldBytes);
      } else if (fieldType === datCfg.fieldCodes.encryptedPassword) {
        password = this.decodeEncryptedPassword(fieldBytes, datCfg.passwordXorKey);
      } else if (fieldType === datCfg.fieldCodes.plainPassword) {
        password = this.decodeAsciiString(fieldBytes);
      } else if (fieldType === datCfg.fieldCodes.trapLinks) {
        for (let p = 0; p + TRAP_LINK_RECORD_BYTES <= fieldLen; p += TRAP_LINK_RECORD_BYTES) {
          rawTrapLinks.push({
            buttonX: fieldView.getUint16(p, true),
            buttonY: fieldView.getUint16(p + UINT16_BYTES, true),
            trapX: fieldView.getUint16(p + 2 * UINT16_BYTES, true),
            trapY: fieldView.getUint16(p + 3 * UINT16_BYTES, true)
          });
        }
      } else if (fieldType === datCfg.fieldCodes.cloneLinks) {
        for (let p = 0; p + CLONE_LINK_RECORD_BYTES <= fieldLen; p += CLONE_LINK_RECORD_BYTES) {
          rawCloneLinks.push({
            buttonX: fieldView.getUint16(p, true),
            buttonY: fieldView.getUint16(p + UINT16_BYTES, true),
            clonerX: fieldView.getUint16(p + 2 * UINT16_BYTES, true),
            clonerY: fieldView.getUint16(p + 3 * UINT16_BYTES, true)
          });
        }
      } else if (fieldType === datCfg.fieldCodes.monsterList) {
        for (let p = 0; p + MONSTER_RECORD_BYTES <= fieldLen; p += MONSTER_RECORD_BYTES) {
          monsterOrderCoords.push({
            x: fieldBytes[p],
            y: fieldBytes[p + 1]
          });
        }
      }

      cursor += fieldLen;
    }

    const terrain: string[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => FLOOR_TILE_ID)
    );
    const items: (string | null)[][] = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => null)
    );
    const entitiesMap = new Map<string, EntityPlacement>();
    const clonerTemplates = new Map<string, { type: string; dir: Direction }>();
    let playerStart: { x: number; y: number; dir: Direction } = {
      x: Math.floor(mapWidth / 2),
      y: Math.floor(mapHeight / 2),
      dir: DEFAULT_FACING
    };
    const setPlayerStart = (ps: { x: number; y: number; dir: Direction }): void => {
      playerStart = ps;
    };
    const cloneMachineId = this.findCloneMachineTileId();

    // A layer longer than the grid would place cells outside the arrays: walk the overlap only
    const cellCount = Math.min(datCfg.layerByteLength, mapWidth * mapHeight);
    for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
      const x = cellIdx % mapWidth;
      const y = Math.floor(cellIdx / mapWidth);
      const topElem = datCfg.byteToElement[String(layer1[cellIdx])] || FALLBACK_ELEMENT;
      const botElem = datCfg.byteToElement[String(layer2[cellIdx])] || FALLBACK_ELEMENT;

      // Apply bottom layer first, then the top layer over it
      for (const elem of [botElem, topElem]) {
        this.applyElementToCell(
          x,
          y,
          elem,
          terrain,
          items,
          entitiesMap,
          clonerTemplates,
          cloneMachineId,
          setPlayerStart
        );
      }
    }

    // Order monsters according to Field 10 monster movement list if present
    const orderedEntities: EntityPlacement[] = [];
    const visitedKeys = new Set<string>();
    for (const coord of monsterOrderCoords) {
      const key = `${coord.x},${coord.y}`;
      const ent = entitiesMap.get(key);
      if (ent && !visitedKeys.has(key)) {
        orderedEntities.push(ent);
        visitedKeys.add(key);
      }
    }
    for (const [key, ent] of entitiesMap.entries()) {
      if (!visitedKeys.has(key)) {
        orderedEntities.push(ent);
      }
    }

    const inGrid = (x: number, y: number): boolean => isInBounds(x, y, mapWidth, mapHeight);

    // Build CloneLinks with resolved template types; links pointing outside the grid are dropped
    const cloneLinks: CloneLink[] = rawCloneLinks
      .filter((cl) => inGrid(cl.buttonX, cl.buttonY) && inGrid(cl.clonerX, cl.clonerY))
      .map((cl) => {
        const key = `${cl.clonerX},${cl.clonerY}`;
        const tpl = clonerTemplates.get(key) || entitiesMap.get(key);
        return {
          buttonX: cl.buttonX,
          buttonY: cl.buttonY,
          clonerX: cl.clonerX,
          clonerY: cl.clonerY,
          templateType: tpl ? tpl.type : DEFAULT_CLONE_TEMPLATE_TYPE,
          templateDir: tpl ? tpl.dir : DEFAULT_FACING
        };
      });
    const trapLinks = rawTrapLinks.filter(
      (tl) => inGrid(tl.buttonX, tl.buttonY) && inGrid(tl.trapX, tl.trapY)
    );

    return {
      id: `${packPrefix}_level_${levelNumber || idx + 1}`,
      number: levelNumber || idx + 1,
      customTitle,
      customHint,
      password: password || DEFAULT_LEVEL_PASSWORD,
      timeLimitSeconds,
      chipsRequired,
      playerStart,
      terrain,
      items,
      entities: orderedEntities,
      trapLinks,
      cloneLinks
    };
  }

  private static findCloneMachineTileId(): string | null {
    const tile = Object.values(ConfigRegistry.getTiles().tiles).find((t) => t.isCloneMachine);
    return tile ? tile.id : null;
  }

  private static applyElementToCell(
    x: number,
    y: number,
    elem: DatElementMapping,
    terrain: string[][],
    items: (string | null)[][],
    entitiesMap: Map<string, EntityPlacement>,
    clonerTemplates: Map<string, { type: string; dir: Direction }>,
    cloneMachineId: string | null,
    setPlayerStart: (ps: { x: number; y: number; dir: Direction }) => void
  ): void {
    const key = `${x},${y}`;
    if (elem.kind === 'terrain') {
      if (elem.id !== FLOOR_TILE_ID || terrain[y][x] === FLOOR_TILE_ID) {
        terrain[y][x] = elem.id;
      }
    } else if (elem.kind === 'item') {
      items[y][x] = elem.id;
    } else if (elem.kind === 'player') {
      setPlayerStart({ x, y, dir: elem.dir || DEFAULT_FACING });
    } else if (elem.kind === 'entity') {
      if (elem.isClonerTemplate && cloneMachineId) {
        terrain[y][x] = cloneMachineId;
      }
      entitiesMap.set(key, { x, y, type: elem.id, dir: elem.dir || DEFAULT_FACING });
      clonerTemplates.set(key, { type: elem.id, dir: elem.dir || DEFAULT_FACING });
    }
  }

  private static decompressLayer(
    compressed: Uint8Array,
    targetLength: number,
    rleMarker: number
  ): Uint8Array {
    const output = new Uint8Array(targetLength);
    let outIdx = 0;
    let inIdx = 0;

    while (inIdx < compressed.length && outIdx < targetLength) {
      const byte = compressed[inIdx++];
      if (byte === rleMarker && inIdx + 1 < compressed.length) {
        const count = compressed[inIdx++];
        const val = compressed[inIdx++];
        for (let c = 0; c < count && outIdx < targetLength; c++) {
          output[outIdx++] = val;
        }
      } else {
        output[outIdx++] = byte;
      }
    }
    return output;
  }

  public static encodeLevels(levels: CompiledLevel[]): Uint8Array {
    const datCfg = ConfigRegistry.getDatFormat();
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;

    // Build reverse lookup maps
    const terrainToByte = new Map<string, number>();
    const itemToByte = new Map<string, number>();
    const entityDirToByte = new Map<string, number>();
    const playerDirToByte = new Map<Direction, number>();

    for (const [codeStr, mapping] of Object.entries(datCfg.byteToElement)) {
      const code = Number(codeStr);
      if (mapping.kind === 'terrain' && !terrainToByte.has(mapping.id)) {
        terrainToByte.set(mapping.id, code);
      } else if (mapping.kind === 'item' && !itemToByte.has(mapping.id)) {
        itemToByte.set(mapping.id, code);
      } else if (mapping.kind === 'entity' && !mapping.isClonerTemplate) {
        const key = `${mapping.id}:${mapping.dir || DEFAULT_FACING}`;
        if (!entityDirToByte.has(key)) {
          entityDirToByte.set(key, code);
        }
      } else if (mapping.kind === 'player' && mapping.dir && !playerDirToByte.has(mapping.dir)) {
        playerDirToByte.set(mapping.dir, code);
      }
    }
    const floorByte = terrainToByte.get(FLOOR_TILE_ID) ?? 0;
    const cellCount = Math.min(datCfg.layerByteLength, mapWidth * mapHeight);

    const encodedLevelBlocks: Uint8Array[] = [];

    for (let idx = 0; idx < levels.length; idx++) {
      const lvl = levels[idx];
      const layer1Raw = new Uint8Array(datCfg.layerByteLength);
      const layer2Raw = new Uint8Array(datCfg.layerByteLength);

      const entByCoord = new Map<string, EntityPlacement>();
      for (const e of lvl.entities) {
        entByCoord.set(`${e.x},${e.y}`, e);
      }

      for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
        const x = cellIdx % mapWidth;
        const y = Math.floor(cellIdx / mapWidth);
        const tCode = terrainToByte.get(lvl.terrain[y]?.[x]) ?? floorByte;
        const itemId = lvl.items[y]?.[x];
        const iCode = itemId ? (itemToByte.get(itemId) ?? null) : null;
        const ent = entByCoord.get(`${x},${y}`);
        const eCode = ent
          ? (entityDirToByte.get(`${ent.type}:${ent.dir}`) ??
            entityDirToByte.get(`${ent.type}:${DEFAULT_FACING}`) ??
            null)
          : null;
        const isPlayer = lvl.playerStart.x === x && lvl.playerStart.y === y;
        const pCode = isPlayer
          ? (playerDirToByte.get(lvl.playerStart.dir) ?? playerDirToByte.get(DEFAULT_FACING) ?? null)
          : null;

        const topCode = pCode ?? eCode;
        if (topCode !== null) {
          layer1Raw[cellIdx] = topCode;
          layer2Raw[cellIdx] = iCode ?? tCode;
        } else if (iCode !== null) {
          layer1Raw[cellIdx] = iCode;
          layer2Raw[cellIdx] = tCode;
        } else {
          layer1Raw[cellIdx] = tCode;
          layer2Raw[cellIdx] = floorByte;
        }
      }

      const layer1Comp = this.compressLayer(layer1Raw, datCfg.rleMarkerByte);
      const layer2Comp = this.compressLayer(layer2Raw, datCfg.rleMarkerByte);
      const optionalBlock = this.encodeOptionalFields(lvl, datCfg);

      // Record size counts everything after its own length word
      const levelDataSize =
        LEVEL_FIXED_HEADER_BYTES +
        UINT16_BYTES + layer1Comp.length +
        UINT16_BYTES + layer2Comp.length +
        UINT16_BYTES + optionalBlock.length;
      const block = new Uint8Array(UINT16_BYTES + levelDataSize);
      const bView = new DataView(block.buffer);

      let pos = 0;
      bView.setUint16(pos, levelDataSize, true);
      pos += UINT16_BYTES;
      bView.setUint16(pos, lvl.number || idx + 1, true);
      pos += UINT16_BYTES;
      bView.setUint16(pos, lvl.timeLimitSeconds, true);
      pos += UINT16_BYTES;
      bView.setUint16(pos, lvl.chipsRequired, true);
      pos += UINT16_BYTES;
      bView.setUint16(pos, MAP_DETAIL_DEFAULT, true);
      pos += UINT16_BYTES;

      bView.setUint16(pos, layer1Comp.length, true);
      pos += UINT16_BYTES;
      block.set(layer1Comp, pos);
      pos += layer1Comp.length;

      bView.setUint16(pos, layer2Comp.length, true);
      pos += UINT16_BYTES;
      block.set(layer2Comp, pos);
      pos += layer2Comp.length;

      bView.setUint16(pos, optionalBlock.length, true);
      pos += UINT16_BYTES;
      block.set(optionalBlock, pos);

      encodedLevelBlocks.push(block);
    }

    const totalLen = PACK_HEADER_BYTES + encodedLevelBlocks.reduce((acc, b) => acc + b.length, 0);
    const out = new Uint8Array(totalLen);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, datCfg.defaultMagicHeader, true);
    outView.setUint16(PACK_LEVEL_COUNT_OFFSET, encodedLevelBlocks.length, true);

    let writePos = PACK_HEADER_BYTES;
    for (const b of encodedLevelBlocks) {
      out.set(b, writePos);
      writePos += b.length;
    }

    return out;
  }

  private static compressLayer(raw: Uint8Array, rleMarker: number): Uint8Array {
    const out: number[] = [];
    let i = 0;
    while (i < raw.length) {
      const val = raw[i];
      let runLen = 1;
      while (i + runLen < raw.length && raw[i + runLen] === val && runLen < RLE_MAX_RUN_LENGTH) {
        runLen++;
      }
      if (runLen >= RLE_MIN_RUN_LENGTH || val === rleMarker) {
        out.push(rleMarker, runLen, val);
      } else {
        for (let k = 0; k < runLen; k++) {
          out.push(val);
        }
      }
      i += runLen;
    }
    return new Uint8Array(out);
  }

  /**
   * Builds one optional field. The length is stored in a single byte, so a
   * payload over MAX_FIELD_PAYLOAD_BYTES is truncated to the largest number of
   * whole records that fits: a reader never sees half a link. Excess trap
   * links, clone links or monster order entries are dropped from the file.
   */
  private static buildField(fieldCode: number, payload: Uint8Array, recordBytes: number): Uint8Array {
    const maxBytes = Math.floor(MAX_FIELD_PAYLOAD_BYTES / recordBytes) * recordBytes;
    const kept = payload.length > maxBytes ? payload.subarray(0, maxBytes) : payload;
    const field = new Uint8Array(FIELD_HEADER_BYTES + kept.length);
    field[0] = fieldCode;
    field[1] = kept.length;
    field.set(kept, FIELD_HEADER_BYTES);
    return field;
  }

  private static encodeOptionalFields(lvl: CompiledLevel, datCfg: DatFormatConfig): Uint8Array {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const textRecord = TEXT_RECORD_BYTES;
    const chunks: Uint8Array[] = [];

    // Title (Field 3)
    const titleBytes = this.encodeAsciiNullTerminated(lvl.customTitle || lvl.id);
    chunks.push(this.buildField(datCfg.fieldCodes.title, titleBytes, textRecord));

    // Encrypted Password (Field 6)
    const passPlain = this.encodeAscii(
      (lvl.password || DEFAULT_LEVEL_PASSWORD).slice(0, PASSWORD_LENGTH).toUpperCase()
    );
    const passBytes = new Uint8Array(passPlain.length + 1);
    for (let i = 0; i < passPlain.length; i++) {
      passBytes[i] = passPlain[i] ^ datCfg.passwordXorKey;
    }
    chunks.push(this.buildField(datCfg.fieldCodes.encryptedPassword, passBytes, textRecord));

    // Hint (Field 7)
    if (lvl.customHint) {
      const hintBytes = this.encodeAsciiNullTerminated(lvl.customHint);
      chunks.push(this.buildField(datCfg.fieldCodes.hint, hintBytes, textRecord));
    }

    // Trap Links (Field 4)
    if (lvl.trapLinks.length > 0) {
      const trapBuf = new Uint8Array(lvl.trapLinks.length * TRAP_LINK_RECORD_BYTES);
      const tView = new DataView(trapBuf.buffer);
      lvl.trapLinks.forEach((tl, idx) => {
        const base = idx * TRAP_LINK_RECORD_BYTES;
        tView.setUint16(base, tl.buttonX, true);
        tView.setUint16(base + UINT16_BYTES, tl.buttonY, true);
        tView.setUint16(base + 2 * UINT16_BYTES, tl.trapX, true);
        tView.setUint16(base + 3 * UINT16_BYTES, tl.trapY, true);
        tView.setUint16(base + 4 * UINT16_BYTES, 0, true);
      });
      chunks.push(this.buildField(datCfg.fieldCodes.trapLinks, trapBuf, TRAP_LINK_RECORD_BYTES));
    }

    // Clone Links (Field 5)
    if (lvl.cloneLinks.length > 0) {
      const cloneBuf = new Uint8Array(lvl.cloneLinks.length * CLONE_LINK_RECORD_BYTES);
      const cView = new DataView(cloneBuf.buffer);
      lvl.cloneLinks.forEach((cl, idx) => {
        const base = idx * CLONE_LINK_RECORD_BYTES;
        cView.setUint16(base, cl.buttonX, true);
        cView.setUint16(base + UINT16_BYTES, cl.buttonY, true);
        cView.setUint16(base + 2 * UINT16_BYTES, cl.clonerX, true);
        cView.setUint16(base + 3 * UINT16_BYTES, cl.clonerY, true);
      });
      chunks.push(this.buildField(datCfg.fieldCodes.cloneLinks, cloneBuf, CLONE_LINK_RECORD_BYTES));
    }

    // Monster List (Field 10): coordinates are single bytes, so only in-grid monsters are listed
    const monsters = lvl.entities.filter(
      (e) =>
        ConfigRegistry.getEntityDef(e.type)?.kind === 'monster' &&
        isInBounds(e.x, e.y, mapWidth, mapHeight)
    );
    if (monsters.length > 0) {
      const mBuf = new Uint8Array(monsters.length * MONSTER_RECORD_BYTES);
      monsters.forEach((m, idx) => {
        mBuf[idx * MONSTER_RECORD_BYTES] = m.x;
        mBuf[idx * MONSTER_RECORD_BYTES + 1] = m.y;
      });
      chunks.push(this.buildField(datCfg.fieldCodes.monsterList, mBuf, MONSTER_RECORD_BYTES));
    }

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }
    return combined;
  }

  private static decodeAsciiString(bytes: Uint8Array): string {
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    let out = '';
    for (let i = 0; i < end; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out.trim();
  }

  private static decodeEncryptedPassword(bytes: Uint8Array, xorKey: number): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) break;
      out += String.fromCharCode(bytes[i] ^ xorKey);
    }
    return out.trim().toUpperCase();
  }

  /**
   * Converts text to printable ASCII. The format has no declared encoding, so
   * any other character (accents, emoji, control codes) becomes '?' instead of
   * being silently mangled into an unrelated byte.
   */
  private static encodeAscii(text: string): Uint8Array {
    const chars = Array.from(text);
    const out = new Uint8Array(chars.length);
    for (let i = 0; i < chars.length; i++) {
      const code = chars[i].codePointAt(0) ?? REPLACEMENT_CHAR_CODE;
      out[i] = code >= MIN_PRINTABLE_CODE && code <= MAX_ASCII_CODE ? code : REPLACEMENT_CHAR_CODE;
    }
    return out;
  }

  private static encodeAsciiNullTerminated(text: string): Uint8Array {
    const ascii = this.encodeAscii(text).subarray(0, MAX_TEXT_FIELD_CHARS);
    const out = new Uint8Array(ascii.length + 1);
    out.set(ascii, 0);
    out[ascii.length] = 0;
    return out;
  }
}
