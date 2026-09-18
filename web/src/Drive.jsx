import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, uploadFile } from "./api.js";
import {
  Crescent, MoonProgress, iconFor, UploadIcon, PlusIcon, SearchIcon,
  DownloadIcon, TrashIcon, EditIcon, XIcon, LogoutIcon, ChevR, ShareIcon,
  RestoreIcon, FolderIcon, MoveIcon,
} from "./icons.jsx";

const fmtBytes = (n) => {
  if (n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(n) / 10), u.length - 1);
  return `${(n / 2 ** (10 * i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const focusableSelector = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

function ModalShell({ title, onClose, children, className = "", initialFocusRef }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const requested = initialFocusRef?.current;
      const fallback = dialogRef.current?.querySelector(focusableSelector);
      (requested || fallback)?.focus({ preventScroll: true });
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll(focusableSelector)]
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [initialFocusRef]);

  return (
    <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={`modal-card ${className}`.trim()}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId} className="upname">{title}</h2>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close dialog">
            <XIcon />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ActionModal({ modal, onClose, onConfirm }) {
  const [val, setVal] = useState(modal.node?.name || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (modal.type === "rename" && inputRef.current) inputRef.current.select();
  }, [modal.type]);

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    if (!["remove", "purge", "emptyTrash"].includes(modal.type) && !val.trim()) return;
    setBusy(true);
    const res = await onConfirm(val.trim());
    if (res) {
      setErr(res);
      setBusy(false);
    }
  };

  const title = modal.type === "mkdir" ? "New folder"
    : modal.type === "rename" ? "Rename"
    : modal.type === "remove" ? "Move to Trash"
    : modal.type === "emptyTrash" ? "Empty Trash"
    : "Delete permanently";

  return (
    <ModalShell title={title} onClose={onClose} className="action-modal"
      initialFocusRef={["remove", "purge", "emptyTrash"].includes(modal.type) ? cancelRef : inputRef}>
        <div className="modal-body modal-form-body">
          <form className="modal-form" onSubmit={submit}>
            {["remove", "purge", "emptyTrash"].includes(modal.type) ? (
              <p className="modal-message">
                {modal.type === "remove"
                  ? <>Move "{modal.node.name}" to Trash?<br/><span className="dim modal-detail">You can restore it later.</span></>
                  : modal.type === "emptyTrash"
                    ? <>Permanently delete everything in Trash?<br/><span className="dim modal-detail">Telegram copies will also be queued for deletion. This cannot be undone.</span></>
                    : <>Permanently delete "{modal.node.name}"?<br/><span className="dim modal-detail">Its Telegram copies will also be queued for deletion. This cannot be undone.</span></>}
              </p>
            ) : (
              <label className="field-label">
                {modal.type === "mkdir" ? "Folder name" : "Name"}
                <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
                  maxLength={255} autoComplete="off" />
              </label>
            )}
            {err && <p className="auth-err" role="alert">{err}</p>}
            <div className="modal-actions">
              <button ref={cancelRef} type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className={["purge", "emptyTrash"].includes(modal.type) ? "btn" : "btn btn-moon"}
                disabled={busy}
                data-danger={["purge", "emptyTrash"].includes(modal.type) || undefined}>
                {busy ? "Working…" : modal.type === "remove" ? "Move to Trash" : modal.type === "purge" ? "Delete permanently" : modal.type === "emptyTrash" ? "Empty Trash" : "Confirm"}
              </button>
            </div>
          </form>
        </div>
    </ModalShell>
  );
}

function ShareModal({ modal, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copy = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(modal.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Could not copy automatically. Select the link and copy it manually.");
    }
  };
  return (
    <ModalShell title="Share link" onClose={onClose} className="share-modal">
        <div className="modal-body modal-form-body">
          <p className="modal-message share-message">
            Anyone with this link can download "{modal.node.name}".
          </p>
          <div className="share-row">
            <label className="sr-only" htmlFor="share-url">Share URL</label>
            <input id="share-url" className="share-input" readOnly value={modal.url}
              onFocus={e => e.target.select()} />
            <button className="btn btn-moon" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
          </div>
          {copyError && <p className="auth-err share-error" role="alert">{copyError}</p>}
          <span className="sr-only" aria-live="polite">{copied ? "Link copied" : ""}</span>
        </div>
    </ModalShell>
  );
}

function MoveModal({ node, onClose, onMoved }) {
  const [folderId, setFolderId] = useState("root");
  const [view, setView] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setView(null);
    setErr("");
    api.children(folderId)
      .then((next) => active && setView(next))
      .catch((error) => active && setErr(error.message));
    return () => { active = false; };
  }, [folderId]);

  const moveHere = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.move(node.id, folderId);
      onMoved();
    } catch (error) {
      setErr(error.message);
      setBusy(false);
    }
  };

  const folders = (view?.children || []).filter((item) => item.type === "folder" && item.id !== node.id);
  const currentName = view?.folder?.name || "Home";

  return (
    <ModalShell title={`Move “${node.name}”`} onClose={onClose} className="move-modal">
      <div className="modal-body move-body">
        <nav className="move-crumbs" aria-label="Destination folder">
          {(view?.breadcrumb || [{ id: "root", name: "Home" }]).map((crumb, index, all) => (
            <span key={crumb.id} className="crumb-wrap">
              {index > 0 && <ChevR />}
              <button className={`crumb ${index === all.length - 1 ? "on" : ""}`}
                onClick={() => setFolderId(crumb.id)}>{crumb.name}</button>
            </span>
          ))}
        </nav>
        <div className="move-list" aria-live="polite">
          {!view && !err && <p className="dim move-state">Reading folders…</p>}
          {view && folders.length === 0 && <p className="dim move-state">No folders inside {currentName}.</p>}
          {folders.map((folder) => (
            <button key={folder.id} className="move-folder" onClick={() => setFolderId(folder.id)}>
              <FolderIcon className="c-moon" />
              <span>{folder.name}</span>
              <ChevR />
            </button>
          ))}
        </div>
        {err && <p className="auth-err" role="alert">{err}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-moon" onClick={moveHere}
            disabled={busy || !view || folderId === node.parent_id}>
            {busy ? "Moving…" : folderId === node.parent_id ? "Already here" : `Move to ${currentName}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function Drive({ user, onLogout, onStorage }) {
  const [stack, setStack] = useState([{ id: "root", name: "Home" }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [trashMode, setTrashMode] = useState(false);
  const [uploads, setUploads] = useState([]); // {key,name,pct,part,parts,status,handle}
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const resumeInput = useRef(null);
  const resumeTarget = useRef(null);
  const queue = useRef(Promise.resolve());
  const refreshRun = useRef(0);
  const cwd = stack[stack.length - 1];

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const refresh = useCallback(async () => {
    const run = ++refreshRun.current;
    setLoading(true); setError("");
    try {
      if (trashMode) {
        const { items } = await api.trash();
        if (run !== refreshRun.current) return;
        setItems(items); setSearching(false);
      } else if (debouncedQ) {
        const { results } = await api.search(debouncedQ);
        if (run !== refreshRun.current) return;
        setItems(results); setSearching(true);
      } else {
        const { children } = await api.children(cwd.id);
        if (run !== refreshRun.current) return;
        setItems(children); setSearching(false);
      }
    } catch (e) {
      if (run === refreshRun.current) setError(e.message);
    } finally {
      if (run === refreshRun.current) setLoading(false);
    }
  }, [cwd.id, debouncedQ, trashMode]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    const t = setInterval(() => api.status().then(setStatus).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    api.uploads().then(({ uploads: pending }) => {
      setUploads((current) => {
        const known = new Set(current.map((item) => item.handle?.uploadId).filter(Boolean));
        const recovered = pending.filter((upload) => !known.has(upload.id)).map((upload) => ({
          key: `resume_${upload.id}`,
          name: upload.name,
          pct: upload.size ? (100 * upload.uploadedBytes) / upload.size : 100,
          part: upload.parts.length,
          parts: upload.size ? Math.ceil(upload.size / upload.chunkSize) : 0,
          status: "interrupted",
          handle: { uploadId: upload.id },
          session: upload,
        }));
        return [...current, ...recovered];
      });
    }).catch(() => {});
  }, []);

  async function open(node) {
    if (trashMode) return;
    if (node.type === "folder") {
      setQ("");
      const { breadcrumb } = await api.children(node.id);
      setStack(breadcrumb);
    } else setPreview(node);
  }

  const folderCache = useRef({});

  function enqueue(items, emptyFolders = []) {
    const parentId = cwd.id;
    
    // Process empty folders first
    if (emptyFolders.length > 0) {
      queue.current = queue.current.then(async () => {
        for (let relativePath of emptyFolders) {
          relativePath = relativePath.replace(/\\/g, '/');
          const parts = relativePath.split('/').filter(Boolean);
          let currentId = parentId;
          for (const part of parts) {
            const cacheKey = `${currentId}/${part}`;
            if (folderCache.current[cacheKey]) {
              currentId = folderCache.current[cacheKey];
            } else {
              const res = await api.children(currentId);
              let found = res.children.find(c => c.type === 'folder' && c.name === part);
              if (!found) found = await api.mkdir(currentId, part);
              folderCache.current[cacheKey] = found.id;
              currentId = found.id;
            }
          }
        }
        refresh();
      });
    }

    for (const item of items) {
      const file = item.file || item;
      const key = `${Date.now()}_${file.name}_${Math.random()}`;
      const handle = {};
      setUploads((u) => [...u, { key, name: file.name, pct: 0, part: 0, parts: 1, status: "queued", handle, file }]);
      queue.current = queue.current.then(async () => {
        if (handle.cancelled) return;
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "up" } : x)));
        try {
          let targetFolderId = parentId;
          let relativePath = item.path || file.webkitRelativePath;
          if (relativePath) {
            relativePath = relativePath.replace(/\\/g, '/');
            const parts = relativePath.split('/').filter(Boolean);
            parts.pop(); // remove the filename itself
            let currentId = parentId;
            for (const part of parts) {
              const cacheKey = `${currentId}/${part}`;
              if (folderCache.current[cacheKey]) {
                currentId = folderCache.current[cacheKey];
              } else {
                const res = await api.children(currentId);
                let found = res.children.find(c => c.type === 'folder' && c.name === part);
                if (!found) found = await api.mkdir(currentId, part);
                folderCache.current[cacheKey] = found.id;
                currentId = found.id;
              }
            }
            targetFolderId = currentId;
          }
          await uploadFile(file, targetFolderId, ({ loaded, total, part, parts }) => {
            setUploads((u) => u.map((x) => x.key === key
              ? { ...x, pct: total ? (100 * loaded) / total : 100, part, parts } : x));
          }, handle);
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct: 100, status: "done" } : x)));
          refresh();
          setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 5000);
        } catch (e) {
          setUploads((u) => u.map((x) => x.key === key
            ? { ...x, status: e.cancelled ? "cancelled" : "error", err: e.message } : x));
        }
      });
    }
  }

  function continueUpload(item, file) {
    const expected = item.session;
    if (expected && (
      file.name !== expected.name || file.size !== expected.size ||
      (expected.lastModified && file.lastModified !== expected.lastModified)
    )) {
      setUploads((all) => all.map((entry) => entry.key === item.key
        ? { ...entry, status: "error", err: "Select the same file (name, size and modified date must match)." }
        : entry));
      return;
    }
    item.handle.cancelled = false;
    setUploads((all) => all.map((entry) => entry.key === item.key
      ? { ...entry, file, status: "queued", err: "" } : entry));
    queue.current = queue.current.then(async () => {
      setUploads((all) => all.map((entry) => entry.key === item.key ? { ...entry, status: "up" } : entry));
      try {
        const session = await api.upload(item.handle.uploadId);
        if (session.status === "completed") {
          await api.completeUpload(session.id);
        } else {
          await uploadFile(file, session.parentId, ({ loaded, total, part, parts }) => {
            setUploads((all) => all.map((entry) => entry.key === item.key
              ? { ...entry, pct: total ? (100 * loaded) / total : 100, part, parts, session }
              : entry));
          }, item.handle, session);
        }
        setUploads((all) => all.map((entry) => entry.key === item.key
          ? { ...entry, pct: 100, status: "done" } : entry));
        refresh();
        setTimeout(() => setUploads((all) => all.filter((entry) => entry.key !== item.key)), 5000);
      } catch (e) {
        setUploads((all) => all.map((entry) => entry.key === item.key
          ? { ...entry, status: e.cancelled ? "cancelled" : "error", err: e.message }
          : entry));
      }
    });
  }

  function chooseResume(item) {
    if (item.file) return continueUpload(item, item.file);
    resumeTarget.current = item;
    resumeInput.current?.click();
  }

  const cancelUpload = async (item) => {
    item.handle.cancelled = true;
    item.handle.xhr?.abort();
    setUploads((u) => u.filter((x) => x.key !== item.key));
    if (item.handle.uploadId) await api.abortUpload(item.handle.uploadId).catch(() => {});
  };

  const [modal, setModal] = useState(null);

  function mkdir() { setModal({ type: "mkdir" }); }
  function rename(node) { setModal({ type: "rename", node }); }
  function move(node) { setModal({ type: "move", node }); }
  function remove(node) { setModal({ type: "remove", node }); }
  function purge(node) { setModal({ type: "purge", node }); }
  async function restore(node) {
    try { await api.restore(node.id); refresh(); }
    catch (e) { setError(e.message); }
  }
  async function share(node) {
    try {
      const { shareId } = await api.share(node.id);
      const url = `${window.location.origin}/api/share/${shareId}/content`;
      setModal({ type: "share", url, node });
    } catch (e) { setError(`Could not create a share link — ${e.message}`); }
  }

  /* OS file drop vs internal row drag */
  const isOsDrag = (e) => [...(e.dataTransfer?.types || [])].some(t => t.toLowerCase() === "files");
  async function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    if (trashMode) return;
    if (!isOsDrag(e)) return;
    
    // Fallback if items not supported
    if (!e.dataTransfer.items) return enqueue([...e.dataTransfer.files]);
    
    const items = [...e.dataTransfer.items].filter(i => i.kind === "file");
    const filesToUpload = [];
    const emptyFolders = [];

    const readEntry = async (entry, path = "") => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        filesToUpload.push({ file, path: path + file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let entries = [];
        let hasMore = true;
        while (hasMore) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (batch.length === 0) hasMore = false;
          else entries.push(...batch);
        }
        if (entries.length === 0) {
          emptyFolders.push(path + entry.name);
        } else {
          for (const e of entries) await readEntry(e, path + entry.name + "/");
        }
      }
    };

    try {
      for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) await readEntry(entry);
        else filesToUpload.push({ file: item.getAsFile(), path: "" });
      }
      enqueue(filesToUpload, emptyFolders);
    } catch (err) {
      setError(`Could not read that dropped folder — ${err.message}`);
    }
  }
  async function dropOnFolder(e, folder) {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData("application/x-telemoon-node");
    if (!id || id === folder.id) return;
    try { await api.move(id, folder.id); refresh(); }
    catch (ex) { setError(`Could not move that item — ${ex.message}`); }
  }

  const previewable = (n) =>
    /^image\/|^video\/|^audio\/|^application\/pdf$/.test(n.mime || "");

  return (
    <div className="app"
      onDragOver={(e) => { if (isOsDrag(e)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>

      <header className="topbar">
        <div className="brand"><Crescent /><span>TeleMoon</span></div>
        <div className="searchbox">
          <SearchIcon />
          <input placeholder={trashMode ? "Search is unavailable in Trash" : "Search the drive"} value={q}
            disabled={trashMode}
            onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {q && <button className="ghost" onClick={() => setQ("")} aria-label="Clear search"><XIcon /></button>}
        </div>
        <div className="top-actions">
          {trashMode ? (
            <>
              {items.length > 0 && <button className="btn danger-btn" onClick={() => setModal({ type: "emptyTrash" })}><TrashIcon /> Empty Trash</button>}
              <button className="btn btn-moon" onClick={() => setTrashMode(false)}>Back to drive</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={mkdir}><PlusIcon /> New folder</button>
              <button className="btn" onClick={() => folderInput.current.click()}><UploadIcon /> Folder</button>
              <input ref={folderInput} type="file" multiple webkitdirectory="true" hidden
                onChange={(e) => { enqueue([...e.target.files]); e.target.value = ""; }} />
              <button className="btn btn-moon" onClick={() => fileInput.current.click()}><UploadIcon /> File</button>
              <input ref={fileInput} type="file" multiple hidden
                onChange={(e) => { enqueue([...e.target.files]); e.target.value = ""; }} />
              <button className="btn" onClick={() => { setQ(""); setTrashMode(true); }}><TrashIcon /> Trash</button>
            </>
          )}
          <input ref={resumeInput} type="file" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && resumeTarget.current) continueUpload(resumeTarget.current, file);
            resumeTarget.current = null;
            e.target.value = "";
          }} />
          <button className="ghost user" aria-label={`Sign out @${user.handle}`} onClick={onLogout}>
            <span className="avatar">{user.handle?.[0]?.toUpperCase() || "@"}</span>
            <LogoutIcon />
          </button>
        </div>
      </header>

      <nav className="crumbs" aria-label="Breadcrumb">
        {trashMode ? (
          <span className="crumb on">Trash</span>
        ) : searching ? (
          <span className="crumb on">Search: “{q}”</span>
        ) : stack.map((c, i) => (
          <span key={c.id} className="crumb-wrap">
            {i > 0 && <ChevR />}
            <button className={`crumb ${i === stack.length - 1 ? "on" : ""}`}
              onClick={() => setStack(stack.slice(0, i + 1))}>{c.name}</button>
          </span>
        ))}
      </nav>

      <main className="content">
        {loading && <div className="empty" role="status">Reading the sky…</div>}
        {!loading && error && <div className="empty err" role="alert">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="empty">
            {trashMode ? "Trash is empty." : searching ? "Nothing matches." : "This folder is empty — drop files anywhere to upload."}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="cards">
            {items.map((n) => {
              const Icon = iconFor(n);
              const cardContent = (
                <>
                  <div className="card-ico">
                    {!trashMode && n.type === "file" && n.mime?.startsWith("image/") && n.size < 1024 * 1024 ? (
                      <img className="card-thumb" src={api.fileUrl(n.id)} alt="" loading="lazy"
                        decoding="async" width="320" height="180" />
                    ) : (
                      <Icon className={n.type === "folder" ? "c-moon" : "c-mut"} />
                    )}
                  </div>
                  <span className="card-name" title={n.name}>{n.name}</span>
                  <span className="card-meta mono dim">
                    {n.type === "file" ? `${fmtBytes(n.size)} · ` : ""}{fmtDate(n.updated_at)}
                  </span>
                </>
              );
              return (
                <article key={n.id} className="card node"
                  draggable={!trashMode}
                  onDragStart={(e) => e.dataTransfer.setData("application/x-telemoon-node", n.id)}
                  onDragOver={(e) => { if (n.type === "folder" && !isOsDrag(e)) e.preventDefault(); }}
                  onDrop={(e) => n.type === "folder" && dropOnFolder(e, n)}>
                  {trashMode ? (
                    <div className="card-open card-static">{cardContent}</div>
                  ) : (
                    <button className="card-open" onClick={() => open(n)}
                      aria-label={`${n.type === "folder" ? "Open folder" : "Preview file"}: ${n.name}`}>
                      {cardContent}
                    </button>
                  )}
                  <div className="card-acts">
                    {trashMode ? (
                      <>
                        <button className="ghost icon-btn" onClick={() => restore(n)} aria-label={`Restore ${n.name}`}><RestoreIcon /></button>
                        <button className="ghost danger icon-btn" onClick={() => purge(n)} aria-label={`Delete ${n.name} permanently`}><TrashIcon /></button>
                      </>
                    ) : n.type === "file" && (
                      <button className="ghost icon-btn" onClick={() => share(n)} aria-label={`Share ${n.name}`}><ShareIcon /></button>
                    )}
                    {!trashMode && <>
                      <a className="ghost icon-btn" href={n.type === "folder" ? api.folderZipUrl(n.id) : api.fileUrl(n.id, true)}
                        aria-label={`Download ${n.name}`}><DownloadIcon /></a>
                      <button className="ghost icon-btn" onClick={() => rename(n)} aria-label={`Rename ${n.name}`}><EditIcon /></button>
                      <button className="ghost icon-btn" onClick={() => move(n)} aria-label={`Move ${n.name}`}><MoveIcon /></button>
                      <button className="ghost danger icon-btn" onClick={() => remove(n)} aria-label={`Move ${n.name} to Trash`}><TrashIcon /></button>
                    </>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="statusbar" role="status" aria-live="polite">
        <span className={`dot ${status?.telegram === "connected" ? "ok" : "off"}`} aria-hidden="true" />
        {status?.telegram === "connected"
          ? <>Linked to <b>{status.channel}</b> · parts of {fmtBytes(status.chunkBytes)}</>
          : <>Storage offline{status?.error ? ` — ${status.error}` : ""}</>}
        {onStorage && <button className="ghost storage-link" onClick={onStorage}>Storage…</button>}
      </footer>

      {uploads.length > 0 && (
        <aside className="uppanel" aria-label="Uploads" aria-live="polite">
          <h3>Uploads</h3>
          {uploads.map((u) => (
            <div key={u.key} className={`uprow ${u.status}`}>
              <MoonProgress pct={u.pct} />
              <div className="upmeta">
                <span className="upname" title={u.name}>{u.name}</span>
                <span className="mono dim">
                  {u.status === "error" ? `failed — ${u.err}`
                    : u.status === "interrupted" ? `ready to resume · ${Math.round(u.pct)}% stored`
                    : u.status === "done" ? "stored ✓"
                    : u.parts > 1 ? `part ${u.part}/${u.parts} · ${Math.round(u.pct)}%`
                    : `${Math.round(u.pct)}%`}
                </span>
              </div>
              {["error", "interrupted"].includes(u.status) && (
                <button className="ghost icon-btn" onClick={() => chooseResume(u)} aria-label={`Resume ${u.name}`}><UploadIcon /></button>
              )}
              {u.status !== "done" && <button className="ghost icon-btn" onClick={() => cancelUpload(u)} aria-label={`Cancel and discard ${u.name}`}><XIcon /></button>}
            </div>
          ))}
        </aside>
      )}

      {modal && modal.type === "share" ? (
        <ShareModal modal={modal} onClose={() => setModal(null)} />
      ) : modal?.type === "move" ? (
        <MoveModal node={modal.node} onClose={() => setModal(null)} onMoved={() => {
          setModal(null);
          refresh();
        }} />
      ) : modal ? (
        <ActionModal 
          modal={modal}
          onClose={() => setModal(null)}
          onConfirm={async (val) => {
            try {
              if (modal.type === "mkdir") await api.mkdir(cwd.id, val);
              if (modal.type === "rename") await api.rename(modal.node.id, val);
              if (modal.type === "remove") await api.del(modal.node.id);
              if (modal.type === "purge") await api.purge(modal.node.id);
              if (modal.type === "emptyTrash") await api.emptyTrash();
              refresh();
              setModal(null);
            } catch (e) {
              return e.message;
            }
          }}
        />
      ) : null}

      {preview && (
        <ModalShell title={preview.name} onClose={() => setPreview(null)} className="preview-modal">
            <div className="preview-actions">
              <a className="btn" href={api.fileUrl(preview.id, true)}><DownloadIcon /> Download</a>
            </div>
            <div className="modal-body">
              {preview.mime?.startsWith("image/") && (
                <img src={api.fileUrl(preview.id)} alt={preview.name} />
              )}
              {preview.mime?.startsWith("video/") && (
                <video src={api.fileUrl(preview.id)} controls />
              )}
              {preview.mime?.startsWith("audio/") && (
                <audio src={api.fileUrl(preview.id)} controls />
              )}
              {preview.mime === "application/pdf" && (
                <iframe src={api.fileUrl(preview.id)} title={preview.name} />
              )}
              {!previewable(preview) && (
                <p className="dim center">
                  No inline preview for this type · {fmtBytes(preview.size)}
                </p>
              )}
            </div>
        </ModalShell>
      )}

      {dragOver && !trashMode && (
        <div className="dropveil"><Crescent /><p>Release to upload into “{cwd.name}”</p></div>
      )}
    </div>
  );
}
