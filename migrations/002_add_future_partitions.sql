-- ============================================================
-- Migration 002 — Add next-year partitions
-- Run annually (e.g., every December via pg_cron)
-- ============================================================

DO $$
DECLARE
    year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1;
    month INT;
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR month IN 1..12 LOOP
        start_date := make_date(year, month, 1);
        end_date   := start_date + INTERVAL '1 month';
        partition_name := 'usage_logs_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF usage_logs
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;
