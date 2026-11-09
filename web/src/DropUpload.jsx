import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFileToDrop } from "./api.js";
import { useTheme } from "./theme.js";
import {
  Crescent, MoonProgress, UploadIcon, LockIcon, XIcon,
  SunIcon, MoonIcon, CheckIcon, FolderIcon, FileIcon
} from "./icons.jsx";

const fmtBytes = (n) => {
  if (!n || n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(n) / 10), u.length - 1);
  return `${(n / 2 ** (10 * i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

export default function DropUpload({ code, onExit }) {
  const { theme, toggleTheme } = useTheme();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [ticket, setTicket] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const [uploads, setUploads] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    setLoading(true);
    setError("");
    api.getDropInfo(code)
      .then((data) => {
        setInfo(data);
        if (data.ticket) {
          setTicket(data.ticket);
        }
      })
      .catch((err) => {
        setError(err.message || "Upload link not found or inactive");
      })
      .finally(() => setLoading(false));
  }, [code]);

  const handleVerifyPassword = async (e) => {
    e?.preventDefault();
    if (!password) return;
    setPasswordError("");
    setVerifying(true);
    try {
      const res = await api.verifyDropPassword(code, password);
      setTicket(res.ticket);
      setToastMessage("✓ Unlocked successfully");
    } catch (err) {
      setPasswordError(err.message || "Incorrect password or PIN");
    } finally {
      setVerifying(false);
    }
  };

  const enqueueFiles = (files) => {
    if (!ticket) return;
    for (const file of files) {
      const key = `${Date.now()}_${file.name}_${Math.random()}`;
      const handle = {};
      setUploads((u) => [...u, { key, name: file.name, size: file.size, pct: 0, part: 0, parts: 1, status: "queued", handle }]);

      queue.current = queue.current.then(async () => {
        if (handle.cancelled) return;
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "up" } : x)));
        try {
          const node = await uploadFileToDrop(code, ticket, file, ({ loaded, total, part, parts }) => {
            setUploads((u) => u.map((x) => x.key === key
              ? { ...x, pct: total ? (100 * loaded) / total : 100, part, parts } : x));
          }, handle);

          setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct: 100, status: "done" } : x)));
          setCompleted((c) => [{ name: file.name, size: file.size, id: node?.id || key }, ...c]);
          setToastMessage(`✓ "${file.name}" uploaded successfully`);
          setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 4000);
        } catch (e) {
          setUploads((u) => u.map((x) => x.key === key
            ? { ...x, status: e.cancelled ? "cancelled" : "error", err: e.message } : x));
        }
      });
    }
  };

  const cancelUpload = (item) => {
    item.handle.cancelled = true;
    item.handle.xhr?.abort();
    setUploads((u) => u.filter((x) => x.key !== item.key));
  };

  const isOsDrag = (e) => [...(e.dataTransfer?.types || [])].some(t => t.toLowerCase() === "files");

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!isOsDrag(e) || !e.dataTransfer.files) return;
    enqueueFiles([...e.dataTransfer.files]);
  };

  if (loading) {
    return (
      <div className="app" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div className="empty">Connecting to link…</div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="app" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
        <div className="modal-card" style={{ maxWidth: 440, padding: 32, textAlign: "center" }}>
          <div style={{ color: "var(--danger)", fontSize: "2rem", marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: "0 0 10px" }}>Upload Link Unavailable</h2>
          <p className="dim" style={{ margin: "0 0 24px", lineHeight: 1.5 }}>
            {error || "This upload link does not exist, has expired, or has been disabled by its owner."}
          </p>
          <button className="btn btn-moon" onClick={onExit || (() => window.location.href = "/")}>
            Go to TeleMoon Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
      onDragOver={(e) => { if (isOsDrag(e) && ticket) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={onExit || (() => window.location.href = "/")}>
          <Crescent /><span>TeleMoon</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="ghost theme-toggle"
            title={theme === "light" ? "Switch to Blue-Black Dark Mode" : "Switch to Creamy Light Mode"}
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
          <button className="btn" onClick={onExit || (() => window.location.href = "/")}>
            Sign In / Drive
          </button>
        </div>
      </header>

      {toastMessage && (
        <div className="toast-banner">
          <span>{toastMessage}</span>
          <button className="ghost" onClick={() => setToastMessage("")}><XIcon /></button>
        </div>
      )}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 640 }}>
          {/* Header Card */}
          <div className="card" style={{ marginBottom: 24, padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span className="badge-tracked" style={{ fontSize: "0.75rem", padding: "2px 8px" }}>
                FILE DROP · CODE #{info.code}
              </span>
            </div>
            <h1 style={{ margin: "4px 0 8px", fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {info.title || `Upload files to @${info.ownerHandle}`}
            </h1>
            <p className="dim" style={{ margin: 0, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
              <FolderIcon style={{ width: 16, height: 16 }} /> Destination folder: <b>{info.folderName}</b>
            </p>
          </div>

          {/* Password Protection Gate */}
          {info.hasPassword && !ticket ? (
            <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
              <div style={{ display: "inline-flex", padding: 14, borderRadius: "50%", background: "var(--panel-2)", marginBottom: 16, color: "var(--moon)" }}>
                <LockIcon style={{ width: 28, height: 28 }} />
              </div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem" }}>Protected Upload Link</h2>
              <p className="dim" style={{ margin: "0 0 20px", fontSize: "0.9rem" }}>
                Enter the password or 4-digit PIN provided by <b>@{info.ownerHandle}</b> to send files.
              </p>
              <form onSubmit={handleVerifyPassword} style={{ maxWidth: 320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter PIN or password"
                  autoFocus
                  required
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    border: "1px solid var(--line)",
                    background: "var(--ink-2)",
                    color: "var(--text)",
                    outline: "none",
                    textAlign: "center",
                    fontSize: "1.1rem",
                    letterSpacing: "0.1em"
                  }}
                />
                {passwordError && (
                  <div style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{passwordError}</div>
                )}
                <button type="submit" className="btn btn-moon" disabled={verifying || !password} style={{ justifyContent: "center", padding: "12px" }}>
                  {verifying ? "Checking…" : "Unlock & Continue"}
                </button>
              </form>
            </div>
          ) : (
            /* Upload Workspace */
            <>
              {/* Drop Zone Box */}
              <div
                className="card"
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  border: `2px dashed ${dragOver ? "var(--moon)" : "var(--line-strong)"}`,
                  background: dragOver ? "var(--panel-2)" : "var(--panel)",
                  borderRadius: 18,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  marginBottom: 24,
                }}
                onClick={() => fileInput.current?.click()}
              >
                <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "var(--panel-2)", marginBottom: 16, color: "var(--moon)" }}>
                  <UploadIcon style={{ width: 32, height: 32 }} />
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "1.2rem" }}>Drop your files here</h3>
                <p className="dim" style={{ margin: "0 0 20px", fontSize: "0.9rem" }}>
                  Files of any size will upload straight to @{info.ownerHandle}'s cloud storage
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-moon" onClick={() => fileInput.current?.click()}>
                    <UploadIcon /> Browse files
                  </button>
                  <button className="btn" onClick={() => folderInput.current?.click()}>
                    <FolderIcon /> Browse folder
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => { enqueueFiles([...e.target.files]); e.target.value = ""; }}
                />
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  webkitdirectory="true"
                  hidden
                  onChange={(e) => { enqueueFiles([...e.target.files]); e.target.value = ""; }}
                />
              </div>

              {/* Uploads in Progress */}
              {uploads.length > 0 && (
                <div className="card" style={{ marginBottom: 24, padding: "20px" }}>
                  <h4 style={{ margin: "0 0 16px", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
                    In-Flight Uploads
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {uploads.map((u) => (
                      <div key={u.key} className={`uprow ${u.status}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <MoonProgress pct={u.pct} />
                        <div className="upmeta" style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.name}
                          </div>
                          <div className="mono dim" style={{ fontSize: "0.8rem" }}>
                            {u.status === "error" ? `Failed: ${u.err}`
                              : u.status === "done" ? "Stored ✓"
                              : u.parts > 1 ? `Part ${u.part}/${u.parts} · ${Math.round(u.pct)}%`
                              : `${Math.round(u.pct)}%`}
                          </div>
                        </div>
                        {u.status !== "done" && (
                          <button className="ghost" onClick={() => cancelUpload(u)} title="Cancel">
                            <XIcon />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed Uploads */}
              {completed.length > 0 && (
                <div className="card" style={{ padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <h4 style={{ margin: 0, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
                      Sent to @{info.ownerHandle} ({completed.length})
                    </h4>
                    <span style={{ fontSize: "0.8rem", color: "var(--moon)", fontWeight: 600 }}>
                      ✓ Received
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {completed.map((f, i) => (
                      <div
                        key={f.id || i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          borderRadius: "10px",
                          background: "var(--panel-2)",
                          fontSize: "0.9rem"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <FileIcon style={{ color: "var(--muted)", flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        </div>
                        <span className="mono dim" style={{ flexShrink: 0, marginLeft: 12 }}>{fmtBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {dragOver && (
        <div className="dropveil"><Crescent /><p>Drop files to upload to @{info.ownerHandle}</p></div>
      )}
    </div>
  );
}
