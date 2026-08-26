import json
from pathlib import Path

import pytest
from kanachain import create_kana_chain_block_code

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "vectors" / "a1d1.json").read_text(
        encoding="utf-8"
    )
)
codec = create_kana_chain_block_code()


def test_vector_metadata():
    assert VECTORS["format"] == "A1/D1"
    assert VECTORS["codebookSha256"] == codec.codebook.codebook_sha256


def test_vectors_cover_self_loops_and_cross_block_reuse_without_local_duplicates():
    has_self_loop = False
    has_cross_block_reuse = False
    for vector in VECTORS["frames"]:
        prior = set()
        for block in vector["canonicalBlocks"]:
            assert len(set(block)) == len(block)
            if len(block) == 35:
                groups = [0, 0, 0]
                for word in block:
                    groups[0 if len(word) == 2 else 1 if len(word) == 3 else 2] += 1
                assert max(groups) - min(groups) <= 6
            has_self_loop |= any(word[0] == word[-1] for word in block)
            has_cross_block_reuse |= any(word in prior for word in block)
            prior.update(block)
    assert has_self_loop
    assert has_cross_block_reuse


def test_canonical_vectors():
    for vector in VECTORS["frames"]:
        frame = bytes.fromhex(vector["frameHex"])
        encoded = codec.encode_frame(frame)
        assert encoded.canonical_blocks == vector["canonicalBlocks"]
        assert codec.decode_frame(vector["canonicalBlocks"]) == frame


def test_canonical_serialization_vectors():
    for vector in VECTORS["canonicalSerialization"]:
        source = (
            vector["value"]
            if vector["kind"] == "text"
            else bytes.fromhex(vector["valueHex"])
        )
        encoded = codec.serialize(source)
        assert encoded.metadata["mode"] == vector["expectedMode"]
        assert encoded.canonical_blocks == vector["canonicalBlocks"]


def test_invalid_vectors_identify_their_block():
    for vector in VECTORS["invalidFrames"]:
        with pytest.raises(ValueError, match=rf"block {vector['expectedBlock']}"):
            codec.decode_frame(vector["canonicalBlocks"])


def test_roundtrip_vectors():
    for vector in VECTORS["roundtrip"]:
        source = (
            vector["value"]
            if vector["kind"] == "text"
            else bytes.fromhex(vector["valueHex"])
        )
        encoded = codec.serialize(source)
        decoded = codec.deserialize(encoded.text).data
        assert decoded == (source.encode() if isinstance(source, str) else source)
