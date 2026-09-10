# Workspace

> Leer `CLAUDE.md` antes de tocar cualquier código. Protocolo de sesión completo ahí.

## Estructura del repo

```
Workspace/
├── CLAUDE.md          ← reglas no negociables, leer primero
├── docs/              ← PRDs, contexto técnico, modelo de datos, progreso
├── sitio-web/         ← Etapa 1: frontend público (React + Vite)
└── backend/           ← Etapa 1: backend de formularios (Node + Express)
```

Cada etapa nueva (Panel Admin, PWA Asistentes, PWA Familias) se agrega como su propia
carpeta hermana cuando llegue su turno en `docs/PLAN_HASTA_PRODUCCION.md` — no se anticipan carpetas
vacías de etapas futuras.

## Cómo levantar el entorno de desarrollo (Etapa 1)

```
cd sitio-web && npm install && npm run dev
cd backend && npm install && npm run dev
```

Copiar `.env.example` a `.env` en cada carpeta y completar los valores reales antes de
levantar el backend (nunca subir `.env` — ver `.gitignore` y regla 9 de `CLAUDE.md`).
