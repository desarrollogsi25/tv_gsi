-- Creates a dedicated backend login on fresh installations.
-- docker-compose.yml supplies these values from the private .env file.
\getenv app_user PG_APP_USER
\getenv app_password PG_APP_PASSWORD

SELECT :'app_user' <> '' AND :'app_password' <> '' AS app_configured \gset
\if :app_configured
  SELECT :'app_user' <> current_user AS app_is_distinct_from_bootstrap \gset
  \if :app_is_distinct_from_bootstrap
    SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = :'app_user'), false) AS app_is_superuser \gset
    \if :app_is_superuser
      \echo 'PG_APP_USER already exists as SUPERUSER; refusing to alter it.'
      \quit 3
    \endif
  \else
    \echo 'PG_APP_USER must be distinct from the PostgreSQL bootstrap user.'
    \quit 3
  \endif

  SELECT format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      :'app_user', :'app_password'
  ) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
  \gexec
  SELECT format(
      'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      :'app_user', :'app_password'
  ) WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
  \gexec

  SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
  SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', datname)
  FROM pg_database
  WHERE datallowconn AND datname <> current_database()
  \gexec
  GRANT USAGE ON SCHEMA nexus_tv TO :"app_user";
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.content TO :"app_user";
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.playlist_content TO :"app_user";
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.playlists TO :"app_user";
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.tv_playlist TO :"app_user";
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.tv_screens TO :"app_user";
  GRANT SELECT ON TABLE nexus_tv.users TO :"app_user";
  GRANT USAGE, SELECT ON SEQUENCE nexus_tv.content_id_seq TO :"app_user";
  GRANT USAGE, SELECT ON SEQUENCE nexus_tv.playlist_content_id_seq TO :"app_user";
  GRANT USAGE, SELECT ON SEQUENCE nexus_tv.playlists_id_seq TO :"app_user";
  GRANT USAGE, SELECT ON SEQUENCE nexus_tv.tv_screens_id_seq TO :"app_user";
\else
  \echo 'PG_APP_USER and PG_APP_PASSWORD are required for a fresh installation.'
  \quit 3
\endif
