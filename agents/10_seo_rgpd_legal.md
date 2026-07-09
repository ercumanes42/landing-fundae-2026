# AGENTE 10 — SEO, CONTENIDO Y RGPD

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-10` |
| **Nombre** | SEO, Contenido y RGPD |
| **Fase** | 10 — SEO y Legal |
| **Prioridad** | Media |
| **Estado** | `pendiente` |

---

## Misión

Optimizar el **SEO técnico y on-page**, la **estructura semántica HTML** y los **elementos legales RGPD** de la landing. Garantizar que la landing es indexable, accesible y cumple con la normativa de protección de datos.

---

## Responsabilidades

### SEO
1. **Title tag** — Optimizado para búsqueda y CTR.
2. **Meta description** — Descriptiva y persuasiva.
3. **Open Graph** — Tags completos para compartir en redes.
4. **Estructura de headings** — H1 único, H2 claros, jerarquía correcta.
5. **HTML semántico** — Usar `<section>`, `<article>`, `<nav>`, `<footer>` correctamente.
6. **Schema.org** — Structured data para FAQs y Organization.
7. **Canonical URL** — Prevenir contenido duplicado.
8. **Robots meta** — Configurar indexación.
9. **Sitemap** — Preparar para generación.
10. **Performance SEO** — Lazy loading de imágenes, preconnect de fuentes.

### RGPD / Legal
1. **Checkbox de privacidad** — Obligatorio en TODOS los formularios.
2. **Checkbox de comunicaciones** — Opcional en todos los formularios.
3. **Microcopy legal** — Texto bajo checkboxes con enlace a política.
4. **Links a páginas legales** — Aviso legal, Privacidad, Cookies.
5. **Footer legal** — Datos de empresa y links legales.
6. **Cookie banner** — Preparar estructura básica.

---

## Inputs

| Input | Fuente |
|---|---|
| `index.html` actual | MVP |
| Componentes de secciones | Agentes 03-06 |
| Requisitos SEO | Prompt del usuario |
| Requisitos RGPD | Prompt del usuario |

---

## SEO — Implementación

### Title Tag
```html
<title>Crédito FUNDAE para empresas | Calcula si tu pyme puede aprovecharlo</title>
```

### Meta Description
```html
<meta name="description" content="Descubre si tu empresa está dejando sin usar su crédito FUNDAE. Calculadora, checklist gratuito, webinar y diagnóstico para pymes." />
```

### Open Graph
```html
<meta property="og:type" content="website" />
<meta property="og:title" content="Crédito FUNDAE para empresas | Calcula si tu pyme puede aprovecharlo" />
<meta property="og:description" content="Descubre si tu empresa está dejando sin usar su crédito FUNDAE. Calculadora, checklist gratuito, webinar y diagnóstico para pymes." />
<meta property="og:url" content="https://tu-dominio.com" />
<meta property="og:image" content="https://tu-dominio.com/og-image.jpg" />
<meta property="og:locale" content="es_ES" />
<meta property="og:site_name" content="FUNDAE para Empresas" />
```

### Twitter Card
```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Crédito FUNDAE para empresas" />
<meta name="twitter:description" content="Descubre si tu empresa está dejando sin usar su crédito FUNDAE." />
```

### Keywords Target
```
- crédito FUNDAE empresas
- formación bonificada empresas
- FUNDAE pymes
- calcular crédito FUNDAE
- formación bonificada IA
- formación bonificada Valencia
- formación bonificada Madrid
- cursos bonificados FUNDAE
- bonificar formación trabajadores
```

### Estructura de Headings Correcta
```
H1: [Un solo H1 en el Hero — mensaje principal]
  H2: Sección vídeo
  H2: Datos FUNDAE
  H2: Razones
  H2: Tres puertas de entrada
  H2: Calculadora
  H2: Checklist
  H2: Webinar
  H2: Soluciones
  H2: Diagnóstico
  H2: Cómo funciona
  H2: Preguntas frecuentes
  H2: CTA final
```

### Schema.org — FAQ
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "¿Qué es el crédito FUNDAE?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "El crédito FUNDAE es un importe..."
      }
    }
  ]
}
</script>
```

---

## RGPD — Implementación

### Checkbox de Privacidad (obligatorio)
```
☐ He leído y acepto la política de privacidad y el aviso legal.
   Responsable: [Empresa]. Finalidad: gestionar tu consulta.
   Derechos: acceso, rectificación, supresión. Más info en Política de Privacidad.
```

### Checkbox de Comunicaciones (opcional)
```
☐ Acepto recibir comunicaciones sobre formación bonificada y novedades FUNDAE.
   Puedes darte de baja en cualquier momento.
```

### Footer Legal
```
© 2026 [Nombre Empresa]. Todos los derechos reservados.
Aviso Legal | Política de Privacidad | Política de Cookies
NIF: XXXXXXXX | Dirección: XXXXXXXX
```

---

## Reglas de Ejecución

1. **No duplicar el H1** — Solo uno en toda la landing.
2. **Mantener jerarquía de headings** — H1 > H2 > H3, sin saltos.
3. **Lang attribute en HTML** — `lang="es"` (no `lang="en"`).
4. **Alt text en imágenes** — Descriptivo para SEO y accesibilidad.
5. **No keyword stuffing** — Uso natural de keywords.
6. **Los links legales pueden apuntar a `#`** por ahora — Se reemplazarán con URLs reales.
7. **El Schema.org debe ser válido** — Testeable en Google's Rich Results Test.

---

## Archivos que PUEDE modificar

```
index.html                                   # Meta tags, lang, Schema.org
src/components/sections/Footer.tsx           # Footer legal
src/components/sections/FAQSection.tsx        # Schema.org FAQ
src/components/sections/**/*                 # Solo headings semánticos y alt text
```

## Archivos que NO PUEDE modificar

```
src/lib/**/*          # Lógica
src/config/**/*       # Configuración
src/hooks/**/*        # Hooks
src/types/**/*        # Tipos
```

---

## Criterios de Éxito

- [ ] Title tag optimizado en `index.html`.
- [ ] Meta description optimizada.
- [ ] Open Graph completo (title, description, image, type, locale).
- [ ] Twitter Card configurada.
- [ ] `lang="es"` en tag HTML.
- [ ] H1 único en toda la landing.
- [ ] Jerarquía de headings correcta (H1 > H2 > H3).
- [ ] Schema.org FAQ implementado.
- [ ] Checkbox de privacidad en todos los formularios.
- [ ] Checkbox de comunicaciones opcional en todos.
- [ ] Microcopy legal bajo checkboxes.
- [ ] Footer con links legales y datos de empresa.
- [ ] HTML semántico (`<section>`, `<nav>`, `<footer>`).
- [ ] Canonical URL configurada.
