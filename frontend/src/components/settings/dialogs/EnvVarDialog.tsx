import type { CustomEnvVar } from '@/types';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { SecretInput } from '../inputs/SecretInput';
import { useState } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal';

interface EnvVarDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  envVar: CustomEnvVar;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onEnvVarChange: <K extends keyof CustomEnvVar>(field: K, value: CustomEnvVar[K]) => void;
}

export const EnvVarDialog: React.FC<EnvVarDialogProps> = ({
  isOpen,
  isEditing,
  envVar,
  error,
  onClose,
  onSubmit,
  onEnvVarChange,
}) => {
  const [isValueVisible, setIsValueVisible] = useState(false);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" className="max-h-[90vh] overflow-y-auto">
      <div className="p-5">
        <h3 className="mb-5 text-sm font-medium text-text-primary dark:text-text-dark-primary">
          {isEditing ? 'Edit Environment Variable' : 'Add Environment Variable'}
        </h3>

        {error && (
          <div className="mb-4 rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Variable Name
            </Label>
            <Input
              value={envVar.key}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
                onEnvVarChange('key', value);
              }}
              placeholder="OPENAI_API_KEY"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Uppercase letters, numbers, and underscores only
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Value
            </Label>
            <SecretInput
              value={envVar.value}
              onChange={(value) => onEnvVarChange('value', value)}
              placeholder="sk-..."
              isVisible={isValueVisible}
              onToggleVisibility={() => setIsValueVisible(!isValueVisible)}
              containerClassName="w-full"
              inputClassName="font-mono"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Available in all sandboxes
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            variant="outline"
            size="sm"
            className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
            disabled={!envVar.key.trim() || !envVar.value.trim()}
          >
            {isEditing ? 'Update' : 'Add Variable'}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
};
