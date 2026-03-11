import { Suspense, lazy } from 'react';
import { FileArchive } from 'lucide-react';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { useFileResourceManagement } from '@/hooks/useFileResourceManagement';
import { skillService } from '@/services/skillService';
import { SettingsUploadModal } from '@/components/ui/SettingsUploadModal';

const SkillsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/SkillsSettingsTab').then((m) => ({
    default: m.SkillsSettingsTab,
  })),
);
const SkillEditDialog = lazy(() =>
  import('@/components/settings/dialogs/SkillEditDialog').then((m) => ({
    default: m.SkillEditDialog,
  })),
);

export function SkillsSection() {
  const { localSettings, setLocalSettings } = useSettingsContext();

  const skillManagement = useFileResourceManagement(localSettings, setLocalSettings, {
    settingsKey: 'custom_skills',
    itemName: 'Skill',
    uploadFn: skillService.uploadSkill,
    deleteFn: skillService.deleteSkill,
    updateFn: skillService.updateSkill,
  });

  return (
    <>
      <SkillsSettingsTab
        skills={localSettings.custom_skills ?? null}
        onAddSkill={skillManagement.handleAdd}
        onEditSkill={skillManagement.handleEdit}
        onDeleteSkill={skillManagement.handleDelete}
      />
      <SettingsUploadModal
        isOpen={skillManagement.isDialogOpen}
        error={skillManagement.uploadError}
        uploading={skillManagement.isUploading}
        onClose={skillManagement.handleDialogClose}
        onUpload={skillManagement.handleUpload}
        title="Upload Skill"
        acceptedExtension=".zip"
        icon={FileArchive}
        hintText="The ZIP must contain a SKILL.md file with YAML frontmatter including name and description fields."
      />
      {skillManagement.isEditDialogOpen && (
        <Suspense fallback={null}>
          <SkillEditDialog
            isOpen={skillManagement.isEditDialogOpen}
            skill={skillManagement.editingItem}
            error={skillManagement.editError}
            saving={skillManagement.isSavingEdit}
            onClose={skillManagement.handleEditDialogClose}
            onSave={skillManagement.handleSaveEdit}
          />
        </Suspense>
      )}
    </>
  );
}
