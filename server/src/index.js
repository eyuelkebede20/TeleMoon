import { cfg } from "./config.js";
import { app } from "./app.js";
import { drainDeletionQueue, initTelegram } from "./telegram.js";

app.listen(cfg.port, () =>
  console.log(`TeleMoon server → http://localhost:${cfg.port}`)
);

initTelegram()
  .then(() => {
    const deletionTimer = setInterval(() => {
      drainDeletionQueue().catch((e) => console.warn("[tg] deletion queue:", e.message));
    }, 5 * 60 * 1000);
    deletionTimer.unref();
  })
  .catch((e) => {
    console.error("[tg] init failed:", e.message);
  });
