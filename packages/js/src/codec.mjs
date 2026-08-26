import {
  bytesToUtf16le,
  bytesToUtf8,
  concatBytes,
  utf16leToBytes,
  utf8ToBytes,
} from "./bytes.mjs";
import { deflateRaw, inflateRaw } from "#deflate";
import {
  hiraganaToKatakana,
  katakanaToHiragana,
  loadDictionary,
  parseCodebook,
} from "./dictionary.mjs";
import { PathCodec, floorLog2 } from "./path-codec.mjs";

const ALGORITHM_VERSION = 1;
const DICTIONARY_VERSION = 1;
const MODE_RAW = 0;
const MODE_DEFLATE = 1;
const MODE_UTF16LE = 2;
const MODE_UTF16LE_DEFLATE = 3;
const NORMAL_WORDS = 35;
const MAX_BLOCK_BYTES = 18;
const MAX_FINAL_WORDS = 35;
const PATH_CANDIDATES = 128;

export function crc16(input) {
  let crc = 0xffff;
  for (const byte of input) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
function frameBytes(type, index, data) {
  const checked = new Uint8Array(6 + data.length);
  checked[0] = type;
  new DataView(checked.buffer).setUint32(1, index);
  checked[5] = data.length;
  checked.set(data, 6);
  const out = new Uint8Array(data.length + 3);
  out[0] = data.length;
  out.set(data, 1);
  const crc = crc16(checked);
  out[out.length - 2] = crc >> 8;
  out[out.length - 1] = crc & 255;
  return out;
}
function attachVerifiedBlocks(error, blocks) {
  const enriched = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(enriched, "verifiedBlocks", {
    enumerable: false,
    value: blocks.map((block) => Uint8Array.from(block)),
  });
  return enriched;
}
function bigIntFrom(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
function bigIntBytes(value, length) {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(value & 255n);
    value >>= 8n;
  }
  return out;
}
function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}
function readUtf8(value) {
  return typeof value === "string"
    ? utf8ToBytes(value)
    : Uint8Array.from(value);
}
function charLength(word) {
  return [...word].length;
}

// Small synchronous SHA-256 implementation (also works in browsers and Workers).
function sha256(data) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => od.setUint32(i * 4, v));
  return out;
}
function candidateT(prefix, type, index, state, frame, counter) {
  const b = concatBytes([
    utf8ToBytes(prefix),
    Uint8Array.of(0, type),
    new Uint8Array([
      index >>> 24,
      (index >>> 16) & 255,
      (index >>> 8) & 255,
      index & 255,
    ]),
    utf8ToBytes(state),
    frame,
    new Uint8Array([
      counter >>> 24,
      (counter >>> 16) & 255,
      (counter >>> 8) & 255,
      counter & 255,
    ]),
  ]);
  return bigIntFrom(sha256(b));
}
function pathScore(words, used) {
  const groups = [0, 0, 0];
  let reused = 0;
  let two = 0;
  let chars = 0;
  for (const w of words) {
    const n = charLength(w);
    groups[n === 2 ? 0 : n === 3 ? 1 : 2] += 1;
    if (used.has(w)) reused += 1;
    if (n === 2) two += 1;
    chars += n;
  }
  return [Math.max(...groups) - Math.min(...groups), reused, two, -chars];
}
function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function tokenize(value) {
  return value
    .trim()
    .split(/[\s\u3000]+/u)
    .filter(Boolean);
}
function terminal(word) {
  return katakanaToHiragana(word).endsWith("ん");
}
function inferBlocks(words) {
  const out = [];
  let block = [];
  for (let i = 0; i < words.length; i++) {
    block.push(words[i]);
    if (terminal(words[i])) {
      if (i !== words.length - 1)
        throw new Error(`word ${i + 1} ends the stream prematurely`);
      out.push(block);
      block = [];
    } else if (block.length === NORMAL_WORDS) {
      out.push(block);
      block = [];
    }
  }
  if (block.length || !out.length || !terminal(out.at(-1).at(-1)))
    throw new Error("last block does not end with ん");
  return out;
}
function parseBlocks(value) {
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0]))
      return value.map((b) => [...b]);
    return inferBlocks([...value]);
  }
  const text = value.normalize("NFC").trim();
  if (!text) return [];
  const lines = text
    .split(/\r?\n/u)
    .map(tokenize)
    .filter((b) => b.length);
  return lines.length > 1 ? lines : inferBlocks(lines.flat());
}

