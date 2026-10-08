--
-- PostgreSQL database dump (Nexus TV Enterprise)
--

-- \restrict N7aRgQmJSvU2fRyfwksueXlabQfTbOnUnH3iJPKZqOkV2JW6od6dq812aP1RN1V

DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ronald') THEN
      CREATE ROLE ronald WITH LOGIN SUPERUSER;
   END IF;
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tv') THEN
      CREATE ROLE tv WITH LOGIN SUPERUSER;
   END IF;
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nxtv') THEN
      CREATE ROLE nxtv WITH LOGIN SUPERUSER;
   END IF;
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tv_user') THEN
      CREATE ROLE tv_user WITH LOGIN SUPERUSER;
   END IF;
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'francisco') THEN
      CREATE ROLE francisco WITH LOGIN SUPERUSER;
   END IF;
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nx_tv') THEN
      CREATE ROLE nx_tv WITH LOGIN SUPERUSER;
   END IF;
END
$$;

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: nexus_tv; Type: SCHEMA; Schema: -; Owner: ronald
--

CREATE SCHEMA IF NOT EXISTS nexus_tv;

ALTER SCHEMA nexus_tv OWNER TO ronald;
GRANT ALL ON SCHEMA nexus_tv TO tv;
GRANT ALL ON ALL TABLES IN SCHEMA nexus_tv TO tv;
GRANT ALL ON ALL SEQUENCES IN SCHEMA nexus_tv TO tv;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA nexus_tv;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: content; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.content (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    source_url character varying(255) NOT NULL,
    source_type character varying(50) NOT NULL,
    content_type character varying(50) NOT NULL,
    duration_seconds integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT content_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['video'::character varying, 'image'::character varying, 'power_bi'::character varying, 'url'::character varying])::text[]))),
    CONSTRAINT content_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['local_file'::character varying, 'external_url'::character varying])::text[])))
);


ALTER TABLE nexus_tv.content OWNER TO ronald;

--
-- Name: content_id_seq; Type: SEQUENCE; Schema: nexus_tv; Owner: ronald
--

CREATE SEQUENCE nexus_tv.content_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE nexus_tv.content_id_seq OWNER TO ronald;

--
-- Name: content_id_seq; Type: SEQUENCE OWNED BY; Schema: nexus_tv; Owner: ronald
--

ALTER SEQUENCE nexus_tv.content_id_seq OWNED BY nexus_tv.content.id;


--
-- Name: playlist_content; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.playlist_content (
    playlist_id integer NOT NULL,
    content_id integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    days_of_week text[] DEFAULT ARRAY['lunes'::text, 'martes'::text, 'miércoles'::text, 'jueves'::text, 'viernes'::text, 'sábado'::text, 'domingo'::text]
);


ALTER TABLE nexus_tv.playlist_content OWNER TO ronald;

