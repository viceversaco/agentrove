import { Suspense, lazy } from 'react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { mcpService } from '@/services/mcpService';
import { createDefaultMcpForm, validateMcpForm } from '@/utils/settings';

const McpSettingsTab = lazy(() =>
  import('@/components/settings/tabs/McpSettingsTab').then((m) => ({
    default: m.McpSettingsTab,
  })),
);
const McpDialog = lazy(() =>
  import('@/components/settings/dialogs/McpDialog').then((m) => ({ default: m.McpDialog })),
);

export function McpSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const mcpCrud = useCrudForm(localSettings, persistSettings, setLocalSettings, {
    createDefault: createDefaultMcpForm,
    validateForm: (form, editingIndex) =>
      validateMcpForm(form, editingIndex, localSettings.custom_mcps || []),
    getArrayKey: 'custom_mcps',
    itemName: 'MCP',
    createFn: mcpService.createMcp,
    updateFn: mcpService.updateMcp,
    deleteFn: mcpService.deleteMcp,
    toggleFn: (name, enabled) => mcpService.updateMcp(name, { enabled }),
  });

  return (
    <>
      <McpSettingsTab
        mcps={localSettings.custom_mcps ?? null}
        onAddMcp={mcpCrud.handleAdd}
        onEditMcp={mcpCrud.handleEdit}
        onDeleteMcp={mcpCrud.handleDelete}
        onToggleMcp={mcpCrud.handleToggleEnabled}
      />
      {mcpCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <McpDialog
            isOpen={mcpCrud.isDialogOpen}
            isEditing={mcpCrud.editingIndex !== null}
            mcp={mcpCrud.form}
            error={mcpCrud.formError}
            onClose={mcpCrud.handleDialogClose}
            onSubmit={mcpCrud.handleSave}
            onMcpChange={mcpCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
