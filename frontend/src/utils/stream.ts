import type { AssistantStreamEvent } from '@/types/chat.types';
import { logger } from '@/utils/logger';

function isAssistantStreamEventArray(value: unknown): value is AssistantStreamEvent[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === 'object' && 'type' in item)
  );
}

interface ParseCacheEntry {
  content: string;
  events: AssistantStreamEvent[];
}

const PARSE_CACHE_MAX_SIZE = 20;
const parseCache = new Map<string, ParseCacheEntry>();

function getContentKey(content: string): string {
  return content.length > 100
    ? `${content.length}:${content.slice(0, 50)}:${content.slice(-50)}`
    : content;
}

function parseEventLogUncached(content: string): AssistantStreamEvent[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (!trimmed.startsWith('[')) {
    return [
      {
        type: 'assistant_text',
        text: content,
      },
    ];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (isAssistantStreamEventArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    logger.error('Message event dispatch failed', 'stream', error);
  }

  return [
    {
      type: 'assistant_text',
      text: content,
    },
  ];
}

export const parseEventLog = (content: string | null | undefined): AssistantStreamEvent[] => {
  if (!content) {
    return [];
  }

  const cacheKey = getContentKey(content);
  const cached = parseCache.get(cacheKey);

  if (cached && cached.content === content) {
    return cached.events;
  }

  const events = parseEventLogUncached(content);

  if (parseCache.size >= PARSE_CACHE_MAX_SIZE) {
    const firstKey = parseCache.keys().next().value;
    if (firstKey) parseCache.delete(firstKey);
  }
  parseCache.set(cacheKey, { content, events });

  return events;
};

export interface ContentRenderSnapshot {
  events?: AssistantStreamEvent[];
}

export class StreamingContentAccumulator {
  private events: AssistantStreamEvent[];
  private textParts: string[];

  constructor(initialEvents: AssistantStreamEvent[] = [], initialText = '') {
    this.events = [...initialEvents];
    this.textParts = [];

    if (initialText) {
      this.textParts.push(initialText);
    } else if (initialEvents.length > 0) {
      for (const event of initialEvents) {
        if (event.type === 'assistant_text' && event.text) {
          this.textParts.push(event.text);
        }
      }
    }
  }

  push(event: AssistantStreamEvent): void {
    this.events.push(event);
    if (event.type === 'assistant_text' && event.text) {
      this.textParts.push(event.text);
    }
  }

  getEvents(): AssistantStreamEvent[] {
    return this.events;
  }

  getContentText(): string {
    return this.textParts.join('');
  }

  snapshot(): ContentRenderSnapshot {
    return { events: [...this.events] };
  }

  serialize(): string {
    return JSON.stringify(this.events);
  }
}

export const appendEventToLog = (
  content: string | null | undefined,
  event: AssistantStreamEvent,
): string => {
  const events = [...parseEventLog(content)];
  events.push(event);
  return JSON.stringify(events);
};

export const extractAssistantText = (source: string | AssistantStreamEvent[]): string => {
  const events = Array.isArray(source) ? source : parseEventLog(source);
  return events
    .filter((event) => event.type === 'assistant_text')
    .map((event) => event.text)
    .join('');
};