export class KanaChainBlockCode {
  constructor(dictionary) {
    this.dictionary = dictionary;
    this.paths = new PathCodec({
      ...dictionary,
      maximumWords: MAX_FINAL_WORDS,
    });
    this.startStates = dictionary.states;
    this.blockWords = NORMAL_WORDS;
    this.finalMaximumWords = MAX_FINAL_WORDS;
  }
  get info() {
    const caps = this.startStates.map((s) =>
      this.paths.normalCapacityBitsFor(35, s),
    );
    return {
      format: "A1/D1",
      name: "Kana Chain Block Code",
      abbreviation: "KCBC",
      algorithmVersion: ALGORITHM_VERSION,
      dictionaryVersion: DICTIONARY_VERSION,
      normalWords: this.dictionary.normalWords.length,
      terminalWords: this.dictionary.terminalWords.length,
      katakanaDisplayWords: this.dictionary.katakanaReadings.size,
      states: this.startStates.length,
      blockWords: NORMAL_WORDS,
      finalMaximumWords: MAX_FINAL_WORDS,
      frameOverheadBytes: 3,
      chainedBlockCapacityBits: {
        minimum: Math.min(...caps),
        maximum: Math.max(...caps),
      },
    };
  }
  #findPath(frame, type, index, start, normal, used) {
    const wordsLimit = normal
      ? [35]
      : Array.from({ length: 35 }, (_, i) => i + 1);
    for (const w of wordsLimit) {
      const count = normal
        ? this.paths.normalPathCount(w, start)
        : this.paths.pathCount(w, start);
      if (!count) continue;
      const b = floorLog2(count);
      const m = frame.length * 8;
      if (b < m + (normal ? 0 : 20)) continue;
      const S = 1n << BigInt(b);
      const M = 1n << BigInt(m);
      const r = b - m;
      let counter = 0;
      const seen = new Set();
      let best = null;
      while (seen.size < PATH_CANDIDATES) {
        const digest = candidateT(
          "KCBC-A1-PATH",
          type,
          index,
          start,
          frame,
          counter++,
        );
        const t = digest & ((1n << BigInt(r)) - 1n);
        if (seen.has(t)) continue;
        seen.add(t);
        const x = t * M + bigIntFrom(frame);
        const rho = (x * count) / S;
        let path;
        try {
          path = normal
            ? this.paths.unrankNormal(rho, w, start)
            : this.paths.unrank(rho, w, start);
        } catch {
          continue;
        }
        const local = new Set(path.words);
        if (local.size !== path.words.length) continue;
        const score = [...pathScore(path.words, used), rho];
        if (!best || compareScore(score, best.score) < 0)
          best = { path, score };
      }
      if (best) return best;
    }
    return null;
  }
  #encodeFrame(frame) {
    const blocks = [];
    const used = new Set();
    let offset = 0;
    let index = 0;
    let prevEnd = null;
    while (frame.length - offset > 18) {
      let chosen = null;
      for (let len = 18; len >= 1; len--) {
        const data = frame.slice(offset, offset + len);
        const check = frameBytes(0, index, data);
        const start =
          prevEnd ??
          this.startStates[
            crc16(
              new Uint8Array([
                0,
                index >>> 24,
                (index >>> 16) & 255,
                (index >>> 8) & 255,
                index & 255,
                len,
                ...data,
              ]),
            ) % this.startStates.length
          ];
        const found = this.#findPath(check, 0, index, start, true, used);
        if (found) {
          chosen = {
            words: found.path.words,
            start,
            end: found.path.endState,
            data,
            len,
            frame: check,
          };
          break;
        }
      }
      if (!chosen) throw new Error(`no valid path for block ${index}`);
      blocks.push(chosen);
      chosen.words.forEach((w) => used.add(w));
      prevEnd = chosen.end;
      offset += chosen.len;
      index++;
    }
    const data = frame.slice(offset);
    const check = frameBytes(1, index, data);
    const start =
      prevEnd ??
      this.startStates[
        crc16(
          new Uint8Array([
            1,
            index >>> 24,
            (index >>> 16) & 255,
            (index >>> 8) & 255,
            index & 255,
            data.length,
            ...data,
          ]),
        ) % this.startStates.length
      ];
    const found = this.#findPath(check, 1, index, start, false, used);
    if (!found) throw new Error(`no valid final path for block ${index}`);
    blocks.push({
      words: found.path.words,
      data,
      frame: check,
      start,
      end: found.path.endState,
    });
    return blocks;
  }
  encodeFrame(frame) {
    const encoded = this.#encodeFrame(Uint8Array.from(frame));
    const canonicalBlocks = encoded.map((b) => b.words);
    const blocks = canonicalBlocks.map((block) =>
      block.map((w) =>
        this.dictionary.katakanaReadings.has(w) ? hiraganaToKatakana(w) : w,
      ),
    );
    return {
      words: blocks.flat(),
      blocks,
      canonicalBlocks,
      canonicalWords: canonicalBlocks.flat(),
      text: this.format(blocks),
    };
  }
  serialize(input, { pretty = false } = {}) {
    const source = readUtf8(input);
    const text = typeof input === "string" ? input : null;
    const candidates = [];
    const payloads = [
      [0, source],
      [1, deflateRaw(source)],
    ];
    if (text !== null) {
      const u = utf16leToBytes(text);
      payloads.push([2, u], [3, deflateRaw(u)]);
    }
    for (const [mode, payload] of payloads) {
      const stream = concatBytes([Uint8Array.of(1, 1, mode), payload]);
      const enc = this.encodeFrame(stream);
      const words = enc.words;
      const chars = words.reduce((n, w) => n + charLength(w), 0);
      const global = new Set();
      let imbalance = 0,
        two = 0;
      for (const block of enc.canonicalBlocks) {
        const counts = [0, 0, 0];
        for (const w of block) {
          const n = charLength(w);
          counts[n === 2 ? 0 : n === 3 ? 1 : 2]++;
          if (n === 2) two++;
          global.add(w);
        }
        imbalance += Math.max(...counts) - Math.min(...counts);
      }
      candidates.push({
        ...enc,
        text: this.format(enc.blocks, { pretty }),
        canonicalWords: enc.canonicalBlocks.flat(),
        selectionScore: [
          words.length,
          enc.blocks.length,
          words.length - global.size,
          imbalance,
          two,
          -chars,
          stream.length,
          mode,
        ],
        metadata: {
          format: "A1/D1",
          sourceBytes: source.length,
          payloadBytes: payload.length,
          frameBytes: stream.length,
          compression: mode === 1 || mode === 3 ? "deflate" : "raw",
          encoding: mode >= 2 ? "utf16le" : "bytes",
          mode,
          blocks: enc.blocks.length,
          words: words.length,
          characters: chars,
        },
      });
    }
    candidates.sort((a, b) => compareScore(a.selectionScore, b.selectionScore));
    const { selectionScore: _, ...winner } = candidates[0];
    return winner;
  }
  #decodeBlock(words, type, index, startStates) {
    const candidates = [];
    for (const state of startStates) {
      const normal = type === 0;
      const countFor = (w) =>
        normal
          ? this.paths.normalPathCount(w, state)
          : this.paths.pathCount(w, state);
      if (normal && words.length !== 35) continue;
      if (!normal && (words.length > 35 || words.length < 1)) continue;
      let ranked;
      try {
        ranked = normal
          ? this.paths.rankNormal(words, state)
          : this.paths.rank(words, state);
      } catch {
        continue;
      }
      const rho = ranked.rank;
      const count = countFor(words.length);
      if (!count) continue;
      const b = floorLog2(count);
      const S = 1n << BigInt(b);
      const x = ceilDiv(rho * S, count);
      if (x >= S || (x * count) / S !== rho) continue;
      for (let len = type ? 0 : 1; len <= 18; len++) {
        const m = (len + 3) * 8;
        if (b < m + (type ? 20 : 0)) continue;
        const f = x & ((1n << BigInt(m)) - 1n);
        const frame = bigIntBytes(f, len + 3);
        if (frame[0] !== len) continue;
        const data = frame.slice(1, 1 + len);
        const checked = new Uint8Array(6 + len);
        checked[0] = type;
        new DataView(checked.buffer).setUint32(1, index);
        checked[5] = len;
        checked.set(data, 6);
        const crc = (frame[frame.length - 2] << 8) | frame.at(-1);
        if (crc16(checked) !== crc) continue;
        const expectedStart =
          index === 0
            ? this.startStates[crc16(checked) % this.startStates.length]
            : state;
        if (state !== expectedStart) continue;
        candidates.push({ data, end: ranked.endState });
      }
    }
    if (candidates.length !== 1)
      throw new Error(
        candidates.length
          ? `ambiguous block ${index}`
          : `CRC-16 mismatch in block ${index}`,
      );
    return candidates[0];
  }
  decodeFrameBlocks(value) {
    const display = parseBlocks(value);
    if (!display.length) throw new Error("word list must not be empty");
    const blocks = display.map((b) =>
      b.map((w) => katakanaToHiragana(w.normalize("NFC"))),
    );
    let stateList = this.startStates;
    const data = [];
    for (let i = 0; i < blocks.length; i++) {
      try {
        const block = blocks[i];
        const final = i === blocks.length - 1;
        if (block.length === 0) throw new Error(`block ${i} is empty`);
        if (!final && block.length !== 35)
          throw new Error(`block ${i} uses ${block.length} words; expected 35`);
        if (final && block.length > 35)
          throw new Error(`final block ${i} is too long`);
        if (final !== terminal(block.at(-1)))
          throw new Error(`terminal word is in the wrong block ${i}`);
        if (new Set(block).size !== block.length)
          throw new Error(`duplicate reading in block ${i}`);
        if (i && block[0][0] !== stateList[0])
          throw new Error(
            `block ${i} breaks the chain: expected ${stateList[0]}`,
          );
        const got = this.#decodeBlock(block, final ? 1 : 0, i, stateList);
        data.push(got.data);
        stateList = [got.end];
      } catch (error) {
        throw attachVerifiedBlocks(error, data);
      }
    }
    return data;
  }
  decodeFrame(value) {
    return concatBytes(this.decodeFrameBlocks(value));
  }
  deserialize(value) {
    const frameBlocks = this.decodeFrameBlocks(value);
    const frame = concatBytes(frameBlocks);
    if (frame.length < 3) throw new Error("stream header is truncated");
    if (frame[0] !== 1 || frame[1] !== 1)
      throw new Error(`unsupported version ${frame[0]}/${frame[1]}`);
    const mode = frame[2];
    if (mode & 0xfc || mode > 3) throw new Error(`unsupported mode ${mode}`);
    let payload = frame.slice(3);
    let data = payload;
    if (mode === 1 || mode === 3) data = inflateRaw(payload);
    if (mode === 2 || mode === 3) data = utf8ToBytes(bytesToUtf16le(data));
    const blocks = parseBlocks(value);
    return {
      data,
      words: blocks.flat(),
      blocks,
      metadata: {
        format: "A1/D1",
        outputBytes: data.length,
        payloadBytes: payload.length,
        frameBytes: frame.length,
        compression: mode === 1 || mode === 3 ? "deflate" : "raw",
        encoding: mode >= 2 ? "utf16le" : "bytes",
        mode,
        blocks: blocks.length,
        words: blocks.flat().length,
        characters: blocks.flat().reduce((n, w) => n + charLength(w), 0),
      },
    };
  }
  format(blocksOrWords, { pretty = false } = {}) {
    const blocks = Array.isArray(blocksOrWords[0])
      ? blocksOrWords
      : inferBlocks(blocksOrWords);
    return blocks.map((b) => b.join(pretty ? "　" : " ")).join("\n");
  }
}
export async function createKanaChainBlockCode(options = {}) {
  const dictionary = options.codebook
    ? await parseCodebook(options.codebook)
    : await loadDictionary(options.codebookPath);
  return new KanaChainBlockCode(dictionary);
}
