--
-- PostgreSQL database dump
--

\restrict 0tiTck8cjMzx6t3eIwSKJxxjPfkuY4NNdevOQxPfkVJIkO8cc8iRfFqc1SpqINB

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: set_inspection_template_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_inspection_template_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agl; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agl (
    id uuid NOT NULL,
    surface_id uuid NOT NULL,
    agl_type character varying(30) NOT NULL,
    name character varying NOT NULL,
    "position" character varying NOT NULL,
    side character varying(10),
    glide_slope_angle double precision,
    distance_from_threshold double precision,
    offset_from_centerline double precision,
    CONSTRAINT ck_agl_agl_type CHECK (((agl_type)::text = ANY (ARRAY[('PAPI'::character varying)::text, ('RUNWAY_EDGE_LIGHTS'::character varying)::text])))
);


--
-- Name: airfield_surface; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.airfield_surface (
    id uuid NOT NULL,
    airport_id uuid NOT NULL,
    identifier character varying(10) NOT NULL,
    surface_type character varying(20) NOT NULL,
    geometry character varying NOT NULL,
    heading double precision,
    length double precision,
    width double precision,
    threshold_position character varying,
    end_position character varying,
    boundary character varying,
    buffer_distance double precision DEFAULT '5'::double precision NOT NULL,
    touchpoint_latitude double precision,
    touchpoint_longitude double precision,
    touchpoint_altitude double precision,
    paired_surface_id uuid,
    CONSTRAINT ck_airfield_surface_type CHECK (((surface_type)::text = ANY (ARRAY[('RUNWAY'::character varying)::text, ('TAXIWAY'::character varying)::text])))
);


--
-- Name: airport; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.airport (
    id uuid NOT NULL,
    icao_code character varying(4) NOT NULL,
    name character varying NOT NULL,
    elevation double precision NOT NULL,
    location character varying NOT NULL,
    city character varying(100),
    country character varying(100),
    default_drone_profile_id uuid,
    terrain_source character varying(20) DEFAULT 'FLAT'::character varying NOT NULL,
    dem_file_path character varying,
    organization_id uuid,
    CONSTRAINT ck_airport_terrain_source CHECK (((terrain_source)::text = ANY (ARRAY[('FLAT'::character varying)::text, ('DEM_UPLOAD'::character varying)::text, ('DEM_API'::character varying)::text])))
);


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(64) NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    user_email character varying,
    action character varying(30) NOT NULL,
    entity_type character varying(50),
    entity_id uuid,
    entity_name character varying,
    details jsonb,
    ip_address character varying(45),
    airport_id uuid
);


