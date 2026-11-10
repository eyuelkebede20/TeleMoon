import { useEffect, useState } from "react";
import { api } from "./api.js";
import { XIcon, SendIcon, DownloadIcon, CheckIcon, LockIcon } from "./icons.jsx";

export default function FolderShareModal({ folder, onClose }) {
  const [tab, setTab] = useState("drop"); // "drop" | "download"
  const [loading, setLoading] = useState(true);
  const [dropLink, setDropLink] = useState(null);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  // Edit / creation fields
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Copy state
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const zipDownloadUrl = api.folderZipUrl(folder.id);

  const fetchLinks = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await api.getDropLinks(folder.id);
      const first = res.dropLinks?.[0] || null;
      setDropLink(first);
      if (first) {
        setCode(first.code);
        setTitle(first.title || "");
        setIsActive(Boolean(first.is_active));
        setUsePassword(Boolean(first.password_hash));
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, [folder.id]);

  const handleCreate = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await api.createDropLink(folder.id, {
        code: code.trim() || undefined,
        password: usePassword ? password.trim() : undefined,
        title: title.trim() || undefined,
      });
      setDropLink(res.dropLink);
      setCode(res.dropLink.code);
      setTitle(res.dropLink.title || "");
      setIsActive(Boolean(res.dropLink.is_active));
      setSuccess("✓ Upload link created!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!dropLink) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.updateDropLink(dropLink.id, {
        code: code.trim(),
        password: usePassword ? password.trim() : "",
        is_active: isActive ? 1 : 0,
        title: title.trim(),
      });
      setDropLink(res.dropLink);
      setSuccess("✓ Settings saved!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!dropLink) return;
    setBusy(true);
    setErr("");
    try {
      await api.deleteDropLink(dropLink.id);
      setDropLink(null);
      setCode("");
      setPassword("");
      setUsePassword(false);
      setTitle("");
      setConfirmDelete(false);
      setSuccess("✓ Upload link removed.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fullDropUrl = dropLink ? `${window.location.origin}/d/${dropLink.code}` : "";

  const copyLink = () => {
    if (!fullDropUrl) return;
    navigator.clipboard.writeText(fullDropUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyCode = () => {
    if (!dropLink) return;
    navigator.clipboard.writeText(dropLink.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 520, minHeight: "auto" }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="upname">Share Folder: "{folder.name}"</span>
          </div>
          <button type="button" className="ghost" onClick={onClose}><XIcon /></button>
        </header>

        {/* Tab switcher */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", background: "var(--panel-2)" }}>
          <button
            type="button"
            className="ghost"
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontWeight: tab === "drop" ? 600 : 400,
              color: tab === "drop" ? "var(--moon-deep)" : "var(--muted)",
              borderBottom: tab === "drop" ? "2px solid var(--moon-deep)" : "2px solid transparent",
            }}
            onClick={() => setTab("drop")}
          >
            <SendIcon style={{ width: 16, height: 16 }} /> Send a link (Uploads)
          </button>
          <button
            type="button"
            className="ghost"
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontWeight: tab === "download" ? 600 : 400,
              color: tab === "download" ? "var(--moon-deep)" : "var(--muted)",
              borderBottom: tab === "download" ? "2px solid var(--moon-deep)" : "2px solid transparent",
            }}
            onClick={() => setTab("download")}
          >
            <DownloadIcon style={{ width: 16, height: 16 }} /> Download Link (Zip)
          </button>
        </div>

        <div className="modal-body" style={{ minHeight: "auto", padding: "24px 20px", display: "block" }}>
          {loading ? (
            <p className="dim center">Loading link settings…</p>
          ) : tab === "download" ? (
            <div>
              <p style={{ margin: "0 0 16px", fontSize: "0.95rem" }}>
                Anyone with this link can download "{folder.name}" as a compressed zip file.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  readOnly
                  value={zipDownloadUrl}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: "14px",
                    border: "1px solid var(--line)",
                    background: "var(--ink-2)",
                    outline: "none",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: "0.85rem",
                  }}
                  onClick={(e) => e.target.select()}
                />
                <button
                  className="btn btn-moon"
                  onClick={() => {
                    navigator.clipboard.writeText(zipDownloadUrl);
                    setSuccess("✓ Download link copied!");
                    setTimeout(() => setSuccess(""), 2000);
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            /* Drop Link Tab */
            <div>
              {err && (
                <div style={{ color: "var(--danger)", fontSize: "0.88rem", marginBottom: 14 }}>
                  {err}
                </div>
              )}
              {success && (
                <div style={{ color: "var(--moon-deep)", fontSize: "0.88rem", fontWeight: 600, marginBottom: 14 }}>
                  {success}
                </div>
              )}

              {dropLink ? (
                /* Link Exists */
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Status Banner */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: isActive ? "var(--panel-2)" : "rgba(235, 87, 87, 0.1)",
                      border: `1px solid ${isActive ? "var(--line)" : "var(--danger)"}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`dot ${isActive ? "ok" : "off"}`} />
                      <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
                        {isActive ? "Link is Active (Receiving Files)" : "Link is Disabled"}
                      </span>
                    </div>
                    <span className="mono dim" style={{ fontSize: "0.82rem" }}>
                      {dropLink.upload_count} file(s) received
                    </span>
                  </div>

                  {/* Clean Short URL */}
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      Simple Share Link:
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        readOnly
                        value={fullDropUrl}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid var(--line)",
                          background: "var(--ink-2)",
                          color: "var(--text)",
                          fontFamily: "var(--mono)",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                        onClick={(e) => e.target.select()}
                      />
                      <button type="button" className="btn btn-moon" onClick={copyLink}>
                        {copiedLink ? "Copied!" : "Copy Link"}
                      </button>
                    </div>
                  </div>

                  {/* Quick 4-Digit Code Box */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: "1px solid var(--line-strong)",
                      background: "var(--panel-2)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
                        Quick Code / PIN:
                      </div>
                      <div style={{ fontSize: "1.4rem", fontWeight: 700, fontFamily: "var(--mono)", color: "var(--moon-deep)", letterSpacing: "0.05em" }}>
                        #{dropLink.code}
                      </div>
                    </div>
                    <button type="button" className="btn" onClick={copyCode} style={{ fontSize: "0.85rem" }}>
                      {copiedCode ? "Copied!" : "Copy Code"}
                    </button>
                  </div>

                  {/* Customization Details */}
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                          Custom Code / Slug:
                        </label>
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                          placeholder="e.g. 4829 or qq"
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--line)",
                            background: "var(--ink-2)",
                            color: "var(--text)",
                            fontFamily: "var(--mono)",
                            fontSize: "0.85rem",
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                          Note / Title (optional):
                        </label>
                        <input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Homework Files"
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--line)",
                            background: "var(--ink-2)",
                            color: "var(--text)",
                            fontSize: "0.85rem",
                          }}
                        />
                      </div>
                    </div>

                    {/* Password Protection */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem" }}>
                        <input
                          type="checkbox"
                          checked={usePassword}
                          onChange={(e) => {
                            setUsePassword(e.target.checked);
                            if (!e.target.checked) setPassword("");
                          }}
                        />
                        <span>Protect with password or 4-digit PIN</span>
                      </label>
                      {usePassword && (
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={dropLink.password_hash ? "Leave empty to keep existing password" : "Enter PIN or password"}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--line)",
                            background: "var(--ink-2)",
                            color: "var(--text)",
                            fontSize: "0.85rem",
                          }}
                        />
                      )}
                    </div>

                    {/* Active Toggle */}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                      />
                      <span>Allow people to upload files right now</span>
                    </label>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    {confirmDelete ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--danger)" }}>Delete link?</span>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                          onClick={handleDelete}
                          disabled={busy}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          style={{ fontSize: "0.8rem" }}
                          onClick={() => setConfirmDelete(false)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => setConfirmDelete(true)}
                        disabled={busy}
                        style={{ fontSize: "0.85rem" }}
                      >
                        Delete Link
                      </button>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn" onClick={onClose}>Close</button>
                      <button type="button" className="btn btn-moon" onClick={handleUpdate} disabled={busy}>
                        {busy ? "Saving…" : "Save Settings"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* No Link Yet */
                <div style={{ textAlign: "center", padding: "10px 0" }}>
                  <div style={{ display: "inline-flex", padding: 14, borderRadius: "50%", background: "var(--panel-2)", marginBottom: 14, color: "var(--moon-deep)" }}>
                    <SendIcon style={{ width: 28, height: 28 }} />
                  </div>
                  <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem" }}>Send a Link to Upload Files</h3>
                  <p className="dim" style={{ margin: "0 0 20px", fontSize: "0.9rem", lineHeight: 1.5 }}>
                    Generate a simple link or 4-digit code so anyone can upload files straight into <b>"{folder.name}"</b> without needing an account.
                  </p>

                  <div style={{ maxWidth: 360, margin: "0 auto 20px", textAlign: "left", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                        Custom Code / 4-Digit Code (leave blank to auto-generate):
                      </label>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                        placeholder="e.g. 4829 or qq"
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          background: "var(--ink-2)",
                          color: "var(--text)",
                          fontFamily: "var(--mono)",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={usePassword}
                        onChange={(e) => setUsePassword(e.target.checked)}
                      />
                      <span>Protect with password or 4-digit PIN</span>
                    </label>
                    {usePassword && (
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter PIN or password"
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          background: "var(--ink-2)",
                          color: "var(--text)",
                          fontSize: "0.85rem",
                        }}
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-moon" onClick={handleCreate} disabled={busy}>
                      {busy ? "Creating…" : "Generate Upload Link"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
