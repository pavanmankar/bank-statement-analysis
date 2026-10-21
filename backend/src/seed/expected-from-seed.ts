import { readFileSync } from "node:fs";
import path from "node:path";
import { enrich } from "../ingest/enrich.js";
import { parseCsv } from "../ingest/parse-csv.js";
import { writeExpected } from "./expected.js";

const csvPath = path.resolve(__dirname, "../../../db/seed/transactions.csv");
const lines = parseCsv(readFileSync(csvPath, "utf8")).map((line) => enrich(line));
const expected = writeExpected(lines);
process.stdout.write(
  `Expected from seed: ${expected.rowCount} rows, latest ${expected.latestDate}, top month ${expected.topMonth}.\n`,
);
