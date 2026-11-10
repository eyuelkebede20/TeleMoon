import { useEffect, useState } from "react";
import { api, token, savedUser } from "./api.js";
import { useTheme } from "./theme.js";
import AuthCanvas from "./AuthCanvas.jsx";
import { Crescent, SunIcon, MoonIcon } from "./icons.jsx";

export default function Auth({ onAuth, onOpenDrop }) {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [pubStatus, setPubStatus] = useState(null);

  // Form states
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [dropInput, setDropInput] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.publicStatus()
      .then(setPubStatus)
      .catch(() => {
        // Fallback to /status if /public-status isn't reachable
        api.status().then(setPubStatus).catch(() => {});
      });
  }, []);

  function switchMode(newMode) {
    setMode(newMode);
    setErr("");
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");

    const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
    if (!cleanHandle) {
      setErr("Handle is required");
      return;
    }
    if (cleanHandle.length < 3 || cleanHandle.length > 32) {
      setErr("Handle must be 3–32 letters, numbers, or underscores");
      return;
    }
    if (!password) {
      setErr("Password is required");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters");
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setErr("Passwords do not match");
        return;
      }
    }

    setBusy(true);
    try {
      let res;
      if (mode === "signup") {
        res = await api.signup({
          handle: cleanHandle,
          password,
          telegramId: telegramId.trim().replace(/^@/, "") || null,
        });
      } else {
        res = await api.login({
          handle: cleanHandle,
          password,
        });
      }

      if (res.token && res.user) {
        token.set(res.token);
        savedUser.set(res.user);
        onAuth(res.user);
      } else {
        throw new Error("Invalid response received from server");
      }
    } catch (ex) {
      setErr(ex.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <AuthCanvas />

      <div className="auth-top">
        {pubStatus?.botUsername && (
          <div className="pub-status-badge" title={`Telegram bot @${pubStatus.botUsername}`}>
            <span className={`dot ${pubStatus.telegram === "connected" ? "ok" : "off"}`} />
            <span>@{pubStatus.botUsername}</span>
          </div>
        )}
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

      <div className="auth-card-container">
        {/* Navigation Tabs */}
        <div className="auth-tabs" role="tablist" aria-label="Account authorization">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")}
          >
            Log In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Sign Up
          </button>
        </div>

        <form className="auth-card" onSubmit={submit}>
          <div className="auth-logo">
            <Crescent />
            <h1>TeleMoon</h1>
          </div>
          <p className="auth-sub">
            {mode === "login"
              ? "Sign in to access your Telegram-backed drive."
              : "Create an account for unlimited private storage."}
          </p>

          <label>
            Handle
            <div className="at-field">
              <span aria-hidden="true">@</span>
              <input
                value={handle}
                placeholder="moonfriend"
                onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
                required
                autoFocus
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
          </label>

          {mode === "signup" && (
            <label>
              Telegram Username <span className="dim">(optional, for recovery & pairing)</span>
              <div className="at-field">
                <span aria-hidden="true">@</span>
                <input
                  value={telegramId}
                  placeholder="telegram_user"
                  onChange={(e) => setTelegramId(e.target.value.replace(/^@/, ""))}
                  spellCheck={false}
                  autoCapitalize="none"
                />
              </div>
            </label>
          )}

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {mode === "signup" && (
            <label>
              Confirm Password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
          )}

          {err && <p className="auth-err" role="alert">{err}</p>}

          <button className="btn btn-moon" disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Log In" : "Create Account"}
          </button>

          <div className="auth-switch-prompt">
            {mode === "login" ? (
              <p>
                Don't have an account?{" "}
                <button type="button" className="auth-link-btn" onClick={() => switchMode("signup")}>
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button type="button" className="auth-link-btn" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </p>
            )}
          </div>

          {onOpenDrop && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)", textAlign: "center" }}>
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
                    textAlign: "center",
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
    </div>
  );
}
