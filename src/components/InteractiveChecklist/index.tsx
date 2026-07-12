import React, { useState, useEffect } from "react";
import { trackEvent } from "../../lib/tracking";
import { 
  introQuestion, 
  checklistQuestions, 
  calculateChecklistScore, 
  getChecklistResultLevel, 
  getChecklistRecommendations 
} from "../../lib/checklistScoringV2";
import { QuestionBlock } from "./QuestionBlock";
import { ResultView } from "./ResultView";
import { RotateCcw } from "lucide-react";

// Distribution of questions into 3 blocks (screens)
const BLOCK_1 = [introQuestion, checklistQuestions[0], checklistQuestions[1]];
const BLOCK_2 = [checklistQuestions[2], checklistQuestions[3], checklistQuestions[4]];
const BLOCK_3 = [checklistQuestions[5], checklistQuestions[6], checklistQuestions[7]];

const BLOCKS = [BLOCK_1, BLOCK_2, BLOCK_3];

export function InteractiveChecklist() {
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasStarted, setHasStarted] = useState(false);
  const [lastActionTimestamp, setLastActionTimestamp] = useState<number>(Date.now());

  // Analytics: Track when the component first mounts and is visible
  useEffect(() => {
    trackEvent('checklist_interactive_open', {
      page_url: window.location.href
    });
    setLastActionTimestamp(Date.now());
  }, []);

  const handleAnswer = (questionId: string, answer: string) => {
    const now = Date.now();
    const elapsedSeconds = Math.max(1, Math.round((now - lastActionTimestamp) / 1000));
    setLastActionTimestamp(now);

    if (!hasStarted) {
      setHasStarted(true);
      trackEvent('checklist_interactive_start', {
        page_url: window.location.href
      });
    }

    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    
    trackEvent('checklist_question_answered', {
      question_id: questionId,
      selected_answer: answer,
      time_spent_seconds: elapsedSeconds
    });
  };

  const handleNext = () => {
    if (currentBlockIndex < BLOCKS.length) {
      setCurrentBlockIndex(prev => prev + 1);
      
      // If moving to result screen (index = length)
      if (currentBlockIndex === BLOCKS.length - 1) {
        trackEvent('checklist_interactive_completed', {
          page_url: window.location.href
        });
        
        const score = calculateChecklistScore(answers);
        const result = getChecklistResultLevel(score);
        
        trackEvent('checklist_result_view', {
          checklist_score: score,
          checklist_result_level: result.level,
        });
      }
    }
  };

  const handleBack = () => {
    if (currentBlockIndex > 0) {
      setCurrentBlockIndex(prev => prev - 1);
    }
  };

  const handleReset = () => {
    setAnswers({});
    setCurrentBlockIndex(0);
    setHasStarted(false);
  };

  return (
    <div className="w-full relative">
      {/* Reset button - Only show if started and not on result screen yet */}
      {hasStarted && currentBlockIndex < BLOCKS.length && (
        <div className="absolute top-0 right-0 -mt-12">
          <button 
            onClick={handleReset}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reiniciar
          </button>
        </div>
      )}

      {currentBlockIndex < BLOCKS.length ? (
        <QuestionBlock 
          questions={BLOCKS[currentBlockIndex]}
          currentBlock={currentBlockIndex + 1}
          totalBlocks={BLOCKS.length}
          answers={answers}
          onAnswer={handleAnswer}
          onNext={handleNext}
          onBack={handleBack}
        />
      ) : (
        <ResultView 
          score={calculateChecklistScore(answers)}
          resultLevel={getChecklistResultLevel(calculateChecklistScore(answers))}
          recommendations={getChecklistRecommendations(answers)}
          answers={answers}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
