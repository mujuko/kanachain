"""符号表の読み込みと検証。JS実装のdictionary.mjsに対応する。"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

_KATAKANA_START = ord("ァ")
_KATAKANA_END = ord("ヶ")
_HIRAGANA_START = ord("ぁ")
_HIRAGANA_END = ord("ゖ")
_OFFSET = 0x60
_DICTIONARY_1_SHA256 = (
    "sha256:823d3f3f48bf09e85447d61903a7b29cf6a774108745a1a4b5c228ba976327e5"
)
_DICTIONARY_1_STATES = (
    "あいうえおかがきぎくぐけげこごさざしじすずせぜそぞただちつてでとどなにぬねの"
    "はばぱひびぴふぶぷへべぺほぼぽまみむめもやゆよらりるれろわ"
)


def katakana_to_hiragana(value: str) -> str:
    return "".join(
        chr(ord(character) - _OFFSET)
        if _KATAKANA_START <= ord(character) <= _KATAKANA_END
        else character
        for character in value
    )


def hiragana_to_katakana(value: str) -> str:
    return "".join(
        chr(ord(character) + _OFFSET)
        if _HIRAGANA_START <= ord(character) <= _HIRAGANA_END
        else character
        for character in value
    )


@dataclass(frozen=True)
class Codebook:
    normal_words: list[str]
    terminal_words: list[str]
    katakana_readings: frozenset[str]
    states: list[str]
    schema_version: int
    dictionary_version: int
    codebook_sha256: str
    build_sha256: str


def _assert_unique(words: Sequence[str], label: str) -> None:
    seen: set[str] = set()
    for word in words:
        if word in seen:
            raise ValueError(f"{label} contains a duplicate reading: {word}")
        seen.add(word)


def _has_invalid_reading_length(word: str) -> bool:
    return len(word) < 2 or len(word) > 8


def _codebook_sha256(normal_words: Sequence[str], terminal_words: Sequence[str]) -> str:
    # このバイト表現はJS実装およびPython生成器のcanonical_json()と一致させる。
    # 配列順が符号表のrankを定義するため、並び順にも意味がある。
    canonical = json.dumps(
        {"normal": list(normal_words), "terminal": list(terminal_words)},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _readings_from(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"{label} must be an array of readings")
    return value


def parse_codebook(codebook: dict[str, Any]) -> Codebook:
    if codebook.get("schemaVersion") != 1:
        raise ValueError(
            f"unsupported codebook schema: {codebook.get('schemaVersion')}"
        )
    if codebook.get("codecFormat") != "A1/D1":
        raise ValueError(
            f"codebook is for {codebook.get('codecFormat')}, expected A1/D1"
        )
    dictionary_version = codebook.get("dictionaryVersion")
    if dictionary_version != 1:
        raise ValueError(f"unsupported dictionary version: {dictionary_version}")
    states_text = codebook.get("states")
    if not isinstance(states_text, str) or not states_text:
        raise ValueError("codebook states must be a non-empty string")
    if states_text != _DICTIONARY_1_STATES:
        raise ValueError("dictionary 1 has an unknown state order")

    normal_words = _readings_from(codebook.get("normalWords"), "normalWords")
    terminal_words = _readings_from(codebook.get("terminalWords"), "terminalWords")
    # 符号表が手で編集された場合や、互換性のない並べ方で生成された場合は、
    # 経路グラフを構築する前にエラーにする。
    actual_hash = _codebook_sha256(normal_words, terminal_words)
    if codebook.get("codebookSha256") != actual_hash:
        raise ValueError(
            f"codebook hash mismatch: expected {codebook.get('codebookSha256')}, "
            f"got {actual_hash}"
        )
    if actual_hash != _DICTIONARY_1_SHA256:
        raise ValueError(f"dictionary 1 has an unknown codebook hash: {actual_hash}")

    states = list(states_text)
    state_set = set(states)
    _assert_unique(states, "codebook states")
    _assert_unique(normal_words, "normal codebook")
    _assert_unique(terminal_words, "terminal codebook")
    for word in normal_words:
        if (
            _has_invalid_reading_length(word)
            or word.endswith("ん")
            or word[0] not in state_set
            or word[-1] not in state_set
        ):
            raise ValueError(f"invalid normal codebook reading: {word}")
    for word in terminal_words:
        if (
            _has_invalid_reading_length(word)
            or not word.endswith("ん")
            or word[0] not in state_set
        ):
            raise ValueError(f"invalid terminal codebook reading: {word}")

    return Codebook(
        normal_words=normal_words,
        terminal_words=terminal_words,
        # カタカナは出力上の装飾だけで、復号入力は別の場所でひらがなへ正規化する。
        katakana_readings=frozenset(
            _readings_from(codebook.get("katakanaReadings"), "katakanaReadings")
        ),
        states=states,
        schema_version=codebook["schemaVersion"],
        dictionary_version=dictionary_version,
        codebook_sha256=codebook["codebookSha256"],
        build_sha256=codebook.get("buildSha256", ""),
    )


def load_codebook(path: str | Path | None = None) -> Codebook:
    if path is None:
        text = resources.files("kanachain").joinpath("codebook.json").read_text("utf-8")
    else:
        text = Path(path).read_text("utf-8")
    return parse_codebook(json.loads(text))
