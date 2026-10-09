-- The imported database dump can contain more screens than its captured sequence value.
SELECT setval(
    'nexus_tv.tv_screens_id_seq',
    GREATEST(COALESCE((SELECT MAX(id) FROM nexus_tv.tv_screens), 1), 1),
    true
);
