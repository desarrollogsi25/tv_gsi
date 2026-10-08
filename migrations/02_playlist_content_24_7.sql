-- Allow always-on playlist entries while preserving one row per schedule.
ALTER TABLE nexus_tv.playlist_content
    ADD COLUMN id BIGSERIAL;

ALTER TABLE nexus_tv.playlist_content
    DROP CONSTRAINT playlist_content_pkey;

ALTER TABLE nexus_tv.playlist_content
    ALTER COLUMN start_time DROP NOT NULL,
    ALTER COLUMN end_time DROP NOT NULL;

ALTER TABLE nexus_tv.playlist_content
    ADD CONSTRAINT playlist_content_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX playlist_content_schedule_unique
    ON nexus_tv.playlist_content (playlist_id, content_id, start_time, end_time)
    NULLS NOT DISTINCT;

-- Keep the first three existing contents in each assigned playlist available 24/7.
WITH selected_content AS (
    SELECT playlist_id, content_id
    FROM (
        SELECT playlist_id, content_id,
               row_number() OVER (PARTITION BY playlist_id ORDER BY content_id) AS position
        FROM (
            SELECT DISTINCT playlist_id, content_id
            FROM nexus_tv.playlist_content
        ) unique_content
    ) ranked
    WHERE position <= 3
)
INSERT INTO nexus_tv.playlist_content (playlist_id, content_id, start_time, end_time)
SELECT playlist_id, content_id, NULL, NULL
FROM selected_content
ON CONFLICT (playlist_id, content_id, start_time, end_time) DO NOTHING;
