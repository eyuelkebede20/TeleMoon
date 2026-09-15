import crypto from "node:crypto";

export const normalizePairingCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "");

export const hashPairingCode = (value) =>
  crypto.createHash("sha256").update(normalizePairingCode(value)).digest("hex");

export const newPairingCode = () =>
  `TM-PAIR-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
