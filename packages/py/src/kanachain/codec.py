"""KCBC Algorithm 1 / Dictionary 1 codec."""

from __future__ import annotations

import hashlib
import re
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ._codebook import (
    Codebook,
    hiragana_to_katakana,
    katakana_to_hiragana,
    load_codebook,
)
from ._paths import PathCodec

MODE_RAW = 0
MODE_DEFLATE = 1
MODE_UTF16LE = 2
MODE_UTF16LE_DEFLATE = 3
PATH_CANDIDATES = 128
_SEP = re.compile(r"[\s\u3000]+")


def _crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = (
                ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
            )
    return crc


def _frame(type_: int, index: int, data: bytes) -> bytes:
    checked = bytes([type_]) + index.to_bytes(4, "big") + bytes([len(data)]) + data
    c = _crc16(checked)
    return bytes([len(data)]) + data + c.to_bytes(2, "big")


def _deflate(data: bytes) -> bytes:
    o = zlib.compressobj(level=9, wbits=-15)
    return o.compress(data) + o.flush()


def _inflate(data: bytes) -> bytes:
    return zlib.decompress(data, wbits=-15)


def _score(words, used):
    groups = [0, 0, 0]
    reused = two = chars = 0
    for w in words:
        n = len(w)
        groups[0 if n == 2 else 1 if n == 3 else 2] += 1
        reused += w in used
        two += n == 2
        chars += n
    return (max(groups) - min(groups), reused, two, -chars)


def _terminal(w):
    return katakana_to_hiragana(w).endswith("ん")


def _infer(words):
    out = []
    block = []
    for i, w in enumerate(words):
        block.append(w)
        if _terminal(w):
            if i != len(words) - 1:
                raise ValueError(f"word {i + 1} ends the stream prematurely")
            out.append(block)
            block = []
        elif len(block) == 35:
            out.append(block)
            block = []
    if block or not out or not _terminal(out[-1][-1]):
        raise ValueError("last block does not end with ん")
    return out


def _parse(value):
    if not isinstance(value, str):
        items = list(value)
        return (
            [list(b) for b in items]
            if items and not isinstance(items[0], str)
            else _infer(items)
        )
    value = unicodedata.normalize("NFC", value).strip()
    if not value:
        return []
    lines = [
        [w for w in _SEP.split(line.strip()) if w] for line in re.split(r"\r?\n", value)
    ]
    lines = [line for line in lines if line]
    return lines if len(lines) > 1 else _infer([w for line in lines for w in line])


def _path_hash(type_, index, state, frame, counter):
    seed = (
        b"KCBC-A1-PATH\0"
        + bytes([type_])
        + index.to_bytes(4, "big")
        + state.encode()
        + frame
        + counter.to_bytes(4, "big")
    )
    return int.from_bytes(hashlib.sha256(seed).digest(), "big")


@dataclass(frozen=True)
class Encoded:
    words: list[str]
    blocks: list[list[str]]
    canonical_blocks: list[list[str]]
    text: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class Decoded:
    data: bytes
    words: list[str]
    blocks: list[list[str]]
    metadata: dict[str, Any]


