import { Suspense, lazy } from 'react';
import { FileText } from 'lucide-react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useFileResourceManagement } from '@/hooks/useFileResourceManagement';
import { agentService } from '@/services/agentService';
import { SettingsUploadModal } from '@/components/ui/SettingsUploadModal';

const AgentsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/AgentsSettingsTab').then((m) => ({
    default: m.AgentsSettingsTab,
  })),
);
const AgentEditDialog = lazy(() =>
  import('@/components/settings/dialogs/AgentEditDialog').then((m) => ({
    default: m.AgentEditDialog,
  })),
);

export function AgentsSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const agentManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_agents',
      itemName: 'Agent',
      maxItems: 10,
      uploadFn: agentService.uploadAgent,
      deleteFn: agentService.deleteAgent,
      updateFn: agentService.updateAgent,
    },
  );

  return (
    <>
      <AgentsSettingsTab
        agents={localSettings.custom_agents ?? null}
        onAddAgent={agentManagement.handleAdd}
        onEditAgent={agentManagement.handleEdit}
        onDeleteAgent={agentManagement.handleDelete}
        onToggleAgent={agentManagement.handleToggle}
      />
      <SettingsUploadModal
        isOpen={agentManagement.isDialogOpen}
        error={agentManagement.uploadError}
        uploading={agentManagement.isUploading}
        onClose={agentManagement.handleDialogClose}
        onUpload={agentManagement.handleUpload}
        title="Upload Agent"
        acceptedExtension=".md"
        icon={FileText}
        hintText="The .md file must include YAML frontmatter with name and description fields. Optional fields: model, allowed_tools."
      />
      {agentManagement.isEditDialogOpen && (
        <Suspense fallback={null}>
          <AgentEditDialog
            isOpen={agentManagement.isEditDialogOpen}
            agent={agentManagement.editingItem}
            error={agentManagement.editError}
            saving={agentManagement.isSavingEdit}
            onClose={agentManagement.handleEditDialogClose}
            onSave={agentManagement.handleSaveEdit}
          />
        </Suspense>
      )}
    </>
  );
}
