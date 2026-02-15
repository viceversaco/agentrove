import { memo } from 'react';
import { AttachmentViewer } from '@/components/ui/AttachmentViewer';
import type { MessageAttachment } from '@/types';

interface MessageAttachmentsProps {
  attachments?: MessageAttachment[];
  uploadingAttachmentIds?: string[];
  className?: string;
}

export const MessageAttachments = memo(
  ({ attachments, uploadingAttachmentIds, className = '' }: MessageAttachmentsProps) => {
    if (!attachments || attachments.length === 0) {
      return null;
    }

    return (
      <div className={className}>
        <AttachmentViewer
          attachments={attachments}
          uploadingAttachmentIds={uploadingAttachmentIds}
        />
      </div>
    );
  },
);
