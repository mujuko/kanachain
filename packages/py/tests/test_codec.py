import copy
import json
import zlib
from pathlib import Path

import pytest
from kanachain import (
    create_kana_chain_block_code,
    hiragana_to_katakana,
    katakana_to_hiragana,
)
from kanachain._codebook import parse_codebook
from kanachain.codec import _crc16

codec = create_kana_chain_block_code()
CODEBOOK = json.loads(
    (
        Path(__file__).resolve().parents[1] / "src" / "kanachain" / "codebook.json"
    ).read_text(encoding="utf-8")
)


def test_a1d1_info():
    assert codec.info["format"] == "A1/D1"
    assert codec.info["algorithmVersion"] == 1
    assert codec.info["dictionaryVersion"] == 1
    assert codec.info["states"] == 67


def test_crc16_ccitt_false_matches_its_standard_check_value():
    assert _crc16(b"123456789") == 0x29B1


def test_binary_and_text_roundtrips():
    for source in (
        b"",
        bytes(range(19)),
        bytes((i * 73 + 11) & 255 for i in range(100)),
    ):
        encoded = codec.serialize(source)
        assert codec.deserialize(encoded.text).data == source
    for source in ("こんにちは", "The quick brown fox " * 10):
        encoded = codec.serialize(source)
        assert codec.deserialize(encoded.text).data.decode() == source


def test_serialized_blocks_are_connected_locally_unique_and_terminate_once():
    encoded = codec.serialize(bytes((index * 73 + 11) & 255 for index in range(257)))
    expected_head = None
    for block_index, display_block in enumerate(encoded.blocks):
        block = [katakana_to_hiragana(word) for word in display_block]
        assert len(set(block)) == len(block)
        if block_index < len(encoded.blocks) - 1:
            assert len(block) == 35
        for word_index, word in enumerate(block):
            if expected_head is not None:
                assert word[0] == expected_head
            expected_head = word[-1]
            final = (
                block_index == len(encoded.blocks) - 1 and word_index == len(block) - 1
            )
            assert word.endswith("ん") == final


def test_pretty_crlf_and_mixed_kana_scripts_are_accepted():
    source = "猫🐈‍⬛とNUL\0も往復"
    encoded = codec.serialize(source, pretty=True)
    assert "　" in encoded.text
    mixed = [
        [
            word if (block_index + word_index) % 2 else hiragana_to_katakana(word)
            for word_index, word in enumerate(block)
        ]
        for block_index, block in enumerate(encoded.canonical_blocks)
    ]
    with_crlf = "\r\n".join("　".join(block) for block in mixed)
    assert codec.deserialize(with_crlf).data.decode() == source


def test_empty_and_unterminated_word_lists_are_rejected():
    with pytest.raises(ValueError, match="must not be empty"):
        codec.deserialize("")
    encoded = codec.serialize("しりとり")
    with pytest.raises(ValueError, match="ん|terminal"):
        codec.deserialize(encoded.words[:-1])


def test_duplicate_word_is_rejected():
    encoded = codec.encode_frame(bytes([1, 1, 0]))
    blocks = [list(b) for b in encoded.canonical_blocks]
    blocks[0][1] = blocks[0][0]
    try:
        codec.decode_frame(blocks)
    except ValueError as error:
        assert (
            "duplicate" in str(error) or "CRC" in str(error) or "invalid" in str(error)
        )
    else:
        raise AssertionError("duplicate reading was accepted")


def test_crc_start_rule_reaches_all_dictionary_states():
    def crc16(data: bytes) -> int:
        crc = 0xFFFF
        for byte in data:
            crc ^= byte << 8
            for _ in range(8):
                crc = (
                    ((crc << 1) ^ 0x1021) & 0xFFFF
                    if crc & 0x8000
                    else (crc << 1) & 0xFFFF
                )
        return crc

    reached = {
        crc16(bytes([1, 0, 0, 0, 0, 2]) + value.to_bytes(2, "big"))
        % len(codec.start_states)
        for value in range(0x10000)
    }
    assert len(reached) == 67


def test_raw_path_rank_accepts_self_loops_and_palindromes():
    assert codec.paths.rank_normal(["もも"], "も").rank >= 0
    assert codec.paths.rank_normal(["まま"], "ま").rank >= 0
    assert codec.paths.rank_normal(["もも", "もも"], "も").rank >= 0
    assert codec.paths.rank(["もも", "もん"], "も").rank >= 0


