// Generates a *user* session string (instead of the bot). With Telegram
// Premium this raises the per-message cap from 2 GB to 4 GB.
// Run: npm run login   →  paste the printed string into TG_SESSION,
// and leave TG_BOT_TOKEN empty.
import "dotenv/config";
import readline from "node:readline/promises";
import telegram from "telegram";
import sessionsMod from "telegram/sessions/index.js";

const { TelegramClient } = telegram;
const { StringSession } = sessionsMod;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) {
  console.error("Set TG_API_ID and TG_API_HASH in server/.env first (my.telegram.org).");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});
await client.start({
  phoneNumber: () => ask("Phone (intl format, e.g. +2519...): "),
  password: () => ask("2FA password (enter if none): "),
  phoneCode: () => ask("Code you received: "),
  onError: (e) => console.error(e),
});
console.log("\nTG_SESSION=" + client.session.save());
await client.disconnect();
rl.close();
