#!/usr/bin/env python3
"""Run the two A1/D1 implementations against each other."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from kanachain import create_kana_chain_block_code

ROOT = Path(__file__).resolve().parents[1]
NODE_PROGRAM = r"""
import { readFileSync } from "node:fs";
import { createKanaChainBlockCode } from "./packages/js/src/codec.mjs";

const request = JSON.parse(readFileSync(0, "utf8"));
const codec = await createKanaChainBlockCode();
const results = request.cases.map((item, index) => {
  const input = item.kind === "text"
    ? item.value
    : Uint8Array.from(Buffer.from(item.valueHex, "hex"));
  const encoded = codec.serialize(input);
  const decodedFromPython = codec.deserialize(request.python[index].text).data;
  return {
    text: encoded.text,
    mode: encoded.metadata.mode,
    canonicalBlocks: encoded.canonicalBlocks,
    decodedFromPythonHex: Buffer.from(decodedFromPython).toString("hex"),
  };
});
process.stdout.write(JSON.stringify(results));
"""


def expected_bytes(case: dict[str, object]) -> bytes:
    if case["kind"] == "text":
        return str(case["value"]).encode("utf-8")
    return bytes.fromhex(str(case["valueHex"]))


def main() -> None:
    cases: list[dict[str, object]] = [
        {
            "name": "raw bytes",
            "kind": "bytes",
            "valueHex": bytes((i * 73 + 11) & 0xFF for i in range(36)).hex(),
            "expectedMode": 0,
        },
        {
            "name": "deflated UTF-8",
            "kind": "text",
            "value": "The quick brown fox " * 10,
            "expectedMode": 1,
        },
        {
            "name": "raw UTF-16LE",
            "kind": "text",
            "value": "こんにちは",
            "expectedMode": 2,
        },
        {
            "name": "deflated UTF-16LE",
            "kind": "text",
            "value": "あ" * 200,
            "expectedMode": 3,
        },
    ]
    codec = create_kana_chain_block_code()
    python_results = []
    for case in cases:
        source = (
            case["value"]
            if case["kind"] == "text"
            else bytes.fromhex(str(case["valueHex"]))
        )
        encoded = codec.serialize(source)  # type: ignore[arg-type]
        python_results.append(
            {
                "text": encoded.text,
                "mode": encoded.metadata["mode"],
                "canonicalBlocks": encoded.canonical_blocks,
            }
        )

    completed = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_PROGRAM],
        cwd=ROOT,
        input=json.dumps(
            {"cases": cases, "python": python_results}, ensure_ascii=False
        ),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    javascript_results = json.loads(completed.stdout)

    for case, python, javascript in zip(
        cases, python_results, javascript_results, strict=True
    ):
        name = str(case["name"])
        expected_mode = case["expectedMode"]
        if python["mode"] != expected_mode or javascript["mode"] != expected_mode:
            raise AssertionError(f"{name}: mode selection differs")
        if python["text"] != javascript["text"]:
            raise AssertionError(f"{name}: canonical text differs")
        if python["canonicalBlocks"] != javascript["canonicalBlocks"]:
            raise AssertionError(f"{name}: canonical blocks differ")
        expected = expected_bytes(case)
        if codec.deserialize(javascript["text"]).data != expected:
            raise AssertionError(f"{name}: Python could not decode JavaScript output")
        if bytes.fromhex(javascript["decodedFromPythonHex"]) != expected:
            raise AssertionError(f"{name}: JavaScript could not decode Python output")

    print(f"cross-language: {len(cases)} canonical outputs match in both directions")


if __name__ == "__main__":
    main()
