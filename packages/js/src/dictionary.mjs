import { utf8ToBytes, bytesToHex } from "./bytes.mjs";
import { readCodebook } from "#codebook-source";

const DICTIONARY_1_SHA256 =
  "sha256:823d3f3f48bf09e85447d61903a7b29cf6a774108745a1a4b5c228ba976327e5";
const DICTIONARY_1_STATES =
  "あいうえおかがきぎくぐけげこごさざしじすずせぜそぞただちつてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもやゆよらりるれろわ";

export function katakanaToHiragana(value) {
  return [...value]
    .map((character) =>
      character >= "ァ" && character <= "ヶ"
        ? String.fromCodePoint(character.codePointAt(0) - 0x60)
        : character,
    )
    .join("");
}

export function hiraganaToKatakana(value) {
  return [...value]
    .map((character) =>
      character >= "ぁ" && character <= "ゖ"
        ? String.fromCodePoint(character.codePointAt(0) + 0x60)
        : character,
    )
    .join("");
}

function assertUnique(words, label) {
  const seen = new Set();
  for (const word of words) {
    if (seen.has(word)) {
      throw new Error(`${label} contains a duplicate reading: ${word}`);
    }
    seen.add(word);
  }
}

function hasInvalidReadingLength(word) {
  const length = [...word].length;
  return length < 2 || length > 8;
}

function readingsFrom(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((reading) => typeof reading !== "string")
  ) {
    throw new Error(`${label} must be an array of readings`);
  }
  return value;
}

async function codebookSha256(normalWords, terminalWords) {
  // このバイト表現はPython生成器のcanonical_json()と一致させる。
  // 配列順が符号表のrankを定義するため、並び順にも意味がある。
  // Web CryptoはNode、ブラウザ、Cloudflare Workersのいずれにもある。
  const canonical = JSON.stringify({
    normal: normalWords,
    terminal: terminalWords,
  });
  const digest = await crypto.subtle.digest("SHA-256", utf8ToBytes(canonical));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function parseCodebook(codebook) {
  if (codebook.schemaVersion !== 1) {
    throw new Error(`unsupported codebook schema: ${codebook.schemaVersion}`);
  }
  if (codebook.codecFormat !== "A1/D1") {
    throw new Error(`codebook is for ${codebook.codecFormat}, expected A1/D1`);
  }
  if (codebook.dictionaryVersion !== 1) {
    throw new Error(
      `unsupported dictionary version: ${codebook.dictionaryVersion}`,
    );
  }
  if (typeof codebook.states !== "string" || !codebook.states) {
    throw new Error("codebook states must be a non-empty string");
  }
  if (codebook.states !== DICTIONARY_1_STATES) {
    throw new Error("dictionary 1 has an unknown state order");
  }

  const normalWords = readingsFrom(codebook.normalWords, "normalWords");
  const terminalWords = readingsFrom(codebook.terminalWords, "terminalWords");
  // 符号表が手で編集された場合や、互換性のない並べ方で生成された場合は、
  // 経路グラフを構築する前にエラーにする。
  const actualHash = await codebookSha256(normalWords, terminalWords);
  if (codebook.codebookSha256 !== actualHash) {
    throw new Error(
      `codebook hash mismatch: expected ${codebook.codebookSha256}, got ${actualHash}`,
    );
  }
  if (actualHash !== DICTIONARY_1_SHA256) {
    throw new Error(`dictionary 1 has an unknown codebook hash: ${actualHash}`);
  }

  const states = [...codebook.states];
  const stateSet = new Set(states);
  assertUnique(states, "codebook states");
  assertUnique(normalWords, "normal codebook");
  assertUnique(terminalWords, "terminal codebook");
  for (const word of normalWords) {
    if (
      hasInvalidReadingLength(word) ||
      word.endsWith("ん") ||
      !stateSet.has(word[0]) ||
      !stateSet.has(word.at(-1))
    ) {
      throw new Error(`invalid normal codebook reading: ${word}`);
    }
  }
  for (const word of terminalWords) {
    if (
      hasInvalidReadingLength(word) ||
      !word.endsWith("ん") ||
      !stateSet.has(word[0])
    ) {
      throw new Error(`invalid terminal codebook reading: ${word}`);
    }
  }

  return {
    normalWords,
    terminalWords,
    // カタカナは出力上の装飾だけで、復号入力は別の場所でひらがなへ正規化する。
    katakanaReadings: new Set(
      readingsFrom(codebook.katakanaReadings, "katakanaReadings"),
    ),
    states,
    manifest: {
      schemaVersion: codebook.schemaVersion,
      dictionaryVersion: codebook.dictionaryVersion,
      codebookSha256: codebook.codebookSha256,
      buildSha256: codebook.buildSha256,
    },
  };
}

export async function loadDictionary(source) {
  return parseCodebook(await readCodebook(source));
}
