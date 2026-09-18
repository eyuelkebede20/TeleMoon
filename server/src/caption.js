const compactFileName = (name) =>
  String(name || "file")
    .replace(/[\r\n;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "file";

export function readableBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

/**
 * Keep the first line stable: it is how the indexer recognizes messages that
 * belong to TeleMoon. Everything after it is written for the channel owner.
 */
export function uploadCaption({ name, part, totalParts, partSize }) {
  const fileName = compactFileName(name);
  return [
    `tm1;f=${fileName};p=${part}/${totalParts}`,
    "",
    "🌙 Stored by TeleMoon",
    `File: ${fileName}`,
    `Part: ${part} of ${totalParts}`,
    `Size: ${readableBytes(partSize)}`,
    "Keep this message—it contains part of your file.",
  ].join("\n");
}
