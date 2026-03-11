import type {
  CustomAgent,
  CustomCommand,
  CustomEnvVar,
  CustomMcp,
  CustomSkill,
} from '@/types/user.types';
import type { GeneralSecretFieldConfig } from '@/types/settings.types';
import { validateRequired, validateRequiredIf, validateUnique } from '@/utils/validation';
import { BUILT_IN_AGENTS } from '@/config/constants';

export const mergeByName = <T extends { name: string }>(primary: T[], secondary: T[]): T[] => {
  if (!secondary.length) return primary;
  const primaryNames = new Set(primary.map((item) => item.name.toLowerCase()));
  return [...primary, ...secondary.filter((item) => !primaryNames.has(item.name.toLowerCase()))];
};

export const mergeAgents = (customAgents: CustomAgent[] | null | undefined): CustomAgent[] => {
  return mergeByName(BUILT_IN_AGENTS, customAgents ?? []);
};

export const mergeCommands = (
  settingsCommands: CustomCommand[] | null | undefined,
  settingsSkills: CustomSkill[] | null | undefined,
  workspaceCommands?: CustomCommand[] | null,
  workspaceSkills?: CustomSkill[] | null,
): CustomCommand[] => {
  const commands = mergeByName(settingsCommands ?? [], workspaceCommands ?? []);
  const skills = mergeByName(settingsSkills ?? [], workspaceSkills ?? []);
  const skillsAsCommands = skills.map((s) => ({
    name: s.name,
    description: s.description,
    content: '',
  }));
  return mergeByName(commands, skillsAsCommands);
};

export const createDefaultEnvVarForm = (): CustomEnvVar => ({
  key: '',
  value: '',
});

export const validateEnvVarForm = (
  form: CustomEnvVar,
  editingIndex: number | null,
  existingItems: CustomEnvVar[],
): string | null => {
  try {
    validateRequired(form.key, 'Environment variable name');
    validateRequired(form.value, 'Environment variable value');
    validateUnique(
      'key',
      form.key,
      existingItems,
      editingIndex,
      'environment variable with this name',
      'An',
      false,
    );

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Validation failed';
  }
};

export const createDefaultMcpForm = (): CustomMcp => ({
  name: '',
  description: '',
  command_type: 'npx',
  enabled: true,
});

export const validateMcpForm = (
  form: CustomMcp,
  editingIndex: number | null,
  existingItems: CustomMcp[],
): string | null => {
  try {
    validateRequired(form.name, 'MCP server name');
    validateRequired(form.description, 'MCP server description');

    const isPackageCommand =
      form.command_type === 'npx' || form.command_type === 'bunx' || form.command_type === 'uvx';
    if (isPackageCommand) {
      const typeMap: Record<'npx' | 'bunx' | 'uvx', string> = {
        npx: 'NPX',
        bunx: 'Bunx',
        uvx: 'uvx',
      };
      const suffix = `for ${typeMap[form.command_type as 'npx' | 'bunx' | 'uvx']} MCP servers`;
      validateRequiredIf(form.package, 'Package name', true, suffix);
    }

    if (form.command_type === 'http') {
      validateRequiredIf(form.url, 'URL', true, 'for HTTP MCP servers');
    }

    validateUnique(
      'name',
      form.name,
      existingItems,
      editingIndex,
      'MCP server with this name',
      'An',
    );

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Validation failed';
  }
};

export const getGeneralSecretFields = (): GeneralSecretFieldConfig[] => [
  {
    key: 'github_personal_access_token',
    label: 'GitHub Personal Access Token',
    description: 'Required for GitHub integrations and repository access',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    helperText: {
      prefix: 'Generate a token at',
      anchorText: 'GitHub Settings',
      href: 'https://github.com/settings/tokens',
    },
  },
];
