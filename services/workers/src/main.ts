import { parseArgs } from "node:util";
import { asPrincipal, roster, type RosterName } from "@backstop/agents";
import { agentLoop } from "./agent-loop.js";
import { apiClient } from "./client.js";

const { values } = parseArgs({
  options: { agent: { type: "string" }, api: { type: "string" }, task: { type: "string" } },
});
const name = values.agent ?? "";
const api = values.api ?? "";
const taskId = values.task ?? "";

function isRosterName(value: string): value is RosterName {
  return Object.hasOwn(roster, value);
}

if (!isRosterName(name) || api === "" || taskId === "") {
  process.stderr.write("usage: worker --agent <name> --api <url> --task <id>\n");
  process.exit(2);
}

const agent = roster[name];
const log = (line: string) =>
  process.stdout.write(`[${agent.agentId} pid ${String(process.pid)}] ${line}\n`);
const client = apiClient(api, asPrincipal(agent));
const onEvent = agentLoop(agent, client, taskId, log, () => {
  log("task settled; exiting");
  process.exit(0);
});

log(`started for ${taskId}`);
client.follow(taskId, onEvent).then(
  () => {
    log("event stream closed");
    process.exit(0);
  },
  (error: unknown) => {
    log(`event stream failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
