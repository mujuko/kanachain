"""KCBC辞書パイプラインで使う、開発者定義の選定ルール。"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

# 人が識別する辞書リリースを公開するときに更新する。
# 符号表の厳密な互換性は、別途codebookSha256で判定する。
DICTIONARY_VERSION = 1

# 小書き仮名、「を」「ん」「ゔ」は接続状態にしない。「づ」は使用できる。
STATE_ORDER = (
    "あいうえお"
    "かがきぎくぐけげこご"
    "さざしじすずせぜそぞ"
    "ただちつづてでとど"
    "なにぬねの"
    "はばぱひびぴふぶぷへべぺほぼぽ"
    "まみむめも"
    "やゆよ"
    "らりるれろ"
    "わ"
)
STATE_SET = frozenset(STATE_ORDER)
ALLOWED_READING = re.compile(r"[ぁ-ゖー]+")


@dataclass(frozen=True)
class Rule:
    """不合格理由をレポートへ記録できる、名前付きの真偽値述語。"""

    name: str
    predicate: Callable[[Any], bool]

    def __call__(self, value: Any) -> bool:
        return self.predicate(value)


# 候補抽出の第1段階。収集元のどの行を教育語彙プールへ入れるか判定する。
# 同じ読みを統合する前のSourceRowに対して適用する。
SOURCE_ENTRY_RULES = (
    Rule("noun", lambda row: row.part_of_speech.startswith("名")),
    # 義務教育で扱う低学年（1）、高学年（2）、中学校（3）を候補へ取り込む。
    Rule(
        "compulsory-education-allocation", lambda row: row.allocation in {"1", "2", "3"}
    ),
)

# 候補抽出の第2段階。しりとりグラフそのものに必要な性質を検証する。
# 「ん」で終わる語は終端語。それ以外の末尾は、次の語の先頭として使える
# 接続状態でなければならない。手動採用語にも同じ構造ルールを適用する。
READING_RULES = (
    Rule("minimum-2-characters", lambda word: len(word.reading) >= 2),
    Rule("maximum-8-characters", lambda word: len(word.reading) <= 8),
    Rule(
        "hiragana-and-long-mark-only",
        lambda word: ALLOWED_READING.fullmatch(word.reading) is not None,
    ),
    Rule(
        "allowed-head", lambda word: bool(word.reading) and word.reading[0] in STATE_SET
    ),
    Rule(
        "connectable-ending",
        lambda word: (
            bool(word.reading)
            and (word.reading.endswith("ん") or word.reading[-1] in STATE_SET)
        ),
    ),
)

# 自動選定。複数の独立した教育語彙資料に裏付けられた読みを優先する。
# 閾値を生成処理や独自DSLに隠さずここへ置き、通常のPythonコードとして
# 選定方針をレビューできるようにする。
AUTO_SELECTION_RULES = (
    # 片方のデータベースだけに偏らないよう、両系統に最低件数を設ける。
    Rule("school-source-count-3", lambda word: len(word.school_sources) >= 3),
    # 短い読みほど同音異義語が多いため、2文字語だけ日本語教育側の根拠を
    # 1資料分だけ強くする。3文字以上は従来どおり2資料でよい。
    Rule(
        "japanese-education-source-count-3-for-2-characters-otherwise-2",
        lambda word: (
            len(word.japanese_education_sources) >= (3 if len(word.reading) == 2 else 2)
        ),
    ),
)
