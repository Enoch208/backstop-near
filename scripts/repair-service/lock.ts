import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export function lockRepairService(directory: string): () => void {
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const pid = z
      .number()
      .int()
      .positive()
      .parse(JSON.parse(readFileSync(join(directory, "pid.json"), "utf8")));
    let running = true;
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe instanceof Error && "code" in probe && probe.code === "ESRCH") running = false;
      else throw probe;
    }
    if (running) throw new Error("Another repair gateway owns the job directory", { cause: error });
    rmSync(directory, { recursive: true });
    mkdirSync(directory, { mode: 0o700 });
  }
  writeFileSync(join(directory, "pid.json"), JSON.stringify(process.pid), {
    flag: "wx",
    mode: 0o600,
  });
  return () => {
    rmSync(directory, { recursive: true, force: true });
  };
}
