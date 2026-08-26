import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { crc16, createKanaChainBlockCode } from "../src/codec.mjs";
import {
  hiraganaToKatakana,
  katakanaToHiragana,
  parseCodebook,
} from "../src/dictionary.mjs";

const codec = await createKanaChainBlockCode();
const bytes = (n) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 73 + 11) & 255);
const codebookJson = JSON.parse(
  await readFile(new URL("../codebook.json", import.meta.url), "utf8"),
);

test("A1/D1 versions and dictionary metadata", () => {
  assert.equal(codec.info.algorithmVersion, 1);
  assert.equal(codec.info.dictionaryVersion, 1);
  assert.equal(codec.info.normalWords, 2748);
  assert.equal(codec.info.terminalWords, 428);
  assert.equal(codec.info.states, 67);
});

test("CRC-16/CCITT-FALSE matches its standard check value", () => {
  assert.equal(crc16(new TextEncoder().encode("123456789")), 0x29b1);
});

test("raw binary, compressed binary, UTF-16 and compressed UTF-16 round trip", () => {
  for (const value of [bytes(0), bytes(1), bytes(19), bytes(100)]) {
    const encoded = codec.serialize(value);
    assert.deepEqual(codec.deserialize(encoded.text).data, value);
  }
  for (const value of ["こんにちは", "The quick brown fox ".repeat(10)]) {
    const encoded = codec.serialize(value);
    assert.equal(
      new TextDecoder().decode(codec.deserialize(encoded.text).data),
      value,
    );
  }
});

test("serialized blocks are connected, locally unique, and terminate once", () => {
  const encoded = codec.serialize(bytes(257));
  let expectedHead = null;
  for (const [blockIndex, displayBlock] of encoded.blocks.entries()) {
    const block = displayBlock.map(katakanaToHiragana);
    assert.equal(new Set(block).size, block.length);
    if (blockIndex < encoded.blocks.length - 1) assert.equal(block.length, 35);
    for (const [wordIndex, word] of block.entries()) {
      if (expectedHead !== null) assert.equal(word[0], expectedHead);
      expectedHead = word.at(-1);
      const final =
        blockIndex === encoded.blocks.length - 1 &&
        wordIndex === block.length - 1;
      assert.equal(word.endsWith("ん"), final);
    }
  }
});

test("pretty separators, CRLF boundaries, and mixed kana scripts are accepted", () => {
  const source = "猫🐈‍⬛とNUL\0も往復";
  const encoded = codec.serialize(source, { pretty: true });
  assert.match(encoded.text, /　/u);
  const mixed = encoded.canonicalBlocks.map((block, blockIndex) =>
    block.map((word, wordIndex) =>
      (blockIndex + wordIndex) % 2 ? word : hiraganaToKatakana(word),
    ),
  );
  const withCrLf = mixed.map((block) => block.join("　")).join("\r\n");
  assert.equal(
    new TextDecoder().decode(codec.deserialize(withCrLf).data),
    source,
  );
});

test("empty and unterminated word lists are rejected", () => {
  assert.throws(() => codec.deserialize(""), /must not be empty/);
  const encoded = codec.serialize("しりとり");
  assert.throws(
    () => codec.deserialize(encoded.words.slice(0, -1)),
    /ん|terminal/,
  );
});

test("canonical word vectors decode and preserve every block", () => {
  const encoded = codec.encodeFrame(Uint8Array.from([1, 1, 0, 1, 2, 3]));
  assert.deepEqual(
    codec.decodeFrame(encoded.canonicalBlocks),
    Uint8Array.from([1, 1, 0, 1, 2, 3]),
  );
  for (const block of encoded.canonicalBlocks)
    assert.equal(new Set(block).size, block.length);
});

test("decodeFrameBlocks returns CRC-verified payloads in block order", () => {
  const frame = bytes(40);
  const encoded = codec.encodeFrame(frame);
  const blockData = codec.decodeFrameBlocks(encoded.text);
  assert.equal(blockData.length, encoded.blocks.length);
  assert.ok(blockData.every((data) => data.length <= 18));
  assert.deepEqual(
    Uint8Array.from(blockData.flatMap((data) => [...data])),
    frame,
  );
});

