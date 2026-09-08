/**
 * Verifies the merged-PDF download streams rather than buffering.
 *
 * Streams a job's output straight from Drive, counting bytes and watching peak
 * heap. A pass means memory stays flat regardless of file size — which is the
 * whole point: the old buffered path allocated the file three times over and
 * took the instance down with it.
 *
 *   DATABASE_URL="..." npx tsx scripts/test-download-stream.ts <jobId>
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDrive, downloadFileStream } from "../src/lib/drive";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`  ok  ${msg}`);
  }
}

async function main() {
  const id = process.argv[2];
  const job = await prisma.mergeJob.findUniqueOrThrow({ where: { id } });
  if (!job.outputDriveFileId) throw new Error("job has no uploaded file");

  const drive = await getDrive();
  const baseline = process.memoryUsage().heapUsed;

  const { stream, size } = await downloadFileStream(drive, job.outputDriveFileId);
  console.log(`file: ${job.outputFilename}`);
  console.log(`Content-Length would be: ${size} (${mb(size ?? 0)} MB)\n`);

  let received = 0;
  let peak = baseline;
  let firstChunkAt = 0;
  const started = Date.now();

  for await (const chunk of stream) {
    if (received === 0) firstChunkAt = Date.now() - started;
    received += (chunk as Buffer).length;
    const heap = process.memoryUsage().heapUsed;
    if (heap > peak) peak = heap;
  }

  const grew = peak - baseline;
  console.log(`bytes received: ${received} (${mb(received)} MB)`);
  console.log(`time to first byte: ${firstChunkAt} ms`);
  console.log(`total time: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`heap growth during transfer: ${mb(grew)} MB\n`);

  assert(size !== null, "Drive reports a size, so Content-Length can be set");
  assert(received === size, `streamed byte count matches the reported size`);
  assert(firstChunkAt < 15000, "bytes start flowing without waiting for the whole file");

  // The decisive check. Streaming should hold a bounded window of chunks no
  // matter how big the file is, so the bound is absolute rather than a
  // fraction of the file — a fraction would silently pass for a large file
  // and fail for a small one. The old buffered path needed roughly three
  // copies of the file (~335 MB here) and died on a 512 MB instance.
  const CEILING = 128 * 1024 * 1024;
  assert(
    grew < CEILING,
    `heap growth ${mb(grew)} MB is within the ${mb(CEILING)} MB ceiling ` +
      `(buffering the same file needed ~${mb(received * 3)} MB)`
  );
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
