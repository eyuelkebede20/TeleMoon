import { useEffect, useState } from "react";
import { api } from "./api.js";
import { XIcon, SendIcon, DownloadIcon, SyncIcon } from "./icons.jsx";

export default function FolderShareModal({ folder, onOpenDrop, onClose }) {
  const [tab, setTab] = useState("drop"); // "drop" | "use-key" | "download"
  const [loading, setLoading] = useState(true);
  const [dropLink, setDropLink] = useState(null);
  const [allLinks, setAllLinks] = useState([]);
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

  // Send with another person's key
  const [otherKey, setOtherKey] = useState("");

  // Copy state
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const zipDownloadUrl = api.folderZipUrl(folder.id);

  const generateRandomKey = () => {
    setCode(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const fetchLinks = async () => {
    setLoading(true);
    setErr("");
    try {
      const [res, allRes] = await Promise.all([
        api.getDropLinks(folder.id),
        api.getAllDropLinks().catch(() => ({ dropLinks: [] })),
      ]);
      const first = res.dropLinks?.[0] || null;
      setDropLink(first);
      setAllLinks(allRes.dropLinks || []);
      if (first) {
        setCode(first.code);
        setTitle(first.title || "");
        setIsActive(Boolean(first.is_active));
        setUsePassword(Boolean(first.password_hash));
        setPassword("");
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
    if (usePassword && !password.trim()) {
      setErr("Please enter a password or PIN, or uncheck password protection.");
      return;
    }
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
      setUsePassword(Boolean(res.dropLink.password_hash));
      setPassword("");
      api.getAllDropLinks().then((r) => setAllLinks(r.dropLinks || [])).catch(() => {});
      setSuccess(`✓ Upload key #${res.dropLink.code} created!`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!dropLink) return;
    if (usePassword && !password.trim() && !dropLink.password_hash) {
      setErr("Please enter a password or PIN, or uncheck password protection.");
      return;
    }
    const cleanCode = code.trim();
    if (!cleanCode) {
      setErr("Upload key cannot be empty. Enter a key or tap Random.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await api.updateDropLink(dropLink.id, {
        code: cleanCode,
        password: usePassword ? (password.trim() || undefined) : "",
        is_active: isActive ? 1 : 0,
        title: title.trim(),
      });
      setDropLink(res.dropLink);
      setCode(res.dropLink.code);
      setTitle(res.dropLink.title || "");
      setIsActive(Boolean(res.dropLink.is_active));
      setUsePassword(Boolean(res.dropLink.password_hash));
      setPassword("");
      api.getAllDropLinks().then((r) => setAllLinks(r.dropLinks || [])).catch(() => {});
      setSuccess("✓ Upload key settings saved!");
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
      api.getAllDropLinks().then((r) => setAllLinks(r.dropLinks || [])).catch(() => {});
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

  const inputStyle = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--ink-2)",
    color: "var(--text)",
    fontSize: "0.85rem",
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 540, minHeight: "auto" }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="upname">
              {folder.id === "root" || folder.name === "Home" || folder.name === "TeleMoon"
                ? "Upload Keys & Sharing (Home)"
                : `Upload Key for "${folder.name}"`}
            </span>
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
              padding: "12px 8px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: "0.86rem",
              fontWeight: tab === "drop" ? 600 : 400,
              color: tab === "drop" ? "var(--moon-deep)" : "var(--muted)",
              borderBottom: tab === "drop" ? "2px solid var(--moon-deep)" : "2px solid transparent",
            }}
            onClick={() => setTab("drop")}
          >
            <SendIcon style={{ width: 15, height: 15 }} /> Receive Key
          </button>
          {onOpenDrop && (
            <button
              type="button"
              className="ghost"
              style={{
                flex: 1,
                padding: "12px 8px",
                borderRadius: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: "0.86rem",
                fontWeight: tab === "use-key" ? 600 : 400,
                color: tab === "use-key" ? "var(--moon-deep)" : "var(--muted)",
                borderBottom: tab === "use-key" ? "2px solid var(--moon-deep)" : "2px solid transparent",
              }}
              onClick={() => setTab("use-key")}
            >
              <SendIcon style={{ width: 15, height: 15 }} /> Send via Key
            </button>
          )}
          <button
            type="button"
            className="ghost"
            style={{
              flex: 1,
              padding: "12px 8px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: "0.86rem",
              fontWeight: tab === "download" ? 600 : 400,
              color: tab === "download" ? "var(--moon-deep)" : "var(--muted)",
              borderBottom: tab === "download" ? "2px solid var(--moon-deep)" : "2px solid transparent",
            }}
            onClick={() => setTab("download")}
          >
            <DownloadIcon style={{ width: 15, height: 15 }} /> Zip Link
          </button>
        </div>

        <div className="modal-body" style={{ minHeight: "auto", padding: "24px 20px", display: "block" }}>
          {loading ? (
            <p className="dim center">Loading key settings…</p>
          ) : tab === "use-key" && onOpenDrop ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (otherKey.trim()) {
                  onClose();
                  onOpenDrop(otherKey.trim());
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <p style={{ margin: 0, fontSize: "0.93rem", lineHeight: 1.5 }}>
                Enter a small upload key (like <b>4829</b> or <b>qq</b>) or full drop link to upload files straight into someone’s drive.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={otherKey}
                  onChange={(e) => setOtherKey(e.target.value)}
                  placeholder="Small key (e.g. 4829, #qq) or https://.../d/..."
                  autoFocus
                  style={{ ...inputStyle, fontFamily: "var(--mono)" }}
                />
                <button type="submit" className="btn btn-moon" disabled={!otherKey.trim()}>
                  Open Drop
                </button>
              </div>
            </form>
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
            /* Drop Link / Small Key Tab */
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
                        {isActive ? "Key Active (Receiving Files)" : "Key Disabled"}
                      </span>
                    </div>
                    <span className="mono dim" style={{ fontSize: "0.82rem" }}>
                      {dropLink.upload_count} file(s) received
                    </span>
                  </div>

                  {/* Quick Small Key Box */}
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
                      <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
                        Simple Upload Key:
                      </div>
                      <div style={{ fontSize: "1.45rem", fontWeight: 700, fontFamily: "var(--mono)", color: "var(--moon-deep)", letterSpacing: "0.05em" }}>
                        #{dropLink.code}
                      </div>
                    </div>
                    <button type="button" className="btn btn-moon" onClick={copyCode} style={{ fontSize: "0.85rem" }}>
                      {copiedCode ? "Copied!" : "Copy Key"}
                    </button>
                  </div>

                  {/* Clean Short URL */}
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      Direct Upload Link:
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
                          fontSize: "0.88rem",
                          fontWeight: 600,
                        }}
                        onClick={(e) => e.target.select()}
                      />
                      <button type="button" className="btn" onClick={copyLink}>
                        {copiedLink ? "Copied!" : "Copy Link"}
                      </button>
                    </div>
                  </div>

                  {/* Customization Details */}
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                          Small Key / Slug:
                        </label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            value={code}
                            onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                            placeholder="e.g. 4829 or qq"
                            style={{ ...inputStyle, fontFamily: "var(--mono)" }}
                          />
                          <button
                            type="button"
                            className="btn"
                            title="Generate random 4-digit key"
                            onClick={generateRandomKey}
                            style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                          >
                            <SyncIcon style={{ width: 14, height: 14 }} />
                          </button>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                          Note / Title (optional):
                        </label>
                        <input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Homework Files"
                          style={inputStyle}
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
                        <span>Protect with password or PIN</span>
                      </label>
                      {usePassword && (
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={dropLink.password_hash ? "Leave empty to keep existing password" : "Enter PIN or password"}
                          style={inputStyle}
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
                      <span>Allow people to upload files with this key</span>
                    </label>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    {confirmDelete ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "0.85rem", color: "var(--danger)" }}>Delete key?</span>
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
                        Delete Key
                      </button>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn" onClick={onClose}>Close</button>
                      <button type="button" className="btn btn-moon" onClick={handleUpdate} disabled={busy}>
                        {busy ? "Saving…" : "Save Key Settings"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* No Link Yet */
                <div style={{ textAlign: "center", padding: "6px 0" }}>
                  <div style={{ display: "inline-flex", padding: 14, borderRadius: "50%", background: "var(--panel-2)", marginBottom: 12, color: "var(--moon-deep)" }}>
                    <SendIcon style={{ width: 26, height: 26 }} />
                  </div>
                  <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem" }}>Create a Small Upload Key</h3>
                  <p className="dim" style={{ margin: "0 0 18px", fontSize: "0.9rem", lineHeight: 1.5 }}>
                    Share a short key or link so anyone can send files directly into this folder without logging in.
                  </p>

                  <div style={{ maxWidth: 380, margin: "0 auto 18px", textAlign: "left", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                        Small Upload Key (leave blank for auto 4-digit PIN):
                      </label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                          placeholder="e.g. 4829, qq, homework"
                          style={{ ...inputStyle, fontFamily: "var(--mono)" }}
                        />
                        <button
                          type="button"
                          className="btn"
                          onClick={generateRandomKey}
                          style={{ padding: "6px 12px", fontSize: "0.82rem", whiteSpace: "nowrap" }}
                        >
                          Random
                        </button>
                      </div>
                      <div className="mono dim" style={{ fontSize: "0.76rem", marginTop: 4 }}>
                        Link preview: {window.location.origin}/d/{code || "<auto-4-digits>"}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                        Title / Note (optional):
                      </label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Send Photos Here"
                        style={inputStyle}
                      />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={usePassword}
                        onChange={(e) => setUsePassword(e.target.checked)}
                      />
                      <span>Require password or PIN before upload</span>
                    </label>
                    {usePassword && (
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password or 4-digit PIN"
                        style={inputStyle}
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-moon" onClick={handleCreate} disabled={busy}>
                      {busy ? "Creating…" : "Create Upload Key"}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick overview of all existing keys across folders */}
              {allLinks.length > 0 && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 8 }}>
                    All Your Upload Keys ({allLinks.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {allLinks.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: "0.8rem",
                          background: "var(--panel-2)",
                          border: `1px solid ${item.id === dropLink?.id ? "var(--moon-deep)" : "var(--line)"}`,
                        }}
                      >
                        <span className={`dot ${item.is_active ? "ok" : "off"}`} style={{ width: 6, height: 6 }} />
                        <span className="mono" style={{ fontWeight: 600 }}>#{item.code}</span>
                        <span className="dim">→ {item.folder_id === "root" ? "Home" : (item.folder_name || "Folder")}</span>
                      </div>
                    ))}
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