--
-- Name: camera_preset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camera_preset (
    id uuid NOT NULL,
    name character varying NOT NULL,
    drone_profile_id uuid,
    created_by uuid,
    is_default boolean DEFAULT false NOT NULL,
    white_balance character varying(20),
    iso integer,
    shutter_speed character varying(20),
    focus_mode character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: constraint_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.constraint_rule (
    id uuid NOT NULL,
    name character varying NOT NULL,
    constraint_type character varying(30) NOT NULL,
    is_hard_constraint boolean NOT NULL,
    min_altitude double precision,
    max_altitude double precision,
    max_horizontal_speed double precision,
    max_vertical_speed double precision,
    max_flight_time double precision,
    reserve_margin double precision,
    lateral_buffer double precision,
    longitudinal_buffer double precision,
    boundary character varying,
    mission_id uuid NOT NULL
);


--
-- Name: drone_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drone_profile (
    id uuid NOT NULL,
    name character varying NOT NULL,
    manufacturer character varying,
    model character varying,
    max_speed double precision,
    max_climb_rate double precision,
    max_altitude double precision,
    battery_capacity double precision,
    endurance_minutes double precision,
    camera_resolution character varying,
    camera_frame_rate integer,
    sensor_fov double precision,
    weight double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    model_identifier character varying,
    max_optical_zoom double precision,
    sensor_base_focal_length double precision,
    default_optical_zoom double precision DEFAULT '1'::double precision,
    supports_geozone_upload boolean DEFAULT false NOT NULL
);


--
-- Name: elevation_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.elevation_cache (
    lat_round_5dp double precision NOT NULL,
    lon_round_5dp double precision NOT NULL,
    elevation_m double precision NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(32) DEFAULT 'API_FALLBACK'::character varying NOT NULL
);


--
-- Name: export_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_result (
    id uuid NOT NULL,
    flight_plan_id uuid NOT NULL,
    file_name character varying NOT NULL,
    format character varying(10) NOT NULL,
    file_path character varying NOT NULL,
    exported_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_export_format CHECK (((format)::text = ANY (ARRAY[('MAVLINK'::character varying)::text, ('KML'::character varying)::text, ('KMZ'::character varying)::text, ('JSON'::character varying)::text, ('UGCS'::character varying)::text, ('WPML'::character varying)::text, ('CSV'::character varying)::text, ('GPX'::character varying)::text, ('LITCHI'::character varying)::text, ('DRONEDEPLOY'::character varying)::text])))
);


--
-- Name: flight_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_plan (
    id uuid NOT NULL,
    mission_id uuid NOT NULL,
    airport_id uuid NOT NULL,
    total_distance double precision,
    estimated_duration double precision,
    is_validated boolean NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: insp_template_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insp_template_methods (
    template_id uuid NOT NULL,
    method character varying(30) NOT NULL
);


--
-- Name: insp_template_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insp_template_targets (
    template_id uuid NOT NULL,
    agl_id uuid NOT NULL
);


--
-- Name: inspection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection (
    id uuid NOT NULL,
    mission_id uuid NOT NULL,
    template_id uuid NOT NULL,
    config_id uuid,
    method character varying(30) NOT NULL,
    sequence_order integer NOT NULL
);


--
-- Name: inspection_configuration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_configuration (
    id uuid NOT NULL,
    altitude_offset double precision,
    measurement_density integer,
    custom_tolerances jsonb,
    density double precision,
    hover_duration double precision,
    horizontal_distance double precision,
    sweep_angle double precision,
    lha_ids jsonb,
    capture_mode character varying(20),
    recording_setup_duration double precision,
    buffer_distance double precision,
    height_above_lights double precision,
    lateral_offset double precision,
    distance_from_lha double precision,
    height_above_lha double precision,
    camera_gimbal_angle double precision,
    selected_lha_id uuid,
    hover_bearing double precision,
    hover_bearing_reference character varying(10),
    measurement_speed_override double precision,
    white_balance character varying(20),
    iso integer,
    shutter_speed character varying(20),
    focus_mode character varying(20),
    optical_zoom double precision,
    angle_offset_above double precision,
    camera_preset_id uuid,
    camera_mode character varying(10),
    lha_setting_angle_override_id uuid,
    direction character varying(10),
    resolved_direction character varying(10),
    lha_selection_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    angle_offset_below double precision,
    angle_source character varying(10),
    angle_start double precision,
    angle_end double precision
);


--
-- Name: inspection_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_template (
    id uuid NOT NULL,
    name character varying NOT NULL,
    description character varying,
    default_config_id uuid,
    angular_tolerances jsonb,
    created_by character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: lha; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lha (
    id uuid NOT NULL,
    agl_id uuid NOT NULL,
    setting_angle double precision,
    transition_sector_width double precision,
    lamp_type character varying(10) NOT NULL,
    "position" character varying NOT NULL,
    tolerance double precision,
    unit_designator character varying(4) NOT NULL,
    sequence_number integer NOT NULL,
    CONSTRAINT ck_lha_lamp_type CHECK (((lamp_type)::text = ANY (ARRAY[('HALOGEN'::character varying)::text, ('LED'::character varying)::text]))),
    CONSTRAINT ck_lha_sequence_positive CHECK ((sequence_number > 0)),
    CONSTRAINT ck_lha_unit_designator CHECK ((length((unit_designator)::text) > 0))
);


--
-- Name: mission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mission (
    id uuid NOT NULL,
    name character varying NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operator_notes character varying,
    drone_profile_id uuid,
    date_time timestamp with time zone,
    default_speed double precision,
    default_altitude_offset double precision,
    takeoff_coordinate character varying,
    landing_coordinate character varying,
    airport_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_unsaved_map_changes boolean DEFAULT false NOT NULL,
    default_capture_mode character varying(20) DEFAULT 'VIDEO_CAPTURE'::character varying,
    default_buffer_distance double precision,
    transit_agl double precision,
    require_perpendicular_runway_crossing boolean DEFAULT true NOT NULL,
    measurement_speed_override double precision,
    flight_plan_scope character varying(25) DEFAULT 'FULL'::character varying NOT NULL,
    computation_status character varying(20) DEFAULT 'IDLE'::character varying NOT NULL,
    computation_error character varying,
    computation_started_at timestamp with time zone,
    default_white_balance character varying(20),
    default_iso integer,
    default_shutter_speed character varying(20),
    default_focus_mode character varying(20),
    camera_mode character varying(10) DEFAULT 'AUTO'::character varying NOT NULL,
    direction character varying(10) DEFAULT 'AUTO'::character varying NOT NULL,
    dji_heading_mode character varying(20) DEFAULT 'smoothTransition'::character varying,
    keep_inside_airport_boundary boolean DEFAULT true NOT NULL,
    CONSTRAINT ck_mission_computation_status CHECK (((computation_status)::text = ANY (ARRAY[('IDLE'::character varying)::text, ('COMPUTING'::character varying)::text, ('COMPLETED'::character varying)::text, ('FAILED'::character varying)::text]))),
    CONSTRAINT ck_mission_direction CHECK (((direction)::text = ANY (ARRAY[('AUTO'::character varying)::text, ('NATURAL'::character varying)::text, ('REVERSED'::character varying)::text]))),
    CONSTRAINT ck_mission_dji_heading_mode CHECK (((dji_heading_mode)::text = ANY (ARRAY[('smoothTransition'::character varying)::text, ('towardPOI'::character varying)::text, ('followWayline'::character varying)::text]))),
    CONSTRAINT ck_mission_flight_plan_scope CHECK (((flight_plan_scope)::text = ANY (ARRAY[('FULL'::character varying)::text, ('NO_TAKEOFF_LANDING'::character varying)::text, ('MEASUREMENTS_ONLY'::character varying)::text]))),
    CONSTRAINT ck_mission_status CHECK (((status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('PLANNED'::character varying)::text, ('VALIDATED'::character varying)::text, ('EXPORTED'::character varying)::text, ('COMPLETED'::character varying)::text, ('CANCELLED'::character varying)::text])))
);


--
-- Name: obstacle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obstacle (
    id uuid NOT NULL,
    airport_id uuid NOT NULL,
    name character varying NOT NULL,
    "position" character varying NOT NULL,
    height double precision NOT NULL,
    radius double precision NOT NULL,
    geometry character varying NOT NULL,
    type character varying(20) NOT NULL,
    buffer_distance double precision DEFAULT '5'::double precision NOT NULL,
    CONSTRAINT ck_obstacle_type CHECK (((type)::text = ANY (ARRAY[('BUILDING'::character varying)::text, ('TOWER'::character varying)::text, ('ANTENNA'::character varying)::text, ('VEGETATION'::character varying)::text, ('OTHER'::character varying)::text])))
);


--
-- Name: safety_zone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_zone (
    id uuid NOT NULL,
    airport_id uuid NOT NULL,
    name character varying NOT NULL,
    type character varying(30) NOT NULL,
    geometry character varying NOT NULL,
    altitude_floor double precision,
    altitude_ceiling double precision,
    is_active boolean NOT NULL,
    CONSTRAINT ck_safety_zone_type CHECK (((type)::text = ANY (ARRAY[('CTR'::character varying)::text, ('RESTRICTED'::character varying)::text, ('PROHIBITED'::character varying)::text, ('TEMPORARY_NO_FLY'::character varying)::text, ('AIRPORT_BOUNDARY'::character varying)::text])))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid NOT NULL,
    key character varying(100) NOT NULL,
    value character varying,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: user_airports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_airports (
    user_id uuid NOT NULL,
    airport_id uuid NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying NOT NULL,
    hashed_password character varying,
    name character varying NOT NULL,
    role character varying(20) DEFAULT 'OPERATOR'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    invitation_token character varying,
    invitation_expires_at timestamp with time zone,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    CONSTRAINT ck_users_role_valid CHECK (((role)::text = ANY (ARRAY[('OPERATOR'::character varying)::text, ('COORDINATOR'::character varying)::text, ('SUPER_ADMIN'::character varying)::text])))
);


--
-- Name: validation_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_result (
    id uuid NOT NULL,
    flight_plan_id uuid NOT NULL,
    passed boolean NOT NULL,
    validated_at timestamp with time zone DEFAULT now()
);


--
-- Name: validation_violation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_violation (
    id uuid NOT NULL,
    validation_result_id uuid NOT NULL,
    constraint_id uuid,
    message character varying NOT NULL,
    category character varying NOT NULL,
    waypoint_ids jsonb,
    violation_kind character varying,
    CONSTRAINT ck_validation_violation_category CHECK (((category)::text = ANY (ARRAY[('violation'::character varying)::text, ('warning'::character varying)::text, ('suggestion'::character varying)::text])))
);


--
-- Name: waypoint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waypoint (
    id uuid NOT NULL,
    flight_plan_id uuid NOT NULL,
    inspection_id uuid,
    sequence_order integer NOT NULL,
    "position" character varying NOT NULL,
    heading double precision,
    speed double precision,
    hover_duration double precision,
    camera_action character varying(20),
    waypoint_type character varying(20) NOT NULL,
    camera_target character varying,
    gimbal_pitch double precision,
    agl double precision,
    camera_target_agl double precision,
    CONSTRAINT ck_waypoint_camera_action CHECK (((camera_action)::text = ANY (ARRAY[('NONE'::character varying)::text, ('PHOTO_CAPTURE'::character varying)::text, ('RECORDING_START'::character varying)::text, ('RECORDING'::character varying)::text, ('RECORDING_STOP'::character varying)::text]))),
    CONSTRAINT ck_waypoint_type CHECK (((waypoint_type)::text = ANY (ARRAY[('TAKEOFF'::character varying)::text, ('TRANSIT'::character varying)::text, ('MEASUREMENT'::character varying)::text, ('HOVER'::character varying)::text, ('LANDING'::character varying)::text])))
);


--
-- Data for Name: agl; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agl (id, surface_id, agl_type, name, "position", side, glide_slope_angle, distance_from_threshold, offset_from_centerline) FROM stdin;
142c30ad-5ec6-4314-84a5-8ae0598afdac	e74fa066-0e1b-4f8e-82e7-3f418220a187	RUNWAY_EDGE_LIGHTS	REL RWY 04	POINT Z (17.226222318210347 48.1798107661692 133)	RIGHT	\N	-0.1726604575764413	\N
3304cf62-461b-4825-8755-058460b0b5d4	e74fa066-0e1b-4f8e-82e7-3f418220a187	PAPI	PAPI RWY 04	POINT Z (17.22323615854279 48.17659275123299 133)	LEFT	3	411.2915906500196	\N
c006eada-24db-4992-bab1-2bc19bc2840b	e74fa066-0e1b-4f8e-82e7-3f418220a187	RUNWAY_EDGE_LIGHTS	REL RWY 04	POINT Z (17.226789987025086 48.17944222953858 133)	LEFT	\N	0.23737967279197095	\N
f8a24463-d3c4-43d8-8810-821e209d58a6	2d4c5266-8ebb-448f-861e-eeecab4bb36c	PAPI	PAPI RWY 31	POINT Z (17.227756332612245 48.1597571448325 133)	LEFT	3	684.7163923520844	\N
0873543c-1ce6-4c4c-a9dd-ba672ceefc70	d9a221bc-b496-408d-9563-607e7feb372c	RUNWAY_EDGE_LIGHTS	REL 19	POINT Z (21.24496761111111 48.67393386111111 230)	\N	\N	306.6302986234492	\N
31dc51ab-da79-4014-86ef-400d22208efa	1f4b892e-9df7-4efd-b4ec-31214a9db339	PAPI	PAPI 01	POINT Z (21.23666795486111 48.65222887152778 230)	LEFT	3	306.11432610466704	\N
408ae31c-5e83-44c8-93b0-0e376687d064	d9a221bc-b496-408d-9563-607e7feb372c	PAPI	PAPI 19	POINT Z (21.24564124652778 48.673833944444446 230)	LEFT	3	306.33939470182344	\N
6a32f42a-3903-4b60-b05d-b890b15f7b66	1f4b892e-9df7-4efd-b4ec-31214a9db339	RUNWAY_EDGE_LIGHTS	REL 01	POINT Z (21.237343916666667 48.65213883333333 230)	\N	\N	307.51325311473073	\N
61b9d72c-7502-4de2-ad0d-8be68c9a6f77	4067793b-fea1-4a4d-9961-9ff056f68a07	RUNWAY_EDGE_LIGHTS	REL 19	POINT Z (17.830922527777776 48.63152813888889 166)	\N	\N	265.27308750901994	\N
71ab1914-9aa0-4be7-9053-3ad80c8ec722	4067793b-fea1-4a4d-9961-9ff056f68a07	PAPI	PAPI 19	POINT Z (17.831533722222222 48.63153948611111 166)	LEFT	3	253.46971873607475	\N
91f12f2a-5933-49f6-ab8f-e4d55aeb67c9	75e76e26-84ed-4a30-9394-b0ab2d3f9a78	PAPI	PAPI 01	POINT Z (17.8256220625 48.61869374652778 166)	LEFT	3	253.17165601131683	\N
bdd5af77-d805-49ac-87da-67accb871e26	75e76e26-84ed-4a30-9394-b0ab2d3f9a78	RUNWAY_EDGE_LIGHTS	REL 01	POINT Z (17.826194583333333 48.618602805555554 166)	\N	\N	253.251203667261	\N
\.


--
-- Data for Name: airfield_surface; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.airfield_surface (id, airport_id, identifier, surface_type, geometry, heading, length, width, threshold_position, end_position, boundary, buffer_distance, touchpoint_latitude, touchpoint_longitude, touchpoint_altitude, paired_surface_id) FROM stdin;
2d4c5266-8ebb-448f-861e-eeecab4bb36c	b758c988-083f-469e-ab55-efe5f7b1306a	31	RUNWAY	LINESTRING Z (17.234861742499817 48.15579797288255 133,17.20398786232603 48.175723300722055 133)	314.068571499321	3186.189900866588	59.51654938750653	POINT Z (17.23486 48.155799 133)	POINT Z (17.203989 48.175722 133)	POLYGON Z ((17.234630190068373 48.15564803893591 133,17.203713264041056 48.175528111786775 133,17.204262460611005 48.175918489657334 133,17.23509329493126 48.1559479068292 133,17.234630190068373 48.15564803893591 133))	5	48.160139	17.228127	133	10b2ddff-2f73-41b3-a061-e5224c402060
d9a221bc-b496-408d-9563-607e7feb372c	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	19	RUNWAY	LINESTRING Z (21.24589865237205 48.67662215523404 230,21.23641054795428 48.64944040743188 230)	192.98627390290972	3101.759954877726	62.28471766926077	POINT Z (21.245899 48.676622 230)	POINT Z (21.23641 48.649443 230)	POLYGON Z ((21.24630278997583 48.67655488077568 230,21.23682607308109 48.64938415279312 230,21.235995022827467 48.649496662070646 230,21.245494514768268 48.6766894296924 230,21.24630278997583 48.67655488077568 230))	5	48.673936	21.244961	230	1f4b892e-9df7-4efd-b4ec-31214a9db339
4067793b-fea1-4a4d-9961-9ff056f68a07	8d544a9c-c9b5-4ea6-a2c5-49043094000a	19	RUNWAY	LINESTRING Z (17.831777216054547 48.63384662384907 166,17.82537841284099 48.616388573390864 166)	189	2000	30	POINT Z (17.831777 48.633846 166)	POINT Z (17.825379 48.61639 166)	POLYGON Z ((17.83197859467532 48.633816587346104 166,17.825580146889195 48.61635592175651 166,17.825176678792786 48.61642122502522 166,17.831575837433775 48.63387666035203 166,17.83197859467532 48.633816587346104 166))	5	48.631528	17.830922	166	75e76e26-84ed-4a30-9394-b0ab2d3f9a78
75e76e26-84ed-4a30-9394-b0ab2d3f9a78	8d544a9c-c9b5-4ea6-a2c5-49043094000a	01	RUNWAY	LINESTRING Z (17.82537841284099 48.616388573390864 166,17.831777216054547 48.63384662384907 166)	9	2000	30	POINT Z (17.825379 48.61639 166)	POINT Z (17.831777 48.633846 166)	POLYGON Z ((17.83197859467532 48.633816587346104 166,17.825580146889195 48.61635592175651 166,17.825176678792786 48.61642122502522 166,17.831575837433775 48.63387666035203 166,17.83197859467532 48.633816587346104 166))	5	48.618602	17.826194	166	4067793b-fea1-4a4d-9961-9ff056f68a07
2489c38c-4794-4d42-8f34-5ac7e75b7ebd	b758c988-083f-469e-ab55-efe5f7b1306a	22	RUNWAY	LINESTRING Z (17.226506152617716 48.17962649785389 133,17.199343988198663 48.16075275040478 133)	43.83432786469234	2909.075086912259	62.63412671109313	POINT Z (17.199344 48.160753 133)	POINT Z (17.226506 48.179627 133)	POLYGON Z ((17.19906381437238 48.160936933325104 133,17.226222318210347 48.1798107661692 133,17.226789987025086 48.17944222953858 133,17.199624162024946 48.16056856748446 133,17.19906381437238 48.160936933325104 133))	5	\N	\N	\N	e74fa066-0e1b-4f8e-82e7-3f418220a187
e74fa066-0e1b-4f8e-82e7-3f418220a187	b758c988-083f-469e-ab55-efe5f7b1306a	04	RUNWAY	LINESTRING Z (17.199343988198663 48.16075275040478 133,17.226506152617716 48.17962649785389 133)	223.83432786469234	2909.075086912259	62.63412671109313	POINT Z (17.226506 48.179627 133)	POINT Z (17.199344 48.160753 133)	POLYGON Z ((17.19906381437238 48.160936933325104 133,17.226222318210347 48.1798107661692 133,17.226789987025086 48.17944222953858 133,17.199624162024946 48.16056856748446 133,17.19906381437238 48.160936933325104 133))	5	48.176936	17.222636	133	2489c38c-4794-4d42-8f34-5ac7e75b7ebd
10b2ddff-2f73-41b3-a061-e5224c402060	b758c988-083f-469e-ab55-efe5f7b1306a	13	RUNWAY	LINESTRING Z (17.20398786232603 48.175723300722055 133,17.234861742499817 48.15579797288255 133)	134.06857149932102	3186.189900866588	59.51654938750653	POINT Z (17.203989 48.175722 133)	POINT Z (17.23486 48.155799 133)	POLYGON Z ((17.234630190068373 48.15564803893591 133,17.203713264041056 48.175528111786775 133,17.204262460611005 48.175918489657334 133,17.23509329493126 48.1559479068292 133,17.234630190068373 48.15564803893591 133))	5	\N	\N	\N	2d4c5266-8ebb-448f-861e-eeecab4bb36c
1f4b892e-9df7-4efd-b4ec-31214a9db339	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	01	RUNWAY	LINESTRING Z (21.23641054795428 48.64944040743188 230,21.24589865237205 48.67662215523404 230)	12.986273902909716	3101.759954877726	62.28471766926077	POINT Z (21.23641 48.649443 230)	POINT Z (21.245899 48.676622 230)	POLYGON Z ((21.24630278997583 48.67655488077568 230,21.23682607308109 48.64938415279312 230,21.235995022827467 48.649496662070646 230,21.245494514768268 48.6766894296924 230,21.24630278997583 48.67655488077568 230))	5	48.652139	21.237344	230	d9a221bc-b496-408d-9563-607e7feb372c
\.


--
-- Data for Name: airport; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.airport (id, icao_code, name, elevation, location, city, country, default_drone_profile_id, terrain_source, dem_file_path, organization_id) FROM stdin;
b758c988-083f-469e-ab55-efe5f7b1306a	LZIB	BRATISLAVA - M. R. STEFANIK	133	POINT Z (17.212778 48.17 133)	Bratislava	SK	ea3611e3-8d0d-4b6d-bff7-bc094a1f6b5d	FLAT	\N	\N
bda0641e-81a4-4fc4-8918-ba7cc6a436a3	LZKZ	KOSICE	230	POINT Z (21.241111 48.663056 230)	Košice	SK	\N	FLAT	\N	\N
8d544a9c-c9b5-4ea6-a2c5-49043094000a	LZPP	PIESTANY	166	POINT Z (17.828611 48.625 166)	Piešťany	SK	\N	FLAT	\N	\N
\.


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alembic_version (version_num) FROM stdin;
0007_validation_violation_kind
\.


--
-- Data for Name: camera_preset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.camera_preset (id, name, drone_profile_id, created_by, is_default, white_balance, iso, shutter_speed, focus_mode, created_at, updated_at) FROM stdin;
e6667107-309a-4811-9899-eed77a1bd08d	Night Mode	ea3611e3-8d0d-4b6d-bff7-bc094a1f6b5d	209d784d-2435-458f-94bc-2e9b70be3c18	t	MANUAL_4000K	100	1/60	\N	2026-04-20 22:01:36.187242+00	2026-04-20 22:01:36.187242+00
\.


--
-- Data for Name: constraint_rule; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.constraint_rule (id, name, constraint_type, is_hard_constraint, min_altitude, max_altitude, max_horizontal_speed, max_vertical_speed, max_flight_time, reserve_margin, lateral_buffer, longitudinal_buffer, boundary, mission_id) FROM stdin;
\.


--
-- Data for Name: drone_profile; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drone_profile (id, name, manufacturer, model, max_speed, max_climb_rate, max_altitude, battery_capacity, endurance_minutes, camera_resolution, camera_frame_rate, sensor_fov, weight, created_at, updated_at, model_identifier, max_optical_zoom, sensor_base_focal_length, default_optical_zoom, supports_geozone_upload) FROM stdin;
9f2e9827-6ce2-46c1-b1b0-e88ff47ce040	DJI Matrice 350 RTK	DJI	Matrice 350 RTK	23	6	500	5880	55	48MP	30	84	6.47	2026-04-17 20:30:55.07629+00	2026-05-06 00:39:02.799894+00	dji_matrice_350	7	\N	1	t
81ac9684-f8f7-4711-ae39-46eba01d1f9b	Holybro X500 V2 (ArduPilot)	Holybro	X500 V2	20	5	500	5200	25	20MP	30	84	1.85	2026-05-06 00:39:02.799894+00	2026-05-06 00:39:02.799894+00	holybro_x500	\N	\N	1	t
19b18b52-5ce9-410c-8f70-481b89d5beb1	Skydio X10	Skydio	X10	18	8	400	5500	40	48MP	60	63	2.2	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:15.246904+00	skydio_x10	\N	\N	1	f
5824bbb3-9e2f-40f4-a5eb-b7e5bbf7bd53	Autel EVO II Pro V3	Autel Robotics	EVO II Pro V3	20	8	500	7100	42	20MP	30	82	1.25	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:15.246904+00	autel_evo_ii	\N	\N	1	f
6a43aca2-945b-4535-9445-9e9a4b319dc9	senseFly eBee X	senseFly	eBee X	40	4	500	4000	90	24MP	1	73	1.6	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:15.246904+00	sensefly_ebee_x	\N	\N	1	f
c2ddb75a-2c89-4aa9-a1ac-b775fa59f984	DJI Mavic 3 Enterprise	DJI	Mavic 3 Enterprise	21	8	500	5000	45	20MP	30	84	0.92	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:15.246904+00	dji_mavic_3	\N	\N	1	f
e5bb40a8-90f0-4dea-a9f7-5b621ed9a0f3	DJI Mavic 2 Pro	DJI	Mavic 2 Pro	20	5	500	3850	31	20MP	30	77	0.907	2026-04-18 07:12:02.048838+00	2026-04-20 23:41:15.246904+00	dji_mavic_2	\N	\N	1	f
fa0e20c7-4e13-42bd-82b7-3f419a455a81	Freefly Astro	Freefly Systems	Astro	18	5	400	10000	32	61MP	30	75	5.9	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:15.246904+00	freefly_astro	\N	\N	1	f
d7952227-4526-4bad-a6c0-96c5b05f9fe5	DJI Matrice 300 RTK	DJI	Matrice 300 RTK	23	6	500	5935	55	20MP	30	84	6.3	2026-04-17 20:30:55.07629+00	2026-04-20 23:41:52.245354+00	dji_matrice_350	\N	\N	1	f
ea3611e3-8d0d-4b6d-bff7-bc094a1f6b5d	DJI Matrice 4T	DJI	Matrice 4T	23	8	500	6000	38	48MP	30	84	1.49	2026-04-17 20:42:45.212769+00	2026-04-29 10:59:26.144624+00	dji_matrice_300	7	24	1	f
\.


--
-- Data for Name: insp_template_methods; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insp_template_methods (template_id, method) FROM stdin;
6765d789-57d7-42ba-a1de-21576336a806	VERTICAL_PROFILE
7d3c54e5-cbe0-47f6-a310-5f800dcbbb98	VERTICAL_PROFILE
f53ace8d-3af6-4b9b-b4dd-e2cbb9276d0e	VERTICAL_PROFILE
8841b152-6bde-4c25-be3b-f956528ab1df	VERTICAL_PROFILE
a2a50b3a-795f-4cbb-99d5-0512397f4984	VERTICAL_PROFILE
962a0631-ef42-4be9-9cf5-60538629f365	HOVER_POINT_LOCK
e4084b04-a763-4b9e-beb2-4f78cf69eb36	FLY_OVER
01703a45-ce9f-4345-9ce4-bc0fd20fbe49	FLY_OVER
fe525cc0-a1ea-4b8b-96be-8112daf27e40	PARALLEL_SIDE_SWEEP
ff16fc9d-c73c-4d7f-ab37-7369c8d674f4	PARALLEL_SIDE_SWEEP
8122cc22-2da7-4f07-8ae3-f15e660e9494	VERTICAL_PROFILE
e7a4bd00-3f09-4add-8639-de15c8c5aa49	HORIZONTAL_RANGE
b810f6db-ea91-4c7c-a0be-7a9e79e92b37	HORIZONTAL_RANGE
46db5415-5531-4ec3-ad8c-f9fa9c35727c	HORIZONTAL_RANGE
b305ec9d-3e54-4a14-8a9e-3c142090cfaf	HORIZONTAL_RANGE
335ea795-dff1-4d8c-86f1-edc5e7259431	HORIZONTAL_RANGE
6278dd5a-6f29-46b1-bf76-d2c81f04c62e	MEHT_CHECK
6b7797c1-83e5-4622-921a-baaeba597ad0	MEHT_CHECK
3490b122-cbe7-4b1e-b99a-d06ef8dba5a3	HORIZONTAL_RANGE
dee5a3cf-878a-4ba9-afb5-d40359cb0d93	VERTICAL_PROFILE
c449b182-54ca-47c4-b9bf-3fd955c6aa05	HORIZONTAL_RANGE
d6a0c810-edb3-43f1-9aa0-e09b31a49e47	MEHT_CHECK
\.


--
-- Data for Name: insp_template_targets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insp_template_targets (template_id, agl_id) FROM stdin;
8841b152-6bde-4c25-be3b-f956528ab1df	3304cf62-461b-4825-8755-058460b0b5d4
a2a50b3a-795f-4cbb-99d5-0512397f4984	f8a24463-d3c4-43d8-8810-821e209d58a6
3490b122-cbe7-4b1e-b99a-d06ef8dba5a3	3304cf62-461b-4825-8755-058460b0b5d4
b305ec9d-3e54-4a14-8a9e-3c142090cfaf	f8a24463-d3c4-43d8-8810-821e209d58a6
e4084b04-a763-4b9e-beb2-4f78cf69eb36	c006eada-24db-4992-bab1-2bc19bc2840b
01703a45-ce9f-4345-9ce4-bc0fd20fbe49	142c30ad-5ec6-4314-84a5-8ae0598afdac
fe525cc0-a1ea-4b8b-96be-8112daf27e40	c006eada-24db-4992-bab1-2bc19bc2840b
ff16fc9d-c73c-4d7f-ab37-7369c8d674f4	142c30ad-5ec6-4314-84a5-8ae0598afdac
6278dd5a-6f29-46b1-bf76-d2c81f04c62e	3304cf62-461b-4825-8755-058460b0b5d4
6b7797c1-83e5-4622-921a-baaeba597ad0	f8a24463-d3c4-43d8-8810-821e209d58a6
\.


--
-- Data for Name: inspection_configuration; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inspection_configuration (id, altitude_offset, measurement_density, custom_tolerances, density, hover_duration, horizontal_distance, sweep_angle, lha_ids, capture_mode, recording_setup_duration, buffer_distance, height_above_lights, lateral_offset, distance_from_lha, height_above_lha, camera_gimbal_angle, selected_lha_id, hover_bearing, hover_bearing_reference, measurement_speed_override, white_balance, iso, shutter_speed, focus_mode, optical_zoom, angle_offset_above, camera_preset_id, camera_mode, lha_setting_angle_override_id, direction, resolved_direction, lha_selection_rules, angle_offset_below, angle_source, angle_start, angle_end) FROM stdin;
6e7ad378-3ed7-4cdd-b336-eed6ca2ffe9b	1	5	\N	\N	\N	20	\N	["7f2ea054-9f6e-4679-8b27-be5bfbc7c466", "f8d9748e-48bd-41dc-840d-ee85c9c43b88", "6b927e33-f8b6-4766-8b23-0d6f5337140e", "fd592c01-f797-4f0e-992d-151f1e3eba5c"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	20	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
7a1e3b24-4de5-4e6a-8149-f80703bc203b	\N	\N	\N	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
2647ce89-0101-4bb1-ba84-13baa8a8f819	\N	\N	\N	\N	\N	\N	\N	["87bdad15-1384-4be1-9b1e-8a104a1acdae", "14768049-96a9-417b-8e6b-368e613a3ab8", "9bd12136-03aa-414e-a116-565740d94539", "4b71afe4-e854-4f12-92f6-f2066182b4bf", "54af6c8e-f455-42a2-811d-40a90ca3ec20", "dc1a93b4-f4a5-4e16-9b17-36ada5fcf4d3", "8c50274f-a650-48f1-8416-a80d7a0d7533", "7c5836f0-6a75-4fc7-b871-a65162e0844f", "611500bb-09e4-40fd-8878-067a26952c44", "b399733d-84ec-42cb-bcfc-be368f0b1e3e", "6c1a2f7c-f8dd-4812-86bd-44406116fd97", "94918670-4a96-4233-b017-b14570c607cd", "47a6d2a6-f305-4f6d-af11-ef4bd88d6a07", "3e6e0845-d5d9-4d7f-9d9c-a6d5132e8d46", "85ec5862-c9f3-458a-a924-8537f1d91d82", "4119297a-e92b-49c1-8b52-5a9220cd0b27", "260a6461-5933-44ba-90bb-eb2e29cb8500", "a44b17d8-7e85-4617-862f-c038d014d3f6", "d95b45e9-dcf4-4893-95c5-c5fe58431220", "8b954cbd-791a-4f9a-bad0-04a9cfec55b1", "42252e46-0c93-4d37-b8d0-8f10e7ae7c4e", "e5fea057-15b9-40aa-bb91-91c6b70393c2", "4dc5c42e-c60b-40dd-bb42-256ca56f4390", "d949bac3-74d5-4202-b445-c2cf5a900345", "90fcc3f7-3da1-4893-acec-80142891dd15", "46e79d53-6032-4d3d-8cf4-96630d2db005", "9977b16f-b32f-4780-aaa3-662c2005817d", "0f205571-b656-40cf-b7e7-601b40b8bd45"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	{}	\N	\N	\N	\N
df25fded-f594-45ce-a603-d4ffe2d9d53b	\N	\N	\N	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
cac917e7-b4b3-4042-91b9-58dbcb9f3b4f	0	10	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
780cd2f3-c517-418c-b69b-d7150de60200	0	8	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
6cb675bb-d53b-4732-a20b-66c280d47f43	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
a23003d3-9eff-417b-ae77-5f54f015c1f5	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
d228312b-e6ec-4938-b914-c641da9a8678	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
32034f22-a304-4ed1-a022-c8e43ce3da7e	\N	\N	\N	\N	\N	20	\N	["16532c57-8438-4fbb-b265-a8df2a3f6705", "49c5f097-7dd1-402f-9399-f29c6034dff6", "68674a26-af1a-4a7a-93f1-17ec82bbad8c", "01bfd140-1706-4878-83c9-10da32992d44"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
f101b0ab-bd1f-4e51-a3ed-3c9d568f7351	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
0d6d6a44-072f-47bb-802f-dd016728a0e5	\N	\N	\N	\N	\N	20	\N	["16532c57-8438-4fbb-b265-a8df2a3f6705", "49c5f097-7dd1-402f-9399-f29c6034dff6", "68674a26-af1a-4a7a-93f1-17ec82bbad8c", "01bfd140-1706-4878-83c9-10da32992d44"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
e93e24a3-9b4b-421b-a29d-b3a831e85184	\N	\N	\N	\N	\N	\N	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	MANUAL_4000K	100	1/60	\N	7	\N	e6667107-309a-4811-9899-eed77a1bd08d	MANUAL	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
67b45e4c-66a6-491a-abd6-63694eb9387f	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
2094a48a-1ddf-4ca6-a706-1b12aa67f2f6	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
801cdbba-374d-4816-b0c8-938c81abfdf9	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
7634ff88-0bdf-4fb6-8b16-7b9f0606ad2e	\N	5	\N	\N	\N	20	\N	["7f2ea054-9f6e-4679-8b27-be5bfbc7c466", "f8d9748e-48bd-41dc-840d-ee85c9c43b88", "6b927e33-f8b6-4766-8b23-0d6f5337140e", "fd592c01-f797-4f0e-992d-151f1e3eba5c"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	CUSTOM	\N	16.5
2b2a036f-5fb4-4d93-a2b1-6b2cdbd5573c	\N	\N	null	\N	\N	20	\N	["16532c57-8438-4fbb-b265-a8df2a3f6705", "49c5f097-7dd1-402f-9399-f29c6034dff6", "68674a26-af1a-4a7a-93f1-17ec82bbad8c", "01bfd140-1706-4878-83c9-10da32992d44"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
aee497aa-fe58-4ba4-8a35-cddc8a5c104e	\N	\N	null	\N	\N	20	\N	["16532c57-8438-4fbb-b265-a8df2a3f6705", "49c5f097-7dd1-402f-9399-f29c6034dff6", "68674a26-af1a-4a7a-93f1-17ec82bbad8c", "01bfd140-1706-4878-83c9-10da32992d44"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
4467c390-170a-4254-8d31-e2d5d1152f92	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
7198afa3-bc6f-4e63-86c2-e536011b6476	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
14407c1f-f4f8-483f-bcbf-7b95ade04f5d	\N	\N	null	\N	\N	150	\N	["3ad66b9d-065f-49b2-85ba-e61c5aac8375", "33d05d80-7052-4e50-91a3-50d33e7a4413", "c5de0ec8-8528-4857-b82c-659b61addb54", "484e2199-5c13-498f-b61d-7f691284c358"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
16217707-01cd-4ae5-a5f6-f33a7139663e	\N	\N	\N	\N	\N	1	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	MANUAL_4000K	100	1/60	\N	7	\N	e6667107-309a-4811-9899-eed77a1bd08d	MANUAL	\N	NATURAL	\N	{}	\N	\N	\N	\N
bd9b926e-2b4a-4b18-992e-bb268e075f87	\N	\N	\N	\N	\N	\N	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	\N	{}	\N	\N	\N	\N
f4fce734-8766-4574-aa6e-10e4e598edbc	\N	\N	\N	\N	\N	\N	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	MANUAL_4000K	100	1/60	\N	\N	\N	e6667107-309a-4811-9899-eed77a1bd08d	MANUAL	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
4bb9ed07-ebb1-4d1f-af06-b0f53b76a0e6	\N	\N	null	\N	\N	\N	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	MANUAL_4000K	100	1/60	\N	7	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
ddf7fefa-75fd-471f-9d95-9ee52b8a746d	\N	\N	null	\N	\N	\N	\N	["643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	MANUAL_4000K	100	1/60	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
c2964d90-b4d3-4d23-9814-72b964e2c89f	\N	\N	\N	\N	\N	\N	\N	["41f347c5-57b0-451d-8d68-16bc28553bf5", "1ffdc46f-32b3-4548-b491-11ac98989de6", "05cea28b-6f66-4623-a609-334e60b46fd2", "6f8980a6-5039-4629-8bc8-297fc0cd8258"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	\N	\N	\N
bb848cfe-08b7-4a31-8a22-a3807b6c1f0f	\N	\N	\N	\N	\N	\N	\N	["529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	NATURAL	{}	\N	\N	\N	\N
25be9e8d-a0d7-4533-bd4d-a1ac59544331	\N	\N	\N	\N	\N	\N	\N	["529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "643ca0cc-ea1e-46e0-afe3-a706845e52ce", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	NATURAL	NATURAL	{}	\N	CUSTOM	\N	\N
7e86e343-c878-46a2-a5ca-cb98198e200c	\N	\N	\N	\N	\N	\N	\N	["0f205571-b656-40cf-b7e7-601b40b8bd45", "14768049-96a9-417b-8e6b-368e613a3ab8", "260a6461-5933-44ba-90bb-eb2e29cb8500", "3e6e0845-d5d9-4d7f-9d9c-a6d5132e8d46", "4119297a-e92b-49c1-8b52-5a9220cd0b27", "42252e46-0c93-4d37-b8d0-8f10e7ae7c4e", "46e79d53-6032-4d3d-8cf4-96630d2db005", "47a6d2a6-f305-4f6d-af11-ef4bd88d6a07", "4b71afe4-e854-4f12-92f6-f2066182b4bf", "4dc5c42e-c60b-40dd-bb42-256ca56f4390", "54af6c8e-f455-42a2-811d-40a90ca3ec20", "611500bb-09e4-40fd-8878-067a26952c44", "6c1a2f7c-f8dd-4812-86bd-44406116fd97", "7c5836f0-6a75-4fc7-b871-a65162e0844f", "85ec5862-c9f3-458a-a924-8537f1d91d82", "87bdad15-1384-4be1-9b1e-8a104a1acdae", "8b954cbd-791a-4f9a-bad0-04a9cfec55b1", "8c50274f-a650-48f1-8416-a80d7a0d7533", "90fcc3f7-3da1-4893-acec-80142891dd15", "94918670-4a96-4233-b017-b14570c607cd", "9977b16f-b32f-4780-aaa3-662c2005817d", "9bd12136-03aa-414e-a116-565740d94539", "a44b17d8-7e85-4617-862f-c038d014d3f6", "b399733d-84ec-42cb-bcfc-be368f0b1e3e", "d949bac3-74d5-4202-b445-c2cf5a900345", "d95b45e9-dcf4-4893-95c5-c5fe58431220", "dc1a93b4-f4a5-4e16-9b17-36ada5fcf4d3", "e5fea057-15b9-40aa-bb91-91c6b70393c2"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	{"c006eada-24db-4992-bab1-2bc19bc2840b": {"mode": "ALL"}}	\N	\N	\N	\N
7da39c07-e6e7-420f-916f-d09a688fe340	\N	\N	null	\N	\N	\N	\N	["214ddb88-ba55-4dc6-9c49-34f5f4821177", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d", "643ca0cc-ea1e-46e0-afe3-a706845e52ce"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	null	\N	\N	\N	\N
e7bf2656-7810-4af1-8d6d-4b9774e9164c	\N	\N	\N	\N	\N	\N	\N	["0f205571-b656-40cf-b7e7-601b40b8bd45", "9977b16f-b32f-4780-aaa3-662c2005817d", "46e79d53-6032-4d3d-8cf4-96630d2db005", "90fcc3f7-3da1-4893-acec-80142891dd15", "d949bac3-74d5-4202-b445-c2cf5a900345", "4dc5c42e-c60b-40dd-bb42-256ca56f4390", "e5fea057-15b9-40aa-bb91-91c6b70393c2", "42252e46-0c93-4d37-b8d0-8f10e7ae7c4e", "8b954cbd-791a-4f9a-bad0-04a9cfec55b1", "d95b45e9-dcf4-4893-95c5-c5fe58431220", "a44b17d8-7e85-4617-862f-c038d014d3f6", "260a6461-5933-44ba-90bb-eb2e29cb8500", "4119297a-e92b-49c1-8b52-5a9220cd0b27", "85ec5862-c9f3-458a-a924-8537f1d91d82", "3e6e0845-d5d9-4d7f-9d9c-a6d5132e8d46", "47a6d2a6-f305-4f6d-af11-ef4bd88d6a07", "94918670-4a96-4233-b017-b14570c607cd", "6c1a2f7c-f8dd-4812-86bd-44406116fd97", "b399733d-84ec-42cb-bcfc-be368f0b1e3e", "611500bb-09e4-40fd-8878-067a26952c44", "7c5836f0-6a75-4fc7-b871-a65162e0844f", "8c50274f-a650-48f1-8416-a80d7a0d7533", "dc1a93b4-f4a5-4e16-9b17-36ada5fcf4d3", "54af6c8e-f455-42a2-811d-40a90ca3ec20", "4b71afe4-e854-4f12-92f6-f2066182b4bf", "9bd12136-03aa-414e-a116-565740d94539", "14768049-96a9-417b-8e6b-368e613a3ab8", "87bdad15-1384-4be1-9b1e-8a104a1acdae"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	\N	\N	\N
de700e5a-c010-46c0-b2db-2ae08481125a	\N	\N	\N	\N	\N	\N	\N	["41f347c5-57b0-451d-8d68-16bc28553bf5", "1ffdc46f-32b3-4548-b491-11ac98989de6", "05cea28b-6f66-4623-a609-334e60b46fd2", "6f8980a6-5039-4629-8bc8-297fc0cd8258"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	{}	\N	\N	\N	\N
2738f91e-9d31-4d09-a2ec-6d889aa6ccb5	\N	\N	\N	\N	\N	\N	\N	["611500bb-09e4-40fd-8878-067a26952c44", "b399733d-84ec-42cb-bcfc-be368f0b1e3e", "6c1a2f7c-f8dd-4812-86bd-44406116fd97", "94918670-4a96-4233-b017-b14570c607cd", "47a6d2a6-f305-4f6d-af11-ef4bd88d6a07", "3e6e0845-d5d9-4d7f-9d9c-a6d5132e8d46", "85ec5862-c9f3-458a-a924-8537f1d91d82", "4119297a-e92b-49c1-8b52-5a9220cd0b27", "260a6461-5933-44ba-90bb-eb2e29cb8500", "a44b17d8-7e85-4617-862f-c038d014d3f6", "d95b45e9-dcf4-4893-95c5-c5fe58431220", "8b954cbd-791a-4f9a-bad0-04a9cfec55b1", "42252e46-0c93-4d37-b8d0-8f10e7ae7c4e", "e5fea057-15b9-40aa-bb91-91c6b70393c2", "4dc5c42e-c60b-40dd-bb42-256ca56f4390", "d949bac3-74d5-4202-b445-c2cf5a900345", "90fcc3f7-3da1-4893-acec-80142891dd15", "46e79d53-6032-4d3d-8cf4-96630d2db005", "9977b16f-b32f-4780-aaa3-662c2005817d", "0f205571-b656-40cf-b7e7-601b40b8bd45"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	REVERSED	{}	\N	\N	\N	\N
298d21e8-2bde-4554-b33a-7299104e00b5	\N	\N	\N	\N	\N	\N	\N	["a8940650-7bae-419a-a664-450366f55e1f", "543ed180-2f53-4c17-a3fb-41b1ae2743fb", "63e9fc3d-58f9-490d-82ab-2359c834b6a5", "5e90d45b-4614-4df4-bfd0-c2ce88fc8eef", "2769107a-cecf-4d22-9cec-363b8faa3ca1", "f8ea9491-d59a-4760-ab7b-dcba19de4b6b", "d6d50a29-bdc1-4bc7-98f1-3f9b5c3abef7", "55af7678-4f90-4ddf-b5b2-3b0890505066", "b005f51c-6251-4765-b0e3-7849501afa13", "436eb62d-f210-47a9-abd2-0eae5dd7cec8", "5149e7f5-b041-4e00-b72c-9b6a07c9f8e8", "0ff8a116-41e0-4b1d-aab2-f73c2911bc30", "9d097194-9de3-4a27-b202-ec8d7af12a9d", "979c9e06-b269-4e33-b6c5-fdd9c638c1d8", "a54d52de-5531-4a0e-a638-0307cc69ad96", "a22cdc71-293f-4be1-9c54-ffa4a53db65a", "52db4905-e766-4cfb-b811-5e424bab4e85", "a8113c5a-57d3-4919-a097-7c6820d92dec", "14e13ec8-e2c9-45ff-bd22-ef4c3f25eddf", "f7295e73-1409-49c7-a8cc-d11e8df53eb9", "2758eff8-c298-4024-b90c-5ae3c2741654", "81aae5a0-999b-486a-adef-84fe5e36b50a", "b1b5bdf5-6962-40f2-9e34-9fc11b76d65b", "bed57d42-f4a7-451f-998b-c6fbe848b60e", "f06b9fe1-8877-4a85-81b7-fdf15a7ceee5", "ebd18b50-1955-4e7a-9938-9d1cf173585d", "4b41a1a9-057b-4c9b-a348-9e2d11fa5178", "4406acb3-8b0b-4e97-9b9a-7a4275e86472"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	{}	\N	\N	\N	\N
d8810d37-0257-46f4-bee8-bc18be1eba48	\N	\N	\N	\N	\N	\N	\N	["7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "643ca0cc-ea1e-46e0-afe3-a706845e52ce"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	\N	CUSTOM	\N	\N
968dc476-142b-435c-bcc6-e4123f55f895	\N	\N	\N	\N	\N	\N	\N	["a8940650-7bae-419a-a664-450366f55e1f", "543ed180-2f53-4c17-a3fb-41b1ae2743fb", "63e9fc3d-58f9-490d-82ab-2359c834b6a5", "5e90d45b-4614-4df4-bfd0-c2ce88fc8eef", "2769107a-cecf-4d22-9cec-363b8faa3ca1", "f8ea9491-d59a-4760-ab7b-dcba19de4b6b", "d6d50a29-bdc1-4bc7-98f1-3f9b5c3abef7", "55af7678-4f90-4ddf-b5b2-3b0890505066", "b005f51c-6251-4765-b0e3-7849501afa13", "436eb62d-f210-47a9-abd2-0eae5dd7cec8", "5149e7f5-b041-4e00-b72c-9b6a07c9f8e8", "0ff8a116-41e0-4b1d-aab2-f73c2911bc30", "9d097194-9de3-4a27-b202-ec8d7af12a9d", "979c9e06-b269-4e33-b6c5-fdd9c638c1d8", "a54d52de-5531-4a0e-a638-0307cc69ad96", "a22cdc71-293f-4be1-9c54-ffa4a53db65a", "52db4905-e766-4cfb-b811-5e424bab4e85", "a8113c5a-57d3-4919-a097-7c6820d92dec", "14e13ec8-e2c9-45ff-bd22-ef4c3f25eddf", "f7295e73-1409-49c7-a8cc-d11e8df53eb9", "2758eff8-c298-4024-b90c-5ae3c2741654", "81aae5a0-999b-486a-adef-84fe5e36b50a", "b1b5bdf5-6962-40f2-9e34-9fc11b76d65b", "bed57d42-f4a7-451f-998b-c6fbe848b60e", "f06b9fe1-8877-4a85-81b7-fdf15a7ceee5", "ebd18b50-1955-4e7a-9938-9d1cf173585d", "4b41a1a9-057b-4c9b-a348-9e2d11fa5178", "4406acb3-8b0b-4e97-9b9a-7a4275e86472"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	REVERSED	{}	\N	\N	\N	\N
4da35440-b573-4a6c-a9d7-fbba1f1adf32	\N	\N	\N	\N	\N	\N	\N	["7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "643ca0cc-ea1e-46e0-afe3-a706845e52ce"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	NATURAL	{}	\N	CUSTOM	\N	\N
d45dcf48-5f94-4ce6-a279-ef0ff31d2c94	\N	\N	\N	\N	\N	\N	\N	["7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d", "529e0076-8bd6-4231-8b2d-ce9ae61d8e92", "214ddb88-ba55-4dc6-9c49-34f5f4821177", "643ca0cc-ea1e-46e0-afe3-a706845e52ce"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	REVERSED	{}	\N	CUSTOM	\N	\N
3cd0fc38-43e3-4d1d-8b6d-c8c1ccd77bfe	\N	\N	null	\N	\N	250	\N	["e8fef6fd-4856-4560-9fa3-1ea5a31bd8b2", "d4452a89-c206-4506-888f-42de909f03f5", "e1a5dbfa-980e-4dc4-89ad-f61c031774cb", "dff89585-837c-4179-9534-fa905dff731e"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	REVERSED	{}	\N	CUSTOM	\N	\N
5572b11a-89cb-496b-bffd-a0a5e5a07660	\N	\N	\N	\N	\N	250	\N	["e8fef6fd-4856-4560-9fa3-1ea5a31bd8b2", "d4452a89-c206-4506-888f-42de909f03f5", "e1a5dbfa-980e-4dc4-89ad-f61c031774cb", "dff89585-837c-4179-9534-fa905dff731e"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	REVERSED	{}	\N	CUSTOM	\N	\N
83ff28c7-2a41-4ee3-889e-c89c8638928b	5	\N	\N	\N	\N	200	\N	["e8fef6fd-4856-4560-9fa3-1ea5a31bd8b2", "d4452a89-c206-4506-888f-42de909f03f5", "e1a5dbfa-980e-4dc4-89ad-f61c031774cb", "dff89585-837c-4179-9534-fa905dff731e"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	NATURAL	{}	\N	CUSTOM	\N	\N
5761c268-4f00-4f19-b1e5-088ac8703899	5	\N	null	\N	\N	200	\N	["e8fef6fd-4856-4560-9fa3-1ea5a31bd8b2", "d4452a89-c206-4506-888f-42de909f03f5", "e1a5dbfa-980e-4dc4-89ad-f61c031774cb", "dff89585-837c-4179-9534-fa905dff731e"]	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7	\N	\N	\N	\N	\N	NATURAL	{}	\N	CUSTOM	\N	\N
\.


--
-- Data for Name: inspection_template; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inspection_template (id, name, description, default_config_id, angular_tolerances, created_by, created_at, updated_at) FROM stdin;
e7a4bd00-3f09-4add-8639-de15c8c5aa49	PAPI Angular Sweep	angular sweep inspection for PAPI systems	cac917e7-b4b3-4042-91b9-58dbcb9f3b4f	\N	system	2026-04-17 20:30:55.085607+00	2026-04-17 20:30:55.085607+00
6765d789-57d7-42ba-a1de-21576336a806	PAPI Vertical Profile	vertical profile inspection for PAPI systems	780cd2f3-c517-418c-b69b-d7150de60200	\N	system	2026-04-17 20:30:55.085607+00	2026-04-17 20:30:55.085607+00
7d3c54e5-cbe0-47f6-a310-5f800dcbbb98	PAPI RWY 1 LEFT - Vertical Profile	\N	\N	null	\N	2026-04-17 21:42:25.359801+00	2026-04-17 21:42:25.359801+00
b810f6db-ea91-4c7c-a0be-7a9e79e92b37	PAPI RWY 1 LEFT - Angular Sweep	\N	\N	null	\N	2026-04-17 21:42:31.606975+00	2026-04-17 21:42:31.606975+00
f53ace8d-3af6-4b9b-b4dd-e2cbb9276d0e	PAPI RWY 1 LEFT - Vertical Profile	\N	\N	null	\N	2026-04-17 22:25:25.445215+00	2026-04-17 22:25:25.445215+00
46db5415-5531-4ec3-ad8c-f9fa9c35727c	PAPI RWY 1 LEFT - Angular Sweep	\N	\N	null	\N	2026-04-17 22:25:30.463402+00	2026-04-17 22:25:30.463402+00
8841b152-6bde-4c25-be3b-f956528ab1df	PAPI RWY 04 LEFT - Vertical Profile	\N	\N	null	\N	2026-04-18 08:41:54.532929+00	2026-04-18 08:41:54.532929+00
a2a50b3a-795f-4cbb-99d5-0512397f4984	PAPI RWY 31 LEFT - Vertical Profile	\N	\N	null	\N	2026-04-18 08:41:59.914474+00	2026-04-18 08:41:59.914474+00
b305ec9d-3e54-4a14-8a9e-3c142090cfaf	PAPI RWY 31 LEFT - Angular Sweep	\N	\N	null	\N	2026-04-18 08:42:10.06903+00	2026-04-18 08:42:10.06903+00
962a0631-ef42-4be9-9cf5-60538629f365	Hover Point Lock	\N	\N	null	\N	2026-04-18 08:42:14.930783+00	2026-04-18 08:42:14.930783+00
e4084b04-a763-4b9e-beb2-4f78cf69eb36	REL RWY 04 LEFT - Fly Over	\N	\N	null	\N	2026-04-18 08:42:24.353088+00	2026-04-18 08:42:24.353088+00
01703a45-ce9f-4345-9ce4-bc0fd20fbe49	REL RWY 04 RIGHT - Fly Over	\N	\N	null	\N	2026-04-18 08:42:29.407753+00	2026-04-18 08:42:29.407753+00
fe525cc0-a1ea-4b8b-96be-8112daf27e40	REL RWY 04 LEFT - Parallel Side Sweep	\N	\N	null	\N	2026-04-18 08:43:37.588062+00	2026-04-18 08:43:37.588062+00
ff16fc9d-c73c-4d7f-ab37-7369c8d674f4	REL RWY 04 RIGHT - Parallel Side Sweep	\N	\N	null	\N	2026-04-18 08:43:42.151841+00	2026-04-18 08:43:42.151841+00
8122cc22-2da7-4f07-8ae3-f15e660e9494	PAPI RWY 1 LEFT - Vertical Profile	\N	\N	null	\N	2026-04-18 12:06:40.382896+00	2026-04-18 12:06:40.382896+00
335ea795-dff1-4d8c-86f1-edc5e7259431	PAPI RWY 1 LEFT - Angular Sweep	\N	\N	null	\N	2026-04-18 12:06:48.300862+00	2026-04-18 12:06:48.300862+00
6278dd5a-6f29-46b1-bf76-d2c81f04c62e	PAPI RWY 04 LEFT - MEHT Check	\N	\N	null	\N	2026-04-21 20:22:27.045577+00	2026-04-21 20:22:27.045577+00
6b7797c1-83e5-4622-921a-baaeba597ad0	PAPI RWY 31 LEFT - MEHT Check	\N	\N	null	\N	2026-04-21 20:22:35.499481+00	2026-04-21 20:22:35.499481+00
3490b122-cbe7-4b1e-b99a-d06ef8dba5a3	PAPI RWY 04 LEFT - Angular Sweep	\N	7da39c07-e6e7-420f-916f-d09a688fe340	null	\N	2026-04-18 08:42:05.171268+00	2026-05-04 08:49:40.911795+00
dee5a3cf-878a-4ba9-afb5-d40359cb0d93	PAPI RWY 1 LEFT - Vertical Profile	\N	\N	\N	\N	2026-05-13 17:07:14.753814+00	2026-05-13 17:07:14.753814+00
c449b182-54ca-47c4-b9bf-3fd955c6aa05	PAPI RWY 1 LEFT - Horizontal Range	\N	\N	\N	\N	2026-05-13 17:07:14.753814+00	2026-05-13 17:07:14.753814+00
d6a0c810-edb3-43f1-9aa0-e09b31a49e47	PAPI RWY 1 LEFT - Meht Check	\N	\N	\N	\N	2026-05-13 17:07:14.753814+00	2026-05-13 17:07:14.753814+00
\.


--
-- Data for Name: lha; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lha (id, agl_id, setting_angle, transition_sector_width, lamp_type, "position", tolerance, unit_designator, sequence_number) FROM stdin;
979c9e06-b269-4e33-b6c5-fdd9c638c1d8	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21891540740741 48.17475985185185 133)	0.2	15	15
9d097194-9de3-4a27-b202-ec8d7af12a9d	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21845122222222 48.174437555555556 133)	0.2	16	16
0ff8a116-41e0-4b1d-aab2-f73c2911bc30	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.217987037037037 48.17411525925926 133)	0.2	17	17
5149e7f5-b041-4e00-b72c-9b6a07c9f8e8	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21752285185185 48.17379296296296 133)	0.2	18	18
436eb62d-f210-47a9-abd2-0eae5dd7cec8	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.217058666666667 48.17347066666667 133)	0.2	19	19
b005f51c-6251-4765-b0e3-7849501afa13	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.216594481481483 48.17314837037037 133)	0.2	20	20
55af7678-4f90-4ddf-b5b2-3b0890505066	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.216130296296296 48.172826074074074 133)	0.2	21	21
d6d50a29-bdc1-4bc7-98f1-3f9b5c3abef7	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.215666111111112 48.17250377777778 133)	0.2	22	22
f8ea9491-d59a-4760-ab7b-dcba19de4b6b	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.215201925925925 48.17218148148148 133)	0.2	23	23
2769107a-cecf-4d22-9cec-363b8faa3ca1	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21473774074074 48.171859185185184 133)	0.2	24	24
5e90d45b-4614-4df4-bfd0-c2ce88fc8eef	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.214273555555554 48.17153688888889 133)	0.2	25	25
63e9fc3d-58f9-490d-82ab-2359c834b6a5	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21380937037037 48.17121459259259 133)	0.2	26	26
543ed180-2f53-4c17-a3fb-41b1ae2743fb	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.213345185185183 48.170892296296294 133)	0.2	27	27
a8940650-7bae-419a-a664-450366f55e1f	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.212881 48.17057 133)	0.2	28	28
41f347c5-57b0-451d-8d68-16bc28553bf5	f8a24463-d3c4-43d8-8810-821e209d58a6	3.17	\N	HALOGEN	POINT Z (17.227800489112553 48.159773675736375 133)	0.2	B	3
7a287a7a-dd31-4e3a-a9c5-d0e974f7b68d	3304cf62-461b-4825-8755-058460b0b5d4	3.5	\N	HALOGEN	POINT Z (17.223097163625027 48.17667477361434 133)	0.2	D	4
529e0076-8bd6-4231-8b2d-ce9ae61d8e92	3304cf62-461b-4825-8755-058460b0b5d4	3.17	\N	HALOGEN	POINT Z (17.22318169089482 48.17661984079592 133)	0.2	C	3
214ddb88-ba55-4dc6-9c49-34f5f4821177	3304cf62-461b-4825-8755-058460b0b5d4	2.87	\N	HALOGEN	POINT Z (17.223270516161563 48.176563474886564 133)	0.2	B	2
643ca0cc-ea1e-46e0-afe3-a706845e52ce	3304cf62-461b-4825-8755-058460b0b5d4	2.5	\N	HALOGEN	POINT Z (17.223358625094704 48.176508064271616 133)	0.2	A	1
1ffdc46f-32b3-4548-b491-11ac98989de6	f8a24463-d3c4-43d8-8810-821e209d58a6	3.5	\N	HALOGEN	POINT Z (17.22788423197619 48.15983112157181 133)	0.2	A	4
6f8980a6-5039-4629-8bc8-297fc0cd8258	f8a24463-d3c4-43d8-8810-821e209d58a6	2.5	\N	HALOGEN	POINT Z (17.227628252018036 48.15965680297646 133)	0.2	D	1
05cea28b-6f66-4623-a609-334e60b46fd2	f8a24463-d3c4-43d8-8810-821e209d58a6	2.87	\N	HALOGEN	POINT Z (17.227713182723505 48.15971543747909 133)	0.2	C	2
e5141e99-506a-44e3-b4d1-2adf082921c8	408ae31c-5e83-44c8-93b0-0e376687d064	\N	\N	HALOGEN	POINT Z (21.245820972222223 48.67380643055556 230)	0.2	A	1
3c0b0991-9440-4a58-b219-cbaf72bdbbe3	408ae31c-5e83-44c8-93b0-0e376687d064	\N	\N	HALOGEN	POINT Z (21.245701055555557 48.67382469444444 230)	0.2	B	2
22d6e2ec-5a51-4614-ab49-608f31eda34a	408ae31c-5e83-44c8-93b0-0e376687d064	\N	\N	HALOGEN	POINT Z (21.245580680555555 48.673843319444444 230)	0.2	C	3
d3461d39-9ceb-4f97-a2e6-26321a55db99	408ae31c-5e83-44c8-93b0-0e376687d064	\N	\N	HALOGEN	POINT Z (21.24546227777778 48.673861333333335 230)	0.2	D	4
4aad7bf5-d7ab-4a1a-b64d-2ec31b42d06a	0873543c-1ce6-4c4c-a9dd-ba672ceefc70	\N	\N	HALOGEN	POINT Z (21.24496761111111 48.67393386111111 230)	0.2	TD	1
32b4aa5d-5fe5-42e9-9b2c-6ca5b7d5e998	0873543c-1ce6-4c4c-a9dd-ba672ceefc70	\N	\N	HALOGEN	POINT Z (21.246043972222225 48.67606052777778 230)	0.2	SR1	2
eb6a262e-498f-4662-a32e-2df5c75d0133	0873543c-1ce6-4c4c-a9dd-ba672ceefc70	\N	\N	HALOGEN	POINT Z (21.24540877777778 48.67615747222222 230)	0.2	SR2	3
3d507fcf-11fd-44c3-95f3-4adeb5a7b68e	91f12f2a-5933-49f6-ab8f-e4d55aeb67c9	\N	\N	HALOGEN	POINT Z (17.825444527777776 48.61872211111111 166)	0.2	A	1
a2d188da-aa9b-4684-8238-7ba4274a3319	91f12f2a-5933-49f6-ab8f-e4d55aeb67c9	\N	\N	HALOGEN	POINT Z (17.82556313888889 48.61870293055556 166)	0.2	B	2
e0220d64-f616-40ee-ae5d-7a0f0f581812	91f12f2a-5933-49f6-ab8f-e4d55aeb67c9	\N	\N	HALOGEN	POINT Z (17.825680902777776 48.618684611111114 166)	0.2	C	3
32de8620-22fc-42a2-887d-eb256a985634	91f12f2a-5933-49f6-ab8f-e4d55aeb67c9	\N	\N	HALOGEN	POINT Z (17.825799680555555 48.61866533333333 166)	0.2	D	4
0a9ed0b7-d73d-48d6-abe4-9cb83aeb3648	bdd5af77-d805-49ac-87da-67accb871e26	\N	\N	HALOGEN	POINT Z (17.826194583333333 48.618602805555554 166)	0.2	TD	1
0ed2b95e-5b2d-497c-b03b-9e0049f5d0b1	bdd5af77-d805-49ac-87da-67accb871e26	\N	\N	HALOGEN	POINT Z (17.825349166666665 48.61694255555555 166)	0.2	SR1	2
de6d6003-ee1b-4a1c-8302-714b4b8f1c26	bdd5af77-d805-49ac-87da-67accb871e26	\N	\N	HALOGEN	POINT Z (17.825752833333333 48.61674286111111 166)	0.2	SR2	3
fe08e221-adf8-4b8a-8709-4afc997bee09	71ab1914-9aa0-4be7-9053-3ad80c8ec722	\N	\N	HALOGEN	POINT Z (17.831711652777777 48.63151083333334 166)	0.2	A	1
400e1df7-7cf7-4258-9478-64c61786415f	71ab1914-9aa0-4be7-9053-3ad80c8ec722	\N	\N	HALOGEN	POINT Z (17.831593472222224 48.63153018055556 166)	0.2	B	2
8ef69bbc-10e7-4b29-be92-408f1aa537d0	71ab1914-9aa0-4be7-9053-3ad80c8ec722	\N	\N	HALOGEN	POINT Z (17.831474138888886 48.631549375 166)	0.2	C	3
73b320d1-e782-4b95-b1c0-5565bf6e74f5	71ab1914-9aa0-4be7-9053-3ad80c8ec722	\N	\N	HALOGEN	POINT Z (17.831355625 48.631567555555556 166)	0.2	D	4
4406acb3-8b0b-4e97-9b9a-7a4275e86472	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.225414 48.179272 133)	0.2	1	1
4b41a1a9-057b-4c9b-a348-9e2d11fa5178	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.224949814814817 48.1789497037037 133)	0.2	2	2
ebd18b50-1955-4e7a-9938-9d1cf173585d	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.22448562962963 48.178627407407404 133)	0.2	3	3
f06b9fe1-8877-4a85-81b7-fdf15a7ceee5	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.224021444444446 48.17830511111111 133)	0.2	4	4
bed57d42-f4a7-451f-998b-c6fbe848b60e	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.22355725925926 48.17798281481481 133)	0.2	5	5
b1b5bdf5-6962-40f2-9e34-9fc11b76d65b	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.223093074074075 48.177660518518515 133)	0.2	6	6
81aae5a0-999b-486a-adef-84fe5e36b50a	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.222628888888888 48.17733822222222 133)	0.2	7	7
2758eff8-c298-4024-b90c-5ae3c2741654	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.222164703703704 48.17701592592592 133)	0.2	8	8
f7295e73-1409-49c7-a8cc-d11e8df53eb9	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.221700518518517 48.176693629629625 133)	0.2	9	9
14e13ec8-e2c9-45ff-bd22-ef4c3f25eddf	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.221236333333334 48.17637133333333 133)	0.2	10	10
a8113c5a-57d3-4919-a097-7c6820d92dec	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.22077214814815 48.17604903703703 133)	0.2	11	11
52db4905-e766-4cfb-b811-5e424bab4e85	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.220307962962963 48.175726740740735 133)	0.2	12	12
a22cdc71-293f-4be1-9c54-ffa4a53db65a	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.21984377777778 48.17540444444444 133)	0.2	13	13
a54d52de-5531-4a0e-a638-0307cc69ad96	142c30ad-5ec6-4314-84a5-8ae0598afdac	0	\N	LED	POINT Z (17.219379592592592 48.17508214814814 133)	0.2	14	14
01ff8ed8-e577-4f7f-8660-9d542f4c9639	61b9d72c-7502-4de2-ad0d-8be68c9a6f77	\N	\N	HALOGEN	POINT Z (17.830922527777776 48.63152813888889 166)	0.2	TD	1
a5f3c524-8432-47d6-bb28-e25567f11772	61b9d72c-7502-4de2-ad0d-8be68c9a6f77	\N	\N	HALOGEN	POINT Z (17.831741555555556 48.63311591666667 166)	0.2	SR1	2
0f205571-b656-40cf-b7e7-601b40b8bd45	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.226025 48.178881 133)	0.2	1	1
9977b16f-b32f-4780-aaa3-662c2005817d	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.22556022222222 48.17855840740741 133)	0.2	2	2
46e79d53-6032-4d3d-8cf4-96630d2db005	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.225095444444445 48.17823581481481 133)	0.2	3	3
90fcc3f7-3da1-4893-acec-80142891dd15	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.224630666666666 48.17791322222222 133)	0.2	4	4
d949bac3-74d5-4202-b445-c2cf5a900345	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.224165888888887 48.17759062962963 133)	0.2	5	5
4dc5c42e-c60b-40dd-bb42-256ca56f4390	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.22370111111111 48.17726803703704 133)	0.2	6	6
e5fea057-15b9-40aa-bb91-91c6b70393c2	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.223236333333332 48.17694544444444 133)	0.2	7	7
42252e46-0c93-4d37-b8d0-8f10e7ae7c4e	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.222771555555557 48.17662285185185 133)	0.2	8	8
8b954cbd-791a-4f9a-bad0-04a9cfec55b1	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.222306777777778 48.17630025925926 133)	0.2	9	9
d95b45e9-dcf4-4893-95c5-c5fe58431220	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.221842 48.17597766666667 133)	0.2	10	10
a44b17d8-7e85-4617-862f-c038d014d3f6	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.221377222222223 48.17565507407407 133)	0.2	11	11
260a6461-5933-44ba-90bb-eb2e29cb8500	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.220912444444444 48.17533248148148 133)	0.2	12	12
4119297a-e92b-49c1-8b52-5a9220cd0b27	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.220447666666665 48.17500988888889 133)	0.2	13	13
85ec5862-c9f3-458a-a924-8537f1d91d82	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.21998288888889 48.1746872962963 133)	0.2	14	14
3e6e0845-d5d9-4d7f-9d9c-a6d5132e8d46	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.21951811111111 48.1743647037037 133)	0.2	15	15
47a6d2a6-f305-4f6d-af11-ef4bd88d6a07	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.219053333333335 48.17404211111111 133)	0.2	16	16
94918670-4a96-4233-b017-b14570c607cd	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.218588555555556 48.17371951851852 133)	0.2	17	17
6c1a2f7c-f8dd-4812-86bd-44406116fd97	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.218123777777777 48.17339692592593 133)	0.2	18	18
b399733d-84ec-42cb-bcfc-be368f0b1e3e	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.217659 48.17307433333333 133)	0.2	19	19
611500bb-09e4-40fd-8878-067a26952c44	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.217194222222222 48.17275174074074 133)	0.2	20	20
7c5836f0-6a75-4fc7-b871-a65162e0844f	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.216729444444443 48.17242914814815 133)	0.2	21	21
8c50274f-a650-48f1-8416-a80d7a0d7533	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.216264666666667 48.17210655555556 133)	0.2	22	22
dc1a93b4-f4a5-4e16-9b17-36ada5fcf4d3	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.21579988888889 48.17178396296296 133)	0.2	23	23
54af6c8e-f455-42a2-811d-40a90ca3ec20	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.215335111111113 48.17146137037037 133)	0.2	24	24
4b71afe4-e854-4f12-92f6-f2066182b4bf	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.214870333333334 48.17113877777778 133)	0.2	25	25
9bd12136-03aa-414e-a116-565740d94539	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.214405555555555 48.17081618518519 133)	0.2	26	26
14768049-96a9-417b-8e6b-368e613a3ab8	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.21394077777778 48.17049359259259 133)	0.2	27	27
87bdad15-1384-4be1-9b1e-8a104a1acdae	c006eada-24db-4992-bab1-2bc19bc2840b	0	\N	LED	POINT Z (17.213476 48.170171 133)	0.2	28	28
c20ce9c6-4e3b-43b2-abee-dbb0a5d883d1	31dc51ab-da79-4014-86ef-400d22208efa	\N	\N	HALOGEN	POINT Z (21.236489416666668 48.65225622222222 230)	0.2	A	1
adc219e6-f7e6-4a9a-80d9-1917eb45f866	31dc51ab-da79-4014-86ef-400d22208efa	\N	\N	HALOGEN	POINT Z (21.23660813888889 48.65223801388889 230)	0.2	B	2
4c0992a5-451a-45e0-ac64-8ef54e4fa268	31dc51ab-da79-4014-86ef-400d22208efa	\N	\N	HALOGEN	POINT Z (21.236727694444447 48.652219708333334 230)	0.2	C	3
1b721822-c953-4971-9a39-1d801811a7bb	31dc51ab-da79-4014-86ef-400d22208efa	\N	\N	HALOGEN	POINT Z (21.236846569444445 48.65220154166667 230)	0.2	D	4
38695d9e-9dd5-4d38-b361-f93d1c7d62e8	6a32f42a-3903-4b60-b05d-b890b15f7b66	\N	\N	HALOGEN	POINT Z (21.237343916666667 48.65213883333333 230)	0.2	TD	1
5c74b527-594c-4eea-bc8e-c28f43e4944c	6a32f42a-3903-4b60-b05d-b890b15f7b66	\N	\N	HALOGEN	POINT Z (21.236272805555558 48.65002086111111 230)	0.2	SR1	2
5cd4aa0b-b944-44e2-bff0-085ec2f961e5	6a32f42a-3903-4b60-b05d-b890b15f7b66	\N	\N	HALOGEN	POINT Z (21.236907444444444 48.64992325 230)	0.2	SR2	3
\.


