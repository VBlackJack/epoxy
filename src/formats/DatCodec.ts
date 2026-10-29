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
import {
  CloneLink,
  CompiledLevel,
  DatElementMapping,
  Direction,
  EntityPlacement,
  TrapLink
} from '../core/types';

export class DatCodec {
  public static decodeBuffer(buffer: ArrayBuffer, packPrefix: string = 'cclp'): CompiledLevel[] {
    const datCfg = ConfigRegistry.getDatFormat();
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    if (buffer.byteLength < 6) {
      throw new Error('Buffer too small for .DAT/.CCL header');
    }

    const magic = view.getUint32(0, true);
    if (!datCfg.magicHeaders.includes(magic)) {
      throw new Error(`Invalid .DAT/.CCL magic header: 0x${magic.toString(16)}`);
    }

    const levelCount = view.getUint16(4, true);
    const levels: CompiledLevel[] = [];
    let offset = 6;

    for (let idx = 0; idx < levelCount; idx++) {
      if (offset + 2 > buffer.byteLength) break;
      const levelByteLength = view.getUint16(offset, true);
      offset += 2;
      const levelEndOffset = offset + levelByteLength;
      if (levelEndOffset > buffer.byteLength) break;

      let cursor = offset;
      const levelNumber = view.getUint16(cursor, true);
      const timeLimitSeconds = view.getUint16(cursor + 2, true);
      const chipsRequired = view.getUint16(cursor + 4, true);
      cursor += 8; // skip mapDetail uint16 at cursor + 6

      const layer1CompressedLen = view.getUint16(cursor, true);
      cursor += 2;
      const layer1 = this.decompressLayer(
        bytes.subarray(cursor, cursor + layer1CompressedLen),
        datCfg.layerByteLength,
        datCfg.rleMarkerByte
      );
      cursor += layer1CompressedLen;

      const layer2CompressedLen = view.getUint16(cursor, true);
      cursor += 2;
      const layer2 = this.decompressLayer(
        bytes.subarray(cursor, cursor + layer2CompressedLen),
        datCfg.layerByteLength,
        datCfg.rleMarkerByte
      );
      cursor += layer2CompressedLen;

      const optionalBytesLen = view.getUint16(cursor, true);
      cursor += 2;
      const optionalEnd = Math.min(levelEndOffset, cursor + optionalBytesLen);

      let customTitle = `Level ${levelNumber}`;
      let customHint = '';
      let password = 'CCLP';
      const rawTrapLinks: TrapLink[] = [];
      const rawCloneLinks: Array<{
        buttonX: number;
        buttonY: number;
        clonerX: number;
        clonerY: number;
      }> = [];
      const monsterOrderCoords: Array<{ x: number; y: number }> = [];

      while (cursor + 2 <= optionalEnd) {
        const fieldType = bytes[cursor];
        const fieldLen = bytes[cursor + 1];
        cursor += 2;
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
          for (let p = 0; p + 10 <= fieldLen; p += 10) {
            rawTrapLinks.push({
              buttonX: fieldView.getUint16(p, true),
              buttonY: fieldView.getUint16(p + 2, true),
              trapX: fieldView.getUint16(p + 4, true),
              trapY: fieldView.getUint16(p + 6, true)
            });
          }
        } else if (fieldType === datCfg.fieldCodes.cloneLinks) {
          for (let p = 0; p + 8 <= fieldLen; p += 8) {
            rawCloneLinks.push({
              buttonX: fieldView.getUint16(p, true),
              buttonY: fieldView.getUint16(p + 2, true),
              clonerX: fieldView.getUint16(p + 4, true),
              clonerY: fieldView.getUint16(p + 6, true)
            });
          }
        } else if (fieldType === datCfg.fieldCodes.monsterList) {
          for (let p = 0; p + 2 <= fieldLen; p += 2) {
            monsterOrderCoords.push({
              x: fieldBytes[p],
              y: fieldBytes[p + 1]
            });
          }
        }

        cursor += fieldLen;
      }

      const terrain: string[][] = Array.from({ length: mapHeight }, () =>
        Array.from({ length: mapWidth }, () => 'floor')
      );
      const items: (string | null)[][] = Array.from({ length: mapHeight }, () =>
        Array.from({ length: mapWidth }, () => null)
      );
      const entitiesMap = new Map<string, EntityPlacement>();
      const clonerTemplates = new Map<string, { type: string; dir: Direction }>();
      let playerStart: { x: number; y: number; dir: Direction } = { x: 15, y: 15, dir: 'S' };

      for (let cellIdx = 0; cellIdx < datCfg.layerByteLength; cellIdx++) {
        const x = cellIdx % mapWidth;
        const y = Math.floor(cellIdx / mapWidth);
        const topCode = layer1[cellIdx];
        const botCode = layer2[cellIdx];

        const topElem = datCfg.byteToElement[String(topCode)] || { kind: 'terrain', id: 'floor' };
        const botElem = datCfg.byteToElement[String(botCode)] || { kind: 'terrain', id: 'floor' };

        // Apply bottom layer first
        this.applyElementToCell(
          x,
          y,
          botElem,
          terrain,
          items,
          entitiesMap,
          clonerTemplates,
          (ps) => {
            playerStart = ps;
          }
        );

        // Apply top layer over bottom layer
        this.applyElementToCell(
          x,
          y,
          topElem,
          terrain,
          items,
          entitiesMap,
          clonerTemplates,
          (ps) => {
            playerStart = ps;
          }
        );
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

      // Build CloneLinks with resolved template types
      const cloneLinks: CloneLink[] = rawCloneLinks.map((cl) => {
        const key = `${cl.clonerX},${cl.clonerY}`;
        const tpl = clonerTemplates.get(key) || entitiesMap.get(key);
        return {
          buttonX: cl.buttonX,
          buttonY: cl.buttonY,
          clonerX: cl.clonerX,
          clonerY: cl.clonerY,
          templateType: tpl ? tpl.type : 'dirt_block',
          templateDir: tpl ? tpl.dir : 'S'
        };
      });

      levels.push({
        id: `${packPrefix}_level_${levelNumber || idx + 1}`,
        number: levelNumber || idx + 1,
        customTitle,
        customHint,
        password: password || 'CCLP',
        timeLimitSeconds,
        chipsRequired,
        playerStart,
        terrain,
        items,
        entities: orderedEntities,
        trapLinks: rawTrapLinks,
        cloneLinks
      });

      offset = levelEndOffset;
    }

    return levels;
  }

