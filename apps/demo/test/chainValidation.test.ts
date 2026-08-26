import assert from "node:assert/strict";
import test from "node:test";

import { findChainBreak } from "../src/chainValidation.ts";

test("unknown readings still identify the word after the first chain break", () => {
  const result = findChainBreak([["あい", "未知語", "ごま"]]);

  assert.deepEqual(result?.after, {
    blockIndex: 0,
    wordIndex: 1,
    word: "未知語",
  });
});

test("katakana and hiragana are compared as the same reading", () => {
  assert.equal(findChainBreak([["アイ", "いえ", "エキ"]]), null);
});

test("a valid 35-word block boundary is not reported as a break", () => {
  const firstBlock = Array.from({ length: 35 }, () => "ああ");

  assert.equal(findChainBreak([firstBlock, ["あい", "いえ"]]), null);
});

test("a break at a block boundary identifies the next block's first word", () => {
  const firstBlock = Array.from({ length: 35 }, () => "ああ");
  const result = findChainBreak([firstBlock, ["かき", "きく"]]);

  assert.deepEqual(result?.after, {
    blockIndex: 1,
    wordIndex: 0,
    word: "かき",
  });
});
