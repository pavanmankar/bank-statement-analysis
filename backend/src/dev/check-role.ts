import pg from "pg";

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: "postgresql://chat_ro:chat_ro_pass@localhost:5432/statements",
  });
  try {
    await pool.query("INSERT INTO transactions (description) VALUES ('nope')");
    process.stderr.write("read-only role was able to insert\n");
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/permission denied/i.test(message)) {
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("read-only insert blocked\n");
    }
  } finally {
    await pool.end();
  }
}

main();
