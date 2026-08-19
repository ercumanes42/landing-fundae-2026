import * as React from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { trackFaqToggle } from "../../lib/tracking";

const faqs = [
  {
    question: "¿FUNDAE es una subvención?",
    answer: "No exactamente. Es un sistema de bonificaciones ligado a las cotizaciones por formación profesional que la empresa ya realiza durante el año."
  },
  {
    question: "¿Todas las empresas tienen crédito?",
    answer: "Depende de su situación, plantilla y cotizaciones. Por eso conviene revisar cada caso."
  },
  {
    question: "¿Puedo saber el crédito exacto con la calculadora?",
    answer: "No. Estima el crédito anual con los datos que facilites, pero no accede a la aplicación de FUNDAE ni conoce el crédito utilizado o reservado. El crédito y el saldo oficiales deben validarse con la información de TGSS y del expediente."
  },
  {
    question: "¿Qué tipo de formación puedo activar?",
    answer: "IA, productividad, liderazgo, competencias digitales, ventas, cumplimiento normativo, PRL u otras áreas alineadas con la actividad de la empresa."
  },
  {
    question: "¿Qué pasa si no uso el crédito?",
    answer: "El crédito se gestiona por ejercicio. Las empresas de menos de 50 personas pueden reservar crédito no dispuesto para los dos ejercicios siguientes si comunican su voluntad mediante el procedimiento aplicable; en los demás casos conviene revisar el expediente y los plazos oficiales."
  },
  {
    question: "¿El diagnóstico tiene coste?",
    answer: "No. La revisión inicial es gratuita y sirve para valorar si tiene sentido avanzar."
  }
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  const toggleFaq = (index: number) => {
    const isOpening = openIndex !== index;
    setOpenIndex(isOpening ? index : null);
    
    if (isOpening) {
      trackFaqToggle(faqs[index].question, true);
    }
  };

  return (
    <section className="py-24 bg-slate-50" id="faq">
      <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl mb-4">
            Preguntas Frecuentes
          </h2>
          <p className="text-lg text-gray-600">
            Resuelve tus dudas sobre la formación bonificada y cómo aprovecharla.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={faq.question} className="rounded-xl bg-white border border-gray-200 overflow-hidden shadow-sm">
              <button
                id={"faq-trigger-" + i}
                aria-controls={"faq-panel-" + i}
                aria-expanded={openIndex === i}
                className="flex min-h-11 w-full items-center justify-between bg-white px-6 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#302B7B]"
                onClick={() => toggleFaq(i)}
              >
                <span className="font-semibold text-gray-900">{faq.question}</span>
                <ChevronDown 
                  className={`h-5 w-5 text-gray-500 transition-transform ${openIndex === i ? 'rotate-180' : ''}`} 
                />
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    id={"faq-panel-" + i}
                    role="region"
                    aria-labelledby={"faq-trigger-" + i}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="px-6 pb-4 pt-1 text-gray-600 leading-relaxed border-t border-gray-50">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
