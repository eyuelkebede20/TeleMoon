import { useEffect, useRef, useState } from "react";
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
  const handleRef = useRef(null);

  useEffect(() => { api.publicStatus().then(setSt).catch(() => {}); }, []);
  useEffect(() => {
    if (window.matchMedia("(min-width: 721px) and (pointer: fine)").matches)
      handleRef.current?.focus({ preventScroll: true });
  }, []);
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
    <main className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="TeleMoon home">
          <Crescent /><span>TeleMoon</span>
        </a>
        <a className="landing-signin" href="#signin">Sign in</a>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-copy">
          <p className="eyebrow">Your space. Your channel.</p>
          <h1>A calm, private drive<br />built on Telegram.</h1>
          <p className="landing-lede">
            Organize, preview, and download your files from a familiar drive—while the
            actual bytes live in a private Telegram channel you control.
          </p>

          <div className="landing-features" aria-label="TeleMoon features">
            <article className="feature-box">
              <span className="feature-mark">01</span>
              <h2>Bring your channel</h2>
              <p>Connect a private Telegram channel in a few guided steps.</p>
            </article>
            <article className="feature-box">
              <span className="feature-mark">02</span>
              <h2>Keep big files</h2>
              <p>Large uploads are split safely and put back together on download.</p>
            </article>
            <article className="feature-box">
              <span className="feature-mark">03</span>
              <h2>Use it like a drive</h2>
              <p>Folders, previews, search, sharing, and a recoverable trash.</p>
            </article>
          </div>
        </div>

        <form className="auth-card" id="signin" onSubmit={submit}>
          <div className="auth-heading">
            <p className="eyebrow">Welcome back</p>
            <h2>Enter your drive</h2>
            <p>Use your TeleMoon handle and password.</p>
          </div>

          <label>Handle
            <div className="at-field">
              <span aria-hidden="true">@</span>
              <input ref={handleRef} value={handle} placeholder="moonfriend"
                onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
                required autoComplete="username"
                spellCheck={false} autoCapitalize="none" />
            </div>
          </label>
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters" required minLength={6}
              autoComplete="current-password" />
          </label>
          {needInvite && (
            <label>Invite code <span className="dim">(only for new handles)</span>
              <input value={invite} onChange={(e) => setInvite(e.target.value)} />
            </label>
          )}

          {err && <p className="auth-err" role="alert">{err}</p>}
          <button className="btn btn-moon auth-submit" disabled={busy}>
            {busy ? "Opening your drive…" : "Enter TeleMoon"}
          </button>
          <p className="auth-hint">
            First time here? Enter a new handle to create your account
            {needInvite ? " with an invite code." : "."}
          </p>
        </form>
      </section>

      <footer className="landing-foot">
        <span>TeleMoon</span>
        <span>Your files stay mapped to your Telegram storage.</span>
      </footer>
    </main>
  );
}
