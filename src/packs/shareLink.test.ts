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

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_FORMAT, PACK_JSON_VERSION } from '../config/constants';
import { CompiledLevel } from '../core/types';
import { importCc3dSelection } from '../ui/cc3dImport';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { serializePack } from './packJson';
import {
  appUrlWithoutHash,
  browserDigest,
  browserStreams,
  decodeShareHash,
  encodeShareLink,
  fromBase64Url,
  isShareEncoderSupported,
  isShareHash,
  isSourceHash,
  readSharedPack,
  sha256Hex,
  ShareReadContext,
  ShareStreams,
  toBase64Url
} from './shareLink';

const APP_URL = 'https://example.test/epoxy/?lang=fr';
const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;
const BOMB_BYTES = 64_000_000;
const SMALL_CAP = 1000;
const WRITE_SLICE = 1024;
/** What the inflater may have produced in the chunk that crossed the cap. */
const OUTPUT_CHUNK_ALLOWANCE = 262144;
const FIXED_NOW = () => 7000;

function cc3dXml(): string {
  const tile = (type: number, x: number, y: number) =>
    `<tile image_index="${type}" x="${x * CELL}" y="${y * CELL}" direction="0" type="${type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`;
  return `<?xml version="1.0" encoding="utf-8"?><map name="Valid" author="A" width="5" height="5" background="0"><tiles>${tile(PLAYER_TYPE, 0, 0)}${tile(FISH_TYPE, 2, 2)}</tiles></map>`;
}