def test_rank_and_unrank_are_inverse_at_representative_boundaries():
    for state in ("あ", "も", "ぬ"):
        for word_count in (1, 2, 5, 35):
            count = codec.paths.normal_path_count(word_count, state)
            for rank in (0, count // 2, count - 1):
                path = codec.paths.unrank_normal(rank, word_count, state)
                assert codec.paths.rank_normal(path.words, state).rank == rank


def test_one_word_corruption_is_localized_to_its_block():
    encoded = codec.encode_frame(bytes((index * 73 + 11) & 255 for index in range(73)))
    assert len(encoded.canonical_blocks) >= 4
    for block_index in range(len(encoded.canonical_blocks)):
        blocks = [list(block) for block in encoded.canonical_blocks]
        block = blocks[block_index]
        replacement = None
        for word_index, word in enumerate(block[:-1]):
            replacement_word = next(
                (
                    other
                    for other in codec.codebook.normal_words
                    if other != word
                    and other[0] == word[0]
                    and other[-1] == word[-1]
                    and other not in block
                ),
                None,
            )
            if replacement_word is not None:
                replacement = (word_index, replacement_word)
                break
        assert replacement is not None
        block[replacement[0]] = replacement[1]
        with pytest.raises(ValueError, match=rf"block {block_index}"):
            codec.decode_frame(blocks)


def test_unsupported_algorithm_dictionary_and_mode_are_rejected():
    for frame in (bytes([2, 1, 0]), bytes([1, 2, 0]), bytes([1, 1, 4])):
        with pytest.raises(ValueError):
            codec.deserialize(codec.encode_frame(frame).text)


def test_unknown_dictionary_word_reports_the_zero_based_block():
    blocks = [
        list(block) for block in codec.encode_frame(bytes([1, 1, 0])).canonical_blocks
    ]
    blocks[0][0] = "未知語"
    with pytest.raises(ValueError, match=r"block 0"):
        codec.decode_frame(blocks)


def test_explicit_inter_block_chain_cut_is_reported_before_crc_decoding():
    blocks = [
        list(block) for block in codec.encode_frame(bytes(range(40))).canonical_blocks
    ]
    expected = blocks[0][-1][-1]
    blocks[1][0] = next(
        word for word in codec.codebook.normal_words if word[0] != expected
    )
    with pytest.raises(ValueError, match=r"block 1 breaks the chain"):
        codec.decode_frame(blocks)


def test_normal_block_word_counts_below_and_above_35_are_rejected():
    source = [
        list(block) for block in codec.encode_frame(bytes(range(40))).canonical_blocks
    ]
    short = [list(block) for block in source]
    short[0].pop()
    with pytest.raises(ValueError, match=r"block 0 uses 34 words"):
        codec.decode_frame(short)
    long = [list(block) for block in source]
    long[0].append(codec.codebook.normal_words[0])
    with pytest.raises(ValueError, match=r"block 0 uses 36 words"):
        codec.decode_frame(long)


def test_final_block_over_35_words_and_terminal_position_errors_are_rejected():
    source = [
        list(block) for block in codec.encode_frame(bytes(range(40))).canonical_blocks
    ]
    too_long = [list(block) for block in source]
    too_long[-1].extend([codec.codebook.normal_words[0]] * (36 - len(too_long[-1])))
    with pytest.raises(ValueError, match=r"final block .*too long"):
        codec.decode_frame(too_long)
    misplaced = [list(block) for block in source]
    misplaced[0][34] = codec.codebook.terminal_words[0]
    with pytest.raises(ValueError, match=r"terminal word is in the wrong block"):
        codec.decode_frame(misplaced)
    missing = [list(block) for block in source]
    missing[-1].pop()
    with pytest.raises(ValueError, match=r"terminal word is in the wrong block"):
        codec.decode_frame(missing)


def test_crc_valid_invalid_deflate_and_utf16_payloads_fail_after_block_decoding():
    with pytest.raises(zlib.error):
        codec.deserialize(codec.encode_frame(bytes([1, 1, 1, 0xFF])).text)
    with pytest.raises(UnicodeDecodeError):
        codec.deserialize(codec.encode_frame(bytes([1, 1, 2, 0])).text)
    with pytest.raises(UnicodeDecodeError):
        codec.deserialize(codec.encode_frame(bytes([1, 1, 2, 0, 0xD8])).text)


@pytest.mark.parametrize(
    ("field", "value", "pattern"),
    [
        ("codecFormat", "KCB1", "codebook is for"),
        ("dictionaryVersion", 2, "dictionary version"),
        ("states", "い" + CODEBOOK["states"][1:], "state order"),
        ("codebookSha256", "sha256:" + "0" * 64, "hash mismatch"),
    ],
)
def test_codebook_metadata_mutations_are_rejected(field, value, pattern):
    mutated = copy.deepcopy(CODEBOOK)
    mutated[field] = value
    with pytest.raises(ValueError, match=pattern):
        parse_codebook(mutated)
