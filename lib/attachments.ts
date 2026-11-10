/**
 * Turns attached files into text, in the browser. The model reads text only,
 * so documents are converted to their text and images are read with on-device
 * OCR. The original files are never uploaded; only the extracted text is sent
 * with the message.
 */

export type Attachment = {
  name: string;
  kind: "document" | "image";
  /** Text extracted from the file ("" when nothing could be read). */
  text: string;
  /** True when the text was cut to MAX_ATTACHMENT_CHARS. */
  truncated?: boolean;
  /** Small data-URL thumbnail, images only. */
  preview?: string;
};

export type PendingFile = {
  id: string;
  name: string;
  status: "reading" | "ready" | "error";
  attachment?: Attachment;
  error?: string;
};

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_CHARS = 120_000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** File picker filter. Other text-like files are accepted too, by content. */
export const ACCEPT =
  "image/*,.pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.php,.sh,.sql,.toml,.ini,.log,.tex,.rtf";

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function newPending(file: File): PendingFile {
  return { id: crypto.randomUUID(), name: file.name || "pasted file", status: "reading" };
}

function finish(name: string, kind: Attachment["kind"], raw: string, preview?: string): Attachment {
  const text = raw.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  const truncated = text.length > MAX_ATTACHMENT_CHARS;
  return {
    name,
    kind,
    text: truncated ? text.slice(0, MAX_ATTACHMENT_CHARS) : text,
    ...(truncated ? { truncated } : {}),
    ...(preview ? { preview } : {}),
  };
}

async function readPdf(file: File): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), {
    mergePages: true,
  });
  if (!text.trim()) {
    throw new Error("No text found in this PDF. It may be a scan; try attaching it as images.");
  }
  return text;
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function readXlsx(file: File): Promise<string> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return sheets
    .map(
      ({ sheet, data }) =>
        `# Sheet: ${sheet}\n${data.map((row) => row.map(cell).join(",")).join("\n")}`,
    )
    .join("\n\n");
}

async function readImage(file: File): Promise<{ text: string; preview?: string }> {
  const preview = await thumbnail(file).catch(() => undefined);
  // The OCR engine and its English language data load on first use.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return { text: data.text, preview };
  } finally {
    await worker.terminate();
  }
}

async function thumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Plain text if the bytes look like text, otherwise null. */
async function readAsText(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  if (head.includes(0)) return null;
  return file.text();
}

export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name || "pasted file";
  const lower = name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 30 MB.");
  if (file.size === 0) throw new Error("File is empty.");

  if (IMAGE_TYPES.test(file.type) || IMAGE_EXTENSIONS.test(lower)) {
    const { text, preview } = await readImage(file);
    return finish(name, "image", text, preview);
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    return finish(name, "document", await readPdf(file));
  }
  if (lower.endsWith(".docx")) return finish(name, "document", await readDocx(file));
  if (lower.endsWith(".xlsx")) return finish(name, "document", await readXlsx(file));
  if (/\.(doc|xls|ppt|pptx|pages|numbers|key)$/.test(lower)) {
    throw new Error("This format is not supported. Save it as PDF, DOCX or XLSX.");
  }
  if (file.type.startsWith("image/")) {
    throw new Error("This image format is not supported. Use PNG or JPEG.");
  }

  const text = await readAsText(file);
  if (text === null) throw new Error("This file type is not supported.");
  if (!text.trim()) throw new Error("File is empty.");
  return finish(name, "document", text);
}
