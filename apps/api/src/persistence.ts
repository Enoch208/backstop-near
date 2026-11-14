import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { evolve, type Store, type TaskRecord, type TaskEvent } from "@backstop/orchestrator";
import {
  attestedInferenceSchema,
  digestSchema,
  findingSchema,
  repairTaskSchema,
} from "@backstop/shared";
import { z } from "zod";
import { taskEventSchema } from "./event-schema.js";
import type { Runtime } from "./runtime.js";

export const replySchema = z.object({
  status: z.int(),
  body: z.string(),
  fingerprint: digestSchema,
});

const identitySchema = z.object({
  id: z.string(),
  publicKey: z.string(),
  account: z.string(),
});

const metadataSchema = z.object({
  identities: z.array(z.tuple([z.string(), identitySchema])),
  artifacts: z.array(z.tuple([digestSchema, z.string()])),
  findings: z.array(z.tuple([digestSchema, findingSchema])),
  inferences: z.array(z.tuple([digestSchema, attestedInferenceSchema])),
  repairTasks: z.array(z.tuple([digestSchema, repairTaskSchema])).default([]),
});

const valueRow = z.object({ value: z.string() });
const keyedRow = z.object({ key: z.string(), value: z.string() });

export function openPersistence(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, "a", 0o600));
  closeSync(openSync(`${path}.lock`, "a", 0o600));
  const lock = new DatabaseSync(`${path}.lock`);
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    throw new Error(`Another coordinator is using ${path}`, { cause: error });
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS task_events (sequence INTEGER PRIMARY KEY, id TEXT UNIQUE, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS durable_values (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS request_replies (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const saveEvent = db.prepare("INSERT INTO task_events (id, value) VALUES (?, ?)");
  const readValue = db.prepare("SELECT value FROM durable_values WHERE key = ?");
  const listValues = db.prepare("SELECT key, value FROM durable_values WHERE key GLOB ?");
  const setValue = db.prepare("INSERT OR REPLACE INTO durable_values (key, value) VALUES (?, ?)");
  const deleteValue = db.prepare("DELETE FROM durable_values WHERE key = ?");
  const readReply = db.prepare("SELECT value FROM request_replies WHERE key = ?");
  const saveReply = db.prepare("INSERT INTO request_replies (key, value) VALUES (?, ?)");

  const get = <T>(key: string, schema: z.ZodType<T>): T | undefined => {
    const row = readValue.get(key);
    return row === undefined ? undefined : schema.parse(JSON.parse(valueRow.parse(row).value));
  };
  const set = (key: string, value: unknown) => setValue.run(key, JSON.stringify(value));
  const del = (key: string) => deleteValue.run(key);
  const list = <T>(prefix: string, schema: z.ZodType<T>) =>
    listValues.all(`${prefix}*`).map((raw) => {
      const { key, value } = keyedRow.parse(raw);
      return { key: key.slice(prefix.length), value: schema.parse(JSON.parse(value)) };
    });
  const getReply = (key: string) => {
    const row = readReply.get(key);
    return row === undefined ? undefined : replySchema.parse(JSON.parse(valueRow.parse(row).value));
  };
  const putReply = (key: string, reply: z.infer<typeof replySchema>) =>
    saveReply.run(key, JSON.stringify(reply));

  let metadataJson: string | undefined;
  const restore = (runtime: Runtime) => {
    const streams = new Map<string, TaskEvent[]>();
    const records = new Map<string, TaskRecord>();
    for (const row of db.prepare("SELECT value FROM task_events ORDER BY sequence").iterate()) {
      const event = taskEventSchema.parse(JSON.parse(valueRow.parse(row).value));
      const stream = streams.get(event.taskId) ?? [];
      if (
        event.version !== stream.length + 1 ||
        event.eventId !== `${event.taskId}#${String(event.version)}`
      )
        throw new Error(`Invalid event sequence for ${event.taskId}`);
      stream.push(event);
      streams.set(event.taskId, stream);
      records.set(event.taskId, evolve(records.get(event.taskId) ?? null, event));
    }
    const store: Store = {
      streams: Object.fromEntries(streams),
      records: Object.fromEntries(records),
    };
    runtime.store = store;
    const raw = readValue.get("metadata");
    metadataJson = raw === undefined ? undefined : valueRow.parse(raw).value;
    const metadata =
      metadataJson === undefined ? undefined : metadataSchema.parse(JSON.parse(metadataJson));
    runtime.artifacts.clear();
    runtime.findings.clear();
    runtime.inferences.clear();
    runtime.repairTasks.clear();
    if (metadata === undefined) return;
    for (const [id, identity] of metadata.identities) runtime.identities.set(id, identity);
    for (const [hash, source] of metadata.artifacts) runtime.artifacts.set(hash, source);
    for (const [hash, finding] of metadata.findings) runtime.findings.set(hash, finding);
    for (const [hash, inference] of metadata.inferences) runtime.inferences.set(hash, inference);
    for (const [hash, task] of metadata.repairTasks) runtime.repairTasks.set(hash, task);
    runtime.registry = {
      ...runtime.registry,
      agentKeys: Object.fromEntries(
        [...runtime.identities].map(([id, identity]) => [id, identity.publicKey]),
      ),
    };
  };

  const flush = (runtime: Runtime, events: readonly TaskEvent[]) => {
    for (const event of events) saveEvent.run(event.eventId, JSON.stringify(event));
    const next = JSON.stringify({
      identities: [...runtime.identities],
      artifacts: [...runtime.artifacts],
      findings: [...runtime.findings],
      inferences: [...runtime.inferences],
      repairTasks: [...runtime.repairTasks],
    });
    if (next !== metadataJson) {
      setValue.run("metadata", next);
      metadataJson = next;
    }
  };

  const close = () => {
    db.close();
    lock.close();
  };
  return { db, restore, flush, get, set, del, list, getReply, putReply, close };
}

export type Persistence = ReturnType<typeof openPersistence>;
