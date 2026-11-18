-- PrintFlow: esquema inicial (solo schema public), extraido del volcado de Supabase.
-- Sin datos. Generado para la migracion 001.

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Name: fix_global_time(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_global_time() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.fecha_corte::time = '00:00:00'::time THEN
        -- Extraemos la hora en formato local de Ecuador para que las cifras coincidan en la BD
        NEW.fecha_corte := NEW.fecha_corte::date + (NEW.fecha_lectura AT TIME ZONE 'America/Guayaquil')::time;
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: guardar_cambio_cliente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_cambio_cliente() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Mantenemos la lógica de detección de cambios (Nombre O Razón Social O RUC)
    IF (OLD.nombre IS DISTINCT FROM NEW.nombre) OR 
       (OLD.razon_social IS DISTINCT FROM NEW.razon_social) OR
       (OLD.ruc IS DISTINCT FROM NEW.ruc) THEN
       
        INSERT INTO public.clientes_historial (
            id_cliente, 
            nombre_anterior, 
            razon_social_anterior, 
            ruc_anterior,
            fecha_cambio
            -- Se eliminó usuario_cambio de aquí
        )
        VALUES (
            OLD.id_cliente, 
            OLD.nombre, 
            OLD.razon_social, 
            OLD.ruc,
            NOW()
            -- Se eliminó auth.uid() de aquí
        );
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: notificar_nuevo_lote(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notificar_nuevo_lote() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE
          v_tipo_id integer;
          v_notificacion_id integer;
          v_titulo text;
          v_mensaje text;
          v_fecha timestamp with time zone;
          v_leida boolean;
      BEGIN
          -- Buscar el ID del tipo de notificación "NUEVO_LOTE"
          SELECT id_tipo_notificacion INTO v_tipo_id
          FROM public.tipos_notificacion
          WHERE codigo = 'NUEVO_LOTE';

          -- Si existe el tipo, crear la notificación
          IF v_tipo_id IS NOT NULL THEN
              INSERT INTO public.notificaciones (
                  titulo,
                  mensaje,
                  lote_id,
                  tipo_notificacion_id,
                  fecha_creacion
              ) VALUES (
                  'Nuevo Lote Cargado',
                  'Se ha cargado un nuevo lote con código de referencia: ' || NEW.codigo_referencia,
                  NEW.id_lote,
                  v_tipo_id,
                  CURRENT_TIMESTAMP
              );
              -- Eliminamos el PERFORM pg_notify porque ya tenemos el trigger automático en la tabla notificaciones
          END IF;

          RETURN NEW;
      END;
      $$;

--
-- Name: notify_new_staging_batch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_staging_batch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    notif_exists BOOLEAN;
BEGIN
    IF NEW.lote_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.notificaciones WHERE lote_id = NEW.lote_id) INTO notif_exists;
        IF NOT notif_exists THEN
            INSERT INTO public.notificaciones (tipo_notificacion_id, titulo, mensaje, lote_id, fecha_creacion, leida)
            VALUES ((SELECT id_tipo_notificacion FROM public.tipos_notificacion WHERE codigo = 'NUEVO_LOTE' LIMIT 1), 
            'Nuevo Lote Pendiente', 'Se ha cargado un nuevo lote de reportes (Lote #' || NEW.lote_id || ') pendiente de aprobación.', NEW.lote_id, NOW(), false);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: notify_socket_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_socket_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
          -- Emitimos directamente la fila insertada como JSON, para que el frontend lea evt.titulo directamente
          PERFORM pg_notify('nueva_notificacion', row_to_json(NEW)::text);
          RETURN NEW;
      END;
      $$;

--
-- Name: sync_fecha_corte_from_detalle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_fecha_corte_from_detalle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        -- After inserting a detail, update the parent consolidado's fecha_corte
        -- using the MAX fecha_lectura from all its details
        UPDATE reportes_consolidado_staging
        SET fecha_corte = (
          SELECT MAX(fecha_lectura)
          FROM reportes_detalle_staging
          WHERE consolidado_staging_id = NEW.consolidado_staging_id
        )
        WHERE id_staging_consolidado = NEW.consolidado_staging_id;
        
        RETURN NEW;
      END;
      $$;

--
-- Name: areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.areas (
    id_area integer NOT NULL,
    cliente_id integer,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true,
    descripcion character varying
);

--
-- Name: areas_id_area_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.areas_id_area_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: areas_id_area_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.areas_id_area_seq OWNED BY public.areas.id_area;

--
-- Name: cabecera_contadores_cambio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabecera_contadores_cambio (
    id_cabecera_contador_cambio integer NOT NULL,
    maquina_cambio_id integer NOT NULL,
    maquina_id integer NOT NULL,
    tipo_maquina character varying(20) NOT NULL,
    contador_anterior_cop_bn integer DEFAULT 0,
    contador_anterior_cop_col integer DEFAULT 0,
    contador_anterior_imp_bn integer DEFAULT 0,
    contador_anterior_imp_col integer DEFAULT 0,
    contador_anterior_total_copias integer DEFAULT 0,
    contador_anterior_total_impresiones integer DEFAULT 0,
    contador_anterior_global integer DEFAULT 0,
    contador_actual_cop_bn integer DEFAULT 0,
    contador_actual_cop_col integer DEFAULT 0,
    contador_actual_imp_bn integer DEFAULT 0,
    contador_actual_imp_col integer DEFAULT 0,
    contador_actual_total_copias integer DEFAULT 0,
    contador_actual_total_impresiones integer DEFAULT 0,
    contador_actual_global integer DEFAULT 0,
    diferencia_cop_bn integer DEFAULT 0,
    diferencia_cop_col integer DEFAULT 0,
    diferencia_imp_bn integer DEFAULT 0,
    diferencia_imp_col integer DEFAULT 0,
    diferencia_total_copias integer DEFAULT 0,
    diferencia_total_impresiones integer DEFAULT 0,
    diferencia_global integer DEFAULT 0,
    CONSTRAINT check_tipo_maquina CHECK (((tipo_maquina)::text = ANY ((ARRAY['SALIENTE'::character varying, 'ENTRANTE'::character varying])::text[])))
);

--
-- Name: cabecera_contadores_cambio_id_cabecera_contador_cambio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cabecera_contadores_cambio_id_cabecera_contador_cambio_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: cabecera_contadores_cambio_id_cabecera_contador_cambio_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cabecera_contadores_cambio_id_cabecera_contador_cambio_seq OWNED BY public.cabecera_contadores_cambio.id_cabecera_contador_cambio;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id_cliente integer NOT NULL,
    nombre character varying(100) NOT NULL,
    ruc character varying(20) NOT NULL,
    razon_social character varying(150),
    activo boolean DEFAULT true
);

