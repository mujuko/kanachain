// 辞書生成パイプラインの検証。符号器そのものではなく、生成された辞書と
// レポート群が入力ルールどおりの集合になっているかを確かめる。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createKanaChainBlockCode } from "../packages/js/src/codec.mjs";
import {
  hiraganaToKatakana,
  katakanaToHiragana,
} from "../packages/js/src/dictionary.mjs";

const codec = await createKanaChainBlockCode();
const dictionaryManifest = JSON.parse(
  await readFile(
    new URL("../dictionary/05-output/dictionary.json", import.meta.url),
    "utf8",
  ),
);

async function readTsv(relativeUrl) {
  const text = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  const [header, ...rows] = text
    .trimEnd()
    .split(/\r?\n/u)
    .map((row) => row.split("	"));
  return rows.map((row) =>
    Object.fromEntries(header.map((field, index) => [field, row[index]])),
  );
}

const sourcePool = new Map(
  (await readTsv("../dictionary/02-candidates/source-pool.tsv")).map((row) => [
    row.reading,
    row,
  ]),
);
const autoSelectedReadings = new Set(
  (await readTsv("../dictionary/03-selection/auto-selected-readings.tsv")).map(
    ({ reading }) => reading,
  ),
);
const manualInputReadings = (
  await readFile(
    new URL("../dictionary/01-input/inclusions/manual.txt", import.meta.url),
    "utf8",
  )
)
  .trimEnd()
  .split(/\r?\n/u)
  .filter((line) => line && !line.startsWith("#"));
