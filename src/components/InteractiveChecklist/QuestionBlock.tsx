import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { ChecklistQuestion } from "../../lib/checklistScoring";

interface QuestionBlockProps {
  questions: ChecklistQuestion[];
  currentBlock: number;
  totalBlocks: number;
  answers: Record<string, string>;
  onAnswer: (questionId: string, answer: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function QuestionBlock({
  questions,
  currentBlock,
  totalBlocks,
  answers,
  onAnswer,
  onNext,
  onBack
}: QuestionBlockProps) {
  // A block is complete if all questions in the block have an answer
  const isComplete = questions.every((q) => answers[q.id] !== undefined);
  const progress = (currentBlock / (totalBlocks + 1)) * 100; // +1 to account for result/form screen

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Header and Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className={`text-slate-500 hover:text-slate-900 flex items-center transition-colors font-medium ${
              currentBlock === 1 ? "invisible" : ""
            }`}
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Atrás
          </button>
          <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">
            Paso {currentBlock} de {totalBlocks}
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-blue-600 rounded-full"
            initial={{ width: `${((currentBlock - 1) / (totalBlocks + 1)) * 100}%` }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`block-${currentBlock}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          {questions.map((q) => (
            <div key={q.id} className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200">
              {q.isIntro && (
                <div className="mb-6">
                  <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">
                    {q.question}
                  </h3>
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <p className="text-sm text-blue-900 leading-relaxed">
                      FUNDAE gestiona el sistema de formación bonificada en España. A través de este sistema, las empresas pueden recuperar parte del importe invertido en formación mediante bonificaciones en sus cotizaciones a la Seguridad Social, siempre que cumplan los requisitos correspondientes.
                    </p>
                  </div>
                </div>
              )}
              {!q.isIntro && (
                <h3 className="text-xl font-bold text-slate-900 mb-5">{q.question}</h3>
              )}

              <div className="space-y-3">
                {q.options.map((option, idx) => {
                  const isSelected = answers[q.id] === option.text;
                  return (
                    <button
                      key={idx}
                      onClick={() => onAnswer(q.id, option.text)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center group ${
                        isSelected
                          ? "border-blue-600 bg-blue-50"
                          : "border-slate-200 hover:border-blue-600 hover:bg-slate-50 bg-white"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 mr-4 flex-shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? "border-blue-600" : "border-slate-300 group-hover:border-blue-600"
                        }`}
                      >
                        <div
                          className={`w-2.5 h-2.5 rounded-full bg-blue-600 transition-opacity ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      </div>
                      <span
                        className={`text-base font-medium transition-colors ${
                          isSelected ? "text-blue-900" : "text-slate-700 group-hover:text-blue-900"
                        }`}
                      >
                        {option.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="pt-4 flex justify-end">
            <button
              onClick={onNext}
              disabled={!isComplete}
              className="px-8 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
            >
              {currentBlock === totalBlocks ? "Ver Resultados" : "Siguiente"}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
