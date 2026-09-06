import { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const archiver = require("archiver");
import bcrypt from "bcryptjs";
import { cfg } from "./config.js";
import {
  db, q, now, uid, getNode, breadcrumb, children, subtreeIds,
  isAncestor, uniqueName, createFileNode, createShare, getShare,
} from "./db.js";
import { sign, auth } from "./auth.js";
import {
  tg, sendDocument, deleteMessages, streamRange, connectByLink, listDialogs,
} from "./telegram.js";

export const api = Router();
const bad = (res, code, error) => res.status(code).json({ error });

/* ---------------------------------------------------------------- status */

api.get("/status", (_req, res) => {
  res.json({
    telegram: tg.ready ? "connected" : "offline",
    mode: tg.mode,
    channel: tg.channel?.title || null,
    error: tg.error,
    chunkBytes: cfg.chunkBytes,
    users: q(`SELECT COUNT(*) c FROM users`).get().c,
    inviteRequired: !!cfg.inviteCode,
  });
});

/* ------------------------------------------------------------------ auth */
// One door, no signup: a known @handle signs in, an unknown one is claimed
// on the spot (invite-gated for everyone after the first user, if set).

api.post("/auth/enter", async (req, res) => {
  const { password, invite } = req.body || {};
  const handle = String(req.body?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(handle))
    return bad(res, 400, "handle: 3–32 letters, digits or _");
  if (!password || password.length < 6)
    return bad(res, 400, "password: at least 6 characters");

  const user = q(`SELECT * FROM users WHERE handle=?`).get(handle);
  if (user) {
    if (!(await bcrypt.compare(password, user.pass_hash)))
      return bad(res, 401, `wrong password for @${handle}`);
    return res.json({ token: sign(user), user: { id: user.id, handle } });
  }

  const count = q(`SELECT COUNT(*) c FROM users`).get().c;
  if (count > 0 && cfg.inviteCode && invite !== cfg.inviteCode)
    return bad(res, 403, `@${handle} is new here — invite code required`);
  const u = { id: uid(), handle, pass_hash: await bcrypt.hash(password, 10), created_at: now() };
  q(`INSERT INTO users(id,handle,pass_hash,created_at) VALUES (?,?,?,?)`)
    .run(u.id, u.handle, u.pass_hash, u.created_at);
  res.json({ token: sign(u), user: { id: u.id, handle }, created: true });
});

/* ------------------------------------------------------- storage linking */

api.get("/tg/dialogs", auth, async (_req, res) => {
  try {
    res.json({ dialogs: await listDialogs(), mode: tg.mode });
  } catch (e) {
    bad(res, e.status || 500, e.errorMessage || e.message);
  }
});

api.post("/tg/connect", auth, async (req, res) => {
  try {
    res.json(await connectByLink(req.body?.link));
  } catch (e) {
    bad(res, e.status || 500, e.errorMessage || e.message);
  }
});

/* ------------------------------------------------------ virtual filesystem */

api.get("/nodes/:id/children", auth, (req, res) => {
  const folder = getNode(req.params.id);
  if (!folder || folder.type !== "folder") return bad(res, 404, "folder not found");
  res.json({ folder, breadcrumb: breadcrumb(folder.id), children: children(folder.id, req.user.id) });
});

api.post("/folders", auth, (req, res) => {
  const { parentId, name } = req.body || {};
  const parent = getNode(parentId);
  if (!parent || parent.type !== "folder") return bad(res, 404, "parent not found");
  const clean = String(name || "").trim().replace(/[/\\]/g, "-");
  if (!clean) return bad(res, 400, "name required");
  const id = uid();
  q(`INSERT INTO nodes(id,parent_id,name,type,size,owner_id,created_at,updated_at)
     VALUES (?,?,?,?,0,?,?,?)`)
    .run(id, parentId, uniqueName(parentId, clean, req.user.id), "folder", req.user.id, now(), now());
  res.json(getNode(id));
});

api.patch("/nodes/:id", auth, (req, res) => {
  const node = getNode(req.params.id);
  if (!node || node.id === "root") return bad(res, 404, "not found");
  const { name, parentId } = req.body || {};

  if (parentId !== undefined && parentId !== node.parent_id) {
    const target = getNode(parentId);
    if (!target || target.type !== "folder") return bad(res, 404, "target folder not found");
    if (node.type === "folder" && isAncestor(node.id, target.id))
      return bad(res, 400, "cannot move a folder into itself");
    q(`UPDATE nodes SET parent_id=?, name=?, updated_at=? WHERE id=?`)
      .run(target.id, uniqueName(target.id, node.name, req.user.id), now(), node.id);
  }
  if (name !== undefined) {
    const clean = String(name).trim().replace(/[/\\]/g, "-");
    if (!clean) return bad(res, 400, "name required");
    const fresh = getNode(node.id);
    q(`UPDATE nodes SET name=?, updated_at=? WHERE id=?`)
      .run(uniqueName(fresh.parent_id, clean, req.user.id), now(), node.id);
  }
  res.json(getNode(node.id));
});

// Permanent delete: DB rows + the backing Telegram messages.
api.delete("/nodes/:id", auth, async (req, res) => {
  const node = getNode(req.params.id);
  if (!node || node.id === "root") return bad(res, 404, "not found");
  const ids = subtreeIds(node.id);
  const ph = ids.map(() => "?").join(",");
  const msgIds = q(`SELECT msg_id FROM chunks WHERE file_id IN (${ph})`)
    .all(...ids).map((r) => r.msg_id);
  db.transaction(() => {
    q(`DELETE FROM chunks WHERE file_id IN (${ph})`).run(...ids);
    q(`DELETE FROM nodes WHERE id IN (${ph})`).run(...ids);
  })();
  deleteMessages(msgIds); // fire-and-forget, batched
  res.json({ ok: true, removed: ids.length, telegramMessages: msgIds.length });
});

api.get("/search", auth, (req, res) => {
  const term = String(req.query.q || "").trim();
  if (!term) return res.json({ results: [] });
  const results = q(
    `SELECT id,parent_id,name,type,size,mime,updated_at FROM nodes
     WHERE name LIKE ? AND id != 'root' AND (owner_id=? OR owner_id IS NULL)
     ORDER BY type='folder' DESC, name COLLATE NOCASE LIMIT 100`
  ).all(`%${term}%`, req.user.id);
  res.json({ results });
});

api.post("/nodes/:id/share", auth, (req, res) => {
  const node = getNode(req.params.id);
  if (!node || node.type !== "file") return bad(res, 404, "file not found");
  const shareId = createShare(node.id);
  res.json({ shareId });
});

/* -------------------------------------------------------- chunked uploads */
// Browser slices the File into <= chunkBytes parts. Each part is PUT as a
// raw body -> temp file on disk -> one Telegram message. `complete` stitches
// the message ids into a file node. Memory use stays flat regardless of size.

api.post("/uploads", auth, (req, res) => {
  const { name, size, mime, parentId } = req.body || {};
  const parent = getNode(parentId);
  if (!parent || parent.type !== "folder") return bad(res, 404, "parent not found");
  if (!name || !(Number.isFinite(size) && size >= 0))
    return bad(res, 400, "name and size required");
  const id = uid();
  q(`INSERT INTO uploads(id,name,parent_id,size,mime,chunk_size,user_id,created_at)
     VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, String(name), parentId, size, mime || null, cfg.chunkBytes, req.user.id, now());
  res.json({ id, chunkSize: cfg.chunkBytes });
});

api.put("/uploads/:id/parts/:idx", auth, async (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage offline");
  const idx = Number(req.params.idx);
  const totalParts = Math.max(1, Math.ceil(up.size / up.chunk_size));
  if (!(idx >= 0 && idx < totalParts)) return bad(res, 400, "part index out of range");

  const tmp = path.join(cfg.dataDir, "tmp", `${up.id}.${idx}`);
  try {
    let received = 0;
    req.on("data", (d) => (received += d.length));
    await pipeline(req, fs.createWriteStream(tmp));
    if (received === 0) return bad(res, 400, "empty part");

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption = `tm1;f=${up.name.slice(0, 200)};p=${idx + 1}/${totalParts}`;
    const msgId = await sendDocument(tmp, partName, caption);

    // Retried part? Drop the superseded Telegram message.
    const prev = q(`SELECT msg_id FROM upload_parts WHERE upload_id=? AND idx=?`)
      .get(up.id, idx);
    if (prev) deleteMessages([prev.msg_id]);
    q(`INSERT OR REPLACE INTO upload_parts(upload_id,idx,msg_id,size) VALUES (?,?,?,?)`)
      .run(up.id, idx, msgId, received);
    res.json({ msgId, size: received });
  } catch (e) {
    console.error("[upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

api.post("/uploads/:id/complete", auth, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  const parts = q(`SELECT * FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(up.id);
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);
  if (parts.length !== expected || total !== up.size)
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);

  const node = createFileNode({
    parentId: up.parent_id, name: up.name, size: up.size,
    mime: up.mime, ownerId: up.user_id, parts,
  });
  db.transaction(() => {
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`DELETE FROM uploads WHERE id=?`).run(up.id);
  })();
  res.json(node);
});

