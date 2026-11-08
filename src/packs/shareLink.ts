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

import {
  SHARE_LINK_COMPRESSION_FORMAT,
  SHARE_LINK_PARAM,
  SHARE_LINK_TRANSPORT_VERSION,
  SHARE_LINK_VERSION_SEPARATOR
} from '../config/constants';
import { LevelSizeBounds } from '../config/ConfigValidation';
import { CompiledLevel, LevelTextConfig, ShareConfig } from '../core/types';
import { parsePackJson } from './packJson';
import { PackMetadataLimits } from './packMetadata';
import { Clock } from './userPacks';

/**
 * Pack share links. A link carries a whole pack in its fragment: the compact JSON of the pack
 * file, deflated and written as base64url. Pure and free of the DOM: the stream constructors and
 * the digest are injected, so the module is tested without a browser.
 */

/** A stream pair that transforms bytes: a CompressionStream or a DecompressionStream. */
export interface ByteTransform {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

/** The stream constructors the link needs; a missing one means the browser lacks that half. */
export interface ShareStreams {
  createCompressor?: () => ByteTransform;
  createDecompressor?: () => ByteTransform;
}

/** SHA-256 of some bytes. */
export type DigestFunction = (bytes: Uint8Array) => Promise<ArrayBuffer>;

/** Why a link could not be made. */
export type ShareEncodeError = 'unsupported' | 'too_long' | 'cc2_content';

export type ShareEncodeResult = { ok: true; url: string } | { ok: false; error: ShareEncodeError };

/** Why a link could not be read. */
export type ShareDecodeError = 'unsupported' | 'newer' | 'damaged' | 'cc2_content';

export type ShareDecodeResult = { ok: true; text: string } | { ok: false; error: ShareDecodeError };

/** A shared pack, read and validated. */
export interface SharedPack {
  name: string;
  levels: CompiledLevel[];
  author?: string;
  description?: string;
  /** The decoded pack text, which the import reads again when the player confirms. */
  text: string;
  /** SHA-256 (hex) of `text`; absent where the browser has no digest. */
  sourceHash?: string;
}

export type SharedPackResult = { ok: true; pack: SharedPack } | { ok: false; error: ShareDecodeError };

/** What reading a link needs from the library and the configuration. */
export interface ShareReadContext {
  bounds: LevelSizeBounds;
  takenLevelIds: ReadonlySet<string>;
  metadataLimits: PackMetadataLimits;
  textLimits: LevelTextConfig;
  share: ShareConfig;
  streams?: ShareStreams;
  /** Defaults to the browser digest; pass `null` for none. */
  digest?: DigestFunction | null;
  now?: Clock;
}

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const VERSION_PATTERN = /^\d+$/;
const SOURCE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_BLOCK = 4;
const BASE64_INVALID_REMAINDER = 1;
const BYTE_RADIX = 16;
const HEX_BYTE_WIDTH = 2;
const BINARY_CHUNK = 0x8000;
const SHA256_ALGORITHM = 'SHA-256';
const NO_LIMIT = Number.POSITIVE_INFINITY;
/** Bytes handed to the decompressor at a time, so inflation can stop between two slices. */
const WRITE_SLICE_BYTES = 1024;

/** True for a text shaped like a SHA-256 hex digest. */
export function isSourceHash(value: string): boolean {
  return SOURCE_HASH_PATTERN.test(value);
}

/** The streams of the running browser; a half the browser lacks is left out. */
export function browserStreams(): ShareStreams {
  const streams: ShareStreams = {};
  try {
    if (typeof CompressionStream === 'function') {
      // Built once to prove the format is accepted, not only the constructor present.
      new CompressionStream(SHARE_LINK_COMPRESSION_FORMAT as CompressionFormat);
      streams.createCompressor = () => new CompressionStream(SHARE_LINK_COMPRESSION_FORMAT as CompressionFormat) as unknown as ByteTransform;
    }
  } catch {
    // Compression is not supported.
  }
  try {
    if (typeof DecompressionStream === 'function') {
      new DecompressionStream(SHARE_LINK_COMPRESSION_FORMAT as CompressionFormat);
      streams.createDecompressor = () => new DecompressionStream(SHARE_LINK_COMPRESSION_FORMAT as CompressionFormat) as unknown as ByteTransform;
    }
  } catch {
    // Decompression is not supported.
  }
  return streams;
}

/** True when links can be made in this browser. */
export function isShareEncoderSupported(streams: ShareStreams = browserStreams()): boolean {
  return streams.createCompressor !== undefined;
}

/** The SHA-256 digest of the browser, or null (an insecure page has no crypto.subtle). */
export function browserDigest(): DigestFunction | null {
  const subtle = globalThis.crypto?.subtle;
  return subtle ? (bytes) => subtle.digest(SHA256_ALGORITHM, bytes as unknown as BufferSource) : null;
}

/** The address of the page without its fragment. */
export function appUrlWithoutHash(href: string): string {
  const url = new URL(href);
  url.hash = '';
  return url.toString();
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Bytes of a base64url text without padding; null when the text is not one. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64_URL_PATTERN.test(text) || text.length % BASE64_BLOCK === BASE64_INVALID_REMAINDER) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Runs the bytes through a stream pair and returns what comes out, stopping once `maxBytes` is passed (null then). */
async function pump(pair: ByteTransform, input: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  const writer = pair.writable.getWriter();
  let stopped = false;
  // The input goes in slices, each one awaited, and the feeding runs beside the reading: a full
  // pipe waits for the reader. A failure reaches the reader as well, which is where it is handled.
  void (async () => {
    for (let at = 0; at < input.length && !stopped; at += WRITE_SLICE_BYTES) {
      await writer.ready;
      if (stopped) return;
      await writer.write(input.subarray(at, at + WRITE_SLICE_BYTES));
      // A turn of the event loop, so the reader sees the output of this slice (and stops the
      // feeding) before the next one goes in; promise ordering alone differs between runtimes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!stopped) await writer.close();
  })().catch(() => undefined);
  const reader = pair.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      stopped = true;
      await reader.cancel().catch(() => undefined);
      void writer.abort().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * The link for a pack file text (compact JSON): the page address without fragment, then
 * `#pack=1.<payload>`. Refused above `maxLinkChars`.
 */
export async function encodeShareLink(
  packText: string,
  baseUrl: string,
  maxLinkChars: number,
  streams: ShareStreams = browserStreams()
): Promise<ShareEncodeResult> {
  if (!streams.createCompressor) return { ok: false, error: 'unsupported' };
  let compressed: Uint8Array | null;
  try {
    compressed = await pump(streams.createCompressor(), new TextEncoder().encode(packText), NO_LIMIT);
  } catch {
    return { ok: false, error: 'unsupported' };
  }
  if (!compressed) return { ok: false, error: 'unsupported' };
  const fragment = `#${SHARE_LINK_PARAM}=${SHARE_LINK_TRANSPORT_VERSION}${SHARE_LINK_VERSION_SEPARATOR}${toBase64Url(compressed)}`;
  const url = `${appUrlWithoutHash(baseUrl)}${fragment}`;
  return url.length > maxLinkChars ? { ok: false, error: 'too_long' } : { ok: true, url };
}

/** The transport version and payload of a location hash, or null when the hash is not a pack link. */
export function splitShareHash(hash: string): { version: string; payload: string } | null {
  const prefix = `#${SHARE_LINK_PARAM}=`;
  if (!hash.startsWith(prefix)) return null;
  const rest = hash.slice(prefix.length);
  const at = rest.indexOf(SHARE_LINK_VERSION_SEPARATOR);
  if (at < 0) return { version: rest, payload: '' };
  return { version: rest.slice(0, at), payload: rest.slice(at + 1) };
}

/** True when the location hash is a pack link, whether it can be read or not. */
export function isShareHash(hash: string): boolean {
  return splitShareHash(hash) !== null;
}

/**
 * The pack file text held by a location hash. The transport version is read before anything is
 * decoded; inflating stops as soon as the output passes `maxDecodedBytes`.
 */
export async function decodeShareHash(
  hash: string,
  maxDecodedBytes: number,
  streams: ShareStreams = browserStreams(),
  maxPayloadChars: number = NO_LIMIT
): Promise<ShareDecodeResult> {
  const parts = splitShareHash(hash);
  if (!parts || !VERSION_PATTERN.test(parts.version)) return { ok: false, error: 'damaged' };
  const version = Number(parts.version);
  if (version > SHARE_LINK_TRANSPORT_VERSION) return { ok: false, error: 'newer' };
  if (version !== SHARE_LINK_TRANSPORT_VERSION) return { ok: false, error: 'damaged' };
  if (!streams.createDecompressor) return { ok: false, error: 'unsupported' };
  // Too long a payload is refused before any decoding is spent on it.
  if (parts.payload.length > maxPayloadChars) return { ok: false, error: 'damaged' };
  const compressed = fromBase64Url(parts.payload);
  if (!compressed || compressed.length === 0) return { ok: false, error: 'damaged' };
  try {
    const bytes = await pump(streams.createDecompressor(), compressed, maxDecodedBytes);
    if (!bytes) return { ok: false, error: 'damaged' };
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: 'damaged' };
  }
}

/** Lower case hex SHA-256 of a text; undefined without a digest. */
export async function sha256Hex(text: string, digest: DigestFunction | null = browserDigest()): Promise<string | undefined> {
  if (!digest) return undefined;
  try {
    const bytes = new Uint8Array(await digest(new TextEncoder().encode(text)));
    return Array.from(bytes, (b) => b.toString(BYTE_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join('');
  } catch {
    return undefined;
  }
}

/**
 * Reads a share link end to end: decodes it, then validates the pack as a file import does
 * (same bounds, taken level ids and limits). A pack file of a newer schema is "newer", any
 * other refusal is "damaged".
 */
export async function readSharedPack(hash: string, context: ShareReadContext): Promise<SharedPackResult> {
  const decoded = await decodeShareHash(hash, context.share.maxDecodedBytes, context.streams, context.share.maxLinkChars);
  if (!decoded.ok) return decoded;
  const parsed = parsePackJson(
    decoded.text,
    context.bounds,
    context.takenLevelIds,
    context.now,
    context.metadataLimits,
    context.textLimits
  );
  if (!parsed.ok) return { ok: false, error: parsed.error === 'version' ? 'newer' : 'damaged' };
  // Licensed CC2 content never travels in a link: a link that carries some was not made by this app.
  if (parsed.levels.some((level) => level.cc2 !== undefined)) return { ok: false, error: 'cc2_content' };
  const sourceHash = await sha256Hex(decoded.text, context.digest === undefined ? browserDigest() : context.digest);
  return {
    ok: true,
    pack: {
      name: parsed.name,
      levels: parsed.levels,
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.description ? { description: parsed.description } : {}),
      text: decoded.text,
      ...(sourceHash ? { sourceHash } : {})
    }
  };
}
