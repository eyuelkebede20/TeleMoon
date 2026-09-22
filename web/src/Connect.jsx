import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Crescent, LinkIcon, MegaphoneIcon, UsersIcon } from "./icons.jsx";

// Link a storage channel: paste a private t.me/+â€¦ link (user session joins it),
// an @name, or a -100â€¦ id â€” or pick from channels this account already has.
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

      <div className="connect-hero">
        <h1>Link your storage</h1>
        <p className="dim">
          {canSkip
            ? <>Currently linked to <b>{status.channel}</b>. Switching doesnâ€™t move files already stored there.</>
            : "Point TeleMoon at a private Telegram channel â€” thatâ€™s where your files will live."}
        </p>

        {offline ? (
          <div className="notice-box">
            <p><b>Telegram is offline on the server.</b></p>
            <p className="dim">{status.error}</p>
            <p className="dim">
              Fill <span className="mono">server/.env</span> (TG_API_ID, TG_API_HASH, and a bot token
              or user session via <span className="mono">npm run login</span>) and restart, then come back here.
            </p>
          </div>
        ) : (
          <form className="linkbox" onSubmit={(e) => { e.preventDefault(); connect(link); }}>
            <LinkIcon />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://t.me/+â€¦  Â·  @channel  Â·  -100â€¦"
              spellCheck={false} autoFocus
            />
            <button className="btn btn-moon" disabled={busy || !link.trim()}>
              {busy ? "Linkingâ€¦" : "Connect"}
            </button>
          </form>
        )}
        {err && <p className="auth-err" role="alert">{err}</p>}
      </div>

      {!offline && (
        <section className="dialogs">
          <h2>Your channels &amp; groups</h2>
          {dialogs === null && !dlgErr && <p className="dim">Looking through your skyâ€¦</p>}
          {dlgErr && (
            <div className="notice-box">
              <p className="dim">{dlgErr}</p>
              {status.mode === "bot" && (
                <p className="dim">
                  Bot mode can still connect: add the bot to your channel as admin, then paste the
                  channelâ€™s <span className="mono">@name</span> â€” or post any message in the channel and
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
                  onClick={() => connect(d.id)} title={d.title}>
                  <div className="card-ico">{d.group ? <UsersIcon /> : <MegaphoneIcon />}</div>
                  <div className="card-name">{d.title}</div>
                  <div className="card-meta mono dim">
                    {d.username ? `@${d.username}` : "private"} Â· {d.group ? "group" : "channel"}
                    {d.current ? " Â· linked" : ""}
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