--
-- Data for Name: obstacle; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.obstacle (id, airport_id, name, "position", height, radius, geometry, type, buffer_distance) FROM stdin;
557c3a86-88b4-4d96-843a-e63ee164e96c	b758c988-083f-469e-ab55-efe5f7b1306a	Tower 1	POINT Z (17.207152030756475 48.17048963333457 133)	20	3	POLYGON Z ((17.207152030756475 48.170677497932466 133,17.207180072755747 48.170676579178405 133,17.20720784469524 48.17067383176431 133,17.20723507911599 48.17066928214929 133,17.207261513735638 48.17066297414863 133,17.207286893974345 48.170654968511805 133,17.207310975406543 48.17064534233749 133,17.207333526114873 48.170634188331 133,17.207354328923685 48.17062161391152 133,17.207373183490564 48.17060774017758 133,17.207389908235715 48.17059270074082 133,17.207404342090705 48.17057664043924 133,17.207416346049616 48.170559713942325 133,17.207425804507768 48.17054208426149 133,17.207432626375034 48.1705239211802 133,17.207436745953103 48.17050539961886 133,17.20743812356819 48.170486697950224 133,17.207436745953103 48.17046799628159 133,17.207432626375034 48.17044947472025 133,17.207425804507768 48.17043131163896 133,17.207416346049616 48.170413681958124 133,17.207404342090705 48.170396755461205 133,17.207389908235715 48.17038069515963 133,17.207373183490564 48.17036565572287 133,17.207354328923685 48.17035178198893 133,17.207333526114873 48.17033920756945 133,17.207310975406543 48.17032805356296 133,17.207286893974345 48.170318427388644 133,17.207261513735638 48.17031042175182 133,17.20723507911599 48.17030411375116 133,17.20720784469524 48.17029956413614 133,17.207180072755747 48.17029681672204 133,17.207152030756475 48.17029589796798 133,17.207123988757203 48.17029681672204 133,17.20709621681771 48.17029956413614 133,17.20706898239696 48.17030411375116 133,17.207042547777313 48.17031042175182 133,17.207017167538606 48.170318427388644 133,17.206993086106408 48.17032805356296 133,17.206970535398078 48.17033920756945 133,17.206949732589266 48.17035178198893 133,17.206930878022387 48.17036565572287 133,17.206914153277236 48.17038069515963 133,17.206899719422246 48.170396755461205 133,17.206887715463335 48.170413681958124 133,17.206878257005183 48.17043131163896 133,17.206871435137916 48.17044947472025 133,17.206867315559847 48.17046799628159 133,17.206865937944762 48.170486697950224 133,17.206867315559847 48.17050539961886 133,17.206871435137916 48.1705239211802 133,17.206878257005183 48.17054208426149 133,17.206887715463335 48.170559713942325 133,17.206899719422246 48.17057664043924 133,17.206914153277236 48.17059270074082 133,17.206930878022387 48.17060774017758 133,17.206949732589266 48.17062161391152 133,17.206970535398078 48.170634188331 133,17.206993086106408 48.17064534233749 133,17.207017167538606 48.170654968511805 133,17.207042547777313 48.17066297414863 133,17.20706898239696 48.17066928214929 133,17.20709621681771 48.17067383176431 133,17.207123988757203 48.170676579178405 133,17.207152030756475 48.170677497932466 133))	TOWER	5
42439329-7a5d-4f3c-9f45-89ea572bbcb1	b758c988-083f-469e-ab55-efe5f7b1306a	Building 1	POINT Z (17.206098055918396 48.16991667200259 133)	10	3	POLYGON Z ((17.206287204953867 48.17040574820294 133,17.206995249470083 48.16995040349437 133,17.20578651633096 48.169208351602094 133,17.20513410388321 48.16961310851062 133,17.206287204953867 48.17040574820294 133))	BUILDING	5
5d1260bd-224a-452d-94a7-f8932f4a959f	b758c988-083f-469e-ab55-efe5f7b1306a	Antenna 1	POINT Z (17.217271662806866 48.17017087668577 133)	20	3	POLYGON Z ((17.217271662806866 48.17070474881359 133,17.21735135183478 48.17070213790556 133,17.217430273413793 48.17069433032593 133,17.217507667485958 48.170681401265966 133,17.21758278870405 48.170663475239586 133,17.21765491360967 48.170640724884215 133,17.217723347600554 48.170613369298216 133,17.21778743161996 48.17058167193083 133,17.21784654850375 48.17054593804505 133,17.21790012892401 48.17050651177772 133,17.21794765687201 48.170463772825336 133,17.217988674627627 48.17041813278738 133,17.21802278716745 48.17037003120238 133,17.218049665969076 48.170319931314886 133,17.21806905217495 48.170268315614194 133,17.21808075908531 48.17021568118773 133,17.218084673956213 48.17016253493378 133,17.21808075908531 48.17010938867983 133,17.21806905217495 48.170056754253366 133,17.218049665969076 48.170005138552675 133,17.21802278716745 48.16995503866518 133,17.217988674627627 48.16990693708018 133,17.21794765687201 48.169861297042225 133,17.21790012892401 48.169818558089844 133,17.21784654850375 48.16977913182251 133,17.21778743161996 48.16974339793673 133,17.217723347600554 48.169711700569344 133,17.21765491360967 48.169684344983345 133,17.21758278870405 48.169661594627975 133,17.217507667485958 48.169643668601594 133,17.217430273413793 48.16963073954163 133,17.21735135183478 48.169622931962 133,17.217271662806866 48.16962032105397 133,17.217191973778952 48.169622931962 133,17.217113052199938 48.16963073954163 133,17.217035658127774 48.169643668601594 133,17.21696053690968 48.169661594627975 133,17.21688841200406 48.169684344983345 133,17.216819978013177 48.169711700569344 133,17.21675589399377 48.16974339793673 133,17.21669677710998 48.16977913182251 133,17.21664319668972 48.169818558089844 133,17.21659566874172 48.169861297042225 133,17.216554650986104 48.16990693708018 133,17.216520538446282 48.16995503866518 133,17.216493659644655 48.170005138552675 133,17.21647427343878 48.170056754253366 133,17.21646256652842 48.17010938867983 133,17.21645865165752 48.17016253493378 133,17.21646256652842 48.17021568118773 133,17.21647427343878 48.170268315614194 133,17.216493659644655 48.170319931314886 133,17.216520538446282 48.17037003120238 133,17.216554650986104 48.17041813278738 133,17.21659566874172 48.170463772825336 133,17.21664319668972 48.17050651177772 133,17.21669677710998 48.17054593804505 133,17.21675589399377 48.17058167193083 133,17.216819978013177 48.170613369298216 133,17.21688841200406 48.170640724884215 133,17.21696053690968 48.170663475239586 133,17.217035658127774 48.170681401265966 133,17.217113052199938 48.17069433032593 133,17.217191973778952 48.17070213790556 133,17.217271662806866 48.17070474881359 133))	ANTENNA	5
1c485a06-9936-459f-ab19-28204faadf0e	b758c988-083f-469e-ab55-efe5f7b1306a	Building 3	POINT Z (17.227723408079832 48.16373213013549 133)	20	143.38747431533795	POLYGON Z ((17.225694182526553 48.16209185259655 133,17.226361229817883 48.16167070673646 133,17.23102755967699 48.164703464646124 133,17.229906486609167 48.16539983434063 133,17.225627581768578 48.1647947923577 133,17.225694182526553 48.16209185259655 133))	BUILDING	5
a8a52906-a311-4dcb-9548-5d0213919b91	b758c988-083f-469e-ab55-efe5f7b1306a	Building 4	POINT Z (17.2249269761964 48.176467509856025 133)	10	17.21219651817899	POLYGON Z ((17.2249269761964 48.17662248953798 133,17.22494975631941 48.17662174326845 133,17.224972317057386 48.17661951164685 133,17.224994441138083 48.176615816164905 133,17.225015915494513 48.17661069241214 133,17.22503653331688 48.176604189733084 133,17.225056096044288 48.176596370752094 133,17.22507441527698 48.17658731077024 133,17.22509131459072 48.17657709704008 133,17.225106631235892 48.17656582792544 133,17.225120217704823 48.17655361195404 133,17.22513194315239 48.176540566772374 133,17.225141694656127 48.17652681801266 133,17.22514937830372 48.176512498082985 133,17.22515492009744 48.17649774489208 133,17.22515826666679 48.17648270052126 133,17.22515938578247 48.176467509856025 133,17.22515826666679 48.17645231919079 133,17.22515492009744 48.17643727481997 133,17.22514937830372 48.176422521629064 133,17.225141694656127 48.17640820169939 133,17.22513194315239 48.176394452939675 133,17.225120217704823 48.17638140775801 133,17.225106631235892 48.17636919178661 133,17.22509131459072 48.17635792267197 133,17.22507441527698 48.17634770894181 133,17.225056096044288 48.176338648959955 133,17.22503653331688 48.176330829978966 133,17.225015915494513 48.17632432729991 133,17.224994441138083 48.176319203547145 133,17.224972317057386 48.1763155080652 133,17.22494975631941 48.1763132764436 133,17.2249269761964 48.176312530174066 133,17.22490419607339 48.1763132764436 133,17.224881635335414 48.1763155080652 133,17.224859511254717 48.176319203547145 133,17.224838036898287 48.17632432729991 133,17.22481741907592 48.176330829978966 133,17.224797856348513 48.176338648959955 133,17.224779537115822 48.17634770894181 133,17.22476263780208 48.17635792267197 133,17.224747321156908 48.17636919178661 133,17.224733734687977 48.17638140775801 133,17.22472200924041 48.176394452939675 133,17.224712257736673 48.17640820169939 133,17.22470457408908 48.176422521629064 133,17.22469903229536 48.17643727481997 133,17.22469568572601 48.17645231919079 133,17.22469456661033 48.176467509856025 133,17.22469568572601 48.17648270052126 133,17.22469903229536 48.17649774489208 133,17.22470457408908 48.176512498082985 133,17.224712257736673 48.17652681801266 133,17.22472200924041 48.176540566772374 133,17.224733734687977 48.17655361195404 133,17.224747321156908 48.17656582792544 133,17.22476263780208 48.17657709704008 133,17.224779537115822 48.17658731077024 133,17.224797856348513 48.176596370752094 133,17.22481741907592 48.176604189733084 133,17.224838036898287 48.17661069241214 133,17.224859511254717 48.176615816164905 133,17.224881635335414 48.17661951164685 133,17.22490419607339 48.17662174326845 133,17.2249269761964 48.17662248953798 133))	BUILDING	5
220aa222-e98d-45f2-93a6-883f3eb30f5f	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	Obstacle	POINT Z (21.2719237746766 48.69717559374402 202)	100	3	POLYGON Z ((21.2719237746766 48.69720098635747 202,21.271939417197476 48.69719893265299 202,21.27195267828299 48.69719308419786 202,21.27196153905169 48.697184331367495 202,21.271964650533263 48.69717400670207 202,21.271961539036198 48.697163682038756 202,21.27195267826108 48.69715492921351 202,21.271939417181986 48.697149080763495 202,21.2719237746766 48.69714702706113 202,21.27190813217122 48.697149080763495 202,21.271894871092126 48.69715492921351 202,21.271886010317004 48.697163682038756 202,21.271882898819943 48.69717400670207 202,21.271886010301515 48.697184331367495 202,21.271894871070216 48.69719308419786 202,21.27190813215573 48.69719893265299 202,21.2719237746766 48.69720098635747 202))	OTHER	5
c56d14ee-e3e4-4479-b947-02b1301b9eb2	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	Obstacle	POINT Z (21.271746285296004 48.69804653720652 196)	100	3	POLYGON Z ((21.271746285296 48.69807192981998 196,21.271761928087514 48.69806987611548 196,21.271775189402458 48.698064027660365 196,21.27178405032447 48.69805527483 196,21.271787161859873 48.69804495016457 196,21.271784050308977 48.69803462550126 196,21.271775189380552 48.698025872676006 196,21.27176192807202 48.698020024226 196,21.271746285296 48.69801797052362 196,21.271730642519984 48.698020024226 196,21.271717381211452 48.698025872676006 196,21.271708520283028 48.69803462550126 196,21.27170540873213 48.69804495016457 196,21.271708520267534 48.69805527483 196,21.271717381189543 48.698064027660365 196,21.27173064250449 48.69806987611548 196,21.271746285296 48.69807192981998 196))	OTHER	5
892eb7b0-a965-44a4-ba8b-ed1a28fef2df	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	Obstacle	POINT Z (21.2388951182924 48.72255308198073 245)	83	3	POLYGON Z ((21.2388951182924 48.72257847459419 245,21.23891076870444 48.722576420889695 245,21.23892403647975 48.72257057243456 245,21.238932901718428 48.7225618196042 245,21.238936014769635 48.72255149493877 245,21.238932901702917 48.722541170275456 245,21.238924036457814 48.72253241745021 245,21.238910768688925 48.7225265690002 245,21.2388951182924 48.72252451529783 245,21.238879467895877 48.7225265690002 245,21.23886620012699 48.72253241745021 245,21.238857334881885 48.722541170275456 245,21.238854221815167 48.72255149493877 245,21.238857334866374 48.7225618196042 245,21.23886620010505 48.72257057243456 245,21.238879467880363 48.722576420889695 245,21.2388951182924 48.72257847459419 245))	OTHER	5
2fbb38d3-ba53-4329-8f68-0b251e9392c4	b758c988-083f-469e-ab55-efe5f7b1306a	Building 2	POINT Z (17.205036690023633 48.168923750561454 133.0)	5	17.667330266831453	POLYGON Z ((17.204844203150117 48.169040461411186 133.0, 17.20515086323394 48.16908250375542 133.0, 17.205366712591456 48.168913138712355 133.0, 17.205016745492514 48.16871936736683 133.0, 17.204804925650137 48.16886328156147 133.0, 17.204844203150117 48.169040461411186 133.0))	BUILDING	5
\.


