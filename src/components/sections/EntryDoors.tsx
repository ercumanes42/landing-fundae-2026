import * as React from "react";
import { Button } from "../ui/Button";
import { CheckSquare, Calculator, Search, MonitorPlay } from "lucide-react";
import { motion } from "motion/react";
import { copy } from "../../config/copy";

export function EntryDoors() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const icons = [
    <Calculator className="h-8 w-8" />,
    <CheckSquare className="h-8 w-8" />,
    <MonitorPlay className="h-8 w-8" />,
    <Search className="h-8 w-8" />,
  ];

  return (
    <section className="py-24 bg-blue-950 text-white relative overflow-hidden" id="opciones">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2" />
      
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold sm:text-4xl mb-4">
            {copy.entryDoors.sectionTitle}
          </h2>
          <p className="text-lg text-blue-100">
            {copy.entryDoors.sectionSubtitle}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {copy.entryDoors.doors.map((door, i) => {
            return (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex flex-col rounded-2xl p-8 border backdrop-blur-sm h-full group transition-all duration-300 hover:-translate-y-2 bg-blue-900/50 border-emerald-500/30 hover:border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.08)] hover:shadow-[0_0_40px_rgba(16,185,129,0.18)]"
              >
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl transition-colors bg-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500/30">
                  {icons[i] || <CheckSquare className="h-7 w-7" />}
                </div>
                <h3 className="text-xl font-bold mb-3 text-white leading-tight">{door.title}</h3>
                <p className="text-slate-200 text-sm mb-8 flex-grow leading-relaxed">
                  {door.description}
                </p>
                <Button 
                  variant="primary" 
                  className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/50 border-none w-full"
                  onClick={() => scrollTo(door.href.substring(1))}
                >
                  {door.cta}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
