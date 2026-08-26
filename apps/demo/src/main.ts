import type { DeserializeMetadata, SerializeMetadata } from "@mujuko/kanachain";
import { createKanaChainBlockCode } from "@mujuko/kanachain";
import codebook from "@mujuko/kanachain/codebook.json";
import { findChainBreak, type ChainBreak } from "./chainValidation";

type Codec = Awaited<ReturnType<typeof createKanaChainBlockCode>>;
type Metadata = SerializeMetadata | DeserializeMetadata;

const source = document.querySelector<HTMLTextAreaElement>("#source")!;
const encoded = document.querySelector<HTMLTextAreaElement>("#encoded")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const results = document.querySelector<HTMLElement>("#results")!;
const stats = document.querySelector<HTMLElement>("#stats")!;
const chainBlocks = document.querySelector<HTMLElement>("#chain-blocks")!;
const validationLegend = document.querySelector<HTMLElement>("#validation-legend")!;
const validationMark = validationLegend.querySelector<HTMLElement>(".legend-mark")!;
const validationLabel = validationLegend.querySelector<HTMLElement>("span")!;
const sourceSize = document.querySelector<HTMLElement>("#source-size")!;
const encodedSize = document.querySelector<HTMLElement>("#encoded-size")!;
const sampleButtons = document.querySelector<HTMLElement>("#sample-buttons")!;
const actionFeedback = document.querySelector<HTMLElement>("#action-feedback")!;
const copySourceButton = document.querySelector<HTMLButtonElement>("#copy-source")!;
const copyEncodedButton = document.querySelector<HTMLButtonElement>("#copy-encoded")!;
const clearSourceButton = document.querySelector<HTMLButtonElement>("#clear-source")!;
const clearEncodedButton = document.querySelector<HTMLButtonElement>("#clear-encoded")!;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const SAMPLES: Array<[string, string]> = [
  ["あいさつ", "こんにちは、KCBC"],
  ["日本語の文", "吾輩は猫である。名前はまだ無い。"],
  ["UUID", "550e8400-e29b-41d4-a716-446655440000"],
  ["URL", "https://github.com/mujuko/kanachain"],
  ["英文", "The quick brown fox jumps over the lazy dog."],
  ["絵文字", "🍣🐈‍⬛🧩🌿🛰️✨"],
];

type BlockValidationState = "success" | "chain-invalid" | "validation-failed" | "unverified";
type Failure = { blockIndex: number | null; kind: "chain" | "validation"; wordIndex?: number };

let updating = false;

function setStatus(message: string, kind: "" | "error" = ""): void {
  status.textContent = message;
  status.className = kind === "error" ? "status error" : "status";
  status.setAttribute("role", kind === "error" ? "alert" : "status");
  status.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
}

function clearOutputs(): void {
  results.hidden = true;
  stats.hidden = true;
  chainBlocks.replaceChildren();
}

function showResults(): void {
  results.hidden = false;
}

function renderStats(metadata: Metadata): void {
  showResults();
  stats.hidden = false;
  document.querySelector("#stat-words")!.textContent = String(metadata.words);
  document.querySelector("#stat-blocks")!.textContent = String(metadata.blocks);
  document.querySelector("#stat-source")!.textContent =
    `${"sourceBytes" in metadata ? metadata.sourceBytes : metadata.outputBytes} bytes`;
  const compression = metadata.compression === "deflate" ? "DEFLATE" : "無圧縮";
  const encoding = metadata.encoding === "utf16le" ? "UTF-16LE" : "UTF-8";
  document.querySelector("#stat-mode")!.textContent = `${encoding} / ${compression}`;
}

function wordsFromText(value: string): string[][] {
  const words = value
    .normalize("NFC")
    .trim()
    .split(/[\s\u3000]+/u)
    .filter(Boolean);
  const blocks: string[][] = [];
  for (let i = 0; i < words.length; i += 35) blocks.push(words.slice(i, i + 35));
  return blocks;
}

function normalizedEncodedText(value: string): string {
  return value.normalize("NFC").trim().split(/[\s\u3000]+/u).filter(Boolean).join(" ");
}

function chainBreakMessage(chainBreak: ChainBreak): string {
  const { before, after } = chainBreak;
  if (before.blockIndex !== after.blockIndex) {
    return `ブロック${before.blockIndex + 1}の末尾とブロック${after.blockIndex + 1}の先頭でしりとりが切れています（「${before.word}」→「${after.word}」）。`;
  }
  return `ブロック${after.blockIndex + 1}の${after.wordIndex + 1}語目でしりとりが切れています（「${before.word}」→「${after.word}」）。`;
}