--
-- Name: clientes_historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes_historial (
    id_historial integer NOT NULL,
    id_cliente integer NOT NULL,
    nombre_anterior character varying(100) NOT NULL,
    razon_social_anterior character varying(150),
    ruc_anterior character varying(20),
    fecha_cambio timestamp with time zone DEFAULT now()
);

--
-- Name: clientes_historial_id_historial_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clientes_historial_id_historial_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: clientes_historial_id_historial_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clientes_historial_id_historial_seq OWNED BY public.clientes_historial.id_historial;

--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clientes_id_cliente_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clientes_id_cliente_seq OWNED BY public.clientes.id_cliente;

--
-- Name: consolidado_mensual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consolidado_mensual (
    id_consolidado integer NOT NULL,
    periodo character varying(7) NOT NULL,
    cliente_id integer,
    id_grupo_cambio uuid,
    snap_cliente_nombre text,
    snap_cliente_ruc text,
    total_bn_consolidado integer NOT NULL,
    total_color_consolidado integer NOT NULL,
    total_impresiones_consolidado integer NOT NULL,
    total_copias_consolidado integer NOT NULL,
    snap_costo_bn numeric(10,4),
    snap_costo_col numeric(10,4),
    snap_monto_total numeric(12,2),
    hubo_cambio_maquina boolean DEFAULT false,
    cantidad_maquinas_involucradas smallint DEFAULT 1,
    detalle_cambio text,
    tiene_detalle boolean DEFAULT false,
    total_registros_detalle integer DEFAULT 0,
    fecha_generacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_generacion_id integer
);

--
-- Name: consolidado_mensual_id_consolidado_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consolidado_mensual_id_consolidado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: consolidado_mensual_id_consolidado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consolidado_mensual_id_consolidado_seq OWNED BY public.consolidado_mensual.id_consolidado;

--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id_contrato integer NOT NULL,
    cliente_id integer NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin date,
    impresiones_bn_incluidas integer DEFAULT 0,
    impresiones_color_incluidas integer DEFAULT 0,
    costo_impresion_bn numeric(10,4) DEFAULT 0,
    costo_impresion_color numeric(10,4) DEFAULT 0,
    activo boolean DEFAULT true,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    renta_equipo boolean,
    software_control boolean,
    facturacion_de_impresora text,
    costo_x_excedente_impresion_bn real,
    costo_x_excedente_impresion_color double precision
);

--
-- Name: contratos_id_contrato_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_id_contrato_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: contratos_id_contrato_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_id_contrato_seq OWNED BY public.contratos.id_contrato;

