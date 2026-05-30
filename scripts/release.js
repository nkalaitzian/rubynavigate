#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline");

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed${details ? `: ${details}` : ""}`,
    );
  }

  return result;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    force:
      argv.includes("--force") || argv.includes("--yes") || argv.includes("-y"),
  };
}

async function confirmRecreate(tag) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) =>
    rl.question(
      `Tag ${tag} already exists locally. Delete and recreate it? (y/N) `,
      resolve,
    ),
  );
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;
  const tag = `v${version}`;

  runGit(["rev-parse", "--is-inside-work-tree"]);

  console.log(`Preparing to release version ${version} (tag: ${tag})...`);
  if (args.dryRun) {
    console.log(
      "Dry run enabled. No tags will be created, deleted, or pushed.",
    );
  }

  const existingTag = runGit(["tag", "-l", tag]).stdout.trim();
  if (existingTag) {
    let shouldRecreate = args.force;
    if (!shouldRecreate) {
      shouldRecreate = await confirmRecreate(tag);
    }

    if (!shouldRecreate) {
      console.error("Release aborted.");
      process.exit(1);
    }

    if (args.dryRun) {
      console.log(`[dry-run] Would delete local tag ${tag}`);
      console.log(`[dry-run] Would delete remote tag ${tag} (if present)`);
    } else {
      console.log(`Deleting local tag ${tag}...`);
      runGit(["tag", "-d", tag], { stdio: "inherit" });
      console.log(`Deleting remote tag ${tag}...`);
      runGit(["push", "origin", "--delete", tag], {
        stdio: "inherit",
        allowFailure: true,
      });
    }
  }

  if (args.dryRun) {
    console.log(`[dry-run] Would create tag ${tag}`);
    console.log(`[dry-run] Would push tag ${tag} to origin`);
    console.log(`Done! Dry run completed for tag ${tag}.`);
    return;
  }

  console.log(`Creating tag ${tag}...`);
  runGit(["tag", tag], { stdio: "inherit" });
  console.log("Pushing tag to remote...");
  runGit(["push", "origin", tag], { stdio: "inherit" });
  console.log(`Done! Tag ${tag} has been created and pushed.`);
  console.log(
    "The GitHub Actions workflow will now build and publish the extension.",
  );
}

main().catch((error) => {
  console.error(`Release failed: ${error.message}`);
  process.exit(1);
});
