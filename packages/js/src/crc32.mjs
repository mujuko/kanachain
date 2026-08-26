const TABLE = new Uint32Array(256);

for (let value = 0; value < TABLE.length; value += 1) {
  let remainder = value;
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  TABLE[value] = remainder >>> 0;
}

/** CRC-32/ISO-HDLC: poly=0x04c11db7, init=0xffffffff, refin=true, xorout=0xffffffff. */
export function crc32(buffer) {
  let checksum = 0xffffffff;
  for (const byte of buffer) {
    checksum = TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
