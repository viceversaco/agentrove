import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { HelpCircle, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import type { ToolAggregate, UserQuestion } from '@/types';
import { ToolCard } from './common';
import { useUserQuestion } from '@/hooks/useUserQuestion';

const LETTER_OPTIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const OTHER_VALUE = '__other__';

interface AskUserQuestionProps {
  tool: ToolAggregate;
  chatId?: string;
}

export const AskUserQuestion: React.FC<AskUserQuestionProps> = ({ tool, chatId }) => {
  const questions = useMemo(
    () => (tool.input?.questions ?? []) as UserQuestion[],
    [tool.input?.questions],
  );
  const questionCount = questions.length;
  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const {
    pendingRequest,
    isLoading,
    error: questionError,
    handleSubmitAnswers,
    handleCancel,
  } = useUserQuestion(chatId);

  const resultData = tool.result as { answers?: Record<string, string | string[]> } | undefined;
  const answers = resultData?.answers;

  const isPending = toolStatus === 'started' && pendingRequest !== null;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [formAnswers, setFormAnswers] = useState<Record<string, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const requestId = pendingRequest?.request_id;

  useEffect(() => {
    setCurrentIndex(0);
    setFormAnswers({});
    setOtherInputs({});
  }, [tool.id, requestId, questions]);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];

  const currentKey = `question_${currentIndex}`;
  const currentAnswer = formAnswers[currentKey];
  const isOtherSelected = Array.isArray(currentAnswer)
    ? currentAnswer.includes(OTHER_VALUE)
    : currentAnswer === OTHER_VALUE;

  const allQuestionsAnswered = questions.every((_, qIndex) => {
    const key = `question_${qIndex}`;
    const answer = formAnswers[key];
    const otherInput = otherInputs[key]?.trim();
    const isOther = Array.isArray(answer) ? answer.includes(OTHER_VALUE) : answer === OTHER_VALUE;

    if (isOther) return !!otherInput;
    return answer && (Array.isArray(answer) ? answer.length > 0 : true);
  });

  const handleOptionSelect = useCallback(
    (optionLabel: string) => {
      const key = `question_${currentIndex}`;
      const isMultiSelect = currentQuestion?.multiSelect ?? false;

      if (isMultiSelect) {
        const current = (formAnswers[key] as string[]) ?? [];
        if (optionLabel === OTHER_VALUE) {
          if (current.includes(OTHER_VALUE)) {
            setFormAnswers({ ...formAnswers, [key]: current.filter((o) => o !== OTHER_VALUE) });
          } else {
            setFormAnswers({ ...formAnswers, [key]: [OTHER_VALUE] });
          }
        } else {
          const filtered = current.filter((o) => o !== OTHER_VALUE);
          if (filtered.includes(optionLabel)) {
            setFormAnswers({ ...formAnswers, [key]: filtered.filter((o) => o !== optionLabel) });
          } else {
            setFormAnswers({ ...formAnswers, [key]: [...filtered, optionLabel] });
          }
        }
      } else {
        setFormAnswers({ ...formAnswers, [key]: optionLabel });
        if (optionLabel !== OTHER_VALUE) {
          setOtherInputs({ ...otherInputs, [key]: '' });
          if (currentIndex < totalQuestions - 1) {
            setTimeout(() => setCurrentIndex((prev) => prev + 1), 150);
          }
        }
      }
    },
    [formAnswers, otherInputs, currentIndex, currentQuestion?.multiSelect, totalQuestions],
  );

  const handleOtherInputChange = useCallback(
    (value: string) => {
      const key = `question_${currentIndex}`;
      setOtherInputs({ ...otherInputs, [key]: value });
    },
    [otherInputs, currentIndex],
  );

  const handleSubmit = useCallback(() => {
    const finalAnswers: Record<string, string | string[]> = {};
    questions.forEach((q, qIndex) => {
      const key = `question_${qIndex}`;
      const selectedAnswer = formAnswers[key];
      const otherInput = otherInputs[key]?.trim();
      const isMultiSelect = q.multiSelect ?? false;

      if (isMultiSelect) {
        const selected = Array.isArray(selectedAnswer) ? selectedAnswer : [];
        const next = [...selected];
        if (selected.includes(OTHER_VALUE)) {
          const withoutOther = next.filter((value) => value !== OTHER_VALUE);
          if (otherInput) {
            withoutOther.push(otherInput);
          }
          if (withoutOther.length > 0) {
            finalAnswers[key] = withoutOther;
          }
        } else if (next.length > 0) {
          finalAnswers[key] = next;
        }
      } else {
        if (selectedAnswer === OTHER_VALUE && otherInput) {
          finalAnswers[key] = otherInput;
        } else if (selectedAnswer && selectedAnswer !== OTHER_VALUE) {
          finalAnswers[key] = selectedAnswer as string;
        }
      }
    });
    handleSubmitAnswers(finalAnswers);
  }, [formAnswers, otherInputs, handleSubmitAnswers, questions]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex < totalQuestions - 1) setCurrentIndex(currentIndex + 1);
  }, [currentIndex, totalQuestions]);

  const isSelected = (optionLabel: string) => {
    const key = `question_${currentIndex}`;
    const answer = formAnswers[key];
    if (Array.isArray(answer)) return answer.includes(optionLabel);
    return answer === optionLabel;
  };

  if (isPending && questionCount > 0 && currentQuestion) {
    const optionsCount = currentQuestion.options?.length ?? 0;
    const otherLetter = LETTER_OPTIONS[optionsCount] || String(optionsCount + 1);

    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface-tertiary dark:border-border-dark dark:bg-surface-dark-tertiary">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 dark:border-border-dark">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-black/5 p-1 dark:bg-white/5">
              <HelpCircle className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Questions
            </span>
          </div>
          {totalQuestions > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goToPrevious}
                disabled={currentIndex === 0 || isLoading}
                className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-black/5 hover:text-text-secondary disabled:opacity-30 dark:text-text-dark-tertiary dark:hover:bg-white/5 dark:hover:text-text-dark-secondary"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {currentIndex + 1} of {totalQuestions}
              </span>
              <button
                type="button"
                onClick={goToNext}
                disabled={currentIndex === totalQuestions - 1 || isLoading}
                className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-black/5 hover:text-text-secondary disabled:opacity-30 dark:text-text-dark-tertiary dark:hover:bg-white/5 dark:hover:text-text-dark-secondary"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="p-3">
          <div className="mb-3 flex items-start gap-2">
            <span className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
              {currentIndex + 1}.
            </span>
            <div>
              <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                {currentQuestion.question}
              </p>
              {currentQuestion.multiSelect && (
                <span className="mt-1 inline-block rounded bg-black/5 px-1.5 py-0.5 text-2xs font-medium text-text-tertiary dark:bg-white/5 dark:text-text-dark-tertiary">
                  Select multiple
                </span>
              )}
            </div>
          </div>

          {currentQuestion.options && currentQuestion.options.length > 0 && (
            <div className="space-y-1">
              {currentQuestion.options.map((option, oIndex) => {
                const letter = LETTER_OPTIONS[oIndex] || String(oIndex + 1);
                const selected = isSelected(option.label);
                return (
                  <button
                    key={oIndex}
                    type="button"
                    onClick={() => handleOptionSelect(option.label)}
                    className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-all ${
                      selected
                        ? 'bg-black/5 dark:bg-white/5'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    disabled={isLoading}
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-xs font-medium ${
                        selected
                          ? 'bg-text-primary text-surface dark:bg-text-dark-primary dark:text-surface-dark'
                          : 'bg-black/5 text-text-tertiary dark:bg-white/5 dark:text-text-dark-tertiary'
                      }`}
                    >
                      {letter}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs transition-colors ${
                          selected
                            ? 'font-medium text-text-primary dark:text-text-dark-primary'
                            : 'text-text-secondary dark:text-text-dark-secondary'
                        }`}
                      >
                        {option.label}
                      </p>
                      {option.description && (
                        <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                          {option.description}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}

              <div
                onClick={() => handleOptionSelect(OTHER_VALUE)}
                className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-all ${
                  isOtherSelected
                    ? 'bg-black/5 dark:bg-white/5'
                    : 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-xs font-medium ${
                    isOtherSelected
                      ? 'bg-text-primary text-surface dark:bg-text-dark-primary dark:text-surface-dark'
                      : 'bg-black/5 text-text-tertiary dark:bg-white/5 dark:text-text-dark-tertiary'
                  }`}
                >
                  {otherLetter}
                </span>
                {isOtherSelected ? (
                  <input
                    type="text"
                    placeholder="Type your answer..."
                    value={otherInputs[currentKey] ?? ''}
                    onChange={(e) => handleOtherInputChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder-text-tertiary outline-none dark:text-text-dark-primary dark:placeholder-text-dark-tertiary"
                    disabled={isLoading}
                    autoFocus
                  />
                ) : (
                  <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Other
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2 dark:border-border-dark">
          <div>
            {questionError && (
              <div className="flex items-center gap-2 text-2xs text-error-600 dark:text-error-400">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span>{questionError}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleCancel} variant="ghost" size="sm" disabled={isLoading}>
              Skip
            </Button>
            <Button
              onClick={handleSubmit}
              variant="primary"
              size="sm"
              disabled={isLoading || !allQuestionsAnswered}
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToolCard
      icon={<HelpCircle className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={toolStatus}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `User answered ${questionCount} question${questionCount !== 1 ? 's' : ''}`;
          case 'failed':
            return 'Question cancelled or failed';
          default:
            return 'Waiting for user response...';
        }
      }}
      loadingContent="Waiting for response..."
      error={errorMessage}
      expandable={questionCount > 0 && toolStatus === 'completed' && !!answers}
    >
      {questionCount > 0 && toolStatus === 'completed' && answers && (
        <div className="space-y-2">
          {questions.map((q, index) => {
            const answer = answers[`question_${index}`];
            return (
              <div key={index} className="space-y-0.5">
                <p className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  {q.header && (
                    <span className="text-text-quaternary dark:text-text-dark-quaternary">
                      {q.header}:{' '}
                    </span>
                  )}
                  {q.question}
                </p>
                {answer && (
                  <p className="text-2xs text-text-secondary dark:text-text-dark-secondary">
                    {Array.isArray(answer) ? answer.join(', ') : answer}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ToolCard>
  );
};
