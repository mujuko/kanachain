#!/usr/bin/env python3
"""固定した国語研の教育語彙データからKCBC辞書を生成する。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import tempfile
import unicodedata
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from rules import (
    AUTO_SELECTION_RULES,
    DICTIONARY_VERSION,
    READING_RULES,
    SOURCE_ENTRY_RULES,
    STATE_ORDER,
)

# 集合の役割は raw sources、candidates、auto-selected、manual inclusions、
# exclusions として明示する。出力する符号表は
# (auto-selected ∪ manual inclusions) - exclusions になる。
ROOT = Path(__file__).resolve().parents[2]
STATE_INDEX = {character: index for index, character in enumerate(STATE_ORDER)}
KATAKANA_ONLY = frozenset("ー・＝")
SCHOOL_SOURCE_COLUMNS = ("阪本", "新阪本", "田中", "池原", "児言研", "中央", "国語研")
JAPANESE_EDUCATION_SOURCE_COLUMNS = (
    "国語研",
    "初級500語",
    "七種対照",
    "工藤",
    "木幡",
    "玉村",
)
SOURCES = (
    {
        "key": "school",
        "name": "教育基本語彙データベース",
        "version": "2009A",
        "url": "https://mmsrv.ninjal.ac.jp/brfvep/kyoikukihongoi_2009A.csv",
        "sha256": "ee003f2d98acbb4642e70f032cc04b5501361aabfabc1d603439935b878f3829",
        "encoding": "utf-8-sig",
        "columns": SCHOOL_SOURCE_COLUMNS,
        "license": "CC BY 4.0",
    },
    {
        "key": "japaneseEducation",
        "name": "日本語教育基本語彙データベース",
        "version": "公開版",
        "url": "https://mmsrv.ninjal.ac.jp/brfvep/rokusyutaisyo.csv",
        "sha256": "80f190abebfe5fdfc52aec06a6c9c842eb4b1ff25b6687f135547a81902607af",
        "encoding": "cp932",
        "columns": JAPANESE_EDUCATION_SOURCE_COLUMNS,
        "license": "CC BY 4.0",
    },
)
MANUAL_FILE = "01-input/inclusions/manual.txt"
EXCLUSION_FILES = (
    "01-input/exclusions/sensitive.txt",
    "01-input/exclusions/uncommon.txt",
    "01-input/exclusions/confusable-groups.csv",
)
BLOCK_WORDS = 35
FINAL_MAXIMUM_WORDS = 35


@dataclass(frozen=True)
class SourceRow:
    """収集元用ルールを適用できるところまで正規化した1行。"""

    source_key: str
    allocation: str
    reading: str
    heading: str
    surface: str
    part_of_speech: str
    sources: frozenset[str]


@dataclass
class Word:
    """正規化したひらがなの読みによって統合した根拠情報。

    ``heading``は表示文字種の選択用に収集元の文字種を保持し、``surface``は
    収集元にある表記例を保持する。どちらもrankには影響しない。
    """

    reading: str
    surfaces: set[str] = field(default_factory=set)
    parts_of_speech: set[str] = field(default_factory=set)
    allocations: set[str] = field(default_factory=set)
    school_sources: set[str] = field(default_factory=set)
    japanese_education_sources: set[str] = field(default_factory=set)
    headings: set[str] = field(default_factory=set)

    @property
    def kind(self) -> str:
        return "terminal" if self.reading.endswith("ん") else "normal"

    @property
    def head(self) -> str:
        return self.reading[0]

    @property
    def tail(self) -> str:
        return self.reading[-1]


@dataclass(frozen=True)
class ExclusionEntry:
    """指定場所と分類を含む、除外語の1件。"""

    reading: str
    category: str
    group: str
    source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dictionary")
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> bytes:
    """ハッシュ入力を、空白や実行環境に依存しない形式で直列化する。"""

    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def normalize_reading(value: str) -> str:
    """グラフの頂点と符号表のrankに使う正規形を返す。"""

    normalized = unicodedata.normalize("NFC", value.strip())
    return "".join(
        chr(ord(character) - 0x60) if "ァ" <= character <= "ヶ" else character
        for character in normalized
    )


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url, headers={"User-Agent": "kanachain-dictionary/1"}
    )
    with urllib.request.urlopen(request) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def rule_failures(value: object, rules: Iterable[object]) -> list[str]:
    return [rule.name for rule in rules if not rule(value)]


def read_source(path: Path, source: dict[str, object]) -> list[SourceRow]:
    """根拠となる列を保持しながら、固定したデータベースを1つ読み込む。"""

    rows: list[SourceRow] = []
    with path.open("r", encoding=str(source["encoding"]), newline="") as stream:
        for row in csv.DictReader(stream):
            heading = unicodedata.normalize("NFC", row.get("見出し", "").strip())
            reading = normalize_reading(heading)
            surface = unicodedata.normalize("NFC", row.get("表記", "").strip())
            sources = frozenset(
                column
                for column in source["columns"]
                if (row.get(column) or "").strip()
            )
            rows.append(
                SourceRow(
                    source_key=str(source["key"]),
                    allocation=(row.get("語彙配当") or "").strip(),
                    reading=reading,
                    heading=heading,
                    surface=surface,
                    part_of_speech=(row.get("品詞") or "").strip(),
                    sources=sources,
                )
            )
    return rows


def aggregate_source_pool(
    rows: Iterable[SourceRow],
) -> tuple[dict[str, Word], list[tuple[SourceRow, list[str]]]]:
    """候補集合を構築し、構造ルールの不合格理由を確認用レポートに残す。

    名詞・語彙配当ルールに合わない行は、定義上候補集合の外にある。一方、その方針を
    通過したのにKCBCへ参加できない行は別レポートに残す。これにより、ある語が
    ない理由を収集元CSVまで調べずに確認できる。
    """

    words: dict[str, Word] = {}
    structurally_excluded: list[tuple[SourceRow, list[str]]] = []
    for row in rows:
        if rule_failures(row, SOURCE_ENTRY_RULES):
            continue
        probe = Word(reading=row.reading)
        failures = rule_failures(probe, READING_RULES)
        if failures:
            structurally_excluded.append((row, failures))
            continue
        word = words.setdefault(row.reading, Word(reading=row.reading))
        if row.surface:
            word.surfaces.add(row.surface)
        if row.heading:
            word.headings.add(row.heading)
        word.parts_of_speech.add(row.part_of_speech)
        word.allocations.add(row.allocation)
        if row.source_key == "school":
            word.school_sources.update(row.sources)
        else:
            word.japanese_education_sources.update(row.sources)
    return words, structurally_excluded


def load_manual(output_dir: Path) -> set[str]:
    """1行1読みの手動採用入力を読み込む。"""

    path = output_dir / MANUAL_FILE
    if not path.exists():
        raise RuntimeError(f"missing required manual input: {path}")
    result: set[str] = set()
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        value = raw_line.strip()
        if not value or value.startswith("#"):
            continue
        reading = normalize_reading(value)
        if not reading:
            continue
        probe = Word(reading=reading)
        failures = rule_failures(probe, READING_RULES)
        if failures:
            raise RuntimeError(
                f"manual reading {reading!r} fails: {', '.join(failures)}"
            )
        if reading in result:
            raise RuntimeError(
                f"duplicate manual reading at {path}:{line_number}: {reading}"
            )
        result.add(reading)
    return result


def load_exclusions(output_dir: Path) -> dict[str, list[ExclusionEntry]]:
    """除外入力を読み込む。収集元に存在するかは取得後に検証する。

    候補から構造ルールで落ちる語でも、収集元にある限り将来のルール変更に備えて
    除外入力へ置ける。センシティブ語と一般的でない語は単純な集合として扱い、聞き分け
    にくい語は関係自体に意味があるためCSVの行単位のグループを維持する。
    """

    result: dict[str, list[ExclusionEntry]] = {}
    for relative in EXCLUSION_FILES[:2]:
        path = output_dir / relative
        if not path.exists():
            raise RuntimeError(f"missing required exclusion input: {path}")
        category = path.stem
        for line_number, raw_line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1
        ):
            value = raw_line.strip()
            if not value or value.startswith("#"):
                continue
            reading = normalize_reading(value)
            result.setdefault(reading, []).append(
                ExclusionEntry(reading, category, "", f"{relative}:{line_number}")
            )
    relative = EXCLUSION_FILES[2]
    path = output_dir / relative
    if not path.exists():
        raise RuntimeError(f"missing required exclusion input: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for line_number, row in enumerate(csv.reader(stream), 1):
            readings = [normalize_reading(value) for value in row if value.strip()]
            if not readings:
                continue
            if len(readings) < 2 or len(readings) != len(set(readings)):
                raise RuntimeError(
                    f"confusable group must contain unique 2+ readings at {path}:{line_number}"
                )
            group = f"confusable-{line_number}"
            for reading in readings:
                result.setdefault(reading, []).append(
                    ExclusionEntry(
                        reading, "confusable", group, f"{relative}:{line_number}"
                    )
                )
    return result


def build_path_counts(
    normal_words: list[Word],
    terminal_words: list[Word],
    states: set[str],
) -> tuple[
    list[dict[str, int]],
    list[dict[str, int]],
    dict[str, list[int]],
    dict[str, list[int]],
]:
    """A1ランタイムと同じ、生経路の単語数別経路数を数える。

    生経路では再使用を許したまま数え、ブロック内重複は余剰rankの候補選択時に
    除外する。互換性のある返り値を保つため、excluded表には同じ状態の生経路数を
    入れる。
    """

    normal_edges = {state: [] for state in states}
    terminal_edges = {state: [] for state in states}
    for word in normal_words:
        if word.head in states and word.tail in states:
            normal_edges[word.head].append(word)
    for word in terminal_words:
        if word.head in states:
            terminal_edges[word.head].append(word)

    terminal_counts = [{state: 0 for state in states}]
    for words in range(1, FINAL_MAXIMUM_WORDS + 1):
        layer: dict[str, int] = {}
        for state in states:
            total = 0
            for word in normal_edges[state]:
                if words > 1:
                    remaining = words - 1
                    total += terminal_counts[remaining][word.tail]
            if words == 1:
                total += len(terminal_edges[state])
            layer[state] = total
        terminal_counts.append(layer)

    normal_counts = [{state: 1 for state in states}]
    for words in range(1, FINAL_MAXIMUM_WORDS + 1):
        layer = {}
        for state in states:
            total = 0
            for word in normal_edges[state]:
                remaining = words - 1
                total += normal_counts[remaining][word.tail]
            layer[state] = total
        normal_counts.append(layer)

    self_loops = [
        word for word in normal_words if word.head == word.tail and word.head in states
    ]
    normal_excluded = {
        word.reading: [
            normal_counts[words][word.tail] for words in range(FINAL_MAXIMUM_WORDS + 1)
        ]
        for word in self_loops
    }
    terminal_excluded = {
        word.reading: [
            terminal_counts[words][word.tail]
            for words in range(FINAL_MAXIMUM_WORDS + 1)
        ]
        for word in self_loops
    }

    return normal_counts, terminal_counts, normal_excluded, terminal_excluded


def capacity_bits(count: int) -> int:
    """経路数から安全に運べる整数ビット数を返す。"""

    return count.bit_length() - 1 if count else 0


def usable_codebook_states(
    normal_words: Iterable[Word], terminal_words: Iterable[Word]
) -> set[str]:
    """A1の固定語数ブロックを構成し続けられる接続状態を求める。

    自動選定語に語が存在しても、その末尾から始まる通常語がなければ、最終ブロックより
    前にその状態へ入った符号化が行き止まる。そのような状態を繰り返し削除して、
    最大の閉じた部分集合を求める。

    さらに、35語通常ブロックが最大168 bitのブロックフレームを運べ、35語以内の
    終端経路が最大フレーム168 bitと候補余地20 bitを収容できる状態だけを残す。
    """

    normal_values = list(normal_words)
    terminal_values = list(terminal_words)
    states = {word.head for word in normal_values}
    while True:
        # まず、現在の状態集合の中に通常語の行き先を持たない状態を落とす。
        retained = {
            word.head
            for word in normal_values
            if word.head in states and word.tail in states
        }
        states = retained
        if not states:
            raise RuntimeError("自動採用された通常語グラフが空です")

        normal_counts, terminal_counts, _normal_excluded, _terminal_excluded = (
            build_path_counts(normal_values, terminal_values, states)
        )
        invalid: set[str] = set()
        for state in states:
            normal_bits = capacity_bits(normal_counts[BLOCK_WORDS][state])
            final_bits = capacity_bits(terminal_counts[FINAL_MAXIMUM_WORDS][state])
            if normal_bits < 168 or final_bits < 188:
                invalid.add(state)

        next_states = states - invalid
        if next_states == states:
            return states
        states = next_states


def sort_words(words: Iterable[Word]) -> list[Word]:
    """rank/unrankが直接使用する、安定した意味上の語順を返す。"""

    return sorted(
        words,
        key=lambda word: (
            STATE_INDEX[word.head],
            word.reading,
            STATE_INDEX.get(word.tail, len(STATE_ORDER)),
        ),
    )


def katakana_surface(surface: str) -> bool:
    """中立な記号だけを例外として許し、カタカナ見出しか判定する。"""

    has_katakana = False
    for character in surface:
        name = unicodedata.name(character, "")
        if "KATAKANA LETTER" in name:
            has_katakana = True
        elif character not in KATAKANA_ONLY:
            return False
    return has_katakana


def display_for(word: Word) -> str:
    # 文字種は表示用メタデータにすぎず、rankには常に``word.reading``を使う。
    return (
        "katakana"
        if word.headings and all(katakana_surface(s) for s in word.headings)
        else "hiragana"
    )


def word_record(word: Word, origins: list[str]) -> dict[str, object]:
    """rankに無関係な順序を排除し、説明情報を含む辞書レコードを作る。"""

    return {
        "reading": word.reading,
        "surfaces": sorted(word.surfaces),
        "display": display_for(word),
        "origin": origins,
        "evidence": {
            # 2つの収集元で配当が食い違っても情報を落とさない。
            "allocations": sorted(int(value) for value in word.allocations),
            "schoolSourceCount": len(word.school_sources),
            "schoolSources": sorted(word.school_sources),
            "japaneseEducationSourceCount": len(word.japanese_education_sources),
            "japaneseEducationSources": sorted(word.japanese_education_sources),
        },
    }


def write_tsv(
    path: Path, header: tuple[str, ...], rows: Iterable[Iterable[object]]
) -> None:
    """バージョン管理に適した、決定的なLF改行のレポートを書き出す。"""

    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def write_rule_exclusion_reports(
    output_dir: Path, structurally_excluded: Iterable[tuple[SourceRow, list[str]]]
) -> None:
    """構造ルールごとに、正規化済み読みの重複しない一覧を書き出す。"""

    report_dir = output_dir / "02-candidates" / "rule-exclusions"
    report_dir.mkdir(parents=True, exist_ok=True)
    for path in report_dir.glob("*.txt"):
        path.unlink()
    readings_by_rule: dict[str, set[str]] = {}
    for row, failures in structurally_excluded:
        for failure in failures:
            readings_by_rule.setdefault(failure, set()).add(row.reading)
    for rule_name in sorted(readings_by_rule):
        readings = sorted(readings_by_rule[rule_name])
        (report_dir / f"{rule_name}.txt").write_text(
            "".join(f"{reading}\n" for reading in readings),
            encoding="utf-8",
            newline="\n",
        )


def capacity_report_rows(
    normal_words: list[Word], terminal_words: list[Word], states: set[str]
) -> list[tuple[object, ...]]:
    """開始かなごとの最悪時容量と、語数の偏りを確認する行を返す。

    自己ループ語を直前のブロックで使った場合、その語を次の先頭には置けない。
    ここではその全ケースの最小値を採り、見かけ上の容量ではなく実際に保証できる
    容量をレポートする。容量の小さい順に並べ、次に増やすべき開始かなを見つけ
    やすくする。
    """

    normal_counts, terminal_counts, normal_excluded, terminal_excluded = (
        build_path_counts(normal_words, terminal_words, states)
    )
    rows: list[tuple[object, ...]] = []
    for state in states:
        self_loops = [
            word for word in normal_words if word.head == state and word.tail == state
        ]
        previous_readings: list[str | None] = [None] + [
            word.reading for word in self_loops
        ]
        normal_bits = min(
            capacity_bits(
                normal_counts[BLOCK_WORDS][state]
                if previous is None
                else normal_excluded[previous][BLOCK_WORDS]
            )
            for previous in previous_readings
        )
        final_bits = min(
            capacity_bits(
                terminal_counts[FINAL_MAXIMUM_WORDS][state]
                if previous is None
                else terminal_excluded[previous][FINAL_MAXIMUM_WORDS]
            )
            for previous in previous_readings
        )
        rows.append(
            (
                state,
                normal_bits,
                final_bits,
                sum(word.head == state for word in normal_words),
                sum(word.head == state for word in terminal_words),
                sum(word.tail == state for word in normal_words),
                len(self_loops),
            )
        )
    return sorted(rows, key=lambda row: (row[1], STATE_INDEX[str(row[0])]))


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for stage in ("02-candidates", "03-selection", "04-analysis", "05-output"):
        (output_dir / stage).mkdir(parents=True, exist_ok=True)
    manual = load_manual(output_dir)
    exclusions = load_exclusions(output_dir)
    overlap = sorted(set(manual) & set(exclusions))
    if overlap:
        raise RuntimeError(
            f"manual inclusions and exclusions overlap: {', '.join(overlap)}"
        )

    # ダウンロード物は一時ファイルにする。コミット済みの取得元ハッシュを来歴、
    # 生成レポートを確認用の表面とすることで、2つのデータベースを同梱せず、
    # 収集元が予告なく変更された場合も受け入れない。
    source_rows: list[SourceRow] = []
    with tempfile.TemporaryDirectory(prefix="kanachain-dictionary-") as temporary:
        temp_dir = Path(temporary)
        for source in SOURCES:
            path = temp_dir / f"{source['key']}.csv"
            download(str(source["url"]), path)
            actual = sha256_file(path)
            if actual != source["sha256"]:
                raise RuntimeError(
                    f"SHA-256 mismatch for {source['name']}: expected {source['sha256']}, got {actual}"
                )
            source_rows.extend(read_source(path, source))

    # raw sourcesにない除外語はどの選定ルールでも採用されず、台帳として維持する意味がない。
    # 入力ミスや、収集元から消えた語を空振りのまま残さないよう生成を止める。
    raw_readings = {row.reading for row in source_rows}
    exclusions_outside_raw = sorted(set(exclusions) - raw_readings)
    if exclusions_outside_raw:
        raise RuntimeError(
            "excluded readings are absent from raw sources: "
            + ", ".join(exclusions_outside_raw)
        )

    pool, structurally_excluded = aggregate_source_pool(source_rows)

    # レポート上の候補集合を不変に保つ。手動追加には教育語彙データベースにない
    # 読みも入り得るため、採用処理では候補集合から分離した複製を使う。
    words = {
        reading: Word(
            reading=word.reading,
            surfaces=set(word.surfaces),
            parts_of_speech=set(word.parts_of_speech),
            allocations=set(word.allocations),
            school_sources=set(word.school_sources),
            japanese_education_sources=set(word.japanese_education_sources),
            headings=set(word.headings),
        )
        for reading, word in pool.items()
    }
    for reading in manual:
        words.setdefault(reading, Word(reading=reading))

    # 教育資料による根拠の閾値は自動選定だけに適用する。手動追加語は
    # AUTO_SELECTION_RULESを迂回するが、構造上のREADING_RULESは通過している。
    auto_selection_failures = {
        reading: rule_failures(word, AUTO_SELECTION_RULES)
        for reading, word in pool.items()
    }
    auto_selection_candidates = {
        reading
        for reading, failures in auto_selection_failures.items()
        if not failures and reading not in exclusions
    }
    selected_before_graph = auto_selection_candidates | set(manual)
    selected_normal = [
        words[reading]
        for reading in selected_before_graph
        if not reading.endswith("ん")
    ]
    selected_terminal = [
        words[reading] for reading in selected_before_graph if reading.endswith("ん")
    ]
    # 自動選定候補と手動追加語には、利用可能な次語がない末尾が含まれる可能性が
    # ある。経路符号へ渡す前に通常語グラフを閉じ、手動追加語を暗黙に捨てる場合は
    # エラーにする。
    component = usable_codebook_states(selected_normal, selected_terminal)
    graph_rejected = {
        reading
        for reading in selected_before_graph
        if words[reading].head not in component
        or (not reading.endswith("ん") and words[reading].tail not in component)
    }
    manual_graph_rejected = sorted(graph_rejected & set(manual))
    if manual_graph_rejected:
        raise RuntimeError(
            "manual readings are outside the connected dictionary graph: "
            + ", ".join(manual_graph_rejected)
        )
    selected = selected_before_graph - graph_rejected
    auto_selected = selected & auto_selection_candidates

    normal = sort_words(
        words[reading] for reading in selected if not reading.endswith("ん")
    )
    terminal = sort_words(
        words[reading] for reading in selected if reading.endswith("ん")
    )
    normal_readings = [word.reading for word in normal]
    terminal_readings = [word.reading for word in terminal]
    # このハッシュは、rank/unrankを変える順序付きデータだけを対象とする。
    # 表記例、根拠、整形だけの変更を、符号列の互換性破壊として扱わない。
    codebook_hash = "sha256:" + sha256_bytes(
        canonical_json(
            {
                "normal": normal_readings,
                "terminal": terminal_readings,
            }
        )
    )

    # buildSha256は別の問いに答える。同じ収集元、コード、ルール、人手入力から、
    # この成果物全体を再現できるかを識別する。
    local_inputs = [
        ROOT / "scripts/dictionary/rules.py",
        ROOT / "scripts/dictionary/generate.py",
    ]
    local_inputs.extend(
        output_dir / relative for relative in (MANUAL_FILE, *EXCLUSION_FILES)
    )
    build_inputs = [
        {"path": path.relative_to(ROOT).as_posix(), "sha256": sha256_file(path)}
        for path in local_inputs
    ]
    build_hash_value = {
        "sources": [
            {"url": source["url"], "sha256": source["sha256"]} for source in SOURCES
        ],
        "inputs": build_inputs,
    }
    # generatedAtは追加しない。時刻を入れると同じ入力でもファイルが変わり、
    # バイト単位の再現性検証が成立しなくなる。
    manifest = {
        "schemaVersion": 2,
        "dictionaryVersion": DICTIONARY_VERSION,
        "codecFormat": "A1/D1",
        "codebookSha256": codebook_hash,
        "buildSha256": "sha256:" + sha256_bytes(canonical_json(build_hash_value)),
        "sources": [
            {
                key: source[key]
                for key in ("name", "version", "url", "sha256", "license")
            }
            for source in SOURCES
        ],
        "buildInputs": build_inputs,
        "rules": {
            "sourceEntry": [rule.name for rule in SOURCE_ENTRY_RULES],
            "reading": [rule.name for rule in READING_RULES],
            "autoSelection": [rule.name for rule in AUTO_SELECTION_RULES],
            "graph": "kcb2-word-block-viability-fixed-point",
        },
        "states": "".join(state for state in STATE_ORDER if state in component),
        "counts": {
            "candidates": len(pool),
            "autoSelected": len(auto_selected),
            "manualInclusions": len(set(manual) & selected),
            "excludedReadings": len(exclusions),
            "unreviewed": len(set(pool) - selected - set(exclusions)),
            "normalWords": len(normal),
            "terminalWords": len(terminal),
        },
        "normalWords": [
            word_record(
                word,
                [
                    origin
                    for origin in ("auto-selected", "manual-inclusion")
                    if (origin == "auto-selected" and word.reading in auto_selected)
                    or (origin == "manual-inclusion" and word.reading in manual)
                ],
            )
            for word in normal
        ],
        "terminalWords": [
            word_record(
                word,
                [
                    origin
                    for origin in ("auto-selected", "manual-inclusion")
                    if (origin == "auto-selected" and word.reading in auto_selected)
                    or (origin == "manual-inclusion" and word.reading in manual)
                ],
            )
            for word in terminal
        ],
    }
    (output_dir / "05-output" / "dictionary.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    # レポートの役割は意図的に重複させる。source-pool.tsvを完全な台帳とし、
    # 小さいファイル群を各作業で扱いやすい確認待ち一覧として使う。
    pool_rows = sort_words(pool.values())
    write_tsv(
        output_dir / "02-candidates" / "source-pool.tsv",
        (
            "reading",
            "kind",
            "characters",
            "surfaces",
            "parts_of_speech",
            "allocations",
            "school_source_count",
            "school_sources",
            "japanese_education_source_count",
            "japanese_education_sources",
            "auto_rule_failures",
            "selected",
        ),
        (
            (
                word.reading,
                word.kind,
                len(word.reading),
                ",".join(sorted(word.surfaces)),
                ",".join(sorted(word.parts_of_speech)),
                ",".join(sorted(word.allocations)),
                len(word.school_sources),
                ",".join(sorted(word.school_sources)),
                len(word.japanese_education_sources),
                ",".join(sorted(word.japanese_education_sources)),
                ",".join(auto_selection_failures[word.reading]),
                "auto-selected"
                if word.reading in auto_selected
                else "manual-inclusion"
                if word.reading in manual and word.reading in selected
                else "excluded"
                if word.reading in exclusions
                else "unreviewed",
            )
            for word in pool_rows
        ),
    )
    write_tsv(
        output_dir / "03-selection" / "auto-selected-readings.tsv",
        (
            "reading",
            "kind",
            "head",
            "tail",
            "characters",
        ),
        (
            (word.reading, word.kind, word.head, word.tail, len(word.reading))
            for word in (*normal, *terminal)
            if word.reading in auto_selected
        ),
    )
    write_tsv(
        output_dir / "04-analysis" / "capacity-by-state.tsv",
        (
            "state",
            "normal_capacity_bits",
            "final_capacity_bits",
            "normal_words",
            "terminal_words",
            "incoming_normal_words",
            "self_loop_words",
        ),
        capacity_report_rows(normal, terminal, component),
    )
    unreviewed = sort_words(
        word
        for reading, word in pool.items()
        if reading not in selected and reading not in exclusions
    )
    write_tsv(
        output_dir / "03-selection" / "unreviewed-readings.tsv",
        (
            "reading",
            "kind",
            "characters",
            "auto_rule_failures",
        ),
        (
            (
                word.reading,
                word.kind,
                len(word.reading),
                ",".join(
                    auto_selection_failures[word.reading]
                    + (["graph-connectivity"] if word.reading in graph_rejected else [])
                ),
            )
            for word in unreviewed
        ),
    )
    write_rule_exclusion_reports(output_dir, structurally_excluded)
    write_tsv(
        output_dir / "03-selection" / "excluded-readings.tsv",
        (
            "reading",
            "category",
            "group",
            "source",
            "in_source_pool",
        ),
        (
            (
                entry.reading,
                entry.category,
                entry.group,
                entry.source,
                "yes" if entry.reading in pool else "no",
            )
            for reading in sorted(exclusions)
            for entry in exclusions[reading]
        ),
    )

    print(
        f"source pool {len(pool)}; selected {len(normal)} normal + {len(terminal)} terminal; "
        f"unreviewed {manifest['counts']['unreviewed']}; excluded {len(exclusions)}"
    )


if __name__ == "__main__":
    main()