--
-- Data for Name: safety_zone; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.safety_zone (id, airport_id, name, type, geometry, altitude_floor, altitude_ceiling, is_active) FROM stdin;
c4f81af6-7e42-40e0-a3fa-ee0b4e2a9066	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	KOSICE CTR	CTR	POLYGON Z ((21.212222222222 48.875555555556 0,21.408888888889 48.845277777778 0,21.370833333333 48.7375 0,21.436388888889 48.667222222222 0,21.399722222222 48.563611111111 0,21.395555555556 48.563333333333 0,21.379444444444 48.558055555556 0,21.349444444444 48.560555555556 0,21.3275 48.559444444444 0,21.323333333333 48.557777777778 0,21.325833333333 48.561666666667 0,21.323333333333 48.562222222222 0,21.318055555556 48.559444444444 0,21.316111111111 48.555277777778 0,21.326666666667 48.555555555556 0,21.323611111111 48.551666666667 0,21.316666666667 48.553055555556 0,21.313333333333 48.550833333333 0,21.321111111111 48.547222222222 0,21.316388888889 48.543611111111 0,21.317777777778 48.539166666667 0,21.309722222222 48.540277777778 0,21.309722222222 48.5375 0,21.316111111111 48.533333333333 0,21.311388888889 48.530277777778 0,21.301666666667 48.525555555556 0,21.308611111111 48.526388888889 0,21.305833333333 48.5225 0,21.2975 48.523055555556 0,21.296666666667 48.521666666667 0,21.270555555556 48.5275 0,21.269166666667 48.525277777778 0,21.266111111111 48.526111111111 0,21.238888888889 48.539722222222 0,21.232777777778 48.539166666667 0,21.233333333333 48.534166666667 0,21.221111111111 48.5375 0,21.216388888889 48.531388888889 0,21.209166666667 48.533611111111 0,21.209166666667 48.527222222222 0,21.198888888889 48.524444444444 0,21.1925 48.526666666667 0,21.191111111111 48.5225 0,21.188055555556 48.524722222222 0,21.185277777778 48.520555555556 0,21.179722222222 48.518333333333 0,21.174722222222 48.521111111111 0,21.161111111111 48.521666666667 0,21.159444444444 48.518055555556 0,21.152777777778 48.516944444444 0,21.148333333333 48.513611111111 0,21.138333333333 48.503055555556 0,21.133888888889 48.495277777778 0,21.128333333333 48.4925 0,21.1175 48.491111111111 0,21.108611111111 48.492222222222 0,21.101111111111 48.494444444444 0,21.094166666667 48.500555555556 0,21.097777777778 48.504166666667 0,21.098055555556 48.510555555556 0,21.09 48.5175 0,21.074722222222 48.520555555556 0,21.066388888889 48.525833333333 0,21.053333333333 48.522222222222 0,21.053055555556 48.526111111111 0,21.033888888889 48.526944444444 0,21.030277777778 48.530833333333 0,21.026388888889 48.531388888889 0,21.023333333333 48.529444444444 0,21.015 48.532222222222 0,21.002777777778 48.5275 0,21.000833333333 48.5275 0,21.068333333333 48.723888888889 0,21.08 48.757222222222 0,21.1025 48.8225 0,21.205 48.855555555556 0,21.212222222222 48.875555555556 0))	0	1524	t
a5254484-c8a8-4777-802b-b486559d19b0	bda0641e-81a4-4fc4-8918-ba7cc6a436a3	LZTRA7	RESTRICTED	POLYGON Z ((20.376944444444 49.3125 0,20.712222222222 49.3125 0,20.931944444444 49.165277777778 0,20.955833333333 49.100833333333 0,21.013611111111 48.943888888889 0,21.038055555556 48.876944444444 0,21.054722222222 48.829722222222 0,21.08 48.757222222222 0,20.756388888889 48.724722222222 0,20.245 48.671111111111 0,20.152777777778 48.864166666667 0,19.9575 48.873333333333 0,19.877777777778 48.943333333333 0,19.666111111111 48.9525 0,19.611111111111 49.000277777778 0,19.626111111111 49.154722222222 0,19.735555555556 49.15 0,19.861944444444 49.144444444444 0,20.21 49.128611111111 0,20.323611111111 49.213333333333 0,20.376111111111 49.252222222222 0,20.376944444444 49.3125 0))	0	0	t
e12ec010-cdfa-40f3-9ee7-3ef1e818c664	b758c988-083f-469e-ab55-efe5f7b1306a	Airport	TEMPORARY_NO_FLY	POLYGON Z ((17.186531487017845 48.16018121905614 133,17.184153338929207 48.16437830911414 133,17.190069525067003 48.16552277626823 133,17.189770932163015 48.1676072175527 133,17.18887724845598 48.16752377107741 133,17.187965691074993 48.169288039074644 133,17.189717311139788 48.16999134520722 133,17.191862152036435 48.17006286732453 133,17.19225537286681 48.169752937429365 133,17.19692040181647 48.16982445987921 133,17.19799282226407 48.1699794248448 133,17.200548757664933 48.17158864872965 133,17.201764180468956 48.17189176661009 133,17.20397083425607 48.17353222725123 133,17.206522849631313 48.171861461350574 133,17.201259394500738 48.168335657535636 133,17.202149772309127 48.16646554067373 133,17.19922179564901 48.16444934708858 133,17.195396829388358 48.16238686028524 133,17.186531487017845 48.16018121905614 133))	0	100	t
4001e93e-a864-48d2-b8d0-62c6b9df5c9a	8d544a9c-c9b5-4ea6-a2c5-49043094000a	PIESTANY CTR	CTR	POLYGON Z ((17.787777777778 48.804722222222 0,17.991944444444 48.706944444444 0,18.004166666667 48.62 0,18.003333333333 48.611111111111 0,18.001388888889 48.6025 0,17.998333333333 48.593888888889 0,17.994166666667 48.585555555556 0,17.989166666667 48.5775 0,17.983333333333 48.569444444444 0,17.976666666667 48.561944444444 0,17.968888888889 48.554722222222 0,17.960555555556 48.548055555556 0,17.951388888889 48.541666666667 0,17.941388888889 48.535555555556 0,17.930833333333 48.530277777778 0,17.919722222222 48.525555555556 0,17.908055555556 48.521111111111 0,17.896111111111 48.5175 0,17.883611111111 48.514444444444 0,17.870833333333 48.511944444444 0,17.860833333333 48.510555555556 0,17.831111111111 48.429722222222 0,17.691666666667 48.452222222222 0,17.721111111111 48.533055555556 0,17.710833333333 48.538611111111 0,17.701388888889 48.544722222222 0,17.6925 48.551388888889 0,17.684444444444 48.558333333333 0,17.677222222222 48.565833333333 0,17.670833333333 48.573611111111 0,17.665555555556 48.581666666667 0,17.661666666667 48.588333333333 0,17.735833333333 48.7925 0,17.787777777778 48.804722222222 0))	0	1524	t
\.


