// Entry point for the PreToolUse hook. Exit 2 is the only outcome Claude Code always treats as a block, whatever else is
// on stdout; any other non-zero exit is a non-blocking error that lets the tool run. So every deny, and every failure
// here, exits 2. An allow exits 0 and writes nothing, so the normal permission check, and any prompt, still happens.
import { decide } from "../guard.js";

let decision: { allow: boolean; reason?: string };
try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  decision = decide(Buffer.concat(chunks).toString("utf8"));
} catch {
  decision = decide("");
}
if (decision.allow) {
  process.exit(0);
}
process.stderr.write(`${decision.reason ?? "ignitenx-tm blocked this tool call."}\n`);
process.exit(2);