--
-- Name: historial_cambios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_cambios (
    id_cambio integer NOT NULL,
    instalacion_saliente_id integer,
    instalacion_entrante_id integer,
    motivo_cambio text,
    usuario_id integer,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: historial_cambios_id_cambio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.historial_cambios_id_cambio_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: historial_cambios_id_cambio_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historial_cambios_id_cambio_seq OWNED BY public.historial_cambios.id_cambio;

--
-- Name: historial_contadores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_contadores (
    id_historial_contador integer NOT NULL,
    contador_bn integer DEFAULT 0,
    contador_color integer DEFAULT 0,
    total_impresiones integer DEFAULT 0,
    total_copias integer DEFAULT 0,
    id_maquina integer,
    total_contadores integer
);

--
-- Name: historial_contadores_id_historial_contador_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.historial_contadores_id_historial_contador_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: historial_contadores_id_historial_contador_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historial_contadores_id_historial_contador_seq OWNED BY public.historial_contadores.id_historial_contador;

--
-- Name: historial_maquinas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_maquinas (
    id_historial_maquina integer NOT NULL,
    maquina_saliente_id integer,
    maquina_entrante_id integer
);

--
-- Name: historial_maquinas_id_historial_maquina_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.historial_maquinas_id_historial_maquina_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: historial_maquinas_id_historial_maquina_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historial_maquinas_id_historial_maquina_seq OWNED BY public.historial_maquinas.id_historial_maquina;

--
-- Name: historial_ubicaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_ubicaciones (
    id_historial_ubicacion integer NOT NULL,
    cliente_id integer NOT NULL,
    area_id integer NOT NULL
);

--
-- Name: historial_ubicaciones_id_historial_ubicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.historial_ubicaciones_id_historial_ubicacion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: historial_ubicaciones_id_historial_ubicacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historial_ubicaciones_id_historial_ubicacion_seq OWNED BY public.historial_ubicaciones.id_historial_ubicacion;

--
-- Name: instalaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instalaciones (
    id_instalacion integer NOT NULL,
    maquina_id integer NOT NULL,
    area_id integer NOT NULL,
    contrato_id integer NOT NULL,
    ip_address character varying(15),
    fecha_instalacion date NOT NULL,
    fecha_retiro date,
    activo boolean DEFAULT true,
    observaciones text,
    costo_renta_mensual numeric(10,2) DEFAULT 0,
    contador_acumulativo boolean DEFAULT true,
    contabilidad_por_usuario boolean DEFAULT false
);

--
-- Name: instalaciones_id_instalacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.instalaciones_id_instalacion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: instalaciones_id_instalacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.instalaciones_id_instalacion_seq OWNED BY public.instalaciones.id_instalacion;

--
-- Name: lotes_carga; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_carga (
    id_lote integer NOT NULL,
    codigo_referencia character varying(100) NOT NULL,
    fecha_carga timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_aprobacion_id integer,
    fecha_aprobacion timestamp with time zone,
    total_registros_cargados integer DEFAULT 0,
    monto_total numeric(12,2) DEFAULT 0,
    fecha_corte timestamp with time zone,
    periodo character varying(7)
);

--
-- Name: lotes_carga_id_lote_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lotes_carga_id_lote_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: lotes_carga_id_lote_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lotes_carga_id_lote_seq OWNED BY public.lotes_carga.id_lote;

--
-- Name: maquinas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maquinas (
    id_maquina integer NOT NULL,
    serie character varying(50) NOT NULL,
    activo boolean DEFAULT true,
    formato_impresion_id integer,
    tipo_impresion_id integer,
    modelo_id integer
);

--
-- Name: maquinas_cambio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maquinas_cambio (
    id_maquina_cambio integer NOT NULL,
    fecha_danio date NOT NULL,
    periodo_afectado character varying(7) NOT NULL,
    maquina_saliente_id integer NOT NULL,
    maquina_entrante_id integer NOT NULL,
    instalacion_saliente_id integer,
    instalacion_entrante_id integer,
    area_id integer,
    razon_cambio text NOT NULL,
    tipo_cambio character varying(50),
    snap_maquina_saliente_serie text,
    snap_maquina_saliente_modelo text,
    snap_maquina_entrante_serie text,
    snap_maquina_entrante_modelo text,
    fecha_registro timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    activo boolean DEFAULT true,
    fecha_instalacion_entrante date NOT NULL,
    CONSTRAINT chk_fecha_instalacion_despues_danio CHECK ((fecha_instalacion_entrante >= fecha_danio))
);

--
-- Name: COLUMN maquinas_cambio.fecha_danio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.maquinas_cambio.fecha_danio IS 'Fecha en que se reportó el daño o cuando la máquina saliente dejó de operar';

--
-- Name: COLUMN maquinas_cambio.fecha_instalacion_entrante; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.maquinas_cambio.fecha_instalacion_entrante IS 'Fecha en que se instaló físicamente la máquina entrante (puede ser diferente a fecha_danio)';

--
-- Name: maquinas_cambio_id_maquina_cambio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.maquinas_cambio_id_maquina_cambio_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: maquinas_cambio_id_maquina_cambio_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.maquinas_cambio_id_maquina_cambio_seq OWNED BY public.maquinas_cambio.id_maquina_cambio;

--
-- Name: maquinas_id_maquina_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.maquinas_id_maquina_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: maquinas_id_maquina_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.maquinas_id_maquina_seq OWNED BY public.maquinas.id_maquina;

--
-- Name: modelos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modelos (
    id_modelo integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true
);

--
-- Name: modelos_id_modelo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modelos_id_modelo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: modelos_id_modelo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modelos_id_modelo_seq OWNED BY public.modelos.id_modelo;

--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id_notificacion integer NOT NULL,
    titulo character varying(200) NOT NULL,
    mensaje text,
    datos_adicionales jsonb,
    lote_id integer,
    leida boolean DEFAULT false,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    fecha_lectura timestamp with time zone,
    tipo_notificacion_id integer NOT NULL
);

--
-- Name: notificaciones_id_notificacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notificaciones_id_notificacion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: notificaciones_id_notificacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificaciones_id_notificacion_seq OWNED BY public.notificaciones.id_notificacion;

--
-- Name: reportes_consolidado_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_consolidado_staging (
    id_staging_consolidado integer NOT NULL,
    lote_id integer,
    ip_detectada character varying(45),
    print_total integer DEFAULT 0,
    copy_total integer DEFAULT 0,
    fecha_lectura timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    maquina_id_tentativa integer,
    cliente_id_tentativo integer,
    serie_maquina character varying,
    copia_bn integer DEFAULT 0,
    copia_color integer DEFAULT 0,
    impresion_bn integer DEFAULT 0,
    impresion_color integer DEFAULT 0,
    totalservicio integer DEFAULT 0,
    fecha_corte timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    estado_maquina character varying(255) DEFAULT 'Desconocido'::character varying,
    procesar_lectura boolean DEFAULT true,
    mensaje_aviso text
);

--
-- Name: TABLE reportes_consolidado_staging; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reportes_consolidado_staging IS 'ESPEJO: Totales mensuales sin validar (ej: máquina X = 1000 impresiones en febrero)';

--
-- Name: reportes_consolidado_staging_id_staging_consolidado_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_consolidado_staging_id_staging_consolidado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reportes_consolidado_staging_id_staging_consolidado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reportes_consolidado_staging_id_staging_consolidado_seq OWNED BY public.reportes_consolidado_staging.id_staging_consolidado;

