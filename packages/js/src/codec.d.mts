export interface CodebookJson {
  schemaVersion: number;
  codecFormat: string;
  dictionaryVersion: number;
  codebookSha256: string;
  buildSha256: string;
  states: string;
  normalWords: string[];
  terminalWords: string[];
  katakanaReadings: string[];
}

export interface Dictionary {
  normalWords: string[];
  terminalWords: string[];
  katakanaReadings: Set<string>;
  states: string[];
  manifest: {
    schemaVersion: number;
    dictionaryVersion: number;
    codebookSha256: string;
    buildSha256: string;
  };
}

export interface SerializeMetadata {
  format: "A1/D1";
  sourceBytes: number;
  payloadBytes: number;
  frameBytes: number;
  compression: "raw" | "deflate";
  encoding: "bytes" | "utf16le";
  mode: 0 | 1 | 2 | 3;
  blocks: number;
  words: number;
  characters: number;
}

export interface DeserializeMetadata {
  format: "A1/D1";
  outputBytes: number;
  payloadBytes: number;
  frameBytes: number;
  compression: "raw" | "deflate";
  encoding: "bytes" | "utf16le";
  mode: 0 | 1 | 2 | 3;
  blocks: number;
  words: number;
  characters: number;
}

export interface EncodedFrame {
  /** 表示用の単語列。カタカナ表示の語はカタカナになる。 */
  words: string[];
  blocks: string[][];
  /** すべてひらがなへ正規化した単語列。rankを決めるのはこちら。 */
  canonicalBlocks: string[][];
  canonicalWords: string[];
  text: string;
}

export interface Serialized extends EncodedFrame {
  metadata: SerializeMetadata;
}

export interface Deserialized {
  data: Uint8Array;
  words: string[];
  blocks: string[][];
  metadata: DeserializeMetadata;
}

export interface CodecInfo {
  format: "A1/D1";
  name: string;
  abbreviation: string;
  algorithmVersion: number;
  dictionaryVersion: number;
  normalWords: number;
  terminalWords: number;
  katakanaDisplayWords: number;
  states: number;
  blockWords: number;
  finalMaximumWords: number;
  frameOverheadBytes: number;
  chainedBlockCapacityBits: { minimum: number; maximum: number };
}

export interface CodecOptions {
  /** 読み込み済みの符号表。ブラウザではこちらを渡す。 */
  codebook?: CodebookJson;
  /** 符号表のパス。省略するとパッケージ同梱のcodebook.jsonを読む。 */
  codebookPath?: string | URL;
}

export declare class KanaChainBlockCode {
  constructor(dictionary: Dictionary);

  readonly dictionary: Dictionary;
  readonly blockWords: number;
  readonly finalMaximumWords: number;
  readonly startStates: string[];
  readonly info: CodecInfo;

  serialize(
    input: string | Uint8Array,
    options?: { pretty?: boolean },
  ): Serialized;
  deserialize(input: string | string[] | string[][]): Deserialized;

  /** フレームを単語ブロックへ写す。圧縮方式やモード選択とは独立している。 */
  encodeFrame(frame: Uint8Array, options?: { pretty?: boolean }): EncodedFrame;
  /** 単語ブロックをフレームへ戻す。encodeFrameの逆。 */
  decodeFrame(input: string | string[] | string[][]): Uint8Array;

  format(
    blocksOrWords: string[] | string[][],
    options?: { pretty?: boolean },
  ): string;
}

export declare function createKanaChainBlockCode(
  options?: CodecOptions,
): Promise<KanaChainBlockCode>;
