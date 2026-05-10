import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDatabase, sandboxSettings, projects, chats } from '../../db';
import { publicProcedure, router } from '../index';
import { detectSandboxCapabilities, osSandboxAvailable, resolveSandboxPolicy } from '../../sandbox/policy';

type JsonMap = Record<string, unknown>;

function asObject(value: unknown): JsonMap | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonMap) : null;
}

function readStringSettingSource(value: unknown, expected: string, source: string | null): string | null {
  return value === expected ? source : null;
}

function readBooleanSettingSource(value: unknown, expected: boolean, source: string | null): string | null {
  return value === expected ? source : null;
}

async function readJsoncFile(filePath: string): Promise<JsonMap | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseJsonc(content);
    return asObject(parsed);
  } catch {
    return null;
  }
}

export async function readCodexBypassReason(
  configPath = path.join(os.homedir(), '.codex', 'config.toml')
): Promise<string | null> {
  try {
    const toml = await fs.readFile(configPath, 'utf8');
    const topLevelOnly = toml.split(/^\s*\[/m, 1)[0] ?? '';
    if (/^\s*sandbox_mode\s*=\s*"danger-full-access"/m.test(topLevelOnly)) {
      return 'Codex config (~/.codex/config.toml) sets top-level sandbox_mode = "danger-full-access".';
    }
  } catch {
    // Ignore missing or unreadable user config.
  }

  return null;
}

export async function readClaudeBypassReasons(claudeDir = path.join(os.homedir(), '.claude')): Promise<string[]> {
  const settingsPath = path.join(claudeDir, 'settings.json');
  const localSettingsPath = path.join(claudeDir, 'settings.local.json');
  const [settings, localSettings] = await Promise.all([readJsoncFile(settingsPath), readJsoncFile(localSettingsPath)]);

  const settingsSandbox = asObject(settings?.sandbox);
  const localSandbox = asObject(localSettings?.sandbox);
  const settingsPermissions = asObject(settings?.permissions);
  const localPermissions = asObject(localSettings?.permissions);

  const sandboxDisabledSource =
    readBooleanSettingSource(localSandbox?.enabled, false, '~/.claude/settings.local.json') ??
    readBooleanSettingSource(settingsSandbox?.enabled, false, '~/.claude/settings.json');
  const bypassPermissionsSource =
    readStringSettingSource(localPermissions?.defaultMode, 'bypassPermissions', '~/.claude/settings.local.json') ??
    readStringSettingSource(settingsPermissions?.defaultMode, 'bypassPermissions', '~/.claude/settings.json');

  const reasons: string[] = [];
  if (sandboxDisabledSource) {
    reasons.push(`Claude config (${sandboxDisabledSource}) sets sandbox.enabled = false.`);
  }
  if (bypassPermissionsSource) {
    reasons.push(`Claude config (${bypassPermissionsSource}) sets permissions.defaultMode = "bypassPermissions".`);
  }

  return reasons;
}

export const sandboxRouter = router({
  getSettings: publicProcedure.query(async () => {
    const db = getDatabase();
    const settings = db.select().from(sandboxSettings).where(eq(sandboxSettings.id, 'singleton')).get();

    return (
      settings ?? {
        id: 'singleton',
        sandboxEnabled: true,
        extraWritablePaths: '[]',
        extraDeniedPaths: '[]',
        allowToolchainCaches: true,
        updatedAt: null
      }
    );
  }),

  setSettings: publicProcedure
    .input(
      z.object({
        sandboxEnabled: z.boolean().optional(),
        extraWritablePaths: z.string().optional(),
        extraDeniedPaths: z.string().optional(),
        allowToolchainCaches: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const existing = db.select().from(sandboxSettings).where(eq(sandboxSettings.id, 'singleton')).get();

      if (existing) {
        db.update(sandboxSettings)
          .set({
            ...(input.sandboxEnabled !== undefined && {
              sandboxEnabled: input.sandboxEnabled
            }),
            ...(input.extraWritablePaths !== undefined && {
              extraWritablePaths: input.extraWritablePaths
            }),
            ...(input.extraDeniedPaths !== undefined && {
              extraDeniedPaths: input.extraDeniedPaths
            }),
            ...(input.allowToolchainCaches !== undefined && {
              allowToolchainCaches: input.allowToolchainCaches
            }),
            updatedAt: new Date()
          })
          .where(eq(sandboxSettings.id, 'singleton'))
          .run();
      } else {
        db.insert(sandboxSettings)
          .values({
            id: 'singleton',
            sandboxEnabled: input.sandboxEnabled ?? true,
            extraWritablePaths: input.extraWritablePaths ?? '[]',
            extraDeniedPaths: input.extraDeniedPaths ?? '[]',
            allowToolchainCaches: input.allowToolchainCaches ?? true,
            updatedAt: new Date()
          })
          .run();
      }
      return { ok: true };
    }),

  getCapabilities: publicProcedure.query(async () => {
    const caps = detectSandboxCapabilities();
    return {
      ...caps,
      osSandboxAvailable: osSandboxAvailable(),
      platform: process.platform
    };
  }),

  getBypassReasons: publicProcedure.query(async () => {
    const reasons: string[] = [];
    const db = getDatabase();
    const settings = db.select().from(sandboxSettings).where(eq(sandboxSettings.id, 'singleton')).get();

    if (settings?.sandboxEnabled === false) {
      reasons.push('Churro Coder’s "Enable sandbox by default" toggle is off.');
    }

    const codexReason = await readCodexBypassReason();
    if (codexReason) {
      reasons.push(codexReason);
    }

    reasons.push(...(await readClaudeBypassReasons()));

    return { reasons };
  }),

  getStatus: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        cwd: z.string(),
        projectPath: z.string().optional()
      })
    )
    .query(async ({ input }) => {
      const policy = await resolveSandboxPolicy(input.chatId, input.cwd, input.projectPath ?? input.cwd);
      return {
        enabled: policy.enabled,
        osSandboxAvailable: policy.osSandboxAvailable,
        degraded: policy.enabled && !policy.osSandboxAvailable
      };
    }),

  setProjectOverride: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sandboxEnabled: z.boolean().nullable()
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      db.update(projects).set({ sandboxEnabled: input.sandboxEnabled }).where(eq(projects.id, input.projectId)).run();
      return { ok: true };
    }),

  setChatOverride: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        sandboxEnabled: z.boolean().nullable()
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      db.update(chats).set({ sandboxEnabled: input.sandboxEnabled }).where(eq(chats.id, input.chatId)).run();
      return { ok: true };
    })
});
