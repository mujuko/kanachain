// ブラウザ向けraw DEFLATE。CompressionStreamは非同期でsyncなAPIに合わないため、
// 同期実装のfflateを使う。
//
// DEFLATEの出力は実装によって異なりうるので、圧縮モードを選んだ場合の単語列は
// Node実装と一致しないことがある。復号はどちらの出力に対しても一意である。
import { deflateSync, inflateSync } from "fflate";

export function deflateRaw(input) {
  return deflateSync(input, { level: 9 });
}

export function inflateRaw(input) {
  return inflateSync(input);
}
