import { useEffect, useState } from "react";
import { api, savedUser } from "./api.js";
import { useTheme } from "./theme.js";
import { Crescent, LinkIcon, MegaphoneIcon, UsersIcon, SunIcon, MoonIcon } from "./icons.jsx";

// Link a storage channel: paste a private t.me/+… link (user session joins it),
// an @name, or a -100… id — or pick from channels this account already has.
export default function Connect({ status, user, canSkip, onDone, onLogout, onUserUpdate }) {
  const { theme, toggleTheme } = useTheme();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dialogs, setDialogs] = useState(null);
  const [dlgErr, setDlgErr] = useState("");
  const [syncPrompt, setSyncPrompt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const offline = !status.mode; // no Telegram client at all

  useEffect(() => {
    if (offline) return;
    api.dialogs()
      .then((d) => setDialogs(d.dialogs))
      .catch((e) => setDlgErr(e.message));
  }, [offline]);

  async function connect(ref, titleHint) {
    setBusy(true); setErr("");
    try {
      let channelId = ref;
      let title = titleHint || ref;
      try {
        const res = await api.connect(ref);
        channelId = res.id || channelId;
        title = res.title || title;
      } catch (connErr) {
        if (typeof ref === "string" && /^-?\d+$/.test(ref.trim())) {
          const res = await api.saveChannel(ref);
          if (res?.channel_id) channelId = res.channel_id;
        } else {
          throw connErr;
        }
      }
      
      // Update local storage and notify parent component so the UI knows they have a channel
      const u = savedUser.get() || user;
      const updatedUser = { ...u, channel_id: channelId };
      savedUser.set(updatedUser);
      onUserUpdate?.(updatedUser);
      
      setSyncPrompt({ channelId, title });
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function finishConnect() {
    if (syncPrompt?.channelId) {
      const u = savedUser.get() || user;
      const updatedUser = { ...u, channel_id: syncPrompt.channelId };
      savedUser.set(updatedUser);
      onUserUpdate?.(updatedUser);
    }
    onDone?.();
  }

  async function runSync() {
    setSyncing(true);
    setErr("");
    try {
      const res = await api.syncTelegram(1000, syncPrompt?.channelId);
      setSyncResult(res);
    } catch (e) {
      setErr("Sync failed: " + e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="connect-wrap">
      <div className="connect-head">
        <div className="brand"><Crescent /><span>TeleMoon</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to Blue-Black Dark Mode" : "Switch to Creamy Light Mode"}
            aria-label="Toggle theme"
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
          {canSkip && <button className="ghost" onClick={finishConnect}>Back to drive</button>}
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div className="connect-hero">
        <h1>Link your storage</h1>
        <p className="dim">
          {canSkip
            ? <>Currently linked to <b>{status.channel}</b>. Switching doesn’t move files already stored there.</>
            : "Point TeleMoon at a private Telegram channel — that’s where your files will live."}
        </p>

        {offline ? (
          <div className="notice-box">
            <p><b>Telegram is offline on the server.</b></p>
            <p className="dim">{status.error}</p>
            <p className="dim">
              Fill <span className="mono">server/.env</span> (TG_API_ID, TG_API_HASH, and a bot token
              or user session) and restart, then come back here.
            </p>
          </div>
        ) : (
          <form className="linkbox" onSubmit={(e) => { e.preventDefault(); connect(link); }}>
            <LinkIcon />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://t.me/+…  ·  @channel  ·  -100…"
              spellCheck={false} autoFocus
            />
            <button className="btn btn-moon" disabled={busy || !link.trim()}>
              {busy ? "Linking…" : "Connect"}
            </button>
          </form>
        )}
        {err && <p className="auth-err" role="alert">{err}</p>}
      </div>

      {!offline && (
        <section className="dialogs">
          <h2>Your channels &amp; groups</h2>
          {dialogs === null && !dlgErr && <p className="dim">Looking through your sky…</p>}
          {dlgErr && (
            <div className="notice-box">
              <p className="dim">{dlgErr}</p>
              {status.mode === "bot" && (
                <p className="dim">
                  Bot mode can still connect: add the bot to your channel as admin, then paste the
                  channel’s <span className="mono">@name</span> — or post any message in the channel and
                  copy the <span className="mono">[setup] channel id</span> from the server logs.
                </p>
              )}
            </div>
          )}
          {dialogs && dialogs.length === 0 && <p className="dim">No channels or groups on this account yet.</p>}
          {dialogs && dialogs.length > 0 && (
            <div className="cards">
              {dialogs.map((d) => (
                <button key={d.id} disabled={busy}
                  className={`card pick ${d.current ? "current" : ""}`}
                  onClick={() => connect(d.id, d.title)} title={d.title}>
                  <div className="card-ico">{d.group ? <UsersIcon /> : <MegaphoneIcon />}</div>
                  <div className="card-name">{d.title}</div>
                  <div className="card-meta mono dim">
                    {d.username ? `@${d.username}` : "private"} · {d.group ? "group" : "channel"}
                    {d.current ? " · linked" : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {syncPrompt && (
        <div className="modal">
          <div className="modal-card" style={{ maxWidth: 440, minHeight: 'auto' }}>
            <header>
              <span className="upname">Group Linked</span>
            </header>
            <div className="modal-body" style={{ minHeight: 'auto', padding: "24px 20px", display: "block" }}>
              <p style={{ margin: "0 0 16px", fontSize: "0.95rem", lineHeight: 1.5 }}>
                Successfully linked to <b>{syncPrompt.title}</b>!
                <br /><br />
                Would you like to import all existing files from this chat directly to your TeleMoon drive?
              </p>
              {syncing && <p className="dim" style={{ fontSize: "0.9rem" }}>Scanning messages and indexing files…</p>}
              {syncResult && (
                <p style={{ color: "var(--moon)", fontSize: "0.9rem", lineHeight: 1.4 }}>
                  ✓ Imported {syncResult.imported} file(s) directly to your drive! ({syncResult.scanned} messages scanned)
                </p>
              )}
              {err && <p className="auth-err" style={{ marginTop: 8 }}>{err}</p>}
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" }}>
                {syncResult ? (
                  <button type="button" className="btn btn-moon" onClick={finishConnect}>
                    Go to Drive
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn" disabled={syncing} onClick={finishConnect}>
                      Skip for now
                    </button>
                    <button type="button" className="btn btn-moon" disabled={syncing} onClick={runSync}>
                      {syncing ? "Scanning…" : "Import All Files"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
