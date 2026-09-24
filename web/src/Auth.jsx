import { useEffect, useRef, useState } from "react";
import { api, token, savedUser } from "./api.js";
import { Crescent } from "./icons.jsx";

// One door, no signup: type an @handle and a password. A new handle simply
// becomes yours.
export default function Auth({ onAuth }) {
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const handleRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(min-width: 721px) and (pointer: fine)").matches)
      handleRef.current?.focus({ preventScroll: true });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await api.enter({ handle, password });
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
          <h1>Free &amp; secure<br />cloud storage.</h1>
          <p className="landing-lede">
            Organize, preview, and download your files from a familiar drive—while the
            actual bytes live in a private Telegram channel you control.
          </p>
        </div>

        <form className="auth-card" id="signin" onSubmit={submit}>
          <div className="auth-heading">
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

          {err && <p className="auth-err" role="alert">{err}</p>}
          <button className="btn btn-moon auth-submit" disabled={busy}>
            {busy ? "Opening your drive…" : "Enter TeleMoon"}
          </button>
          <p className="auth-hint">
            First time here? Enter a new handle to create your account.
          </p>
        </form>

        <div className="landing-features" aria-label="How it works">
          <div style={{ gridColumn: "1 / -1" }}>
            <h2 style={{ fontSize: "1.1rem", margin: "0 0 4px", letterSpacing: "-0.01em" }}>How to get started:</h2>
          </div>
          <article className="feature-box">
            <h2>1. Sign Up</h2>
            <p>Enter a new handle and password to instantly create your account.</p>
          </article>
          <article className="feature-box">
            <h2>2. Add the Bot</h2>
            <p>Create a private Telegram channel and add the TeleMoon bot as an admin.</p>
          </article>
          <article className="feature-box">
            <h2>3. Link & Upload</h2>
            <p>Paste a message link from your channel to pair it, and start uploading!</p>
          </article>
        </div>
      </section>

      <footer className="landing-foot">
        <span>TeleMoon</span>
        <span>Your files stay mapped to your Telegram storage.</span>
      </footer>
    </main>
  );
}