api.delete("/uploads/:id", auth, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  const msgIds = q(`SELECT msg_id FROM upload_parts WHERE upload_id=?`)
    .all(up.id).map((r) => r.msg_id);
  db.transaction(() => {
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`DELETE FROM uploads WHERE id=?`).run(up.id);
  })();
  deleteMessages(msgIds);
  res.json({ ok: true });
});

/* ------------------------------------------------------- ranged downloads */
// Full HTTP Range support across chunk boundaries -> video seeking works.

async function serveNodeContent(req, res, node) {
  if (!node || node.type !== "file") return bad(res, 404, "file not found");
  const chunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(node.id);
  const total = node.size;

  let start = 0, end = Math.max(total - 1, 0), status = 200;
  const range = req.headers.range;
  if (range && total > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Number(m[2]) : total - 1; }
      else { start = Math.max(total - Number(m[2]), 0); end = total - 1; }
      end = Math.min(end, total - 1);
      if (start > end || start >= total)
        return res.status(416).set("Content-Range", `bytes */${total}`).end();
      status = 206;
    }
  }

  res.status(status).set({
    "Accept-Ranges": "bytes",
    "Content-Type": node.mime || "application/octet-stream",
    "Content-Length": String(total === 0 ? 0 : end - start + 1),
    "Content-Disposition":
      `${req.query.dl === "1" ? "attachment" : "inline"}; ` +
      `filename*=UTF-8''${encodeURIComponent(node.name)}`,
  });
  if (status === 206) res.set("Content-Range", `bytes ${start}-${end}/${total}`);
  if (req.method === "HEAD" || total === 0) return res.end();

  let closed = false;
  res.on("close", () => (closed = true));
  try {
    let pos = 0;
    for (const c of chunks) {
      const cStart = pos, cEnd = pos + c.size - 1;
      pos += c.size;
      if (cEnd < start) continue;
      if (cStart > end) break;
      await streamRange(
        c.msg_id,
        Math.max(start - cStart, 0),
        Math.min(end - cStart, c.size - 1),
        async (buf) => {
          if (closed) return false;
          if (!res.write(buf)) await once(res, "drain");
          return !closed;
        }
      );
      if (closed) break;
    }
  } catch (e) {
    console.error("[download]", e.message);
  }
  res.end();
}

