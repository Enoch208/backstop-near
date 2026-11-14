import { complete, type Completion, type ModelConfig } from "./model.js";
import { budgetedRepairPrompt } from "./repair-budget.js";
import { extractSource, type RepairBrief } from "./repair.js";

export type Repair = Omit<Completion, "content"> & { readonly source: string };

export class InvalidRepairOutputError extends Error {
  readonly code = "INVALID_OUTPUT";

  constructor() {
    super("The model reply held no complete code block");
    this.name = "InvalidRepairOutputError";
  }
}

export async function proposeRepair(config: ModelConfig, brief: RepairBrief): Promise<Repair> {
  const { messages } = budgetedRepairPrompt(brief);
  const { content, receipt, unsigned } = await complete(config, messages);
  const source = extractSource(content);
  if (source === null) throw new InvalidRepairOutputError();
  return { source, receipt, unsigned };
}
