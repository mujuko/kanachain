#!/usr/bin/env node
// 実装間で一致すべき値をvectors/a1d1.jsonへ書き出す。
//
// framesはフレームのバイト列と単語列の対応であり、圧縮方式やモード選択を
// 通さないため、どの実装でも完全に一致しなければならない。
// roundtripはserialize→deserializeが入力へ戻ることだけを求める。DEFLATEの
// 出力は実装によって異なりうるため、単語列そのものは固定しない。
import { writeFile } from "node:fs/promises";
import { createKanaChainBlockCode } from "../packages/js/src/codec.mjs";

const codec = await createKanaChainBlockCode();

function pseudoRandomBytes(length, seed) {
  const output = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    output[index] = state >>> 24;
  }
  return output;
}

// 18バイトを超えるフレームから通常ブロックが必要になる。境界の前後を含める。
const frameLengths = [0, 1, 5, 17, 18, 19, 36, 37, 100, 200];
const frames = [];
for (const length of frameLengths) {
  const frame = pseudoRandomBytes(length, 0x4b434231 + length);
  const encoded = codec.encodeFrame(frame);
  const decoded = codec.decodeFrame(encoded.text);
  if (!Buffer.from(decoded).equals(frame)) {
    throw new Error(`frame round-trip failed at ${length} bytes`);
  }
  frames.push({
    name: `${length}-byte frame`,
    frameHex: frame.toString("hex"),
    blocks: encoded.blocks.length,
    canonicalBlocks: encoded.canonicalBlocks,
  });
}

// すべて0とすべて1のフレームは、rank空間の下端と上端を踏む。
for (const [name, frame] of [
  ["all-zero 40-byte frame", Buffer.alloc(40, 0x00)],
  ["all-one 40-byte frame", Buffer.alloc(40, 0xff)],
]) {
  const encoded = codec.encodeFrame(frame);
  if (!Buffer.from(codec.decodeFrame(encoded.text)).equals(frame)) {
    throw new Error(`frame round-trip failed for ${name}`);
  }
  frames.push({
    name,
    frameHex: frame.toString("hex"),
    blocks: encoded.blocks.length,
    canonicalBlocks: encoded.canonicalBlocks,
  });
}

const roundtrip = [
  { name: "empty string", kind: "text", value: "" },
  { name: "hiragana greeting", kind: "text", value: "こんにちは" },
  { name: "mixed scripts", kind: "text", value: "こんにちは、KCBC" },
  {
    name: "ascii sentence",
    kind: "text",
    value: "The quick brown fox jumps over the lazy dog.",
  },
  {
    name: "repeated ascii",
    kind: "text",
    value: "The quick brown fox jumps over the lazy dog. ".repeat(3),
  },
  { name: "url", kind: "text", value: "https://github.com/mujuko/kanachain" },
  {
    name: "japanese prose",
    kind: "text",
    value: "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。",
  },
  { name: "astral plane", kind: "text", value: "🐈‍⬛しりとり🍣" },
  { name: "newline and spaces", kind: "text", value: "a\nb\tc  d" },
  { name: "empty bytes", kind: "bytes", valueHex: "" },
  { name: "single zero byte", kind: "bytes", valueHex: "00" },
  {
    name: "36 pseudo-random bytes",
    kind: "bytes",
    valueHex: pseudoRandomBytes(36, 0x12345678).toString("hex"),
  },
  {
    name: "256 pseudo-random bytes",
    kind: "bytes",
    valueHex: pseudoRandomBytes(256, 0x9e3779b9).toString("hex"),
  },
  {
    name: "1024 zero bytes",
    kind: "bytes",
    valueHex: Buffer.alloc(1024, 0).toString("hex"),
  },
];

for (const vector of roundtrip) {
  const input =
    vector.kind === "text" ? vector.value : Buffer.from(vector.valueHex, "hex");
  const serialized = codec.serialize(input);
  const deserialized = codec.deserialize(serialized.text);
  const restored =
    vector.kind === "text"
      ? Buffer.from(deserialized.data).toString("utf8")
      : Buffer.from(deserialized.data).toString("hex");
  const expected = vector.kind === "text" ? vector.value : vector.valueHex;
  if (restored !== expected) {
    throw new Error(`round-trip failed for ${vector.name}`);
  }
}

