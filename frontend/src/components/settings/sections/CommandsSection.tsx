import { Suspense, lazy } from 'react';
import { FileText } from 'lucide-react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useFileResourceManagement } from '@/hooks/useFileResourceManagement';
import { commandService } from '@/services/commandService';
import { SettingsUploadModal } from '@/components/ui/SettingsUploadModal';

const CommandsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/CommandsSettingsTab').then((m) => ({
    default: m.CommandsSettingsTab,
  })),
);
const CommandEditDialog = lazy(() =>
  import('@/components/settings/dialogs/CommandEditDialog').then((m) => ({
    default: m.CommandEditDialog,
  })),
);

export function CommandsSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const commandManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_slash_commands',
      itemName: 'Command',
      maxItems: 10,
      uploadFn: commandService.uploadCommand,
      deleteFn: commandService.deleteCommand,
      updateFn: commandService.updateCommand,
    },
  );

  return (
    <>
      <CommandsSettingsTab
        commands={localSettings.custom_slash_commands ?? null}
        onAddCommand={commandManagement.handleAdd}
        onEditCommand={commandManagement.handleEdit}
        onDeleteCommand={commandManagement.handleDelete}
        onToggleCommand={commandManagement.handleToggle}
      />
      <SettingsUploadModal
        isOpen={commandManagement.isDialogOpen}
        error={commandManagement.uploadError}
        uploading={commandManagement.isUploading}
        onClose={commandManagement.handleDialogClose}
        onUpload={commandManagement.handleUpload}
        title="Upload Slash Command"
        acceptedExtension=".md"
        icon={FileText}
        hintText="The .md file must include YAML frontmatter with name and description fields. Optional fields: argument-hint, allowed-tools, model."
      />
      {commandManagement.isEditDialogOpen && (
        <Suspense fallback={null}>
          <CommandEditDialog
            isOpen={commandManagement.isEditDialogOpen}
            command={commandManagement.editingItem}
            error={commandManagement.editError}
            saving={commandManagement.isSavingEdit}
            onClose={commandManagement.handleEditDialogClose}
            onSave={commandManagement.handleSaveEdit}
          />
        </Suspense>
      )}
    </>
  );
}
