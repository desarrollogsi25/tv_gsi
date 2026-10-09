BEGIN;

-- Active screens without a playlist need a safe continuous default as well.
INSERT INTO nexus_tv.playlists (name, is_public)
SELECT 'CALL CENTER 24/7', false
WHERE NOT EXISTS (
    SELECT 1 FROM nexus_tv.playlists WHERE name = 'CALL CENTER 24/7'
);

WITH default_playlist AS (
    SELECT id FROM nexus_tv.playlists WHERE name = 'CALL CENTER 24/7' ORDER BY id LIMIT 1
)
INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary)
SELECT ts.id, dp.id, true
FROM nexus_tv.tv_screens ts
CROSS JOIN default_playlist dp
WHERE ts.is_active = true
  AND NOT EXISTS (
      SELECT 1 FROM nexus_tv.tv_playlist tp WHERE tp.tv_id = ts.id
  )
ON CONFLICT (tv_id, playlist_id) DO NOTHING;

-- Legacy entries named 02_VID_* are hosted videos; 30 seconds is a
-- representative catalog duration when source metadata is unavailable.
UPDATE nexus_tv.content
SET duration_seconds = 30
WHERE duration_seconds = 3600
  AND (
      title ILIKE '02\_VID\_%' ESCAPE '\'
      OR source_url ~* '(youtube\.com/(shorts/|watch\?v=)|youtu\.be/)'
      OR source_url ~* '\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)(\?.*)?$'
  );

-- Preserve each screen's assigned playlist and populate every one with the
-- complete video library. Existing scheduled copies are replaced by an
-- always-on row so that none can mask the continuous item.
WITH videos AS (
    SELECT c.id
    FROM nexus_tv.content c
    WHERE c.content_type = 'video'
       OR c.title ILIKE '02\_VID\_%' ESCAPE '\'
       OR c.source_url ~* '(youtube\.com/(shorts/|watch\?v=)|youtu\.be/)'
       OR c.source_url ~* '\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)(\?.*)?$'
), assigned_playlists AS (
    SELECT DISTINCT tp.playlist_id
    FROM nexus_tv.tv_playlist tp
    JOIN nexus_tv.tv_screens ts ON ts.id = tp.tv_id
    WHERE ts.is_active = true
), scheduled_library_rows AS (
    SELECT pc.id
    FROM nexus_tv.playlist_content pc
    JOIN assigned_playlists ap ON ap.playlist_id = pc.playlist_id
    JOIN videos v ON v.id = pc.content_id
    WHERE pc.start_time IS NOT NULL OR pc.end_time IS NOT NULL
)
DELETE FROM nexus_tv.playlist_content pc
USING scheduled_library_rows scheduled
WHERE pc.id = scheduled.id;

WITH videos AS (
    SELECT c.id
    FROM nexus_tv.content c
    WHERE c.content_type = 'video'
       OR c.title ILIKE '02\_VID\_%' ESCAPE '\'
       OR c.source_url ~* '(youtube\.com/(shorts/|watch\?v=)|youtu\.be/)'
       OR c.source_url ~* '\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)(\?.*)?$'
), assigned_playlists AS (
    SELECT DISTINCT tp.playlist_id
    FROM nexus_tv.tv_playlist tp
    JOIN nexus_tv.tv_screens ts ON ts.id = tp.tv_id
    WHERE ts.is_active = true
), missing_rows AS (
    SELECT ap.playlist_id, v.id AS content_id
    FROM assigned_playlists ap
    CROSS JOIN videos v
    WHERE NOT EXISTS (
        SELECT 1
        FROM nexus_tv.playlist_content pc
        WHERE pc.playlist_id = ap.playlist_id
          AND pc.content_id = v.id
          AND pc.start_time IS NULL
          AND pc.end_time IS NULL
    )
), positions AS (
    SELECT playlist_id, content_id,
           COALESCE((SELECT MAX(pc.position)
                     FROM nexus_tv.playlist_content pc
                     WHERE pc.playlist_id = missing_rows.playlist_id), -1)
           + row_number() OVER (PARTITION BY playlist_id ORDER BY content_id) AS position
    FROM missing_rows
)
INSERT INTO nexus_tv.playlist_content
    (playlist_id, content_id, start_time, end_time, days_of_week, position)
SELECT playlist_id, content_id, NULL, NULL, NULL, position
FROM positions
ON CONFLICT (playlist_id, content_id, start_time, end_time)
DO UPDATE SET days_of_week = NULL;

-- Normalize any existing all-day video rows to the nullable all-week policy.
WITH videos AS (
    SELECT c.id
    FROM nexus_tv.content c
    WHERE c.content_type = 'video'
       OR c.title ILIKE '02\_VID\_%' ESCAPE '\'
       OR c.source_url ~* '(youtube\.com/(shorts/|watch\?v=)|youtu\.be/)'
       OR c.source_url ~* '\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)(\?.*)?$'
)
UPDATE nexus_tv.playlist_content pc
SET start_time = NULL, end_time = NULL, days_of_week = NULL
FROM videos v
WHERE pc.content_id = v.id
  AND pc.start_time IS NULL
  AND pc.end_time IS NULL
  AND pc.days_of_week IS NOT NULL;

COMMIT;
