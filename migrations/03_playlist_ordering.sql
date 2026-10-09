ALTER TABLE nexus_tv.playlist_content
    ADD COLUMN position integer NOT NULL DEFAULT 0;

WITH numbered AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY playlist_id
               ORDER BY start_time NULLS FIRST, content_id, end_time NULLS LAST, id
           ) - 1 AS new_position
    FROM nexus_tv.playlist_content
)
UPDATE nexus_tv.playlist_content pc
SET position = numbered.new_position
FROM numbered
WHERE pc.id = numbered.id;

CREATE INDEX playlist_content_order_idx
    ON nexus_tv.playlist_content (playlist_id, position, start_time);