async function makeCc3dLevel(): Promise<CompiledLevel> {
  const text = cc3dXml();
  const file = { name: '1.xml', size: 1, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  const { levels } = await importCc3dSelection([file], 1024, 'Pack');
  return levels[0];
}

function context(overrides: Partial<ShareReadContext> = {}): ShareReadContext {
  return {
    bounds: ConfigRegistry.getLevelSizeBounds(),
    takenLevelIds: new Set(),
    metadataLimits: ConfigRegistry.getPackMetadataLimits(),
    textLimits: ConfigRegistry.getLevelTextLimits(),
    share: ConfigRegistry.getGame().share,
    now: FIXED_NOW,
    ...overrides
  };
}

async function linkOf(text: string, streams?: ShareStreams): Promise<string> {
  const result = await encodeShareLink(text, APP_URL, Number.MAX_SAFE_INTEGER, streams);
  if (!result.ok) throw new Error(result.error);
  return result.url;
}

function hashOf(url: string): string {
  return new URL(url).hash;
}

/** A link whose payload is the given bytes, deflated. */
async function linkOfBytes(bytes: Uint8Array): Promise<string> {
  const streams = browserStreams();
  const pair = streams.createCompressor!();
  const writer = pair.writable.getWriter();
  void writer.write(bytes).then(() => writer.close());
  const reader = pair.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return `#pack=1.${toBase64Url(Buffer.concat(chunks))}`;
}

describe('shareLink', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('round-trips an epoxy and a cc3d level with the author and the description', async () => {
    const levels = [
      { ...makeLevel('e1', { customTitle: 'Plain', theme: 'night', solution: 'NES' }), number: 1 },
      { ...(await makeCc3dLevel()), id: 'c1', number: 2 }
    ];
    const text = serializePack('Shared', levels, { author: 'Ada', description: 'Line one\nLine two' }, true);
    const url = await linkOf(text);
    expect(url.startsWith('https://example.test/epoxy/?lang=fr#pack=1.')).toBe(true);
    const result = await readSharedPack(hashOf(url), context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.name).toBe('Shared');
    expect(result.pack.author).toBe('Ada');
    expect(result.pack.description).toBe('Line one\nLine two');
    expect(result.pack.levels).toEqual(levels);
    expect(result.pack.levels[1].cc3d).toEqual(levels[1].cc3d);
    expect(result.pack.text).toBe(text);
  });

  it('writes the link on the page address without its own fragment', async () => {
    const text = serializePack('P', [makeLevel('a')], {}, true);
    const result = await encodeShareLink(text, 'https://example.test/epoxy/#old=1', Number.MAX_SAFE_INTEGER);
    expect(result.ok && result.url.startsWith('https://example.test/epoxy/#pack=1.')).toBe(true);
    expect(appUrlWithoutHash('https://example.test/a?b=1#c')).toBe('https://example.test/a?b=1');
  });

  it('refuses a link above the character limit', async () => {
    const text = serializePack('P', [makeLevel('a')], {}, true);
    const result = await encodeShareLink(text, APP_URL, 40);
    expect(result).toEqual({ ok: false, error: 'too_long' });
  });

  it('reports an encoder that the browser lacks', async () => {
    expect(isShareEncoderSupported({})).toBe(false);
    expect(isShareEncoderSupported(browserStreams())).toBe(true);
    expect(await encodeShareLink('{}', APP_URL, 8000, {})).toEqual({ ok: false, error: 'unsupported' });
  });

  it('recognises a pack hash and nothing else', () => {
    expect(isShareHash('#pack=1.abc')).toBe(true);
    expect(isShareHash('#pack=')).toBe(true);
    expect(isShareHash('#other=1')).toBe(false);
    expect(isShareHash('')).toBe(false);
  });

  describe('decoding', () => {
    it('asks for a newer browser when decompression is missing', async () => {
      const url = await linkOf(serializePack('P', [makeLevel('a')], {}, true));
      expect(await decodeShareHash(hashOf(url), 262144, {})).toEqual({ ok: false, error: 'unsupported' });
      expect(await readSharedPack(hashOf(url), context({ streams: {} }))).toEqual({ ok: false, error: 'unsupported' });
    });

    it('reads the transport version before decoding anything', async () => {
      expect(await decodeShareHash('#pack=2.!!!not-base64!!!', 262144)).toEqual({ ok: false, error: 'newer' });
      expect(await decodeShareHash('#pack=17.', 262144)).toEqual({ ok: false, error: 'newer' });
      expect(await decodeShareHash('#pack=0.AAAA', 262144)).toEqual({ ok: false, error: 'damaged' });
      expect(await decodeShareHash('#pack=x.AAAA', 262144)).toEqual({ ok: false, error: 'damaged' });
      expect(await decodeShareHash('#pack=AAAA', 262144)).toEqual({ ok: false, error: 'damaged' });
    });

    it('reports a pack file of a newer schema as made with a newer version', async () => {
      const file = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION + 1, name: 'Later', levels: [makeLevel('a')] };
      const url = await linkOf(JSON.stringify(file));
      expect(await readSharedPack(hashOf(url), context())).toEqual({ ok: false, error: 'newer' });
    });

    it('calls every other failure damaged', async () => {
      const encode = (text: string) => linkOfBytes(new TextEncoder().encode(text));
      const goodFile = JSON.parse(serializePack('P', [makeLevel('a')], {}, true)) as Record<string, unknown>;
      const cases: Record<string, string> = {
        'bad base64 alphabet': '#pack=1.@@@@',
        'impossible base64 length': '#pack=1.AAAAA',
        'empty payload': '#pack=1.',
        'not deflate': '#pack=1.AAECAwQFBgcICQoLDA0ODw',
        'not json': await encode('not json at all'),
        'json but not a pack': await encode('[1,2,3]'),
        'wrong format': await encode(JSON.stringify({ ...goodFile, format: 'other' })),
        'no levels': await encode(JSON.stringify({ ...goodFile, levels: [] })),
        'no valid level': await encode(JSON.stringify({ ...goodFile, levels: [{ id: 'x' }] })),
        'blank name': await encode(JSON.stringify({ ...goodFile, name: '  ' }))
      };
      for (const [label, hash] of Object.entries(cases)) {
        const hashOnly = hash.startsWith('#') ? hash : hashOf(hash);
        expect(await readSharedPack(hashOnly, context()), label).toEqual({ ok: false, error: 'damaged' });
      }
    });

    it('calls text that is not UTF-8 damaged', async () => {
      const hash = await linkOfBytes(Uint8Array.from([0xff, 0xfe, 0xfd]));
      expect(await decodeShareHash(hash, 262144)).toEqual({ ok: false, error: 'damaged' });
    });

    it('stops inflating as soon as the output passes the byte cap', async () => {
      const bomb = await linkOfBytes(new Uint8Array(BOMB_BYTES));
      const streams = browserStreams();
      const totalSlices = Math.ceil(fromBase64Url(bomb.slice('#pack=1.'.length))!.length / WRITE_SLICE);
      let produced = 0;
      let slicesWritten = 0;
      const counting: ShareStreams = {
        createDecompressor: () => {
          const pair = streams.createDecompressor!();
          const writer = pair.writable.getWriter();
          const input = new TransformStream<Uint8Array, Uint8Array>();
          void input.readable.pipeTo(
            new WritableStream<Uint8Array>({
              async write(chunk) {
                slicesWritten += 1;
                await writer.ready;
                await writer.write(chunk);
              },
              close: () => writer.close(),
              abort: (reason) => writer.abort(reason)
            })
          ).catch(() => undefined);
          const output = new TransformStream<Uint8Array, Uint8Array>(
            {
              transform(chunk, controller) {
                produced += chunk.length;
                controller.enqueue(chunk);
              }
            },
            undefined,
            { highWaterMark: 0 }
          );
          void pair.readable.pipeTo(output.writable).catch(() => undefined);
          return { readable: output.readable, writable: input.writable };
        }
      };
      expect(totalSlices).toBeGreaterThan(8);
      expect(await decodeShareHash(bomb, SMALL_CAP, counting)).toEqual({ ok: false, error: 'damaged' });
      expect(produced).toBeLessThanOrEqual(SMALL_CAP + OUTPUT_CHUNK_ALLOWANCE);
      expect(slicesWritten).toBeLessThan(totalSlices);
    });

    it('refuses a payload above the bound before decoding it', async () => {
      const url = await linkOf(serializePack('P', [makeLevel('a')], {}, true));
      const hash = hashOf(url);
      const streams = browserStreams();
      const createDecompressor = vi.fn(streams.createDecompressor!);
      const spy = { createDecompressor };
      expect(await decodeShareHash(hash, 262144, spy, hash.length)).toMatchObject({ ok: true });
      createDecompressor.mockClear();
      expect(await decodeShareHash(hash, 262144, spy, 20)).toEqual({ ok: false, error: 'damaged' });
      expect(createDecompressor).not.toHaveBeenCalled();
    });

    it('keeps a text exactly at the cap', async () => {
      const text = 'x'.repeat(SMALL_CAP);
      const hash = await linkOfBytes(new TextEncoder().encode(text));
      expect(await decodeShareHash(hash, SMALL_CAP)).toEqual({ ok: true, text });
      expect(await decodeShareHash(hash, SMALL_CAP - 1)).toEqual({ ok: false, error: 'damaged' });
    });
  });

  describe('source hash', () => {
    it('is the SHA-256 of the decoded text', async () => {
      const text = serializePack('P', [makeLevel('a')], {}, true);
      const result = await readSharedPack(hashOf(await linkOf(text)), context());
      const expected = createHash('sha256').update(text).digest('hex');
      expect(result.ok && result.pack.sourceHash).toBe(expected);
      expect(isSourceHash(expected)).toBe(true);
      expect(isSourceHash('abc')).toBe(false);
      expect(isSourceHash(expected.toUpperCase())).toBe(false);
    });

    it('is left out where the browser has no digest', async () => {
      const text = serializePack('P', [makeLevel('a')], {}, true);
      const result = await readSharedPack(hashOf(await linkOf(text)), context({ digest: null }));
      expect(result.ok && result.pack.sourceHash).toBeUndefined();
      expect(await sha256Hex('x', null)).toBeUndefined();
      expect(browserDigest()).not.toBeNull();
    });
  });

  it('re-issues the level ids the library already holds', async () => {
    const text = serializePack('P', [makeLevel('taken')], {}, true);
    const result = await readSharedPack(hashOf(await linkOf(text)), context({ takenLevelIds: new Set(['taken']) }));
    expect(result.ok && result.pack.levels[0].id).not.toBe('taken');
  });

  it('base64url coding is reversible and strict', () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255, 1]);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(fromBase64Url(text)!)).toEqual(Array.from(bytes));
    expect(fromBase64Url('a+b')).toBeNull();
    expect(fromBase64Url('abcde')).toBeNull();
  });
});
