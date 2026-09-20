/**
 * TeleMoon client-side chunk encryption using Web Crypto API.
 * Uses PBKDF2-HMAC-SHA256 key derivation + AES-GCM-256 with per-chunk random IVs.
 * Each chunk is self-contained: [16-byte salt][12-byte IV][AES-GCM ciphertext + auth tag]
 * This allows streaming and HTTP range seeking to continue working seamlessly.
 */

const SALT_LEN = 16;
const IV_LEN = 12;
const ITERATIONS = 100000;

export async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptChunkBlob(blob, passphrase, salt = null) {
  const chunkBuffer = await blob.arrayBuffer();
  const activeSalt = salt || crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, activeSalt);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    chunkBuffer
  );

  // Combine [salt (16b)][iv (12b)][encrypted ciphertext]
  const combined = new Uint8Array(SALT_LEN + IV_LEN + encryptedBuffer.byteLength);
  combined.set(activeSalt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(new Uint8Array(encryptedBuffer), SALT_LEN + IV_LEN);

  return {
    blob: new Blob([combined], { type: "application/octet-stream" }),
    salt: activeSalt,
  };
}

export async function decryptChunkBuffer(arrayBuffer, passphrase) {
  if (arrayBuffer.byteLength < SALT_LEN + IV_LEN + 16) {
    throw new Error("Invalid or corrupted encrypted chunk");
  }
  const salt = new Uint8Array(arrayBuffer.slice(0, SALT_LEN));
  const iv = new Uint8Array(arrayBuffer.slice(SALT_LEN, SALT_LEN + IV_LEN));
  const ciphertext = arrayBuffer.slice(SALT_LEN + IV_LEN);

  const key = await deriveKey(passphrase, salt);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
}

export async function decryptBlob(blob, passphrase) {
  const buf = await blob.arrayBuffer();
  const decrypted = await decryptChunkBuffer(buf, passphrase);
  return new Blob([decrypted]);
}

