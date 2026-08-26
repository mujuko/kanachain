#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { bytesToUtf8, concatBytes, utf8ToBytes } from "./bytes.mjs";
import { createKanaChainBlockCode } from "./codec.mjs";

function usage() {
  return `Usage:
  kanachain info
  kanachain serialize [--text TEXT | --input FILE] [--output FILE] [--pretty]
  kanachain deserialize [--text WORDS | --input FILE] [--output FILE] [--as-text]

Without --text or --input, input is read from stdin.`;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  const flags = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--as-text" || argument === "--pretty") {
      flags.add(argument);
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= rest.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options.set(argument, rest[index + 1]);
    index += 1;
  }
  if (options.has("--text") && options.has("--input")) {
    throw new Error("--text and --input cannot be used together");
  }
  return { command, options, flags };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return concatBytes(chunks.map((chunk) => new Uint8Array(chunk)));
}

async function readInput(options, textMode = false) {
  if (options.has("--text")) {
    return textMode ? options.get("--text") : utf8ToBytes(options.get("--text"));
  }
  const input = options.has("--input") ? await readFile(options.get("--input")) : await readStdin();
  return textMode ? bytesToUtf8(new Uint8Array(input)) : new Uint8Array(input);
}

async function writeOutput(options, content) {
  if (options.has("--output")) {
    await writeFile(options.get("--output"), content);
  } else {
    process.stdout.write(content);
  }
}

async function main() {
  const { command, options, flags } = parseArguments(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  const codec = await createKanaChainBlockCode();
  if (command === "info") {
    console.log(JSON.stringify(codec.info, null, 2));
    return;
  }
  if (command === "serialize") {
    const input = options.has("--text")
      ? options.get("--text")
      : await readInput(options);
    const serialized = codec.serialize(input, { pretty: flags.has("--pretty") });
    await writeOutput(options, `${serialized.text}\n`);
    console.error(
      `serialized ${serialized.metadata.sourceBytes} bytes as ${serialized.metadata.words} words in ${serialized.metadata.blocks} blocks (${serialized.metadata.compression})`,
    );
    return;
  }
  if (command === "deserialize") {
    const input = await readInput(options, true);
    const deserialized = codec.deserialize(input);
    const output = flags.has("--as-text") ? bytesToUtf8(deserialized.data) : deserialized.data;
    await writeOutput(options, output);
    if (options.has("--output")) {
      console.error(
        `deserialized ${deserialized.metadata.words} words in ${deserialized.metadata.blocks} blocks as ${deserialized.metadata.outputBytes} bytes`,
      );
    }
    return;
  }
  throw new Error(`unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`kanachain: ${error.message}`);
  process.exitCode = 1;
});
