'use client';

import { memo, useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { ChevronUp, ChevronDown, CornerDownLeft } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { PendingUserQuestions } from '../atoms';

interface AgentUserQuestionProps {
  pendingQuestions: PendingUserQuestions;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
  hasCustomText?: boolean;
  /**
   * The question timed out and is no longer answerable. The widget stays visible
   * but disabled ("the agent may ask again"); onSkip becomes a dismiss.
   */
  expired?: boolean;
}

export interface AgentUserQuestionHandle {
  getAnswers: () => Record<string, string>;
}

// A synthetic selection value for the always-present free-text row. It never
// collides with a real option label (which come from the assistant) and lets
// the free-text row reuse the existing `answers: Record<string, string[]>`
// selection machinery (single vs multi-select, keyboard nav, the answered gate).
const FREE_TEXT_SENTINEL = '__CHURRO_FREE_TEXT__';

// Assistants sometimes already include their own "Other"/"type anything"-style
// option. Matching it here lets us reuse its label/description instead of
// rendering a second, redundant free-text row.
const FREE_TEXT_OPTION_PATTERN = /^(type anything|other|something else|custom|none of the above)$/i;

function looksLikeFreeTextOption(label: string): boolean {
  return FREE_TEXT_OPTION_PATTERN.test(label.trim());
}

// Pure helpers (no hooks) so they can be called both from `useImperativeHandle`
// (declared before the component's early return) and from callbacks declared
// after it, without hook-ordering concerns.
function isQuestionAnsweredPure(selected: string[], customValue: string | undefined): boolean {
  if (selected.length === 0) return false;
  if (selected.some((label) => label !== FREE_TEXT_SENTINEL)) return true;
  // Only the free-text row is selected — it counts once there's typed text.
  return Boolean(customValue?.trim());
}

function formatQuestionAnswer(selected: string[], customValue: string | undefined): string | undefined {
  const parts = selected
    .map((label) => (label === FREE_TEXT_SENTINEL ? customValue?.trim() : label))
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export const AgentUserQuestion = memo(
  forwardRef<AgentUserQuestionHandle, AgentUserQuestionProps>(function AgentUserQuestion(
    { pendingQuestions, onAnswer, onSkip, hasCustomText = false, expired = false }: AgentUserQuestionProps,
    ref
  ) {
    const { questions, toolUseId } = pendingQuestions;
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string[]>>({});
    // Typed value for the free-text row, keyed by question text (mirrors `answers`).
    const [customText, setCustomText] = useState<Record<string, string>>({});
    const [focusedOptionIndex, setFocusedOptionIndex] = useState(0);
    const [isVisible, setIsVisible] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const prevIndexRef = useRef(currentQuestionIndex);
    const prevToolUseIdRef = useRef(toolUseId);
    const freeTextInputRef = useRef<HTMLInputElement>(null);
    // No answering once expired (or mid-submit). onSkip still works (dismiss).
    const interactionDisabled = isSubmitting || expired;

    // Expose getAnswers method to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        getAnswers: () => {
          const formattedAnswers: Record<string, string> = {};
          if (!questions) return formattedAnswers;
          for (const question of questions) {
            const selected = answers[question.question] || [];
            const formatted = formatQuestionAnswer(selected, customText[question.question]);
            if (formatted) {
              formattedAnswers[question.question] = formatted;
            }
          }
          return formattedAnswers;
        }
      }),
      [answers, customText, questions]
    );

    // Reset when toolUseId changes (new question set)
    useEffect(() => {
      if (prevToolUseIdRef.current !== toolUseId) {
        setIsSubmitting(false);
        setCurrentQuestionIndex(0);
        setAnswers({});
        setCustomText({});
        setFocusedOptionIndex(0);
        prevToolUseIdRef.current = toolUseId;
      }
    }, [toolUseId]);

    // Animate on question change
    useEffect(() => {
      if (prevIndexRef.current !== currentQuestionIndex) {
        setIsVisible(false);
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, 50);
        prevIndexRef.current = currentQuestionIndex;
        return () => clearTimeout(timer);
      }
    }, [currentQuestionIndex]);

    // `questions` is typed as a required array, but in production we've seen
    // entries land in `pendingUserQuestionsAtom` with `questions === undefined`
    // (likely a malformed subscription/IPC payload from one of the three
    // writers in ipc-chat-transport / codex-chat-transport / chat-cli-surface).
    // Guard at the consumer so a bad payload renders empty instead of crashing.
    if (!questions || questions.length === 0) {
      if (!questions) {
        console.warn(
          `[AgentUserQuestion] pendingQuestions.questions is undefined toolUseId=${toolUseId ?? 'unknown'} — dropping render`
        );
      }
      return null;
    }

    const currentQuestion = questions[currentQuestionIndex];
    const suppliedOptions = currentQuestion?.options || [];
    // The free-text row is always last. If the assistant already supplied an
    // "Other"-style option, reuse its label/description and move it to the end
    // instead of also appending a synthetic one (avoids a duplicate row).
    const freeTextSourceIndex = suppliedOptions.findIndex((o) => looksLikeFreeTextOption(o.label));
    const freeTextOption =
      freeTextSourceIndex === -1
        ? { label: 'Type anything', description: 'Type your own answer' }
        : suppliedOptions[freeTextSourceIndex];
    const currentOptions =
      freeTextSourceIndex === -1
        ? [...suppliedOptions, freeTextOption]
        : [
            ...suppliedOptions.slice(0, freeTextSourceIndex),
            ...suppliedOptions.slice(freeTextSourceIndex + 1),
            freeTextOption
          ];
    const freeTextIndex = currentOptions.length - 1;

    const isOptionSelected = (questionText: string, optionLabel: string) => {
      return answers[questionText]?.includes(optionLabel) || false;
    };

    const isFreeTextSelected = (questionText: string) => {
      return answers[questionText]?.includes(FREE_TEXT_SENTINEL) || false;
    };

    // Handle option click - auto-advance for single-select questions
    const handleOptionClick = useCallback(
      (questionText: string, optionLabel: string, questionIndex: number) => {
        const question = questions[questionIndex];
        const allowMultiple = question?.multiSelect || false;
        const isLastQuestion = questionIndex === questions.length - 1;

        setAnswers((prev) => {
          const currentAnswers = prev[questionText] || [];

          if (allowMultiple) {
            if (currentAnswers.includes(optionLabel)) {
              return {
                ...prev,
                [questionText]: currentAnswers.filter((l) => l !== optionLabel)
              };
            } else {
              return {
                ...prev,
                [questionText]: [...currentAnswers, optionLabel]
              };
            }
          } else {
            return {
              ...prev,
              [questionText]: [optionLabel]
            };
          }
        });

        // For single-select questions, auto-advance to next question
        if (!allowMultiple && !isLastQuestion) {
          setTimeout(() => {
            setCurrentQuestionIndex(questionIndex + 1);
            setFocusedOptionIndex(0);
          }, 150);
        }
      },
      [questions]
    );

    // Marks the free-text row selected (idempotent — does not toggle it off).
    // Used on focus/change of the free-text input and on click of its row, so
    // focusing the field never surprises the user by deselecting it.
    const selectFreeText = useCallback((questionText: string, allowMultiple: boolean) => {
      setAnswers((prev) => {
        const current = prev[questionText] || [];
        if (current.includes(FREE_TEXT_SENTINEL)) return prev;
        return {
          ...prev,
          [questionText]: allowMultiple ? [...current, FREE_TEXT_SENTINEL] : [FREE_TEXT_SENTINEL]
        };
      });
    }, []);

    const handlePrevious = () => {
      if (currentQuestionIndex > 0) {
        setCurrentQuestionIndex(currentQuestionIndex - 1);
        setFocusedOptionIndex(0);
      }
    };

    const handleNext = () => {
      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
        setFocusedOptionIndex(0);
      }
    };

    const handleContinue = useCallback(() => {
      if (isSubmitting || expired || !currentQuestion) return;

      const currentAnswer = answers[currentQuestion.question] || [];
      if (!isQuestionAnsweredPure(currentAnswer, customText[currentQuestion.question])) return;

      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
        setFocusedOptionIndex(0);
      } else {
        // On the last question, validate ALL questions are answered before submit
        const allAnswered = questions.every((q) =>
          isQuestionAnsweredPure(answers[q.question] || [], customText[q.question])
        );
        if (allAnswered) {
          setIsSubmitting(true);
          // Convert answers to SDK format: { questionText: label } or { questionText: "label1, label2" }
          // for multiSelect. A selected free-text row contributes its typed value instead of the sentinel.
          const formattedAnswers: Record<string, string> = {};
          for (const question of questions) {
            const selected = answers[question.question] || [];
            const formatted = formatQuestionAnswer(selected, customText[question.question]);
            if (formatted) {
              formattedAnswers[question.question] = formatted;
            }
          }
          onAnswer(formattedAnswers);
        }
      }
    }, [onAnswer, answers, customText, currentQuestionIndex, questions, currentQuestion, isSubmitting, expired]);

    const handleSkipWithGuard = useCallback(() => {
      if (isSubmitting) return;
      // When expired, Skip All is a dismiss — don't lock the widget into a
      // "submitting" state, just hand off to the parent's dismiss handler.
      if (!expired) setIsSubmitting(true);
      onSkip();
    }, [isSubmitting, expired, onSkip]);

    const getOptionNumber = (index: number) => {
      return String(index + 1);
    };

    const currentQuestionHasAnswer = currentQuestion
      ? isQuestionAnsweredPure(answers[currentQuestion.question] || [], customText[currentQuestion.question])
      : false;
    const allQuestionsAnswered = questions.every((q) =>
      isQuestionAnsweredPure(answers[q.question] || [], customText[q.question])
    );
    const isLastQuestion = currentQuestionIndex === questions.length - 1;

    // Keyboard navigation
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (interactionDisabled) return;

        const activeEl = document.activeElement;
        if (
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (focusedOptionIndex < currentOptions.length - 1) {
            setFocusedOptionIndex(focusedOptionIndex + 1);
          } else if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
            setFocusedOptionIndex(0);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (focusedOptionIndex > 0) {
            setFocusedOptionIndex(focusedOptionIndex - 1);
          } else if (currentQuestionIndex > 0) {
            const prevQuestionOptions = questions[currentQuestionIndex - 1]?.options || [];
            setCurrentQuestionIndex(currentQuestionIndex - 1);
            setFocusedOptionIndex(prevQuestionOptions.length - 1);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (currentQuestionHasAnswer) {
            handleContinue();
          } else if (focusedOptionIndex === freeTextIndex) {
            // Focus the actual input rather than blindly toggling — the user
            // still needs to type before this row counts as answered.
            selectFreeText(currentQuestion.question, currentQuestion.multiSelect || false);
            freeTextInputRef.current?.focus();
          } else if (currentOptions[focusedOptionIndex]) {
            handleOptionClick(currentQuestion.question, currentOptions[focusedOptionIndex].label, currentQuestionIndex);
          }
        } else if (e.key >= '1' && e.key <= '9') {
          const numberIndex = parseInt(e.key, 10) - 1;
          if (numberIndex >= 0 && numberIndex < currentOptions.length) {
            e.preventDefault();
            if (numberIndex === freeTextIndex) {
              selectFreeText(currentQuestion.question, currentQuestion.multiSelect || false);
              freeTextInputRef.current?.focus();
            } else {
              handleOptionClick(currentQuestion.question, currentOptions[numberIndex].label, currentQuestionIndex);
            }
            setFocusedOptionIndex(numberIndex);
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [
      currentOptions,
      currentQuestion,
      currentQuestionIndex,
      focusedOptionIndex,
      handleOptionClick,
      currentQuestionHasAnswer,
      handleContinue,
      questions,
      interactionDisabled,
      freeTextIndex,
      selectFreeText
    ]);

    return (
      <div className="border rounded-t-xl border-b-0 border-border bg-muted/30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">{currentQuestion?.header || 'Question'}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="text-[12px] text-muted-foreground">
              {currentQuestion?.multiSelect ? 'Multi-select' : 'Single-select'}
            </span>
          </div>

          {/* Navigation */}
          {questions.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevious}
                disabled={currentQuestionIndex === 0}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed outline-none">
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              </button>
              <span className="text-xs text-muted-foreground px-1">
                {currentQuestionIndex + 1} / {questions.length}
              </span>
              <button
                onClick={handleNext}
                disabled={currentQuestionIndex === questions.length - 1}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed outline-none">
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>

        {/* Expired banner */}
        {expired && (
          <div className="px-3 py-1.5 text-[12px] text-amber-600 dark:text-amber-500 border-b border-border bg-amber-500/5">
            Expired — the agent may ask again.
          </div>
        )}

        {/* Current Question */}
        <div
          className={cn(
            'px-1 pb-2 transition-opacity duration-150 ease-out',
            isVisible ? 'opacity-100' : 'opacity-0',
            expired && 'opacity-60'
          )}>
          <div className="text-[14px] font-[450] text-foreground mb-3 pt-1 px-2">
            <span className="text-muted-foreground">{currentQuestionIndex + 1}.</span> {currentQuestion?.question}
          </div>

          {/* Options */}
          <div className="space-y-1">
            {currentOptions.map((option, optIndex) => {
              const isFocused = focusedOptionIndex === optIndex;
              const number = getOptionNumber(optIndex);

              if (optIndex === freeTextIndex) {
                const isSelected = isFreeTextSelected(currentQuestion.question);
                return (
                  <div
                    key="free-text"
                    onClick={() => {
                      if (interactionDisabled) return;
                      selectFreeText(currentQuestion.question, currentQuestion.multiSelect || false);
                      setFocusedOptionIndex(optIndex);
                      freeTextInputRef.current?.focus();
                    }}
                    className={cn(
                      'w-full flex items-start gap-3 p-2 text-[13px] text-foreground rounded-md text-left transition-colors',
                      isFocused ? 'bg-muted/70' : 'hover:bg-muted/50',
                      interactionDisabled && 'opacity-50 cursor-not-allowed'
                    )}>
                    <div
                      className={cn(
                        'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-medium transition-colors mt-0.5',
                        isSelected ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                      )}>
                      {number}
                    </div>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-[13px] transition-colors font-medium text-foreground">{option.label}</span>
                      {option.description && (
                        <span className="text-[12px] text-muted-foreground">{option.description}</span>
                      )}
                      <input
                        ref={freeTextInputRef}
                        type="text"
                        aria-label="Type your answer"
                        placeholder="Type your answer…"
                        value={customText[currentQuestion.question] || ''}
                        disabled={interactionDisabled}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={() => selectFreeText(currentQuestion.question, currentQuestion.multiSelect || false)}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustomText((prev) => ({ ...prev, [currentQuestion.question]: value }));
                          selectFreeText(currentQuestion.question, currentQuestion.multiSelect || false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleContinue();
                          }
                        }}
                        className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-[13px] text-foreground outline-none focus:border-foreground/50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                );
              }

              const isSelected = isOptionSelected(currentQuestion.question, option.label);

              return (
                <button
                  key={option.label}
                  onClick={() => {
                    if (interactionDisabled) return;
                    handleOptionClick(currentQuestion.question, option.label, currentQuestionIndex);
                    setFocusedOptionIndex(optIndex);
                  }}
                  disabled={interactionDisabled}
                  className={cn(
                    'w-full flex items-start gap-3 p-2 text-[13px] text-foreground rounded-md text-left transition-colors outline-none',
                    isFocused ? 'bg-muted/70' : 'hover:bg-muted/50',
                    interactionDisabled && 'opacity-50 cursor-not-allowed'
                  )}>
                  <div
                    className={cn(
                      'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-medium transition-colors mt-0.5',
                      isSelected ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                    )}>
                    {number}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={cn(
                        'text-[13px] transition-colors font-medium',
                        isSelected ? 'text-foreground' : 'text-foreground'
                      )}>
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-[12px] text-muted-foreground">{option.description}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkipWithGuard}
            // When expired, Dismiss must stay clickable even if a submit was
            // mid-flight (the component instance is reused, so isSubmitting can
            // still be true from the answer that raced the expiry).
            disabled={isSubmitting && !expired}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
            {expired ? 'Dismiss' : 'Skip All'}
          </Button>
          {!expired && (
            <Button
              size="sm"
              onClick={handleContinue}
              disabled={
                interactionDisabled ||
                hasCustomText ||
                (isLastQuestion ? !allQuestionsAnswered : !currentQuestionHasAnswer)
              }
              className="h-6 text-xs px-3 rounded-md">
              {isSubmitting ? (
                'Sending...'
              ) : (
                <>
                  {isLastQuestion ? 'Submit' : 'Continue'}
                  <CornerDownLeft className="w-3 h-3 ml-1 opacity-60" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  })
);
