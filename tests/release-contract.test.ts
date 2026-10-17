import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The release scripts resolve the repository root relative to their own
 * location, so each case copies `scripts/` next to freshly written fixture
 * metadata in a temporary directory and runs the real script with Node.
 */
const scriptsDirectory = fileURLToPath(new URL("../scripts/", import.meta.url));
const temporaryRoots: string[] = [];

interface ReleaseFixture {
  readonly version: string;
  readonly minAppVersion: string;
  readonly versions: Readonly<Record<string, string>>;
}

interface ScriptResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function writeJson(root: string, name: string, value: unknown): void {
  writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
}

function createRepository(fixture: ReleaseFixture): string {
  const root = mkdtempSync(join(tmpdir(), "obmind-release-contract-"));
  temporaryRoots.push(root);
  cpSync(scriptsDirectory, join(root, "scripts"), { recursive: true });
  writeJson(root, "package.json", { name: "obmind", version: fixture.version });
  writeJson(root, "package-lock.json", {
    name: "obmind",
    version: fixture.version,
    lockfileVersion: 3,
    packages: { "": { name: "obmind", version: fixture.version } },
  });
  writeJson(root, "manifest.json", {
    id: "obmind",
    name: "MindBraid",
    version: fixture.version,
    minAppVersion: fixture.minAppVersion,
  });
  writeJson(root, "versions.json", fixture.versions);
  return root;
}

function verifyReleaseVersion(
  fixture: ReleaseFixture,
  args: readonly string[] = [],
): ScriptResult {
  const root = createRepository(fixture);
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "verify-release-version.mjs"), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release contract versions.json rule", () => {
  it("accepts a listed version that maps to the manifest minAppVersion", () => {
    const result = verifyReleaseVersion({
      version: "0.1.5",
      minAppVersion: "1.7.2",
      versions: { "0.1.4": "1.7.2", "0.1.5": "1.7.2" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Release version contract verified: 0.1.5");
  });

  it("rejects a listed version that maps to a different minAppVersion", () => {
    const result = verifyReleaseVersion({
      version: "0.1.5",
      minAppVersion: "1.7.2",
      versions: { "0.1.4": "1.7.2", "0.1.5": "1.6.0" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'versions.json must map "0.1.5" to manifest.json minAppVersion "1.7.2"',
    );
  });

  it("accepts an unlisted version when minAppVersion is unchanged", () => {
    const result = verifyReleaseVersion({
      version: "0.1.6",
      minAppVersion: "1.7.2",
      versions: { "0.1.4": "1.7.2", "0.1.5": "1.7.2" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Release version contract verified: 0.1.6");
  });

  it("compares earlier versions numerically, not as text", () => {
    const result = verifyReleaseVersion({
      version: "0.1.11",
      minAppVersion: "1.7.2",
      versions: { "0.1.9": "1.0.0", "0.1.10": "1.7.2" },
    });

    expect(result.status).toBe(0);
  });

  it("ignores later and non-release keys when finding the baseline", () => {
    const result = verifyReleaseVersion({
      version: "0.1.6",
      minAppVersion: "1.7.2",
      versions: { "0.1.5": "1.7.2", "0.2.0": "1.9.0", "next": "2.0.0" },
    });

    expect(result.status).toBe(0);
  });

  it("requires a new entry when minAppVersion changed", () => {
    const result = verifyReleaseVersion({
      version: "0.1.6",
      minAppVersion: "1.8.0",
      versions: { "0.1.5": "1.7.2" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'manifest.json minAppVersion "1.8.0" differs from "1.7.2" recorded for "0.1.5"',
    );
    expect(result.stderr).toContain('add "0.1.6": "1.8.0" to versions.json');
  });

  it("rejects an unlisted version with no earlier version to inherit from", () => {
    const result = verifyReleaseVersion({
      version: "0.1.0",
      minAppVersion: "1.7.2",
      versions: { "0.2.0": "1.7.2" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'versions.json has no entry for "0.1.0" and no earlier version',
    );
  });
});

describe("release contract tag rule", () => {
  const fixture: ReleaseFixture = {
    version: "0.1.5",
    minAppVersion: "1.7.2",
    versions: { "0.1.5": "1.7.2" },
  };

  it("accepts a tag that equals the package version", () => {
    const result = verifyReleaseVersion(fixture, ["--tag", "0.1.5"]);

    expect(result.status).toBe(0);
  });

  it("rejects a tag that differs from the package version", () => {
    const result = verifyReleaseVersion(fixture, ["--tag", "0.1.6"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Release tag "0.1.6" must equal package.json version "0.1.5"',
    );
  });

  it("rejects a tag with a v prefix", () => {
    const result = verifyReleaseVersion(fixture, ["--tag", "v0.1.5"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("without a v prefix");
  });
});
