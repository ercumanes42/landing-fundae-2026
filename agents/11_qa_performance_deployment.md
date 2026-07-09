# AGENTE 11 — QA, PERFORMANCE Y DEPLOYMENT

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-11` |
| **Nombre** | QA, Performance y Deployment |
| **Fase** | 11 — Final |
| **Prioridad** | Máxima — Última puerta antes de entregar |
| **Estado** | `pendiente` |

---

## Misión

Realizar la **verificación final** de la landing completa: comprobar que todo funciona correctamente, identificar bugs, optimizar rendimiento y preparar instrucciones de despliegue en Vercel.

---

## Responsabilidades

1. **Build check** — `npm install` + `npm run build` sin errores.
2. **Dev server** — `npm run dev` funciona correctamente.
3. **Responsive** — Verificar mobile, tablet, desktop.
4. **Formularios** — Todos los formularios envían datos.
5. **Webhooks** — Payloads se envían correctamente.
6. **Estados** — Loading, success, error en todos los formularios.
7. **Lead scoring** — Cálculos correctos.
8. **UTMs** — Captura funcional.
9. **Botones/CTAs** — Todos los botones tienen acción.
10. **Scroll** — Smooth scroll a secciones.
11. **Calendly** — Integración funcional.
12. **Vídeo** — Embed funcional.
13. **SEO** — Meta tags presentes.
14. **Accesibilidad** — Focus states, alt text, contraste.
15. **Performance** — Tiempo de carga, bundle size.
16. **TypeScript** — Sin errores de tipos.
17. **Despliegue Vercel** — Instrucciones completas.

---

## Inputs

| Input | Fuente |
|---|---|
| Código completo finalizado | Agentes 02-10 |
| Configuración del proyecto | `package.json`, `vite.config.ts` |
| Variables de entorno | `.env.example` |

---

## Checklist de QA

### Build y Dependencias
- [ ] `npm install` — Sin errores ni vulnerabilidades críticas
- [ ] `npm run build` — Build exitoso sin warnings
- [ ] `npm run dev` — Dev server arranca correctamente
- [ ] `npm run lint` — Sin errores de TypeScript

### Funcionalidad
- [ ] Formulario Checklist — Envía datos correctamente
- [ ] Formulario Calculadora — 3 pasos funcionales, resultado correcto
- [ ] Formulario Webinar — Envía datos correctamente
- [ ] Formulario Diagnóstico — Envía datos y redirige a Calendly
- [ ] Lead scoring — Cálculos verificados con 5+ escenarios
- [ ] UTMs — Se capturan desde `?utm_source=test&utm_medium=test`
- [ ] Referrer — Se captura `document.referrer`
- [ ] Tracking events — Se disparan los 15+ eventos definidos
- [ ] Smooth scroll — Todos los anchor links funcionan
- [ ] Sticky header — Se muestra/oculta correctamente
- [ ] Mobile sticky CTA — Visible en mobile, oculto en desktop
- [ ] Vídeo embed — Se carga y reproduce
- [ ] Calendly link — Abre correctamente

### Responsive
- [ ] Mobile (375px) — Sin overflow horizontal
- [ ] Mobile (414px) — Layout correcto
- [ ] Tablet (768px) — Layout correcto
- [ ] Desktop (1024px) — Layout correcto
- [ ] Desktop (1440px) — Layout correcto
- [ ] Touch targets ≥ 44px en mobile

### Visual
- [ ] Paleta de colores consistente
- [ ] Tipografía Inter cargada
- [ ] Iconos Lucide visibles
- [ ] Animaciones suaves (sin jank)
- [ ] Contraste WCAG AA
- [ ] Focus states en elementos interactivos

### SEO
- [ ] `<title>` correcto
- [ ] `<meta description>` presente
- [ ] `<html lang="es">` (no `en`)
- [ ] Open Graph tags presentes
- [ ] H1 único
- [ ] Schema.org FAQ válido

### Legal / RGPD
- [ ] Checkbox privacidad en todos los formularios
- [ ] Checkbox comunicaciones opcional
- [ ] Microcopy legal visible
- [ ] Footer con links legales

### Performance
- [ ] Bundle size < 500KB (gzip)
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] No layout shifts (CLS < 0.1)
- [ ] Fuente Inter preloaded
- [ ] Imágenes lazy-loaded

---

## Instrucciones de Despliegue en Vercel

### Pre-requisitos
1. Cuenta en Vercel
2. Repositorio en GitHub/GitLab/Bitbucket
3. Variables de entorno configuradas

### Pasos
1. Conectar repositorio a Vercel
2. Configurar Build Settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
3. Configurar Environment Variables:
   - Añadir TODAS las variables de `.env.example` con valores reales
4. Deploy

### Variables de Entorno en Vercel
```
VITE_CHECKLIST_WEBHOOK_URL    = [URL real del webhook Make/n8n]
VITE_CALCULATOR_WEBHOOK_URL   = [URL real del webhook Make/n8n]
VITE_WEBINAR_WEBHOOK_URL      = [URL real del webhook Make/n8n]
VITE_DIAGNOSTIC_WEBHOOK_URL   = [URL real del webhook Make/n8n]
VITE_CALENDLY_URL             = [URL de tu calendario Calendly]
VITE_VIDEO_URL                = [URL del vídeo YouTube embed]
VITE_CHECKLIST_PDF_URL        = [URL del PDF del checklist]
VITE_WEBINAR_DATE             = [Fecha del webinar]
VITE_WEBINAR_TIME             = [Hora del webinar]
VITE_POSTHOG_KEY              = [Clave PostHog]
VITE_LINKEDIN_PARTNER_ID      = [ID LinkedIn]
VITE_GA4_ID                   = [ID Google Analytics 4]
```

---

## Reglas de Ejecución

1. **Ejecutar build ANTES de reportar** — Verificar que compila.
2. **Documentar TODOS los errores** encontrados con archivo y línea.
3. **Corregir errores menores** directamente (typos, imports rotos).
4. **Escalar errores mayores** al agente correspondiente.
5. **Producir informe QA estructurado** con pass/fail por categoría.
6. **Listar pendientes** que requieren intervención humana.

---

## Archivos que PUEDE modificar

```
Cualquier archivo — para correcciones menores de bugs.
No refactorizaciones ni cambios de diseño.
```

---

## Outputs Esperados

| Output | Formato |
|---|---|
| Informe QA completo | Checklist pass/fail |
| Lista de errores corregidos | Tabla |
| Lista de pendientes humanos | Lista |
| Instrucciones de despliegue | Paso a paso |
| Variables de entorno necesarias | Tabla |

---

## Criterios de Éxito

- [ ] `npm run build` — Exit code 0.
- [ ] 0 errores TypeScript.
- [ ] 4 formularios funcionales.
- [ ] Responsive en 5 breakpoints.
- [ ] 15+ eventos de tracking implementados.
- [ ] SEO meta tags presentes.
- [ ] RGPD checkboxes en todos los formularios.
- [ ] Instrucciones de despliegue Vercel completas.
- [ ] Lista de pendientes humanos documentada.
