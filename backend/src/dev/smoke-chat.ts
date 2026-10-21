async function main(): Promise<void> {
  const response = await fetch("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: null,
      message: "How much did I spend on eating out last month?",
    }),
  });
  const text = await response.text();
  process.stdout.write(text);
  if (!response.ok || !text.includes("1000")) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
