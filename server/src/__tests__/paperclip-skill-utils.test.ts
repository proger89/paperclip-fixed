import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPaperclipSkillLink,
  ensurePaperclipSkillSymlink,
  listPaperclipSkillEntries,
  removeMaintainerOnlySkillSymlinks,
} from "@paperclipai/adapter-utils/server-utils";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("paperclip skill utils", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("lists runtime skills from ./skills without pulling in .agents/skills", async () => {
    const root = await makeTempDir("paperclip-skill-roots-");
    cleanupDirs.add(root);

    const moduleDir = path.join(root, "a", "b", "c", "d", "e");
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.mkdir(path.join(root, "skills", "paperclip"), { recursive: true });
    await fs.mkdir(path.join(root, ".agents", "skills", "release"), { recursive: true });

    const entries = await listPaperclipSkillEntries(moduleDir);

    expect(entries.map((entry) => entry.key)).toEqual(["paperclipai/paperclip/paperclip"]);
    expect(entries.map((entry) => entry.runtimeName)).toEqual(["paperclip"]);
    expect(entries[0]?.source).toBe(path.join(root, "skills", "paperclip"));
  });

  it("removes stale maintainer-only symlinks from a shared skills home", async () => {
    const root = await makeTempDir("paperclip-skill-cleanup-");
    cleanupDirs.add(root);

    const skillsHome = path.join(root, "skills-home");
    const runtimeSkill = path.join(root, "skills", "paperclip");
    const customSkill = path.join(root, "custom", "release-notes");
    const staleMaintainerSkill = path.join(root, ".agents", "skills", "release");

    await fs.mkdir(skillsHome, { recursive: true });
    await fs.mkdir(runtimeSkill, { recursive: true });
    await fs.mkdir(customSkill, { recursive: true });

    await createPaperclipSkillLink(runtimeSkill, path.join(skillsHome, "paperclip"));
    await createPaperclipSkillLink(customSkill, path.join(skillsHome, "release-notes"));
    await createPaperclipSkillLink(staleMaintainerSkill, path.join(skillsHome, "release"));

    const removed = await removeMaintainerOnlySkillSymlinks(skillsHome, ["paperclip"]);

    expect(removed).toEqual(["release"]);
    await expect(fs.lstat(path.join(skillsHome, "release"))).rejects.toThrow();
    expect((await fs.lstat(path.join(skillsHome, "paperclip"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "release-notes"))).isSymbolicLink()).toBe(true);
  });

  it("treats duplicate links to the same runtime skill as idempotent", async () => {
    const root = await makeTempDir("paperclip-skill-idempotent-");
    cleanupDirs.add(root);

    const runtimeSkill = path.join(root, "skills", "paperclip");
    const skillsHome = path.join(root, "skills-home");
    const target = path.join(skillsHome, "paperclip");
    await fs.mkdir(runtimeSkill, { recursive: true });
    await fs.mkdir(skillsHome, { recursive: true });

    await createPaperclipSkillLink(runtimeSkill, target);
    await expect(createPaperclipSkillLink(runtimeSkill, target)).resolves.toBeUndefined();
    await expect(fs.realpath(target)).resolves.toBe(path.resolve(runtimeSkill));
  });

  it("handles a concurrent skill-link race as a created-or-skipped no-op", async () => {
    const root = await makeTempDir("paperclip-skill-race-");
    cleanupDirs.add(root);

    const runtimeSkill = path.join(root, "skills", "paperclip");
    const skillsHome = path.join(root, "skills-home");
    const target = path.join(skillsHome, "paperclip");
    await fs.mkdir(runtimeSkill, { recursive: true });
    await fs.mkdir(skillsHome, { recursive: true });

    let injectedByRace = false;
    const result = await ensurePaperclipSkillSymlink(runtimeSkill, target, async (source, destination) => {
      if (!injectedByRace) {
        injectedByRace = true;
        await createPaperclipSkillLink(source, destination);
      }
      await createPaperclipSkillLink(source, destination);
    });

    expect(result).toBe("created");
    await expect(fs.realpath(target)).resolves.toBe(path.resolve(runtimeSkill));
  });
});
