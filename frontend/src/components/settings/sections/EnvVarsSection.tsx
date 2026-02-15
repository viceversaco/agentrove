import { Suspense, lazy } from 'react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useCrudForm } from '@/hooks/useCrudForm';
import { createDefaultEnvVarForm, validateEnvVarForm } from '@/utils/settings';

const EnvVarsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/EnvVarsSettingsTab').then((m) => ({
    default: m.EnvVarsSettingsTab,
  })),
);
const EnvVarDialog = lazy(() =>
  import('@/components/settings/dialogs/EnvVarDialog').then((m) => ({ default: m.EnvVarDialog })),
);

export function EnvVarsSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const envVarCrud = useCrudForm(localSettings, persistSettings, setLocalSettings, {
    createDefault: createDefaultEnvVarForm,
    validateForm: (form, editingIndex) =>
      validateEnvVarForm(form, editingIndex, localSettings.custom_env_vars || []),
    getArrayKey: 'custom_env_vars',
    itemName: 'environment variable',
  });

  return (
    <>
      <EnvVarsSettingsTab
        envVars={localSettings.custom_env_vars ?? null}
        onAddEnvVar={envVarCrud.handleAdd}
        onEditEnvVar={envVarCrud.handleEdit}
        onDeleteEnvVar={envVarCrud.handleDelete}
      />
      {envVarCrud.isDialogOpen && (
        <Suspense fallback={null}>
          <EnvVarDialog
            isOpen={envVarCrud.isDialogOpen}
            isEditing={envVarCrud.editingIndex !== null}
            envVar={envVarCrud.form}
            error={envVarCrud.formError}
            onClose={envVarCrud.handleDialogClose}
            onSubmit={envVarCrud.handleSave}
            onEnvVarChange={envVarCrud.handleFormChange}
          />
        </Suspense>
      )}
    </>
  );
}