--
-- Name: reportes_detalle_oficial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_detalle_oficial (
    id_detalle integer NOT NULL,
    reporte_oficial_id integer NOT NULL,
    fecha_transaccion timestamp with time zone,
    cuenta_id character varying,
    usuario_trabajo character varying(255),
    usuario_validacion_id integer,
    cnt_copia_bn integer DEFAULT 0,
    cnt_copia_color integer DEFAULT 0,
    cnt_impresion_bn integer DEFAULT 0,
    cnt_impresion_color integer DEFAULT 0,
    print_total integer DEFAULT 0,
    copy_total integer DEFAULT 0,
    monto_detalle numeric(10,2) DEFAULT 0,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: TABLE reportes_detalle_oficial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reportes_detalle_oficial IS 'Almacena el detalle de transacciones por usuario para cada reporte oficial consolidado';

--
-- Name: COLUMN reportes_detalle_oficial.id_detalle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.id_detalle IS 'Identificador único del registro de detalle';

--
-- Name: COLUMN reportes_detalle_oficial.reporte_oficial_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.reporte_oficial_id IS 'FK al reporte oficial consolidado (padre)';

--
-- Name: COLUMN reportes_detalle_oficial.fecha_transaccion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.fecha_transaccion IS 'Fecha en que se realizó la transacción';

--
-- Name: COLUMN reportes_detalle_oficial.cuenta_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.cuenta_id IS 'ID de la cuenta de usuario que realizó las impresiones';

--
-- Name: COLUMN reportes_detalle_oficial.usuario_trabajo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.usuario_trabajo IS 'Nombre del usuario que realizó las impresiones';

--
-- Name: COLUMN reportes_detalle_oficial.cnt_copia_bn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.cnt_copia_bn IS 'Contador de copias en blanco y negro';

--
-- Name: COLUMN reportes_detalle_oficial.cnt_copia_color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.cnt_copia_color IS 'Contador de copias a color';

--
-- Name: COLUMN reportes_detalle_oficial.cnt_impresion_bn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.cnt_impresion_bn IS 'Contador de impresiones en blanco y negro';

--
-- Name: COLUMN reportes_detalle_oficial.cnt_impresion_color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.cnt_impresion_color IS 'Contador de impresiones a color';

--
-- Name: COLUMN reportes_detalle_oficial.print_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.print_total IS 'Total de impresiones (BN + Color)';

--
-- Name: COLUMN reportes_detalle_oficial.copy_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.copy_total IS 'Total de copias (BN + Color)';

--
-- Name: COLUMN reportes_detalle_oficial.monto_detalle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_detalle_oficial.monto_detalle IS 'Monto calculado para este detalle específico';

--
-- Name: reportes_detalle_oficial_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_detalle_oficial_id_detalle_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reportes_detalle_oficial_id_detalle_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reportes_detalle_oficial_id_detalle_seq OWNED BY public.reportes_detalle_oficial.id_detalle;

--
-- Name: reportes_detalle_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_detalle_staging (
    id_staging_detalle integer NOT NULL,
    lote_id integer,
    consolidado_staging_id integer,
    cuenta_id character varying(50),
    print_total integer DEFAULT 0,
    copy_total integer DEFAULT 0,
    nombre_cuenta character varying(100),
    fecha_lectura timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    maquina_id_tentativa integer,
    copia_bn integer DEFAULT 0,
    copia_color integer DEFAULT 0,
    impresion_bn integer DEFAULT 0,
    impresion_color integer DEFAULT 0,
    nombre_host character varying
);

--
-- Name: TABLE reportes_detalle_staging; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reportes_detalle_staging IS 'ESPEJO: Desglose diario/transaccional sin validar (ej: día 1=50, día 2=30, etc.)';

--
-- Name: reportes_detalle_staging_id_staging_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_detalle_staging_id_staging_detalle_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reportes_detalle_staging_id_staging_detalle_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reportes_detalle_staging_id_staging_detalle_seq OWNED BY public.reportes_detalle_staging.id_staging_detalle;

--
-- Name: reportes_oficiales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_oficiales (
    id_reporte integer NOT NULL,
    lote_origen_id integer,
    periodo character varying(7) NOT NULL,
    fecha_procesamiento timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    fecha_congelacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    es_maquina_reemplazo boolean DEFAULT false,
    snap_area_nombre text,
    snap_maquina_serie text,
    snap_maquina_ip text,
    usuario_validacion_id integer,
    snap_costo_impresion_bn numeric(10,4) DEFAULT 0,
    snap_costo_impresion_color numeric(10,4) DEFAULT 0,
    snap_costo_copia_bn numeric(10,4) DEFAULT 0,
    snap_costo_copia_color numeric(10,4) DEFAULT 0,
    contador_impresiones_bn integer DEFAULT 0,
    contador_impresiones_color integer DEFAULT 0,
    contador_copias_bn integer DEFAULT 0,
    contador_copias_color integer DEFAULT 0,
    cliente_id integer,
    maquina_id integer,
    print_total integer DEFAULT 0,
    copy_total integer DEFAULT 0,
    total_servicio integer DEFAULT 0,
    tiene_cambio_maquina boolean DEFAULT false,
    maquina_cambio_id integer,
    es_parte_cambio boolean DEFAULT false,
    fecha_corte timestamp with time zone
);

--
-- Name: TABLE reportes_oficiales; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reportes_oficiales IS 'PRODUCCIÓN: Totales mensuales congelados e inmutables';

--
-- Name: COLUMN reportes_oficiales.fecha_corte; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reportes_oficiales.fecha_corte IS 'Fecha real de generación del reporte (corte), puede ser diferente a la fecha de procesamiento';

--
-- Name: reportes_oficiales_id_reporte_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_oficiales_id_reporte_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reportes_oficiales_id_reporte_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reportes_oficiales_id_reporte_seq OWNED BY public.reportes_oficiales.id_reporte;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id_rol integer NOT NULL,
    nombre character varying(50) NOT NULL,
    descripcion text
);

--
-- Name: roles_id_rol_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_rol_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: roles_id_rol_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_rol_seq OWNED BY public.roles.id_rol;

--
-- Name: tipos_formato_impresion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipos_formato_impresion (
    id_formato integer NOT NULL,
    nombre character varying(20) NOT NULL,
    activo boolean DEFAULT true
);

--
-- Name: tipos_formato_impresion_id_formato_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipos_formato_impresion_id_formato_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: tipos_formato_impresion_id_formato_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipos_formato_impresion_id_formato_seq OWNED BY public.tipos_formato_impresion.id_formato;

--
-- Name: tipos_impresion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipos_impresion (
    id_tipo_impresion integer NOT NULL,
    nombre character varying(50) NOT NULL,
    activo boolean DEFAULT true
);

--
-- Name: tipos_impresion_id_tipo_impresion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipos_impresion_id_tipo_impresion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: tipos_impresion_id_tipo_impresion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipos_impresion_id_tipo_impresion_seq OWNED BY public.tipos_impresion.id_tipo_impresion;

--
-- Name: tipos_notificacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipos_notificacion (
    id_tipo_notificacion integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: tipos_notificacion_id_tipo_notificacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipos_notificacion_id_tipo_notificacion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: tipos_notificacion_id_tipo_notificacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipos_notificacion_id_tipo_notificacion_seq OWNED BY public.tipos_notificacion.id_tipo_notificacion;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id_usuario integer NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol_id integer,
    activo boolean DEFAULT true,
    nombre character varying,
    apellido character varying
);

--
-- Name: usuarios_id_usuario_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_usuario_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: usuarios_id_usuario_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_usuario_seq OWNED BY public.usuarios.id_usuario;

