import { Switch } from '@/components/ui/primitives/Switch';
import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomAgent } from '@/types/user.types';
import { Bot } from 'lucide-react';

interface AgentsSettingsTabProps {
  agents: CustomAgent[] | null;
  onAddAgent: () => void;
  onEditAgent: (index: number) => void;
  onDeleteAgent: (index: number) => void | Promise<void>;
  onToggleAgent: (index: number, enabled: boolean) => void;
}

export const AgentsSettingsTab: React.FC<AgentsSettingsTabProps> = ({
  agents,
  onAddAgent,
  onEditAgent,
  onDeleteAgent,
  onToggleAgent,
}) => {
  return (
    <ListManagementTab<CustomAgent>
      title="Custom Agents"
      description="Create custom AI agents with specific instructions and behaviors. Agents can be invoked during conversations to handle specialized tasks."
      items={agents}
      emptyIcon={Bot}
      emptyText="No custom agents configured yet"
      emptyButtonText="Create Your First Agent"
      addButtonText="Add Agent"
      deleteConfirmTitle="Delete Agent"
      deleteConfirmMessage={(agent) =>
        `Are you sure you want to delete "${agent.name}"? This action cannot be undone.`
      }
      getItemKey={(agent) => agent.name}
      onAdd={onAddAgent}
      onEdit={onEditAgent}
      onDelete={onDeleteAgent}
      renderItem={(agent, index) => (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-xs font-medium text-text-primary dark:text-text-dark-primary sm:max-w-[250px]">
              {agent.name}
            </h3>
            <Switch
              checked={agent.enabled ?? true}
              onCheckedChange={(checked) => onToggleAgent(index, checked)}
              size="sm"
              aria-label={`Toggle ${agent.name} agent`}
            />
          </div>
          {agent.description && (
            <p className="mb-2 line-clamp-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {agent.description}
            </p>
          )}
          <p className="line-clamp-2 font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {agent.content}
          </p>
        </>
      )}
      logContext="AgentsSettingsTab"
    />
  );
};