function validationStateLabel(state: Exclude<BlockValidationState, "unverified">): string {
  if (state === "success") return "検証成功";
  if (state === "chain-invalid") return "しりとり不成立";
  return "検証失敗";
}

function validationStateMark(state: BlockValidationState): string {
  if (state === "success") return "✅";
  if (state === "unverified") return "⏳";
  return state === "chain-invalid" ? "💔" : "🔥";
}

function verifiedBlocksFrom(error: unknown): Uint8Array[] {
  if (!(error instanceof Error)) return [];
  const verifiedBlocks = (error as Error & { verifiedBlocks?: unknown }).verifiedBlocks;
  return Array.isArray(verifiedBlocks) && verifiedBlocks.every((block) => block instanceof Uint8Array)
    ? verifiedBlocks
    : [];
}

function setValidationLegend(state: Exclude<BlockValidationState, "unverified">): void {
  validationLegend.className = `validation-legend is-${state}`;
  validationMark.className = "legend-mark";
  validationMark.textContent = validationStateMark(state);
  validationLabel.textContent = validationStateLabel(state);
}

function renderChain(
  blocks: string[][],
  blockData: Uint8Array[] = [],
  failure: Failure | null = null,
): void {
  showResults();
  setValidationLegend(failure?.kind === "chain" ? "chain-invalid" : failure ? "validation-failed" : "success");
  chainBlocks.replaceChildren(
    ...blocks.map((block, index) => {
      const element = document.createElement("article");
      const validationState: BlockValidationState = !failure || (failure.blockIndex !== null && index < failure.blockIndex)
        ? "success"
        : failure.blockIndex === index
          ? failure.kind === "chain" ? "chain-invalid" : "validation-failed"
          : "unverified";
      element.className = `block is-${validationState}`;
      element.setAttribute("aria-labelledby", `block-title-${index}`);

      const header = document.createElement("div");
      header.className = "block-header";
      const heading = document.createElement("span");
      heading.className = "block-index";
      heading.id = `block-title-${index}`;
      heading.textContent = index === blocks.length - 1 ? `最終ブロック · ${block.length}/35語` : `ブロック ${index + 1} · ${block.length}/35語`;
      const stateElement = document.createElement("span");
      stateElement.className = `block-state is-${validationState}`;
      const stateMark = document.createElement("i");
      stateMark.className = "state-mark";
      stateMark.setAttribute("aria-hidden", "true");
      stateMark.textContent = validationStateMark(validationState);
      const stateLabel = document.createElement("span");
      stateLabel.textContent = validationState === "unverified" ? "未検証" : validationStateLabel(validationState);
      stateElement.append(stateMark, stateLabel);
      header.append(heading, stateElement);

      const grid = document.createElement("div");
      grid.className = "block-grid";
      grid.setAttribute("role", "list");
      for (let wordIndex = 0; wordIndex < 35; wordIndex += 1) {
        const cell = document.createElement("div");
        cell.className = wordIndex < block.length ? "word-cell" : "word-cell is-empty";
        if (failure?.kind === "chain" && failure.blockIndex === index && failure.wordIndex === wordIndex) {
          cell.classList.add("is-error");
          cell.setAttribute("aria-invalid", "true");
        }
        cell.setAttribute("role", "listitem");
        const number = document.createElement("span");
        number.className = "word-cell-number";
        number.textContent = String(wordIndex + 1).padStart(2, "0");
        cell.append(number);
        if (wordIndex < block.length) {
          const word = document.createElement("span");
          word.className = "word-cell-word";
          word.textContent = block[wordIndex];
          cell.append(word);
        }
        grid.append(cell);
      }

      const dataForBlock = blockData[index] ?? new Uint8Array();
      const blockBinary = document.createElement("div");
      blockBinary.className = "block-binary";
      const blockBinaryLabel = document.createElement("span");
      blockBinaryLabel.textContent = "CRC検証済みペイロード";
      const blockBinaryValue = document.createElement("code");
      blockBinaryValue.textContent = dataForBlock.length
        ? Array.from(dataForBlock, (byte) => byte.toString(2).padStart(8, "0")).join(" ")
        : "—";
      blockBinary.append(blockBinaryLabel, blockBinaryValue);
      element.append(header, grid, blockBinary);
      return element;
    }),
  );
}

function describeSize(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}

function fromSource(codec: Codec): void {
  const value = source.value;
  const sourceBytes = encoder.encode(value);
  sourceSize.textContent = describeSize(sourceBytes.length);
  if (value === "") {
    encoded.value = "";
    encodedSize.textContent = "";
    setStatus("");
    clearOutputs();
    writeFragment("");
    return;
  }
  const serialized = codec.serialize(value);
  const blockData = codec.decodeFrameBlocks(serialized.text);
  encoded.value = serialized.words.join(" ");
  encodedSize.textContent = `${serialized.metadata.words}語`;
  renderStats(serialized.metadata);
  renderChain(serialized.blocks, blockData);
  setStatus("");
  writeFragment(value);
}

