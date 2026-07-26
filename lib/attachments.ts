/**
 * MIME types accepted by the Gemini API's current file-input guidance.
 * Video is deliberately not supported in NOVA (including video/mp4).
 */
export const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/rtf",
  "text/xml",
]);

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  bmp: "image/bmp",
  css: "text/css",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  rtf: "text/rtf",
  text: "text/plain",
  txt: "text/plain",
  webp: "image/webp",
  xml: "text/xml",
};

export const SUPPORTED_ATTACHMENT_ACCEPT = [
  ...SUPPORTED_ATTACHMENT_MIME_TYPES,
  ...Object.keys(EXTENSION_TO_MIME_TYPE).map((extension) => `.${extension}`),
].join(",");

function normalizedMimeType(mimeType: string | undefined) {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const aliases: Record<string, string> = {
    "application/javascript": "text/javascript",
    "application/rtf": "text/rtf",
    "application/x-rtf": "text/rtf",
    "image/jpg": "image/jpeg",
  };
  return aliases[normalized] ?? normalized;
}

function mimeTypeFromFilename(filename: string | undefined) {
  const extension = filename?.split(".").pop()?.toLowerCase();
  return extension ? EXTENSION_TO_MIME_TYPE[extension] : undefined;
}

export function getSupportedAttachmentMimeType({
  mimeType,
  filename,
}: {
  mimeType?: string;
  filename?: string;
}) {
  const normalized = normalizedMimeType(mimeType);
  if (SUPPORTED_ATTACHMENT_MIME_TYPES.has(normalized)) return normalized;

  // Some browsers report an empty or generic MIME type for otherwise valid
  // text documents. Fall back to the known filename extension in that case.
  if (!normalized || normalized === "application/octet-stream") {
    return mimeTypeFromFilename(filename);
  }

  return undefined;
}

export function isSupportedAttachment(file: { mimeType?: string; filename?: string }) {
  return Boolean(getSupportedAttachmentMimeType(file));
}

export const SUPPORTED_ATTACHMENT_DESCRIPTION =
  "PDF, TXT, Markdown, HTML, CSS, XML, CSV, RTF, JavaScript, JSON, BMP, JPEG, PNG, or WebP. Video files, including MP4, are not supported.";