--
-- Data for Name: user_airports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_airports (user_id, airport_id) FROM stdin;
e6bd9371-b9af-46b7-ac70-7a850bf73816	b758c988-083f-469e-ab55-efe5f7b1306a
209d784d-2435-458f-94bc-2e9b70be3c18	bda0641e-81a4-4fc4-8918-ba7cc6a436a3
209d784d-2435-458f-94bc-2e9b70be3c18	b758c988-083f-469e-ab55-efe5f7b1306a
aaee860b-acab-48ec-8398-97c47ac39c2c	bda0641e-81a4-4fc4-8918-ba7cc6a436a3
aaee860b-acab-48ec-8398-97c47ac39c2c	b758c988-083f-469e-ab55-efe5f7b1306a
aaee860b-acab-48ec-8398-97c47ac39c2c	8d544a9c-c9b5-4ea6-a2c5-49043094000a
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, hashed_password, name, role, is_active, invitation_token, invitation_expires_at, last_login, created_at, updated_at, organization_id) FROM stdin;
aaee860b-acab-48ec-8398-97c47ac39c2c	coord@tmv.com	$2b$12$Pqy9Mg2HhBWJH3Q3.gU6we9jEKlBPxjtxrQe8DN6nXeGtLRpHBzfa	Jozef Coordinator	COORDINATOR	t	\N	\N	2026-04-22 07:32:29.27119+00	2026-04-18 21:22:02.05517+00	2026-05-05 13:22:01.145735+00	\N
e6bd9371-b9af-46b7-ac70-7a850bf73816	operator@tmv.com	$2b$12$RH63g78UGYevArXcXmg5P.FVEkamUkYO4dYDwFZEUEHsvV7zw7tfq	Ján Operátor	OPERATOR	t	\N	\N	2026-05-15 23:51:30.157691+00	2026-04-18 21:22:02.05517+00	2026-05-15 23:51:29.959338+00	\N
209d784d-2435-458f-94bc-2e9b70be3c18	admin@tmv.com	$2b$12$LdyBkWg7QeNVlIF9/idFRudPwX1NhDwTb2tdMYwJkmU1d281ZSdKO	Štefan Moravík	SUPER_ADMIN	t	\N	\N	2026-05-16 23:36:25.489093+00	2026-04-18 21:22:02.05517+00	2026-05-16 23:36:25.310217+00	\N
\.