--
-- Name: areas id_area; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas ALTER COLUMN id_area SET DEFAULT nextval('public.areas_id_area_seq'::regclass);

--
-- Name: cabecera_contadores_cambio id_cabecera_contador_cambio; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabecera_contadores_cambio ALTER COLUMN id_cabecera_contador_cambio SET DEFAULT nextval('public.cabecera_contadores_cambio_id_cabecera_contador_cambio_seq'::regclass);

--
-- Name: clientes id_cliente; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id_cliente SET DEFAULT nextval('public.clientes_id_cliente_seq'::regclass);

--
-- Name: clientes_historial id_historial; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes_historial ALTER COLUMN id_historial SET DEFAULT nextval('public.clientes_historial_id_historial_seq'::regclass);

--
-- Name: consolidado_mensual id_consolidado; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidado_mensual ALTER COLUMN id_consolidado SET DEFAULT nextval('public.consolidado_mensual_id_consolidado_seq'::regclass);

--
-- Name: contratos id_contrato; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos ALTER COLUMN id_contrato SET DEFAULT nextval('public.contratos_id_contrato_seq'::regclass);

--
-- Name: historial_cambios id_cambio; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_cambios ALTER COLUMN id_cambio SET DEFAULT nextval('public.historial_cambios_id_cambio_seq'::regclass);

--
-- Name: historial_contadores id_historial_contador; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_contadores ALTER COLUMN id_historial_contador SET DEFAULT nextval('public.historial_contadores_id_historial_contador_seq'::regclass);

--
-- Name: historial_maquinas id_historial_maquina; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_maquinas ALTER COLUMN id_historial_maquina SET DEFAULT nextval('public.historial_maquinas_id_historial_maquina_seq'::regclass);

--
-- Name: historial_ubicaciones id_historial_ubicacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_ubicaciones ALTER COLUMN id_historial_ubicacion SET DEFAULT nextval('public.historial_ubicaciones_id_historial_ubicacion_seq'::regclass);

--
-- Name: instalaciones id_instalacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instalaciones ALTER COLUMN id_instalacion SET DEFAULT nextval('public.instalaciones_id_instalacion_seq'::regclass);

--
-- Name: lotes_carga id_lote; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_carga ALTER COLUMN id_lote SET DEFAULT nextval('public.lotes_carga_id_lote_seq'::regclass);

--
-- Name: maquinas id_maquina; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas ALTER COLUMN id_maquina SET DEFAULT nextval('public.maquinas_id_maquina_seq'::regclass);

--
-- Name: maquinas_cambio id_maquina_cambio; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio ALTER COLUMN id_maquina_cambio SET DEFAULT nextval('public.maquinas_cambio_id_maquina_cambio_seq'::regclass);

--
-- Name: modelos id_modelo; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelos ALTER COLUMN id_modelo SET DEFAULT nextval('public.modelos_id_modelo_seq'::regclass);

--
-- Name: notificaciones id_notificacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id_notificacion SET DEFAULT nextval('public.notificaciones_id_notificacion_seq'::regclass);

--
-- Name: reportes_consolidado_staging id_staging_consolidado; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_consolidado_staging ALTER COLUMN id_staging_consolidado SET DEFAULT nextval('public.reportes_consolidado_staging_id_staging_consolidado_seq'::regclass);

--
-- Name: reportes_detalle_oficial id_detalle; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_oficial ALTER COLUMN id_detalle SET DEFAULT nextval('public.reportes_detalle_oficial_id_detalle_seq'::regclass);

--
-- Name: reportes_detalle_staging id_staging_detalle; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_staging ALTER COLUMN id_staging_detalle SET DEFAULT nextval('public.reportes_detalle_staging_id_staging_detalle_seq'::regclass);

--
-- Name: reportes_oficiales id_reporte; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales ALTER COLUMN id_reporte SET DEFAULT nextval('public.reportes_oficiales_id_reporte_seq'::regclass);

--
-- Name: roles id_rol; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id_rol SET DEFAULT nextval('public.roles_id_rol_seq'::regclass);

--
-- Name: tipos_formato_impresion id_formato; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_formato_impresion ALTER COLUMN id_formato SET DEFAULT nextval('public.tipos_formato_impresion_id_formato_seq'::regclass);

--
-- Name: tipos_impresion id_tipo_impresion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_impresion ALTER COLUMN id_tipo_impresion SET DEFAULT nextval('public.tipos_impresion_id_tipo_impresion_seq'::regclass);

--
-- Name: tipos_notificacion id_tipo_notificacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_notificacion ALTER COLUMN id_tipo_notificacion SET DEFAULT nextval('public.tipos_notificacion_id_tipo_notificacion_seq'::regclass);

--
-- Name: usuarios id_usuario; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id_usuario SET DEFAULT nextval('public.usuarios_id_usuario_seq'::regclass);

--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id_area);

--
-- Name: cabecera_contadores_cambio cabecera_contadores_cambio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabecera_contadores_cambio
    ADD CONSTRAINT cabecera_contadores_cambio_pkey PRIMARY KEY (id_cabecera_contador_cambio);

--
-- Name: clientes_historial clientes_historial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes_historial
    ADD CONSTRAINT clientes_historial_pkey PRIMARY KEY (id_historial);

--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id_cliente);

--
-- Name: consolidado_mensual consolidado_mensual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidado_mensual
    ADD CONSTRAINT consolidado_mensual_pkey PRIMARY KEY (id_consolidado);

--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (id_contrato);

--
-- Name: historial_cambios historial_cambios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_cambios
    ADD CONSTRAINT historial_cambios_pkey PRIMARY KEY (id_cambio);

--
-- Name: historial_contadores historial_contadores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_contadores
    ADD CONSTRAINT historial_contadores_pkey PRIMARY KEY (id_historial_contador);

--
-- Name: historial_maquinas historial_maquinas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_maquinas
    ADD CONSTRAINT historial_maquinas_pkey PRIMARY KEY (id_historial_maquina);

--
-- Name: historial_ubicaciones historial_ubicaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_ubicaciones
    ADD CONSTRAINT historial_ubicaciones_pkey PRIMARY KEY (id_historial_ubicacion);

