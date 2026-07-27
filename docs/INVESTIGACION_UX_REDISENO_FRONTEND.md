# Investigación UX — Rediseño del frontend de Aurevia

> Documento de referencia. Reúne, en un solo lugar, el relevamiento completo de las tres
> aplicaciones actuales (Panel, PWA Asistentes, PWA Familias) y la investigación de
> referencias externas (piso argentino / techo internacional) hecha para preparar el
> rediseño de UX/UI de todo el frontend, incluyendo el futuro sitio público de cada
> Prestadora. Es un documento vivo: se sigue enriqueciendo a medida que aparecen nuevos
> ángulos de investigación. No reemplaza `docs/DESIGN_SYSTEM.md` (que define la identidad
> visual vigente) ni el futuro plan de rediseño (que requiere aprobación explícita del
> Desarrollador antes de tocar código, según `CLAUDE.md` §11) — es el inventario/evidencia
> que alimenta ese plan.

**Origen:** sesión del 2026-07-21, a partir del reclamo del Desarrollador de que "todo el
frontend de todas las pantallas es un desastre" porque está "pensado y nombrado con
criterios de sistema" en vez de con lógica humana. El Desarrollador eligió explícitamente
empezar por un relevamiento completo de las 3 apps antes de tocar cualquier código o
proponer un plan.

---

## Parte 1 — Relevamiento de las 3 aplicaciones actuales

Relevamiento crudo (sin juicio de valor) de las pantallas de cada app: título visible,
botones/acciones principales, orden de campos, textos que se filtran como jerga técnica
en vez de lenguaje natural, y estados vacío/cargando.

### 1.1 Panel (la app que usan Coordinadores y Administradores de cada Prestadora)

Rutas definidas en `panel/src/App.jsx`. 40 archivos de página relevados.

**Dashboard** (`Dashboard.jsx`) — Título "Dashboard". Solo tarjetas de métricas (KPIs), sin
acciones ni forms.

**Guardias / GuardiasGrid / NuevaGuardiaModal / GuardiaAcciones**
- `Guardias.jsx` — Título "Guardias". Botón "Nueva guardia". Filtros: rango de fechas,
  estado, búsqueda.
- `GuardiasGrid.jsx` — vista semanal drag-and-drop.
- `NuevaGuardiaModal.jsx` — Título "Nueva guardia" (única o serie recurrente).
- `GuardiaAcciones.jsx` — Título "Detalle de guardia". Botones: check-in, checkpoint
  salida, check-out, cancelar, marcar ausente, aviso previo. Texto notable: *"El check-out
  está bloqueado por el protocolo de continuidad de guardia..."* — nombra un módulo interno
  del sistema dentro de un texto dirigido al usuario.

**Asistentes + 8 pestañas de ficha**
- `Asistentes.jsx` — Título "Plantel de Asistentes". Botón "Nuevo Asistente".
- `AsistenteDetalle.jsx` — Tabs: Perfil, Verificación, Vínculo/Cese, Ausencias/Cobertura,
  Certificado, Score de Riesgo, Simulador de Vínculo, Comunicación (8 para admin, 5 para
  coordinador).
- `PerfilTab.jsx` — Campos en orden: nombre, DNI, teléfono, email, fecha de alta (solo
  lectura), especialidades, zonas, estado, [solo admin] tipo de vínculo, categoría
  CCT/sueldo básico o valor hora, horas semanales.
- `VerificacionTab.jsx` — Título "Proceso de Incorporación de Asistentes". Explicación:
  "Uso interno del Panel — registra el avance del postulante por las 5 etapas...". Tracker
  manual de 5 etapas (identidad, antecedentes, entrevista, capacitación + una más), con
  `&lt;select&gt;` pendiente/aprobada/rechazada y notas — **sin verificación automática por
  IA, sin curso online ni examen real** (todo manual).
- `VinculoCeseTab.jsx` — Historial de ceses + cálculo de liquidación. **Hallazgo clave**:
  vuelca `JSON.stringify(resultado.detalleCalculo, null, 2)` dentro de un `&lt;pre&gt;`,
  mostrado directo al usuario final — datos técnicos crudos, no una explicación legible.
- `CertificadoTab.jsx` — Título "Certificado de Aptitud". Menciona un QR que apunta a una
  "página pública de verificación que todavía no está construida".
- `ScoreRiesgoTab.jsx` — Título "Score de Riesgo de Reclasificación". El texto de ayuda dice
  literalmente: *"Los pesos de cada indicador vienen de **escalas_legales**"* — nombre de
  tabla de base de datos expuesto tal cual en un texto pensado para un humano.
- `SimuladorVinculoTab.jsx` — Título "Simulador de Vínculo". Tabla de proyección de costos
  monotributo vs. dependencia.
- `ComunicacionTab.jsx` — envuelve `HiloComunicacion`. Texto aclaratorio: "No es un chat con
  el Asistente ni con la Familia."
- `NuevoAsistenteModal.jsx` — Título "Nuevo Asistente".

**Familias + FamiliaDetalle + submodales**
- `Familias.jsx` — Título "Familias". Columnas: nombre, teléfono, email, localidad,
  pacientes, fecha de alta.
- `FamiliaDetalle.jsx` — el h1 usa `familia.solicitudes?.nombre` (el nombre de contacto de
  la solicitud original, no un campo propio de "nombre de familia"). Secciones: Contacto,
  Pacientes, Guardias activas, Historial de reportes, Alertas activas — **las últimas 3
  muestran el mismo texto genérico** ("módulo no disponible") sin diferenciar qué es lo que
  realmente falta en cada una.
- `EditarPacienteModal.jsx` / `NuevoPacienteModal.jsx` — Campos: nombre, fecha de
  nacimiento, domicilio, **nivel de complejidad** (select con opciones literales "I"/"II"/
  "III", sin texto explicativo de qué significa cada nivel), patologías, obra social,
  número de afiliado, medicación habitual.
- `PrestacionesPaciente.jsx` — 3 bloques: Prestaciones vigentes, Paquetes de Prestaciones,
  Cierre de servicio (con advertencia: "No se puede deshacer desde acá"). El select de
  Prestación arma el texto de la opción concatenando campos crudos: `"{tipo_servicio} —
  {modalidad} ({precio})"`.

