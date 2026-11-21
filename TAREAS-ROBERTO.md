# Tareas de Roberto · Equipo B

> **Hecho:** las dos tareas están en `develop` y `main` (frontend #22, Vitest en el CI; #25, limpieza de Asignaciones y Máquinas). Recuerda: los PR van a `develop`, nunca directo a `main`.
>
> **Necesitamos dejar esto listo ya. Lo hacemos ahora, empezando por la tarea 1.** No hay fecha de entrega: es urgente para el medio parcial.
> **No dependes de nadie y nadie depende de ti:** las pruebas del frontend son nuevas y las pantallas que limpias no las tiene nadie más.
> Una tarea está **terminada** solo cuando tiene las 4 cosas:
> 1. **Tus commits** en tu rama (uno por mejora, a tu nombre).
> 2. Un **PR a `develop`** del repo **frontend**, con «Cómo probarlo» completo.
> 3. El **CI en verde**.
> 4. La **salida de las pruebas** (o capturas) en el PR.

| # | Tarea | Puntos | Rama (frontend) |
|---|---|---|---|
| 1 | **Pruebas automáticas del frontend con Vitest, en el CI** | 3 | `test/frontend-vitest` |
| 2 | Limpieza de Asignaciones y Máquinas: lint y textos | 1 | `fix/limpieza-asignaciones` |

Lo que antes estaba en tu lista (lectura manual, reprocesar y el fallo de áreas) ya lo está haciendo Marlo. No lo toques.

---

## 1. Pruebas automáticas del frontend con Vitest

Hoy el frontend **no tiene ni una prueba automática**: el CI solo compila. Vas a montar las pruebas y cubrir la lógica que más importa.

1. **Instala Vitest** (`npm i -D vitest jsdom`) y agrega `"test": "vitest run"` en `package.json`. Configúralo en `vite.config.ts` (`test: { environment: 'jsdom' }`) para que entienda los alias (`@utils`, `@services`, …).
2. **Pruebas** en `src/**/*.test.ts`:
   - **`src/utils/permisos.ts`:** la matriz completa. Admin edita catálogos y gestiona usuarios; operador aprueba lotes pero no edita catálogos; auditor no hace ninguna de las dos. Un caso por rol y por permiso.
   - **`src/utils/jwtUtils.ts`:** `isTokenExpired` con un token vencido, uno vigente y uno mal formado. Arma los tokens a mano en base64; no hace falta firmarlos.
   - **`src/utils/formatUtils.ts`:** cada función con 2 o 3 casos, incluidos `null` y vacío.
   - **`src/services/api.ts` (`apiFetch`)**, simulando `fetch` con `vi.fn()` y `localStorage`:
     - agrega `Authorization: Bearer <token>` y `Content-Type` cuando hay cuerpo;
     - si la respuesta trae `X-Nuevo-Token`, lo guarda;
     - si responde **401**, borra la sesión y lanza el error de sesión vencida. En jsdom, simula `window.location.replace` con `vi.fn()`.
3. **Agrega el paso al CI** del frontend (`.github/workflows/ci.yml`, job `build`): `- name: Pruebas` con `run: npm test`, después del lint.

**Hecho cuando:** `npm test` pasa en tu PC, el CI del PR muestra el paso «Pruebas» en verde y hay al menos 20 pruebas.

## 2. Limpieza de Asignaciones y Máquinas

Archivos: `src/app/maquina_asignacion/` y `src/app/Maquinas/`.
- **ESLint:** `npx eslint src/app/maquina_asignacion src/app/Maquinas` hoy da errores (`any` en `AsignacionMaquinaDetailsFields.tsx`, `AsignacionMaquina.page.tsx` y `AsignacionMaquinaForm.tsx`, y una variable sin usar). Déjalo en **0 errores** sin cambiar el comportamiento.
- **Textos:** pasa los textos con «Mayúscula En Cada Palabra» a mayúscula solo al inicio. Por ejemplo, «Seleccionar Cliente» → «Seleccionar cliente», «Editar Instalación» → «Editar instalación», «Contador Acumulativo» → «Contador acumulativo», «Costo Renta Mensual» → «Costo de renta mensual», «Nueva Instalación» → «Nueva instalación». Las siglas (IP, B/N) se mantienen.
- **No toques** `src/services/maquina_asignacion/` ni `src/types/maquina_asignacion/`: los borra Christian.

**Cómo probarlo:** como admin, crea una asignación y retírala; los textos se ven en minúscula y no hay errores en la consola (F12).

---

**Para levantar el sistema con datos:** [`docs/probar.md`](docs/probar.md) del backend (`npm run configurar`, `docker compose up -d --build`, `preparar-datos.js` y `demo.js`). Para `npm run dev` con la API de Docker: `VITE_API_BASE_URL=http://localhost:8080` en el `.env` del frontend. Usuarios: `admin@`, `operador@` y `auditor@printflow.local` / `Printflow2026*`.
