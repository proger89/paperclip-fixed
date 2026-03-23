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

const MOJIBAKE_SEQUENCE_RE = /(Р[\u0080-\u04FF]|С[\u0080-\u04FF]|вЂ[\u0080-\u04FF]?|в„[\u0080-\u04FF]?|в€[\u0080-\u04FF]?)/gu;
const CYRILLIC_RE = /[А-Яа-яЁё]/gu;

const UTF8_DECODER = new TextDecoder("utf-8");

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
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

function decodeWindows1251Bytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => WINDOWS_1251_BYTE_TO_CHAR.get(byte) ?? String.fromCharCode(byte)).join("");
}

function recoverWindows1251Utf8Mojibake(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const bytes = encodeWindows1251Bytes(text);
  if (!bytes) return null;

  const recovered = UTF8_DECODER.decode(bytes);
  if (recovered === text || recovered.includes("\uFFFD")) return null;
  return normalizeLineEndings(recovered);
}

export function normalizeHighConfidenceWindowsMojibake(text: string): string {
  if (!text || text.includes("\uFFFD") || /\?{4,}/u.test(text)) return text;

  const recovered = recoverWindows1251Utf8Mojibake(text);
  if (!recovered) return text;

  const mojibakeSignals = text.match(MOJIBAKE_SEQUENCE_RE)?.length ?? 0;
  const recoveredCyrillic = recovered.match(CYRILLIC_RE)?.length ?? 0;
  if (mojibakeSignals < 2 || recoveredCyrillic < 2) return text;

  return recovered;
}

export function normalizeHighConfidenceWindowsMojibakeBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => normalizeHighConfidenceWindowsMojibake(line))
    .join("\n");
}

export function buildWindowsUtf8JsonHelperNote(): string {
  return [
    "Windows PowerShell 5.1 JSON write rule:",
    "- Do not use `Invoke-RestMethod -Body $jsonString` for issue, comment, or document mutations.",
    "- Use a UTF-8 byte body helper instead:",
    "  `function Invoke-Utf8Json($method, $uri, $obj, $headers) { $json = $obj | ConvertTo-Json -Depth 10 -Compress; $bytes = [System.Text.Encoding]::UTF8.GetBytes($json); Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes }`",
    "- For file reads and writes, always force UTF-8 explicitly: `Get-Content -Encoding utf8`, `Set-Content -Encoding utf8`, `Add-Content -Encoding utf8`, or `[System.IO.File]::ReadAllText/WriteAllText(..., [System.Text.Encoding]::UTF8)`.",
    "- Avoid bare `Get-Content`, `Set-Content`, `Add-Content`, or `Out-File` when touching non-ASCII text; PowerShell 5.1 defaults can corrupt UTF-8 files.",
    "- Prefer UTF-8 files or byte-encoded payloads over pipeline-encoded heredocs.",
  ].join("\n");
}
