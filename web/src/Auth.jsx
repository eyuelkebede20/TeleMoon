import { useEffect, useState } from "react";
import { api, token, savedUser } from "./api.js";
import { useTheme } from "./theme.js";
import { Crescent, SunIcon, MoonIcon } from "./icons.jsx";

// One door, no signup: type an @handle and a password. A new handle simply
// becomes yours.
export default function Auth({ onAuth, onOpenDrop }) {
  const { theme, toggleTheme } = useTheme();
  const [st, setSt] = useState(null);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [dropInput, setDropInput] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.status().then(setSt).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await api.enter({ handle, password, telegramId });
      token.set(res.token);
      savedUser.set(res.user);
      onAuth(res.user);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-top">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to Blue-Black Dark Mode" : "Switch to Creamy Light Mode"}
          aria-label="Toggle theme"
        >
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
          <span>{theme === "light" ? "Dark" : "Light"}</span>
        </button>
      </div>
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
        <label>Telegram Username <span className="dim">(for new accounts, recovery)</span>
          <div className="at-field">
            <span aria-hidden="true">@</span>
            <input value={telegramId} placeholder="telegram_user"
              onChange={(e) => setTelegramId(e.target.value.replace(/^@/, ""))}
              spellCheck={false} autoCapitalize="none" />
          </div>
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={6} autoComplete="current-password" />
        </label>

        {err && <p className="auth-err" role="alert">{err}</p>}
        <button className="btn btn-moon" disabled={busy}>
          {busy ? "One moment…" : "Enter"}
        </button>
        <p className="auth-hint">New handle? It becomes yours the first time you enter.</p>

        {onOpenDrop && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)", textAlign: "center" }}>
            <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "var(--muted)" }}>
              Have an upload code or link to send files?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={dropInput}
                onChange={(e) => setDropInput(e.target.value)}
                placeholder="Code or link (e.g. 4829 or qq)"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  background: "var(--ink-2)",
                  color: "var(--text)",
                  fontFamily: "var(--mono)",
                  fontSize: "0.85rem",
                  textAlign: "center"
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (dropInput.trim()) onOpenDrop(dropInput.trim());
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={!dropInput.trim()}
                onClick={() => onOpenDrop(dropInput.trim())}
                style={{ padding: "8px 14px", fontSize: "0.85rem" }}
              >
                Open
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
