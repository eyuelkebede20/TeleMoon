import jwt from "jsonwebtoken";
import { cfg } from "./config.js";

export function sign(user) {
  return jwt.sign({ id: user.id, handle: user.handle }, cfg.jwtSecret, {
    expiresIn: "30d",
  });
}

/** Bearer header, or ?t= query for <a>/<video>/<img> download URLs. */
export function auth(req, res, next) {
  const raw =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.t;
  try {
    req.user = jwt.verify(raw, cfg.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