**Postulaciones / PostulacionDetalle**
- `Postulaciones.jsx` — Título "Postulaciones de Asistentes".
- `PostulacionDetalle.jsx` — Botón "Iniciar Proceso de Incorporación" ("Crea la cuenta real
  del Asistente... No se puede deshacer desde acá").

**Solicitudes / SolicitudDetalle**
- `Solicitudes.jsx` — Título "Solicitudes de Servicio".
- `SolicitudDetalle.jsx` — Botón "Convertir en Familia".

**Comunicacion** — Título "Comunicación". Bandeja global + hilo por Asistente (mismo
componente).

**Continuidad** — Título "Continuidad de guardia". 3 subsecciones: Incidentes, Alertas
tempranas, Notificaciones de cierre fuera de zona.

**Documentacion** — Título "Documentación" (renombrado desde "Cumplimiento normativo", ver
`docs/claude_history.md`). Tipos fijos mencionados en texto: Monotributo, ART, Seguro.

**Facturacion** — Título "Facturación a Familias".

**Evv** — Título visible "Verificación de Guardias" (el nombre técnico interno del módulo,
"EVV"/Electronic Visit Verification, no se filtra a la UI).

**ListaPrecios / ListaPrecioDetalle** — Título "Lista de Precios" ("Referencia interna...
Nunca se muestra a Familias"). El título del modal de edición es el string crudo
`${precio.tipo_servicio} — ${precio.modalidad}`.

**UsuariosPanel** — Título "Usuarios del Panel". El dropdown de prestadora compone
`${p.nombre_fantasia} (${p.estado})` — muestra el valor crudo de `estado` sin traducir,
entre paréntesis.

**Configuracion** (8 pestañas) — Título "Configuración".
- TabEmpresa: Nombre de la empresa, Teléfono, WhatsApp, Email de contacto, Dominio del
  sitio, Zona de cobertura.
- TabZonas: código/nombre/categoría/activa.
- TabServicios: "Horizonte de generación de guardias" — el texto de ayuda dice literalmente
  *"Es un valor técnico interno, nunca visible para Familias ni Asistentes"*. También
  "Escalada de relevo (protocolo de continuidad de guardia)".
- TabDocumentos: plazo de aviso + catálogo de tipos de documento.
- TabNotificaciones: nombres de eventos con fallback a texto crudo si falta traducción.
- TabWhatsapp: credenciales con labels literalmente en jerga técnica de la API de Meta
  ("waba_id", "phone_number_id"); categoría de plantilla (utility/marketing/authentication)
  mostrada sin traducir en el select.
- TabPermisos: acción/alcance (solo_admin / admin_y_coordinador).
- TabSeguridad: texto en prosa con nombres de rol en formato técnico ("Superadmin",
  "Admin_plataforma").

**Importacion** — Título "Importar datos". Flujo de 3 pasos con revisión humana obligatoria
antes de confirmar ("La IA propone... vos revisás y confirmás antes de que se cree nada").

**InformesObraSocial** — Título "Informes para Obra Social". El detalle de guardias del
preview muestra `g.modalidad` y `g.estado` **crudos**, sin pasar por diccionario de
traducción. Usa `window.prompt()` nativo del navegador para pedir el motivo de anulación
(no un modal propio del sistema).

**AdminPlataforma** — Título "Panel de CeltaTech" (nombra a la empresa dueña del software, no
"Aurevia"). Tabs: Resumen, Licenciatarias, Planes y funciones, Facturación de licencias. El
badge de estado de una Licenciataria muestra el valor crudo del enum como texto visible sin
traducir. "Incluye" de un Plan junta claves de módulos crudas separadas por coma.

**Prestadoras** — Título "Prestadoras". La columna "estado" se muestra sin badge y sin
traducir.

**Auditoria** — Título "Auditoría". Cuando no hay descripción preparada para un evento,
arma la frase mostrando **el nombre de la tabla de base de datos y la operación CRUD
cruda** (`${tabla_afectada} (${operacion})`), o directamente el método+ruta de API.

**Login / Mfa** — Título "Panel de Administración" / "Activá el segundo factor de
seguridad" / "Verificación en dos pasos".

**Patrones transversales detectados en el Panel** (frecuencia, no juicio):
- Valores de enum mostrados sin traducir en al menos 6 pantallas distintas.
- Nombres de tabla de base de datos expuestos en texto de ayuda al usuario
  (`escalas_legales`).
- JSON crudo renderizado directamente al usuario (Vínculo/Cese).
- Strings compuestos por concatenación de campos técnicos usados como label visible (Lista
  de Precios, Prestaciones, Auditoría).
- Uso de `window.prompt()` nativo en vez de un componente propio del sistema.
- Roles con formato tipo-enum ("Superadmin", "Admin_plataforma") dentro de oraciones en
  español.
- Estados vacíos genéricos reutilizados para situaciones distintas (FamiliaDetalle).

### 1.2 PWA Asistentes (la usan los cuidadores desde el celular)

Rutas en `pwa-asistentes/src/App.jsx`. Nav inferior fija: "Mis Guardias" / "Mi Perfil".

**Login** — Título "Aurevia — Asistentes". Campos: Email, Contraseña. Error: "Email o
contraseña incorrectos."

**Mis Guardias** (`MisGuardias.jsx`) — Título "Mis Guardias". Cada tarjeta: nombre del
paciente → fecha y horario → badge de estado. **El badge de estado muestra el valor crudo
del enum de la columna `estado`** (ej. "programada", "activa") si no matchea el mapa de
traducción. Vacío: "No tenés guardias asignadas por el momento."

**Guardia Activa** (`GuardiaActiva.jsx`) — Título dinámico "Paciente: {nombre}" (no hay un
título fijo tipo "Guardia Activa", aunque existe la clave de traducción, está huérfana).
Botones: "Marcar check-in" → "Cargar Reporte Diario" → "Ver reportes anteriores". Label
visible "Patologías" (término clínico). Mensaje de aviso menciona directamente el rol
"Coordinador" dentro del texto dirigido al Asistente.

**Reporte Diario** (`ReporteDiario.jsx`) — Flujo de 2 pasos:
1. Texto libre: "¿Cómo estuvo la guardia? Contanos con tus palabras" + botón "Analizar con
   IA".
2. Revisión estructurada: Alimentación → **Signos vitales (4 inputs con placeholder =
   nombre crudo de la clave: `presion`, `temperatura`, `saturacion`, `glucemia`, sin
   traducir ni formatear)** → Estado de ánimo (**select que muestra literalmente
   `muy_bien`, `bien`, `regular`, `mal`, `muy_mal` como texto de las opciones, sin
   traducir**) → Incidentes → Observaciones → Foto → "Confirmar y guardar".

**Mi Perfil** (`MiPerfil.jsx`) — Título "Mi Perfil". Datos + sección "Notificaciones"
(Activar/Desactivar). **El badge de estado del perfil muestra el valor crudo del enum sin
ningún mapeo**, ni siquiera parcial.

**Notas transversales**: claves de traducción "huérfanas" (definidas pero nunca usadas) en
varias pantallas — indicio de trabajo de traducción hecho pero no conectado al código real.
Nombres de archivo y de rutas URL (`/guardias`, `/guardias/:id`) calcan 1:1 el nombre de la
tabla de base de datos.

### 1.3 PWA Familias (la usan los familiares del Paciente)

Rutas en `pwa-familias/src/App.jsx`.

**Login** — Título "Aurevia — Familias".

**Mis Pacientes** — Título "Mis Pacientes". Si hay un solo Paciente, redirige directo a su
pantalla. Vacío: "No hay Pacientes vinculados a tu cuenta todavía."

**Pantalla del Paciente** (`PacienteDetalle.jsx`) — h1: nombre del paciente. Orden:
Alertas activas (si hay) → Guardia en curso/Próxima guardia → Ubicación en vivo (mapa) → 3
botones ("Ver Reportes", "Ver Alertas", "Ver Asistente Asignado"). **La clase CSS de la
tarjeta de guardia usa el valor crudo del enum `estado` de la tabla `guardias`**; lo mismo
con `nivel` de alertas, que además tiene un *fallback* que muestra el valor crudo en
pantalla si falta la traducción.

**Reportes** (lista) — Título "Reportes". Cada fila: fecha + nombre del asistente
(accediendo a la relación anidada `r.guardias?.asistentes?.nombre`, reflejo directo del
esquema de tablas).

**Reporte Detalle** — Título "Reporte". Orden fijo: Alimentación → Medicación → Signos
vitales (Presión, Temperatura, Saturación, Glucemia) → Estado de ánimo → Incidentes →
Observaciones → foto.

**Alertas** — Título "Alertas". Mismo patrón de clase CSS con el enum crudo `nivel` y el
mismo *fallback* visible.

**Asistente Asignado** — h1: nombre del asistente. Certificado mostrado solo como
"vigente"/"vencido" (sin fecha real). **No existe ningún botón "ver certificado QR" ni
acceso al perfil público del Asistente**, pese a que el PRD del proyecto
(`docs/PRD_04_05_App_Servicio.md:142-153`) lo describe como parte de la Etapa 6 — **la
pantalla de Perfil Público del Asistente con QR no está construida en ningún lado del
código actual** (ni Panel ni PWA Familias).

**Mi Perfil** — Título "Mi Perfil". Incluye el campo "Plan" (nombre de plan comercial)
mostrado tal cual, sin formatear.

**Notas transversales**: mismo patrón de nombres de archivo/componente calcando nombres de
tabla (`AsistenteAsignado.jsx`, `PacienteDetalle.jsx`, `ReporteDetalle.jsx`). Uso de jerga
clínico-administrativa en textos ya traducidos ("Certificado de Aptitud vigente", "Guardia
en curso") en vez de lenguaje más cercano a una familia.

### 1.4 Síntesis de la Parte 1

El problema no es solamente estético. En las tres aplicaciones se repite el mismo patrón:
en varios puntos, lo que arma la pantalla es el dato técnico tal cual está guardado en la
base de datos (nombres de columna, valores de enum, JSON crudo, nombres de tabla en textos
de ayuda), sin una capa que lo traduzca a algo que una persona entienda de un vistazo. Esto
ocurre con más frecuencia en el Panel (la app más grande), pero también aparece en las dos
apps más chicas. Además, se confirmó al menos una funcionalidad documentada en el PRD que
no está construida (Perfil Público del Asistente con QR, Etapa 6 de
`docs/BUILD_ORDER.md:16`).

---

## Parte 2 — Referencias externas: el piso (Argentina) y el techo (internacional)

### 2.1 Piso — sitios de cuidado domiciliario en Argentina

Relevados en dos rondas: una previa (2026-07-07, registrada en `docs/DESIGN_SYSTEM.md`) con
EnCasa, Cuidarlos, Medincare, Cuidando en Casa, Ver Salud, Casamed Salud, Situ Care, Home
Care BA, Continuum, Cuidarte Argentina, InDom, +Vida Salud, API Cuidados Domiciliarios,
Amparando Salud; y una segunda ronda (2026-07-21, esta sesión) con 18 sitios adicionales.

**Sitios relevados en la ronda del 2026-07-21:**

| Sitio | Rasgo distintivo |
|---|---|
| Abuelos en su Casa (abuelosensucasa.com) | El más completo/corporativo: equipo directivo con 6 perfiles nombrados, certificaciones gubernamentales visibles (Ministerio de Salud), 4 sucursales. Rechaza CVs por formulario — no tiene canal de reclutamiento real |
| Asistencia Mis Abuelos (asistenciamisabuelos.com) | Correcto pero sin prueba social (sin testimonios, sin certificaciones, sin blog) |
| Mayores Cuidadores (mayorescuidadores.com) | De los más completos en prueba social: directora nombrada con metodología propia, testimonios con nombre/foto/barrio, blog con contenido real |
| Asistencia Exclusiva (asistenciaexclusiva.com.ar) | Testimonio con nombre real, blog activo, navegación diferenciada clientes/postulantes |
| Asistencial Group (asistencialgroup.com.ar) | El más básico: 6 secciones, sin testimonios, sin certificaciones, sin blog |
| Siempre (siemprearg.com) | El más orientado a B2B/corporativo: planes nombrados, centro de diagnóstico de dengue, 12 logos de clientes empresariales, presencia regional (Chile, México). Sin testimonios de familias |
| MásCuidados (mascuidados.com.ar) | El de mayor sofisticación de modelo de negocio: seguros por tipo de internación, franquicias, alianzas con prepagas (OSDE, PAMI), software propio de coordinación, 5 sedes, se presenta como "primera empresa prepaga de cuidado" (2002) |
| Enfermería a Domicilio / EDomCare (enfermeriadomicilio.com.ar) | Testimonios reales tomados de reseñas de Google, evaluación gratuita, WhatsApp como canal principal |
| Nursity (nursity.com.ar) | **Problema técnico**: sitio no renderiza contenido navegable (probable SPA sin servidor) |
| Newmed (newmed.com.ar) | **Sitio caído**: certificado SSL roto, apunta a hosting genérico — pese a declarar 22 años de trayectoria |
| B&K Asistencia — Córdoba (bykasistencia.com.ar) | 3 planes nombrados (Ocasional/Permanente/Cama Adentro), testimonios con nombre y avatar |
| Home Care S.A. — Córdoba (homecarecordoba.com.ar) | El más institucional/técnico: lenguaje dirigido a "profesionales sanitarios y decisores", habla de "costo-eficiencia" — sin testimonios ni certificaciones |
| Cuidando Papis / Max Corporate Group (cuidandopapis.com) | Segmentación explícita en 3 caminos: Empresa / Particular / Trabaje con nosotros |
| Ama la Vida (amalavida.ar) | 25 años, fundadora nombrada con perfil de LinkedIn, testimonios atribuidos |
| Redat (redat.com.ar) | Alianza con Grupo INECO (salud mental), formulario específico para reclutar Acompañantes Terapéuticos, cursos certificados propios |
| Permanencia (permanencia.com.ar) | Mejores métricas de trayectoria (28 años, +100.000 pacientes), proceso de contratación en 3 pasos explícito, especialización por patología |
| Med Clin (medclin.com.ar) | Catálogo amplio de 14 servicios médicos, pero sin segmentación de audiencias ni prueba social — más listado de servicios que sitio de conversión |
| Homecare (homecare.com.ar) | **El más deficiente**: estructura tipo vitrina de e-commerce con carrito vacío por defecto y contenido duplicado |

**Casos fuera del mercado argentino real (contraste):** Dedicares y Cuideo son franquicias
españolas con landing geolocalizada para Argentina, no empresas argentinas — Cuideo en
particular es mucho más sofisticado que cualquier sitio argentino real (sello "Empresa B
Certificada", acreditaciones autonómicas, alianzas con aseguradoras internacionales,
matching cuidador-familia, ~97% de retención declarada).

**Conclusión del piso argentino:**
- El nivel general es bajo-medio y muy homogéneo — plantilla + WhatsApp + testimonios
  sueltos, en la gran mayoría de los casos.
- **Ninguno de los 18 sitios relevados en esta ronda menciona tener una aplicación propia**
  — el sector completo opera sobre WhatsApp/teléfono/formulario, sin ninguna capa de
  producto digital.
- Las certificaciones formales casi nunca están presentadas de forma verificable.
- El blog, cuando existe, casi siempre está vacío de contenido real.
- Hay errores técnicos básicos incluso en empresas con mucha trayectoria declarada
  (certificados SSL rotos, sitios que no renderizan).
- El sitio que más se acerca a un salto de calidad (MásCuidados, por su modelo de negocio;
  Abuelos en su Casa, por certificaciones + equipo nombrado) sigue sin tener nada parecido a
  un producto tecnológico propio.
- **Conclusión estratégica: el lugar de "somos la Prestadora con tecnología propia y
  confianza verificable" está completamente libre en el mercado argentino — nadie lo ocupa
  hoy.**

### 2.2 Techo — mejores referencias internacionales

Relevados: Cuidarlos (Argentina, referencia alta — ver nota abajo), Honor/HonorCare,
Comfort Keepers, Visiting Angels, BrightStar Care, Care.com, Papa, Interim HealthCare,
Griswold, AccentCare. (Home Instead y Right at Home no pudieron relevarse — devolvieron
error 429 y 403 respectivamente, en dos intentos cada uno.)

| Sitio | Qué lo distingue |
|---|---|
| Cuidarlos (cuidarlos.com) | Modelo típico de marketplace; **buen manejo del reclutamiento de Asistentes** desde la propia home, con lenguaje coloquial y navegación diferenciada "NECESITO CUIDADOR"/"SOY CUIDADOR" — ver nota del Desarrollador en esta sesión |
| Honor / HonorCare (honorcare.com) | Combinación de misión + estadísticas + fotografía cálida. No muestra pasos transaccionales, construye confianza vía storytelling editorial |
| Papa (papa.com) | El más sofisticado en storytelling: carrusel de historias reales con nombre y arco emocional; **reporte de transparencia anual** (único en todo el relevamiento); segmentación por rol (Health Plans / Employers / Pals / Members) en vez de la bifurcación binaria estándar |
| Visiting Angels (visitingangels.com) | Mejor balance operativo: proceso de 3 pasos visual, manejo explícito de objeciones de costo/compromiso, formulario que pregunta primero "¿quién necesita el cuidado?" |
| Comfort Keepers (comfortkeepers.com) | Techo en prueba de autoridad externa: documental de PBS (producido por Bradley Cooper), ranking Newsweek, partnership con Alzheimer's Association; autoevaluación de 2 pasos como entrada de baja fricción |
| Interim HealthCare (interimhealthcare.com) | Techo en credibilidad numérica dura (190.000 pacientes/año, 43.000 profesionales) combinada con mensaje "somos locales" pese a la escala nacional |
| BrightStar Care (brightstarcare.com) | 4 badges de certificación (Joint Commission Gold Seal, etc.) + testimonios con nombre y ubicación específica; segmenta por tipo de destinatario (Seniors/Children/Veterans/Businesses) |
| Griswold (griswoldcare.com) | Mejor uso de video-testimonio (4 testimonios en formato video), certificación no saturada, fundación propia con storytelling humano |
| AccentCare (accentcare.com) | Mejor segmentación B2B/B2B2C: tres audiencias reales (Pacientes/Familias, Profesionales de salud, Partners) con logos de 70+ sistemas de salud como prueba social B2B |
| Care.com (care.com) | Segmentación de marketplace más limpia del relevamiento ("Find care"/"Find jobs"/"List your business"), pero **cero prueba social** — caso de advertencia, no solo de modelo |

**Fuentes secundarias de curación** (prensa/agencias especializadas, usadas para
triangular qué reconoce la industria como referente): sagapixel.com y dbswebsite.com,
que además suman ejemplos puntuales de buen diseño: Radfield Home Care (usa "Stories" en
vez de "testimonios"), Audley Villages (tablas de precios transparentes), Alliance
Homecare (badges de prensa en el hero), Amedisys (buscador con placeholder sugerido en vez
de campo vacío).

**Conclusión del techo internacional:**
- Ningún sitio del rubro llega al nivel de pulido visual de un producto de consumo masivo
  (tipo Airbnb) — la industria completa es visualmente genérica (fotos de manos, azules
  corporativos, tarjetas).
- El diferencial real entre "bueno" y "el mejor" no está en el pixel sino en tres cosas:
  (a) storytelling con nombres y arcos reales en vez de testimonios genéricos, (b)
  reducción de fricción antes del primer contacto humano (autoevaluación corta), y (c)
  segmentación de audiencia explícita y de primer nivel en la navegación (nunca escondida
  en un submenú).
- Certificaciones de terceros usadas con moderación (1-2 bien destacadas) pesan más que
  una pared entera de sellos.
- El manejo explícito de objeciones de costo/compromiso en la propia home (no escondido en
  FAQ) es un patrón que separa a los mejores del resto.

### 2.3 Qué significa esto para Aurevia — primeras ideas (a validar en el plan)

1. **Reporte de transparencia anual** (patrón Papa): dado que Aurevia ya tiene el eje
   legal/auditoría como pilar (`CLAUDE.md` §3 y §6), un reporte público de transparencia
   ("cómo verificamos a los Asistentes", "cómo se audita el aislamiento de datos entre
   Prestadoras") sería un diferencial de confianza que ninguna Prestadora argentina ni
   internacional relevada tiene hoy.
2. **El sitio de Aurevia es B2B** (le vende a Prestadoras, no directamente a Familias) —
   por eso la bifurcación de navegación clásica "necesito cuidado / quiero trabajar
   cuidando" no aplica igual: la bifurcación real de Aurevia sería más parecida a "sos una
   Prestadora evaluando la plataforma" vs. "sos Familia/Asistente de una Prestadora que ya
   usa Aurevia" — y dentro de la landing de cada Prestadora (el sitio público que consuma
   datos vía API, ver pendiente #70 de `docs/PENDIENTES.md`), ahí sí aplicaría la
   bifurcación clásica cuidado/trabajo, como en Cuidarlos.
3. **Autoevaluación corta antes del formulario de contacto** (patrón Comfort
   Keepers/Visiting Angels), trasladable al proceso de venta de Aurevia a una Prestadora
   nueva ("¿cuántos Asistentes gestionás hoy? ¿en qué herramienta?").
4. **Nombrar casos reales con nombre, ciudad y cifra concreta**, nunca testimonios
   genéricos — aplicable tanto al sitio de Aurevia (casos de Prestadoras) como al futuro
   sitio de cada Prestadora (casos de Familias/Asistentes).
5. **Balance local/nacional** (patrón Interim HealthCare): comunicar que Aurevia funciona
   igual para una Prestadora de cualquier provincia, con las mismas garantías de
   aislamiento — coherente con la arquitectura multi-tenant real ya construida (`CLAUDE.md`
   §2), transformando una garantía técnica en argumento de marketing genuino.
6. **El reclutamiento de Asistentes necesita resolverse en la propia página**, con la
   misma seriedad que la captación de Familias — hoy es un hueco real en nuestro lado (el
   formulario público de postulación no existe, pendiente #49 de `docs/PENDIENTES.md`) y la
   mayoría de los sitios argentinos tampoco lo resuelve bien (varios directamente rechazan
   CVs por formulario en vez de tener un proceso real) — es una oportunidad de
   diferenciación, no solo una deuda a saldar.

---

## Parte 3 — Cuatro ángulos adicionales (2026-07-21, segunda ronda)

### 3.1 UX de paneles de coordinación de software profesional de home care

A diferencia de la Parte 2 (sitios de marketing), acá se investigó específicamente cómo
resuelven la pantalla de trabajo diario del Coordinador softwares de gestión para agencias
de home care: AlayaCare, AxisCare, CareSmartz360, PointClickCare, WellSky. La mayoría de
estos productos está detrás de login, así que la evidencia viene del propio marketing de
producto y de reviews de terceros (G2, Capterra), no de capturas verificadas directamente.

**Hallazgo principal: el semáforo de color sobre la guardia es un patrón universal, no una
elección de diseño más.** Los tres productos con información concreta coinciden en el mismo
criterio de fondo — el color codifica una sola pregunta operativa ("¿esta guardia está en
riesgo de quedar sin cubrir?"), nunca el estado técnico interno del registro:
- **AxisCare**: layout de calendario "color-coordinado" que diferencia *open / verified
  (approved) / block / in-progress*.
- **CareSmartz360**: cita textual — "The color blocks indicate Open Shifts, Approved
  Shifts, No Shows, and Scheduled Shifts" — con 3 vistas de calendario (día por hora, semana
  por cliente, mes colectivo).
- **PointClickCare** (guía de producto): esquema de semáforo explícito — 🔴 rojo = turno
  programado sin nadie asignado; 🟡 amarillo = cita perdida/cancelada a reprogramar; 🟢
  verde = completado y facturable.

**Otros patrones confirmados:**
- **Alertas agrupadas en el dashboard**, no solo en el calendario: turnos abiertos,
  llegadas tarde/ausencias, y un widget específico de "Compliance" (CareSmartz360) que
  muestra qué cuidador tiene qué documento por vencer en los próximos 30 días — equivalente
  directo al módulo de Documentación de Asistentes de Aurevia.
- **Matching asistido**: el coordinador no filtra una lista de Asistentes a mano — el
  sistema sugiere 3-5 candidatos rankeados según habilidades, disponibilidad y distancia
  (AlayaCare, AxisCare, CareSmartz360).
- **Interacción directa sobre el calendario**: drag-and-drop para reasignar, hover para ver
  detalle sin abrir otra pantalla (AlayaCare product tour) — la app trabaja *sobre* la
  grilla, no como una lista aparte con formularios modales.
- **Terminología humana y consistente**: ningún producto usa nombres técnicos de tabla; el
  vocabulario que se repite es Scheduling/Caregivers/Clients/Care Plans/Visits/Compliance —
  valida que nuestras secciones deban seguir llamándose Guardias/Asistentes/
  Familias/Documentación (glosario ya vigente), nunca el nombre de columna crudo.
- **App móvil dedicada para el Coordinador**, separada de la del cuidador (AxisCare "Admin
  Mobile App", AlayaCare separa "Care Worker Mobile App" del panel de escritorio).
- Nota de confiabilidad de la fuente: no se pudo acceder a capturas reales de dashboard
  (login requerido) ni a varias páginas de producto (bloqueadas con 403) — la evidencia de
  color/layout viene de texto descriptivo del propio marketing o de fichas de terceros, no
  de la imagen en sí.

**Aplicación concreta a Aurevia:**
- **Guardias**: semáforo de 3 estados (sin cubrir=rojo / cubierta pero pendiente de
  confirmar=ámbar / cubierta y confirmada=verde), mapeado a un enum de negocio propio,
  nunca al valor crudo de la columna `estado`. Vista de grilla/calendario como pantalla
  principal (ya existe desde el rediseño 2026-07-18), reforzando drag-and-drop + hover en
  vez de tabla + modal.
- **Dashboard**: widgets separados para "Guardias sin cubrir hoy", "Ausentes sin relevo
  previo" (término del glosario) y "Documentación por vencer en próximos 30 días" — calcado
  del widget de compliance de CareSmartz360.
- **Asistentes**: al asignar una Guardia, ofrecer candidatos rankeados en vez de una tabla
  completa para filtrar a mano.

Fuentes: alayacare.com/scheduling, alayacare.com/platform/overview/product-tour,
axiscare.com/features/scheduling, axiscare.com/features/admin-mobile-app,
caresmartz360.com/features/home-care-scheduling-software,
caresmartz360.com/persona/schedulers, intercom.help/caresmartz (Caregiver Compliance on
the Dashboard), PointClickCare Session Guide Intro to Scheduling (PDF), wellsky.com/
personal-care-software, G2 (reviews AxisCare/CareSmartz360/AlayaCare), Capterra (comparativa
AxisCare vs. AlayaCare).

### 3.2 UX de apps de cuidadores y familias de la competencia

Investigación de las apps móviles reales (no los sitios de marketing) de Honor, CareLinx,
Care.com y Papa. La mayoría de la evidencia es textual (descripciones de marketing +
reviews de tiendas de apps), sin acceso verificado a capturas — se marca explícitamente
dónde la evidencia es sólida y dónde es solo descriptiva.

**Honor (Honor Care Pro / Honor Family App)**: reviews describen el check-in/checkout como
simple y las notas de cuidado como claras. La app de Familia muestra "quién llega, cuándo
llega y cuándo se va" + notas de cuidado + tareas completadas tras cada visita + opción de
calificar. **No se encontró evidencia de mapa en tiempo real** — el patrón es notificación
de eventos puntuales (llegada/salida), no tracking continuo. Reviews negativos mencionan
malestar con el tracking de ubicación obligatorio.

**CareLinx**: confirmado clock-in/out con GPS y cálculo de horas para pago; reviews de baja
calificación mencionan fallas técnicas al clockear y que el sistema no soporta bien
clockear para dos pacientes en el mismo domicilio.

**Papa**: dos apps separadas — "Papa Care" (familia: agenda, historial, dashboard) y "Papa
Pal" (cuidador: ve visitas cercanas y las acepta con un toque). Sin evidencia de mapa en
tiempo real ni de detalle del formulario de reporte.

**Hallazgo más valioso — selectores visuales en vez de texto libre para datos de salud/
ánimo**, con evidencia concreta y con respaldo clínico:
- Apps de seguimiento de ánimo/síntomas (Bearable, Daylio, Emolog, Thyself, Coffeelings)
  usan selección táctil (emoji, caras, escalas de color) en vez de campos de texto, dejando
  el texto libre solo como nota opcional complementaria.
- **Wong-Baker FACES Pain Scale**: estándar médico desde 1983, 6 caras (de sonriente a
  llorando) con puntaje 0-10 debajo de cada una. Existe una variante moderna validada
  específicamente para uso en celular, "Emoji Faces Pain Scale" (publicada en JMIR, 2023).
  Es el patrón con más respaldo (clínico y de producto) encontrado en toda la
  investigación para reemplazar exactamente el tipo de campo que hoy tenemos como texto
  crudo.
- AxisCare/CareSmartz360 (software profesional) describen la captura de vitales/medicación/
  actividades como tareas marcables (completo/incompleto + nota opcional), no como
  formulario de texto abierto.
- **Uber Caregiver** (2024, EE.UU.) es el único ejemplo con mapa en tiempo real bien
  documentado: tracking en vivo + chat de 3 vías (cuidador/familiar/conductor) +
  notificación automática de llegada segura. Es transporte, no visita domiciliaria, pero el
  patrón "mapa + notificación de llegada + chat" es exactamente lo que le falta a la
  mayoría de las apps de home care, que solo notifican eventos puntuales.

**Aplicación concreta a Aurevia:**
- Reemplazar los placeholders crudos `presion`/`temperatura`/`saturacion`/`glucemia`
  (`pwa-asistentes/src/pages/ReporteDiario.jsx`) por etiquetas en español natural y, donde
  el dato lo permita, un indicador visual de color (verde/amarillo/rojo) según rango
  normal/alerta — patrón "Coffeelings" adaptado a signos vitales, para que un Asistente
  entienda de un vistazo si un valor está fuera de rango sin interpretar el número.
- Reemplazar el selector de ánimo con valores crudos (`muy_bien`/`regular`/`mal`) por un
  **selector de caras tipo Wong-Baker/Emoji Faces** (3-5 caras con expresión + etiqueta en
  español debajo), tocando la cara en vez de elegir de un dropdown con el valor de base de
  datos.
- El mapa en tiempo real de la PWA Familias (hoy limitado a lo que ya existe en
  `PacienteDetalle.jsx`) es una oportunidad de diferenciación genuina si se suma
  notificación automática de llegada segura, siguiendo el patrón Uber Caregiver — ningún
  competidor de home care doméstico lo resolvió mejor que avisos puntuales.

Fuentes: apps.apple.com (Honor Care Pro, CareLinx), honorcare.com/home-care/
honor-family-app, papa.com, alayacare.com/family-portal, axiscare.com/features/
caregiver-mobile-app, caresmartz360.com/persona/caregivers, gridfiti.com/
aesthetic-mood-trackers, jmir.org/2023/1/e41189 (Emoji Faces Pain Scale), Wikipedia
(Wong-Baker Faces Pain Rating Scale), uberhealth.com/us/en/caregiver.

### 3.3 Principios de UX para adultos mayores y usuarios en momentos de estrés

Los usuarios reales de Aurevia no son un público neutro: los Asistentes muchas veces tienen
baja alfabetización digital y usan la app mientras están trabajando (a una mano, con
interrupciones); las Familias están, en muchos casos, atravesando angustia por la salud de
un ser querido, y a veces son personas mayores ellas mismas.

**Adultos mayores / baja alfabetización digital** — fuente principal: Nielsen Norman
Group, "Web Usability for Senior Citizens" (87 guías basadas en 123 participantes de 65+
años a lo largo de casi dos décadas):
- Tipografía chica y bajo contraste es la queja número uno.
- Zonas táctiles pequeñas generan errores de tap constantes — **WCAG 2.5.8** fija el mínimo
  en 24×24px, con buena práctica en 44×44px; un estudio citado marca 15% de error de tap
  con targets de 24px vs. 3% con 44px, y 67% de abandono de tarea tras 3+ toques fallidos.
- Preferencia por inputs flexibles sobre controles rígidos (selectores forzados de hora,
  sliders complejos).
- Evitar jerga técnica incluso "obvia" para un equipo de producto (palabras como "página",
  "homepage" ya generan confusión).
- Chunking: máximo ~7 elementos por pantalla (límite de memoria de trabajo a corto plazo) —
  fuente: National Academy of Medicine, "Designing Health Literate Mobile Apps".
- Navegación lineal con "atrás/adelante" explícitos, botón de inicio siempre visible, nunca
  depender de que el usuario recuerde cómo volver.
- Todo ícono debe ir acompañado de texto — nunca ícono solo.
- No asumir familiaridad con convenciones de apps (menú hamburguesa, swipe, pinch-to-zoom).

**Diseño para trabajo de campo con interrupciones** (aplicable a Asistentes trabajando
mientras cuidan): una acción primaria por pantalla, autoguardado de progreso asumiendo que
la tarea se interrumpe, diseño para uso a una mano, timeouts de sesión alineados a la
duración real del turno (no defaults de seguridad pensados para oficinistas).

**Trauma-informed design / vulnerabilidad emocional** — literatura de content design (UX
Content Collective) y Calm Technology (Amber Case, Calm Tech Institute):
- Lenguaje claro y compasivo, nunca clínico o agresivo, especialmente en mensajes de error.
- Mensajes de error no punitivos, que guíen sin culpar, con opción de deshacer.
- Dar control real: opciones opt-in (no opt-out forzado), salidas claras.
- Evitar interrupciones visuales bruscas (colores de alarma innecesarios, popups, sonidos
  abruptos) que activen una respuesta de estrés.
- Calm Technology: requerir la mínima atención posible, usar la periferia (un badge, un
  color de estado) antes que una notificación intrusiva; degradar con gracia ante fallos.

**UX de apps de coordinación de cuidado familiar** (más allá de Honor/Papa/AlayaCare):
- **CaringBridge** resuelve la fatiga de repetir la misma actualización médica a cada
  familiar por separado con un único posteo centralizado — aplicable directo: una Familia
  no debería tener que "buscar" el estado de su Paciente en varias pantallas.
- Un estudio con díadas de cuidadores en demencia mostró que las apps de coordinación se
  valoran mejor con **más personalización, no menos** — contradice el instinto de
  simplificar quitando opciones; el problema es la jerarquía y el momento de aparición, no
  la cantidad.
- Solo el 18% de 44 apps de cuidadores analizadas cubre bien información + comunicación
  familiar + interacción cuidador-paciente a la vez — oportunidad de diferenciación real
  para Aurevia.

**Aplicación concreta:**

*App de Asistentes*: targets táctiles ≥44×44px en toda acción crítica; una sola acción
primaria por pantalla con navegación lineal explícita; todo ícono con texto; autoguardado
de progreso en el Reporte Diario; vocabulario sin jerga técnica ni abreviaturas internas,
validado con Asistentes reales; mensajes de error explícitos y accionables (nunca "Ocurrió
un error" genérico); timeout de sesión alineado a la duración real de una guardia.

*App de Familias*: la pregunta "¿cómo está mi Paciente ahora?" debe resolverse en la
primera pantalla, sin navegación adicional; un lugar centralizado para el estado del
Paciente (patrón CaringBridge); lenguaje calmo y no alarmista incluso en notificaciones de
eventos negativos, con el próximo paso claro ("esto es lo que estamos haciendo ahora");
notificaciones push discretas para lo no urgente, alertas intrusivas solo para lo
verdaderamente urgente; opciones de personalización de notificaciones (opt-in); mismos
principios de accesibilidad para mayores que en la app de Asistentes; nunca requerir que la
Familia repita información clínica ya dada.

Fuentes: nngroup.com/articles/usability-for-senior-citizens, nngroup.com/reports/
senior-citizens-on-the-web, testparty.ai/blog/wcag-2-5-5-target-size-2025-guide,
nam.edu/perspectives/designing-health-literate-mobile-apps, uxcontent.com/
a-guide-to-trauma-informed-content-design, calmtech.institute/calm-tech-principles,
principles.design/examples/principles-of-calm-technology, mobile.wednesday.is/writing/
mobile-apps-frontline-workers-manufacturing-2026, caringvillage.com/blog/caregiver-tech/
caregiver-apps-for-families, researchgate.net/publication/328145991, ncbi.nlm.nih.gov/pmc/
articles/PMC6090169.

### 3.4 Quejas reales de usuarios (más allá del discurso de marketing)

Investigación de reseñas negativas reales (App Store, Google Play, Trustpilot, G2,
Capterra, Indeed/Glassdoor, prensa) para separar lo que dicen los sitios de marketing de lo
que de verdad le molesta a Familias, Asistentes y Coordinadores.

**Familia** (evidencia con fuente, encuesta de +100.000 clientes vía Activated Insights):
- Queja #1 a nivel mundial: **oficina/empresa inalcanzable** cuando algo pasa.
- Queja #2: **falta de aviso ante cancelaciones/ausencias** — deja a la familia sin
  cobertura sin avisar.
- Rotación excesiva de cuidadores (prefieren 1-2 personas fijas, no un desfile de gente
  distinta).
- Mal matching cuidador-paciente ("me mandan cuerpos calientes", cita textual de un
  cliente), sin evaluar capacidades físicas necesarias.
- Expectativas de servicio poco claras, falta de accountability (llegadas tarde, celular en
  mano durante el turno).
- En Argentina específicamente (Infobae, marzo 2026): costo insostenible frente a la
  cobertura de PAMI/IOMA, inestabilidad del cuidador (se va apenas encuentra mejor sueldo),
  y la carga de coordinación logística recayendo informalmente sobre un familiar.
- Hueco de investigación honesto: no se encontraron reseñas negativas específicas y
  navegables de empresas argentinas puntuales (Cuidarlos, MásCuidados) — la búsqueda no
  indexó contenido de ese tipo; no es evidencia de que no existan quejas, es una limitación
  del método (relevamiento manual en redes/Google Maps o entrevistas directas sería el
  siguiente paso si se necesita este dato con más precisión).

**Asistente/Cuidador** (evidencia de reviews de Honor, CareLinx, MyShyft, ShiftCare):
- Turnos que se cancelan después de aceptados; penalización por rechazar turnos fuera de
  alcance.
- Pagos incorrectos recurrentes; comunicación de gestión lenta, solo por texto sin
  devolución de llamadas.
- No ser contactado por días pese a que la web anuncia disponibilidad inmediata.
- Notificaciones de turnos nuevos que dejan de llegar tras una actualización de la app.
- Imposibilidad de personalizar notificaciones (ej. recordatorio pre-turno).
- Evidencia argentina puntual muy escasa (2 reseñas de Indeed sobre una empresa) — no
  alcanza para generalizar, se señala como hueco.

**Coordinador** (evidencia de industria + reviews de software):
- 51% de las agencias rankea el scheduling como desafío operativo #1; cobertura de
  noches/fines de semana es el punto de estrés diario más citado.
- Dueños/gerentes dedican 10-25 horas semanales a scheduling sin soporte dedicado.
- Rotación de coordinadores es cara y contagiosa: por cada coordinador que se va, se van en
  promedio 5 cuidadores; reemplazar un coordinador cuesta ~USD 14.000.
- Software específico (AxisCare, AlayaCare, CareSmartz360): quejas de **UI inconsistente**
  (mezcla de módulos viejos y nuevos), dificultad para contactar soporte, necesidad de
  crear códigos de servicio/facturación manualmente, curva de aprendizaje alta por exceso
  de funciones.

**Evitable con buen diseño de producto** (inferencia razonable a partir de los patrones de
arriba, no una fuente que lo diga explícitamente): falta de aviso de ausencias/cancelaciones
→ notificación automática en tiempo real; coordinador sin visibilidad clara del estado de
guardias → dashboard de estado en vivo (ver 3.1); oficina "inalcanzable" → canal de
comunicación directo dentro de la misma app; notificaciones que no llegan o no son
configurables → push confiables y personalizables; UI inconsistente/curva de aprendizaje
alta → diseño unificado; pagos incorrectos al cuidador → cálculo automático y auditable;
matching pobre → perfil estructurado de necesidades vs. capacidades.

**Inherente al servicio humano, no lo arregla una pantalla:** rotación de cuidadores por
mejor sueldo en otro lado; costo del servicio frente a la cobertura de obras sociales;
soledad del paciente pese a tener cuidador presente; calidad humana del vínculo (empatía,
brecha generacional); entrenamiento insuficiente del cuidador (es un problema de proceso de
selección/capacitación de la Prestadora — aunque el seguimiento de vencimientos
documentales y Certificado de Aptitud sí ayuda a que la Prestadora no asigne gente sin la
capacitación mínima).

Fuentes: activatedinsights.com/articles/top-10-complaints-clients-have-about-home-care-
agencies (encuesta +100.000 clientes), infobae.com (29-mar-2026), trustpilot.com/review/
www.joinhonor.com, indeed.com (reviews Honor, Abuelos en su Casa), carelinx.pissedconsumer.
com, consumeraffairs.com/health/carelinx, care-com.pissedconsumer.com, g2.com (AxisCare,
CareSmartz360, AlayaCare), softwareadvice.com/home-health/axiscare-profile/reviews,
capterra.com/p/233554/CareSmartz360/reviews, carebravo.com/learn/
home-care-scheduling-challenges, aaniie.com/news/solving-scheduler-burnout,
activatedinsights.com/articles/the-5-most-successful-caregiver-retention-solutions,
apps.apple.com (MyShyft).

### 3.5 Síntesis combinada de la Parte 3

Cruzando los cuatro ángulos, aparecen tres prioridades muy concretas y con evidencia
convergente (no solo de una fuente):

1. **Visibilidad de estado en tiempo real, con semáforo de color con significado
   operativo único**, tanto para el Coordinador (guardias sin cubrir) como para la Familia
   (dónde está el Asistente, si la guardia va a cumplirse) — confirmado por 3.1 (patrón de
   la industria) y por 3.4 (queja #2 más citada por Familias es justamente la falta de este
   aviso).
2. **Selectores táctiles con respaldo clínico en vez de campos de texto crudo**, para
   reemplazar exactamente los campos ya identificados como problemáticos en la Parte 1
   (signos vitales, estado de ánimo del Reporte Diario) — confirmado por 3.2 con el patrón
   Wong-Baker/Emoji Faces.
3. **Accesibilidad real para usuarios no expertos y en momentos de estrés** (targets
   grandes, lenguaje calmo, chunking, autoguardado) — no es un "nice to have" de diseño,
   sino una condición para que el producto funcione con los usuarios reales que va a tener
   (Asistentes con baja alfabetización digital, Familias angustiadas, adultos mayores).

## Parte 4 — Cuatro ángulos adicionales (2026-07-21, tercera ronda)

### 4.1 Onboarding de una Prestadora nueva

Investigación de cómo resuelven SaaS B2B (Notion, HubSpot, Shopify) y software específico
de home care (AlayaCare, AxisCare, CareSmartz360) el primer uso de una cuenta nueva —
relevante porque hoy Aurevia no tiene ningún flujo de bienvenida pensado para una
Prestadora recién dada de alta.

**Patrón dominante en SaaS B2B horizontal**: preguntar intención al arrancar (rol, tamaño
de organización, para qué se va a usar) para adaptar qué se muestra primero, y un
**checklist visible de tareas** (no un asistente modal de pantalla completa que bloquea
todo) — permite salir y volver sin perder el lugar, y muestra progreso real. El primer paso
del checklist debe ser el que genera valor real (para Aurevia, probablemente cargar el
primer Paciente o el primer Asistente), no el más fácil de pedir desde el producto —
invitar a otro usuario del equipo llega después, no como paso 1.

**Dato duro sobre longitud del flujo**: un onboarding de 5 pasos retiene ~80% en cada paso
y lleva a ~33% de las cuentas nuevas al primer resultado útil; uno de 13 pasos lleva solo a
~5,5% — una diferencia de 6 veces explicada casi enteramente por la cantidad de pasos.

**Software específico de home care**: acá el patrón es distinto — onboarding asistido por
una persona (Project Manager/especialista de implementación dedicado), no autoguiado,
porque hay migración de datos sensibles. AlayaCare documenta un proceso de 4-8 meses para
organizaciones grandes. CareSmartz360 es el más parecido a un onboarding autoguiado dentro
del rubro: tiene un "Onboarding Checklist" explícito (cargar clientes y cuidadores →
telefonía/verificación de guardias → primer ciclo de facturación y nómina), con
especialista acompañando pero dejando que la Prestadora avance a su propio ritmo.

**Secuencia típica de configuración inicial del rubro**: datos de la organización (zona
horaria, jurisdicción) → carga de Pacientes → carga de Asistentes/documentación → tarifas y
reglas de facturación → invitar usuarios del equipo/roles → primer ciclo de facturación
como hito de cierre.

**Estados vacíos**: la tendencia es evitar el vacío real (Notion llena la primera pantalla
con contenido que es a la vez demo y checklist), pero cuando es inevitable, la regla es
texto específico ("todavía no cargaste ningún Paciente", nunca "sin datos"), ilustración de
marca coherente, y un único CTA — no varias opciones que generen fatiga de decisión. Si
Aurevia usara datos de ejemplo para no mostrar una pantalla vacía, deberían ser
evidentemente ficticios y generados dentro de esa misma Organización nueva, nunca copiados
de Sandbox ni de otra Prestadora — coherente con `CLAUDE.md` §6 y con el aislamiento
multi-tenant.

**Antipatrones a evitar**: tours largos que enseñan la interfaz en vez de dejar lograr algo
útil en los primeros 30-60 segundos; volcar todas las opciones de configuración en un solo
paso; y, el más relevante para Aurevia dado que tiene roles muy distintos (Superadmin,
Admin_plataforma, Admin_prestadora): **asumir un solo flujo de onboarding para todos los
roles** es de los errores más caros documentados en B2B SaaS — cada rol necesita su propia
ruta de activación, nunca la misma pantalla de bienvenida.

Fuentes: saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026,
saasui.design/blog/saas-onboarding-ux-examples, userflow.com/blog/
saas-onboarding-flow-a-complete-guide, walkwithpic.com/blog/hubspot-onboarding-checklist,
crmnewstoday.com/hubspot-onboarding-setup-checklist-team-adoption, help.shopify.com/en/
manual/intro-to-shopify/initial-setup/new-to-shopify-checklists, alayacare.com/en-au/blog/
the-6-steps-of-implementation-with-alayacare, axiscare.com/blog/
implementing-home-care-software, intercom.help/caresmartz/en/articles/4180831-onboarding-kit,
eleken.co/blog-posts/empty-state-ux, pixxen.com/blog/saas-empty-state-design,
pencilandpaper.io/articles/empty-states, marketcurve.substack.com/p/
7-self-serve-onboarding-mistakes, onething.design/post/b2b-saas-ux-design.

### 4.2 Uso sin conexión o con mala señal (PWA de Asistentes)

Los Asistentes trabajan dentro de domicilios que a veces tienen señal débil o nula.
Investigación de cómo lo resuelven apps de trabajo de campo y, específicamente, sistemas de
"verificación electrónica de visitas" (EVV) del propio rubro de home care en EE.UU., que por
regulación deben soportar esto.

**El GPS funciona sin datos móviles**: el chip GPS del celular triangula posición vía
satélites, no vía red de datos — confirmado tanto en general como específicamente para
Safari en iOS. Esto significa que un Asistente puede seguir registrando su ubicación exacta
aunque no tenga señal; se guarda en el celular con el timestamp del propio dispositivo y se
envía al servidor cuando vuelve la conexión. Los sistemas EVV suelen dar una ventana de
tolerancia (ej. 7 días) para que el dato offline llegue antes de considerarse fuera de
cumplimiento, y como respaldo total tienen una línea telefónica para marcar entrada/salida
por voz cuando no hay ni GPS ni señal.

**Limitación técnica importante para Aurevia (PWA, no app nativa)**: la Background Sync API
del navegador —que permite reintentar el envío solo en segundo plano— **no está soportada
en Safari, ni en macOS ni en iOS**, y no se espera que llegue pronto; solo funciona en
navegadores Chromium (Chrome, Edge, Samsung Internet). Como es esperable que buena parte de
los Asistentes usen iPhone, no se puede depender de esa función — hay que guardar todo
localmente en el celular (vía IndexedDB, que sí funciona en todos los navegadores) y
reintentar el envío cada vez que el Asistente abre o vuelve a la app, tratando el envío
automático de fondo como una mejora extra solo para quienes usan Android/Chrome, nunca como
el mecanismo principal.

**Comunicación visual recomendada** (guías oficiales de Google para diseño offline):
mostrar siempre estado + qué puede seguir haciendo el usuario ("tu reporte quedó guardado,
se va a enviar solo cuando vuelva la señal"), nunca solo con color (combinar color + ícono +
texto), evitar la palabra "offline" sin contexto, y diferenciar visualmente "guardado
pendiente de enviar" de "guardado y confirmado por el servidor" sin que suene a error.
Patrón visual sugerido: nube tachada + "sin conexión" mientras no hay señal; flechas
circulares mientras se está enviando; tilde verde cuando el servidor confirma.

**Riesgos documentados a evitar** (casos reales de otros softwares de campo): duplicar un
reporte si se carga desde dos dispositivos/sesiones sin conexión y ambos sincronizan
después; que una acción del todo distinta borre por accidente lo que estaba pendiente de
enviar; y, el peor caso, apps que ni siquiera guardan la acción sin conexión — el Asistente
cree que guardó algo y en realidad no pasó nada. La recomendación es que cada reporte/
check-in tenga un identificador único generado en el propio celular antes de intentar
enviarlo, para poder detectar y evitar duplicados al sincronizar.

Fuentes: alayacare.com/blog/offline-mode-alayacares-care-worker-mobile-app-supports-
rural-areas-and-limited-connectivity, timesheetmobile.com/electronic-visit-verification,
developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API,
caniuse.com/background-sync, magicbell.com/blog/pwa-ios-limitations-safari-support-
complete-guide, web.dev/articles/offline-ux-design-guidelines,
developers.google.com/open-health-stack/design/offline-sync-guideline,
learn.microsoft.com/en-us/troubleshoot/dynamics-365/field-service/mobile-app/
duplicate-inspection-responses, mobile.wednesday.is/writing/
offline-sync-mobile-apps-field-teams-dead-zones-2026.

### 4.3 Señales de confianza y verificación (relacionado al Certificado de Aptitud con QR)

Investigación de cómo comunican visualmente otras plataformas que una persona fue
verificada, para informar el diseño de la futura página pública del Certificado de Aptitud
(Etapa 6, hoy sin construir — ver Parte 1).

**Patrón según el momento de la decisión de confiar**: plataformas donde el riesgo físico es
en el momento del servicio (Uber, Rappi) invierten en verificación continua (biometría en
vivo) pero comunican poco visualmente al usuario final. Plataformas donde la confianza se
decide *antes* del encuentro (Airbnb, Care.com) sí muestran una insignia permanente en el
perfil, porque ahí la persona elige con quién reservar/contratar antes de conocerla — este
segundo caso es el que aplica a Aurevia (la Familia decide confiar en un Asistente antes de
que entre a su casa).

**Airbnb**: insignia roja "Identity verified" junto a la foto, clickeable, que explica qué
se verificó exactamente — y los anfitriones no verificados directamente quedan ocultos si
el huésped filtra por "verificados". **Care.com**: tras aprobar su verificación de
antecedentes, el perfil muestra el estado (completado/verificado) pero **nunca el contenido
del reporte** — este es el patrón más directamente aplicable a Aurevia: mostrar el resultado
binario de la verificación, nunca el detalle sensible.

**Hallazgo relevante — hueco de mercado**: ningún software de gestión de home care
(AxisCare, AlayaCare) muestra hoy una insignia de verificación visible a la Familia en su
portal — ese patrón es fuerte en marketplaces de consumo (Airbnb, Care.com) pero está
prácticamente ausente en el software de gestión del propio rubro de Aurevia. Es una
oportunidad de diferenciación real, no solo una función más.

**Evidencia de investigación seria sobre cuándo un sello de confianza funciona o falla**:
un estudio de Stanford citado encontró que un sello de seguridad **desconocido o no
verificable redujo la confianza en 12%** comparado con no mostrar ningún sello — el usuario
penaliza una insignia que no puede confirmar en ningún lado. Principios prácticos
consolidados: el sello debe ser clickeable/escaneable hacia una fuente real de
verificación (exactamente lo que hace el QR de Aurevia), ubicado cerca de la decisión
relevante (cerca del nombre/foto del Asistente, no en un footer), y nunca con afirmaciones
vagas ("100% seguro") sin decir qué se verificó específicamente.

**Perfiles públicos con QR en otros rubros** (licencias profesionales, certificados de
antecedentes penales, certificados de vacunación en varios países): el patrón consolidado es
que el QR actúa como puntero dinámico a una página de verificación (nunca embebe el dato
sensible en el QR mismo), la página muestra estado + qué se verificó + fecha, se actualiza
en el servidor (si se revoca la verificación, el mismo QR deja de mostrar "verificado"), y
nunca expone datos personales completos — exactamente el diseño ya previsto para la página
pública de Aurevia (`docs/PRD_04_05_App_Servicio.md:142-153`).

**Error a evitar señalado explícitamente por Airbnb en su propia documentación**: ser
explícitos en que la insignia "solo significa que la persona proveyó información que fue
validada", no una garantía de comportamiento — Aurevia debería ser igual de clara en su
página pública sobre el alcance exacto de "Certificado de Aptitud" (qué evaluó la
Prestadora, qué no), para no generar una falsa sensación de seguridad.

Fuentes: uber.com/us/en/newsroom/background-checks, airbnb.com/help/article/1237,
growyourbnb.com/verification-on-airbnb, help.care.com/caregivers/s/article/
What-is-a-CareCheck, axiscare.com/features/client-and-family-portals, alayacare.com/
family-portal, nngroup.com/articles/trustworthy-design, userintuition.ai/reference-guides/
trust-ux-badges-proof-and-the-research-behind-them, envzone.com/license-verification,
verificacovid.scsalud.es.

### 4.4 WhatsApp como canal de comunicación principal

Aurevia ya tiene notificaciones push (con las limitaciones conocidas en iPhone) y un módulo
de envío de WhatsApp para escalada de alertas ya construido. Se investigó si conviene
apoyarse más en WhatsApp como canal central para avisos a Asistentes y Familias, dado que en
Argentina es el canal de comunicación dominante.

**Evidencia concreta de uso como canal principal (no solo botón de contacto)**: organismos
de salud pública argentinos ya gestionan turnos médicos enteramente por WhatsApp —el
sistema de salud de Jujuy emitió más de 227.000 turnos así desde fines de 2024 sin trámite
presencial, y Neuquén usa recordatorios de turno por WhatsApp para reducir el ausentismo,
para todos los canales de solicitud, no solo para quienes ya escribieron por ahí. PedidosYa
integró WhatsApp para la confirmación de pedido como parte del flujo central, no como
soporte alternativo.

**Cifras de apertura**: estimaciones de la industria (no de estudios académicos
independientes, así que se toman como indicio direccional, no como dato duro) sitúan la
apertura de WhatsApp en 95-99%, contra 20-40% de notificaciones push y 20-25% de email. No
se encontró ninguna cifra específica de Argentina ni del rubro de cuidado domiciliario — es
una limitación real de la evidencia, aunque la dirección (WhatsApp por delante) es
consistente con que el usuario ya tiene WhatsApp instalado y con permisos de notificación
activos, mientras que una app específica depende de que ese permiso esté concedido.

**Cómo funciona técnicamente**: la API oficial de WhatsApp Business abre una "ventana de
servicio" de 24 horas cada vez que el usuario escribe primero, durante la cual se puede
mandar cualquier mensaje libre. Fuera de esa ventana (un aviso que Aurevia inicia sin que el
Asistente/Familia haya escrito antes), solo se puede usar una plantilla pre-aprobada por
Meta — las plantillas de la categoría "utility" (confirmaciones, recordatorios, alertas de
cuenta) encajan directo con nuestros casos de uso ("confirmar guardia", "Ausente sin relevo
previo") y desde julio de 2025 Meta dejó de cobrarlas dentro de la ventana de servicio.

**Riesgos a tener en cuenta**: costo por mensaje fuera de la ventana de servicio o de
categorías que sí se cobran; dependencia de las reglas de Meta, que puede suspender un
número sin previo aviso si detecta mal uso sostenido, con pérdida de historial y contactos;
y el riesgo de mezclar el número personal de un trabajador con el uso de la empresa si no se
usa la API oficial de negocio (con un número separado y verificado como cuenta de empresa,
este riesgo se evita).

**Patrón híbrido recomendado** (evidencia de diseño de sistemas en general, no de un caso
homólogo exacto en home care): alertas críticas (equivalente a "Ausente sin relevo previo")
por varios canales a la vez (WhatsApp + push + SMS de respaldo) para maximizar que llegue el
aviso; avisos rutinarios (ej. "reporte diario ya enviado") por push/email primero, con
WhatsApp solo como respaldo si el push falla, para no generar costo en cada aviso de rutina.

**Limitación honesta de esta investigación**: no se encontró ningún competidor directo de
Aurevia (softwares de gestión de cuidadores en Argentina o el resto de Latinoamérica) que
documente públicamente su propia arquitectura de notificaciones — la recomendación de
patrón híbrido es una hipótesis razonable a partir de evidencia de otros rubros, no un hecho
ya demostrado en el sector, y debería confirmarse con datos propios de uso real una vez que
Aurevia tenga Asistentes/Familias usando el sistema.

Fuentes: latinspots.com/noticia/pedidosya-confirma-los-pedidos-por-whatsapp,
neuqueninforma.gob.ar (turnos por WhatsApp Jujuy/Neuquén), smsmode.com/en/
whatsapp-business-api-customer-care-window, developers.facebook.com/documentation/
business-messaging/whatsapp/messages/template-messages, gurusup.com/blog/
whatsapp-api-message-templates, nimblebiz.ai/blog/whatsapp-open-rate-vs-email-vs-sms-
benchmarks, chatsell.net/whatsapp-api-facturacion-latam-argentina-chile-colombia-2026,
blog.mercately.com/nuevas-politicas-de-meta, inewton.ai/blog/
whatsapp-business-api-oficial-vs-no-oficial-2, wasenderapi.com/blog/
how-to-build-a-scalable-whatsapp-notification-system-for-saas-architecture-guide.

### 4.5 Síntesis combinada de la Parte 4

1. **El onboarding de una Prestadora nueva necesita un diseño propio, distinto por rol**
   (Admin_prestadora no es lo mismo que Admin_plataforma operando "dentro de una
   Prestadora") — hoy no existe ninguno, y es la primera experiencia que va a tener cada
   Prestadora nueva con el producto.
2. **La arquitectura offline de la PWA de Asistentes debe asumir que Safari/iOS no
   sincroniza solo en segundo plano** — esto no es un detalle técnico menor, condiciona
   directamente cómo hay que diseñar el flujo de Reporte Diario y check-in/check-out para
   que nunca se pierda información cargada por un Asistente sin señal.
3. **La página pública del Certificado de Aptitud (todavía sin construir) es una
   oportunidad de diferenciación real** dentro del propio rubro de home care, siguiendo el
   patrón "mostrar el resultado, nunca el detalle sensible" de Care.com, con el QR como
   puntero verificable — coherente con lo que ya define el PRD.
4. **WhatsApp merece evaluarse como canal reforzado para avisos críticos**, en particular
   para resolver justo la queja más citada por Familias en cualquier país (falta de aviso
   ante ausencias/cancelaciones, ver 3.4), combinado con push como canal secundario, no como
   reemplazo total.

## Parte 5 — Siete ángulos adicionales (2026-07-21, cuarta ronda)

Ronda con más ángulos hasta ahora: 4 propuestos y aceptados, más 3 agregados directamente
por el Desarrollador sobre casos operativos concretos que hoy no están resueltos en el
código (multi-paciente, internación, fin de servicio).

### 5.1 Accesibilidad para discapacidad real

Investigación de estándares técnicos (no solo "adultos mayores", que ya cubrió la Parte
3.3, sino discapacidad visual, motriz y auditiva propiamente dicha) y del marco legal
argentino aplicable.

**Estándar de referencia**: WCAG 2.1/2.2 nivel AA — contraste mínimo 4.5:1 para texto
normal, navegación completa por teclado (criterios 2.1.1/2.1.2/2.4.7/2.4.11), reflow de
contenido sin scroll horizontal al agrandar texto (1.4.10), alternativa sin arrastre para
toda interacción de tipo drag-and-drop (2.5.7 — directamente relevante para la
`GuardiasGrid.jsx` actual, que depende de drag-and-drop nativo), y que todo control
tenga nombre/rol/valor expuesto correctamente para lectores de pantalla (4.1.2).

**Dato de severidad de mercado**: el informe WebAIM Million 2025, sobre ~1 millón de
páginas de inicio analizadas automáticamente, encontró fallas detectables de WCAG en el
94,8% de los sitios — bajo contraste en 79,1% de los casos y texto alternativo faltante en
53,1%, con solo 6 tipos de error explicando el 96% de todas las fallas. Es evidencia de que
el problema es sistémico en toda la industria web, no un estándar exótico difícil de
alcanzar.

**Marco legal argentino**: existe la Ley 26.653 (accesibilidad web, 2010), reglamentada por
el Decreto 656/2019 y la Disposición ONTI 6/2019. Su aplicabilidad a un software B2B como
Aurevia es ambigua — el texto de la ley habla de "empresas que presten servicios públicos",
y no se encontró jurisprudencia ni interpretación oficial que confirme si un SaaS de
gestión como Aurevia queda alcanzado. También existe la Ley 26.378 (ratifica la Convención
de la ONU sobre discapacidad), que fija un marco general de derechos pero no un estándar
técnico específico con sanciones. **Esto es una pregunta legal abierta, no resuelta por
esta investigación** — si se quiere formalizar, corresponde documentarla en
`docs/legal/argentina.md` (ver `CLAUDE.md` §3), no asumir una respuesta acá.

**Hallazgo competitivo**: ningún competidor de home care relevado en las Partes 2/3
publica un VPAT/ACR (Voluntary Product Accessibility Template / Accessibility Conformance
Report — documento estándar de la industria SaaS para declarar el nivel de conformidad de
accesibilidad ante compradores empresariales). Es un hueco real que Aurevia podría llenar
como diferenciador ante Prestadoras que evalúan varias plataformas.

**Aplicación concreta a Aurevia**: revisar contraste real de la paleta `oklch()` de
`docs/DESIGN_SYSTEM.md` contra el mínimo 4.5:1; sumar una alternativa por teclado/botón a
la reasignación por drag-and-drop de `GuardiasGrid.jsx` (hoy depende exclusivamente del
gesto de arrastre); auditar que los íconos-sin-texto detectados en la Parte 1 tengan al
menos texto alternativo para lectores de pantalla, aunque no se agregue texto visible.

Fuentes: WCAG 2.1/2.2 (W3C), WebAIM Million 2025, Ley 26.653, Decreto 656/2019,
Disposición ONTI 6/2019, Ley 26.378.

### 5.2 Reportes y métricas de negocio para dueños de Prestadoras

**Indicadores estándar de la industria** (confirmados en AxisCare, AlayaCare,
CareSmartz360, WellSky): tasa de cumplimiento de guardias (Visit Completion Rate),
puntualidad (On-Time Performance), utilización de Asistentes (horas facturables sobre
horas disponibles, objetivo sano 80-90%), rotación de personal (el sector suele superar
60% anual), tasa de cobertura de vacantes (Fill Rate), ratio de horas extra, ingreso por
guardia, margen bruto, días de cobro pendiente (DSO), costo de adquisición de Familia,
valor de vida del cliente (LTV), NPS, y cumplimiento de verificación electrónica de
guardias (EVV).

**Patrón de separación de roles confirmado en los 4 productos relevados**: el panel del
dueño/directivo es **siempre una pantalla separada** del panel operativo del Coordinador —
nunca el mismo panel "con más detalle" para quien tiene más permisos. Esto encaja
directamente con los roles que Aurevia ya diferencia (Superadmin, Admin_plataforma,
Admin_prestadora, Coordinador) y con el hallazgo ya registrado en memoria de que el panel
de Admin_plataforma no debe mostrar el día a día operativo.

**Principios de diseño de dashboards** (NN/G, Tufte): la longitud y la posición 2D son los
atributos visuales que el ojo procesa mejor — evitar gráficos de torta/área/ángulo para
comparar magnitudes; densidad óptima de 5-9 visualizaciones por pantalla, nunca una pared
de números; sparklines/flechas de tendencia junto al número del indicador, no el número
solo; toda alerta de anomalía necesita contexto (línea base, hace cuánto que pasa, próximo
paso sugerido), nunca solo "esta métrica bajó X%" sin explicar qué hacer con ese dato.

**Aplicación concreta a Aurevia**: el panel de Admin_plataforma necesita, como mínimo, tres
bloques por Prestadora — estado de pago, uso real versus plan contratado, y una señal de
riesgo/salud de cuenta — sin mostrar el día a día operativo (ausencias, incidentes), que ya
está fuera de su alcance según lo ya documentado en memoria. El Dashboard actual de
Admin_prestadora (`Dashboard.jsx`, hoy solo tarjetas de KPI sin mayor estructura) es
candidato a incorporar tendencia (no solo el número del momento) y contexto accionable en
vez de solo el valor crudo.

Fuentes: axiscare.com, alayacare.com, caresmartz360.com, wellsky.com, nngroup.com
(preattentive attention), accoil.com/blog/customer-health-score,
paddle.com/resources/customer-health-score, chargebee.com/customer-retention.

### 5.3 Coordinación entre varios familiares del mismo Paciente

El patrón dominante en el software de cuidado domiciliario comparable a Aurevia (no en
apps de comunidad tipo CaringBridge) es un **círculo de cuidado con roles diferenciados
por familiar**, nunca una cuenta compartida: cada familiar tiene su propio login, y la
Prestadora (no un familiar) es quien controla quién entra y con qué nivel de acceso —
ejemplo textual encontrado: "un familiar podría ver visitas y medicación; un médico solo
observaciones clínicas".

**Centralización, no duplicación**: todos los casos relevados (CaringBridge, CareLineLive,
AlayaCare) convergen en un solo repositorio central de estado/reportes en vez de notificar
en paralelo a cada familiar por separado — el objetivo explícito es que la Prestadora deje
de recibir la misma pregunta de rutina de cada familiar por separado.

**Evidencia académica sobre fricción entre hermanos cuidadores** (Kokorelias et al. 2022,
Family Caregiver Alliance): el conflicto no nace de que falte información compartida, sino
de percepciones distintas sobre cuánto está haciendo cada uno — quien no cuida activamente
tiende a subestimar la carga del que sí lo hace. Un chat/notificación mal diseñado (todos
preguntando lo mismo, o un familiar "corrigiendo" públicamente a otro) puede reproducir
digitalmente la misma pelea que ya existe fuera de la app.

**Vacío de mercado confirmado**: ninguna fuente documenta reglas automáticas de acceso por
parentesco (ej. "un nieto ve menos que un hijo") — hoy se resuelve manualmente vía
configuración de rol, no por inferencia de vínculo familiar.

**Aplicación concreta a Aurevia**: diseñar el acceso de PWA Familias como un círculo de
cuidado por Paciente, con roles asignables por la Prestadora (no autoservicio entre
familiares), y un único set de reportes/alertas visible según el rol asignado — nunca una
cuenta "familia" genérica compartida por contraseña.

Fuentes: caringbridge.org, lotsahelpinghands.com, carelinelive.com/our-solution/
care-circle-portal, alayacare.com (Family Portal FAQ), connected-caregiver.helpscoutdocs.com,
circlecare.app, Kokorelias et al. 2022 (PMC8996302), caregiver.org/resource/
siblings-and-caregiving, PMC10735373.

### 5.4 UX de planes y precios (CeltaTech ↔ Prestadora)

**Presentación de tiers**: SaaS de referencia (HubSpot, Salesforce) muestran funciones
bloqueadas igual en el menú, con candado y tooltip que explica qué plan las desbloquea —
nunca ocultan la función por completo. El salto de precio entre el plan de entrada y el
siguiente es señalado como el punto de fricción más criticado cuando no hay escalón
intermedio.

**Cambio de plan dentro del producto**: el patrón de mejor práctica es un preview antes de
confirmar — precio nuevo, prorrateo que va a aparecer en la próxima factura, y qué
funciones/límites cambian exactamente — nunca ejecutar el cambio y que la sorpresa llegue
recién en la factura siguiente.

**Panel de facturación visto por el cliente** (referencia Stripe Customer Portal):
gestión de suscripción (cambiar plan, ajustar cantidad, prorrateo), flujo de cancelación
con motivo y oferta de retención, datos fiscales editables, métodos de pago,
historial de facturas descargable.

**Panel de admin interno del lado del vendedor** — la parte más directamente relevante
para el hueco ya identificado en memoria del panel de Admin_plataforma: herramientas de
customer success (ChurnZero, Chargebee, HubSpot Service Hub) usan un **score de salud de
cuenta** (0-100, combina uso, engagement, soporte y señales de renovación) y un dashboard
de "cancelaciones en riesgo" con estado de pago, uso real versus plan contratado, y
alertas de vencimiento próximo — exactamente los tres bloques ya identificados en 5.2 para
Admin_plataforma.

**Errores de UX que rompen confianza** (dark patterns documentados): cancelación difícil
de encontrar o que exige llamada telefónica, cargos sorpresa por exceder límites de
asientos/uso sin aviso previo, cambios de plan sin preview, letra chica de compromiso
anual que no aparece en la tabla comparativa. El principio transversal: la confianza se
rompe cuando el costo real aparece *después* de la decisión del usuario, nunca antes.

**Aplicación concreta a Aurevia**: el panel de Admin_plataforma (`AdminPlataforma.jsx`,
tab "Planes y funciones") debería incorporar preview de cambio de plan antes de aplicarlo
sobre una Prestadora, y el bloque de score/riesgo de cuenta ya recomendado en 5.2 — nunca
aplicar un cambio de plan sin mostrar antes qué funciones se pierden/ganan.

Fuentes: elefanterevops.com, levelshift.com, notion.com/help, docs.stripe.com/
customer-management/configure-portal, chargebee.com/lp/churn-management,
accoil.com/blog/customer-health-score, docsie.io/blog/glossary/feature-gating,
empirestats.net, eleken.co/blog-posts/dark-patterns-examples.

### 5.5 Manejo de varios Pacientes en la misma Familia

Evidencia pública más floja acá — ningún competidor documenta su modelo de datos interno
para "hogar con varios Pacientes", así que buena parte de esta sección es inferencia
razonada a partir de patrones adyacentes (evidencia marcada explícitamente donde es débil).

**Facturación cuando dos Pacientes reciben cuidado en el mismo horario**: el patrón
dominante (AlayaCare "Multi Clock-In" + lógica regulatoria de EVV/Medicaid en EE.UU.) es
**dos registros de visita separados que ocurren en simultáneo** — uno por Paciente, cada
uno documentado y facturado independientemente — no una guardia única combinada. Práctica
real de agencias (foro AgingCare, no vendor): el Asistente cobra un adicional moderado por
hora, no una tarifa duplicada a la Familia.

**Reportes**: la evidencia apunta a reportes **separados por Paciente**, aunque sea la
misma visita/mismo Asistente — por el principio de que cada Paciente tiene su propio
expediente y el marco regulatorio exige verificación por servicio individual.

**Complejidad práctica real**: certificación/habilidad del Asistente debe cubrir la
necesidad más exigente entre los dos Pacientes (no solo una de las dos), mayor desgaste
físico reportado por cuidadoras reales atendiendo a dos personas con necesidades
distintas, y riesgo de precarización si no hay ajuste proporcional de pago — conecta
directo con CLAUDE.md §3 (cálculos legales/económicos parametrizados).

**Navegación en el portal de Familia entre Pacientes**: no hay evidencia directa de qué
patrón de UI usan los competidores (pestañas vs. selector). Por analogía con software de
salud familiar (tipo selector de dependiente en portales de salud), el patrón esperable es
un **selector de contexto** que cambia el Paciente activo y filtra el resto de la pantalla
por él — no confirmado como estándar del rubro, es inferencia razonada.

**Aplicación concreta a Aurevia**: en `PacienteDetalle.jsx` (PWA Familias), agregar un
selector de Paciente activo cuando la Familia tiene más de uno vinculado (hoy la pantalla
"Mis Pacientes" ya redirige directo si hay uno solo — falta el caso de selección entre
varios); modelar honorarios de guardia compartida como adicional por Paciente extra, nunca
tarifa duplicada, parametrizable por Prestadora.

Fuentes: axiscare.com/features/scheduling, alayacare.zendesk.com (Multi Clock-In),
ankota.com/blog/evv-software/same-day-same-client-claims-in-the-evv-era,
agingcare.com/questions/charging-double-to-take-care-of-two-people-447589.htm,
clinician.com/articles/42309-12-c-8217-s-of-home-health-care-clinical-documentation.

### 5.6 Internación de un Paciente y continuidad de cobertura

**El "hospital sitter" (acompañamiento hospitalario) es un concepto reconocido en la
industria de EE.UU.**, ofrecido como línea de servicio propia por varias agencias de home
care, distinta del servicio domiciliario normal.

**Cómo lo modelan los softwares del rubro**: AxisCare tiene una función dedicada
("Hospitalization Tracking") que trata la internación como un **estado/evento propio del
Paciente** (fecha de admisión/alta, motivo), separado del estado normal de la guardia
domiciliaria — con vista de todos los clientes actualmente internados y alertas si falta
un dato obligatorio. AlayaCare va más allá integrando feeds hospitalarios reales (ADT) para
**pausar automáticamente** el servicio domiciliario al detectar el ingreso y reactivarlo al
alta. Patrón consistente entre ambos: la internación es una entidad propia vinculada al
Paciente, no un simple cambio de ubicación de la guardia.

**Argentina**: hay una distinción de rol de mercado entre cuidador domiciliario y
acompañante terapéutico (este último requiere prescripción psiquiátrica para cobertura de
obra social). Dato operativo concreto: en sanatorios privados suele permitirse **un solo
acompañante por Paciente internado**, salvo autorización médica para sumar otro — lo que en
la práctica puede limitar si el mismo Asistente puede seguir dentro de la institución o si
compite por ese lugar único con un familiar. No se encontró documentación específica de
cómo una Prestadora argentina factura este escenario en particular — es previsiblemente una
decisión caso a caso, no un producto estandarizado del sector.

**Cobertura del Paciente que queda en la casa**: no hay patrón formalizado documentado para
el escenario exacto planteado, pero es funcionalmente equivalente a una ausencia
planificada que necesita cobertura inmediata — con la ventaja de que acá es previsible (se
sabe en el momento en que se registra la internación), así que el sistema podría disparar
automáticamente un flujo de reasignación/broadcast para el Paciente que queda en la casa en
cuanto se marca la salida del Asistente hacia el hospital, en vez de esperar a que alguien
note la guardia descubierta.

**Zona gris de responsabilidad civil**: no se encontró fuente directa sobre seguro/ART del
Asistente al pasar de domicilio a institución (caso exacto de Aurevia) — es un vacío real
de evidencia. Por analogía razonable, el empleador legal sigue siendo la Prestadora, pero
el cambio de entorno introduce reglas internas del sanatorio que la póliza podría no
contemplar — candidato a advertencia legal configurable (no bloqueante) en
`docs/legal/argentina.md`, coherente con el mecanismo ya definido en `CLAUDE.md` §3.

**Aplicación concreta a Aurevia**: modelar "Hospitalización" como entidad propia vinculada
al Paciente (fecha de inicio/fin, institución, motivo) que al activarse pausa las guardias
domiciliarias programadas de ese Paciente; permitir abrir opcionalmente un tipo de Guardia
"Acompañamiento hospitalario" cuando corresponda; disparar automáticamente el flujo de
cobertura de contingencia para cualquier otro Paciente que comparta domicilio con el
internado, en el mismo momento en que se registra la internación.

Fuentes: a-1homecare.com, abchhp.com, grannynannies.com, barrprivatecare.com,
axiscare.com/features/hospitalizations, alayacare.com (Health PEI), caresmartz360.com
(release notes marzo 2026), jujuydice.com.ar, ioma.gba.gob.ar, hospitalprivado.com.ar
(normas de internado), careathomeguide.com/blog/emergency-caregiver-backup-plan,
teambridge.com/blog/same-day-caregiver-reassignments, ankinlaw.com, mcdonoughinsuranceservices.com.

### 5.7 Causales y manejo de fin de servicio con una Familia

**Categorías de causales consistentes entre agencias** (derivan en buena parte de
requisitos de Medicare/CMS en EE.UU., pero son generalizables): mejora del Paciente o
cumplimiento de objetivos del plan de cuidado, ya no necesita cuidado calificado, familia
ya entrenada para asumir las tareas, condiciones inseguras del hogar, mudanza fuera del
área de servicio, internación (hospital, geriátrico u hospicio — conecta con 5.6),
incumplimiento del plan de cuidado por el Paciente/familia, cliente abusivo, impago
crónico, desajuste de servicio, y fallecimiento del Paciente (categoría propia, tratada con
sensibilidad particular — ver más abajo).

**Separación estado/motivo confirmada en software del rubro**: AlayaCare separa el estado
del cliente (`Active`, `On Hold`, `Discharged`, etc.) de un campo propio de "Status
Reason" configurable — exactamente el patrón que le falta hoy a `PrestacionesPaciente.jsx`
(que ya tiene un bloque "Cierre de servicio" pero sin catálogo de causales, según la Parte
1 de este documento).

**Retención de historial**: la normativa de EE.UU. (Medicare CoPs) exige conservar el
historial clínico **al menos 5 años después del alta** — el cierre de un caso no es un
borrado, es un archivado con retención mínima. Si la agencia cierra, la obligación de
retención se transfiere a un sucesor/custodio designado, nunca se extingue sola.

**Comunicación empática al cerrar un caso** (evidencia académica, PMC — estudio sobre
familias cuidadoras de pacientes de ACV): entre un tercio y la mitad de los familiares
sienten que el cierre del servicio fue abrupto y mal comunicado, con aumento brusco de
carga informal apenas se corta el servicio formal. Buenas prácticas documentadas: aviso
previo por escrito, involucrar a un trabajador social/case manager en el cierre, y no
tratar solo las necesidades del Paciente sino también las de la familia en la transición.

**Fallecimiento del Paciente específicamente** (guía práctica de agencias reales, Slusher
Consulting): distingue muerte esperada (hospicio coordina el proceso administrativo) de
muerte inesperada (protocolo de emergencia, no realizar acciones post-mortem hasta
indicación de la autoridad); recomienda check-ins regulares durante el declive para evitar
sorpresas, y —relevante para los Asistentes involucrados— acceso a apoyo psicológico,
tiempo libre para procesar, y check-ins de seguimiento del equipo.

**Vacío de industria confirmado, no solo de esta búsqueda**: no existe un estándar
documentado de aviso previo formal al Asistente cuando el caso de su Paciente se cierra por
razones ajenas a su desempeño (a diferencia del cierre de vínculo Prestadora-Asistente, que
sí tiene proceso propio en Aurevia vía "Vínculo/Cese"). Es una oportunidad real de que
Aurevia se diferencie con una práctica propia bien documentada.

**Aplicación concreta a Aurevia**: sumar un catálogo configurable de causales de "Cese de
servicio" a `PrestacionesPaciente.jsx` (hoy solo tiene el bloque de cierre sin motivo
estructurado), separando estado de motivo igual que AlayaCare; tratar el archivado como
retención con plazo configurable por jurisdicción (nunca borrado), reutilizando el mismo
principio ya aplicado a `informes_obra_social` (snapshot inmutable, nunca editado); y
definir un flujo explícito de aviso al/los Asistente(s) involucrados cuando el cierre no
es por su desempeño, como práctica propia diferenciadora.

Fuentes: mgahomecare.com (política de discharge/transfer), nationalhha.com/
discharge-criteria, activatedinsights.com/articles/5-reasons-to-let-go-of-a-home-care-client,
alayacare.zendesk.com (Client Status), cms.gov (retención de registros médicos),
thehomehealthconsultant.com, pmc.ncbi.nlm.nih.gov/articles/PMC2690166 ("This Case Is
Closed"), slusherconsulting.com/post/when-a-client-dies-in-home-care,
ahrq.gov/cahps/surveys-guidance/home.

### 5.8 Síntesis combinada de la Parte 5

1. **El estado de un Paciente necesita más granularidad que "activo/inactivo"** — tanto la
   internación (5.6) como el fin de servicio (5.7) confirman el mismo patrón de diseño en
   el software del rubro: un campo de **estado propio con motivo estructurado separado**,
   nunca un booleano simple ni un cierre sin causal — aplicable tanto a
   `PrestacionesPaciente.jsx` (fin de servicio) como a una futura entidad de Hospitalización.
2. **La cobertura de contingencia debería dispararse automáticamente al registrar un evento
   previsible** (internación de un Paciente cuando hay otro en la misma casa), no depender
   de que un Coordinador lo note manualmente — mismo principio ya aplicado al diseño de
   alertas tempranas de ausencia (`docs/PRD_04_05_App_Servicio.md:82-112`).
3. **El panel de Admin_plataforma tiene un hueco confirmado desde tres ángulos distintos**
   (5.2 reportes de negocio, 5.4 planes/precios, y el hallazgo ya registrado en memoria):
   necesita estado de pago, uso versus plan contratado y una señal de riesgo de cuenta por
   Prestadora — ningún ángulo de esta ronda contradice esa conclusión, todos la refuerzan.
4. **La comunicación en momentos sensibles (cierre de caso, fallecimiento, internación) es
   un hueco de industria, no solo de Aurevia** — hay más evidencia académica de que las
   familias sienten estos momentos mal comunicados que de soluciones de producto ya
   resueltas por la competencia, lo que abre una oportunidad de diferenciación genuina en
   vez de solo "alcanzar" un estándar ya resuelto por otros.
5. **La accesibilidad real (5.1) y el círculo de cuidado entre familiares (5.3) comparten
   un mismo principio de fondo**: permisos/experiencia diferenciados por persona, nunca un
   único diseño "para todos" — coherente con el principio de mínimo privilegio que
   `CLAUDE.md` §5 ya aplica a roles del sistema, extendido acá a roles dentro de una misma
   Familia.

## Qué falta y próximos pasos

Este documento es el **relevamiento**, primer paso de la secuencia obligatoria para
cambios grandes de arquitectura/producto (`CLAUDE.md` §11: inventario → plan → aprobación
→ código). Sigue pendiente:

1. Seguir enriqueciendo este documento con otros ángulos de investigación que se decidan
   (ej. referencias de otros países de LatAm, benchmarks de conversión específicos,
   investigación de precios/planes si aplica al sitio).
2. Una vez cerrada la investigación, armar el **plan concreto de rediseño** (qué pantallas,
   qué prioridad, qué se resuelve con un diccionario de traducción de valores/estados, qué
   se resuelve con un cambio de contenido/orden, qué queda para el futuro constructor de
   páginas tipo CMS — pendiente #70).
3. Presentar ese plan al Desarrollador para aprobación explícita antes de escribir código.
