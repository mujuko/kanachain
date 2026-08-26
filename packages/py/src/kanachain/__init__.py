"""kanachain: 任意のバイト列を日本語のしりとりへ可逆変換する。

符号方式はKana Chain Block Code / 仮名チェーンブロック符号（KCBC）、
フォーマット識別子はA1/D1。
"""

from ._codebook import (
    Codebook,
    hiragana_to_katakana,
    katakana_to_hiragana,
    load_codebook,
)
from .codec import Decoded, Encoded, KanaChainBlockCode, create_kana_chain_block_code

__all__ = [
    "Codebook",
    "Decoded",
    "Encoded",
    "KanaChainBlockCode",
    "create_kana_chain_block_code",
    "hiragana_to_katakana",
    "katakana_to_hiragana",
    "load_codebook",
]
__version__ = "1.0.0"
