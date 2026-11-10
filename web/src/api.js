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
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: "Bearer " + token.get(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  status: () => j("GET", "/api/status"),
  enter: (b) => j("POST", "/api/auth/enter", b),
  dialogs: () => j("GET", "/api/tg/dialogs"),
  connect: (link) => j("POST", "/api/tg/connect", { link }),
  saveChannel: (channel_id) => j("POST", "/api/user/channel", { channel_id }),
  children: (id) => j("GET", `/api/nodes/${id}/children`),
  mkdir: (parentId, name) => j("POST", "/api/folders", { parentId, name }),
  rename: (id, name) => j("PATCH", `/api/nodes/${id}`, { name }),
  move: (id, parentId) => j("PATCH", `/api/nodes/${id}`, { parentId }),
  del: (id) => j("DELETE", `/api/nodes/${id}`),
  search: (q) => j("GET", `/api/search?q=${encodeURIComponent(q)}`),
  createUpload: (b) => j("POST", "/api/uploads", b),
  completeUpload: (id) => j("POST", `/api/uploads/${id}/complete`),
  abortUpload: (id) => j("DELETE", `/api/uploads/${id}`),
  share: (id) => j("POST", `/api/nodes/${id}/share`),
  syncTelegram: (limit = 1000, channelId = null) => j("POST", "/api/tg/sync", { limit, channelId }),
  autoOrganize: (folderId) => j("POST", `/api/folders/${folderId}/auto-organize`),
  folderTree: () => j("GET", "/api/folders/tree"),
  batchMove: (ids, targetParentId) => j("POST", "/api/nodes/move", { ids, targetParentId }),
  getDropLinks: (folderId) => j("GET", `/api/folders/${folderId}/drop-links`),
  createDropLink: (folderId, b) => j("POST", `/api/folders/${folderId}/drop-links`, b),
  updateDropLink: (id, b) => j("PATCH", `/api/drop-links/${id}`, b),
  deleteDropLink: (id) => j("DELETE", `/api/drop-links/${id}`),
  ping: () => j("GET", "/api/ping"),
  keepAlive: () => j("GET", "/api/keep-alive"),
  triggerPing: () => j("POST", "/api/keep-alive", { action: "ping" }),
  updateKeepAlive: (b) => j("POST", "/api/keep-alive", b),
  getDropInfo: async (code) => {
    const res = await fetch(`/api/drop/${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Drop link not found or inactive");
    return data;
  },
  verifyDropPassword: async (code, password) => {
    const res = await fetch(`/api/drop/${encodeURIComponent(code)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Incorrect password or PIN");
    return data;
  },
  fileUrl: (id, dl = false) =>
    `/api/files/${id}/content?t=${encodeURIComponent(token.get())}${dl ? "&dl=1" : ""}`,
  folderZipUrl: (id) => `/api/folders/${id}/download?t=${encodeURIComponent(token.get())}`,
  downloadBlob: async (url) => {
    const res = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token.get(),
      },
    });
    if (!res.ok) {
      let msg = "Download failed";
      try {
        const data = await res.json();
        msg = data.error || msg;
      } catch (_) {
        msg = `${res.status} ${res.statusText}`;
      }
      throw new Error(msg);
    }
    return await res.blob();
  },
};

function putPart(uploadId, idx, blob, onProgress, handle) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    handle.xhr = x;
    x.open("PUT", `/api/uploads/${uploadId}/parts/${idx}`);
    x.setRequestHeader("Authorization", "Bearer " + token.get());
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
export async function uploadFile(file, parentId, onProgress, handle = {}) {
  const { id, chunkSize } = await api.createUpload({
    name: file.name, size: file.size, mime: file.type || null, parentId,
  });
  handle.uploadId = id;
  const parts = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize);
  let done = 0;
  try {
    for (let i = 0; i < parts; i++) {
      if (handle.cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      let attempt = 0;
      for (;;) {
        try {
          await putPart(id, i, blob, (loaded) =>
            onProgress({ loaded: done + loaded, total: file.size, part: i + 1, parts }), handle);
          break;
        } catch (e) {
          if (e.cancelled || ++attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * attempt)); // retry part
        }
      }
      done += blob.size;
      onProgress({ loaded: done, total: file.size, part: i + 1, parts });
    }
    return await api.completeUpload(id);
  } catch (e) {
    api.abortUpload(id).catch(() => {});
    throw e;
  }
}

function putDropPart(code, ticket, uploadId, idx, blob, onProgress, handle) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    handle.xhr = x;
    x.open("PUT", `/api/drop/${encodeURIComponent(code)}/uploads/${uploadId}/parts/${idx}`);
    x.setRequestHeader("X-Drop-Ticket", ticket);
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

export async function uploadFileToDrop(code, ticket, file, onProgress, handle = {}) {
  const res = await fetch(`/api/drop/${encodeURIComponent(code)}/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Drop-Ticket": ticket,
    },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      mime: file.type || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to start upload");
  const { id, chunkSize } = data;
  handle.uploadId = id;
  const parts = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize);
  let done = 0;
  try {
    for (let i = 0; i < parts; i++) {
      if (handle.cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      let attempt = 0;
      for (;;) {
        try {
          await putDropPart(code, ticket, id, i, blob, (loaded) =>
            onProgress({ loaded: done + loaded, total: file.size, part: i + 1, parts }), handle);
          break;
        } catch (e) {
          if (e.cancelled || ++attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      done += blob.size;
      onProgress({ loaded: done, total: file.size, part: i + 1, parts });
    }
    const compRes = await fetch(`/api/drop/${encodeURIComponent(code)}/uploads/${id}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Drop-Ticket": ticket,
      },
    });
    const compData = await compRes.json().catch(() => ({}));
    if (!compRes.ok) throw new Error(compData.error || "Failed to complete upload");
    return compData.node;
  } catch (e) {
    fetch(`/api/drop/${encodeURIComponent(code)}/uploads/${id}`, {
      method: "DELETE",
      headers: { "X-Drop-Ticket": ticket },
    }).catch(() => {});
    throw e;
  }
}