--
-- Name: instalaciones instalaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instalaciones
    ADD CONSTRAINT instalaciones_pkey PRIMARY KEY (id_instalacion);

--
-- Name: lotes_carga lotes_carga_codigo_referencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_carga
    ADD CONSTRAINT lotes_carga_codigo_referencia_key UNIQUE (codigo_referencia);

--
-- Name: lotes_carga lotes_carga_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_carga
    ADD CONSTRAINT lotes_carga_pkey PRIMARY KEY (id_lote);

--
-- Name: maquinas_cambio maquinas_cambio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_pkey PRIMARY KEY (id_maquina_cambio);

--
-- Name: maquinas maquinas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_pkey PRIMARY KEY (id_maquina);

--
-- Name: maquinas maquinas_serie_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_serie_key UNIQUE (serie);

--
-- Name: modelos modelos_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelos
    ADD CONSTRAINT modelos_nombre_key UNIQUE (nombre);

--
-- Name: modelos modelos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelos
    ADD CONSTRAINT modelos_pkey PRIMARY KEY (id_modelo);

--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id_notificacion);

--
-- Name: reportes_consolidado_staging reportes_consolidado_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_consolidado_staging
    ADD CONSTRAINT reportes_consolidado_staging_pkey PRIMARY KEY (id_staging_consolidado);

--
-- Name: reportes_detalle_oficial reportes_detalle_oficial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_oficial
    ADD CONSTRAINT reportes_detalle_oficial_pkey PRIMARY KEY (id_detalle);

--
-- Name: reportes_detalle_staging reportes_detalle_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_staging
    ADD CONSTRAINT reportes_detalle_staging_pkey PRIMARY KEY (id_staging_detalle);

--
-- Name: reportes_oficiales reportes_oficiales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_oficiales_pkey PRIMARY KEY (id_reporte);

--
-- Name: roles roles_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_nombre_key UNIQUE (nombre);

--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id_rol);

--
-- Name: tipos_formato_impresion tipos_formato_impresion_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_formato_impresion
    ADD CONSTRAINT tipos_formato_impresion_nombre_key UNIQUE (nombre);

--
-- Name: tipos_formato_impresion tipos_formato_impresion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_formato_impresion
    ADD CONSTRAINT tipos_formato_impresion_pkey PRIMARY KEY (id_formato);

--
-- Name: tipos_impresion tipos_impresion_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_impresion
    ADD CONSTRAINT tipos_impresion_nombre_key UNIQUE (nombre);

--
-- Name: tipos_impresion tipos_impresion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_impresion
    ADD CONSTRAINT tipos_impresion_pkey PRIMARY KEY (id_tipo_impresion);

--
-- Name: tipos_notificacion tipos_notificacion_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_notificacion
    ADD CONSTRAINT tipos_notificacion_codigo_key UNIQUE (codigo);

--
-- Name: tipos_notificacion tipos_notificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_notificacion
    ADD CONSTRAINT tipos_notificacion_pkey PRIMARY KEY (id_tipo_notificacion);

--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);

--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id_usuario);

--
-- Name: idx_cabecera_cont_cambio_maquina; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cabecera_cont_cambio_maquina ON public.cabecera_contadores_cambio USING btree (maquina_id);

--
-- Name: idx_cabecera_cont_cambio_maquina_cambio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cabecera_cont_cambio_maquina_cambio ON public.cabecera_contadores_cambio USING btree (maquina_cambio_id);

--
-- Name: idx_cabecera_cont_cambio_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cabecera_cont_cambio_tipo ON public.cabecera_contadores_cambio USING btree (tipo_maquina);

--
-- Name: idx_consolidado_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consolidado_cliente ON public.consolidado_mensual USING btree (cliente_id);

--
-- Name: idx_consolidado_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consolidado_periodo ON public.consolidado_mensual USING btree (periodo);

--
-- Name: idx_contratos_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_activo ON public.contratos USING btree (activo) WHERE (activo = true);

--
-- Name: idx_contratos_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_cliente ON public.contratos USING btree (cliente_id);

--
-- Name: idx_detalle_oficial_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_oficial_cuenta ON public.reportes_detalle_oficial USING btree (cuenta_id);

--
-- Name: idx_detalle_oficial_fecha_transaccion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_oficial_fecha_transaccion ON public.reportes_detalle_oficial USING btree (fecha_transaccion);

--
-- Name: idx_detalle_oficial_reporte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_oficial_reporte ON public.reportes_detalle_oficial USING btree (reporte_oficial_id);

--
-- Name: idx_detalle_oficial_reporte_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_oficial_reporte_usuario ON public.reportes_detalle_oficial USING btree (reporte_oficial_id, usuario_trabajo);

--
-- Name: idx_historial_cliente_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_cliente_fecha ON public.clientes_historial USING btree (id_cliente, fecha_cambio);

--
-- Name: idx_historial_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_fecha ON public.historial_cambios USING btree (fecha_creacion);

--
-- Name: idx_historial_instalacion_ent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_instalacion_ent ON public.historial_cambios USING btree (instalacion_entrante_id);

--
-- Name: idx_historial_instalacion_sal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_instalacion_sal ON public.historial_cambios USING btree (instalacion_saliente_id);

--
-- Name: idx_historial_maq_entrante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_maq_entrante ON public.historial_maquinas USING btree (maquina_entrante_id);

--
-- Name: idx_historial_maq_saliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_maq_saliente ON public.historial_maquinas USING btree (maquina_saliente_id);

--
-- Name: idx_historial_ubic_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_ubic_area ON public.historial_ubicaciones USING btree (area_id);

--
-- Name: idx_historial_ubic_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_ubic_cliente ON public.historial_ubicaciones USING btree (cliente_id);

--
-- Name: idx_instalaciones_activas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instalaciones_activas ON public.instalaciones USING btree (activo) WHERE ((activo = true) AND (fecha_retiro IS NULL));

--
-- Name: idx_instalaciones_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instalaciones_area ON public.instalaciones USING btree (area_id);

--
-- Name: idx_instalaciones_maquina; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instalaciones_maquina ON public.instalaciones USING btree (maquina_id);