  private static applyElementToCell(
    x: number,
    y: number,
    elem: DatElementMapping,
    terrain: string[][],
    items: (string | null)[][],
    entitiesMap: Map<string, EntityPlacement>,
    clonerTemplates: Map<string, { type: string; dir: Direction }>,
    setPlayerStart: (ps: { x: number; y: number; dir: Direction }) => void
  ): void {
    const key = `${x},${y}`;
    if (elem.kind === 'terrain') {
      if (elem.id !== 'floor' || terrain[y][x] === 'floor') {
        terrain[y][x] = elem.id;
      }
    } else if (elem.kind === 'item') {
      items[y][x] = elem.id;
    } else if (elem.kind === 'player') {
      setPlayerStart({ x, y, dir: elem.dir || 'S' });
    } else if (elem.kind === 'entity') {
      if (elem.isClonerTemplate) {
        terrain[y][x] = 'clone_machine';
      }
      entitiesMap.set(key, { x, y, type: elem.id, dir: elem.dir || 'S' });
      clonerTemplates.set(key, { type: elem.id, dir: elem.dir || 'S' });
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
        const key = `${mapping.id}:${mapping.dir || 'S'}`;
        if (!entityDirToByte.has(key)) {
          entityDirToByte.set(key, code);
        }
      } else if (mapping.kind === 'player' && mapping.dir) {
        playerDirToByte.set(mapping.dir, code);
      }
    }

    const encodedLevelBlocks: Uint8Array[] = [];

