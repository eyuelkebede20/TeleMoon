import test from "node:test";
import assert from "node:assert/strict";
import { readableBytes, uploadCaption } from "../src/caption.js";

test("formats file sizes for people", () => {
  assert.equal(readableBytes(1), "1 byte");
  assert.equal(readableBytes(900), "900 bytes");
  assert.equal(readableBytes(1536), "1.50 KB");
  assert.equal(readableBytes(1572864000), "1.46 GB");
});

test("upload captions preserve the protocol and explain the part", () => {
  const caption = uploadCaption({
    name: "summer;\ntrip.mov",
    part: 2,
    totalParts: 4,
    partSize: 1572864000,
  });

  assert.ok(caption.startsWith("tm1;f=summer trip.mov;p=2/4\n"));
  assert.match(caption, /🌙 Stored by TeleMoon/);
  assert.match(caption, /File: summer trip\.mov/);
  assert.match(caption, /Part: 2 of 4/);
  assert.match(caption, /Size: 1\.46 GB/);
});
