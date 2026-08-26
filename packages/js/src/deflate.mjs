// Node、Deno、Bun向けのraw DEFLATE。ブラウザ向けはdeflate.browser.mjsで、
// package.jsonのimportsフィールドが実行環境ごとに切り替える。
import { deflateRawSync, inflateRawSync } from "node:zlib";

export function deflateRaw(input) {
  return new Uint8Array(deflateRawSync(input, { level: 9 }));
}

export function inflateRaw(input) {
  return new Uint8Array(inflateRawSync(input));
}
