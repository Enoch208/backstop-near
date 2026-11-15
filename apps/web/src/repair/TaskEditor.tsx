import { useMemo, useState } from "react";
import { repairTaskSchema, type RepairTask } from "@backstop/shared";
import { buttonClass, Chip, Panel } from "../app/ui.js";
import { faultSchema, type RepairFault } from "./client.js";
import { exampleJson } from "./example.js";

export const faultLabels: Record<RepairFault, string> = {
  none: "Normal execution — no injected outage",
  "primary-after-checkpoint": "Recovery test — stop primary after checkpoint",
  "recovery-unavailable": "Refund test — make recovery workers unavailable",
};

export function TaskEditor({
  disabled,
  canSubmit,
  busy,
  onSubmit,
}: {
  readonly disabled: boolean;
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onSubmit: (task: RepairTask, fault: RepairFault) => Promise<void>;
}) {
  const [text, setText] = useState(exampleJson);
  const [fault, setFault] = useState<RepairFault>("none");
  const [fileError, setFileError] = useState<string | null>(null);
  const parsed = useMemo(() => {
    try {
      const result = repairTaskSchema.safeParse(JSON.parse(text));
      return result.success
        ? { task: result.data, error: null }
        : {
            task: null,
            error: result.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
          };
    } catch {
      return { task: null, error: "Enter a valid JSON task bundle." };
    }
  }, [text]);

  async function upload(file: File) {
    setFileError(null);
    if (file.size > 200_000) {
      setFileError("Task bundles must be at most 200 KB.");
      return;
    }
    try {
      setText(await file.text());
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not read this file.");
    }
  }

  const task = parsed.task;
  const partialNormal = fault === "none" && task?.primaryMilestone !== undefined;
  return (
    <Panel title="Your repair task" meta="JavaScript · JSON inputs and outputs">
      <p className="text-[13px] leading-relaxed text-ink/60">
        Start with the calendar example or upload your own bundle. Include the broken function,
        written rules, a reference implementation, and distinct public and held-out test cases.
        Held-out cases stay out of worker prompts; they are supplied by you, not an independent
        evaluator.
      </p>
      <div className="my-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className={`${buttonClass.secondary} disabled:opacity-40`}
          onClick={() => {
            setText(exampleJson);
            setFileError(null);
          }}
        >
          Load calendar example
        </button>
        <label className={`${buttonClass.secondary} cursor-pointer`}>
          Upload JSON
          <input
            aria-label="Upload repair task JSON"
            type="file"
            accept="application/json,.json"
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void upload(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <label htmlFor="repair-task" className="eyebrow text-ink/50">
        Task bundle
      </label>
      <textarea
        id="repair-task"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
        }}
        spellCheck={false}
        className="mt-2 h-64 w-full resize-y rounded-xl bg-well p-4 font-mono text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-ink/20"
      />
      {(fileError ?? parsed.error) !== null && (
        <p role="alert" className="mt-3 break-words text-[13px] text-fail">
          {fileError ?? parsed.error}
        </p>
      )}
      {task !== null && (
        <div className="mt-4 space-y-3 rounded-xl bg-page p-4">
          <p className="text-[14px] font-medium">{task.objective}</p>
          <p className="text-[13px] leading-relaxed text-ink/60">{task.rules}</p>
          <div className="flex flex-wrap gap-2">
            <Chip tone="neutral">{task.suite.entry}</Chip>
            <Chip tone="neutral">
              {task.suite.cases.filter((entry) => entry.visibility === "public").length} public
              tests
            </Chip>
            <Chip tone="neutral">
              {task.suite.cases.filter((entry) => entry.visibility === "held_out").length} held-out
              tests
            </Chip>
          </div>
          <p className="text-[12px] text-ink/50">
            Schema valid. Tests have not run yet. The service validates the bundle before starting
            paid work.
          </p>
          {task.primaryMilestone !== undefined && (
            <p className="text-[12px] text-warn">
              This bundle defines a partial primary milestone: {task.primaryMilestone.objective}
            </p>
          )}
        </div>
      )}
      <label htmlFor="repair-fault" className="eyebrow mt-5 block text-ink/50">
        Execution conditions
      </label>
      <select
        id="repair-fault"
        value={fault}
        disabled={disabled}
        onChange={(event) => {
          setFault(faultSchema.parse(event.target.value));
        }}
        className="mt-2 min-h-11 w-full rounded-xl bg-well px-3 text-[13px]"
      >
        {faultSchema.options.map((value) => (
          <option key={value} value={value}>
            {faultLabels[value]}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[12px] leading-relaxed text-ink/50">
        Fault modes deliberately inject an outage. Agents still generate repairs with live AI, and
        settlement uses real testnet transfers. No mode guarantees success.
      </p>
      {partialNormal && (
        <p role="alert" className="mt-3 text-[13px] text-warn">
          Remove primaryMilestone for normal execution, or select an injected-outage test. A partial
          milestone does not request complete delivery.
        </p>
      )}
      <button
        type="button"
        disabled={!canSubmit || disabled || task === null || partialNormal}
        className={`${buttonClass.primary} mt-5 disabled:cursor-not-allowed disabled:opacity-40`}
        onClick={() => {
          if (task !== null) void onSubmit(task, fault);
        }}
      >
        {busy ? "Submitting…" : "Start team-funded testnet repair"}
      </button>
    </Panel>
  );
}
