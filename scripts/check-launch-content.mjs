import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve("content/launch-approvals.json");
const manifest = JSON.parse(readFileSync(file, "utf8"));
const required = [
  "clinic-schedule",
  "services-practitioners",
  "locations-contact",
  "credentials-claims",
  "english-clinical-copy",
  "arabic-clinical-copy",
  "photography",
  "medical-advertising",
];

const byId = new Map(manifest.approvals.map((approval) => [approval.id, approval]));
const problems = [];

for (const id of required) {
  const approval = byId.get(id);
  if (!approval) {
    problems.push(`${id}: missing from approval manifest`);
    continue;
  }
  if (approval.status !== "approved") problems.push(`${id}: status is ${approval.status ?? "missing"}`);
  if (!approval.reviewedBy?.trim()) problems.push(`${id}: reviewer is missing`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(approval.reviewedAt ?? "")) {
    problems.push(`${id}: reviewedAt must be YYYY-MM-DD`);
  }
  if (!approval.evidence?.trim()) problems.push(`${id}: evidence or source reference is missing`);
}

if (problems.length > 0) {
  console.error("Production content approval gate is closed:");
  for (const problem of problems) console.error(`- ${problem}`);
  console.error("\nSee docs/CONTENT-APPROVAL.md. Staging and private demos remain available.");
  process.exit(1);
}

console.log(`Production content approval gate passed (${required.length}/${required.length}).`);
