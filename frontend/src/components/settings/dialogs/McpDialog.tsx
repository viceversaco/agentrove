import type { CustomMcp } from '@/types/user.types';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Switch } from '@/components/ui/primitives/Switch';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { Plus, X } from 'lucide-react';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { useState, useEffect, useRef } from 'react';

interface EnvVarEntry {
  id: string;
  key: string;
  value: string;
}

interface McpDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  mcp: CustomMcp;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onMcpChange: <K extends keyof CustomMcp>(field: K, value: CustomMcp[K]) => void;
}

export const McpDialog: React.FC<McpDialogProps> = ({
  isOpen,
  isEditing,
  mcp,
  error,
  onClose,
  onSubmit,
  onMcpChange,
}) => {
  const [envVarEntries, setEnvVarEntries] = useState<EnvVarEntry[]>([]);
  const idCounterRef = useRef(0);

  const generateId = () => {
    idCounterRef.current += 1;
    return `entry-${idCounterRef.current}`;
  };

  useEffect(() => {
    if (!isOpen) return;
    idCounterRef.current = 0;
    const entries = Object.entries(mcp.env_vars || {}).map(([key, value]) => ({
      id: generateId(),
      key,
      value,
    }));
    setEnvVarEntries(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const syncEnvVarsToParent = (entries: EnvVarEntry[]) => {
    const envVars: Record<string, string> = {};
    entries.forEach((entry) => {
      if (entry.key) {
        envVars[entry.key] = entry.value;
      }
    });
    onMcpChange('env_vars', Object.keys(envVars).length > 0 ? envVars : undefined);
  };

  const addEnvVar = () => {
    const newEntries = [...envVarEntries, { id: generateId(), key: '', value: '' }];
    setEnvVarEntries(newEntries);
    syncEnvVarsToParent(newEntries);
  };

  const updateEnvVar = (id: string, key: string, value: string) => {
    const newEntries = envVarEntries.map((entry) =>
      entry.id === id ? { ...entry, key, value } : entry,
    );
    setEnvVarEntries(newEntries);
    syncEnvVarsToParent(newEntries);
  };

  const removeEnvVar = (id: string) => {
    const newEntries = envVarEntries.filter((entry) => entry.id !== id);
    setEnvVarEntries(newEntries);
    syncEnvVarsToParent(newEntries);
  };

  const addArg = () => {
    onMcpChange('args', [...(mcp.args || []), '']);
  };

  const updateArg = (index: number, value: string) => {
    const args = [...(mcp.args || [])];
    args[index] = value;
    onMcpChange('args', args);
  };

  const removeArg = (index: number) => {
    const args = [...(mcp.args || [])];
    args.splice(index, 1);
    onMcpChange('args', args.length > 0 ? args : undefined);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      className="max-h-[90vh] overflow-y-auto"
    >
      <div className="p-5">
        <h3 className="mb-5 text-sm font-medium text-text-primary dark:text-text-dark-primary">
          {isEditing ? 'Edit MCP Server' : 'Add New MCP Server'}
        </h3>

        {error && (
          <div className="mb-4 rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              MCP Server Name
            </Label>
            <Input
              value={mcp.name}
              onChange={(e) => onMcpChange('name', e.target.value)}
              placeholder="e.g., google-maps, netlify, stripe"
              className="text-xs"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              A unique identifier for this MCP server (use lowercase with hyphens)
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Description
            </Label>
            <Textarea
              value={mcp.description}
              onChange={(e) => onMcpChange('description', e.target.value)}
              placeholder="What does this MCP server do?"
              rows={3}
              className="text-xs"
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Command Type
            </Label>
            <select
              value={mcp.command_type}
              onChange={(e) =>
                onMcpChange('command_type', e.target.value as 'npx' | 'bunx' | 'uvx' | 'http')
              }
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-border/60 dark:border-border-dark dark:text-text-dark-primary dark:focus:ring-border-dark/60"
            >
              <option value="npx">NPX Package</option>
              <option value="bunx">Bunx Package</option>
              <option value="uvx">uvx Package</option>
              <option value="http">HTTP Endpoint</option>
            </select>
          </div>

          {(mcp.command_type === 'npx' ||
            mcp.command_type === 'bunx' ||
            mcp.command_type === 'uvx') && (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                {mcp.command_type === 'npx'
                  ? 'NPM Package'
                  : mcp.command_type === 'bunx'
                    ? 'Bun Package'
                    : 'Python Package'}
              </Label>
              <Input
                value={mcp.package || ''}
                onChange={(e) => onMcpChange('package', e.target.value)}
                placeholder="e.g., @netlify/mcp, @stripe/mcp-server"
                className="font-mono text-xs"
              />
            </div>
          )}

          {mcp.command_type === 'http' && (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                HTTP URL
              </Label>
              <Input
                value={mcp.url || ''}
                onChange={(e) => onMcpChange('url', e.target.value)}
                placeholder="e.g., https://api.example.com/mcp"
                className="font-mono text-xs"
              />
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Environment Variables
              </span>
              <Button
                type="button"
                onClick={addEnvVar}
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-2xs text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {envVarEntries.map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <Input
                    value={entry.key}
                    onChange={(e) => updateEnvVar(entry.id, e.target.value, entry.value)}
                    placeholder="KEY"
                    className="flex-1 font-mono text-2xs"
                  />
                  <Input
                    value={entry.value}
                    onChange={(e) => updateEnvVar(entry.id, entry.key, e.target.value)}
                    placeholder="value"
                    className="flex-1 font-mono text-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(entry.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {envVarEntries.length === 0 && (
                <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  No environment variables configured
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Additional Arguments
              </span>
              <Button
                type="button"
                onClick={addArg}
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-2xs text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {(mcp.args || []).map((arg, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={arg}
                    onChange={(e) => updateArg(index, e.target.value)}
                    placeholder="--flag or value"
                    className="flex-1 font-mono text-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeArg(index)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {(!mcp.args || mcp.args.length === 0) && (
                <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  No additional arguments configured
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3.5 py-3 dark:border-border-dark">
            <div>
              <span className="text-xs text-text-primary dark:text-text-dark-primary">
                Enable MCP Server
              </span>
              <p className="mt-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Server will only be available when enabled
              </p>
            </div>
            <Switch
              checked={mcp.enabled ?? true}
              onCheckedChange={(checked) => onMcpChange('enabled', checked)}
              size="sm"
              aria-label="Enable MCP server"
            />
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
          >
            {isEditing ? 'Update' : 'Add MCP Server'}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
};