api.get("/files/:id/content", auth, async (req, res) => {
  serveNodeContent(req, res, getNode(req.params.id));
});

api.get("/share/:id/content", async (req, res) => {
  const share = getShare(req.params.id);
  if (!share) return bad(res, 404, "share link not found");
  serveNodeContent(req, res, getNode(share.file_id));
});

api.get("/folders/:id/download", auth, async (req, res) => {
  const rootFolder = getNode(req.params.id);
  if (!rootFolder || rootFolder.type !== "folder") return bad(res, 404, "folder not found");
  
  res.status(200).set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rootFolder.name)}.zip`,
  });

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (err) => console.error("[zip error]", err));
  archive.pipe(res);

  let closed = false;
  res.on("close", () => (closed = true));

  async function addFolder(folderId, basePath) {
    if (closed) return;
    const folderChildren = children(folderId, req.user.id);
    for (const child of folderChildren) {
      if (closed) return;
      const childPath = basePath ? `${basePath}/${child.name}` : child.name;
      
      if (child.type === "folder") {
        archive.append("", { name: childPath + "/" });
        await addFolder(child.id, childPath);
      } else {
        const fileChunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(child.id);
        const { PassThrough } = await import("node:stream");
        const pt = new PassThrough();
        
        archive.append(pt, { name: childPath });
        
        try {
          for (const c of fileChunks) {
            if (closed) break;
            if (c.size > 0) {
              await streamRange(c.msg_id, 0, c.size - 1, async (buf) => {
                if (!pt.write(buf)) await once(pt, "drain");
                return !closed;
              });
            }
          }
        } catch (e) {
          console.error("[zip stream]", e.message);
        }
        pt.end();
      }
    }
  }

  try {
    await addFolder(rootFolder.id, "");
  } finally {
    archive.finalize();
  }
});

