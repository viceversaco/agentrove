import { lazy } from 'react';
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

export function SkillsSection() {
  const { localSettings, persistSettings, setLocalSettings } = useSettingsContext();

  const skillManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_skills',
      itemName: 'Skill',
      maxItems: 10,
      uploadFn: skillService.uploadSkill,
      deleteFn: skillService.deleteSkill,
    },
  );

  return (
    <>
      <SkillsSettingsTab
        skills={localSettings.custom_skills ?? null}
        onAddSkill={skillManagement.handleAdd}
        onDeleteSkill={skillManagement.handleDelete}
        onToggleSkill={skillManagement.handleToggle}
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
    </>
  );
}
