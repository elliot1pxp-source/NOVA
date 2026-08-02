/**
 * MIME types accepted by the current model provider's file-input guidance.
 * Video is deliberately not supported in NOVA (including video/mp4).
 * Extended to support common programming language source files.
 */

export const MAX_NON_IMAGE_SIZE_MB = 5;
export const MAX_NON_IMAGE_SIZE_BYTES = MAX_NON_IMAGE_SIZE_MB * 1024 * 1024;

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
  // Original supported extensions
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

  // === Programming & scripting languages (all text/plain) ===
  // C / C++
  c: "text/plain",
  cpp: "text/plain",
  cxx: "text/plain",
  cc: "text/plain",
  h: "text/plain",
  hpp: "text/plain",
  hh: "text/plain",

  // Java (source only, no .class)
  java: "text/plain",

  // Python
  py: "text/plain",

  // Ruby
  rb: "text/plain",

  // PHP
  php: "text/plain",

  // Perl
  pl: "text/plain",
  pm: "text/plain",
  perl: "text/plain",

  // Lua
  lua: "text/plain",

  // R
  r: "text/plain",

  // Shell scripts
  sh: "text/plain",
  bash: "text/plain",
  zsh: "text/plain",
  fish: "text/plain",
  ps1: "text/plain", // PowerShell

  // Groovy / Gradle
  groovy: "text/plain",
  gradle: "text/plain",

  // Scala
  scala: "text/plain",

  // Go
  go: "text/plain",

  // Rust
  rs: "text/plain",

  // Swift
  swift: "text/plain",

  // Kotlin
  kt: "text/plain",
  kts: "text/plain", // Kotlin script

  // Dart
  dart: "text/plain",

  // Nim
  nim: "text/plain",

  // Zig
  zig: "text/plain",

  // V
  v: "text/plain",

  // D
  d: "text/plain",

  // Crystal
  cr: "text/plain",

  // OCaml
  ml: "text/plain",

  // Haskell
  hs: "text/plain",

  // Elm
  elm: "text/plain",

  // Clojure
  clj: "text/plain",
  cljs: "text/plain",
  edn: "text/plain",

  // Erlang
  erl: "text/plain",
  hrl: "text/plain",

  // Elixir
  ex: "text/plain",
  exs: "text/plain",

  // F#
  fs: "text/plain",
  fsx: "text/plain",
  fsproj: "text/plain",

  // TypeScript / JavaScript frameworks
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  vue: "text/plain",
  svelte: "text/plain",

  // CSS preprocessors
  scss: "text/plain",
  sass: "text/plain",
  less: "text/plain",

  // Configuration & data
  yaml: "text/plain",
  yml: "text/plain",
  toml: "text/plain",
  ini: "text/plain",
  cfg: "text/plain",
  conf: "text/plain",
  properties: "text/plain",
  sql: "text/plain",
  log: "text/plain",

  // Environment / build files
  env: "text/plain",
  dockerfile: "text/plain",
  makefile: "text/plain",
  cmake: "text/plain",
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
    "text/x-go": "text/plain",
    "text/x-python": "text/plain",
    "text/x-java": "text/plain",
    "text/x-c": "text/plain",
    "text/x-c++": "text/plain",
    "text/x-ruby": "text/plain",
    "text/x-perl": "text/plain",
    "text/x-php": "text/plain",
    "text/x-typescript": "text/plain",
    "text/x-rust": "text/plain",
    "text/x-swift": "text/plain",
    "text/x-kotlin": "text/plain",
    "text/x-scala": "text/plain",
    "text/x-dart": "text/plain",
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

  // Some browsers report an empty, generic, or non-standard MIME type for
  // otherwise valid source code documents (e.g. text/x-python, text/x-java,
  // text/x-typescript). Fall back to the known filename extension in that
  // case — if the extension maps to a supported type, accept it.
  return mimeTypeFromFilename(filename);
}

function getAttachmentMimeType(part: { mediaType?: string; mimeType?: string }) {
  return part.mediaType ?? part.mimeType;
}

export function normalizeAttachmentForModel<
  T extends { mediaType?: string; mimeType?: string; filename?: string }
>(part: T): T {
  const mimeType = getAttachmentMimeType(part);
  const supportedMimeType = getSupportedAttachmentMimeType({
    mimeType,
    filename: part.filename,
  });

  if (!supportedMimeType || supportedMimeType === mimeType) {
    return part;
  }

  return {
    ...part,
    mediaType: supportedMimeType,
    mimeType: supportedMimeType,
  } as T;
}

export function isSupportedAttachment(file: { mimeType?: string; filename?: string }) {
  return Boolean(getSupportedAttachmentMimeType(file));
}

export function isImageMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  const normalized = normalizedMimeType(mimeType);
  return normalized.startsWith("image/");
}

export function validateFileSize(file: { size: number; type?: string; name?: string }): {
  valid: boolean;
  error?: string;
} {
  const mimeType = getSupportedAttachmentMimeType({
    mimeType: file.type,
    filename: file.name,
  });
  if (!mimeType) {
    return { valid: false, error: `Unsupported file type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}` };
  }
  if (!isImageMimeType(mimeType) && file.size > MAX_NON_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File too large. Non-image files are limited to ${MAX_NON_IMAGE_SIZE_MB}MB.`,
    };
  }
  return { valid: true };
}

export const SUPPORTED_ATTACHMENT_DESCRIPTION =
  "PDF, TXT, Markdown, HTML, CSS, XML, CSV, RTF, JavaScript, JSON, BMP, JPEG, PNG, WebP, " +
  "and source code files (Java, Python, C, C++, Ruby, Go, Rust, Swift, Kotlin, PHP, Perl, Scala, " +
  "TypeScript, Dart, and many others). Video (MP4), audio (MP3), archives (ZIP), executables (EXE, APK), " +
  "and Java bytecode (.class) are not supported.";

/**
 * Rewrites the MIME type in a data URL header to the given normalized type.
 * The AI SDK's convertToModelMessages reads the MIME type from the data URL
 * itself rather than from the explicitly-provided mediaType, so we need to
 * ensure the URL reflects the normalized type.
 *
 * Returns the original data URL unchanged if no rewrite is needed.
 */
export function normalizeDataUrl(
  dataUrl: string,
  normalizedMimeType: string
): string {
  const match = dataUrl.match(/^data:([^;]+);/);
  if (!match) return dataUrl;

  const originalMime = match[1];
  if (originalMime === normalizedMimeType) return dataUrl;

  return dataUrl.replace(/^data:[^;]+;/, `data:${normalizedMimeType};`);
}
