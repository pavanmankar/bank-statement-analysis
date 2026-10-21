export const VIEW_COLUMNS =
  "id, txn_date, value_date, debit, credit, balance, channel, merchant, user_label, label_business, category, is_refund, is_self_transfer, source, direction, amount, is_outflow, is_expense, is_receipt, is_emi, is_loan_credit";

export const VIEW_COLUMN_HINT = `Allowed v_transactions columns: ${VIEW_COLUMNS}. Do not select description or ref_no.`;

const RUN_SQL = {
  name: "run_sql_query",
  description: "Run one read-only SELECT against v_transactions and return the rows.",
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single SELECT or WITH query. Do not add a semicolon.",
      },
    },
    required: ["sql"],
  },
};

export const FIXED_TOOL_SCHEMAS: Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    name: "loan_readiness",
    description: "Cash-movement snapshot for the last 6 calendar months. Not a loan decision.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "savings_summary",
    description: "Receipts, expenses, outflow, net, and savings rate by month.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
        to: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "top_payees",
    description: "Top merchants by expense, outflow, or receipt.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "integer" },
        measure: { type: "string", enum: ["expense", "outflow", "receipt"] },
      },
      required: ["from", "to", "measure"],
    },
  },
  {
    name: "charges_and_penalties",
    description: "Fees, penalties, bounce, SMS, AMC, and minimum-balance charges by month.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "compare_periods",
    description: "Compare two date ranges for one measure. Difference and percent change in SQL.",
    parameters: {
      type: "object",
      properties: {
        measure: { type: "string", enum: ["expense", "outflow", "receipt"] },
        fromA: { type: "string" },
        toA: { type: "string" },
        fromB: { type: "string" },
        toB: { type: "string" },
      },
      required: ["measure", "fromA", "toA", "fromB", "toB"],
    },
  },
  {
    name: "recurring_payments",
    description: "Outflow merchants seen in at least three months with a stable amount.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

const ALL = [RUN_SQL, ...FIXED_TOOL_SCHEMAS];

export const GEMINI_TOOLS = {
  functionDeclarations: ALL.map((tool) => ({
    ...tool,
    parameters: {
      ...tool.parameters,
      type: "OBJECT",
    },
  })),
};

export const OPENROUTER_TOOLS = ALL.map((tool) => ({
  type: "function",
  function: tool,
}));
