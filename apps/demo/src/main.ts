import type { DeserializeMetadata, SerializeMetadata } from "@mujuko/kanachain";
import { createKanaChainBlockCode } from "@mujuko/kanachain";
import codebook from "@mujuko/kanachain/codebook.json";

type Codec = Awaited<ReturnType<typeof createKanaChainBlockCode>>;

const source = document.querySelector<HTMLTextAreaElement>("#source")!;
const encoded = document.querySelector<HTMLTextAreaElement>("#encoded")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const stats = document.querySelector<HTMLElement>("#stats")!;
const chain = document.querySelector<HTMLElement>("#chain")!;
const chainBlocks = document.querySelector<HTMLElement>("#chain-blocks")!;
const sourceSize = document.querySelector<HTMLElement>("#source-size")!;
const encodedSize = document.querySelector<HTMLElement>("#encoded-size")!;
const codebookNote = document.querySelector<HTMLElement>("#codebook-note")!;
const sampleButtons = document.querySelector<HTMLElement>("#sample-buttons")!;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const SAMPLES: Array<[string, string]> = [
  ["あいさつ", "こんにちは、KCBC"],
  ["日本語の文", "吾輩は猫である。名前はまだ無い。"],
  ["URL", "https://github.com/mujuko/kanachain"],
  ["英文", "The quick brown fox jumps over the lazy dog."],
  ["絵文字", "しりとり🍣は🐈‍⬛でも遊べる"],
];

// 入力のたびに再変換するが、片方を書き換えるともう片方のinputイベントが
// 走るため、伝播中は逆方向の変換を止める。
let updating = false;

function setStatus(message: string, kind: "" | "error" = ""): void {
  status.textContent = message;
  status.className = kind === "error" ? "status error" : "status";
}

function clearOutputs(): void {
  stats.hidden = true;
  chain.hidden = true;
  chainBlocks.replaceChildren();
}

function renderStats(metadata: SerializeMetadata | DeserializeMetadata): void {
  stats.hidden = false;
  document.querySelector("#stat-words")!.textContent = String(metadata.words);
  document.querySelector("#stat-blocks")!.textContent = String(metadata.blocks);
  document.querySelector("#stat-source")!.textContent =
    `${"sourceBytes" in metadata ? metadata.sourceBytes : metadata.outputBytes} bytes`;
  const compression = metadata.compression === "deflate" ? "DEFLATE" : "無圧縮";
  const encoding = metadata.encoding === "utf16le" ? "UTF-16LE" : "UTF-8";
  document.querySelector("#stat-mode")!.textContent =
    `${encoding} / ${compression}`;
}

function renderChain(blocks: string[][]): void {
  chain.hidden = false;
  chainBlocks.replaceChildren(
    ...blocks.map((block, index) => {
      const element = document.createElement("div");
      element.className = "block";

      const heading = document.createElement("span");
      heading.className = "block-index";
      heading.textContent =
        index === blocks.length - 1
          ? `最終ブロック · ${block.length}語`
          : `ブロック ${index + 1} · ${block.length}語`;

      const words = document.createElement("p");
      words.className = "block-words";
      words.textContent = block.join(" ");

      element.append(heading, words);
      return element;
    }),
  );
}

function describeSize(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}

function fromSource(codec: Codec): void {
  const value = source.value;
  sourceSize.textContent = describeSize(encoder.encode(value).length);
  if (value === "") {
    encoded.value = "";
    encodedSize.textContent = "";
    setStatus("");
    clearOutputs();
    return;
  }
  const serialized = codec.serialize(value);
  encoded.value = serialized.text;
  encodedSize.textContent = `${serialized.metadata.words}語`;
  renderStats(serialized.metadata);
  renderChain(serialized.blocks);
  setStatus("");
  writeFragment(value);
}

function fromEncoded(codec: Codec): void {
  const value = encoded.value;
  if (value.trim() === "") {
    source.value = "";
    sourceSize.textContent = "";
    encodedSize.textContent = "";
    setStatus("");
    clearOutputs();
    return;
  }
  try {
    const deserialized = codec.deserialize(value);
    const text = decoder.decode(deserialized.data);
    source.value = text;
    sourceSize.textContent = describeSize(deserialized.data.length);
    encodedSize.textContent = `${deserialized.metadata.words}語`;
    renderStats(deserialized.metadata);
    renderChain(deserialized.blocks);
    setStatus("");
    writeFragment(text);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    clearOutputs();
  }
}

function writeFragment(text: string): void {
  const fragment = text === "" ? "" : `#${encodeURIComponent(text)}`;
  history.replaceState(null, "", `${location.pathname}${fragment}`);
}

function readFragment(): string {
  const raw = location.hash.slice(1);
  if (raw === "") {
    return "";
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

async function copy(button: HTMLButtonElement, value: string): Promise<void> {
  if (value === "") {
    return;
  }
  await navigator.clipboard.writeText(value);
  const original = button.textContent;
  button.textContent = "コピーしました";
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1200);
}

function guard(action: () => void): void {
  if (updating) {
    return;
  }
  updating = true;
  try {
    action();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    clearOutputs();
  } finally {
    updating = false;
  }
}

async function main(): Promise<void> {
  setStatus("符号表を読み込んでいます…");
  const codec = await createKanaChainBlockCode({ codebook });
  codebookNote.textContent =
    `符号表 ${codebook.dictionaryVersion}: 通常語${codebook.normalWords.length}語、` +
    `ん終端語${codebook.terminalWords.length}語、状態${[...codebook.states].length}個。`;
  setStatus("");

  source.addEventListener("input", () => guard(() => fromSource(codec)));
  encoded.addEventListener("input", () => guard(() => fromEncoded(codec)));

  document
    .querySelector<HTMLButtonElement>("#copy-source")!
    .addEventListener("click", (event) =>
      copy(event.currentTarget as HTMLButtonElement, source.value),
    );
  document
    .querySelector<HTMLButtonElement>("#copy-encoded")!
    .addEventListener("click", (event) =>
      copy(event.currentTarget as HTMLButtonElement, encoded.value),
    );

  sampleButtons.replaceChildren(
    ...SAMPLES.map(([label, value]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost";
      button.textContent = label;
      button.addEventListener("click", () => {
        source.value = value;
        guard(() => fromSource(codec));
        source.focus();
      });
      return button;
    }),
  );

  const initial = readFragment();
  if (initial !== "") {
    source.value = initial;
    guard(() => fromSource(codec));
  }
}

main().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});
