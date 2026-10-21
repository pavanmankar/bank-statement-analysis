const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|merge|comment|vacuum|analyze|set|reset|into)\b/i;

export function guardSql(input: string): string {
  const withoutTrailing = input.trim().replace(/;+\s*$/g, "");
  if (withoutTrailing.length === 0) {
    throw new Error("SQL is empty");
  }
  if (withoutTrailing.includes(";")) {
    throw new Error("Only one SQL statement is allowed");
  }
  if (/--|\/\*|\*\//.test(withoutTrailing)) {
    throw new Error("SQL comments are not allowed");
  }
  if (FORBIDDEN.test(withoutTrailing)) {
    throw new Error("Only a single SELECT query is allowed");
  }
  if (!/^(select|with)\b/i.test(withoutTrailing)) {
    throw new Error("Query must start with SELECT or WITH");
  }
  if (/^(with)\b/i.test(withoutTrailing) && !/\bselect\b/i.test(withoutTrailing)) {
    throw new Error("WITH queries must contain SELECT");
  }
  return `SELECT * FROM (${withoutTrailing}) AS guarded_query LIMIT 200`;
}