function fromEncoded(codec: Codec): void {
  const rawValue = encoded.value;
  const normalizedValue = normalizedEncodedText(rawValue);
  if (normalizedValue === "") {
    source.value = "";
    sourceSize.textContent = "";
    encodedSize.textContent = "";
    setStatus("");
    clearOutputs();
    writeFragment("");
    return;
  }
  const blocks = wordsFromText(normalizedValue);
  const chainBreak = findChainBreak(blocks);
  try {
    const deserialized = codec.deserialize(normalizedValue);
    const text = decoder.decode(deserialized.data);
    source.value = text;
    sourceSize.textContent = describeSize(deserialized.data.length);
    encodedSize.textContent = `${deserialized.metadata.words}語`;
    renderStats(deserialized.metadata);
    const blockData = codec.decodeFrameBlocks(normalizedValue);
    encoded.value = deserialized.words.join(" ");
    renderChain(deserialized.blocks, blockData);
    setStatus("");
    writeFragment(text);
  } catch (error) {
    const verifiedBlocks = verifiedBlocksFrom(error);
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/block (\d+)/u);
    const invalidIndex = chainBreak?.after.blockIndex ?? (match ? Number(match[1]) : null);
    const userMessage = chainBreak
      ? chainBreakMessage(chainBreak)
      : invalidIndex !== null
        ? `ブロック${invalidIndex + 1}で誤りを検出しました。単語列を確認してください。`
        : "入力を検証できませんでした。単語数と終端語を確認してください。";
    if (invalidIndex !== null && invalidIndex < 100) {
      while (blocks.length <= invalidIndex) blocks.push([]);
    }
    showResults();
    stats.hidden = true;
    const failure: Failure = chainBreak
      ? { blockIndex: chainBreak.after.blockIndex, kind: "chain", wordIndex: chainBreak.after.wordIndex }
      : { blockIndex: invalidIndex, kind: "validation" };
    renderChain(blocks, verifiedBlocks, failure);
    setStatus(userMessage, "error");
  }
}

function writeFragment(text: string): void {
  const fragment = text === "" ? "" : `#${encodeURIComponent(text)}`;
  history.replaceState(null, "", `${location.pathname}${fragment}`);
}

function readFragment(): string {
  const raw = location.hash.slice(1);
  if (raw === "") return "";
  try { return decodeURIComponent(raw); } catch { return ""; }
}

async function copy(button: HTMLButtonElement, value: string, label: string): Promise<void> {
  if (value === "") return;
  try {
    await navigator.clipboard.writeText(value);
    const originalLabel = button.getAttribute("aria-label") ?? label;
    const originalTitle = button.title;
    button.setAttribute("aria-label", `${label}をコピーしました`);
    button.title = `${label}をコピーしました`;
    button.classList.add("is-complete");
    actionFeedback.textContent = `${label}をコピーしました。`;
    setTimeout(() => {
      button.setAttribute("aria-label", originalLabel);
      button.title = originalTitle;
      button.classList.remove("is-complete");
    }, 1200);
  } catch {
    setStatus(`${label}をコピーできませんでした。`, "error");
  }
}

function clearField(field: HTMLTextAreaElement, update: () => void): void {
  field.value = "";
  guard(update);
  field.focus();
}

function guard(action: () => void): void {
  if (updating) return;
  updating = true;
  try { action(); }
  catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    clearOutputs();
  } finally { updating = false; }
}

async function main(): Promise<void> {
  setStatus("符号表を読み込んでいます…");
  const codec = await createKanaChainBlockCode({ codebook });
  setStatus("");
  source.addEventListener("input", () => guard(() => fromSource(codec)));
  encoded.addEventListener("input", () => guard(() => fromEncoded(codec)));
  copySourceButton.addEventListener("click", () => copy(copySourceButton, source.value, "文字列"));
  copyEncodedButton.addEventListener("click", () => copy(copyEncodedButton, encoded.value, "しりとり"));
  clearSourceButton.addEventListener("click", () => clearField(source, () => fromSource(codec)));
  clearEncodedButton.addEventListener("click", () => clearField(encoded, () => fromEncoded(codec)));
  sampleButtons.replaceChildren(...SAMPLES.map(([label, value]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = label;
    button.addEventListener("click", () => { source.value = value; guard(() => fromSource(codec)); source.focus(); });
    return button;
  }));
  const initial = readFragment();
  if (initial !== "") { source.value = initial; guard(() => fromSource(codec)); }
}

main().catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error"));