test("same reading twice in a block is rejected", () => {
  const encoded = codec.encodeFrame(Uint8Array.from([1, 1, 0]));
  const words = encoded.canonicalBlocks.map((b) => [...b]);
  words[0][1] = words[0][0];
  assert.throws(() => codec.decodeFrame(words), /duplicate|invalid|CRC/);
});

test("first block starts from multiple CRC-derived states", () => {
  const states = new Set();
  for (let i = 0; i < 64; i += 1)
    states.add(
      codec.encodeFrame(Uint8Array.from([1, 1, 0, i])).canonicalBlocks[0][0][0],
    );
  assert.ok(states.size > 1);
});

test("CRC-derived start rule can reach all 67 dictionary states", () => {
  const crc16 = (input) => {
    let crc = 0xffff;
    for (const byte of input) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc =
          crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  };
  const reached = new Set();
  for (let value = 0; value <= 0xffff; value += 1) {
    const checked = Uint8Array.of(1, 0, 0, 0, 0, 2, value >> 8, value & 255);
    reached.add(crc16(checked) % codec.startStates.length);
  }
  assert.equal(reached.size, 67);
});

test("raw path rank accepts self-loop and palindrome words", () => {
  assert.equal(codec.paths.rankNormal(["もも"], "も").rank >= 0n, true);
  assert.equal(codec.paths.rankNormal(["まま"], "ま").rank >= 0n, true);
  assert.equal(codec.paths.rankNormal(["もも", "もも"], "も").rank >= 0n, true);
  assert.equal(codec.paths.rank(["もも", "もん"], "も").rank >= 0n, true);
});

test("rank and unrank are inverse at representative boundaries", () => {
  for (const state of ["あ", "も", "ぬ"]) {
    for (const wordCount of [1, 2, 5, 35]) {
      const count = codec.paths.normalPathCount(wordCount, state);
      for (const rank of [0n, count / 2n, count - 1n]) {
        const path = codec.paths.unrankNormal(rank, wordCount, state);
        assert.equal(codec.paths.rankNormal(path.words, state).rank, rank);
      }
    }
  }
});

test("a one-word corruption is localized to its block", () => {
  const encoded = codec.encodeFrame(bytes(73));
  assert.ok(encoded.canonicalBlocks.length >= 4);
  for (
    let blockIndex = 0;
    blockIndex < encoded.canonicalBlocks.length;
    blockIndex += 1
  ) {
    const blocks = encoded.canonicalBlocks.map((block) => [...block]);
    const block = blocks[blockIndex];
    let replacement = null;
    for (
      let wordIndex = 0;
      wordIndex < block.length - 1 && !replacement;
      wordIndex += 1
    ) {
      const word = block[wordIndex];
      const candidate = codec.dictionary.normalWords.find(
        (other) =>
          other !== word &&
          other[0] === word[0] &&
          other.at(-1) === word.at(-1) &&
          !block.includes(other),
      );
      if (candidate) replacement = [wordIndex, candidate];
    }
    assert.ok(replacement, `no mutation found for block ${blockIndex}`);
    block[replacement[0]] = replacement[1];
    assert.throws(
      () => codec.decodeFrame(blocks),
      new RegExp(`block ${blockIndex}`),
    );
  }
});