--
-- Name: agl agl_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agl
    ADD CONSTRAINT agl_pkey PRIMARY KEY (id);


--
-- Name: airfield_surface airfield_surface_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airfield_surface
    ADD CONSTRAINT airfield_surface_pkey PRIMARY KEY (id);


--
-- Name: airport airport_icao_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airport
    ADD CONSTRAINT airport_icao_code_key UNIQUE (icao_code);


--
-- Name: airport airport_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airport
    ADD CONSTRAINT airport_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: camera_preset camera_preset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_preset
    ADD CONSTRAINT camera_preset_pkey PRIMARY KEY (id);


--
-- Name: constraint_rule constraint_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.constraint_rule
    ADD CONSTRAINT constraint_rule_pkey PRIMARY KEY (id);


--
-- Name: drone_profile drone_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drone_profile
    ADD CONSTRAINT drone_profile_pkey PRIMARY KEY (id);


--
-- Name: elevation_cache elevation_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.elevation_cache
    ADD CONSTRAINT elevation_cache_pkey PRIMARY KEY (lat_round_5dp, lon_round_5dp);


--
-- Name: export_result export_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_result
    ADD CONSTRAINT export_result_pkey PRIMARY KEY (id);


--
-- Name: flight_plan flight_plan_mission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_plan
    ADD CONSTRAINT flight_plan_mission_id_key UNIQUE (mission_id);


