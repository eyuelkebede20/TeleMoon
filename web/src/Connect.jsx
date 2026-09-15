import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Crescent } from "./icons.jsx";

export default function Connect({ status, canSkip, user, onDone, onLogout }) {
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const offline = status.telegram === "offline";

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => {
      api.status().then((next) => { if (next.telegram !== "offline") onDone(); }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [offline, onDone]);

  useEffect(() => {
    if (!pairing) return;
    const initialStorageId = status.storageId;
    const initialStorageUpdatedAt = status.storageUpdatedAt || 0;
    const timer = setInterval(() => {
      api.status().then((next) => {
        if (next.telegram === "connected" && (
          next.storageId !== initialStorageId || next.storageUpdatedAt > initialStorageUpdatedAt
        )) onDone();
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [pairing, status.storageId, status.storageUpdatedAt, onDone]);

  async function beginPairing() {
    setBusy(true); setErr("");
    try { setPairing(await api.createPairing()); }
    catch (error) { setErr(error.message); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(pairing.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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
        <h1>{canSkip ? "Connect a new channel" : "Connect your storage"}</h1>
        <p className="dim">
          {canSkip
            ? <>New uploads currently go to <b>{status.channel}</b>. Pairing another channel will not affect files already stored there.</>
            : "Pair a private Telegram channel that only you control. TeleMoon will store your file chunks there."}
        </p>

        {offline ? (
          <div className="notice-box">
            <p><b>Telegram is offline on this TeleMoon server.</b></p>
            <p className="dim">{status.error}</p>
            {user?.role === "owner" ? (
              <p className="dim">
                Configure TG_API_ID, TG_API_HASH, and TG_BOT_TOKEN or TG_SESSION on the server, then restart it.
              </p>
            ) : (
              <p className="dim">Ask the deployment owner to restore the Telegram connection.</p>
            )}
          </div>
        ) : !pairing ? (
          <div className="pair-start">
            <div className="notice-box">
              <p><b>Your channel remains yours.</b></p>
              <p className="dim">The pairing code proves this account can post in the selected channel. It expires after ten minutes and works once.</p>
            </div>
            <button className="btn btn-moon" disabled={busy} onClick={beginPairing}>
              {busy ? "Creating code…" : canSkip ? "Pair another channel" : "Create pairing code"}
            </button>
          </div>
        ) : (
          <div className="pair-flow">
            <ol>
              <li>Create or open your private Telegram channel.</li>
              <li>
                {status.mode === "bot"
                  ? "Add the TeleMoon bot as a channel administrator."
                  : "Add the Telegram account configured for this TeleMoon server as a channel administrator."}
              </li>
              <li>Send the exact code below as a message in that channel.</li>
            </ol>
            <button className="pair-code mono" onClick={copyCode} title="Copy pairing code">
              {pairing.code}
            </button>
            <p className="dim pair-wait">
              {copied ? "Copied." : `Waiting for the Telegram message… Expires at ${new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
            </p>
            <button className="ghost" onClick={beginPairing} disabled={busy}>Generate a new code</button>
          </div>
        )}
        {err && <p className="auth-err" role="alert">{err}</p>}
      </div>
    </div>
  );
}
