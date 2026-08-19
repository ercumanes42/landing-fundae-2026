import * as React from "react";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white pb-24 text-slate-600 lg:pb-0">
      <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 py-8 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-[#302B7B]">
                <div className="h-4 w-4 rounded-sm border-2 border-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-[#302B7B]">
                GFS <span className="font-light">Consulting Group</span>
              </span>
            </div>
            <p className="mb-4 max-w-sm text-sm text-slate-500">
              Orientación y servicios para gestionar formación programada por las empresas.
            </p>
            <div className="space-y-1 text-xs text-slate-500">
              <p><strong>Razón social:</strong> Gestión de Formación y Selección, S.L.</p>
              <p><strong>NIF:</strong> B13306428</p>
              <p><strong>Domicilio:</strong> Paseo de la Castellana, 141, 28046 Madrid</p>
            </div>
          </div>

          <div>
            <h4 className="mb-4 font-bold text-slate-900">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="/aviso-legal" className="transition-colors hover:text-[#302B7B]">Aviso legal</a></li>
              <li><a href="/privacidad" className="transition-colors hover:text-[#302B7B]">Política de privacidad</a></li>
              <li><a href="/cookies" className="transition-colors hover:text-[#302B7B]">Política de cookies</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-bold text-slate-900">Contacto</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="mailto:administracion@gfs.es" className="transition-colors hover:text-[#302B7B]">administracion@gfs.es</a></li>
              <li><a href="tel:+34902120567" className="transition-colors hover:text-[#302B7B]">+34 902 120 567</a></li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between border-t border-slate-100 pt-4 text-[11px] font-medium text-slate-400 md:flex-row">
          <p>&copy; {new Date().getFullYear()} Gestión de Formación y Selección, S.L.</p>
          <p className="mt-2 max-w-2xl text-center md:mt-0 md:text-right">
            Información orientativa. Para datos oficiales sobre el crédito de formación, consulta FUNDAE y los organismos competentes.
          </p>
        </div>
      </div>
    </footer>
  );
}
