import { useEffect, useState } from "react";
import { api, savedUser } from "./api.js";
import { Crescent, LinkIcon, MegaphoneIcon, UsersIcon } from "./icons.jsx";

// Link a storage channel: paste a private t.me/+ link (user session joins it),
// an @name, or a -100 id, or select from channels this account already has.
export default function Connect({ status, canSkip, onDone, onLogout }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dialogs, setDialogs] = useState(null);
  const [dlgErr, setDlgErr] = useState("");
  const offline = !status.mode; // no Telegram client at all

  useEffect(() => {
    if (offline) return;
    api.dialogs()
      .then((d) => setDialogs(d.dialogs))
      .catch((e) => setDlgErr(e.message));
  }, [offline]);

  async function connect(ref) {
    setBusy(true); setErr("");
    try {
      await api.saveChannel(ref);
      
      // Update local storage so the UI knows they have a channel
      const u = savedUser.get();
      if (u) savedUser.set({ ...u, channel_id: ref });
      
      onDone();
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="connect-wrap">
      <div className="connect-head">
        <div className="brand"><Crescent /><span>TeleMoon</span></div>
        <div>
          {canSkip && <button className="ghost" onClick={onDone}>Back to drive</button>}
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div className="connect-main">
        <span className="section-label">STORAGE SETUP</span>
        <h1>Link Telegram Storage</h1>
        <p>
          {canSkip
            ? <>Currently linked to <b>{status.channel}</b>. Switching channels does not move files already stored there.</>
            : "Select a private Telegram channel to store your files."}
        </p>

        {offline ? (
          <div className="notice-box">
            <p><b>Telegram is offline on the server.</b></p>
            <p className="dim">{status.error}</p>
            <p className="dim">
              Add TG_API_ID, TG_API_HASH, and a bot token to <span className="mono">server/.env</span>, then restart the server.
            </p>
          </div>
        ) : (
          <form className="linkbox" onSubmit={(e) => { e.preventDefault(); connect(link); }}>
            <LinkIcon />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste channel link, @handle, or chat ID"
              spellCheck={false} autoFocus
            />
            <button className="btn btn-moon" disabled={busy || !link.trim()}>
              {busy ? "Linking..." : "Connect"}
            </button>
          </form>
        )}
        {err && <p className="auth-err" role="alert">{err}</p>}

        {!offline && status.mode === "bot" && (
          <div className="connect-steps">
            <h2>Setup Steps</h2>
            <div className="steps-list">
              <div className="step-item">
                <span className="step-num">01</span>
                <span>Create a private Telegram channel in your Telegram client.</span>
              </div>
              <div className="step-item">
                <span className="step-num">02</span>
                <span>Add your TeleMoon bot as a channel administrator.</span>
              </div>
              <div className="step-item">
                <span className="step-num">03</span>
                <span>Post any message in the channel, right-click, and select Copy Post Link.</span>
              </div>
              <div className="step-item">
                <span className="step-num">04</span>
                <span>Paste the link into the field above and select Connect.</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {!offline && status.mode !== "bot" && (
        <section className="dialogs">
          <h2>Your channels and groups</h2>
          {dialogs === null && !dlgErr && <p className="dim">Loading channels...</p>}
          {dlgErr && (
            <div className="notice-box">
              <p className="dim">{dlgErr}</p>
            </div>
          )}
          {dialogs && dialogs.length === 0 && <p className="dim">No channels found on this account.</p>}
          {dialogs && dialogs.length > 0 && (
            <div className="cards">
              {dialogs.map((d) => (
                <button key={d.id} disabled={busy}
                  className={`card pick ${d.current ? "current" : ""}`}
                  onClick={() => connect(d.id)} title={d.title}>
                  <div className="card-ico">{d.group ? <UsersIcon /> : <MegaphoneIcon />}</div>
                  <div className="card-name">{d.title}</div>
                  <div className="card-meta mono dim" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{d.username ? `@${d.username}` : "private"} · {d.group ? "group" : "channel"}</span>
                    {d.current && <span className="pill-tag pill-tag-green">Linked</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

