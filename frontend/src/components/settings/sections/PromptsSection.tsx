import { Suspense, lazy } from 'react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import type { CustomPrompt } from '@/types/user.types';

const PromptsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/PromptsSettingsTab').then((m) => ({
    default: m.PromptsSettingsTab,
  })),
);
const PromptEditDialog = lazy(() =>
  import('@/components/settings/dialogs/PromptEditDialog').then((m) => ({
    default: m.PromptEditDialog,
  })),
);

export function PromptsSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const promptCrud = useCrudForm<CustomPrompt>(localSettings, persistSettings, setLocalSettings, {
    createDefault: (): CustomPrompt => ({ name: '', content: '' }),
    validateForm: (form, editingIndex) => {
      if (!form.name.trim()) return 'Name is required';
      if (!form.content.trim()) return 'Content is required';
      const prompts = localSettings.custom_prompts || [];
      const duplicate = prompts.some((p, i) => p.name === form.name.trim() && i !== editingIndex);
      if (duplicate) return 'A prompt with this name already exists';
      return null;
    },
    getArrayKey: 'custom_prompts',
    itemName: 'prompt',
  });

  return (
    <>
      <PromptsSettingsTab
        prompts={localSettings.custom_prompts ?? null}
        onAddPrompt={promptCrud.handleAdd}
        onEditPrompt={promptCrud.handleEdit}
        onDeletePrompt={promptCrud.handleDelete}
      />
      {promptCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <PromptEditDialog
            isOpen={promptCrud.isDialogOpen}
            isEditing={promptCrud.editingIndex !== null}
            prompt={promptCrud.form}
            error={promptCrud.formError}
            onClose={promptCrud.handleDialogClose}
            onSubmit={promptCrud.handleSave}
            onPromptChange={promptCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