    for (let idx = 0; idx < levels.length; idx++) {
      const lvl = levels[idx];
      const layer1Raw = new Uint8Array(datCfg.layerByteLength);
      const layer2Raw = new Uint8Array(datCfg.layerByteLength);

      const entByCoord = new Map<string, EntityPlacement>();
      for (const e of lvl.entities) {
        entByCoord.set(`${e.x},${e.y}`, e);
      }

      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const cellIdx = y * mapWidth + x;
          const tCode = terrainToByte.get(lvl.terrain[y][x]) ?? 0;
          const itemId = lvl.items[y][x];
          const iCode = itemId ? (itemToByte.get(itemId) ?? 0) : null;
          const ent = entByCoord.get(`${x},${y}`);
          const isPlayer = lvl.playerStart.x === x && lvl.playerStart.y === y;

          if (isPlayer) {
            layer1Raw[cellIdx] = playerDirToByte.get(lvl.playerStart.dir) ?? 110;
            layer2Raw[cellIdx] = iCode ?? tCode;
          } else if (ent) {
            const eCode =
              entityDirToByte.get(`${ent.type}:${ent.dir}`) ??
              entityDirToByte.get(`${ent.type}:S`) ??
              10;
            layer1Raw[cellIdx] = eCode;
            layer2Raw[cellIdx] = iCode ?? tCode;
          } else if (iCode !== null) {
            layer1Raw[cellIdx] = iCode;
            layer2Raw[cellIdx] = tCode;
          } else {
            layer1Raw[cellIdx] = tCode;
            layer2Raw[cellIdx] = 0;
          }
        }
      }

      const layer1Comp = this.compressLayer(layer1Raw, datCfg.rleMarkerByte);
      const layer2Comp = this.compressLayer(layer2Raw, datCfg.rleMarkerByte);
      const optionalBlock = this.encodeOptionalFields(lvl, datCfg);

      const levelDataSize =
        10 + 2 + layer1Comp.length + 2 + layer2Comp.length + 2 + optionalBlock.length;
      const block = new Uint8Array(2 + levelDataSize);
      const bView = new DataView(block.buffer);

      bView.setUint16(0, levelDataSize, true);
      bView.setUint16(2, lvl.number || idx + 1, true);
      bView.setUint16(4, lvl.timeLimitSeconds, true);
      bView.setUint16(6, lvl.chipsRequired, true);
      bView.setUint16(8, 1, true);

      let pos = 10;
      bView.setUint16(pos, layer1Comp.length, true);
      pos += 2;
      block.set(layer1Comp, pos);
      pos += layer1Comp.length;

      bView.setUint16(pos, layer2Comp.length, true);
      pos += 2;
      block.set(layer2Comp, pos);
      pos += layer2Comp.length;

      bView.setUint16(pos, optionalBlock.length, true);
      pos += 2;
      block.set(optionalBlock, pos);

      encodedLevelBlocks.push(block);
    }

    const totalLen = 6 + encodedLevelBlocks.reduce((acc, b) => acc + b.length, 0);
    const out = new Uint8Array(totalLen);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, datCfg.defaultMagicHeader, true);
    outView.setUint16(4, encodedLevelBlocks.length, true);

    let writePos = 6;
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
      while (i + runLen < raw.length && raw[i + runLen] === val && runLen < 255) {
        runLen++;
      }
      if (runLen > 3 || val === rleMarker) {
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

  private static encodeOptionalFields(
    lvl: CompiledLevel,
    datCfg: ReturnType<typeof ConfigRegistry.getDatFormat>
  ): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Title (Field 3)
    const titleStr = lvl.customTitle || lvl.id || 'Epoxy Level';
    const titleBytes = this.encodeAsciiNullTerminated(titleStr);
    chunks.push(new Uint8Array([datCfg.fieldCodes.title, titleBytes.length, ...titleBytes]));

    // Encrypted Password (Field 6)
    const passStr = (lvl.password || 'EPOX').slice(0, 4).toUpperCase();
    const passBytes = new Uint8Array(passStr.length + 1);
    for (let i = 0; i < passStr.length; i++) {
      passBytes[i] = passStr.charCodeAt(i) ^ datCfg.passwordXorKey;
    }
    passBytes[passStr.length] = 0;
    chunks.push(
      new Uint8Array([datCfg.fieldCodes.encryptedPassword, passBytes.length, ...passBytes])
    );

    // Hint (Field 7)
    if (lvl.customHint) {
      const hintBytes = this.encodeAsciiNullTerminated(lvl.customHint);
      chunks.push(new Uint8Array([datCfg.fieldCodes.hint, hintBytes.length, ...hintBytes]));
    }

    // Trap Links (Field 4)
    if (lvl.trapLinks.length > 0) {
      const trapBuf = new Uint8Array(lvl.trapLinks.length * 10);
      const tView = new DataView(trapBuf.buffer);
      lvl.trapLinks.forEach((tl, idx) => {
        const base = idx * 10;
        tView.setUint16(base, tl.buttonX, true);
        tView.setUint16(base + 2, tl.buttonY, true);
        tView.setUint16(base + 4, tl.trapX, true);
        tView.setUint16(base + 6, tl.trapY, true);
        tView.setUint16(base + 8, 0, true);
      });
      chunks.push(new Uint8Array([datCfg.fieldCodes.trapLinks, trapBuf.length, ...trapBuf]));
    }

    // Clone Links (Field 5)
    if (lvl.cloneLinks.length > 0) {
      const cloneBuf = new Uint8Array(lvl.cloneLinks.length * 8);
      const cView = new DataView(cloneBuf.buffer);
      lvl.cloneLinks.forEach((cl, idx) => {
        const base = idx * 8;
        cView.setUint16(base, cl.buttonX, true);
        cView.setUint16(base + 2, cl.buttonY, true);
        cView.setUint16(base + 4, cl.clonerX, true);
        cView.setUint16(base + 6, cl.clonerY, true);
      });
      chunks.push(new Uint8Array([datCfg.fieldCodes.cloneLinks, cloneBuf.length, ...cloneBuf]));
    }

    // Monster List (Field 10)
    const monsters = lvl.entities.filter(
      (e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster'
    );
    if (monsters.length > 0) {
      const mBuf = new Uint8Array(monsters.length * 2);
      monsters.forEach((m, idx) => {
        mBuf[idx * 2] = m.x;
        mBuf[idx * 2 + 1] = m.y;
      });
      chunks.push(new Uint8Array([datCfg.fieldCodes.monsterList, mBuf.length, ...mBuf]));
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

  private static encodeAsciiNullTerminated(text: string): Uint8Array {
    const clean = text.slice(0, 120);
    const out = new Uint8Array(clean.length + 1);
    for (let i = 0; i < clean.length; i++) {
      out[i] = clean.charCodeAt(i) & 0x7f;
    }
    out[clean.length] = 0;
    return out;
  }
}
