"""kanachainのコマンドラインインターフェース。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .codec import create_kana_chain_block_code


def _read_input(args: argparse.Namespace, as_text: bool) -> str | bytes:
    if args.text is not None:
        return args.text if as_text else args.text.encode("utf-8")
    data = Path(args.input).read_bytes() if args.input else sys.stdin.buffer.read()
    return data.decode("utf-8") if as_text else data


def _write_output(args: argparse.Namespace, content: str | bytes) -> None:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    if args.output:
        Path(args.output).write_bytes(payload)
    else:
        sys.stdout.buffer.write(payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="kanachain",
        description="任意のバイト列を日本語のしりとりへ可逆変換する",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("info", help="符号表と容量の情報を表示する")

    for name, help_text in [
        ("serialize", "入力をしりとりへ変換する"),
        ("deserialize", "しりとりを元のバイト列へ戻す"),
    ]:
        sub = subparsers.add_parser(name, help=help_text)
        sub.add_argument("--text", help="入力を直接指定する")
        sub.add_argument("--input", help="入力ファイル")
        sub.add_argument("--output", help="出力ファイル")
        if name == "serialize":
            sub.add_argument("--pretty", action="store_true", help="全角空白で区切る")
        else:
            sub.add_argument("--as-text", action="store_true", help="UTF-8文字列として出力する")

    args = parser.parse_args(argv)

    try:
        codec = create_kana_chain_block_code()
        if args.command == "info":
            print(json.dumps(codec.info, indent=2, ensure_ascii=False))
            return 0
        if args.text is not None and args.input is not None:
            raise ValueError("--text and --input cannot be used together")

        if args.command == "serialize":
            source = _read_input(args, as_text=args.text is not None)
            serialized = codec.serialize(source, pretty=args.pretty)
            _write_output(args, f"{serialized.text}\n")
            print(
                f"serialized {serialized.metadata['sourceBytes']} bytes as "
                f"{serialized.metadata['words']} words in "
                f"{serialized.metadata['blocks']} blocks "
                f"({serialized.metadata['compression']})",
                file=sys.stderr,
            )
            return 0

        deserialized = codec.deserialize(_read_input(args, as_text=True))
        _write_output(args, deserialized.data.decode("utf-8") if args.as_text else deserialized.data)
        if args.output:
            print(
                f"deserialized {deserialized.metadata['words']} words in "
                f"{deserialized.metadata['blocks']} blocks as "
                f"{deserialized.metadata['outputBytes']} bytes",
                file=sys.stderr,
            )
        return 0
    except (ValueError, OSError) as error:
        print(f"kanachain: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
