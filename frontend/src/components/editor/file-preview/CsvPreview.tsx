import { memo, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import {
  previewBackgroundClass,
  tableBorderClass,
  tableHeaderClass,
  tableCellClass,
} from './previewConstants';
import { getDisplayFileName } from './previewUtils';

export interface CsvPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const CsvPreview = memo(function CsvPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: CsvPreviewProps) {
  const parsedData = useMemo(() => {
    if (!file.content) return { headers: [], rows: [] };

    const lines = file.content.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].split(',').map((header) => header.trim().replace(/^"|"$/g, ''));
    const rows = lines
      .slice(1)
      .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));

    return { headers, rows };
  }, [file.content]);

  const { headers, rows } = parsedData;

  if (headers.length === 0) {
    return (
      <PreviewContainer
        fileName={getDisplayFileName(file)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <p className="text-text-tertiary dark:text-text-dark-tertiary">No CSV data to display</p>
      </PreviewContainer>
    );
  }

  return (
    <PreviewContainer
      fileName={getDisplayFileName(file)}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName="overflow-auto p-4"
    >
      <div className="overflow-x-auto">
        <table className={`min-w-full border-collapse ${tableBorderClass}`}>
          <thead>
            <tr className="bg-surface-secondary dark:bg-surface-dark-secondary">
              {headers.map((header, index) => (
                <th
                  key={index}
                  className={`${tableBorderClass} ${tableHeaderClass} text-left font-medium`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={
                  rowIndex % 2 === 0
                    ? previewBackgroundClass
                    : 'bg-surface-secondary dark:bg-surface-dark-secondary'
                }
              >
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`${tableBorderClass} ${tableCellClass}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PreviewContainer>
  );
});
