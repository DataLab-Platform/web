#!/usr/bin/env node

import { packOfflinePackage } from "./offline-package-lib.mjs";

try {
  const result = await packOfflinePackage();
  console.log(`[pack-offline-app] wrote ${result.zipPath}`);
  console.log(`[pack-offline-app] SHA-256 ${result.zipSha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
