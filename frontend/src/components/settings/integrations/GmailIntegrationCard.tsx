import { useRef, useCallback, useState } from 'react';
import { Mail, Upload, Link2, Unlink, Trash2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/Badge';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { GmailStatus } from '@/services/integrationsService';

interface GmailIntegrationCardProps {
  status: GmailStatus;
  isLoading: boolean;
  onUploadOAuthClient: (config: object) => void;
  isUploading: boolean;
  onDeleteOAuthClient: () => void;
  isDeleting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}

export const GmailIntegrationCard: React.FC<GmailIntegrationCardProps> = ({
  status,
  isLoading,
  onUploadOAuthClient,
  isUploading,
  onDeleteOAuthClient,
  isDeleting,
  onConnect,
  onDisconnect,
  isDisconnecting,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const config = JSON.parse(text);
        onUploadOAuthClient(config);
      } catch {
        // Toast error is handled by the hook
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onUploadOAuthClient],
  );

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border p-5 dark:border-border-dark">
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-5 dark:border-border-dark">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <Mail className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Gmail
            </h3>
            <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Read, send, and manage emails
            </p>
          </div>
        </div>
        <div>
          {status.connected ? (
            <Badge variant="success" className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          ) : status.has_oauth_client ? (
            <Badge variant="warning">Ready to connect</Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!status.has_oauth_client && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 dark:border-border-dark">
              <h4 className="mb-2 text-xs font-medium text-text-primary dark:text-text-dark-primary">
                Setup Instructions
              </h4>
              <ol className="list-inside list-decimal space-y-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                <li>
                  Go to{' '}
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary underline dark:text-text-dark-primary"
                  >
                    Google Cloud Console
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                </li>
                <li>Create a project and enable the Gmail API</li>
                <li>
                  Create OAuth credentials: Desktop app for localhost/dev only, Web application for
                  hosted or self-hosted URLs
                </li>
                <li>
                  If using Web application, add this redirect URI:{' '}
                  <code className="rounded bg-surface-tertiary px-1 py-0.5 text-2xs dark:bg-surface-dark-tertiary">
                    https://YOUR_DOMAIN/api/v1/integrations/gmail/callback
                  </code>
                </li>
                <li>Download the JSON file</li>
              </ol>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full"
            >
              {isUploading ? <Spinner size="sm" /> : <Upload className="h-3.5 w-3.5" />}
              Upload gcp-oauth.keys.json
            </Button>
          </div>
        )}

        {status.has_oauth_client && !status.connected && (
          <div className="space-y-4">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
              OAuth client configured. Click below to authorize access to your Gmail account.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={onConnect} className="flex-1">
                <Link2 className="h-3.5 w-3.5" />
                Connect Gmail
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={isDeleting}
              >
                {isDeleting ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        )}

        {status.connected && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3 dark:border-border-dark">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    {status.email}
                  </p>
                  {status.connected_at && (
                    <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                      Connected {formatDate(status.connected_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDisconnectDialogOpen(true)}
              disabled={isDisconnecting}
              className="w-full"
            >
              {isDisconnecting ? <Spinner size="sm" /> : <Unlink className="h-3.5 w-3.5" />}
              Disconnect Gmail
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => {
          onDeleteOAuthClient();
          setIsDeleteDialogOpen(false);
        }}
        title="Remove OAuth Client"
        message="Are you sure you want to remove the OAuth client configuration? You will need to upload it again to connect Gmail."
        confirmLabel="Remove"
        cancelLabel="Cancel"
      />

      <ConfirmDialog
        isOpen={isDisconnectDialogOpen}
        onClose={() => setIsDisconnectDialogOpen(false)}
        onConfirm={() => {
          onDisconnect();
          setIsDisconnectDialogOpen(false);
        }}
        title="Disconnect Gmail"
        message="Are you sure you want to disconnect Gmail? Your OAuth client configuration will be preserved, but you will need to re-authorize to use Gmail features."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
      />
    </div>
  );
};
