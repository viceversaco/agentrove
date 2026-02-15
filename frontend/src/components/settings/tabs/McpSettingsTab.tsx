import { Switch } from '@/components/ui/primitives/Switch';
import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomMcp } from '@/types/user.types';
import { Plug } from 'lucide-react';

interface McpSettingsTabProps {
  mcps: CustomMcp[] | null;
  onAddMcp: () => void;
  onEditMcp: (index: number) => void;
  onDeleteMcp: (index: number) => void | Promise<void>;
  onToggleMcp: (index: number, enabled: boolean) => void;
}

const getCommandTypeBadge = (commandType: string): string => {
  switch (commandType) {
    case 'npx':
      return 'NPX';
    case 'bunx':
      return 'Bunx';
    case 'uvx':
      return 'uvx';
    case 'http':
      return 'HTTP';
    default:
      return commandType.toUpperCase();
  }
};

export const McpSettingsTab: React.FC<McpSettingsTabProps> = ({
  mcps,
  onAddMcp,
  onEditMcp,
  onDeleteMcp,
  onToggleMcp,
}) => {
  return (
    <ListManagementTab<CustomMcp>
      title="Custom MCP Servers"
      description="Configure custom Model Context Protocol (MCP) servers to extend Claude's capabilities. MCP servers can provide tools, resources, and prompts for specialized tasks."
      items={mcps}
      emptyIcon={Plug}
      emptyText="No custom MCP servers configured yet"
      emptyButtonText="Add Your First MCP Server"
      addButtonText="Add MCP Server"
      deleteConfirmTitle="Delete MCP Server"
      deleteConfirmMessage={(mcp) =>
        `Are you sure you want to delete "${mcp.name}"? This action cannot be undone.`
      }
      getItemKey={(mcp) => mcp.name}
      onAdd={onAddMcp}
      onEdit={onEditMcp}
      onDelete={onDeleteMcp}
      renderItem={(mcp, index) => (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-xs font-medium text-text-primary dark:text-text-dark-primary sm:max-w-[250px]">
              {mcp.name}
            </h3>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-2xs text-text-quaternary dark:border-border-dark dark:text-text-dark-quaternary">
              {getCommandTypeBadge(mcp.command_type)}
            </span>
            <Switch
              checked={mcp.enabled ?? true}
              onCheckedChange={(checked) => onToggleMcp(index, checked)}
              size="sm"
              aria-label={`Toggle ${mcp.name} MCP server`}
            />
          </div>
          {mcp.description && (
            <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {mcp.description}
            </p>
          )}
          <div className="mt-2 space-y-0.5">
            {(mcp.command_type === 'npx' ||
              mcp.command_type === 'bunx' ||
              mcp.command_type === 'uvx') &&
              mcp.package && (
                <p className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {mcp.package}
                </p>
              )}
            {mcp.command_type === 'http' && mcp.url && (
              <p className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {mcp.url}
              </p>
            )}
            {mcp.env_vars && Object.keys(mcp.env_vars).length > 0 && (
              <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {Object.keys(mcp.env_vars).length} env var
                {Object.keys(mcp.env_vars).length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </>
      )}
      logContext="McpSettingsTab"
    />
  );
};
