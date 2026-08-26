#!/usr/bin/env node
// dictionary/05-output/dictionary.json（約1.9 MB）から、ランタイムに必要な項目だけを抜いた
// codebook.json（約47 KB）を作り、各パッケージへ配置する。
//
// 完全な辞書は来歴の記録であり、採用根拠や表記例を含む。符号化に必要なのは
// 読み・表示区分・接続状態・互換性情報だけなので、配布物には抜粋を同梱する。
// codebookSha256は読みの並びだけから計算されるため、抜粋後も同じ値で検証できる。
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const SOURCE = new URL("dictionary/05-output/dictionary.json", ROOT);
const TARGETS = [
  new URL("dictionary/05-output/codebook.json", ROOT),
  new URL("packages/js/codebook.json", ROOT),
  new URL("packages/py/src/kanachain/codebook.json", ROOT),
];

const manifest = JSON.parse(await readFile(SOURCE, "utf8"));
if (manifest.schemaVersion !== 2) {
  throw new Error(
    `unsupported dictionary manifest schema: ${manifest.schemaVersion}`,
  );
}
const codebook = {
  schemaVersion: 1,
  codecFormat: manifest.codecFormat,
  dictionaryVersion: manifest.dictionaryVersion,
  codebookSha256: manifest.codebookSha256,
  buildSha256: manifest.buildSha256,
  states: manifest.states,
  normalWords: manifest.normalWords.map(({ reading }) => reading),
  terminalWords: manifest.terminalWords.map(({ reading }) => reading),
  katakanaReadings: [...manifest.normalWords, ...manifest.terminalWords]
    .filter(({ display }) => display === "katakana")
    .map(({ reading }) => reading),
};

const serialized = `${JSON.stringify(codebook)}\n`;
for (const target of TARGETS) {
  await writeFile(target, serialized, "utf8");
}
console.log(
  `codebook ${codebook.dictionaryVersion}: ${codebook.normalWords.length} normal + ${codebook.terminalWords.length} terminal, ${Buffer.byteLength(serialized)} bytes`,
);
