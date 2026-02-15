import { memo, useEffect, useState } from 'react';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import JSZip from 'jszip';
import type { FileStructure } from '@/types';
import { Button } from '@/components/ui/primitives/Button';
import { PreviewContainer } from './PreviewContainer';
import { previewBackgroundClass } from './previewConstants';
import { getDisplayFileName, isValidBase64 } from './previewUtils';

export interface PowerPointPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface SlideData {
  slideNumber: number;
  content: string;
  hasImages: boolean;
}

const parseSlideContent = (xmlContent: string): string => {
  const textContent: string[] = [];

  const textMatches = xmlContent.matchAll(/<a:t>([^<]+)<\/a:t>/g);
  for (const match of textMatches) {
    textContent.push(match[1]);
  }

  const titleMatches = xmlContent.matchAll(/<p:ph[^>]*type="title"[^>]*>.*?<a:t>([^<]+)<\/a:t>/gs);
  for (const match of titleMatches) {
    textContent.unshift(`## ${match[1]}`);
  }

  return textContent.join('\n\n');
};

export const PowerPointPreview = memo(function PowerPointPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: PowerPointPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slidesData, setSlidesData] = useState<SlideData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const fileName = getDisplayFileName(file, 'presentation');

  useEffect(() => {
    let isMounted = true;

    const finishWithNoData = () => {
      if (!isMounted) return;
      setSlidesData([]);
      setCurrentSlide(0);
      setIsLoading(false);
    };

    if (!file.content) {
      finishWithNoData();
      return () => {
        isMounted = false;
      };
    }

    if (!isValidBase64(file.content)) {
      finishWithNoData();
      return () => {
        isMounted = false;
      };
    }

    const loadSlides = async (): Promise<void> => {
      if (!isMounted) return;
      setIsLoading(true);
      setSlidesData([]);
      setCurrentSlide(0);

      try {
        const bytes = base64ToUint8Array(file.content);

        const pptx = await new JSZip().loadAsync(bytes);

        const slideRels = pptx.file(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/);
        const slideFiles = pptx.file(/^ppt\/slides\/slide\d+\.xml$/);
        const sortedSlides = slideFiles.sort((a, b) => {
          const aMatch = a.name.match(/slide(\d+)\.xml$/);
          const bMatch = b.name.match(/slide(\d+)\.xml$/);
          const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
          const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
          return aNum - bNum;
        });

        const slides: SlideData[] = [];

        for (let i = 0; i < sortedSlides.length; i++) {
          const slideFile = sortedSlides[i];
          const xmlContent = await slideFile.async('string');

          let hasImages = false;
          const relFile = slideRels.find((rel) => rel.name.includes(`slide${i + 1}.xml.rels`));
          if (relFile) {
            const relContent = await relFile.async('string');
            hasImages = relContent.includes('image');
          }

          slides.push({
            slideNumber: i + 1,
            content: parseSlideContent(xmlContent),
            hasImages,
          });
        }

        if (!isMounted) return;

        setSlidesData(slides);
        setCurrentSlide(0);
      } catch (error) {
        logger.error('PowerPoint preview load failed', 'PowerPointPreview', error);
        if (isMounted) {
          setSlidesData([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadSlides();

    return () => {
      isMounted = false;
    };
  }, [file.content]);

  if (isLoading) {
    return (
      <PreviewContainer
        fileName={fileName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <p className="text-text-tertiary dark:text-text-dark-tertiary">
          Loading PowerPoint presentation...
        </p>
      </PreviewContainer>
    );
  }

  if (slidesData.length === 0) {
    return (
      <PreviewContainer
        fileName={fileName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <p className="text-text-tertiary dark:text-text-dark-tertiary">
          Unable to load PowerPoint presentation
        </p>
      </PreviewContainer>
    );
  }

  const currentSlideData = slidesData[currentSlide];

  const handlePreviousSlide = () => {
    setCurrentSlide((prev) => Math.max(0, prev - 1));
  };

  const handleNextSlide = () => {
    setCurrentSlide((prev) => Math.min(slidesData.length - 1, prev + 1));
  };

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      disableContentWrapper
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-8">
          <div
            className={`mx-auto max-w-4xl rounded-lg bg-surface p-12 shadow-lg dark:bg-surface-dark ${isFullscreen ? 'min-h-full' : 'min-h-96'}`}
          >
            {currentSlideData && (
              <div className="space-y-4">
                {currentSlideData.content.split('\n\n').map((paragraph, idx) => {
                  if (paragraph.startsWith('## ')) {
                    return (
                      <h2
                        key={idx}
                        className="mb-6 text-3xl font-bold text-text-primary dark:text-text-dark-primary"
                      >
                        {paragraph.substring(3)}
                      </h2>
                    );
                  }
                  return (
                    <p
                      key={idx}
                      className="text-lg text-text-secondary dark:text-text-dark-secondary"
                    >
                      {paragraph}
                    </p>
                  );
                })}
                {currentSlideData.hasImages && (
                  <p className="mt-8 text-sm italic text-text-tertiary dark:text-text-dark-tertiary">
                    Note: This slide contains images that are not displayed in the preview
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface-secondary p-4 dark:border-border-dark dark:bg-surface-dark-secondary">
          <Button
            onClick={handlePreviousSlide}
            disabled={currentSlide === 0}
            variant="unstyled"
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              currentSlide === 0
                ? 'cursor-not-allowed bg-surface-tertiary text-text-quaternary dark:bg-surface-dark-tertiary'
                : 'bg-text-primary text-surface hover:bg-text-secondary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary'
            }`}
          >
            Previous
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary dark:text-text-dark-secondary">
              Slide {currentSlide + 1} of {slidesData.length}
            </span>
            <div className="flex gap-1">
              {slidesData.map((_, idx) => (
                <Button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  variant="unstyled"
                  className={`h-2 w-2 rounded-full transition-colors ${
                    idx === currentSlide
                      ? 'bg-text-primary dark:bg-text-dark-primary'
                      : 'bg-text-quaternary dark:bg-text-dark-quaternary'
                  }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <Button
            onClick={handleNextSlide}
            disabled={currentSlide === slidesData.length - 1}
            variant="unstyled"
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              currentSlide === slidesData.length - 1
                ? 'cursor-not-allowed bg-surface-tertiary text-text-quaternary dark:bg-surface-dark-tertiary'
                : 'bg-text-primary text-surface hover:bg-text-secondary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary'
            }`}
          >
            Next
          </Button>
        </div>
      </div>
    </PreviewContainer>
  );
});
