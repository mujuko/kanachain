// ブラウザではバンドル済みの符号表をそのまま使う。
import codebook from "../codebook.json";

export async function readCodebook() {
  return codebook;
}
