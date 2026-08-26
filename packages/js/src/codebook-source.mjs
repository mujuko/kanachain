// 既定の符号表をファイルから読む。ブラウザ向けはcodebook-source.browser.mjs。
import { readFile } from "node:fs/promises";

const DEFAULT_CODEBOOK_URL = new URL("../codebook.json", import.meta.url);

export async function readCodebook(source = DEFAULT_CODEBOOK_URL) {
  const url = source instanceof URL
    ? source
    : new URL(source.replaceAll("\\", "/"), "file:///");
  return JSON.parse(await readFile(url, "utf8"));
}