test("a later block failure exposes payloads from earlier verified blocks", () => {
  const encoded = codec.encodeFrame(bytes(40));
  assert.ok(encoded.canonicalBlocks.length >= 2);
  const blocks = encoded.canonicalBlocks.map((block) => [...block]);
  const expectedPayloads = codec.decodeFrameBlocks(blocks);
  const secondBlock = blocks[1];
  let replacement = null;
  for (let wordIndex = 0; wordIndex < secondBlock.length - 1 && !replacement; wordIndex += 1) {
    const word = secondBlock[wordIndex];
    const candidate = codec.dictionary.normalWords.find(
      (other) =>
        other !== word &&
        other[0] === word[0] &&
        other.at(-1) === word.at(-1) &&
        !secondBlock.includes(other),
    );
    if (candidate) replacement = [wordIndex, candidate];
  }
  assert.ok(replacement, "no second-block mutation found");
  secondBlock[replacement[0]] = replacement[1];

  let failure;
  try {
    codec.decodeFrameBlocks(blocks);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  assert.match(failure.message, /block 1/);
  assert.equal(failure.verifiedBlocks.length, 1);
  assert.deepEqual(failure.verifiedBlocks[0], expectedPayloads[0]);
  assert.notEqual(failure.verifiedBlocks[0], expectedPayloads[0]);
});

test("unsupported algorithm, dictionary, and mode bytes are rejected", () => {
  for (const frame of [
    Uint8Array.of(2, 1, 0),
    Uint8Array.of(1, 2, 0),
    Uint8Array.of(1, 1, 4),
  ]) {
    assert.throws(() => codec.deserialize(codec.encodeFrame(frame).text));
  }
});

test("unknown dictionary words report the affected zero-based block", () => {
  const blocks = codec
    .encodeFrame(Uint8Array.of(1, 1, 0))
    .canonicalBlocks.map((b) => [...b]);
  blocks[0][0] = "未知語";
  assert.throws(() => codec.decodeFrame(blocks), /block 0/);
});

test("an explicit inter-block chain cut is reported before CRC decoding", () => {
  const blocks = codec
    .encodeFrame(bytes(40))
    .canonicalBlocks.map((b) => [...b]);
  const expected = blocks[0].at(-1).at(-1);
  blocks[1][0] = codec.dictionary.normalWords.find(
    (word) => word[0] !== expected,
  );
  assert.throws(() => codec.decodeFrame(blocks), /block 1 breaks the chain/);
});

test("normal block word counts below and above 35 are rejected", () => {
  const source = codec.encodeFrame(bytes(40)).canonicalBlocks;
  const short = source.map((b) => [...b]);
  short[0].pop();
  assert.throws(() => codec.decodeFrame(short), /block 0 uses 34 words/);
  const long = source.map((b) => [...b]);
  long[0].push(codec.dictionary.normalWords[0]);
  assert.throws(() => codec.decodeFrame(long), /block 0 uses 36 words/);
});

test("final block over 35 words and misplaced or missing terminal words are rejected", () => {
  const source = codec.encodeFrame(bytes(40)).canonicalBlocks;
  const tooLong = source.map((b) => [...b]);
  tooLong
    .at(-1)
    .push(
      ...Array.from(
        { length: 36 - tooLong.at(-1).length },
        () => codec.dictionary.normalWords[0],
      ),
    );
  assert.throws(() => codec.decodeFrame(tooLong), /final block .*too long/);
  const misplaced = source.map((b) => [...b]);
  misplaced[0][34] = codec.dictionary.terminalWords[0];
  assert.throws(
    () => codec.decodeFrame(misplaced),
    /terminal word is in the wrong block/,
  );
  const missing = source.map((b) => [...b]);
  missing.at(-1).pop();
  assert.throws(
    () => codec.decodeFrame(missing),
    /terminal word is in the wrong block/,
  );
});

test("CRC-valid invalid DEFLATE and UTF-16 payloads fail after block decoding", () => {
  const invalidDeflate = codec.encodeFrame(Uint8Array.of(1, 1, 1, 0xff)).text;
  assert.throws(
    () => codec.deserialize(invalidDeflate),
    /inflate|DEFLATE|invalid/i,
  );
  const oddUtf16 = codec.encodeFrame(Uint8Array.of(1, 1, 2, 0)).text;
  assert.throws(() => codec.deserialize(oddUtf16), /UTF|utf-16|decode/i);
  const loneSurrogate = codec.encodeFrame(Uint8Array.of(1, 1, 2, 0, 0xd8)).text;
  assert.throws(() => codec.deserialize(loneSurrogate), /UTF|utf-16|decode/i);
});

for (const [field, value, pattern] of [
  ["codecFormat", "KCB1", /codebook is for/],
  ["dictionaryVersion", 2, /dictionary version/],
  ["states", "い" + codebookJson.states.slice(1), /state order/],
  ["codebookSha256", "sha256:" + "0".repeat(64), /hash mismatch/],
]) {
  test(`codebook ${field} mutation is rejected`, async () => {
    const mutated = structuredClone(codebookJson);
    mutated[field] = value;
    await assert.rejects(() => parseCodebook(mutated), pattern);
  });
}
