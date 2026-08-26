import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createKanaChainBlockCode } from "../src/codec.mjs";

const codec = await createKanaChainBlockCode();
const vectors = JSON.parse(
  await readFile(
    new URL("../../../vectors/a1d1.json", import.meta.url),
    "utf8",
  ),
);
const fromHex = (hex) =>
  hex.length === 0
    ? new Uint8Array()
    : Uint8Array.from(hex.match(/../g).map((x) => parseInt(x, 16)));

test("vectors target A1/D1 dictionary", () => {
  assert.equal(vectors.format, "A1/D1");
  assert.equal(
    vectors.codebookSha256,
    codec.dictionary.manifest.codebookSha256,
  );
});

test("vectors cover self-loops and cross-block reuse without local duplicates", () => {
  let hasSelfLoop = false;
  let hasCrossBlockReuse = false;
  for (const vector of vectors.frames) {
    const prior = new Set();
    for (const block of vector.canonicalBlocks) {
      assert.equal(new Set(block).size, block.length);
      if (block.length === 35) {
        const groups = [0, 0, 0];
        for (const word of block) {
          const length = [...word].length;
          groups[length === 2 ? 0 : length === 3 ? 1 : 2] += 1;
        }
        assert.ok(Math.max(...groups) - Math.min(...groups) <= 6);
      }
      hasSelfLoop ||= block.some((word) => word[0] === word.at(-1));
      hasCrossBlockReuse ||= block.some((word) => prior.has(word));
      block.forEach((word) => prior.add(word));
    }
  }
  assert.ok(hasSelfLoop);
  assert.ok(hasCrossBlockReuse);
});

for (const vector of vectors.frames) {
  test(`vector ${vector.name} is byte-for-byte canonical`, () => {
    const frame = fromHex(vector.frameHex);
    const encoded = codec.encodeFrame(frame);
    assert.deepEqual(encoded.canonicalBlocks, vector.canonicalBlocks);
    assert.deepEqual(codec.decodeFrame(vector.canonicalBlocks), frame);
  });
}

for (const vector of vectors.canonicalSerialization) {
  test(`serialize vector ${vector.name} is byte-for-byte canonical`, () => {
    const input =
      vector.kind === "text" ? vector.value : fromHex(vector.valueHex);
    const encoded = codec.serialize(input);
    assert.equal(encoded.metadata.mode, vector.expectedMode);
    assert.deepEqual(encoded.canonicalBlocks, vector.canonicalBlocks);
  });
}

for (const vector of vectors.invalidFrames) {
  test(`invalid vector ${vector.name} identifies its block`, () => {
    assert.throws(
      () => codec.decodeFrame(vector.canonicalBlocks),
      new RegExp(`block ${vector.expectedBlock}`),
    );
  });
}

for (const vector of vectors.roundtrip) {
  test(`round-trip vector ${vector.name}`, () => {
    const source =
      vector.kind === "text" ? vector.value : fromHex(vector.valueHex);
    const encoded = codec.serialize(source);
    const decoded = codec.deserialize(encoded.text).data;
    if (vector.kind === "text") {
      assert.equal(new TextDecoder().decode(decoded), vector.value);
    } else {
      assert.deepEqual(decoded, source);
    }
  });
}
