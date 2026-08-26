// バイト列はUint8Arrayで扱う。Nodeに限らずブラウザ、Cloudflare Workers、Deno、
// Bunでもそのまま動かすためで、Bufferには依存しない。

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");
const utf16Decoder = new TextDecoder("utf-16le", { fatal: true });

export function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function utf8ToBytes(text) {
  return utf8Encoder.encode(text);
}

export function bytesToUtf8(bytes) {
  return utf8Decoder.decode(bytes);
}

export function utf16leToBytes(text) {
  // サロゲートペアはそのまま2つのコードユニットとして書き出す。
  const output = new Uint8Array(text.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), true);
  }
  return output;
}

export function bytesToUtf16le(bytes) {
  return utf16Decoder.decode(bytes);
}

export function readUint32BE(bytes, offset) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, false);
}

export function uint32ToBytesBE(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value >>> 0, false);
  return output;
}

export function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
