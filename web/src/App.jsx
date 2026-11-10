import { useCallback, useEffect, useState } from "react";
import { api, token, savedUser } from "./api.js";
import Auth from "./Auth.jsx";
import Connect from "./Connect.jsx";
import Drive from "./Drive.jsx";
import DropUpload from "./DropUpload.jsx";
import { Crescent } from "./icons.jsx";

function getDropCodeFromUrl() {
  const path = window.location.pathname || "";
  const match = path.match(/^\/(?:d|drop|u)\/([^/?#]+)/i);
  if (match) return decodeURIComponent(match[1]);

  const searchParams = new URLSearchParams(window.location.search || "");
  const queryCode = searchParams.get("d") || searchParams.get("drop") || searchParams.get("code");
  if (queryCode) return queryCode;

  const hash = window.location.hash || "";
  const hashMatch = hash.match(/^#\/?(?:d|drop|u)?\/?([^/?#]+)/i);
  if (hashMatch && hashMatch[1] && !hashMatch[1].startsWith("access_token")) {
    return decodeURIComponent(hashMatch[1]);
  }
  return null;
}

export default function App() {
  const [dropCode, setDropCode] = useState(() => getDropCodeFromUrl());
  const [user, setUser] = useState(() => {
    const u = token.get() ? savedUser.get() : null;
    return u?.handle ? u : null; // pre-handle sessions are stale
  });
  const [status, setStatus] = useState(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    const onPop = () => setDropCode(getDropCodeFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openDrop = (code) => {
    if (!code) return;
    const clean = code.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/?(?:d|drop|u)\//i, "");
    if (!clean) return;
    window.history.pushState(null, "", `/d/${encodeURIComponent(clean)}`);
    setDropCode(clean);
  };

  const exitDrop = () => {
    window.history.pushState(null, "", "/");
    setDropCode(null);
  };

  const refreshStatus = useCallback(
    () => api.status().then(setStatus).catch(() => setStatus({ telegram: "offline", error: "server unreachable" })),
    []
  );
  useEffect(() => { if (user) refreshStatus(); }, [user, refreshStatus]);

  const logout = () => { token.clear(); savedUser.clear(); setUser(null); setStatus(null); };

  if (dropCode) {
    return <DropUpload code={dropCode} onExit={exitDrop} />;
  }

  if (!user) return <Auth onAuth={setUser} onOpenDrop={openDrop} />;
  if (!status) return <div className="boot"><Crescent /></div>;

  if (status.telegram !== "connected" || !user.channel_id || managing)
    return (
      <Connect
        status={status}
        canSkip={!!user.channel_id && status.telegram === "connected"}
        onDone={() => {
          setManaging(false);
          const u = savedUser.get();
          if (u) setUser(u);
          refreshStatus();
        }}
        onLogout={logout}
      />
    );

  return (
    <Drive
      user={user}
      onLogout={logout}
      onStorage={() => setManaging(true)}
      onOpenDrop={openDrop}
    />
  );
}
