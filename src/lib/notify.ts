// Best-effort Telegram push for hot leads (speed-to-lead). Reuses the existing
// `hermes send` CLI so no bot credentials live in this app. Never throws.
import { spawn } from "node:child_process";

const HERMES = process.env.HERMES_BIN || "/home/hermes/.local/bin/hermes";
const HOME = process.env.HERMES_HOME || "/home/hermes";

export function notifyTelegram(text: string): void {
  if (process.env.LEAD_TELEGRAM === "off") return;
  try {
    const child = spawn(HERMES, ["send", "-t", "telegram", "-q"], {
      env: { ...process.env, HOME },
      stdio: ["pipe", "ignore", "ignore"],
      detached: false,
    });
    child.on("error", (e) => console.error("telegram notify failed", e));
    // Hard cap so a hung CLI never keeps the request alive.
    const kill = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.on("exit", () => clearTimeout(kill));
    child.stdin.write(text);
    child.stdin.end();
  } catch (e) {
    console.error("telegram notify threw", e);
  }
}
