import * as React from "react";

export function Footer() {
  return (
    <footer className="bg-white text-slate-600 border-t border-slate-200 pb-24 lg:pb-0">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="hidden pb-0 border-b-0 border-transparent"></div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 py-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-900">
                <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
              </div>
              <span className="text-xl font-bold tracking-tight text-blue-900">
                FUNDAE<span className="font-light">STRATEGIC</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 max-w-sm mb-4">
              Ayudamos a pymes y empresas a activar su crédito de formación bonificable de manera sencilla y transparente.
            </p>
            <div className="text-xs text-slate-400 space-y-1">
              <p><strong>Razón social:</strong> GFS Consulting.</p>
              <p><strong>NIF/CIF:</strong> B13306428</p>
              <p><strong>Dirección:</strong> P.º de la Castellana, 141, Tetuán, 28046 Madrid</p>
              <p><strong>Responsable del tratamiento:</strong> Joaquín González del Pino</p>
            </div>
          </div>
          
          <div>
            <h4 className="text-slate-900 font-bold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="/aviso-legal" className="hover:text-blue-900 transition-colors">Aviso legal</a></li>
              <li><a href="/privacidad" className="hover:text-blue-900 transition-colors">Política de privacidad</a></li>
              <li><a href="/cookies" className="hover:text-blue-900 transition-colors">Política de cookies</a></li>
              <li><a href="/aviso-legal" className="hover:text-blue-900 transition-colors">Términos y condiciones</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-slate-900 font-bold mb-4">Contacto</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="mailto:administracion@gfs.es" className="hover:text-blue-900 transition-colors">administracion@gfs.es</a></li>
              <li><a href="#" className="hover:text-blue-900 transition-colors">LinkedIn</a></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-4 flex flex-col md:flex-row items-center justify-between text-[11px] text-slate-400 font-medium border-t border-slate-100">
          <p>&copy; {new Date().getFullYear()} GFS Consulting. Todos los derechos reservados.</p>
          <p className="mt-2 md:mt-0 max-w-2xl text-center md:text-right">
            Esta información es de carácter orientativo. Para cifras oficiales y exactas sobre el crédito 
            de formación, debe consultarse la plataforma de FUNDAE o los organismos competentes.
          </p>
        </div>
      </div>
    </footer>
  );
}
