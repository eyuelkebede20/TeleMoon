import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFile } from "./api.js";
import {
  Crescent, MoonProgress, iconFor, UploadIcon, PlusIcon, SearchIcon,
  DownloadIcon, TrashIcon, EditIcon, XIcon, LogoutIcon, ChevR,
} from "./icons.jsx";

const fmtBytes = (n) => {
  if (n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(n) / 10), u.length - 1);
  return `${(n / 2 ** (10 * i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function ActionModal({ modal, onClose, onConfirm }) {
  const [val, setVal] = useState(modal.node?.name || "");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (modal.type === "rename" && inputRef.current) inputRef.current.select();
  }, [modal.type]);

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    if (modal.type !== "remove" && !val.trim()) return;
    const res = await onConfirm(val.trim());
    if (res) setErr(res);
  };

  const title = modal.type === "mkdir" ? "New folder" : modal.type === "rename" ? "Rename" : "Delete";

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 400, minHeight: 'auto' }} onClick={e => e.stopPropagation()}>
        <header>
          <span className="upname">{title}</span>
          <button type="button" className="ghost" onClick={onClose}><XIcon /></button>
        </header>
        <div className="modal-body" style={{ minHeight: 'auto', padding: "24px 20px", display: "block" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {modal.type === "remove" ? (
              <p style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.4 }}>
                Permanently delete "{modal.node.name}"?<br/>
                <span className="dim" style={{ fontSize: "0.85rem" }}>This also removes it from the Telegram channel.</span>
              </p>
            ) : (
              <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
                placeholder={modal.type === "mkdir" ? "Folder name" : "Name"}
                style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--ink-2)", width: "100%", outline: "none", color: "var(--text)" }}
                onFocus={e => e.target.style.borderColor = "var(--moon-deep)"}
                onBlur={e => e.target.style.borderColor = "var(--line)"}
              />
            )}
            {err && <div style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{err}</div>}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className={modal.type === "remove" ? "btn" : "btn btn-moon"} 
                style={modal.type === "remove" ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#000" } : {}}>
                {modal.type === "remove" ? "Delete" : "Confirm"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function Drive({ user, onLogout, onStorage }) {
  const [stack, setStack] = useState([{ id: "root", name: "Home" }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [uploads, setUploads] = useState([]); // {key,name,pct,part,parts,status,handle}
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const queue = useRef(Promise.resolve());
  const cwd = stack[stack.length - 1];

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (q.trim()) {
        const { results } = await api.search(q.trim());
        setItems(results); setSearching(true);
      } else {
        const { children } = await api.children(cwd.id);
        setItems(children); setSearching(false);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [cwd.id, q]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    const t = setInterval(() => api.status().then(setStatus).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, []);

  async function open(node) {
    if (node.type === "folder") {
      setQ("");
      const { breadcrumb } = await api.children(node.id);
      setStack(breadcrumb);
    } else setPreview(node);
  }

  function enqueue(files) {
    const parentId = cwd.id;
    for (const file of files) {
      const key = `${Date.now()}_${file.name}_${Math.random()}`;
      const handle = {};
      setUploads((u) => [...u, { key, name: file.name, pct: 0, part: 0, parts: 1, status: "queued", handle }]);
      queue.current = queue.current.then(async () => {
        if (handle.cancelled) return;
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "up" } : x)));
        try {
          await uploadFile(file, parentId, ({ loaded, total, part, parts }) => {
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

  const cancelUpload = (item) => {
    item.handle.cancelled = true;
    item.handle.xhr?.abort();
    setUploads((u) => u.filter((x) => x.key !== item.key));
  };

  const [modal, setModal] = useState(null);

  function mkdir() { setModal({ type: "mkdir" }); }
  function rename(node) { setModal({ type: "rename", node }); }
  function remove(node) { setModal({ type: "remove", node }); }

  /* OS file drop vs internal row drag */
  const isOsDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    if (isOsDrag(e) && e.dataTransfer.files.length) enqueue([...e.dataTransfer.files]);
  }
  async function dropOnFolder(e, folder) {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData("application/x-telemoon-node");
    if (!id || id === folder.id) return;
    try { await api.move(id, folder.id); refresh(); } catch (ex) { alert(ex.message); }
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
          <input placeholder="Search the drive" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {q && <button className="ghost" onClick={() => setQ("")} aria-label="Clear search"><XIcon /></button>}
        </div>
        <div className="top-actions">
          <button className="btn" onClick={mkdir}><PlusIcon /> New folder</button>
          <button className="btn btn-moon" onClick={() => fileInput.current.click()}>
            <UploadIcon /> Upload
          </button>
          <input ref={fileInput} type="file" multiple hidden
            onChange={(e) => { enqueue([...e.target.files]); e.target.value = ""; }} />
          <button className="ghost user" title={`@${user.handle} — sign out`} onClick={onLogout}>
            <span className="avatar">{user.handle?.[0]?.toUpperCase() || "@"}</span>
            <LogoutIcon />
          </button>
        </div>
      </header>

      <nav className="crumbs" aria-label="Breadcrumb">
        {searching ? (
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
        {loading && <div className="empty">Reading the sky…</div>}
        {!loading && error && <div className="empty err">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="empty">
            {searching ? "Nothing matches." : "This folder is empty — drop files anywhere to upload."}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="cards">
            {items.map((n) => {
              const Icon = iconFor(n);
              return (
                <div key={n.id} className="card node" tabIndex={0} role="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("application/x-telemoon-node", n.id)}
                  onDragOver={(e) => { if (n.type === "folder" && !isOsDrag(e)) e.preventDefault(); }}
                  onDrop={(e) => n.type === "folder" && dropOnFolder(e, n)}
                  onClick={() => open(n)}
                  onKeyDown={(e) => e.key === "Enter" && open(n)}>
                  <div className="card-ico">
                    <Icon className={n.type === "folder" ? "c-moon" : "c-mut"} />
                  </div>
                  <div className="card-name" title={n.name}>{n.name}</div>
                  <div className="card-meta mono dim">
                    {n.type === "file" ? `${fmtBytes(n.size)} · ` : ""}{fmtDate(n.updated_at)}
                  </div>
                  <div className="card-acts" onClick={(e) => e.stopPropagation()}>
                    {n.type === "file" && (
                      <a className="ghost" href={api.fileUrl(n.id, true)} title="Download"><DownloadIcon /></a>
                    )}
                    <button className="ghost" onClick={() => rename(n)} title="Rename"><EditIcon /></button>
                    <button className="ghost danger" onClick={() => remove(n)} title="Delete"><TrashIcon /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="statusbar">
        <span className={`dot ${status?.telegram === "connected" ? "ok" : "off"}`} />
        {status?.telegram === "connected"
          ? <>Linked to <b>{status.channel}</b> · parts of {fmtBytes(status.chunkBytes)}</>
          : <>Storage offline{status?.error ? ` — ${status.error}` : ""}</>}
        <button className="ghost storage-link" onClick={onStorage}>Storage…</button>
      </footer>

      {uploads.length > 0 && (
        <aside className="uppanel" aria-label="Uploads">
          <h3>Uploads</h3>
          {uploads.map((u) => (
            <div key={u.key} className={`uprow ${u.status}`}>
              <MoonProgress pct={u.pct} />
              <div className="upmeta">
                <span className="upname" title={u.name}>{u.name}</span>
                <span className="mono dim">
                  {u.status === "error" ? `failed — ${u.err}`
                    : u.status === "done" ? "stored ✓"
                    : u.parts > 1 ? `part ${u.part}/${u.parts} · ${Math.round(u.pct)}%`
                    : `${Math.round(u.pct)}%`}
                </span>
              </div>
              {u.status !== "done" && (
                <button className="ghost" onClick={() => cancelUpload(u)} title="Cancel"><XIcon /></button>
              )}
            </div>
          ))}
        </aside>
      )}

      {modal && (
        <ActionModal 
          modal={modal}
          onClose={() => setModal(null)}
          onConfirm={async (val) => {
            try {
              if (modal.type === "mkdir") await api.mkdir(cwd.id, val);
              if (modal.type === "rename") await api.rename(modal.node.id, val);
              if (modal.type === "remove") await api.del(modal.node.id);
              refresh();
              setModal(null);
            } catch (e) {
              return e.message;
            }
          }}
        />
      )}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <header>
              <span className="upname">{preview.name}</span>
              <div>
                <a className="btn" href={api.fileUrl(preview.id, true)}><DownloadIcon /> Download</a>
                <button className="ghost" onClick={() => setPreview(null)} aria-label="Close"><XIcon /></button>
              </div>
            </header>
            <div className="modal-body">
              {preview.mime?.startsWith("image/") && (
                <img src={api.fileUrl(preview.id)} alt={preview.name} />
              )}
              {preview.mime?.startsWith("video/") && (
                <video src={api.fileUrl(preview.id)} controls autoPlay />
              )}
              {preview.mime?.startsWith("audio/") && (
                <audio src={api.fileUrl(preview.id)} controls autoPlay />
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
          </div>
        </div>
      )}

      {dragOver && (
        <div className="dropveil"><Crescent /><p>Release to upload into “{cwd.name}”</p></div>
      )}
    </div>
  );
}