--
-- Name: playlists; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.playlists (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    is_public boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE nexus_tv.playlists OWNER TO ronald;

--
-- Name: playlists_id_seq; Type: SEQUENCE; Schema: nexus_tv; Owner: ronald
--

CREATE SEQUENCE nexus_tv.playlists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE nexus_tv.playlists_id_seq OWNER TO ronald;

--
-- Name: playlists_id_seq; Type: SEQUENCE OWNED BY; Schema: nexus_tv; Owner: ronald
--

ALTER SEQUENCE nexus_tv.playlists_id_seq OWNED BY nexus_tv.playlists.id;


--
-- Name: tv_playlist; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.tv_playlist (
    tv_id integer NOT NULL,
    playlist_id integer NOT NULL,
    is_primary boolean DEFAULT false
);


ALTER TABLE nexus_tv.tv_playlist OWNER TO ronald;

--
-- Name: tv_screens; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.tv_screens (
    id integer NOT NULL,
    tv_uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    location character varying(255),
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE nexus_tv.tv_screens OWNER TO ronald;

--
-- Name: tv_screens_id_seq; Type: SEQUENCE; Schema: nexus_tv; Owner: ronald
--

CREATE SEQUENCE nexus_tv.tv_screens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE nexus_tv.tv_screens_id_seq OWNER TO ronald;

--
-- Name: tv_screens_id_seq; Type: SEQUENCE OWNED BY; Schema: nexus_tv; Owner: ronald
--

ALTER SEQUENCE nexus_tv.tv_screens_id_seq OWNED BY nexus_tv.tv_screens.id;


--
-- Name: users; Type: TABLE; Schema: nexus_tv; Owner: ronald
--

CREATE TABLE nexus_tv.users (
    id integer NOT NULL,
    username character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    email character varying(255),
    role character varying(50) DEFAULT 'editor'::character varying
);


ALTER TABLE nexus_tv.users OWNER TO ronald;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: nexus_tv; Owner: ronald
--

CREATE SEQUENCE nexus_tv.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE nexus_tv.users_id_seq OWNER TO ronald;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: nexus_tv; Owner: ronald
--

ALTER SEQUENCE nexus_tv.users_id_seq OWNED BY nexus_tv.users.id;


--
-- Name: content id; Type: DEFAULT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.content ALTER COLUMN id SET DEFAULT nextval('nexus_tv.content_id_seq'::regclass);


--
-- Name: playlists id; Type: DEFAULT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.playlists ALTER COLUMN id SET DEFAULT nextval('nexus_tv.playlists_id_seq'::regclass);


--
-- Name: tv_screens id; Type: DEFAULT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.tv_screens ALTER COLUMN id SET DEFAULT nextval('nexus_tv.tv_screens_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.users ALTER COLUMN id SET DEFAULT nextval('nexus_tv.users_id_seq'::regclass);


--
-- Data for Name: content; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.content (id, title, description, source_url, source_type, content_type, duration_seconds, created_at) FROM stdin;
58	Panel Podio Operaciones Energia	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9	external_url	power_bi	3600	2025-12-17 12:46:23.126084
59	Panel Supervisor Deiby Quispe	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=c7b5a63ca5716a3a5c32	external_url	power_bi	3600	2025-12-17 12:47:19.308468
60	Panel Supervisor Cesar Chavez	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=87f23baca00b71e1fb53	external_url	power_bi	3600	2025-12-17 12:48:01.147871
61	Panel Supervisor Angel Cordova	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=825082cedcfcfa236fd5	external_url	power_bi	3600	2025-12-17 12:49:04.908443
62	Panel Supervisor Jose Sotomayor	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=dc1928d6879164f0e29a	external_url	power_bi	3600	2025-12-17 12:50:02.777329
176	02_VID_ConocealSuper_deBI_V9.mp4	Contenido Externo	https://youtu.be/cmYvC9cYEbI	external_url	url	3600	2026-06-01 12:06:38.780568
187	02_VID_VesalaChica_DeMarketing_V15.mp4	Contenido Externo	https://youtube.com/shorts/iWRbj3eihWE?feature=share	external_url	url	3600	2026-06-17 08:43:41.139077
21	LO+RANDOM-I		/media/1765484611765-791077771.png	local_file	image	15	2025-12-11 15:23:31.898016
22	DATO-ESPRESS-I		/media/1765484616544-597861316.png	local_file	image	15	2025-12-11 15:23:36.655047
23	MINI-HACKS-II		/media/1765484621629-485611849.png	local_file	image	15	2025-12-11 15:23:41.743081
24	MINI-HACKS-I		/media/1765484628098-975489203.png	local_file	image	15	2025-12-11 15:23:48.215974
25	EQUIPO-9		/media/1765484633481-693280442.png	local_file	image	15	2025-12-11 15:23:53.621169
26	EQUIPO-8		/media/1765484638495-514896367.png	local_file	image	15	2025-12-11 15:23:58.628356
27	EQUIPO-7		/media/1765484642662-339670934.png	local_file	image	15	2025-12-11 15:24:02.777304
28	EQUIPO-6		/media/1765484647518-415770005.png	local_file	image	15	2025-12-11 15:24:07.639287
29	EQUIPO-5		/media/1765484652911-377641972.png	local_file	image	15	2025-12-11 15:24:13.054581
30	EQUIPO-4		/media/1765484657503-814223455.png	local_file	image	15	2025-12-11 15:24:17.639169
31	EQUIPO-3		/media/1765484663237-590201157.png	local_file	image	15	2025-12-11 15:24:23.374319
32	EQUIPO-2		/media/1765484668602-484557528.png	local_file	image	15	2025-12-11 15:24:28.73541
33	EQUIPO-1		/media/1765484674268-492441487.png	local_file	image	15	2025-12-11 15:24:34.392731
34	MINI-HACKS		/media/1765484680898-202842203.png	local_file	image	15	2025-12-11 15:24:41.002943
35	LO+RANDOM		/media/1765484685700-280564236.png	local_file	image	15	2025-12-11 15:24:45.796248
36	COMUNICADO-1		/media/1765484691526-246215678.png	local_file	image	15	2025-12-11 15:24:51.632224
37	WOW DEL DÍA		/media/1765484697290-796708168.png	local_file	image	15	2025-12-11 15:24:57.402394
38	DATO EXPRESS		/media/1765484701656-255876505.png	local_file	image	15	2025-12-11 15:25:01.758679
39	REFERIDOS 2		/media/1765484705512-377642180.png	local_file	image	15	2025-12-11 15:25:05.607189
40	REFERIDOS 1		/media/1765484710324-525966785.png	local_file	image	15	2025-12-11 15:25:10.42024
188	02_VID_VictorCastro_CelebrandoVentas_V16.mp4	Contenido Externo	https://youtube.com/shorts/8GGJBedIN5E?feature=share	external_url	url	3600	2026-06-17 08:45:52.214262
191	02_VID_RubiBazan_EstudiayTrabaja_V19.mp4	Contenido Externo	https://youtube.com/shorts/3iZ1TqVQolQ?feature=share	external_url	url	3600	2026-06-17 08:54:29.291381
198	02_VID_ValoramosTu_Esfuerzo_V23.mp4	Contenido Externo	https://youtube.com/shorts/lAbqYb2yJ5c?feature=share	external_url	url	3600	2026-06-25 14:33:21.986252
206	02_VID_Solucionen_Entreustedes_V24.mp4	Contenido Externo	https://youtube.com/shorts/QlYizuEoGa0?feature=share	external_url	url	3600	2026-07-10 09:08:25.101706
207	VIERNES1007		/media/1783692530817-425443926.jpg	local_file	image	15	2026-07-10 09:08:51.013908
210	02_VID_Cambiode_AnimoTelecom_V27.mp4	Contenido Externo	https://youtube.com/shorts/W20ISDXIxH8	external_url	url	3600	2026-07-10 09:32:43.42988
212	02_VID_TeImaginasTrabajar_hastalas3pm_V29.mp4	Contenido Externo	https://youtube.com/shorts/XrueK9ueL4c	external_url	url	3600	2026-07-10 09:48:10.627246
214	02_VID_SiVives_EnLosOlivos_V31.mp4	Contenido Externo	https://youtube.com/shorts/OIM4J2D5FKA	external_url	url	3600	2026-07-10 11:20:11.342021
215	02_VID_Buscas_Estabilidad_V32.mp4	Contenido Externo	https://youtube.com/shorts/MOyCVqjZNrY	external_url	url	3600	2026-07-10 11:22:34.308954
216	02_VID_UnDíacon_Administración_V33.mp4	Contenido Externo	https://youtube.com/shorts/8ym9ZfRaq7Q	external_url	url	3600	2026-07-10 11:24:58.808014
65	EQUIPO-1		/media/1766239303436-215211316.png	local_file	image	15	2025-12-20 09:01:43.586212
63	Panel Podio Energia	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=5e45f3cb108e57de9368	external_url	power_bi	3600	2025-12-17 12:50:26.220148
218	03_IMG_Comunicado_MarcarSalida_10Julio.jpg		/media/1783712706678-706640844.jpg	local_file	image	15	2026-07-10 14:45:06.778525
226	01_IMG_Flyer_Checklist_Agost04.jpg		/media/1787240450425-510604055.png	local_file	image	15	2026-08-20 10:40:50.65257
64	Panel Podio Alarma	Contenido Externo	https://app.powerbi.com/view?r=eyJrIjoiZTBiMDE4Y2EtMDRmZS00ZDBiLWJhODQtYzcyZGRhZjFiODhiIiwidCI6IjNkZjI1Njk4LTUxZDctNDVhNS1iNGY0LTI4ODNhZTk0OTcyMyIsImMiOjR9&pageName=2594dc73181fb3cfc9c6	external_url	power_bi	3600	2025-12-17 12:50:41.612867
227	01_IMG_Flyer_Agost06.jpg		/media/1787240698075-528024327.png	local_file	image	15	2026-08-20 10:44:58.28469
233	DINAMICA OP MULTICARTERA	Contenido Externo	https://youtube.com/shorts/4ZSMHw9xJtg?feature=share	external_url	url	3600	2026-09-11 08:18:42.343445
235	02_VID_Dinamica_conTI_V1.mp4	Contenido Externo	https://youtube.com/shorts/jpoqDnEkhvo?feature=share	external_url	url	3600	2026-09-11 08:43:44.304229
238	02_VID_Convocatoria_Abierta_V1.mp4	Contenido Externo	https://youtube.com/shorts/n96DiQ3C6tc?feature=share	external_url	url	3600	2026-09-11 08:52:47.919313
239	02_VID_BROMA_CONLAIA_V1.mp4	Contenido Externo	https://youtube.com/shorts/cVm3a88eRlQ?feature=share	external_url	url	3600	2026-09-11 08:56:06.61653
171	02_VID_Storytelling_LuceroGaray_V4.mp4	Contenido Externo	https://youtu.be/t9J0schYl54	external_url	url	3600	2026-06-01 09:41:37.260142
173	02_VID_Coordinadora_Telecom_V6.mp4	Contenido Externo	https://youtu.be/06rtv9fdvGI	external_url	url	3600	2026-06-01 10:08:01.182923
185	02_VID_Leonardo_Acosta_V14.mp4	Contenido Externo	https://youtube.com/shorts/51DBLR39yHw?feature=share	external_url	url	3600	2026-06-17 08:36:21.131004
190	02_VID_Aldair_Chavez_V18.mp4	Contenido Externo	https://youtube.com/shorts/yiusCEpUuYM?feature=share	external_url	url	3600	2026-06-17 08:51:44.143768
192	02_VID_Ronald_DelaCruz_V1.mp4	Contenido Externo	https://youtu.be/5R39AZDuPg4	external_url	url	3600	2026-06-17 09:26:38.293068
196	02_VID_BuenAmbiente_Laboral_V22.mp4	Contenido Externo	https://youtube.com/shorts/MYPUR78iLMo?feature=share	external_url	url	3600	2026-06-23 14:50:46.01995
201	02_VID_UnDiaconlos_ChicosdeBO_V24.mp4	Contenido Externo	https://youtube.com/shorts/JeMEEIEVe7M?feature=share	external_url	url	3600	2026-06-25 15:33:16.308696
208	02_VID_Cuandomedice_Llamameen5min_V25.mp4	Contenido Externo	https://youtube.com/shorts/dDAxmK5l4G8	external_url	url	3600	2026-07-10 09:16:11.319779
209	02_VID_Proceso_deAltaconAdmi_V26.mp4	Contenido Externo	https://youtube.com/shorts/5dI95LPxsCs	external_url	url	3600	2026-07-10 09:20:56.017662
211	02_VID_ElSuperEscuchando_ElSpeechporQuintaVez_V28.mp4	Contenido Externo	https://youtube.com/shorts/4iNk34PxUVQ	external_url	url	3600	2026-07-10 09:38:25.01477
213	02_VID_TeGustariaQue_TuesfuerzoSeRefleje_V30.mp4	Contenido Externo	https://youtube.com/shorts/RhvnyxWjeyk	external_url	url	3600	2026-07-10 11:13:40.85894
217	02_VID_Conoceala_SupervisoradeAdmi_V1.mp4	Contenido Externo	https://youtube.com/shorts/-4TJq41dTLw	external_url	url	3600	2026-07-10 11:44:16.184481
219	01_IMG_InicioDe_Semana_20Junio.jpg		/media/1784554574298-561825712.png	local_file	image	15	2026-07-20 08:36:14.463742
221	02_VID_28de_Julio_V35.mp4	Contenido Externo	https://youtube.com/shorts/lLKyrmqePqE?feature=share	external_url	url	3600	2026-07-29 11:58:05.422308
222	02_VID_MejoresMomentos_FeriaGSI2026_V36.mp4	Contenido Externo	https://youtube.com/shorts/GT67DFFvlQg	external_url	url	3600	2026-07-29 11:59:46.0148
225	03_IMG_Comunicado_Referidos_06Agos.jpg		/media/1786027991015-567379525.png	local_file	image	15	2026-08-06 09:53:11.250805
228	01_IMG_Flyer_Viernes_Agost07.jpg		/media/1787241447486-782108721.png	local_file	image	15	2026-08-20 10:57:27.655414
230	02_VID_ConoceAl_SupervisordeTI_V1.mp4	Contenido Externo	https://youtube.com/shorts/YYuaYmLGs0k?feature=share	external_url	url	3600	2026-08-31 15:44:50.247533
234	02_VID_Ganamos_Comisiones_V1.mp4	Contenido Externo	https://youtube.com/shorts/NkBrD46ZqS0?feature=share	external_url	url	3600	2026-09-11 08:38:44.530115
236	02_VID_ESTÁS BUSCANDO TRABAJO_Y QUIERES EMPEZAR A GENERAR INGRESOS_V1.mp4	Contenido Externo	https://youtube.com/shorts/hTVJ349tb1Q?feature=share	external_url	url	3600	2026-09-11 08:46:32.505185
237	02_VID_Storytelling_TeresaHuacho_V1.mp4	Contenido Externo	https://youtube.com/shorts/y-LW8fnZzcI?feature=share	external_url	url	3600	2026-09-11 08:49:36.867288
\.


--
-- Data for Name: playlist_content; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.playlist_content (playlist_id, content_id, start_time, end_time, days_of_week) FROM stdin;
6	228	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	227	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	226	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	225	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	222	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	221	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	219	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	218	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	233	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	234	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	239	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	238	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	237	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	236	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	235	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	239	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	238	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	237	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	236	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	235	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	234	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	233	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	228	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	227	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	226	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	225	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	222	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	221	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	219	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	218	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	239	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	238	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	237	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	236	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	235	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	234	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	233	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	228	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	227	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	226	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	225	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	222	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	221	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	219	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
6	218	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	239	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	238	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	237	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	236	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	235	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	234	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	233	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	228	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	227	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	226	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	225	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	222	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	221	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	219	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	218	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	239	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	238	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	237	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	236	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	235	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	234	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	233	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	228	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	227	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	226	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	225	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	222	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	221	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	219	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	218	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	239	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	238	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	237	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	236	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	235	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	234	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	233	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	228	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	227	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	226	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	225	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	222	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	221	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	219	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
5	218	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	239	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	238	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	237	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	236	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	235	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	234	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	233	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	228	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	227	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	226	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	225	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	222	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	221	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	219	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	218	06:00:00	08:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	239	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	238	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	237	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	236	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	235	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	234	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	233	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	228	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	227	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	226	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	225	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	222	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	221	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	219	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	218	09:00:00	11:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	239	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	238	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	237	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	236	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	235	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	234	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	233	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	228	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	227	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	226	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	225	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	222	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	221	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	219	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
7	218	12:00:00	15:59:00	{lunes,martes,miércoles,jueves,viernes,sábado,domingo}
\.


--
-- Data for Name: playlists; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.playlists (id, name, is_public, created_at) FROM stdin;
5	ENERGIA	f	2025-12-11 15:31:21.542814
6	ALARMAS	f	2025-12-11 15:32:48.931106
7	TELECOM	f	2025-12-11 15:32:54.798375
\.


--
-- Data for Name: tv_playlist; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.tv_playlist (tv_id, playlist_id, is_primary) FROM stdin;
6	7	t
1	7	t
2	5	t
3	5	t
4	6	t
\.


--
-- Data for Name: tv_screens; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.tv_screens (id, tv_uuid, name, location, is_active, last_login, created_at) FROM stdin;
1	a1b2c3d4-e5f6-7890-1234-567890abcdef	PT101	Piso 1	t	\N	2025-09-09 14:01:28.396964
2	9acf5f8b-142a-46e5-b66f-cb44f0215d08	PT204	Piso 2	t	\N	2025-12-11 10:01:41.092724
3	5ae4ccde-2558-4b16-9f91-5d0d4d54956d	PT205	Piso 2	t	\N	2025-12-11 10:01:41.390077
4	b23b24ba-b1a6-459e-ad5a-4b3aa3946ab9	PT310	Piso 3	t	\N	2025-12-11 10:01:41.398443
5	bbfdf83d-818e-4d8b-98cc-46026630d9d3	PT413	Piso 4	t	\N	2025-12-11 10:01:41.406656
6	bf4ff77d-1bc3-4a0e-bfc3-238ffd0ddd99	PT311	Piso 3 - BO	t	\N	2025-12-11 10:02:14.479336
7	7c818233-2fb5-4436-98d2-127a6426a594	PT4123	Piso 4 - Pruebas	t	\N	2025-12-17 12:33:20.844527
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: nexus_tv; Owner: ronald
--

COPY nexus_tv.users (id, username, password_hash, email, role) FROM stdin;
1	p1_principal	$2a$12$EqTLZopeMQFvwZcIOYn45eMMSxwwxNwKLpAnVxelrnuy9AqGx9z8S	\N	editor
\.


--
-- Name: content_id_seq; Type: SEQUENCE SET; Schema: nexus_tv; Owner: ronald
--

SELECT pg_catalog.setval('nexus_tv.content_id_seq', 239, true);


--
-- Name: playlists_id_seq; Type: SEQUENCE SET; Schema: nexus_tv; Owner: ronald
--

SELECT pg_catalog.setval('nexus_tv.playlists_id_seq', 15, true);


--
-- Name: tv_screens_id_seq; Type: SEQUENCE SET; Schema: nexus_tv; Owner: ronald
--

SELECT pg_catalog.setval('nexus_tv.tv_screens_id_seq', 2, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: nexus_tv; Owner: ronald
--

SELECT pg_catalog.setval('nexus_tv.users_id_seq', 1, true);


--
-- Name: content content_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.content
    ADD CONSTRAINT content_pkey PRIMARY KEY (id);


--
-- Name: playlist_content playlist_content_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.playlist_content
    ADD CONSTRAINT playlist_content_pkey PRIMARY KEY (playlist_id, content_id, start_time, end_time);


--
-- Name: playlists playlists_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.playlists
    ADD CONSTRAINT playlists_pkey PRIMARY KEY (id);


--
-- Name: tv_playlist tv_playlist_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.tv_playlist
    ADD CONSTRAINT tv_playlist_pkey PRIMARY KEY (tv_id, playlist_id);


--
-- Name: tv_screens tv_screens_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.tv_screens
    ADD CONSTRAINT tv_screens_pkey PRIMARY KEY (id);


--
-- Name: tv_screens tv_screens_tv_uuid_key; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.tv_screens
    ADD CONSTRAINT tv_screens_tv_uuid_key UNIQUE (tv_uuid);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: tv_playlist tv_playlist_tv_id_fkey; Type: FK CONSTRAINT; Schema: nexus_tv; Owner: ronald
--

ALTER TABLE ONLY nexus_tv.tv_playlist
    ADD CONSTRAINT tv_playlist_tv_id_fkey FOREIGN KEY (tv_id) REFERENCES nexus_tv.tv_screens(id);


--
-- Name: SCHEMA nexus_tv; Type: ACL; Schema: -; Owner: ronald
--

GRANT USAGE ON SCHEMA nexus_tv TO nxtv;
GRANT USAGE ON SCHEMA nexus_tv TO tv_user;
GRANT USAGE ON SCHEMA nexus_tv TO francisco;
GRANT USAGE ON SCHEMA nexus_tv TO nx_tv;
GRANT USAGE ON SCHEMA nexus_tv TO tv;


--
-- Name: TABLE content; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.content TO tv_user;
GRANT SELECT ON TABLE nexus_tv.content TO nxtv;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.content TO francisco;
GRANT SELECT ON TABLE nexus_tv.content TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.content TO tv;


--
-- Name: SEQUENCE content_id_seq; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,USAGE ON SEQUENCE nexus_tv.content_id_seq TO tv_user;


--
-- Name: TABLE playlist_content; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,UPDATE ON TABLE nexus_tv.playlist_content TO nxtv;
GRANT SELECT,DELETE,UPDATE ON TABLE nexus_tv.playlist_content TO tv_user;
GRANT INSERT ON TABLE nexus_tv.playlist_content TO tv_user WITH GRANT OPTION;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.playlist_content TO francisco;
GRANT SELECT ON TABLE nexus_tv.playlist_content TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.playlist_content TO tv;


--
-- Name: TABLE playlists; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.playlists TO tv_user;
GRANT SELECT ON TABLE nexus_tv.playlists TO nxtv;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.playlists TO francisco;
GRANT SELECT ON TABLE nexus_tv.playlists TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.playlists TO tv;


--
-- Name: SEQUENCE playlists_id_seq; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,USAGE ON SEQUENCE nexus_tv.playlists_id_seq TO tv_user;


--
-- Name: TABLE tv_playlist; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,UPDATE ON TABLE nexus_tv.tv_playlist TO nxtv;
GRANT SELECT,DELETE,UPDATE ON TABLE nexus_tv.tv_playlist TO tv_user;
GRANT INSERT ON TABLE nexus_tv.tv_playlist TO tv_user WITH GRANT OPTION;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.tv_playlist TO francisco;
GRANT SELECT ON TABLE nexus_tv.tv_playlist TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.tv_playlist TO tv;


--
-- Name: TABLE tv_screens; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,UPDATE ON TABLE nexus_tv.tv_screens TO nxtv;
GRANT SELECT,DELETE,UPDATE ON TABLE nexus_tv.tv_screens TO tv_user;
GRANT INSERT ON TABLE nexus_tv.tv_screens TO tv_user WITH GRANT OPTION;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.tv_screens TO francisco;
GRANT SELECT ON TABLE nexus_tv.tv_screens TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.tv_screens TO tv;


--
-- Name: SEQUENCE tv_screens_id_seq; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,USAGE ON SEQUENCE nexus_tv.tv_screens_id_seq TO tv_user;


--
-- Name: TABLE users; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,UPDATE ON TABLE nexus_tv.users TO nxtv;
GRANT SELECT ON TABLE nexus_tv.users TO tv_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE nexus_tv.users TO francisco;
GRANT SELECT ON TABLE nexus_tv.users TO nx_tv;
GRANT SELECT ON TABLE nexus_tv.users TO tv;


--
-- Name: SEQUENCE users_id_seq; Type: ACL; Schema: nexus_tv; Owner: ronald
--

GRANT SELECT,USAGE ON SEQUENCE nexus_tv.users_id_seq TO tv_user;


--
-- PostgreSQL database dump complete
--

-- \unrestrict N7aRgQmJSvU2fRyfwksueXlabQfTbOnUnH3iJPKZqOkV2JW6od6dq812aP1RN1V

