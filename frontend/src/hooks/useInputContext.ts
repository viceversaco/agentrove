import { use } from 'react';
import {
  InputContext,
  InputStateContext,
  InputActionsContext,
  InputMetaContext,
} from '@/components/chat/message-input/InputContext';

export function useInputContext() {
  const context = use(InputContext);
  if (!context) {
    throw new Error('useInputContext must be used within an InputProvider');
  }
  return context;
}

export function useInputState() {
  const state = use(InputStateContext);
  if (!state) {
    throw new Error('useInputState must be used within an InputProvider');
  }
  return state;
}

export function useInputActions() {
  const actions = use(InputActionsContext);
  if (!actions) {
    throw new Error('useInputActions must be used within an InputProvider');
  }
  return actions;
}

export function useInputMeta() {
  const meta = use(InputMetaContext);
  if (!meta) {
    throw new Error('useInputMeta must be used within an InputProvider');
  }
  return meta;
}
