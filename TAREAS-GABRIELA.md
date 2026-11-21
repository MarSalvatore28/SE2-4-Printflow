# Tareas de Gabriela · Equipo B

> **Necesitamos dejar esto listo ya. Lo hacemos ahora, empezando por la tarea 1.** No hay fecha de entrega: es urgente para el medio parcial.
> **No dependes de nadie y nadie depende de ti:** solo tocas los componentes compartidos y el diseño general de la web, que hoy no tiene nadie más.
> Una tarea está **terminada** solo cuando tiene las 4 cosas:
> 1. **Tus commits** en tu rama (uno por mejora, a tu nombre).
> 2. Un **PR a `develop`** del repo **frontend**, con «Cómo probarlo» completo.
> 3. El **CI en verde** (`build`, `docker` y **SonarCloud**).
> 4. **Capturas** en el PR del antes y el después.

| # | Tarea | Puntos | Rama (frontend) |
|---|---|---|---|
| 1 | **SonarCloud en verde: accesibilidad de los componentes compartidos** | 2 | `fix/accesibilidad-shared` |
| 2 | **La web usable en el celular** | 2 | `feature/web-responsive` |

Lo que antes estaba en tu lista (informes con facturación, PDF y limpieza) ya lo está haciendo Marlo. No lo toques.

---

## 1. SonarCloud en verde: accesibilidad

El análisis de SonarCloud de cada PR del frontend sale **en rojo** por problemas de accesibilidad en `src/components/Shared/`. Esos componentes los usan todas las pantallas. Arreglarlos mejora toda la aplicación de una vez.

Problemas que marca SonarCloud:

| Archivo | Problema | Qué hacer |
|---|---|---|
| `ModalConfirmacion.tsx` y `ModalAdvertencia.tsx` | El fondo oscuro y el contenedor son `div` con `onClick` y sin teclado | Fondo con `role="presentation"`; el diálogo con `role="dialog"`, `aria-modal="true"` y `aria-labelledby` (el título). Que **Escape** cierre el modal y que el foco quede dentro mientras está abierto |
| `ModalConfirmacion.tsx` | `autoFocus` en el campo de texto | Quítalo y pon el foco con `useEffect` y una `ref` al abrir |
| `BuscadorInteligente.tsx` (línea ~331) | Los resultados son `li` con `onClick` y sin teclado | Lista con `role="listbox"` y opciones con `role="option"` y `aria-selected`. Las flechas ya existen: comprueba que **Enter** elige y **Escape** cierra |
| `src/app/Auth/pages/LoginPage.tsx` | Un `svg` sin nombre accesible | `aria-hidden="true"` si es decorativo |

**Reglas:**
- **No cambies las props** de los componentes de `Shared/`: los usan todas las pantallas.
- Comprueba con el teclado (Tab, Enter, Escape y flechas) en Clientes (buscar, eliminar), Máquinas (desactivar) y el login.

**Hecho cuando:** el check **SonarCloud Code Analysis** de tu PR está en verde y todo se puede usar solo con el teclado.

## 2. La web usable en el celular

Hoy, en una pantalla angosta, el menú lateral ocupa media pantalla y las tablas se salen.
- **Menú lateral** (`src/components/layout/Layout.tsx` y `Sidebar.tsx`): por debajo de 768 px, oculto, con un botón ☰ arriba que lo abre encima del contenido y se cierra al elegir una opción o tocar fuera. En escritorio, igual que hoy.
  - En `Sidebar.tsx` **no toques las líneas que terminan en `// [X-FN]`** (son de los equipos): trabaja alrededor.
- **Tablas** (`DataTable.tsx`): que se desplacen a lo ancho dentro de su caja, en vez de romper la página. Sin cambiar props.
- **Formularios:** que en celular los campos queden en una columna. Revisa Clientes, Máquinas y el login.

**Cómo probarlo:** en el navegador, con F12 y el modo dispositivo (iPhone 12, 390 px de ancho), recorre Clientes, Área, Máquinas, Asignaciones, Informes y Notificaciones con el usuario admin. Deja capturas de antes y después en el PR.

---

**Para levantar el sistema con datos:** [`docs/probar.md`](docs/probar.md) del backend (`npm run configurar`, `docker compose up -d --build`, `preparar-datos.js` y `demo.js`). Para `npm run dev` con la API de Docker: `VITE_API_BASE_URL=http://localhost:8080` en el `.env` del frontend. Usuarios: `admin@`, `operador@` y `auditor@printflow.local` / `Printflow2026*`.
