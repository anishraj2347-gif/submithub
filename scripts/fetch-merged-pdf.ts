/**
 * Downloads a merge job's output from Drive to a local path so the actual
 * bytes can be inspected — the file the CR sees, not a re-render of it.
 *
 *   DATABASE_URL="..." npx tsx scripts/fetch-merged-pdf.ts <jobId> <outPath>
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDrive, downloadFile } from "../src/lib/drive";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const [id, out] = process.argv.slice(2);
  if (!id || !out) throw new Error("usage: fetch-merged-pdf.ts <jobId> <outPath>");

  const job = await prisma.mergeJob.findUniqueOrThrow({ where: { id } });
  if (!job.outputDriveFileId) throw new Error("that job has no uploaded file");

  console.log(`job v${job.version} -> ${job.outputFilename}`);
  console.log(`drive id ${job.outputDriveFileId}`);

  const drive = await getDrive();
  const bytes = await downloadFile(drive, job.outputDriveFileId);
  writeFileSync(out, bytes);

  console.log(`\nwrote ${out}`);
  console.log(`bytes: ${bytes.length}`);
  console.log(`recorded totalPages: ${job.totalPages}`);
  console.log(`first 16 bytes: ${JSON.stringify(bytes.subarray(0, 16).toString("latin1"))}`);
  console.log(`last 32 bytes:  ${JSON.stringify(bytes.subarray(-32).toString("latin1"))}`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
