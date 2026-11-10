import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export type PowerAction = "reboot" | "shutdown";
export interface PowerController {
  supported: boolean;
  reason: string | null;
  execute(action: PowerAction): Promise<void>;
}
const run = promisify(execFile);
const commands = { reboot: "reboot", shutdown: "poweroff" } as const;

export async function createPowerController(): Promise<PowerController> {
  let reason: string | null = null;
  if (process.platform !== "linux") {
    reason = "電源操作はRaspberry Piのみ対応しています。";
  } else {
    const models = await Promise.all([
      "/proc/device-tree/model", "/sys/firmware/devicetree/base/model",
    ].map((file) => readFile(file, "utf8").catch(() => "")));
    if (!models.some((model) => model.includes("Raspberry Pi"))) {
      reason = "Raspberry Piとして認識できないため電源操作は無効です。";
    } else if (process.env.DTIS_POWER_CONTROL !== "1") {
      reason = "install-pi.shを実行して電源操作を有効にしてください。";
    } else {
      try {
        // Listing permissions never executes the requested power command.
        for (const command of Object.values(commands)) {
          await run("/usr/bin/sudo", ["-n", "-l", "/usr/bin/systemctl", "--no-block", command], { timeout: 5000 });
        }
      } catch {
        reason = "電源操作のsudo権限がありません。install-pi.shを再実行してください。";
      }
    }
  }
  return {
    supported: reason === null,
    reason,
    async execute(action) {
      if (reason || !(action in commands)) throw new Error(reason ?? "未対応の電源操作です。");
      // No shell, user-supplied command, path or arguments are accepted.
      await run("/usr/bin/sudo", ["-n", "/usr/bin/systemctl", "--no-block", commands[action]], { timeout: 10000 });
    },
  };
}
