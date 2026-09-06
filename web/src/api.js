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
  fileUrl: (id, dl = false) =>
    `/api/files/${id}/content?t=${encodeURIComponent(token.get())}${dl ? "&dl=1" : ""}`,
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
