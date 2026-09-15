import { useEffect, useState } from "react";
import { api, token, savedUser } from "./api.js";
import { Crescent } from "./icons.jsx";

// One door, no signup: type an @handle and a password. A new handle simply
// becomes yours (invite-gated only if the server has INVITE_CODE set).
export default function Auth({ onAuth }) {
  const [st, setSt] = useState(null);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.publicStatus().then(setSt).catch(() => {}); }, []);
  const needInvite = !!st && st.users > 0 && st.inviteRequired;

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await api.enter({ handle, password, invite });
      token.clear(); // migrate older localStorage sessions to the HttpOnly cookie
      savedUser.set(res.user);
      onAuth(res.user);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo"><Crescent /><h1>TeleMoon</h1></div>
        <p className="auth-sub">Your Telegram channel, as a drive.</p>

        <label>Handle
          <div className="at-field">
            <span aria-hidden="true">@</span>
            <input value={handle} placeholder="moonfriend"
              onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
              required autoFocus autoComplete="username"
              spellCheck={false} autoCapitalize="none" />
          </div>
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={6} autoComplete="current-password" />
        </label>
        {needInvite && (
          <label>Invite code <span className="dim">(only for new handles)</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
        )}

        {err && <p className="auth-err" role="alert">{err}</p>}
        <button className="btn btn-moon" disabled={busy}>
          {busy ? "One moment…" : "Enter"}
        </button>
        <p className="auth-hint">New handle? It becomes yours the first time you enter.</p>
      </form>
    </div>
  );
}
