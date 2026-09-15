import { useCallback, useEffect, useState } from "react";
import { api, token, savedUser } from "./api.js";
import Auth from "./Auth.jsx";
import Connect from "./Connect.jsx";
import Drive from "./Drive.jsx";
import { Crescent } from "./icons.jsx";

export default function App() {
  const [user, setUser] = useState(() => {
    const u = savedUser.get();
    return u?.handle ? u : null; // pre-handle sessions are stale
  });
  const [status, setStatus] = useState(null);
  const [managing, setManaging] = useState(false);

  const refreshStatus = useCallback(
    () => api.status().then(setStatus).catch(() => setStatus({ telegram: "offline", error: "server unreachable" })),
    []
  );
  useEffect(() => { if (user) refreshStatus(); }, [user, refreshStatus]);

  const logout = () => {
    api.logout().catch(() => {});
    token.clear(); savedUser.clear(); setUser(null); setStatus(null);
  };
  useEffect(() => {
    if (!user?.id) return;
    api.me()
      .then(({ user: fresh }) => {
        token.clear(); // /auth/me rotates legacy Bearer sessions into a secure cookie
        savedUser.set(fresh);
        setUser(fresh);
      })
      .catch(logout);
  }, [user?.id]);

  if (!user) return <Auth onAuth={setUser} />;
  if (!status) return <div className="boot"><Crescent /></div>;

  const canManageStorage = status.canManageStorage !== false;

  if (status.telegram !== "connected" || (managing && canManageStorage))
    return (
      <Connect
        status={status}
        canSkip={status.telegram === "connected"}
        user={user}
        onDone={() => { setManaging(false); refreshStatus(); }}
        onLogout={logout}
      />
    );

  return (
    <Drive
      user={user}
      onLogout={logout}
      onStorage={() => setManaging(true)}
    />
  );
}
