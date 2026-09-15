export const token = {
  get: () => localStorage.getItem("tm_token") || "",
  set: (t) => localStorage.setItem("tm_token", t),
  clear: () => localStorage.removeItem("tm_token"),
};
export const savedUser = {
  get: () => { try { return JSON.parse(localStorage.getItem("tm_user")); } catch { return null; } },
  set: (u) => localStorage.setItem("tm_user", JSON.stringify(u)),
  clear: () => localStorage.removeItem("tm_user"),
};

async function j(method, url, body) {
  const legacyToken = token.get();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(legacyToken ? { Authorization: "Bearer " + legacyToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  publicStatus: () => j("GET", "/api/public-status"),
  status: () => j("GET", "/api/status"),
  enter: (b) => j("POST", "/api/auth/enter", b),
  me: () => j("GET", "/api/auth/me"),
  logout: () => j("POST", "/api/auth/logout"),
  createPairing: () => j("POST", "/api/tg/pair"),
  children: (id) => j("GET", `/api/nodes/${id}/children`),
  mkdir: (parentId, name) => j("POST", "/api/folders", { parentId, name }),
  rename: (id, name) => j("PATCH", `/api/nodes/${id}`, { name }),
  move: (id, parentId) => j("PATCH", `/api/nodes/${id}`, { parentId }),
  del: (id) => j("DELETE", `/api/nodes/${id}`),
  trash: () => j("GET", "/api/trash"),
  restore: (id) => j("POST", `/api/trash/${id}/restore`),
  purge: (id) => j("DELETE", `/api/trash/${id}`),
  emptyTrash: () => j("DELETE", "/api/trash"),
  search: (q) => j("GET", `/api/search?q=${encodeURIComponent(q)}`),
  uploads: () => j("GET", "/api/uploads"),
  upload: (id) => j("GET", `/api/uploads/${id}`),
  createUpload: (b) => j("POST", "/api/uploads", b),
  completeUpload: (id) => j("POST", `/api/uploads/${id}/complete`),
  abortUpload: (id) => j("DELETE", `/api/uploads/${id}`),
  share: (id) => j("POST", `/api/nodes/${id}/share`),
  fileUrl: (id, dl = false) => `/api/files/${id}/content${dl ? "?dl=1" : ""}`,
  folderZipUrl: (id) => `/api/folders/${id}/download`,
};

function putPart(uploadId, idx, blob, onProgress, handle) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    handle.xhr = x;
    x.open("PUT", `/api/uploads/${uploadId}/parts/${idx}`);
    const legacyToken = token.get();
    if (legacyToken) x.setRequestHeader("Authorization", "Bearer " + legacyToken);
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      if (x.status < 300) resolve();
      else {
        let msg = "part upload failed";
        try { msg = JSON.parse(x.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    x.onerror = () => reject(new Error("network error"));
    x.onabort = () => reject(Object.assign(new Error("cancelled"), { cancelled: true }));
    x.send(blob);
  });
}

/**
 * Slice the file client-side and ship parts sequentially.
 * onProgress({loaded,total,part,parts}); handle.cancel() aborts + cleans up.
 */
export async function uploadFile(file, parentId, onProgress, handle = {}, existing = null) {
  const session = existing || await api.createUpload({
    name: file.name, size: file.size, mime: file.type || null, parentId,
    lastModified: file.lastModified,
  });
  const { id, chunkSize } = session;
  handle.uploadId = id;
  const parts = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize);
  const stored = new Set((session.parts || []).map((part) => part.idx));
  let done = (session.parts || []).reduce((sum, part) => sum + part.size, 0);
  onProgress({ loaded: done, total: file.size, part: stored.size, parts });
  try {
    for (let i = 0; i < parts; i++) {
      if (handle.cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      if (stored.has(i)) continue;
      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      let attempt = 0;
      for (;;) {
        try {
          await putPart(id, i, blob, (loaded) =>
            onProgress({ loaded: done + loaded, total: file.size, part: i + 1, parts }), handle);
          break;
        } catch (e) {
          if (e.cancelled || ++attempt >= 5) throw e;
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
        }
      }
      done += blob.size;
      onProgress({ loaded: done, total: file.size, part: i + 1, parts });
    }
    return await api.completeUpload(id);
  } catch (e) {
    // Keep successfully stored parts on the server. The user can retry now or
    // reselect the file after a refresh; only explicit cancellation discards it.
    throw e;
  }
}