// 候補の比較順まで規範的なので、4モードそれぞれについてserializeの
// 最終出力も実装間で完全一致させる。
const canonicalSerializationInputs = [
  {
    name: "raw bytes",
    kind: "bytes",
    valueHex: pseudoRandomBytes(36, 0x12345678).toString("hex"),
    expectedMode: 0,
  },
  {
    name: "deflated UTF-8",
    kind: "text",
    value: "The quick brown fox ".repeat(10),
    expectedMode: 1,
  },
  {
    name: "raw UTF-16LE",
    kind: "text",
    value: "こんにちは",
    expectedMode: 2,
  },
  {
    name: "deflated UTF-16LE",
    kind: "text",
    value: "あ".repeat(200),
    expectedMode: 3,
  },
];
const canonicalSerialization = canonicalSerializationInputs.map((vector) => {
  const input =
    vector.kind === "text" ? vector.value : Buffer.from(vector.valueHex, "hex");
  const encoded = codec.serialize(input);
  if (encoded.metadata.mode !== vector.expectedMode) {
    throw new Error(
      `${vector.name} selected mode ${encoded.metadata.mode}, expected ${vector.expectedMode}`,
    );
  }
  return { ...vector, canonicalBlocks: encoded.canonicalBlocks };
});

const corruptionSource = frames.find(
  (vector) => vector.name === "100-byte frame",
).canonicalBlocks;
const invalidFrames = [];
for (
  let blockIndex = 0;
  blockIndex < corruptionSource.length;
  blockIndex += 1
) {
  const blocks = corruptionSource.map((block) => [...block]);
  const block = blocks[blockIndex];
  let changed = false;
  for (let wordIndex = 0; wordIndex < block.length - 1; wordIndex += 1) {
    const word = block[wordIndex];
    const replacement = codec.dictionary.normalWords.find(
      (other) =>
        other !== word &&
        other[0] === word[0] &&
        other.at(-1) === word.at(-1) &&
        !block.includes(other),
    );
    if (replacement) {
      block[wordIndex] = replacement;
      changed = true;
      break;
    }
  }
  if (!changed) throw new Error(`could not corrupt block ${blockIndex}`);
  invalidFrames.push({
    name: `one-word corruption in block ${blockIndex}`,
    expectedBlock: blockIndex,
    canonicalBlocks: blocks,
  });
}
invalidFrames.push(
  {
    name: "swapped first blocks",
    expectedBlock: 0,
    canonicalBlocks: [
      corruptionSource[1],
      corruptionSource[0],
      ...corruptionSource.slice(2),
    ],
  },
  {
    name: "deleted block",
    expectedBlock: 1,
    canonicalBlocks: [corruptionSource[0], ...corruptionSource.slice(2)],
  },
  {
    name: "duplicated block",
    expectedBlock: 2,
    canonicalBlocks: [
      corruptionSource[0],
      corruptionSource[1],
      corruptionSource[1],
      ...corruptionSource.slice(2),
    ],
  },
);
for (const vector of invalidFrames) {
  try {
    codec.decodeFrame(vector.canonicalBlocks);
    throw new Error(`${vector.name} was accepted`);
  } catch (error) {
    if (!String(error.message).includes(`block ${vector.expectedBlock}`)) {
      throw error;
    }
  }
}

const vectors = {
  format: "A1/D1",
  algorithmVersion: codec.info.algorithmVersion,
  codebookSha256: codec.dictionary.manifest.codebookSha256,
  dictionaryVersion: codec.dictionary.manifest.dictionaryVersion,
  note: "frames are normative for every implementation; roundtrip only requires serialize/deserialize to be inverse",
  frames,
  canonicalSerialization,
  invalidFrames,
  roundtrip,
};

await writeFile(
  new URL("../vectors/a1d1.json", import.meta.url),
  `${JSON.stringify(vectors, null, 2)}\n`,
  "utf8",
);
console.log(
  `vectors: ${frames.length} frames, ${roundtrip.length} round-trips`,
);