--
-- Name: idx_lotes_monto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_monto ON public.lotes_carga USING btree (monto_total);

--
-- Name: idx_maquinas_cambio_entrante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_cambio_entrante ON public.maquinas_cambio USING btree (maquina_entrante_id);

--
-- Name: idx_maquinas_cambio_fecha_danio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_cambio_fecha_danio ON public.maquinas_cambio USING btree (fecha_danio);

--
-- Name: idx_maquinas_cambio_fecha_instalacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_cambio_fecha_instalacion ON public.maquinas_cambio USING btree (fecha_instalacion_entrante);

--
-- Name: idx_maquinas_cambio_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_cambio_periodo ON public.maquinas_cambio USING btree (periodo_afectado);

--
-- Name: idx_maquinas_cambio_saliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_cambio_saliente ON public.maquinas_cambio USING btree (maquina_saliente_id);

--
-- Name: idx_maquinas_formato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_formato ON public.maquinas USING btree (formato_impresion_id);

--
-- Name: idx_maquinas_modelo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_modelo ON public.maquinas USING btree (modelo_id);

--
-- Name: idx_maquinas_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maquinas_tipo ON public.maquinas USING btree (tipo_impresion_id);

--
-- Name: idx_notif_leida; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_leida ON public.notificaciones USING btree (leida) WHERE (leida = false);

--
-- Name: idx_notif_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_tipo ON public.notificaciones USING btree (tipo_notificacion_id);

--
-- Name: idx_reportes_cambio_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_cambio_periodo ON public.reportes_oficiales USING btree (tiene_cambio_maquina, periodo) WHERE (tiene_cambio_maquina = true);

--
-- Name: idx_reportes_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_cliente_id ON public.reportes_oficiales USING btree (cliente_id);

--
-- Name: idx_reportes_fecha_corte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_fecha_corte ON public.reportes_oficiales USING btree (fecha_corte);

--
-- Name: idx_reportes_maquina_cambio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_maquina_cambio ON public.reportes_oficiales USING btree (maquina_cambio_id);

--
-- Name: idx_reportes_maquina_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_maquina_id ON public.reportes_oficiales USING btree (maquina_id);

--
-- Name: idx_reportes_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_periodo ON public.reportes_oficiales USING btree (periodo);

--
-- Name: idx_staging_consol_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staging_consol_lote ON public.reportes_consolidado_staging USING btree (lote_id);

--
-- Name: idx_staging_detalle_consolidado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staging_detalle_consolidado ON public.reportes_detalle_staging USING btree (consolidado_staging_id);

--
-- Name: idx_staging_detalle_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staging_detalle_lote ON public.reportes_detalle_staging USING btree (lote_id);

--
-- Name: idx_staging_fecha_corte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staging_fecha_corte ON public.reportes_consolidado_staging USING btree (fecha_corte);

--
-- Name: idx_staging_serie_maquina; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staging_serie_maquina ON public.reportes_consolidado_staging USING btree (serie_maquina);

--
-- Name: clientes trg_audit_clientes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_clientes BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.guardar_cambio_cliente();

--
-- Name: notificaciones trg_notify_socket; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_socket AFTER INSERT ON public.notificaciones FOR EACH ROW EXECUTE FUNCTION public.notify_socket_event();

--
-- Name: reportes_detalle_staging trg_sync_fecha_corte; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_fecha_corte AFTER INSERT ON public.reportes_detalle_staging FOR EACH ROW EXECUTE FUNCTION public.sync_fecha_corte_from_detalle();

--
-- Name: reportes_consolidado_staging trigger_fix_global_time; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_fix_global_time BEFORE INSERT OR UPDATE ON public.reportes_consolidado_staging FOR EACH ROW EXECUTE FUNCTION public.fix_global_time();

--
-- Name: lotes_carga trigger_notificar_nuevo_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_notificar_nuevo_lote AFTER INSERT ON public.lotes_carga FOR EACH ROW EXECUTE FUNCTION public.notificar_nuevo_lote();

--
-- Name: areas areas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id_cliente);

--
-- Name: cabecera_contadores_cambio cabecera_contadores_cambio_maquina_cambio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabecera_contadores_cambio
    ADD CONSTRAINT cabecera_contadores_cambio_maquina_cambio_fkey FOREIGN KEY (maquina_cambio_id) REFERENCES public.maquinas_cambio(id_maquina_cambio);

--
-- Name: cabecera_contadores_cambio cabecera_contadores_cambio_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabecera_contadores_cambio
    ADD CONSTRAINT cabecera_contadores_cambio_maquina_fkey FOREIGN KEY (maquina_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: clientes_historial clientes_historial_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes_historial
    ADD CONSTRAINT clientes_historial_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente);

--
-- Name: consolidado_mensual consolidado_mensual_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidado_mensual
    ADD CONSTRAINT consolidado_mensual_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id_cliente);

--
-- Name: consolidado_mensual consolidado_mensual_usuario_generacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidado_mensual
    ADD CONSTRAINT consolidado_mensual_usuario_generacion_id_fkey FOREIGN KEY (usuario_generacion_id) REFERENCES public.usuarios(id_usuario);

--
-- Name: contratos contratos_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_cliente_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id_cliente);

--
-- Name: historial_contadores historial_contadores_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_contadores
    ADD CONSTRAINT historial_contadores_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id_maquina);

--
-- Name: historial_cambios historial_instalacion_ent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_cambios
    ADD CONSTRAINT historial_instalacion_ent_fkey FOREIGN KEY (instalacion_entrante_id) REFERENCES public.instalaciones(id_instalacion);

--
-- Name: historial_cambios historial_instalacion_sal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_cambios
    ADD CONSTRAINT historial_instalacion_sal_fkey FOREIGN KEY (instalacion_saliente_id) REFERENCES public.instalaciones(id_instalacion);

--
-- Name: historial_maquinas historial_maq_entrante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_maquinas
    ADD CONSTRAINT historial_maq_entrante_fkey FOREIGN KEY (maquina_entrante_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: historial_maquinas historial_maq_saliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_maquinas
    ADD CONSTRAINT historial_maq_saliente_fkey FOREIGN KEY (maquina_saliente_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: historial_ubicaciones historial_ubic_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_ubicaciones
    ADD CONSTRAINT historial_ubic_area_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id_area);

--
-- Name: historial_ubicaciones historial_ubic_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_ubicaciones
    ADD CONSTRAINT historial_ubic_cliente_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id_cliente);