--
-- Name: flight_plan flight_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_plan
    ADD CONSTRAINT flight_plan_pkey PRIMARY KEY (id);


--
-- Name: insp_template_methods insp_template_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insp_template_methods
    ADD CONSTRAINT insp_template_methods_pkey PRIMARY KEY (template_id, method);


--
-- Name: insp_template_targets insp_template_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insp_template_targets
    ADD CONSTRAINT insp_template_targets_pkey PRIMARY KEY (template_id, agl_id);


--
-- Name: inspection_configuration inspection_configuration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_configuration
    ADD CONSTRAINT inspection_configuration_pkey PRIMARY KEY (id);


--
-- Name: inspection inspection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_pkey PRIMARY KEY (id);


--
-- Name: inspection_template inspection_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_template
    ADD CONSTRAINT inspection_template_pkey PRIMARY KEY (id);


--
-- Name: lha lha_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lha
    ADD CONSTRAINT lha_pkey PRIMARY KEY (id);


--
-- Name: mission mission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_pkey PRIMARY KEY (id);


--
-- Name: obstacle obstacle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obstacle
    ADD CONSTRAINT obstacle_pkey PRIMARY KEY (id);


--
-- Name: safety_zone safety_zone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_zone
    ADD CONSTRAINT safety_zone_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: lha uq_lha_agl_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lha
    ADD CONSTRAINT uq_lha_agl_sequence UNIQUE (agl_id, sequence_number);


