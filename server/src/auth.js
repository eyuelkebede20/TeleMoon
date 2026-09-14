import jwt from "jsonwebtoken";
import { cfg } from "./config.js";
import { q } from "./db.js";

export function sign(user) {
  return jwt.sign({ id: user.id }, cfg.jwtSecret, {
    expiresIn: "30d",
  });
}

function sessionCookie(req) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "tm_session") {
      try { return decodeURIComponent(value.join("=")); }
      catch { return ""; }
    }
  }
  return "";
}

/** HttpOnly browser session, with Bearer support for non-browser API clients. */
export function auth(req, res, next) {
  const raw =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") || sessionCookie(req);
  try {
    const claims = jwt.verify(raw, cfg.jwtSecret);
    const user = q(`SELECT id,handle,role,created_at FROM users WHERE id=?`).get(claims.id);
    if (!user) throw new Error("account no longer exists");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

export function ownerOnly(req, res, next) {
  if (req.user?.role !== "owner")
    return res.status(403).json({ error: "deployment owner access required" });
  next();
}