--
-- Name: historial_cambios historial_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_cambios
    ADD CONSTRAINT historial_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id_usuario);

--
-- Name: instalaciones instalaciones_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instalaciones
    ADD CONSTRAINT instalaciones_area_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id_area);

--
-- Name: instalaciones instalaciones_contrato_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instalaciones
    ADD CONSTRAINT instalaciones_contrato_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id_contrato);

--
-- Name: instalaciones instalaciones_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instalaciones
    ADD CONSTRAINT instalaciones_maquina_fkey FOREIGN KEY (maquina_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: lotes_carga lotes_carga_usuario_aprobacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_carga
    ADD CONSTRAINT lotes_carga_usuario_aprobacion_id_fkey FOREIGN KEY (usuario_aprobacion_id) REFERENCES public.usuarios(id_usuario);

--
-- Name: maquinas_cambio maquinas_cambio_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_area_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id_area);

--
-- Name: maquinas_cambio maquinas_cambio_entrante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_entrante_fkey FOREIGN KEY (maquina_entrante_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: maquinas_cambio maquinas_cambio_instalacion_ent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_instalacion_ent_fkey FOREIGN KEY (instalacion_entrante_id) REFERENCES public.instalaciones(id_instalacion);

--
-- Name: maquinas_cambio maquinas_cambio_instalacion_sal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_instalacion_sal_fkey FOREIGN KEY (instalacion_saliente_id) REFERENCES public.instalaciones(id_instalacion);

--
-- Name: maquinas_cambio maquinas_cambio_saliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas_cambio
    ADD CONSTRAINT maquinas_cambio_saliente_fkey FOREIGN KEY (maquina_saliente_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: maquinas maquinas_formato_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_formato_fkey FOREIGN KEY (formato_impresion_id) REFERENCES public.tipos_formato_impresion(id_formato);

--
-- Name: maquinas maquinas_modelo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_modelo_fkey FOREIGN KEY (modelo_id) REFERENCES public.modelos(id_modelo);

--
-- Name: maquinas maquinas_tipo_impresion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_tipo_impresion_fkey FOREIGN KEY (tipo_impresion_id) REFERENCES public.tipos_impresion(id_tipo_impresion);

--
-- Name: notificaciones notificaciones_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_carga(id_lote);

--
-- Name: notificaciones notificaciones_tipo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_tipo_fkey FOREIGN KEY (tipo_notificacion_id) REFERENCES public.tipos_notificacion(id_tipo_notificacion);

--
-- Name: reportes_oficiales reportes_cliente_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_cliente_fk FOREIGN KEY (cliente_id) REFERENCES public.clientes(id_cliente);

--
-- Name: reportes_consolidado_staging reportes_consolidado_staging_cliente_id_tentativo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_consolidado_staging
    ADD CONSTRAINT reportes_consolidado_staging_cliente_id_tentativo_fkey FOREIGN KEY (cliente_id_tentativo) REFERENCES public.clientes(id_cliente);

--
-- Name: reportes_consolidado_staging reportes_consolidado_staging_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_consolidado_staging
    ADD CONSTRAINT reportes_consolidado_staging_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_carga(id_lote);

--
-- Name: reportes_consolidado_staging reportes_consolidado_staging_maquina_id_tentativa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_consolidado_staging
    ADD CONSTRAINT reportes_consolidado_staging_maquina_id_tentativa_fkey FOREIGN KEY (maquina_id_tentativa) REFERENCES public.maquinas(id_maquina);

--
-- Name: reportes_detalle_oficial reportes_detalle_oficial_reporte_oficial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_oficial
    ADD CONSTRAINT reportes_detalle_oficial_reporte_oficial_id_fkey FOREIGN KEY (reporte_oficial_id) REFERENCES public.reportes_oficiales(id_reporte) ON DELETE CASCADE;

--
-- Name: reportes_detalle_oficial reportes_detalle_oficial_usuario_validacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_oficial
    ADD CONSTRAINT reportes_detalle_oficial_usuario_validacion_id_fkey FOREIGN KEY (usuario_validacion_id) REFERENCES public.usuarios(id_usuario);

--
-- Name: reportes_detalle_staging reportes_detalle_staging_consolidado_staging_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_staging
    ADD CONSTRAINT reportes_detalle_staging_consolidado_staging_id_fkey FOREIGN KEY (consolidado_staging_id) REFERENCES public.reportes_consolidado_staging(id_staging_consolidado);

--
-- Name: reportes_detalle_staging reportes_detalle_staging_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_staging
    ADD CONSTRAINT reportes_detalle_staging_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_carga(id_lote);

--
-- Name: reportes_detalle_staging reportes_detalle_staging_maquina_id_tentativa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_detalle_staging
    ADD CONSTRAINT reportes_detalle_staging_maquina_id_tentativa_fkey FOREIGN KEY (maquina_id_tentativa) REFERENCES public.maquinas(id_maquina);

--
-- Name: reportes_oficiales reportes_maquina_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_maquina_fk FOREIGN KEY (maquina_id) REFERENCES public.maquinas(id_maquina);

--
-- Name: reportes_oficiales reportes_oficiales_lote_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_oficiales_lote_origen_id_fkey FOREIGN KEY (lote_origen_id) REFERENCES public.lotes_carga(id_lote);

--
-- Name: reportes_oficiales reportes_oficiales_maquina_cambio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_oficiales_maquina_cambio_fkey FOREIGN KEY (maquina_cambio_id) REFERENCES public.maquinas_cambio(id_maquina_cambio);

--
-- Name: reportes_oficiales reportes_oficiales_usuario_validacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_oficiales
    ADD CONSTRAINT reportes_oficiales_usuario_validacion_id_fkey FOREIGN KEY (usuario_validacion_id) REFERENCES public.usuarios(id_usuario);

--
-- Name: usuarios usuarios_rol_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES public.roles(id_rol);

