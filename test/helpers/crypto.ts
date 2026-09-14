// test/helpers/crypto.ts
import { MajikKey, MnemonicJSON } from "@majikah/majik-key";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Generates a fresh, fully-upgraded, and UNLOCKED MajikKey for testing.
 * Uses a 128-bit mnemonic for faster test execution.
 */
export async function generateTestKey(): Promise<MajikKey> {
  // Return a pre-seeded or quickly generated key for testing

  const testPassphrase = "test_passphrase";

  const generatedMnemonic = await MajikKey.generateMnemonic();

  const key = await MajikKey.create(
    generatedMnemonic,
    testPassphrase,
    "Test Account",
  );

  return key;
}

export async function getTestKey(): Promise<MajikKey> {
  const jsonPath = resolve(process.cwd(), "_key/_self.json");
  const fileContent = await readFile(jsonPath, "utf-8");
  const json: MnemonicJSON = JSON.parse(fileContent);

  return loadTestKeyFromJSON(json);
}

/**
 * Generates a fresh, fully-upgraded, and UNLOCKED MajikKey for testing.
 * Uses a 128-bit mnemonic for faster test execution.
 */
export async function loadTestKeyFromJSON(
  json: MnemonicJSON,
): Promise<MajikKey> {
  // Return a pre-seeded or quickly generated key for testing

  const testPassphrase = "test_passphrase";

  const key = await MajikKey.importFromMnemonicBackup(
    json.id,
    json.seed.join(" "),
    testPassphrase,
    "Test Account",
    {
      mnemonicLanguage: json.language,
    },
  );

  console.log("Key Imported: ", key.fingerprint);

  return key;
}
