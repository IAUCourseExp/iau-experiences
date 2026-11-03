#!/usr/bin/env node
/**
 * Tehran publication timestamp writer.
 *
 * Writes src/last_update.json with the current Asia/Tehran wall-clock time
 * (explicit IANA timezone — never the machine's local timezone). Run as a CLI
 * it behaves exactly as before; the formatting logic is also exported so the
 * release pipeline unit tests can verify it without touching real files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const OUTPUT_FILE = path.join(
  ROOT,
  'src',
  'last_update.json'
);

const tehranFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function getTehranTimestamp(date = new Date()) {
  const parts = Object.fromEntries(
    tehranFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map(({ type, value }) => [type, value])
  );

  const required = [
    'year',
    'month',
    'day',
    'hour',
    'minute',
  ];

  for (const field of required) {
    if (!parts[field]) {
      throw new Error(
        `Missing Tehran date component: ${field}`
      );
    }
  }

  return (
    `${parts.year}/${parts.month}/${parts.day}` +
    ` - ${parts.hour}:${parts.minute}`
  );
}

export function writeReleaseTimestamp(outputPath = OUTPUT_FILE, date = new Date()) {
  if (!fs.existsSync(path.dirname(outputPath))) {
    throw new Error(
      `Output directory does not exist: ${path.dirname(outputPath)}`
    );
  }

  const timestamp = getTehranTimestamp(date);

  const payload = {
    last_update: timestamp,
  };

  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(payload, null, 4)}\n`,
    'utf8'
  );

  return timestamp;
}

function main() {
  const timestamp = writeReleaseTimestamp(OUTPUT_FILE);
  console.log(
    `[release-time] Tehran publication timestamp: ${timestamp}`
  );
  console.log(
    `[release-time] Updated: ${OUTPUT_FILE}`
  );
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error('[release-time] FAILED');
    console.error(error);
    process.exitCode = 1;
  }
}