--
-- Name: user_airports user_airports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_airports
    ADD CONSTRAINT user_airports_pkey PRIMARY KEY (user_id, airport_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: validation_result validation_result_flight_plan_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_result
    ADD CONSTRAINT validation_result_flight_plan_id_key UNIQUE (flight_plan_id);


--
-- Name: validation_result validation_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_result
    ADD CONSTRAINT validation_result_pkey PRIMARY KEY (id);


--
-- Name: validation_violation validation_violation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_violation
    ADD CONSTRAINT validation_violation_pkey PRIMARY KEY (id);


--
-- Name: waypoint waypoint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waypoint
    ADD CONSTRAINT waypoint_pkey PRIMARY KEY (id);


--
-- Name: ix_airfield_surface_paired_surface_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_airfield_surface_paired_surface_id ON public.airfield_surface USING btree (paired_surface_id) WHERE (paired_surface_id IS NOT NULL);


--
-- Name: ix_audit_log_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_action ON public.audit_log USING btree (action);


--
-- Name: ix_audit_log_airport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_airport_id ON public.audit_log USING btree (airport_id);


--
-- Name: ix_audit_log_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_timestamp ON public.audit_log USING btree ("timestamp");


--
-- Name: ix_audit_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_user_id ON public.audit_log USING btree (user_id);


--
-- Name: ix_constraint_rule_mission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_constraint_rule_mission_id ON public.constraint_rule USING btree (mission_id);


--
-- Name: ix_inspection_configuration_lha_setting_angle_override_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inspection_configuration_lha_setting_angle_override_id ON public.inspection_configuration USING btree (lha_setting_angle_override_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: uq_camera_preset_default_generic; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_camera_preset_default_generic ON public.camera_preset USING btree (((drone_profile_id IS NULL))) WHERE ((is_default = true) AND (drone_profile_id IS NULL));


--
-- Name: uq_camera_preset_default_per_drone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_camera_preset_default_per_drone ON public.camera_preset USING btree (drone_profile_id) WHERE ((is_default = true) AND (drone_profile_id IS NOT NULL));


--
-- Name: uq_safety_zone_airport_boundary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_safety_zone_airport_boundary ON public.safety_zone USING btree (airport_id) WHERE ((type)::text = 'AIRPORT_BOUNDARY'::text);


--
-- Name: inspection_template trg_inspection_template_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_inspection_template_updated_at BEFORE UPDATE ON public.inspection_template FOR EACH ROW EXECUTE FUNCTION public.set_inspection_template_updated_at();


--
-- Name: agl agl_surface_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agl
    ADD CONSTRAINT agl_surface_id_fkey FOREIGN KEY (surface_id) REFERENCES public.airfield_surface(id) ON DELETE CASCADE;


--
-- Name: airfield_surface airfield_surface_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airfield_surface
    ADD CONSTRAINT airfield_surface_airport_id_fkey FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: camera_preset camera_preset_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_preset
    ADD CONSTRAINT camera_preset_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: camera_preset camera_preset_drone_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_preset
    ADD CONSTRAINT camera_preset_drone_profile_id_fkey FOREIGN KEY (drone_profile_id) REFERENCES public.drone_profile(id) ON DELETE SET NULL;


--
-- Name: export_result export_result_flight_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_result
    ADD CONSTRAINT export_result_flight_plan_id_fkey FOREIGN KEY (flight_plan_id) REFERENCES public.flight_plan(id) ON DELETE CASCADE;


--
-- Name: airfield_surface fk_airfield_surface_paired_surface_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airfield_surface
    ADD CONSTRAINT fk_airfield_surface_paired_surface_id FOREIGN KEY (paired_surface_id) REFERENCES public.airfield_surface(id) ON DELETE SET NULL;


--
-- Name: airport fk_airport_default_drone_profile_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airport
    ADD CONSTRAINT fk_airport_default_drone_profile_id FOREIGN KEY (default_drone_profile_id) REFERENCES public.drone_profile(id) ON DELETE SET NULL;


--
-- Name: audit_log fk_audit_log_airport_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT fk_audit_log_airport_id FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE SET NULL;


--
-- Name: constraint_rule fk_constraint_rule_mission_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.constraint_rule
    ADD CONSTRAINT fk_constraint_rule_mission_id FOREIGN KEY (mission_id) REFERENCES public.mission(id) ON DELETE CASCADE;


--
-- Name: inspection_configuration fk_inspection_config_lha_setting_angle_override; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_configuration
    ADD CONSTRAINT fk_inspection_config_lha_setting_angle_override FOREIGN KEY (lha_setting_angle_override_id) REFERENCES public.lha(id) ON DELETE SET NULL;


--
-- Name: inspection_configuration fk_inspection_configuration_selected_lha_id_lha; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_configuration
    ADD CONSTRAINT fk_inspection_configuration_selected_lha_id_lha FOREIGN KEY (selected_lha_id) REFERENCES public.lha(id) ON DELETE SET NULL;


--
-- Name: mission fk_mission_airport_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT fk_mission_airport_id FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE CASCADE;


--
-- Name: flight_plan flight_plan_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_plan
    ADD CONSTRAINT flight_plan_airport_id_fkey FOREIGN KEY (airport_id) REFERENCES public.airport(id);


--
-- Name: flight_plan flight_plan_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_plan
    ADD CONSTRAINT flight_plan_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.mission(id) ON DELETE CASCADE;


--
-- Name: insp_template_methods insp_template_methods_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insp_template_methods
    ADD CONSTRAINT insp_template_methods_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.inspection_template(id) ON DELETE CASCADE;


--
-- Name: insp_template_targets insp_template_targets_agl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insp_template_targets
    ADD CONSTRAINT insp_template_targets_agl_id_fkey FOREIGN KEY (agl_id) REFERENCES public.agl(id) ON DELETE CASCADE;


--
-- Name: insp_template_targets insp_template_targets_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insp_template_targets
    ADD CONSTRAINT insp_template_targets_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.inspection_template(id) ON DELETE CASCADE;


--
-- Name: inspection inspection_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.inspection_configuration(id);


--
-- Name: inspection_configuration inspection_configuration_camera_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_configuration
    ADD CONSTRAINT inspection_configuration_camera_preset_id_fkey FOREIGN KEY (camera_preset_id) REFERENCES public.camera_preset(id) ON DELETE SET NULL;


--
-- Name: inspection inspection_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.mission(id) ON DELETE CASCADE;


--
-- Name: inspection_template inspection_template_default_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_template
    ADD CONSTRAINT inspection_template_default_config_id_fkey FOREIGN KEY (default_config_id) REFERENCES public.inspection_configuration(id) ON DELETE SET NULL;


--
-- Name: inspection inspection_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.inspection_template(id);


--
-- Name: lha lha_agl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lha
    ADD CONSTRAINT lha_agl_id_fkey FOREIGN KEY (agl_id) REFERENCES public.agl(id) ON DELETE CASCADE;


--
-- Name: mission mission_drone_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_drone_profile_id_fkey FOREIGN KEY (drone_profile_id) REFERENCES public.drone_profile(id) ON DELETE SET NULL;


--
-- Name: obstacle obstacle_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obstacle
    ADD CONSTRAINT obstacle_airport_id_fkey FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE CASCADE;


--
-- Name: safety_zone safety_zone_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_zone
    ADD CONSTRAINT safety_zone_airport_id_fkey FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_airports user_airports_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_airports
    ADD CONSTRAINT user_airports_airport_id_fkey FOREIGN KEY (airport_id) REFERENCES public.airport(id) ON DELETE CASCADE;


--
-- Name: user_airports user_airports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_airports
    ADD CONSTRAINT user_airports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: validation_result validation_result_flight_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_result
    ADD CONSTRAINT validation_result_flight_plan_id_fkey FOREIGN KEY (flight_plan_id) REFERENCES public.flight_plan(id) ON DELETE CASCADE;


--
-- Name: validation_violation validation_violation_constraint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_violation
    ADD CONSTRAINT validation_violation_constraint_id_fkey FOREIGN KEY (constraint_id) REFERENCES public.constraint_rule(id) ON DELETE SET NULL;


--
-- Name: validation_violation validation_violation_validation_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_violation
    ADD CONSTRAINT validation_violation_validation_result_id_fkey FOREIGN KEY (validation_result_id) REFERENCES public.validation_result(id) ON DELETE CASCADE;


--
-- Name: waypoint waypoint_flight_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waypoint
    ADD CONSTRAINT waypoint_flight_plan_id_fkey FOREIGN KEY (flight_plan_id) REFERENCES public.flight_plan(id) ON DELETE CASCADE;


--
-- Name: waypoint waypoint_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waypoint
    ADD CONSTRAINT waypoint_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspection(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 0tiTck8cjMzx6t3eIwSKJxxjPfkuY4NNdevOQxPfkVJIkO8cc8iRfFqc1SpqINB

