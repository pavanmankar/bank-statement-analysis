import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fiscalContext, fiscalQuarter } from "../backend/src/chat/fiscal.ts";
import { screenMessage } from "../backend/src/chat/gate.ts";
import { buildSystemPrompt } from "../backend/src/chat/prompt.ts";
import { assertBalanceChain, type BalanceLine } from "../backend/src/ingest/balance-chain.ts";
import { answerQuestion } from "../backend/src/chat/chat.service.ts";

const envFile = path.join(__dirname, "../.env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

interface Question {
  id: string;
  question: string;
  kind: "chat" | "refuse" | "allow" | "fiscal" | "prompt" | "chain-fail" | "chain-pass" | "fy-boundary";
  expectedTool?: string;
  expectedNumbers?: number[];
  requiredPhrases?: string[];
  forbiddenPhrases?: string[];
  expect?: string;
  literal?: number;
}

interface ExpectedFile {
  rowCount: number;
  latestDate: string;
  eatingOutLastMonth: number;
  groceryThisQuarter: number;
  groceryLastQuarter: number;
  topMerchants: Array<[string, number]>;
  topMonth: string;
  topMonthMerchant: string;
  above5000Last30: number;
  julyFood: number;
  earned: number;
  growwCount: number;
  growwExpense: number;
  refundInExpenses: number;
  lastQuarterStart: string;
  lastQuarterEnd: string;
  thisQuarterStart: string;
  thisQuarterEnd: string;
  fyBoundaryQ4: string;
  fyBoundaryQ1: string;
}

interface ResultRow {
  id: string;
  question: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const root = path.join(__dirname);
  const questions = JSON.parse(readFileSync(path.join(root, "questions.json"), "utf8")) as Question[];
  const expected = JSON.parse(readFileSync(path.join(root, "expected.json"), "utf8")) as ExpectedFile;
  const results: ResultRow[] = [];
  const hasModel = Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);

  for (const question of questions) {
    if (question.kind === "refuse" || question.kind === "allow") {
      let refused = false;
      try {
        screenMessage(question.question, false);
      } catch {
        refused = true;
      }
      const pass = question.kind === "refuse" ? refused : !refused;
      results.push({
        id: question.id,
        question: question.question,
        pass,
        detail: pass ? "No model call and no SQL." : "Gate result did not match.",
      });
      continue;
    }
    if (question.kind === "fiscal") {
      const fiscal = fiscalContext(expected.latestDate);
      const pass = fiscal.lastQuarter.start === expected.lastQuarterStart && fiscal.lastQuarter.end === expected.lastQuarterEnd;
      results.push({
        id: question.id,
        question: question.question,
        pass,
        detail: pass ? `${fiscal.lastQuarter.start} to ${fiscal.lastQuarter.end}` : "Fiscal dates did not match the seed.",
      });
      continue;
    }
    if (question.kind === "prompt") {
      const prompt = buildSystemPrompt({
        firstDate: "2025-01-01",
        latestDate: expected.latestDate,
        rowCount: expected.rowCount,
        unknownSharePct: 0,
      });
      const pass = prompt.includes("does not split EMI interest");
      results.push({
        id: question.id,
        question: question.question,
        pass,
        detail: pass ? "Prompt states the statement does not split EMI interest." : "EMI sentence missing from the prompt.",
      });
      continue;
    }
    if (question.kind === "chain-fail" || question.kind === "chain-pass") {
      const lines = question.kind === "chain-fail" ? missingRow() : newestFirst();
      let pass = false;
      let detail = "";
      try {
        assertBalanceChain(lines);
        pass = question.kind === "chain-pass";
        detail = pass ? "Newest-first chain accepted." : "Broken chain was accepted.";
      } catch (error) {
        pass = question.kind === "chain-fail";
        detail = error instanceof Error ? error.message : "Balance check failed";
        if (!pass) detail = `Newest-first was rejected: ${detail}`;
      }
      results.push({ id: question.id, question: question.question, pass, detail });
      continue;
    }
    if (question.kind === "fy-boundary") {
      const march = fiscalQuarter("2025-03-31");
      const april = fiscalQuarter("2025-04-01");
      const pass =
        march.label === expected.fyBoundaryQ4 &&
        april.label === expected.fyBoundaryQ1 &&
        march.end === "2025-03-31" &&
        april.start === "2025-04-01";
      results.push({
        id: question.id,
        question: question.question,
        pass,
        detail: pass ? `${march.label}; ${april.label}` : `${march.label} / ${april.label}`,
      });
      continue;
    }

    if (!hasModel) {
      results.push({
        id: question.id,
        question: question.question,
        pass: false,
        detail: "Live agent eval failed closed: GEMINI_API_KEY / LLM_PROVIDER is missing.",
      });
      continue;
    }

    try {
      const outcome = await answerQuestion(null, question.question);
      const numbers = expectedNumbers(question, expected);
      const missing = numbers.filter((value) => !answerHasNumber(outcome.answer, value));
      const missingPhrases = (question.requiredPhrases ?? []).filter(
        (phrase) => !outcome.answer.toLowerCase().includes(phrase.toLowerCase()),
      );
      const forbidden = (question.forbiddenPhrases ?? []).filter((phrase) =>
        outcome.answer.toLowerCase().includes(phrase.toLowerCase()),
      );
      const toolOk = !question.expectedTool || outcome.toolNames.includes(question.expectedTool);
      const verifiedOk = outcome.toolNames.length === 0 || outcome.verified === true;
      const pass = missing.length === 0 && missingPhrases.length === 0 && forbidden.length === 0 && toolOk && verifiedOk;
      results.push({
        id: question.id,
        question: question.question,
        pass,
        detail: pass
          ? `verified=${outcome.verified} tools=${outcome.toolNames.join(",") || "none"}`
          : `verified=${outcome.verified} tools=${outcome.toolNames.join(",") || "none"} missing=${missing.join(",")} phrases=${missingPhrases.join(",")} forbidden=${forbidden.join(",")} toolOk=${toolOk}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: question.id, question: question.question, pass: false, detail: message });
    }
  }

  const passed = results.filter((row) => row.pass).length;
  const report = { passed, failed: results.length - passed, total: results.length, results };
  writeFileSync(path.join(root, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${passed}/${results.length} passed\n`);
  if (passed !== results.length) process.exitCode = 1;
}

function expectedNumbers(question: Question, expected: ExpectedFile): number[] {
  const values = [...(question.expectedNumbers ?? [])];
  if (question.literal !== undefined) values.push(question.literal);
  if (question.expect) {
    const value = expected[question.expect as keyof ExpectedFile];
    if (typeof value === "number") values.push(value);
  }
  return values;
}

function answerHasNumber(answer: string, expected: number): boolean {
  const found: number[] = [];
  const grouped = /(?<!\d)(?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?!\d)/g;
  for (const match of answer.matchAll(grouped)) found.push(Number(match[0].replace(/,/g, "")));
  const rupees = /\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of answer.matchAll(rupees)) found.push(Number(match[1].replace(/,/g, "")));
  const plain = /(?<!\d)(\d+(?:\.\d+)?)(?!\d)/g;
  for (const match of answer.matchAll(plain)) found.push(Number(match[1]));
  return found.some((value) => Math.abs(value - expected) < 0.02);
}

function missingRow(): BalanceLine[] {
  return [
    { debit: null, credit: "100.00", balance: "100.00" },
    { debit: "10.00", credit: null, balance: "50.00" },
    { debit: "10.00", credit: null, balance: "40.00" },
  ];
}

function newestFirst(): BalanceLine[] {
  return [
    { debit: "10.00", credit: null, balance: "40.00" },
    { debit: "10.00", credit: null, balance: "50.00" },
    { debit: "40.00", credit: null, balance: "60.00" },
    { debit: null, credit: "100.00", balance: "100.00" },
  ];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
