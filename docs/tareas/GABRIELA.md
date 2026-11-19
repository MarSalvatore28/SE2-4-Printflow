# Tareas de Gabriela · Equipo B

Te toca que lo que se entrega al cliente se vea bien y sea correcto: el **PDF del consolidado** (S4-01), la **pantalla de informes con el importe** que calcula el backend, y dejar el frontend limpio. **No esperas a Christian:** el formato de la respuesta del importe ya está acordado (`README.md`, «Contratos compartidos», punto 2). Mientras él no termine vendrá en $0, y tu pantalla y tu PDF deben verse bien igual.

| # | Tarea | Puntos | Para cuándo | Rama |
|---|---|---|---|---|
| 1 | **Informes: mostrar la facturación que calcula el backend** | 2 | 6 dic | `feature/f3-informes-facturacion` |
| 2 | **S4-01 · PDF del consolidado** | 3 | 20 dic | `feature/f4-pdf` |
| 3 | Limpieza del frontend: lint, textos y una etiqueta | 2 | 20 dic | `fix/web-limpieza` |

Todo es del repo **frontend**.

---

## 1. Informes con la facturación del backend

Hoy `src/app/Clientes/components/TablaDetalleConsolidado.tsx` **calcula su propia facturación** con las tarifas del cliente (por ejemplo, «Total final» $166,75), mientras el backend dice $0. Son dos cálculos distintos de lo mismo: hay que dejar **uno solo, el del backend**.

- **Quita el cálculo de facturación del frontend.** El consumo ya viene del backend y no se toca.
- **Tipos nuevos** en `src/types/Reporte/reporte.types.ts` para `resumen.facturacion[]` y `financiero.monto_referencial`, con la forma del contrato.
- **Tarjeta «Facturación del período»,** debajo de los totales: por cada contrato, una fila B/N y otra de color con consumo, incluidas, excedente, cuota fija y monto del excedente; después la renta y el **total**. Si `facturacion` viene vacía, el mensaje «El importe se calcula al cerrar el período» en lugar de la tarjeta, sin romperse.
- **El importe por máquina** de la tabla muestra `financiero.monto_referencial`, con una nota de que el total oficial es el del contrato.

**Cómo probarlo:** con la demo, Horizonte de octubre de 2026 muestra la tarjeta vacía o en $0 y no hay errores de consola. Para ver la tarjeta llena antes de que termine Christian, simula la respuesta con el ejemplo del `README.md` (Horizonte de octubre: **$395,48**).

## 2. S4-01 · PDF del consolidado

La exportación está en `src/utils/exportUtils.ts` y se llama desde `src/app/Informes/pages/Informes.page.tsx`. **Kiara trabaja la parte de Excel del mismo archivo:** tú tocas solo las funciones del PDF y ella solo las del Excel. Así git los junta sin conflictos.

El PDF debe tener:
- **Cabecera:** razón social y RUC del cliente, período (mes y año en letras: «Octubre de 2026») y fecha y hora de generación.
- **Detalle por máquina:** serie, área, contador inicial y final, páginas B/N, páginas color e importe referencial. Las filas de un **reemplazo** muestran los dos tramos o se marcan como «Reemplazo».
- **Facturación:** la del punto 1 (cuotas, excedentes, renta y total), o la nota si aún no hay importe.
- **Totales** al final.
- **Valores idénticos a los de la pantalla:** prueba con 2 clientes y 2 períodos, incluido noviembre con el reemplazo (`simulador/README.md`, «Reemplazo de una máquina»). Compara número por número y deja las capturas en el PR.

Hoy `exportUtils.ts` tiene unos 35 errores de ESLint (`any`, `prefer-const`). Corrige los de las funciones que toques.

## 3. Limpieza del frontend

Cada punto, en su commit:
1. **ESLint en archivos del Equipo B:**
   - `Clientes.page.tsx` tiene 8 `any`, `Area.page.tsx` 2 y `TablaDetalleUsuario.tsx` 2.
   - En `AuthContext.tsx`, `logout` se usa antes de declararse, hay un `try/catch` que no hace nada y `useAuth` se exporta junto al componente.

   Objetivo: 0 errores en esos archivos sin cambiar su comportamiento (prueba el login y el cierre de sesión).
2. **Textos:** en Clientes, Área, Informes y Notificaciones, pasa los textos «Con Mayúscula En Cada Palabra» a mayúscula solo al inicio. Por ejemplo, «Fecha Inicio» → «Fecha de inicio», «Editar Contrato» → «Editar contrato», «Filtros de Búsqueda» → «Filtros de búsqueda», «Limpiar Filtros» → «Limpiar filtros». Los nombres propios no se tocan.
3. **Etiqueta del modal de reemplazo** (`TablaDetalleConsolidado.tsx`, línea ~385): para la máquina **saliente** dice «Instalada», pero muestra la fecha de su **último corte**. Cámbiala a «Desde (último corte)».

Al terminar, `npm run build` sin errores y el recorrido de Informes con los 3 roles sin errores de consola.