class KanaChainBlockCode:
    def __init__(self, codebook: Codebook):
        self.codebook = codebook
        self.paths = PathCodec(
            codebook.normal_words, codebook.terminal_words, codebook.states, 35
        )
        self.block_words = 35
        self.final_maximum_words = 35
        self.start_states = codebook.states

    @property
    def info(self):
        caps = [self.paths.normal_capacity_bits_for(35, s) for s in self.start_states]
        return {
            "format": "A1/D1",
            "name": "Kana Chain Block Code",
            "abbreviation": "KCBC",
            "algorithmVersion": 1,
            "dictionaryVersion": 1,
            "normalWords": len(self.codebook.normal_words),
            "terminalWords": len(self.codebook.terminal_words),
            "katakanaDisplayWords": len(self.codebook.katakana_readings),
            "states": len(self.start_states),
            "blockWords": 35,
            "finalMaximumWords": 35,
            "frameOverheadBytes": 3,
            "chainedBlockCapacityBits": {"minimum": min(caps), "maximum": max(caps)},
        }

    def _find(self, frame, type_, index, start, normal, used):
        m = len(frame) * 8
        for n in [35] if normal else range(1, 36):
            count = (
                self.paths.normal_path_count(n, start)
                if normal
                else self.paths.path_count(n, start)
            )
            if not count:
                continue
            b = count.bit_length() - 1
            if b < m + (0 if normal else 20):
                continue
            mask = (1 << (b - m)) - 1
            counter = 0
            seen = set()
            best = None
            while len(seen) < PATH_CANDIDATES:
                t = _path_hash(type_, index, start, frame, counter) & mask
                counter += 1
                if t in seen:
                    continue
                seen.add(t)
                x = (t << (m)) + int.from_bytes(frame, "big")
                rho = (x * count) >> (b)
                try:
                    path = (
                        self.paths.unrank_normal(rho, n, start)
                        if normal
                        else self.paths.unrank(rho, n, start)
                    )
                except (ValueError, IndexError):
                    continue
                if len(set(path.words)) != len(path.words):
                    continue
                score = _score(path.words, used) + (rho,)
                if best is None or score < best[0]:
                    best = (score, path)
            if best:
                return best[1]
        return None

    def _encode(self, stream):
        result = []
        used = set()
        off = 0
        index = 0
        end = None
        while len(stream) - off > 18:
            chosen = None
            for n in range(18, 0, -1):
                data = stream[off : off + n]
                fr = _frame(0, index, data)
                checked = bytes([0]) + index.to_bytes(4, "big") + bytes([n]) + data
                start = (
                    end or self.start_states[_crc16(checked) % len(self.start_states)]
                )
                path = self._find(fr, 0, index, start, True, used)
                if path:
                    chosen = (path, data, n)
                    break
            if not chosen:
                raise ValueError(f"no valid path for block {index}")
            path, data, n = chosen
            result.append(path.words)
            used.update(path.words)
            end = path.end_state
            off += n
            index += 1
        data = stream[off:]
        fr = _frame(1, index, data)
        checked = bytes([1]) + index.to_bytes(4, "big") + bytes([len(data)]) + data
        start = end or self.start_states[_crc16(checked) % len(self.start_states)]
        path = self._find(fr, 1, index, start, False, used)
        if not path:
            raise ValueError(f"no valid final path for block {index}")
        result.append(path.words)
        return result

    def encode_frame(self, frame: bytes, pretty: bool = False) -> Encoded:
        canonical = self._encode(bytes(frame))
        blocks = [
            [
                hiragana_to_katakana(w) if w in self.codebook.katakana_readings else w
                for w in b
            ]
            for b in canonical
        ]
        return Encoded(
            [w for b in blocks for w in b],
            blocks,
            canonical,
            self.format(blocks, pretty),
            {},
        )

    def serialize(self, value: str | bytes, pretty: bool = False) -> Encoded:
        source = value.encode() if isinstance(value, str) else bytes(value)
        candidates = [(0, source), (1, _deflate(source))]
        if isinstance(value, str):
            u = value.encode("utf-16-le")
            candidates += [(2, u), (3, _deflate(u))]
        out = []
        for mode, payload in candidates:
            enc = self.encode_frame(bytes([1, 1, mode]) + payload, pretty)
            words = enc.words
            chars = sum(len(w) for w in words)
            used = set()
            imbalance = two = 0
            for block in enc.canonical_blocks:
                groups = [
                    sum(len(w) == 2 for w in block),
                    sum(len(w) == 3 for w in block),
                    sum(len(w) >= 4 for w in block),
                ]
                imbalance += max(groups) - min(groups)
                two += groups[0]
                used.update(block)
            metadata = {
                "format": "A1/D1",
                "sourceBytes": len(source),
                "payloadBytes": len(payload),
                "frameBytes": len(payload) + 3,
                "compression": "deflate" if mode in (1, 3) else "raw",
                "encoding": "utf16le" if mode >= 2 else "bytes",
                "mode": mode,
                "blocks": len(enc.blocks),
                "words": len(words),
                "characters": chars,
            }
            selection_score = (
                len(words),
                len(enc.blocks),
                len(words) - len(used),
                imbalance,
                two,
                -chars,
                len(payload) + 3,
                mode,
            )
            out.append(
                (
                    selection_score,
                    Encoded(
                        enc.words,
                        enc.blocks,
                        enc.canonical_blocks,
                        self.format(enc.blocks, pretty),
                        metadata,
                    ),
                )
            )
        return min(out, key=lambda candidate: candidate[0])[1]

    def _decode_block(self, words, type_, index, states):
        found = []
        for state in states:
            if type_ == 0 and len(words) != 35:
                continue
            if type_ == 1 and not 1 <= len(words) <= 35:
                continue
            try:
                ranked = (
                    self.paths.rank_normal(words, state)
                    if type_ == 0
                    else self.paths.rank(words, state)
                )
            except ValueError:
                continue
            count = (
                self.paths.normal_path_count(len(words), state)
                if type_ == 0
                else self.paths.path_count(len(words), state)
            )
            b = count.bit_length() - 1
            x = (ranked.rank * (1 << b) + count - 1) // count
            if x >= 1 << b or (x * count) // (1 << b) != ranked.rank:
                continue
            for n in range(0 if type_ else 1, 19):
                m = (n + 3) * 8
                if b < m + (20 if type_ else 0):
                    continue
                fr = (x & ((1 << m) - 1)).to_bytes(n + 3, "big")
                if fr[0] != n:
                    continue
                data = fr[1 : 1 + n]
                checked = bytes([type_]) + index.to_bytes(4, "big") + bytes([n]) + data
                if _crc16(checked) != (fr[-2] << 8 | fr[-1]):
                    continue
                expected = (
                    self.start_states[_crc16(checked) % len(self.start_states)]
                    if index == 0
                    else state
                )
                if expected != state:
                    continue
                found.append((data, ranked.end_state))
        if len(found) != 1:
            raise ValueError(f"CRC-16 mismatch in block {index}")
        return found[0]

    def decode_frame(self, value) -> bytes:
        raw = _parse(value)
        if not raw:
            raise ValueError("word list must not be empty")
        blocks = [
            [katakana_to_hiragana(unicodedata.normalize("NFC", w)) for w in b]
            for b in raw
        ]
        data = []
        states = self.start_states
        for i, b in enumerate(blocks):
            final = i == len(blocks) - 1
            if not b:
                raise ValueError(f"block {i} is empty")
            if not final and len(b) != 35:
                raise ValueError(f"block {i} uses {len(b)} words; expected 35")
            if final and len(b) > 35:
                raise ValueError(f"final block {i} is too long")
            if final != _terminal(b[-1]):
                raise ValueError(f"terminal word is in the wrong block {i}")
            if len(set(b)) != len(b):
                raise ValueError(f"duplicate reading in block {i}")
            if i and b[0][0] != states[0]:
                raise ValueError(f"block {i} breaks the chain")
            d, end = self._decode_block(b, 1 if final else 0, i, states)
            data.append(d)
            states = [end]
        return b"".join(data)

    def deserialize(self, value) -> Decoded:
        frame = self.decode_frame(value)
        if len(frame) < 3:
            raise ValueError("stream header is truncated")
        if frame[:2] != b"\x01\x01":
            raise ValueError("unsupported version")
        mode = frame[2]
        if mode & 0xFC or mode > 3:
            raise ValueError(f"unsupported mode {mode}")
        payload = frame[3:]
        data = _inflate(payload) if mode in (1, 3) else payload
        if mode in (2, 3):
            data = data.decode("utf-16-le").encode("utf-8")
        blocks = _parse(value)
        words = [w for b in blocks for w in b]
        return Decoded(
            data,
            words,
            blocks,
            {
                "format": "A1/D1",
                "outputBytes": len(data),
                "payloadBytes": len(payload),
                "frameBytes": len(frame),
                "compression": "deflate" if mode in (1, 3) else "raw",
                "encoding": "utf16le" if mode >= 2 else "bytes",
                "mode": mode,
                "blocks": len(blocks),
                "words": len(words),
                "characters": sum(len(w) for w in words),
            },
        )

    def format(self, blocks_or_words, pretty=False):
        x = list(blocks_or_words)
        blocks = x if x and isinstance(x[0], (list, tuple)) else _infer(x)
        return "\n".join(("　" if pretty else " ").join(b) for b in blocks)


def create_kana_chain_block_code(
    codebook_path: str | Path | None = None, **_
) -> KanaChainBlockCode:
    return KanaChainBlockCode(load_codebook(codebook_path))
