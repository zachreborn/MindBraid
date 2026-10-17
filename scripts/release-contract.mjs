import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const strictReleaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Read and validate the version values which must stay synchronized for an
 * installable Community Plugin release.
 *
 * This intentionally has no package dependencies so CI can fail early with a
 * specific message when release metadata drifts.
 */
export async function loadReleaseContract() {
	const [packageMetadata, manifest, versions, lockfile] = await Promise.all([
		readJson("package.json"),
		readJson("manifest.json"),
		readJson("versions.json"),
		readJson("package-lock.json"),
	]);

	if (!isRecord(packageMetadata) || !isNonEmptyString(packageMetadata.version)) {
		throw new Error("package.json must define a non-empty string version.");
	}
	if (!isRecord(manifest) || !isNonEmptyString(manifest.version)) {
		throw new Error("manifest.json must define a non-empty string version.");
	}
	if (!isRecord(manifest) || !isNonEmptyString(manifest.minAppVersion)) {
		throw new Error("manifest.json must define a non-empty string minAppVersion.");
	}
	if (!isRecord(versions)) {
		throw new Error("versions.json must contain a JSON object.");
	}
	if (!isRecord(lockfile) || !isNonEmptyString(lockfile.version)) {
		throw new Error("package-lock.json must define a non-empty root version.");
	}
	if (!isRecord(lockfile.packages) || !isRecord(lockfile.packages[""])) {
		throw new Error("package-lock.json must define packages[\"\"].");
	}

	const version = packageMetadata.version;
	if (!strictReleaseVersionPattern.test(version)) {
		throw new Error(
			`package.json version ${JSON.stringify(version)} must use strict x.y.z SemVer ` +
				"for an Obsidian release.",
		);
	}
	if (manifest.version !== version) {
		throw new Error(
			`manifest.json version ${JSON.stringify(manifest.version)} must equal ` +
				`package.json version ${JSON.stringify(version)}.`,
		);
	}
	if (lockfile.version !== version) {
		throw new Error(
			`package-lock.json version ${JSON.stringify(lockfile.version)} must equal ` +
				`package.json version ${JSON.stringify(version)}.`,
		);
	}
	if (lockfile.packages[""].version !== version) {
		throw new Error(
			`package-lock.json packages[""].version ` +
				`${JSON.stringify(lockfile.packages[""].version)} must equal package.json version ` +
				`${JSON.stringify(version)}.`,
		);
	}
	assertVersionsMapping(versions, version, manifest.minAppVersion);

	return {
		manifest,
		minimumAppVersion: manifest.minAppVersion,
		version,
	};
}

export function assertReleaseTag(tag, version) {
	if (!strictReleaseVersionPattern.test(tag)) {
		throw new Error(
			`Release tag ${JSON.stringify(tag)} must use strict x.y.z SemVer without a v prefix.`,
		);
	}
	if (tag !== version) {
		throw new Error(
			`Release tag ${JSON.stringify(tag)} must equal package.json version ` +
				`${JSON.stringify(version)}.`,
		);
	}
}

/**
 * Check the `versions.json` fallback table the way Obsidian uses it.
 *
 * Obsidian only consults `versions.json` when a user's app is older than the
 * manifest's `minAppVersion`, and its documentation says an entry is needed
 * only when `minAppVersion` changes. A listed version must therefore agree
 * with the manifest, while an unlisted version is acceptable as long as the
 * closest earlier listed version requires the same minimum app version.
 */
function assertVersionsMapping(versions, version, minAppVersion) {
	if (Object.hasOwn(versions, version)) {
		if (versions[version] !== minAppVersion) {
			throw new Error(
				`versions.json must map ${JSON.stringify(version)} to manifest.json minAppVersion ` +
					`${JSON.stringify(minAppVersion)}.`,
			);
		}
		return;
	}

	const baseline = findNearestEarlierVersion(versions, version);
	if (baseline === undefined) {
		throw new Error(
			`versions.json has no entry for ${JSON.stringify(version)} and no earlier version ` +
				`to inherit minAppVersion from; add ${JSON.stringify(version)}: ` +
				`${JSON.stringify(minAppVersion)}.`,
		);
	}
	if (versions[baseline] !== minAppVersion) {
		throw new Error(
			`manifest.json minAppVersion ${JSON.stringify(minAppVersion)} differs from ` +
				`${JSON.stringify(versions[baseline])} recorded for ${JSON.stringify(baseline)} ` +
				`in versions.json; add ${JSON.stringify(version)}: ${JSON.stringify(minAppVersion)} ` +
				"to versions.json.",
		);
	}
}

function findNearestEarlierVersion(versions, version) {
	const target = parseReleaseVersion(version);
	let nearest;
	let nearestParts;
	for (const candidate of Object.keys(versions)) {
		const parts = parseReleaseVersion(candidate);
		if (parts === undefined || compareVersionParts(parts, target) >= 0) {
			continue;
		}
		if (nearestParts === undefined || compareVersionParts(parts, nearestParts) > 0) {
			nearest = candidate;
			nearestParts = parts;
		}
	}
	return nearest;
}

function parseReleaseVersion(value) {
	const match = strictReleaseVersionPattern.exec(value);
	return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionParts(left, right) {
	for (let index = 0; index < 3; index += 1) {
		const difference = left[index] - right[index];
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

export function repositoryFileUrl(relativePath) {
	return new URL(relativePath, repositoryRoot);
}

async function readJson(relativePath) {
	let text;
	try {
		text = await readFile(repositoryFileUrl(relativePath), "utf8");
	} catch (error) {
		throw new Error(`Cannot read ${relativePath}.`, { cause: error });
	}

	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`Cannot parse ${relativePath} as JSON.`, { cause: error });
	}
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}