const manualInclusionReadings = new Set(manualInputReadings);
const unreviewedReadings = new Set(
  (await readTsv("../dictionary/03-selection/unreviewed-readings.tsv")).map(
    ({ reading }) => reading,
  ),
);
const capacityByState = new Map(
  (await readTsv("../dictionary/04-analysis/capacity-by-state.tsv")).map(
    (row) => [row.state, row],
  ),
);
const excludedRows = await readTsv(
  "../dictionary/03-selection/excluded-readings.tsv",
);
const excludedByReading = new Map(
  excludedRows.map((row) => [row.reading, row]),
);
const excludedInSourcePool = new Set(
  excludedRows
    .filter(({ in_source_pool: inSourcePool }) => inSourcePool === "yes")
    .map(({ reading }) => reading),
);
const sensitiveReadings = (
  await readFile(
    new URL("../dictionary/01-input/exclusions/sensitive.txt", import.meta.url),
    "utf8",
  )
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const ruleExcluded = new Map();
const ruleExclusionReports = new Map();
for (const ruleName of [
  "minimum-2-characters",
  "maximum-8-characters",
  "connectable-ending",
]) {
  const readings = (
    await readFile(
      new URL(
        `../dictionary/02-candidates/rule-exclusions/${ruleName}.txt`,
        import.meta.url,
      ),
      "utf8",
    )
  )
    .trimEnd()
    .split(/\r?\n/u)
    .filter(Boolean);
  ruleExclusionReports.set(ruleName, readings);
  for (const reading of readings) {
    const failures = ruleExcluded.get(reading) ?? new Set();
    failures.add(ruleName);
    ruleExcluded.set(reading, failures);
  }
}

test("dictionary stages keep human inputs separate from generated outputs", async () => {
  const expectedFiles = [
    "../dictionary/01-input/inclusions/manual.txt",
    "../dictionary/01-input/exclusions/sensitive.txt",
    "../dictionary/01-input/exclusions/uncommon.txt",
    "../dictionary/01-input/exclusions/confusable-groups.csv",
    "../dictionary/02-candidates/source-pool.tsv",
    "../dictionary/02-candidates/rule-exclusions/minimum-2-characters.txt",
    "../dictionary/02-candidates/rule-exclusions/maximum-8-characters.txt",
    "../dictionary/02-candidates/rule-exclusions/connectable-ending.txt",
    "../dictionary/03-selection/auto-selected-readings.tsv",
    "../dictionary/03-selection/unreviewed-readings.tsv",
    "../dictionary/03-selection/excluded-readings.tsv",
    "../dictionary/04-analysis/capacity-by-state.tsv",
    "../dictionary/05-output/dictionary.json",
    "../dictionary/05-output/codebook.json",
  ];
  for (const relative of expectedFiles) {
    await readFile(new URL(relative, import.meta.url));
  }
  for (const oldRelative of [
    "../dictionary/01-input/manual-inclusions.jsonl",
    "../dictionary/ng/sensitive.txt",
    "../dictionary/source-pool.tsv",
    "../dictionary/02-candidates/rule-excluded-readings.tsv",
    "../dictionary/codebook.json",
  ]) {
    await assert.rejects(readFile(new URL(oldRelative, import.meta.url)));
  }
  assert.deepEqual(
    dictionaryManifest.buildInputs.map(({ path }) => path),
    [
      "scripts/dictionary/rules.py",
      "scripts/dictionary/generate.py",
      "dictionary/01-input/inclusions/manual.txt",
      "dictionary/01-input/exclusions/sensitive.txt",
      "dictionary/01-input/exclusions/uncommon.txt",
      "dictionary/01-input/exclusions/confusable-groups.csv",
    ],
  );
  assert.equal(dictionaryManifest.counts.excludedReadings, 45);
  assert.equal(manualInputReadings.length, 45);
  assert.equal(manualInclusionReadings.size, manualInputReadings.length);
  assert.equal(manualInputReadings[0], "ぷらん");
  assert.equal(manualInputReadings.at(-1), "るいじんえん");
  assert.deepEqual(dictionaryManifest.rules.autoSelection, [
    "school-source-count-3",
    "japanese-education-source-count-3-for-2-characters-otherwise-2",
  ]);
  assert.equal(sourcePool.get("いせい").selected, "excluded");
});

test("current dictionary supports the A1/D1 chained word-budget code", () => {
  assert.equal(codec.info.format, "A1/D1");
  assert.equal(codec.info.name, "Kana Chain Block Code");
  assert.equal(codec.info.abbreviation, "KCBC");
  assert.equal(codec.info.blockWords, 35);
  assert.equal(codec.info.finalMaximumWords, 35);
  assert.equal(codec.info.frameOverheadBytes, 3);
  assert.deepEqual(codec.info.chainedBlockCapacityBits, {
    minimum: 201,
    maximum: 207,
  });
  assert.equal(codec.info.katakanaDisplayWords, 255);
  assert.equal(codec.paths.normalCapacityBitsFor(35, "あ"), 205);
});

test("dictionary excludes one-character readings", () => {
  for (const word of [
    ...codec.dictionary.normalWords,
    ...codec.dictionary.terminalWords,
  ]) {
    const characters = [...word];
    assert.ok(characters.length >= 2, word);
  }
});

test("manual inclusions and exclusions partition the reviewed dictionary", () => {
  const activeReadings = new Set([
    ...codec.dictionary.normalWords,
    ...codec.dictionary.terminalWords,
  ]);
  assert.equal(manualInclusionReadings.size, 45);
  assert.deepEqual(
    activeReadings,
    new Set([...autoSelectedReadings, ...manualInclusionReadings]),
  );
  assert.equal(activeReadings.size, 3176);
  assert.equal(sourcePool.size, 17137);
  assert.equal(unreviewedReadings.size, 13916);
  assert.equal(excludedInSourcePool.size, 45);
  assert.equal(
    [...activeReadings].some((reading) => unreviewedReadings.has(reading)),
    false,
  );
  assert.equal(
    [...activeReadings].some((reading) => excludedInSourcePool.has(reading)),
    false,
  );
  assert.deepEqual(
    new Set([
      ...activeReadings,
      ...unreviewedReadings,
      ...excludedInSourcePool,
    ]),
    new Set(sourcePool.keys()),
  );
});

test("the generated manifest records versions, hashes, evidence, and origins", () => {
  const activeReadings = new Set([
    ...codec.dictionary.normalWords,
    ...codec.dictionary.terminalWords,
  ]);
  assert.equal(dictionaryManifest.schemaVersion, 2);
  assert.equal(dictionaryManifest.dictionaryVersion, 1);
  assert.equal(dictionaryManifest.codecFormat, "A1/D1");
  assert.match(dictionaryManifest.codebookSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(dictionaryManifest.buildSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(dictionaryManifest.counts, {
    candidates: 17137,
    autoSelected: 3131,
    manualInclusions: 45,
    excludedReadings: 45,
    unreviewed: 13916,
    normalWords: 2748,
    terminalWords: 428,
  });
  assert.equal(
    [
      ...dictionaryManifest.normalWords,
      ...dictionaryManifest.terminalWords,
    ].some((word) => Object.hasOwn(word, "notes")),
    false,
  );
  for (const reading of [
    "あいず",
    "いちご",
    "あおぞら",
    "たいよう",
    "いのち",
    "けんきゅう",
    "せつめい",
    "はっけん",
    "ぶんしょう",
    "ゆうき",
  ]) {
    assert.equal(activeReadings.has(reading), true, reading);
  }
  const strawberry = dictionaryManifest.normalWords.find(
    ({ reading }) => reading === "いちご",
  );
  assert.deepEqual(strawberry.origin, ["auto-selected"]);
  assert.deepEqual(strawberry.evidence.allocations, [1, 3]);
  assert.ok(strawberry.evidence.schoolSourceCount >= 3);
  assert.ok(strawberry.evidence.japaneseEducationSourceCount >= 2);

  const seal = dictionaryManifest.normalWords.find(
    ({ reading }) => reading === "あざらし",
  );
  assert.equal(seal.evidence.schoolSourceCount, 3);
  assert.equal(seal.evidence.japaneseEducationSourceCount, 2);

  const space = dictionaryManifest.normalWords.find(
    ({ reading }) => reading === "うちゅう",
  );
  assert.deepEqual(space.evidence.allocations, [2]);

  const accent = dictionaryManifest.normalWords.find(
    ({ reading }) => reading === "あくせんと",
  );
  assert.deepEqual(accent.evidence.allocations, [3]);

  const love = dictionaryManifest.normalWords.find(
    ({ reading }) => reading === "あい",
  );
  assert.ok(love.evidence.schoolSourceCount >= 3);
  assert.ok(love.evidence.japaneseEducationSourceCount >= 3);
});

test("source and graph rules stay reviewable in generated reports", () => {
  for (const row of sourcePool.values()) {
    assert.match(
      row.allocations,
      /^(?:1|2|3|1,2|1,3|2,3|1,2,3)$/u,
      row.reading,
    );
  }
  assert.equal(sourcePool.has("もも"), true);
  assert.equal(sourcePool.has("まま"), true);
  assert.equal(autoSelectedReadings.has("もも"), true);
  assert.equal(autoSelectedReadings.has("まま"), true);
  assert.equal(ruleExcluded.get("き").has("minimum-2-characters"), true);
  assert.equal(ruleExcluded.get("ひ").has("minimum-2-characters"), true);
  assert.equal(ruleExcluded.get("きしゃ").has("connectable-ending"), true);
  assert.deepEqual(
    [...ruleExclusionReports].map(([ruleName, readings]) => [
      ruleName,
      readings.length,
      new Set(readings).size,
    ]),
    [
      ["minimum-2-characters", 52, 52],
      ["maximum-8-characters", 45, 45],
      ["connectable-ending", 646, 646],
    ],
  );
  for (const readings of ruleExclusionReports.values()) {
    assert.deepEqual(readings, [...readings].sort());
    for (const reading of readings) {
      assert.match(reading, /^[ぁ-ゖー]+$/u);
    }
  }
  assert.ok(ruleExcluded.get("ゆうしょくじんしゅ").has("maximum-8-characters"));
  assert.ok(ruleExcluded.get("ゆうしょくじんしゅ").has("connectable-ending"));
});

test("capacity report identifies the weakest state and guarantees about 200 bits", () => {
  assert.equal(capacityByState.size, 67);
  assert.deepEqual([...capacityByState.keys()].slice(0, 4), [
    "ぬ",
    "ぴ",
    "ぽ",
    "ぐ",
  ]);
  assert.equal(Number(capacityByState.get("ぬ").normal_capacity_bits), 201);
  assert.equal(Number(capacityByState.get("ぬ").final_capacity_bits), 198);
  assert.equal(Number(capacityByState.get("ぷ").normal_capacity_bits), 202);
});

test("known sensitive, uncommon, and confusable readings stay out of the codebook", () => {
  const activeReadings = new Set([
    ...codec.dictionary.normalWords,
    ...codec.dictionary.terminalWords,
  ]);
  for (const reading of [
    "さは",
    "いない",
    "うお",
    "おう",
    "おおく",
    "かよう",
    "かんだんけい",
    "がい",
    "きんだい",
    "せい",
    "きちがい",
    "げい",
    "こうもん",
    "しゃせい",
    "しょうべん",
    "しな",
    "せいこう",
    "いせい",
    "ちかん",
    "ちち",
    "ちほう",
    "にんしん",
    "はげ",
    "はだか",
    "ばか",
    "びっこ",
    "ふうぞく",
    "むね",
    "めくら",
    "めす",
    "るんぺん",
    "おす",
    "ほや",
    "ぼや",
    "ほうわ",
    "ほら",
    "おくじょう",
    "おくびょう",
    "りゆう",
    "りゅう",
    "かこ",
    "かご",
    "かつどう",
    "かつよう",
  ]) {
    assert.equal(activeReadings.has(reading), false, reading);
    assert.equal(excludedInSourcePool.has(reading), true, reading);
  }
});

test("every sensitive input is reported as sensitive and excluded", () => {
  const activeReadings = new Set([
    ...codec.dictionary.normalWords,
    ...codec.dictionary.terminalWords,
  ]);
  for (const reading of sensitiveReadings) {
    assert.equal(activeReadings.has(reading), false, reading);
    assert.equal(
      excludedByReading.get(reading)?.category,
      "sensitive",
      reading,
    );
    assert.equal(
      excludedByReading.get(reading)?.in_source_pool,
      "yes",
      reading,
    );
  }
  assert.ok(sensitiveReadings.includes("しゃせい"));
  assert.ok(sensitiveReadings.includes("げい"));
});

test("katakana display is derived from source headings without changing readings", () => {
  assert.equal(codec.dictionary.katakanaReadings.has("らじお"), true);
  assert.equal(codec.dictionary.katakanaReadings.has("たいよう"), false);
  assert.equal(hiraganaToKatakana("らじお"), "ラジオ");
  assert.equal(katakanaToHiragana("ラジオ"), "らじお");
});
