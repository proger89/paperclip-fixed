const WINDOWS_1251_EXTENDED_CHARS = [
  "\u0402",
  "\u0403",
  "\u201A",
  "\u0453",
  "\u201E",
  "\u2026",
  "\u2020",
  "\u2021",
  "\u20AC",
  "\u2030",
  "\u0409",
  "\u2039",
  "\u040A",
  "\u040C",
  "\u040B",
  "\u040F",
  "\u0452",
  "\u2018",
  "\u2019",
  "\u201C",
  "\u201D",
  "\u2022",
  "\u2013",
  "\u2014",
  "\u0098",
  "\u2122",
  "\u0459",
  "\u203A",
  "\u045A",
  "\u045C",
  "\u045B",
  "\u045F",
  "\u00A0",
  "\u040E",
  "\u045E",
  "\u0408",
  "\u00A4",
  "\u0490",
  "\u00A6",
  "\u00A7",
  "\u0401",
  "\u00A9",
  "\u0404",
  "\u00AB",
  "\u00AC",
  "\u00AD",
  "\u00AE",
  "\u0407",
  "\u00B0",
  "\u00B1",
  "\u0406",
  "\u0456",
  "\u0491",
  "\u00B5",
  "\u00B6",
  "\u00B7",
  "\u0451",
  "\u2116",
  "\u0454",
  "\u00BB",
  "\u0458",
  "\u0405",
  "\u0455",
  "\u0457",
  ...Array.from({ length: 32 }, (_, index) => String.fromCodePoint(0x0410 + index)),
  ...Array.from({ length: 32 }, (_, index) => String.fromCodePoint(0x0430 + index)),
] as const;

const WINDOWS_1251_BYTE_TO_CHAR = new Map<number, string>(
  WINDOWS_1251_EXTENDED_CHARS.map((char, index) => [0x80 + index, char]),
);

const WINDOWS_1251_CHAR_TO_BYTE = new Map<string, number>([
  ...Array.from({ length: 0x80 }, (_, byte) => [String.fromCharCode(byte), byte] as const),
  ...WINDOWS_1251_EXTENDED_CHARS.map((char, index) => [char, 0x80 + index] as const),
]);

export function normalizeWindowsEncodingLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function normalizeWindowsEncodingSignaturePunctuation(text: string): string {
  return text
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/gu, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, "\"")
    .replace(/\u2026/gu, "...");
}

export function buildWindowsEncodingPlaceholderSignature(text: string): string {
  return normalizeWindowsEncodingSignaturePunctuation(normalizeWindowsEncodingLineEndings(text)).replace(
    /[^\x00-\x7F]/gu,
    "?",
  );
}

export function isLikelyWindowsEncodingCorruption(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text.includes("\uFFFD")) return true;

  const normalized = normalizeWindowsEncodingLineEndings(text);
  if (/\?{4,}/.test(normalized)) return true;

  const visibleChars = Array.from(normalized).filter((char) => !/\s/u.test(char)).length;
  if (visibleChars === 0) return false;

  const questionMarks = (normalized.match(/\?/g) ?? []).length;
  return questionMarks >= 6 && questionMarks / visibleChars >= 0.2;
}

export function normalizeCorruptedDocumentTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") return title ?? null;
  const trimmed = title.trim();
  if (!trimmed) return title;
  return /^[?\uFFFD]+$/u.test(trimmed) ? null : title;
}

function decodeWindows1251Bytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => WINDOWS_1251_BYTE_TO_CHAR.get(byte) ?? String.fromCharCode(byte)).join("");
}

function encodeWindows1251Bytes(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of text) {
    const byte = WINDOWS_1251_CHAR_TO_BYTE.get(char);
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

export function buildWindows1251Utf8Mojibake(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  return decodeWindows1251Bytes(Buffer.from(text, "utf8"));
}

export function recoverWindows1251Utf8Mojibake(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const bytes = encodeWindows1251Bytes(text);
  if (!bytes) return null;

  const recovered = Buffer.from(bytes).toString("utf8");
  if (recovered === text || recovered.includes("\uFFFD")) return null;

  const normalizedRecovered = normalizeWindowsEncodingLineEndings(recovered);
  if (isLikelyWindowsEncodingCorruption(normalizedRecovered)) return null;

  const recoveredCyrillicCount = (normalizedRecovered.match(/[А-Яа-яЁё]/gu) ?? []).length;
  return recoveredCyrillicCount > 0 ? normalizedRecovered : null;
}

export function previewWindowsEncodingValue(text: string | null | undefined, maxLength = 120): string | null {
  if (typeof text !== "string") return null;
  const normalized = normalizeWindowsEncodingLineEndings(text).replace(/\n/g, "\\n");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}
