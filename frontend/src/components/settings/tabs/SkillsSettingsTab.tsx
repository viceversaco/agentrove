import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomSkill } from '@/types/user.types';
import { Zap } from 'lucide-react';

interface SkillsSettingsTabProps {
  skills: CustomSkill[] | null;
  onAddSkill: () => void;
  onEditSkill: (index: number) => void;
  onDeleteSkill: (index: number) => void | Promise<void>;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const SkillsSettingsTab: React.FC<SkillsSettingsTabProps> = ({
  skills,
  onAddSkill,
  onEditSkill,
  onDeleteSkill,
}) => {
  return (
    <ListManagementTab<CustomSkill>
      title="Custom Skills"
      description="Upload custom skills as ZIP files. Skills will be available in `.claude/skills/` directory."
      items={skills}
      emptyIcon={Zap}
      emptyText="No custom skills uploaded yet"
      emptyButtonText="Upload Your First Skill"
      addButtonText="Upload Skill"
      deleteConfirmTitle="Delete Skill"
      deleteConfirmMessage={(skill) =>
        `Are you sure you want to delete "${skill.name}"? This action cannot be undone.`
      }
      getItemKey={(skill) => skill.name}
      onAdd={onAddSkill}
      onEdit={onEditSkill}
      onDelete={onDeleteSkill}
      renderItem={(skill) => (
        <>
          <div className="mb-1">
            <h3 className="min-w-0 max-w-full truncate text-xs font-medium text-text-primary dark:text-text-dark-primary sm:max-w-[250px]">
              {skill.name}
            </h3>
          </div>
          {skill.description && (
            <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {skill.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            <span>
              {skill.file_count} file{skill.file_count !== 1 ? 's' : ''}
            </span>
            <span className="text-border dark:text-border-dark">/</span>
            <span>{formatBytes(skill.size_bytes)}</span>
          </div>
        </>
      )}
      logContext="SkillsSettingsTab"
    />
  );
};
