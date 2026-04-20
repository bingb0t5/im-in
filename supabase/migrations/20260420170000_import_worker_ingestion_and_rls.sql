ALTER TABLE public.event_sources
  ADD COLUMN IF NOT EXISTS last_fetch_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_fetch_error TEXT,
  ADD COLUMN IF NOT EXISTS last_fetch_job_id UUID,
  ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_snapshot_id UUID;

ALTER TABLE public.source_snapshots
  ADD COLUMN IF NOT EXISTS ingestion_job_id UUID,
  ADD COLUMN IF NOT EXISTS ingestion_status_message TEXT;

ALTER TABLE public.external_event_drafts
  ADD COLUMN IF NOT EXISTS status_reason TEXT;

ALTER TABLE public.event_sources
  DROP CONSTRAINT IF EXISTS event_sources_last_fetch_status_check;
ALTER TABLE public.event_sources
  ADD CONSTRAINT event_sources_last_fetch_status_check
  CHECK (last_fetch_status IN ('idle', 'queued', 'fetching', 'extracting', 'submitting', 'succeeded', 'failed', 'retryable'));

ALTER TABLE public.event_sources
  DROP CONSTRAINT IF EXISTS event_sources_last_snapshot_id_fkey;
ALTER TABLE public.event_sources
  ADD CONSTRAINT event_sources_last_snapshot_id_fkey
  FOREIGN KEY (last_snapshot_id) REFERENCES public.source_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_sources_last_fetch_status_idx ON public.event_sources(last_fetch_status);
CREATE INDEX IF NOT EXISTS event_sources_last_fetch_job_id_idx ON public.event_sources(last_fetch_job_id);
CREATE INDEX IF NOT EXISTS source_snapshots_ingestion_job_id_idx ON public.source_snapshots(ingestion_job_id);

DROP POLICY IF EXISTS "Authenticated users can write event sources" ON public.event_sources;
DROP POLICY IF EXISTS "Authenticated users can write source snapshots" ON public.source_snapshots;
DROP POLICY IF EXISTS "Authenticated users can write external event drafts" ON public.external_event_drafts;

CREATE POLICY "Service role can write event sources"
  ON public.event_sources
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can write source snapshots"
  ON public.source_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can write external event drafts"
  ON public.external_event_drafts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE INSERT, UPDATE, DELETE ON public.event_sources FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.source_snapshots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.external_event_drafts FROM authenticated;

GRANT SELECT ON public.event_sources TO authenticated;
GRANT SELECT ON public.source_snapshots TO authenticated;
GRANT SELECT ON public.external_event_drafts TO authenticated;
